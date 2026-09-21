"""The only two places a model is called: extracting the request, and drafting the customer email.

Everything else is code. Tests use ScriptedLLM so they run without an API key.
"""
from __future__ import annotations

import json
import os
import re
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


class DemoLLM:
    """Offline stand-in for the model, used by the web demo so it runs with no API key.

    It is deliberately simple and deterministic: split the message into phrases, find a quantity
    and a product-like noun in each, find one asked-for discount. It knows nothing about the
    catalog or about prices. Like the real model it only reads the request and words the email;
    resolving products and every number in the quote is still done by erp.py and pricing.py.
    """

    _NUMBER_WORDS = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
        "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "dozen": 12, "twenty": 20, "fifty": 50,
    }
    _UNIT = r"(?:\"|inch|inches|in\b|hp\b|horsepower|horse power|m\b|mm\b|metre|meter|bar\b|psi\b|v\b|volt|%|percent)"
    _PRODUCT_NOUNS = (
        "pump", "valve", "fitting", "elbow", "tee", "coupling", "union", "nipple", "reducer", "bushing",
        "camlock", "clamp", "hose", "filter", "cartridge", "housing", "strainer", "gauge", "switch",
        "seal", "tape", "gasket", "flange", "drive", "motor", "tank", "meter", "actuator", "prv",
        "regulator", "submersible",
    )
    _SKU = re.compile(r"\b[A-Z]{2,4}-[A-Z0-9]{2,4}\b")

    def complete(self, system: str, user: str) -> str:
        if system == EXTRACT_SYSTEM:
            return json.dumps(self.extract(user))
        return self.draft(json.loads(user))

    # ---- reading the request -------------------------------------------------------------
    def extract(self, message: str) -> dict:
        discount = self._discount(message)
        items = []
        for phrase in self._phrases(message):
            qty, rest = self._quantity(phrase)
            sku = self._SKU.search(phrase)
            text = sku.group(0) if sku else self._clean(rest)
            lowered, lowered_phrase = text.lower(), phrase.lower()
            is_product = self._SKU.search(phrase) or any(n in lowered for n in self._PRODUCT_NOUNS)
            if not is_product or not text:
                continue
            if qty is None and not re.search(r"\b(?:need|quote|price|pricing|send|supply|require)\b.*\b(?:" + "|".join(self._PRODUCT_NOUNS) + ")", lowered_phrase):
                continue   # no count and no clear ask: a passing mention, not a line item
            items.append({"text": text, "qty": qty or 0, "requested_discount": discount})
        return {"customer_name": self._name(message), "items": items}

    @classmethod
    def _phrases(cls, message: str) -> list[str]:
        text = re.sub(r"(\d),(\d{3})\b", r"\1\2", message)
        parts: list[str] = []
        for line in text.splitlines():
            if cls._SKU.search(line):      # an RFQ row such as "VLV-B40, Butterfly valve 4 inch, 24" stays whole
                parts.append(line)
            else:
                parts += re.split(r";|,\s|\.\s|\s+and\s+|\s+plus\s+|\balso\b|\s+as well as\s+|\?|!|:\s", line)
        return [p.strip(" .-*\t") for p in parts if p and p.strip(" .-*\t")]

    def _quantity(self, phrase: str) -> tuple[int | None, str]:
        """First number in the phrase that is a count, not a size (so '5 one inch valves' is 5,
        and the 1 in '1 inch' or the 20 in '20m hose' is never a quantity)."""
        sku = self._SKU.search(phrase)
        number = re.compile(
            r"(?<![\w./-])(\d+|" + "|".join(self._NUMBER_WORDS) + r")\b(?![./-]\d)(?!\s*" + self._UNIT + r")",
            re.IGNORECASE,
        )
        for m in number.finditer(phrase):
            if sku and sku.start() <= m.start() < sku.end():
                continue
            if re.match(r"\s*(?:to|-)\s*\d", phrase[m.end():]):   # a range such as 0 to 10 bar
                continue
            if re.search(r"(?:\bpo|\border|\bref|\brfq|#|\bno\.?|\bby|\bbefore|\bunit|\bsuite|\bline)\s*$", phrase[: m.start()], re.IGNORECASE):
                continue
            raw = m.group(1).lower()
            qty = int(raw) if raw.isdigit() else self._NUMBER_WORDS[raw]
            rest = phrase[: m.start()] + " " + phrase[m.end():] if sku else phrase[m.end():]
            return qty, rest
        nouns = "|".join(self._PRODUCT_NOUNS)   # "a 2.5hp pump" is one pump, "for an extension" is not
        m = re.search(r"\b(?:a|an)\s+(?=(?:\S+\s+){0,4}?\S*(?:" + nouns + "))", phrase, re.IGNORECASE)
        if m:
            return 1, phrase[m.end():]
        return None, phrase

    @staticmethod
    def _clean(text: str) -> str:
        t = re.split(r"\s+(?:for|to go|delivered|by|before|if|please|asap|at|can you|could you|would|we|i|that|which)\b", text.strip(), maxsplit=1, flags=re.IGNORECASE)[0]
        t = re.sub(r"^.*?\b(?:need|quote|price|pricing on|pricing for|send|supply|order|require|want|like)\b(?:\s+(?:me|us|for|on))?\s+", "", t, flags=re.IGNORECASE)
        t = re.sub(r"^\s*(?:x|pcs|pc|pieces|units|unit|off|of|no\.?|qty|each|lengths of|rolls of|boxes of)\b[\s:.]*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"^\s*(?:of\s+)?(?:the|your|those|some|any)\s+", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*\b(?:x|qty)\s*$", "", t, flags=re.IGNORECASE)
        return t.strip(" ,.-:")

    @staticmethod
    def _discount(message: str) -> float:
        m = re.search(r"(\d{1,2}(?:\.\d)?)\s*(?:%|percent|per cent)\s*(?:off|discount|reduction)", message, re.IGNORECASE) \
            or re.search(r"(?:discount|off|reduction)\s*(?:of|at)?\s*(\d{1,2}(?:\.\d)?)\s*(?:%|percent)", message, re.IGNORECASE)
        return round(float(m.group(1)) / 100, 4) if m else 0.0

    @staticmethod
    def _name(message: str) -> str | None:
        m = re.search(r"\b(?i:this is|my name is|it's|i am|i'm)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\s+(?:from|at|with)\s+([A-Z][\w&']+(?:\s[A-Z][\w&']+){0,3}))?", message)
        if m:
            return f"{m.group(1)} ({m.group(2)})" if m.group(2) else m.group(1)
        m = re.search(r"(?:regards|thanks|thank you|cheers|best)[,!.]*\s*\n+\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*(?:\n|$)", message, re.IGNORECASE)
        return m.group(1) if m else None

    # ---- wording the email ---------------------------------------------------------------
    @staticmethod
    def draft(quote: dict) -> str:
        """Phrase the numbers it is given. It never computes or changes one."""
        name = (quote.get("customer_name") or "").split(" (")[0].split(" ")[0]
        out = [f"Hi {name}," if name else "Hello,", ""]
        lines = quote.get("lines", [])
        if lines:
            out += ["Thanks for your request. Here is your quote:", ""]
            for l in lines:
                pct = f"{l['discount'] * 100:.1f}".rstrip("0").rstrip(".")
                off = f", {pct}% off list" if l["discount"] > 0 else ""
                out += [f"{l['qty']} x {l['name']} ({l['sku']})", f"    ${l['unit_price']:,.2f} each{off}: ${l['total']:,.2f}"]
            out += ["", f"Quote total: ${quote.get('total', 0):,.2f}", ""]
        else:
            out += ["Thanks for your request. We could not price it as written, details below.", ""]
        for l in lines:
            if not l.get("in_stock", True):
                if l.get("stock", 0) > 0:
                    out.append(f"Stock: we have {l['stock']} of {l['name']} on hand against the {l['qty']} you asked for. "
                               "We can ship what is here and confirm a date for the balance.")
                else:
                    out.append(f"Stock: {l['name']} is out of stock right now. We will confirm a delivery date before you commit.")
            if any("margin floor" in n for n in l.get("notes", [])):
                pct = f"{l['discount'] * 100:.1f}".rstrip("0").rstrip(".")
                out.append(f"Discount: {pct}% is the best we can do on {l['name']}.")
        for r in quote.get("rejected", []):
            asked = r["item"].get("text", "an item")
            why = "we need a quantity to price it" if "quantity" in r["reason"] else "it is not in our catalog, so it is not on this quote"
            out.append(f"Not priced: \"{asked}\", {why}.")
        if out[-1] != "":
            out.append("")
        out += ["Reply to this email to confirm and we will raise the order.", "", "Sales team"]
        return "\n".join(out)


def parse_extract(raw: str) -> dict:
    """Models sometimes wrap JSON in prose or fences. Be tolerant, but fail loudly if there is no JSON."""
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output: {raw[:200]!r}")
    data = json.loads(raw[start : end + 1])
    data.setdefault("items", [])
    data.setdefault("customer_name", None)
    return data
