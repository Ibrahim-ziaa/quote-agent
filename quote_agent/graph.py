"""The LangGraph workflow.

lead -> extract (LLM) -> price (code) -> draft (LLM) -> approval gate (human) -> send

The graph interrupts before `send`. Nothing reaches the customer until a person resumes it.
Every run appends one line to decisions.jsonl with the full state, so a quote can be audited later.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from . import llm as llm_mod
from .pricing import build_quote


class QuoteState(TypedDict, total=False):
    lead_message: str
    customer_name: str | None
    items: list[dict]
    quote: dict                 # serialised PricedQuote
    needs_manager: list[str]
    draft_email: str
    approved: bool | None
    manager_note: str
    sent: bool


def build_graph(erp, llm: llm_mod.LLM, decisions_path: str | Path = "decisions.jsonl"):
    decisions_path = Path(decisions_path)

    def extract(state: QuoteState) -> QuoteState:
        raw = llm.complete(llm_mod.EXTRACT_SYSTEM, state["lead_message"])
        data = llm_mod.parse_extract(raw)
        return {"items": data["items"], "customer_name": data.get("customer_name")}

    def price(state: QuoteState) -> QuoteState:
        q = build_quote(state["items"], erp)
        return {
            "quote": {"lines": [asdict(l) | {"total": l.total} for l in q.lines],
                      "rejected": q.rejected, "total": q.total},
            "needs_manager": q.needs_manager,
        }

    def draft(state: QuoteState) -> QuoteState:
        payload = json.dumps({"customer_name": state.get("customer_name"), **state["quote"]}, indent=2)
        return {"draft_email": llm.complete(llm_mod.DRAFT_SYSTEM, payload)}

    def send(state: QuoteState) -> QuoteState:
        # Replace with the real email/CRM call. Approval is checked here too, not only at the gate,
        # so a bug in the gate cannot leak a quote.
        if not state.get("approved"):
            return {"sent": False}
        return {"sent": True}

    def log(state: QuoteState) -> QuoteState:
        with decisions_path.open("a") as f:
            f.write(json.dumps({"ts": time.time(), **state}) + "\n")
        return {}

    g = StateGraph(QuoteState)
    g.add_node("extract", extract)
    g.add_node("price", price)
    g.add_node("draft", draft)
    g.add_node("send", send)
    g.add_node("log", log)
    g.add_edge(START, "extract")
    g.add_edge("extract", "price")
    g.add_edge("price", "draft")
    g.add_edge("draft", "send")
    g.add_edge("send", "log")
    g.add_edge("log", END)
    # The gate: the graph stops before `send` and waits for a human to set `approved`.
    return g.compile(checkpointer=InMemorySaver(), interrupt_before=["send"])


def run_until_gate(graph, lead_message: str, thread_id: str) -> QuoteState:
    cfg = {"configurable": {"thread_id": thread_id}}
    graph.invoke({"lead_message": lead_message, "approved": None}, cfg)
    return graph.get_state(cfg).values


def resume_with_decision(graph, thread_id: str, approved: bool, note: str = "") -> QuoteState:
    cfg = {"configurable": {"thread_id": thread_id}}
    graph.update_state(cfg, {"approved": approved, "manager_note": note})
    graph.invoke(None, cfg)
    return graph.get_state(cfg).values
