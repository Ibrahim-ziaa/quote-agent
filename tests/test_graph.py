import json
from pathlib import Path

from quote_agent.erp import MockERP
from quote_agent.graph import build_graph, resume_with_decision, run_until_gate
from quote_agent.llm import ScriptedLLM, parse_extract

ROOT = Path(__file__).parent.parent


def make_graph(tmp_path):
    erp = MockERP(ROOT / "fixtures" / "catalog.json")
    llm = ScriptedLLM(extract={"customer_name": "Test", "items": [{"text": "hose", "qty": 12}]})
    return build_graph(erp, llm, tmp_path / "decisions.jsonl"), tmp_path / "decisions.jsonl"


def test_graph_pauses_before_send_and_nothing_is_sent(tmp_path):
    graph, _ = make_graph(tmp_path)
    state = run_until_gate(graph, "12 hoses please", thread_id="t1")
    assert "draft_email" in state
    assert state.get("sent") is None  # send has not run


def test_rejection_never_sends_but_is_logged(tmp_path):
    graph, log = make_graph(tmp_path)
    run_until_gate(graph, "12 hoses please", thread_id="t2")
    final = resume_with_decision(graph, "t2", approved=False, note="price too low")
    assert final["sent"] is False
    rec = json.loads(log.read_text().splitlines()[-1])
    assert rec["manager_note"] == "price too low" and rec["sent"] is False


def test_approval_sends(tmp_path):
    graph, _ = make_graph(tmp_path)
    run_until_gate(graph, "12 hoses please", thread_id="t3")
    final = resume_with_decision(graph, "t3", approved=True)
    assert final["sent"] is True
    assert final["quote"]["lines"][0]["discount"] == 0.03  # 12 units -> 3% tier


def test_parse_extract_tolerates_prose_and_fences():
    raw = 'Sure! ```json\n{"items": [{"text": "hose", "qty": 1}]}\n```'
    assert parse_extract(raw)["items"][0]["qty"] == 1
