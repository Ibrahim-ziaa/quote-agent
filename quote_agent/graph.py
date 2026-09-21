"""The LangGraph workflow.

lead -> extract (LLM) -> price (code) -> draft (LLM) -> approval gate (human) -> send -> log

The graph interrupts before `approval`. Nothing reaches the customer until a person resumes it.
With `auto_approve=True`, a quote that trips no pricing rule and that no person has edited skips
the gate through `auto_approve`; everything else waits. `send` re-checks `approved` either way.
Every run appends one line to decisions.jsonl with the full state, so a quote can be audited later.
"""
from __future__ import annotations

import json
import operator
import time
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Callable, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from . import llm as llm_mod
from .pricing import DEFAULT_RULES, PricingRules, build_quote

# What the drafting model is allowed to see. Cost, margin and the floor price stay inside the building.
CUSTOMER_SAFE_LINE_FIELDS = ("sku", "name", "qty", "unit_price", "list_price", "discount", "in_stock", "stock", "notes", "total")


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
    # Added for the web app. All optional, the CLI never sets them.
    request: dict               # id, source, customer, company, email, received_at
    rules: dict                 # snapshot of the pricing rules this quote was priced with
    human_edited: bool          # once a person changes a quote it can never auto send
    decided_by: str
    decided_at: float
    sent_at: float
    history: Annotated[list[dict], operator.add]   # who did what, in order (model, code, person)


def price_items(items: list[dict], erp, rules: PricingRules = DEFAULT_RULES) -> dict:
    """items -> the serialised quote the graph state carries. Pure: used by the `price` node and
    by the web app's live preview, so an edit on screen runs exactly the code that prices for real."""
    q = build_quote(items, erp, rules)
    return {
        "quote": {"lines": [asdict(l) | {"total": l.total} for l in q.lines],
                  "rejected": q.rejected, "total": q.total, "list_total": q.list_total,
                  "reasons": q.reasons},
        "needs_manager": q.needs_manager,
    }


def build_graph(
    erp,
    llm: llm_mod.LLM,
    decisions_path: str | Path = "decisions.jsonl",
    *,
    auto_approve: bool = False,
    rules: Callable[[], PricingRules] | None = None,
    mailer: Callable[[dict], None] | None = None,
    clock: Callable[[], float] = time.time,
):
    decisions_path = Path(decisions_path)
    current_rules = rules or (lambda: DEFAULT_RULES)

    def event(actor: str, what: str, detail: str = "") -> dict:
        return {"ts": clock(), "actor": actor, "event": what, "detail": detail}

    def extract(state: QuoteState) -> QuoteState:
        raw = llm.complete(llm_mod.EXTRACT_SYSTEM, state["lead_message"])
        data = llm_mod.parse_extract(raw)
        n = len(data["items"])
        return {"items": data["items"], "customer_name": data.get("customer_name"),
                "history": [event("model", "read_request", f"found {n} item{'s' if n != 1 else ''} in the message")]}

    def price(state: QuoteState) -> QuoteState:
        r = current_rules()
        priced = price_items(state["items"], erp, r)
        flags = len(priced["needs_manager"])
        detail = f"total ${priced['quote']['total']:,.2f}, " + ("held for approval" if flags else "no rule triggered")
        return {**priced, "rules": r.to_dict(), "history": [event("pricing code", "priced", detail)]}

    def draft(state: QuoteState) -> QuoteState:
        quote = state["quote"]
        safe = {
            "customer_name": state.get("customer_name"),
            "lines": [{k: l[k] for k in CUSTOMER_SAFE_LINE_FIELDS if k in l} for l in quote["lines"]],
            "rejected": quote["rejected"],
            "total": quote["total"],
        }
        return {"draft_email": llm.complete(llm_mod.DRAFT_SYSTEM, json.dumps(safe, indent=2)),
                "history": [event("model", "drafted_email", "wrote the customer email from the priced quote")]}

    def route(state: QuoteState) -> str:
        if auto_approve and not state.get("needs_manager") and not state.get("human_edited"):
            return "auto_approve"
        return "approval"

    def auto_approve_node(state: QuoteState) -> QuoteState:
        now = clock()
        return {"approved": True, "decided_by": "auto", "decided_at": now,
                "manager_note": "No pricing rule triggered, sent without review",
                "history": [{"ts": now, "actor": "policy", "event": "auto_approved", "detail": "no pricing rule triggered"}]}

    def approval(state: QuoteState) -> QuoteState:
        # The gate. The graph stops before this node and waits for a human to set `approved`.
        return {}

    def send(state: QuoteState) -> QuoteState:
        # Replace the mailer with the real email/CRM call. Approval is checked here too, not only at
        # the gate, so a bug in the gate cannot leak a quote.
        if not state.get("approved"):
            return {"sent": False}
        if mailer is not None:
            mailer(dict(state))
        now = clock()
        return {"sent": True, "sent_at": now,
                "history": [{"ts": now, "actor": "system", "event": "sent", "detail": "quote email sent to the customer"}]}

    def log(state: QuoteState) -> QuoteState:
        with decisions_path.open("a") as f:
            f.write(json.dumps({"ts": clock(), **state}) + "\n")
        return {}

    g = StateGraph(QuoteState)
    g.add_node("extract", extract)
    g.add_node("price", price)
    g.add_node("draft", draft)
    g.add_node("auto_approve", auto_approve_node)
    g.add_node("approval", approval)
    g.add_node("send", send)
    g.add_node("log", log)
    g.add_edge(START, "extract")
    g.add_edge("extract", "price")
    g.add_edge("price", "draft")
    g.add_conditional_edges("draft", route, ["auto_approve", "approval"])
    g.add_edge("auto_approve", "send")
    g.add_edge("approval", "send")
    g.add_edge("send", "log")
    g.add_edge("log", END)
    return g.compile(checkpointer=InMemorySaver(), interrupt_before=["approval"])


def _cfg(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def run_until_gate(graph, lead_message: str, thread_id: str, request: dict | None = None) -> QuoteState:
    """Run a new request. Returns the state at the gate, or the final state if it was auto approved."""
    initial: QuoteState = {"lead_message": lead_message, "approved": None}
    if request:
        initial["request"] = request
    graph.invoke(initial, _cfg(thread_id))
    return graph.get_state(_cfg(thread_id)).values


def is_waiting(graph, thread_id: str) -> bool:
    return "approval" in graph.get_state(_cfg(thread_id)).next


def reprice_with_items(graph, thread_id: str, items: list[dict], editor: str, clock: Callable[[], float] = time.time) -> QuoteState:
    """A person changed the lines. Feed the new items back in as if `extract` had produced them,
    so `price` and `draft` run again for real, and stop at the gate again."""
    if not is_waiting(graph, thread_id):
        raise ValueError("quote is not waiting for approval")
    graph.update_state(_cfg(thread_id), {
        "items": items, "human_edited": True,
        "history": [{"ts": clock(), "actor": editor, "event": "edited_quote", "detail": "changed the quote lines, pricing re-run"}],
    }, as_node="extract")
    graph.invoke(None, _cfg(thread_id))
    return graph.get_state(_cfg(thread_id)).values


def update_email(graph, thread_id: str, text: str, editor: str, clock: Callable[[], float] = time.time) -> QuoteState:
    if not is_waiting(graph, thread_id):
        raise ValueError("quote is not waiting for approval")
    graph.update_state(_cfg(thread_id), {
        "draft_email": text, "human_edited": True,
        "history": [{"ts": clock(), "actor": editor, "event": "edited_email", "detail": "edited the email wording"}],
    }, as_node="draft")
    return graph.get_state(_cfg(thread_id)).values


def resume_with_decision(graph, thread_id: str, approved: bool, note: str = "", decided_by: str = "",
                         clock: Callable[[], float] = time.time) -> QuoteState:
    cfg = _cfg(thread_id)
    now = clock()
    update: QuoteState = {"approved": approved, "manager_note": note}
    if decided_by:
        update |= {"decided_by": decided_by, "decided_at": now,
                   "history": [{"ts": now, "actor": decided_by, "event": "approved" if approved else "rejected", "detail": note}]}
    graph.update_state(cfg, update, as_node="draft")
    graph.invoke(None, cfg)
    return graph.get_state(cfg).values
