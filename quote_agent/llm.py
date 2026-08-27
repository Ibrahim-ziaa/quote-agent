"""The only two places a model is called: extracting the request, and drafting the customer email.

Everything else is code. Tests use ScriptedLLM so they run without an API key.
"""
from __future__ import annotations

import json
import os
from typing import Protocol

EXTRACT_SYSTEM = """You turn a customer's message into a JSON list of requested items.
Return ONLY JSON: {"items": [{"text": "<product as the customer wrote it>", "qty": <int>, "requested_discount": <0.0-1.0>}], "customer_name": "<name or null>"}
If a quantity is missing use 0. If no discount was asked for use 0.0. Never invent products."""

DRAFT_SYSTEM = """You write a short, plain quote email for a distributor's sales team.
Use the exact prices and quantities given. Do not add products, discounts, or promises that are not in the data.
Mention out-of-stock lines honestly with the available quantity. No marketing language. Sign as 'Sales team'."""


class LLM(Protocol):
    def complete(self, system: str, user: str) -> str: ...


class AnthropicLLM:
    def __init__(self, model: str | None = None):
        import anthropic  # imported here so tests never need the SDK configured

        self._client = anthropic.Anthropic()
        self._model = model or os.environ.get("QUOTE_AGENT_MODEL", "claude-sonnet-5")

    def complete(self, system: str, user: str) -> str:
        msg = self._client.messages.create(
            model=self._model, max_tokens=800, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


class ScriptedLLM:
    """Returns canned answers. Used in tests and in the offline demo."""

    def __init__(self, extract: dict | None = None, draft: str | None = None):
        self._extract = extract
        self._draft = draft

    def complete(self, system: str, user: str) -> str:
        if system == EXTRACT_SYSTEM:
            return json.dumps(self._extract or {"items": [], "customer_name": None})
        return self._draft or "Hello,\n\nPlease find your quote below.\n\nSales team"


def parse_extract(raw: str) -> dict:
    """Models sometimes wrap JSON in prose or fences. Be tolerant, but fail loudly if there is no JSON."""
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output: {raw[:200]!r}")
    data = json.loads(raw[start : end + 1])
    data.setdefault("items", [])
    data.setdefault("customer_name", None)
    return data
