"""Deterministic pricing. No model calls in this file, on purpose.

Rules live here so a sales manager can read them, and so a test can prove them.
Everything is a pure function of (product, quantity, discount, rules): same inputs, same quote.
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


@dataclass(frozen=True)
class PricingRules:
    """The thresholds above as one value, so the web app can show them, edit them, and snapshot
    the exact rules a quote was priced with. The defaults are the module constants."""

    min_margin: float = MIN_MARGIN
    volume_tiers: tuple[tuple[int, float], ...] = tuple(VOLUME_TIERS)
    max_discount_without_approval: float = MAX_DISCOUNT_WITHOUT_APPROVAL

    def to_dict(self) -> dict:
        return {
            "min_margin": self.min_margin,
            "volume_tiers": [{"min_qty": q, "discount": d} for q, d in self.volume_tiers],
            "max_discount_without_approval": self.max_discount_without_approval,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PricingRules":
        """Validate and build. Raises ValueError with a message a manager can act on."""
        try:
            min_margin = float(data["min_margin"])
            max_disc = float(data["max_discount_without_approval"])
            tiers = [(int(t["min_qty"]), float(t["discount"])) for t in data["volume_tiers"]]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"rules are incomplete or not numeric: {exc}") from exc
        if not 0 <= min_margin <= 2:
            raise ValueError("margin floor must be between 0% and 200%")
        if not 0 <= max_disc <= 0.5:
            raise ValueError("discount limit must be between 0% and 50%")
        if len(tiers) > 6:
            raise ValueError("at most 6 volume tiers")
        if any(q < 2 for q, _ in tiers):
            raise ValueError("a volume tier must start at 2 units or more")
        if any(not 0 < d <= 0.5 for _, d in tiers):
            raise ValueError("a tier discount must be above 0% and at most 50%")
        if len({q for q, _ in tiers}) != len(tiers):
            raise ValueError("two tiers start at the same quantity")
        tiers.sort(key=lambda t: t[0], reverse=True)
        if any(a[1] <= b[1] for a, b in zip(tiers, tiers[1:])):
            raise ValueError("a bigger quantity must earn a bigger discount")
        return cls(min_margin=min_margin, volume_tiers=tuple(tiers), max_discount_without_approval=max_disc)


DEFAULT_RULES = PricingRules()


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
    # Context for the reviewer. None of it is needed to compute the price; it explains the price.
    cost: float = 0.0
    stock: int = 0
    floor_price: float = 0.0
    volume_discount: float = 0.0
    requested_discount: float = 0.0
    discount_override: float | None = None
    flags: list[str] = field(default_factory=list)   # discount_over_limit, short_stock, margin_clamped
    trail: list[dict] = field(default_factory=list)  # the rule trail, in the order the rules ran

    @property
    def total(self) -> float:
        return round(self.unit_price * self.qty, 2)


@dataclass
class PricedQuote:
    lines: list[QuoteLine]
    rejected: list[dict]           # items we could not price, with a reason
    needs_manager: list[str]       # reasons this quote must be approved by a human
    reasons: list[dict] = field(default_factory=list)  # the same reasons, structured: {code, sku, text}

    @property
    def total(self) -> float:
        return round(sum(l.total for l in self.lines), 2)

    @property
    def list_total(self) -> float:
        return round(sum(l.list_price * l.qty for l in self.lines), 2)


def volume_discount(qty: int, rules: PricingRules = DEFAULT_RULES) -> float:
    for min_qty, disc in rules.volume_tiers:
        if qty >= min_qty:
            return disc
    return 0.0


def _pct(x: float) -> str:
    return f"{x * 100:.1f}".rstrip("0").rstrip(".") + "%"


def price_line(
    product: Product,
    qty: int,
    requested_discount: float = 0.0,
    rules: PricingRules = DEFAULT_RULES,
    discount_override: float | None = None,
) -> QuoteLine:
    """Price one line. `discount_override` is a manager typing a discount in the review screen:
    it replaces the tier and the customer's ask, but the margin floor still wins."""
    requested_discount = min(max(requested_discount, 0.0), 1.0)
    vol = volume_discount(qty, rules)
    trail: list[dict] = [
        {"rule": "List price", "outcome": "info",
         "detail": f"${product.list_price:,.2f} from the catalog"},
    ]
    tier = next((q for q, _ in rules.volume_tiers if qty >= q), None)
    trail.append({"rule": "Volume tier", "outcome": "info",
                  "detail": f"{qty} units earns {_pct(vol)} (tier starts at {tier})" if tier
                  else f"{qty} units, below the first tier: 0%"})
    if discount_override is not None:
        disc = min(max(discount_override, 0.0), 1.0)
        trail.append({"rule": "Manager discount", "outcome": "info",
                      "detail": f"a manager set {_pct(disc)}, replacing the tier and the customer's ask"})
    else:
        disc = max(vol, requested_discount)
        if requested_discount > 0:
            trail.append({"rule": "Customer asked", "outcome": "info",
                          "detail": f"{_pct(requested_discount)} asked. Larger of tier and ask applies: {_pct(disc)}"})
    unit = round(product.list_price * (1 - disc), 2)
    floor = round(product.cost * (1 + rules.min_margin), 2)
    notes: list[str] = []
    flags: list[str] = []
    if unit < floor:
        notes.append(f"discount {disc:.0%} would breach {rules.min_margin:.0%} margin floor; clamped to {floor}")
        trail.append({"rule": "Margin floor", "outcome": "clamped",
                      "detail": f"{_pct(disc)} off gives ${unit:,.2f}, under the ${floor:,.2f} floor "
                                f"(cost plus {_pct(rules.min_margin)}). Price held at the floor"})
        flags.append("margin_clamped")
        unit = floor
        disc = round(1 - unit / product.list_price, 4)
    else:
        trail.append({"rule": "Margin floor", "outcome": "ok",
                      "detail": f"${unit:,.2f} is above the ${floor:,.2f} floor (cost plus {_pct(rules.min_margin)})"})
    margin = round((unit - product.cost) / product.cost, 4)
    in_stock = product.stock >= qty
    if not in_stock:
        notes.append(f"only {product.stock} in stock, requested {qty}")
        flags.append("short_stock")
        trail.append({"rule": "Stock check", "outcome": "flag",
                      "detail": f"{product.stock} on hand, {qty} requested. Needs a person"})
    else:
        trail.append({"rule": "Stock check", "outcome": "ok", "detail": f"{product.stock} on hand covers {qty}"})
    if disc > rules.max_discount_without_approval:
        flags.insert(0, "discount_over_limit")
        trail.append({"rule": "Discount limit", "outcome": "flag",
                      "detail": f"{_pct(disc)} is over the {_pct(rules.max_discount_without_approval)} limit. Needs a person"})
    else:
        trail.append({"rule": "Discount limit", "outcome": "ok",
                      "detail": f"{_pct(disc)} is within the {_pct(rules.max_discount_without_approval)} limit"})
    return QuoteLine(
        sku=product.sku, name=product.name, qty=qty, unit_price=unit,
        list_price=product.list_price, discount=disc, margin=margin,
        in_stock=in_stock, notes=notes, cost=product.cost, stock=product.stock, floor_price=floor,
        volume_discount=vol, requested_discount=requested_discount,
        discount_override=discount_override, flags=flags, trail=trail,
    )


def build_quote(items: list[dict], erp, rules: PricingRules = DEFAULT_RULES) -> PricedQuote:
    """items: [{"text": "1hp pump", "qty": 3, "requested_discount": 0.0}, ...]

    An item may carry "sku" (already resolved, used when a manager edits a line) and
    "discount_override" (a manager's discount)."""
    lines, rejected, needs_manager, reasons = [], [], [], []
    for item in items:
        try:
            qty = int(item.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            rejected.append({"item": item, "reason": "quantity missing or zero"})
            continue
        sku = item.get("sku") or erp.resolve_sku(item.get("text", ""))
        product = erp.get_product(sku) if sku else None
        if product is None:
            rejected.append({"item": item, "reason": "not in catalog"})
            continue
        override = item.get("discount_override")
        line = price_line(product, qty, float(item.get("requested_discount") or 0.0), rules,
                          None if override is None else float(override))
        lines.append(line)
        if line.discount > rules.max_discount_without_approval:
            text = f"{line.sku}: discount {line.discount:.0%} exceeds {rules.max_discount_without_approval:.0%}"
            needs_manager.append(text)
            reasons.append({"code": "discount_over_limit", "sku": line.sku, "text": text})
        if not line.in_stock:
            text = f"{line.sku}: short stock"
            needs_manager.append(text)
            reasons.append({"code": "short_stock", "sku": line.sku, "text": text})
    if rejected:
        text = f"{len(rejected)} item(s) could not be priced"
        needs_manager.append(text)
        reasons.append({"code": "unpriced_items", "sku": None, "text": text})
    if not lines and not rejected:
        # Nothing to quote is never something to send on its own.
        text = "no items found in the request"
        needs_manager.append(text)
        reasons.append({"code": "no_items", "sku": None, "text": text})
    return PricedQuote(lines=lines, rejected=rejected, needs_manager=needs_manager, reasons=reasons)
