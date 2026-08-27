# quote-agent

A lead-to-quote agent that a sales team can actually trust: the model reads the customer's message and writes the email, code does the pricing, and a human approves before anything is sent.

```
lead message ──▶ extract (LLM) ──▶ price (code) ──▶ draft (LLM) ──▶ ⏸ approval gate ──▶ send ──▶ log
```

## Why it is built this way

Most "AI quoting" demos let the model invent prices. This one does not. The split is deliberate:

| Step | Who does it | Why |
|---|---|---|
| Understand the request | Model | Free text is what models are for |
| Resolve products, check stock | Code (ERP) | The ERP is the source of truth |
| Price, discounts, margin floor | Code | Rules must be readable and testable (`pricing.py`) |
| Write the customer email | Model | Given exact numbers, it only phrases them |
| Decide to send | Human | Anything over a 10% discount, short stock, or an unpriceable item stops here |

The graph is a LangGraph `StateGraph` compiled with `interrupt_before=["send"]`. It pauses, a person sets `approved`, and only then does `send` run. `send` re-checks `approved` itself, so a bug in the gate cannot leak a quote. Every run appends the full state to `decisions.jsonl` for audit.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m quote_agent                      # offline demo, scripted model, no API key
ANTHROPIC_API_KEY=... python -m quote_agent --live "I need 3 one horsepower pumps and 200 half inch valves, can you do 15% off?"
pytest                                     # 9 tests, no network
```

Offline demo output (abridged):

```
=== Why a manager must look at this ===
 - PMP-100: discount 15% exceeds 10%
 - VLV-050: discount 15% exceeds 10%
 - VLV-100: short stock
Graph is paused before `send`. Approve? [y/N]
```

## Swap in a real ERP

`MockERP` reads `fixtures/catalog.json`. Implement `resolve_sku(text)` and `get_product(sku)` against Odoo, NetSuite, or whatever you run, and pass it to `build_graph`. Nothing else changes.

## Layout

```
quote_agent/
  erp.py       mock ERP + the interface a real one must satisfy
  pricing.py   volume tiers, margin floor, approval thresholds (pure functions)
  llm.py       the two prompts, Anthropic client, scripted stand-in for tests
  graph.py     LangGraph nodes, the interrupt, decision log
  __main__.py  CLI demo
tests/         pricing rules and the gate behaviour
```

MIT.
