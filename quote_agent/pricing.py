"""Deterministic pricing. No model calls in this file, on purpose.

Rules live here so a sales manager can read them, and so a test can prove them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .erp import Product

MIN_MARGIN = 0.20            # never quote below 20% margin on cost
VOLUME_TIERS = [             # (min_qty, discount off list price)
    (100, 0.12),
    (25, 0.07),
    (10, 0.03),
]
MAX_DISCOUNT_WITHOUT_APPROVAL = 0.10  # deeper discounts always go to a human


@dataclass
class QuoteLine:
    sku: str
    name: str
    qty: int
    unit_price: float
    list_price: float
    discount: float
    margin: float
    in_stock: bool
    notes: list[str] = field(default_factory=list)

    @property
    def total(self) -> float:
        return round(self.unit_price * self.qty, 2)


@dataclass
class PricedQuote:
    lines: list[QuoteLine]
    rejected: list[dict]           # items we could not price, with a reason
    needs_manager: list[str]       # reasons this quote must be approved by a human

    @property
    def total(self) -> float:
        return round(sum(l.total for l in self.lines), 2)


def volume_discount(qty: int) -> float:
    for min_qty, disc in VOLUME_TIERS:
        if qty >= min_qty:
            return disc
    return 0.0


def price_line(product: Product, qty: int, requested_discount: float = 0.0) -> QuoteLine:
    disc = max(volume_discount(qty), requested_discount)
    unit = round(product.list_price * (1 - disc), 2)
    floor = round(product.cost * (1 + MIN_MARGIN), 2)
    notes: list[str] = []
    if unit < floor:
        notes.append(f"discount {disc:.0%} would breach {MIN_MARGIN:.0%} margin floor; clamped to {floor}")
        unit = floor
        disc = round(1 - unit / product.list_price, 4)
    margin = round((unit - product.cost) / product.cost, 4)
    in_stock = product.stock >= qty
    if not in_stock:
        notes.append(f"only {product.stock} in stock, requested {qty}")
    return QuoteLine(
        sku=product.sku, name=product.name, qty=qty, unit_price=unit,
        list_price=product.list_price, discount=disc, margin=margin,
        in_stock=in_stock, notes=notes,
    )


def build_quote(items: list[dict], erp) -> PricedQuote:
    """items: [{"text": "1hp pump", "qty": 3, "requested_discount": 0.0}, ...]"""
    lines, rejected, needs_manager = [], [], []
    for item in items:
        qty = int(item.get("qty", 0))
        if qty <= 0:
            rejected.append({"item": item, "reason": "quantity missing or zero"})
            continue
        sku = erp.resolve_sku(item.get("text", ""))
        product = erp.get_product(sku) if sku else None
        if product is None:
            rejected.append({"item": item, "reason": "not in catalog"})
            continue
        line = price_line(product, qty, float(item.get("requested_discount", 0.0)))
        lines.append(line)
        if line.discount > MAX_DISCOUNT_WITHOUT_APPROVAL:
            needs_manager.append(f"{line.sku}: discount {line.discount:.0%} exceeds {MAX_DISCOUNT_WITHOUT_APPROVAL:.0%}")
        if not line.in_stock:
            needs_manager.append(f"{line.sku}: short stock")
    if rejected:
        needs_manager.append(f"{len(rejected)} item(s) could not be priced")
    return PricedQuote(lines=lines, rejected=rejected, needs_manager=needs_manager)
