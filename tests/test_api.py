"""The web API: approve, reject, edit then recompute, and the rule that nothing sends without approval."""
import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quote_agent.api import create_app
from quote_agent.service import QuoteDesk

ROOT = Path(__file__).parent.parent
RISKY = "This is Dana from Ridgeway Farms. I need 3 one horsepower pumps and 200 half inch valves. Can you do 15% off? Also 5 one inch valves."
SAFE = "2 lengths of 20m hose and 4 hose clamps please."


@pytest.fixture
def desk(tmp_path):
    return QuoteDesk(decisions_path=tmp_path / "decisions.jsonl")


@pytest.fixture
def client(desk, tmp_path):
    return TestClient(create_app(desk, static_dir=tmp_path / "no-build"))


def submit(client, message, **extra):
    r = client.post("/api/quotes", json={"message": message, "source": "email", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_risky_request_waits_for_a_person_and_nothing_is_sent(client, desk):
    q = submit(client, RISKY, customer="Dana Whitlock", email="dana@ridgewayfarms.example")
    assert q["status"] == "needs_approval"
    assert q["reason_codes"] == ["discount_over_limit", "short_stock"]
    assert q["quote"]["total"] == 3307.5
    assert desk.outbox == []
    assert client.get("/api/activity").json()["records"] == []


def test_clean_request_is_auto_approved_sent_and_logged(client, desk):
    q = submit(client, SAFE, email="nell@aitkenlandscaping.example")
    assert q["status"] == "auto_sent" and q["decided_by"] == "auto"
    assert q["quote"]["total"] == 166.4          # 2 x 79.00 + 4 x 2.10, no tier, all code
    assert [m["to"] for m in desk.outbox] == ["nell@aitkenlandscaping.example"]
    assert client.get("/api/activity").json()["records"][0]["outcome"] == "auto_sent"


def test_approve_sends_once_and_writes_the_decision_record(client, desk):
    qid = submit(client, RISKY)["id"]
    r = client.post(f"/api/quotes/{qid}/approve", json={"note": "ok for Dana"})
    assert r.status_code == 200 and r.json()["status"] == "sent"
    assert r.json()["decided_by"] == "Marta Kowalski"
    assert len(desk.outbox) == 1 and desk.outbox[0]["request_id"] == qid
    rec = json.loads(desk.decisions_path.read_text().splitlines()[-1])
    assert rec["approved"] is True and rec["sent"] is True and rec["manager_note"] == "ok for Dana"
    assert [e["event"] for e in rec["history"]] == ["read_request", "priced", "drafted_email", "approved", "sent"]
    # a second approval is refused, and does not send again
    assert client.post(f"/api/quotes/{qid}/approve", json={}).status_code == 409
    assert len(desk.outbox) == 1


def test_reject_needs_a_reason_never_sends_and_is_logged(client, desk):
    qid = submit(client, RISKY)["id"]
    assert client.post(f"/api/quotes/{qid}/reject", json={"reason": "  "}).status_code == 422
    r = client.post(f"/api/quotes/{qid}/reject", json={"reason": "too deep"})
    assert r.json()["status"] == "rejected"
    assert desk.outbox == []
    rec = client.get("/api/activity").json()["records"][0]
    assert rec["outcome"] == "rejected" and rec["note"] == "too deep" and rec["record"]["sent"] is False
    # a rejected quote cannot be approved afterwards
    assert client.post(f"/api/quotes/{qid}/approve", json={}).status_code == 409
    assert desk.outbox == []


def test_edit_recomputes_through_the_pricing_code(client, desk):
    qid = submit(client, RISKY)["id"]
    lines = [{"sku": "PMP-100", "qty": 3, "discount": 0.10}, {"sku": "VLV-050", "qty": 200, "discount": 0.10}]
    preview = client.post(f"/api/quotes/{qid}/preview", json={"lines": lines}).json()
    assert preview["needs_manager"] == []
    assert preview["quote"]["total"] == round(3 * 445.5 + 200 * 10.35, 2)
    assert client.get(f"/api/quotes/{qid}").json()["quote"]["total"] == 3307.5   # preview changed nothing

    edited = client.post(f"/api/quotes/{qid}/edit", json={"lines": lines}).json()
    assert edited["quote"]["total"] == preview["quote"]["total"]
    assert edited["reason_codes"] == []
    assert "$445.50" in edited["draft_email"]                  # the email was redrafted from the new numbers
    # flags are gone, but a quote a person touched still waits for that person
    assert edited["status"] == "needs_approval" and edited["human_edited"] is True
    assert desk.outbox == []


def test_edit_cannot_go_below_the_margin_floor(client):
    qid = submit(client, RISKY)["id"]
    r = client.post(f"/api/quotes/{qid}/edit", json={"lines": [{"sku": "VLV-050", "qty": 10, "discount": 0.6}]}).json()
    line = r["quote"]["lines"][0]
    assert line["unit_price"] == 7.44 and "margin_clamped" in line["flags"]      # cost 6.20 plus 20%


def test_edit_rejects_unknown_sku_and_bad_quantity(client):
    qid = submit(client, RISKY)["id"]
    assert client.post(f"/api/quotes/{qid}/edit", json={"lines": [{"sku": "NOPE-1", "qty": 1}]}).status_code == 422
    assert client.post(f"/api/quotes/{qid}/edit", json={"lines": [{"sku": "PMP-100", "qty": 0}]}).status_code == 422


def test_email_can_be_edited_before_approval_and_that_text_is_what_goes_out(client, desk):
    qid = submit(client, RISKY)["id"]
    client.put(f"/api/quotes/{qid}/email", json={"draft_email": "Hi Dana, revised wording.\n\nSales team"})
    client.post(f"/api/quotes/{qid}/approve", json={})
    assert desk.outbox[0]["body"].startswith("Hi Dana, revised wording.")
    assert client.put(f"/api/quotes/{qid}/email", json={"draft_email": "too late"}).status_code == 409


def test_send_step_refuses_without_approval_even_if_the_gate_is_bypassed(client, desk):
    """Resume the graph directly, skipping the approval update. `send` must still refuse."""
    qid = submit(client, RISKY)["id"]
    desk.graph.invoke(None, {"configurable": {"thread_id": qid}})
    assert desk.outbox == []
    assert client.get(f"/api/quotes/{qid}").json()["status"] == "rejected"
    assert json.loads(desk.decisions_path.read_text().splitlines()[-1])["sent"] is False


def test_request_with_nothing_priceable_is_never_auto_sent(client, desk):
    q = submit(client, "Hello, do you have a showroom we can visit?")
    assert q["status"] == "needs_approval" and q["reason_codes"] == ["no_items"]
    assert client.post(f"/api/quotes/{q['id']}/approve", json={}).status_code == 409   # nothing to send
    assert desk.outbox == []


def test_rules_are_the_real_thresholds_and_edits_apply_to_new_quotes(client):
    rules = client.get("/api/rules").json()
    assert rules["rules"] == {"min_margin": 0.2, "max_discount_without_approval": 0.1,
                              "volume_tiers": [{"min_qty": 100, "discount": 0.12}, {"min_qty": 25, "discount": 0.07}, {"min_qty": 10, "discount": 0.03}]}
    bad = dict(rules["rules"], volume_tiers=[{"min_qty": 10, "discount": 0.2}, {"min_qty": 50, "discount": 0.1}])
    assert client.put("/api/rules", json=bad).status_code == 422
    client.put("/api/rules", json=dict(rules["rules"], max_discount_without_approval=0.05))
    q = submit(client, "25 3/4 inch ball valves")           # 7% tier, now over the 5% limit
    assert q["status"] == "needs_approval" and q["rules"]["max_discount_without_approval"] == 0.05


def test_unknown_quote_is_404(client):
    assert client.get("/api/quotes/Q-9999").status_code == 404


def test_seeded_demo_has_a_realistic_spread_and_honest_metrics(tmp_path):
    desk = QuoteDesk(seed_path=ROOT / "fixtures" / "demo_requests.json", decisions_path=tmp_path / "d.jsonl", demo_clock=True)
    client = TestClient(create_app(desk, static_dir=tmp_path / "no-build"))
    data = client.get("/api/quotes").json()
    counts = data["counts"]
    assert 25 <= counts["all"] <= 40
    assert all(counts[k] >= 3 for k in ("needs_approval", "auto_sent", "sent", "rejected"))
    assert {q["source"] for q in data["quotes"]} == {"web_form", "email", "rfq_upload"}
    # every sent quote has a matching outbox entry and log record, nothing else does
    sent = {q["id"] for q in data["quotes"] if q["status"] in ("sent", "auto_sent")}
    assert {m["request_id"] for m in desk.outbox} == sent
    assert len(client.get("/api/activity").json()["records"]) == counts["all"] - counts["needs_approval"]
    o = client.get("/api/overview").json()
    waiting = [q for q in data["quotes"] if q["status"] == "needs_approval"]
    assert o["awaiting_value"] == round(sum(q["total"] for q in waiting), 2)
    assert o["auto_share"] == round(counts["auto_sent"] / o["quotes"], 4)
    assert sum(d["total"] for d in o["daily"]) == o["quotes"] == sum(c["quotes"] for c in o["channels"])
    assert all(datetime.fromtimestamp(q["received_at"]).weekday() < 5 for q in data["quotes"])   # a working week
    # reset puts the demo back exactly
    client.post(f"/api/quotes/{waiting[0]['id']}/approve", json={})
    assert client.post("/api/reset").json() == counts
