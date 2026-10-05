from quote_agent.mailer import SmtpMailer
from quote_agent.service import ROOT, QuoteDesk


class FakeSender(SmtpMailer):
    def __init__(self, allow):
        super().__init__("sales@example.com", "x", set(allow))
        self.sent = []

    def send(self, to, subject, body, pdf, filename):
        self.sent.append({"to": to, "subject": subject, "pdf": pdf, "filename": filename})


def desk(tmp_path, sender=None, seed=True):
    return QuoteDesk(seed_path=ROOT / "fixtures" / "demo_requests.json" if seed else None,
                     decisions_path=tmp_path / "d.jsonl", email_sender=sender)


ASK = "I need 3 one horsepower pumps and 200 half inch valves, can you do 15% off?"


def test_pdf_for_waiting_and_sent_quotes(tmp_path):
    d = desk(tmp_path)
    waiting = next(q["id"] for q in d.list()["quotes"] if q["status"] == "needs_approval")
    sent = next(q["id"] for q in d.list()["quotes"] if q["status"] == "auto_sent")
    for qid in (waiting, sent):
        assert d.pdf(qid).startswith(b"%PDF-")


def test_seeded_fictional_customers_are_never_emailed(tmp_path):
    sender = FakeSender({"me@example.org"})
    d = desk(tmp_path, sender)
    assert sender.sent == []
    assert all(e["delivery"]["status"] == "not_on_allowlist" for e in d.outbox)


def test_approve_emails_allowlisted_address_with_pdf(tmp_path):
    sender = FakeSender({"Me@Example.org"})
    d = desk(tmp_path, sender, seed=False)
    qid = d.create(ASK, email="me@example.org")["id"]
    assert sender.sent == []                        # 15% asked, over the limit: waits for a person
    out = d.approve(qid)
    assert len(sender.sent) == 1
    mail = sender.sent[0]
    assert mail["to"] == "me@example.org" and mail["filename"] == f"Quote-{qid}.pdf"
    assert mail["pdf"].startswith(b"%PDF-")
    assert out["delivery"]["status"] == "delivered"


def test_rejected_quote_sends_nothing(tmp_path):
    sender = FakeSender({"me@example.org"})
    d = desk(tmp_path, sender, seed=False)
    qid = d.create(ASK, email="me@example.org")["id"]
    d.reject(qid, "too deep")
    assert sender.sent == []


def test_mail_failure_keeps_the_approval(tmp_path):
    class Broken(FakeSender):
        def send(self, *a, **k):
            raise OSError("smtp down")
    d = desk(tmp_path, Broken({"me@example.org"}), seed=False)
    qid = d.create(ASK, email="me@example.org")["id"]
    out = d.approve(qid)
    assert out["status"] == "sent" and out["delivery"]["status"] == "failed"


def test_pdf_endpoint(tmp_path):
    from fastapi.testclient import TestClient
    from quote_agent.api import create_app
    d = desk(tmp_path)
    client = TestClient(create_app(d, static_dir=tmp_path))
    r = client.get(f"/api/quotes/{d.list()['quotes'][0]['id']}/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert client.get("/api/meta").json()["email"]["enabled"] is False


def test_storefront_catalog_hides_cost_and_stock(tmp_path):
    from fastapi.testclient import TestClient
    from quote_agent.api import create_app
    client = TestClient(create_app(desk(tmp_path, seed=False), static_dir=tmp_path))
    products = client.get("/api/storefront/catalog").json()["products"]
    assert products and all(set(p) == {"sku", "name", "category", "list_price", "availability"} for p in products)
    assert {p["availability"] for p in products} >= {"in_stock", "out_of_stock"}


def test_picked_products_message(tmp_path):
    d = desk(tmp_path, seed=False)
    routine = d.create("Hi, I'd like a quote for:\n- 2 x PMP-100 Centrifugal pump 1HP\n- 10 x FIT-E05 Brass elbow 1/2 inch")
    assert routine["status"] == "auto_sent" and [l["sku"] for l in routine["quote"]["lines"]] == ["PMP-100", "FIT-E05"]
    out = d.create("Hi, I'd like a quote for:\n- 5 x VLV-100 Ball valve 1 inch brass")
    assert out["status"] == "needs_approval" and "Short stock" in out["reasons"]
