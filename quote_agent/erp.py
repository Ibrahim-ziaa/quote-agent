"""A mock ERP. Swap this for a real one (Odoo, NetSuite, SAP) by implementing the same two methods."""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    cost: float
    list_price: float
    stock: int
    category: str = ""


_WORD_SIZES = {
    "half inch": "1/2 inch", "three quarter inch": "3/4 inch", "one inch": "1 inch",
    "two inch": "2 inch", "four inch": "4 inch", "ten inch": "10 inch",
    "one hp": "1hp", "five hp": "5hp",
}


def normalise(text: str) -> str:
    """Lower case, unify the ways people write sizes (1/2", half inch, 1 HP, one horsepower)
    and drop simple plurals, so 'Half inch valves' and '1/2" valve' compare equal."""
    t = text.lower().replace("½", "1/2").replace("¾", "3/4")
    t = re.sub(r"horse\s?power", "hp", t)
    t = re.sub(r"(\d)\s*(?:\"|”|-\s?inch\b|inches\b)", r"\1 inch", t)
    t = re.sub(r"(\d)\s+hp\b", r"\1hp", t)
    t = re.sub(r"(\d)\s+(m|mm|bar)\b", r"\1\2", t)
    t = re.sub(r"[^a-z0-9/. ]+", " ", t)
    t = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", t)   # keep 2.5hp, drop sentence stops
    t = re.sub(r"\s+", " ", t).strip()
    for words, size in _WORD_SIZES.items():
        t = t.replace(words, size)
    return " ".join(_singular(w) for w in t.split())


def _singular(word: str) -> str:
    if len(word) > 3 and word.endswith(("ches", "shes", "xes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


class MockERP:
    def __init__(self, catalog_path: str | Path):
        data = json.loads(Path(catalog_path).read_text())
        self._products = {p["sku"]: Product(**p) for p in data["products"]}
        self._aliases = {normalise(k): v for k, v in data.get("aliases", {}).items()}
        self._alias_tokens = [(frozenset(a.split()), a, sku) for a, sku in self._aliases.items()]

    def resolve_sku(self, text: str) -> str | None:
        """Map free text to a SKU. Exact SKU first, then the alias table. Returns None if unknown.

        An alias matches when every word of it appears in the text; the most specific alias wins,
        so 'suction hose' beats 'hose'. No fuzzy guessing: an unknown product stays unknown."""
        raw = text.strip()
        if raw.upper() in self._products:
            return raw.upper()
        for token in re.findall(r"[A-Za-z]{2,4}-[A-Za-z0-9]{2,4}", raw):
            if token.upper() in self._products:
                return token.upper()
        t = normalise(raw)
        if t in self._aliases:
            return self._aliases[t]
        words = set(t.split())
        matches = [(len(tokens), len(alias), sku) for tokens, alias, sku in self._alias_tokens if tokens <= words]
        return max(matches)[2] if matches else None

    def get_product(self, sku: str) -> Product | None:
        return self._products.get(sku)

    def list_products(self) -> list[dict]:
        return [asdict(p) for p in self._products.values()]
