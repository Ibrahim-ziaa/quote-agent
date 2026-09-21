"""The offline stand-in for the model: simple, deterministic, and never near a price."""
from pathlib import Path

from quote_agent.erp import MockERP
from quote_agent.llm import DemoLLM

ERP = MockERP(Path(__file__).parent.parent / "fixtures" / "catalog.json")
LLM = DemoLLM()


def items(message):
    return [(i["qty"], ERP.resolve_sku(i["text"])) for i in LLM.extract(message)["items"]]


def test_sizes_are_not_mistaken_for_quantities():
    assert items("I need 3 one horsepower pumps and 200 half inch valves. Also 5 one inch valves.") == [
        (3, "PMP-100"), (200, "VLV-050"), (5, "VLV-100")]
    assert items("6 lengths of 20m hose, 12 pressure gauges 0-10 bar and a 2.5hp pump") == [
        (6, "HSE-020"), (12, "GAU-010"), (1, "PMP-250")]


def test_rfq_rows_with_skus():
    assert items("sku, description, qty\nVLV-B40, Butterfly valve 4 inch lug type, 24\nFLT-SED x 400\n4 x PMP-S75") == [
        (24, "VLV-B40"), (400, "FLT-SED"), (4, "PMP-S75")]


def test_discount_name_and_unknown_products():
    out = LLM.extract("This is Dana from Ridgeway Farms. 2 flux capacitor pumps please, can you do 15% off?")
    assert out["customer_name"] == "Dana (Ridgeway Farms)"
    assert out["items"][0]["requested_discount"] == 0.15
    assert ERP.resolve_sku(out["items"][0]["text"]) is None      # unknown stays unknown, no fuzzy guess


def test_missing_quantity_is_passed_through_as_zero_not_guessed():
    assert items("We need some 3/4 inch ball valves for an extension.") == [(0, "VLV-075")]


def test_most_specific_alias_wins():
    assert ERP.resolve_sku("2 inch suction hoses") == "HSE-S10"
    assert ERP.resolve_sku("1 inch check valves") == "VLV-C10"
    assert ERP.resolve_sku("3 inch gate valve") is None


def test_draft_uses_only_the_numbers_it_is_given():
    email = LLM.draft({"customer_name": "Dana (Ridgeway Farms)", "total": 89.25, "rejected": [], "lines": [
        {"sku": "VLV-100", "name": "Ball valve 1 inch brass", "qty": 5, "unit_price": 17.85, "discount": 0.15,
         "in_stock": False, "stock": 0, "notes": [], "total": 89.25}]})
    assert email.startswith("Hi Dana,") and "$17.85" in email and "$89.25" in email and "out of stock" in email
    assert email.rstrip().endswith("Sales team")
