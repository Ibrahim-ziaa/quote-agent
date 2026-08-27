from pathlib import Path

from quote_agent.erp import MockERP
from quote_agent.pricing import MIN_MARGIN, build_quote, price_line, volume_discount

ERP = MockERP(Path(__file__).parent.parent / "fixtures" / "catalog.json")


def test_volume_tiers():
    assert volume_discount(1) == 0.0
    assert volume_discount(10) == 0.03
    assert volume_discount(25) == 0.07
    assert volume_discount(100) == 0.12


def test_margin_floor_is_never_breached():
    p = ERP.get_product("VLV-050")  # cost 6.2, list 11.5
    line = price_line(p, qty=1, requested_discount=0.60)
    assert line.unit_price >= round(p.cost * (1 + MIN_MARGIN), 2)
    assert line.margin >= MIN_MARGIN - 1e-6
    assert any("margin floor" in n for n in line.notes)


def test_requested_discount_over_threshold_needs_manager():
    q = build_quote([{"text": "1hp pump", "qty": 1, "requested_discount": 0.15}], ERP)
    assert q.lines[0].discount == 0.15
    assert any("exceeds" in r for r in q.needs_manager)


def test_small_order_no_discount_can_auto_send():
    q = build_quote([{"text": "hose", "qty": 2}], ERP)
    assert q.needs_manager == []
    assert q.total == 158.0


def test_out_of_stock_flags_manager_and_unknown_item_is_rejected():
    q = build_quote([{"text": "one inch valve", "qty": 5}, {"text": "flux capacitor", "qty": 1}], ERP)
    assert not q.lines[0].in_stock
    assert q.rejected[0]["reason"] == "not in catalog"
    assert any("short stock" in r for r in q.needs_manager)
    assert any("could not be priced" in r for r in q.needs_manager)
