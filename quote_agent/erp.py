"""A mock ERP. Swap this for a real one (Odoo, NetSuite, SAP) by implementing the same two methods."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    cost: float
    list_price: float
    stock: int


class MockERP:
    def __init__(self, catalog_path: str | Path):
        data = json.loads(Path(catalog_path).read_text())
        self._products = {p["sku"]: Product(**p) for p in data["products"]}
        self._aliases = {k.lower(): v for k, v in data.get("aliases", {}).items()}

    def resolve_sku(self, text: str) -> str | None:
        """Map free text to a SKU. Exact SKU first, then alias table. Returns None if unknown."""
        t = text.strip().lower()
        if t.upper() in self._products:
            return t.upper()
        if t in self._aliases:
            return self._aliases[t]
        for alias, sku in self._aliases.items():
            if alias in t:
                return sku
        return None

    def get_product(self, sku: str) -> Product | None:
        return self._products.get(sku)
