"""Demo.

Offline (no API key):   python -m quote_agent
Live with Claude:       ANTHROPIC_API_KEY=... python -m quote_agent --live "I need 3 one horsepower pumps and 200 half inch valves, can you do 15% off?"
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .erp import MockERP
from .graph import build_graph, resume_with_decision, run_until_gate
from .llm import AnthropicLLM, ScriptedLLM

HERE = Path(__file__).resolve().parent.parent
DEMO_LEAD = "Hi, this is Dana from Ridgeway Farms. I need 3 one horsepower pumps and 200 half inch valves. Can you do 15% off? Also 5 one inch valves."


def main(argv: list[str]) -> int:
    live = "--live" in argv
    args = [a for a in argv if a != "--live"]
    lead = " ".join(args) if args else DEMO_LEAD

    erp = MockERP(HERE / "fixtures" / "catalog.json")
    if live:
        llm = AnthropicLLM()
    else:
        llm = ScriptedLLM(
            extract={"customer_name": "Dana (Ridgeway Farms)", "items": [
                {"text": "one horsepower pump", "qty": 3, "requested_discount": 0.15},
                {"text": "half inch valve", "qty": 200, "requested_discount": 0.15},
                {"text": "one inch valve", "qty": 5, "requested_discount": 0.15},
            ]},
            draft="Hi Dana,\n\nQuote attached below. Note the 1 inch valves are out of stock right now.\n\nSales team",
        )

    graph = build_graph(erp, llm, HERE / "decisions.jsonl")
    state = run_until_gate(graph, lead, thread_id="demo-1")

    print("=== Priced quote (deterministic) ===")
    compact = {**state["quote"], "lines": [{k: v for k, v in l.items() if k not in ("trail", "flags")} for l in state["quote"]["lines"]]}
    print(json.dumps(compact, indent=2))   # the web app shows the full rule trail per line
    print("\n=== Why a manager must look at this ===")
    for r in state["needs_manager"] or ["(nothing, could auto-send)"]:
        print(" -", r)
    print("\n=== Draft email (model) ===")
    print(state["draft_email"])

    print("\nGraph is paused before `send`. Approve? [y/N] ", end="", flush=True)
    answer = sys.stdin.readline().strip().lower() if sys.stdin.isatty() else "n"
    final = resume_with_decision(graph, "demo-1", approved=answer == "y", note="cli demo")
    print("sent:", final["sent"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
