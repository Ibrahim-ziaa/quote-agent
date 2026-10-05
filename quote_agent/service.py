"""Quote Desk: the approval inbox on top of the graph.

This layer owns no pricing and no send logic. It starts graph runs, reads their state back,
and turns a manager's clicks into graph updates. The state of every quote lives in the graph's
checkpointer; the audit trail is the same decisions.jsonl the CLI writes.
"""
from __future__ import annotations

import json
import os
import statistics
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import graph as graph_mod
from .erp import MockERP
from .llm import DemoLLM
from .pdf import render_quote_pdf
from .pricing import DEFAULT_RULES, PricingRules

# Where fixtures/, web/dist and data/ live. The repo root by default; the Docker image sets it to /app.
ROOT = Path(os.environ.get("QUOTE_DESK_ROOT") or Path(__file__).resolve().parent.parent)
SOURCES = ("web_form", "email", "rfq_upload")
REASON_LABELS = {
    "discount_over_limit": "Discount over limit",
    "short_stock": "Short stock",
    "unpriced_items": "Item could not be priced",
    "no_items": "No items found",
}


class NotFound(Exception):
    pass


class Conflict(Exception):
    """The action does not apply to the quote's current status."""


class Clock:
    """Real time plus an optional fixed offset, except while seeding, when the demo replays a week
    of requests. The demo uses the offset so that "now" is mid afternoon on a working day whenever
    you start it, which keeps the seeded week reading like a working week."""

    def __init__(self, offset: float = 0.0) -> None:
        self._frozen: float | None = None
        self.offset = offset

    def set(self, ts: float | None) -> None:
        self._frozen = ts

    def __call__(self) -> float:
        if self._frozen is None:
            return time.time() + self.offset
        self._frozen += 1.7   # each step of a replayed run takes a moment
        return self._frozen


def demo_clock_offset(real_now: float | None = None) -> float:
    """Seconds to add to real time so the demo's now is 14:20 on the most recent weekday."""
    real = datetime.fromtimestamp(real_now if real_now is not None else time.time())
    day = real
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return (day.replace(hour=14, minute=20, second=0, microsecond=0) - real).total_seconds()


def business_days_before(now: float, days: int, at: str) -> float:
    day = datetime.fromtimestamp(now)
    while days > 0:
        day -= timedelta(days=1)
        if day.weekday() < 5:
            days -= 1
    hour, minute = (int(x) for x in at.split(":"))
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp()


class _SwitchableLLM:
    def __init__(self, target) -> None:
        self.target = target

    def complete(self, system: str, user: str) -> str:
        return self.target.complete(system, user)


class QuoteDesk:
    def __init__(self, catalog_path: Path | None = None, decisions_path: Path | None = None,
                 seed_path: Path | None = None, user: str = "Marta Kowalski", live_llm=None,
                 demo_clock: bool = False, email_sender=None) -> None:
        self.catalog_path = Path(catalog_path or ROOT / "fixtures" / "catalog.json")
        self.decisions_path = Path(decisions_path or ROOT / "data" / "decisions.demo.jsonl")
        self.seed_path = seed_path
        self.user = user
        self.live_llm = live_llm
        self.demo_clock = demo_clock
        self.email_sender = email_sender   # mailer.SmtpMailer or None: None records the email, sends nothing
        self._lock = threading.RLock()
        self.reset()

    # ---- lifecycle -------------------------------------------------------------------------
    def reset(self) -> None:
        with self._lock:
            self.erp = MockERP(self.catalog_path)
            self.rules: PricingRules = DEFAULT_RULES
            self.rules_changed: dict | None = None
            self.clock = Clock(demo_clock_offset() if self.demo_clock else 0.0)
            self.outbox: list[dict] = []
            self.deliveries: dict[str, dict] = {}
            self._ids: list[str] = []
            self._next = 1001
            self.decisions_path.parent.mkdir(parents=True, exist_ok=True)
            self.decisions_path.write_text("")
            self._llm = _SwitchableLLM(DemoLLM())
            self.graph = graph_mod.build_graph(
                self.erp, self._llm, self.decisions_path, auto_approve=True,
                rules=lambda: self.rules, mailer=self._mail, clock=self.clock,
            )
            if self.seed_path:
                self._seed(json.loads(Path(self.seed_path).read_text()))
            if self.live_llm is not None:     # seeding never spends money: live applies to new requests only
                self._llm.target = self.live_llm

    @property
    def mode(self) -> str:
        return "live" if self.live_llm is not None else "demo"

    def _mail(self, state: dict) -> None:
        """Called by the graph's send node, after approval. Records exactly what goes out, and emails it
        with the quote PDF attached when a real sender is configured and the address is on its allowlist."""
        req = state.get("request", {})
        qid, to = req.get("id"), req.get("email")
        subject = f"Quote {qid} from Calder Bay Industrial Supply"
        entry = {"request_id": qid, "to": to, "subject": subject, "body": state.get("draft_email"),
                 "total": state.get("quote", {}).get("total"), "ts": self.clock(), "pdf": f"Quote-{qid}.pdf"}
        sender = self.email_sender
        if sender is None:
            entry["delivery"] = {"status": "recorded", "detail": "Email sending is off, the email and PDF are recorded here"}
        elif not sender.allowed(to):
            entry["delivery"] = {"status": "not_on_allowlist", "detail": f"{to or 'No address'} is not on the send allowlist, nothing left the app"}
        else:
            try:
                pdf = render_quote_pdf(self._pdf_fields(qid, state, "sent"), self.clock())
                sender.send(to, subject, state.get("draft_email", ""), pdf, entry["pdf"])
                entry["delivery"] = {"status": "delivered", "detail": f"Emailed to {to} with {entry['pdf']} attached"}
            except Exception as exc:   # a mail failure must not lose the approval; it is shown on the quote
                entry["delivery"] = {"status": "failed", "detail": f"Email to {to} failed: {exc}"}
        self.outbox.append(entry)
        self.deliveries[qid] = entry["delivery"] | {"to": to, "ts": entry["ts"], "pdf": entry["pdf"]}

    @staticmethod
    def _pdf_fields(qid: str, state: dict, status: str) -> dict:
        req = state.get("request", {})
        return {"id": qid, "customer": req.get("customer") or state.get("customer_name"), "company": req.get("company"),
                "email": req.get("email"), "received_at": req.get("received_at"), "status": status,
                "decided_by": state.get("decided_by"), "decided_at": state.get("decided_at"), "quote": state.get("quote", {})}

    def pdf(self, qid: str) -> bytes:
        """The customer quote PDF as it stands now: a draft while waiting, the issued quote once sent."""
        with self._lock:
            state = self._state(qid)
            status = self._status(qid, state)
            if not state.get("quote", {}).get("lines"):
                raise Conflict(f"{qid} has nothing priced, there is no quote to print")
            return render_quote_pdf(self._pdf_fields(qid, state, status), self.clock())

    def _seed(self, seed: dict) -> None:
        now = self.clock()
        for row in seed["requests"]:
            if "age_minutes" in row:
                row["_received"] = now - row["age_minutes"] * 60
            else:
                row["_received"] = business_days_before(now, row["business_days_ago"], row["at"])
                if row["_received"] > now - 3600:   # real clock, early in the day: nothing arrives in the future
                    row["_received"] = business_days_before(now, row["business_days_ago"] + 1, row["at"])
        for row in sorted(seed["requests"], key=lambda r: r["_received"]):
            received = row["_received"]
            self.clock.set(received)
            qid = self._create(row["message"], row["source"], row.get("customer"), row.get("company"),
                               row.get("email"), received, row.get("attachment"))
            decision = row.get("decision")
            if decision and graph_mod.is_waiting(self.graph, qid):
                at = received + decision["after_minutes"] * 60
                if at >= now:
                    continue
                self.clock.set(at)
                if decision.get("edit"):
                    self.edit(qid, decision["edit"]["lines"], decision["edit"].get("unpriced", []), by=decision["by"])
                if decision["action"] == "approve":
                    self.approve(qid, decision.get("note", ""), by=decision["by"])
                else:
                    self.reject(qid, decision["note"], by=decision["by"])
        self.clock.set(None)

    # ---- reading ---------------------------------------------------------------------------
    def _state(self, qid: str) -> dict:
        if qid not in self._ids:
            raise NotFound(qid)
        return self.graph.get_state({"configurable": {"thread_id": qid}}).values

    def _status(self, qid: str, state: dict) -> str:
        if graph_mod.is_waiting(self.graph, qid):
            return "needs_approval"
        if state.get("sent"):
            return "auto_sent" if state.get("decided_by") == "auto" else "sent"
        return "rejected"

    def summary(self, qid: str) -> dict:
        s = self._state(qid)
        req, quote = s.get("request", {}), s.get("quote", {})
        lines = quote.get("lines", [])
        parts = [f"{l['qty']} x {l['name']}" for l in lines] + [
            (f"{r['item']['qty']} x " if r["item"].get("qty") else "") + f"{r['item'].get('text') or 'item'} (not priced)"
            for r in quote.get("rejected", [])]
        codes = list(dict.fromkeys(r["code"] for r in quote.get("reasons", [])))
        return {
            "id": qid, "status": self._status(qid, s), "source": req.get("source"),
            "customer": req.get("customer") or s.get("customer_name") or "Unknown sender",
            "company": req.get("company"), "email": req.get("email"),
            "received_at": req.get("received_at"), "decided_at": s.get("decided_at"), "decided_by": s.get("decided_by"),
            "summary": ", ".join(parts) or "No items found", "line_count": len(lines),
            "total": quote.get("total", 0.0),
            "reason_codes": codes, "reasons": [REASON_LABELS[c] for c in codes],
            "human_edited": bool(s.get("human_edited")),
        }

    def list(self) -> dict:
        with self._lock:
            rows = [self.summary(q) for q in reversed(self._ids)]
        rows.sort(key=lambda r: -(r["received_at"] or 0))
        counts = {k: 0 for k in ("needs_approval", "auto_sent", "sent", "rejected")}
        for r in rows:
            counts[r["status"]] += 1
        return {"quotes": rows, "counts": counts | {"all": len(rows)}, "now": self.clock()}

    def detail(self, qid: str) -> dict:
        with self._lock:
            s = self._state(qid)
            out = self.summary(qid)
        out |= {
            "message": s.get("lead_message", ""), "attachment": s.get("request", {}).get("attachment"),
            "extracted_items": s.get("items", []), "quote": s.get("quote", {}),
            "needs_manager": s.get("needs_manager", []), "draft_email": s.get("draft_email", ""),
            "manager_note": s.get("manager_note", ""), "rules": s.get("rules", {}),
            "history": s.get("history", []), "sent_at": s.get("sent_at"),
            "delivery": self.deliveries.get(qid),
        }
        return out

    # ---- actions ---------------------------------------------------------------------------
    def _create(self, message, source, customer, company, email, received_at, attachment=None) -> str:
        qid = f"Q-{self._next}"
        self._next += 1
        request = {"id": qid, "source": source, "customer": customer, "company": company, "email": email,
                   "received_at": received_at, "attachment": attachment}
        self._ids.append(qid)
        try:
            graph_mod.run_until_gate(self.graph, message, qid, request)
        except Exception:
            self._ids.remove(qid)
            raise
        return qid

    def create(self, message: str, source: str = "web_form", customer: str | None = None,
               company: str | None = None, email: str | None = None, attachment: str | None = None) -> dict:
        if source not in SOURCES:
            raise ValueError(f"source must be one of {', '.join(SOURCES)}")
        if not message.strip():
            raise ValueError("the request message is empty")
        with self._lock:
            qid = self._create(message.strip(), source, customer or None, company or None, email or None,
                               self.clock(), attachment or None)
            return self.detail(qid)

    def _require_waiting(self, qid: str) -> dict:
        state = self._state(qid)
        if not graph_mod.is_waiting(self.graph, qid):
            raise Conflict(f"{qid} is already {self._status(qid, state).replace('_', ' ')}, it is no longer waiting for approval")
        return state

    def _items_from_edit(self, state: dict, lines: list[dict], unpriced: list[dict]) -> list[dict]:
        asked = {l["sku"]: l.get("requested_discount", 0.0) for l in state.get("quote", {}).get("lines", [])}
        items = []
        for l in lines:
            sku = str(l.get("sku", "")).upper()
            if self.erp.get_product(sku) is None:
                raise ValueError(f"{sku or 'line'} is not in the catalog")
            qty = int(l.get("qty") or 0)
            if qty <= 0 or qty > 100000:
                raise ValueError(f"{sku}: quantity must be between 1 and 100000")
            item = {"text": sku, "sku": sku, "qty": qty, "requested_discount": asked.get(sku, 0.0)}
            if l.get("discount") is not None:
                d = float(l["discount"])
                if not 0 <= d <= 0.9:
                    raise ValueError(f"{sku}: discount must be between 0% and 90%")
                item["discount_override"] = round(d, 4)
            items.append(item)
        return items + [dict(u) for u in unpriced]

    def preview(self, qid: str, lines: list[dict], unpriced: list[dict] | None = None) -> dict:
        """What the quote would be with these lines. Runs the real pricing code, changes nothing."""
        with self._lock:
            state = self._require_waiting(qid)
            return graph_mod.price_items(self._items_from_edit(state, lines, unpriced or []), self.erp, self.rules)

    def edit(self, qid: str, lines: list[dict], unpriced: list[dict] | None = None, by: str | None = None) -> dict:
        with self._lock:
            state = self._require_waiting(qid)
            items = self._items_from_edit(state, lines, unpriced or [])
            graph_mod.reprice_with_items(self.graph, qid, items, by or self.user, self.clock)
            return self.detail(qid)

    def set_email(self, qid: str, text: str, by: str | None = None) -> dict:
        if not text.strip():
            raise ValueError("the email cannot be empty")
        with self._lock:
            self._require_waiting(qid)
            graph_mod.update_email(self.graph, qid, text, by or self.user, self.clock)
            return self.detail(qid)

    def approve(self, qid: str, note: str = "", by: str | None = None) -> dict:
        with self._lock:
            state = self._require_waiting(qid)
            if not state.get("quote", {}).get("lines"):
                raise Conflict("there is nothing priced on this quote to send, edit it or reject it")
            graph_mod.resume_with_decision(self.graph, qid, True, note.strip(), by or self.user, self.clock)
            return self.detail(qid)

    def reject(self, qid: str, reason: str, by: str | None = None) -> dict:
        if not reason.strip():
            raise ValueError("a reason is required to reject a quote")
        with self._lock:
            self._require_waiting(qid)
            graph_mod.resume_with_decision(self.graph, qid, False, reason.strip(), by or self.user, self.clock)
            return self.detail(qid)

    # ---- rules, catalog, audit, overview -----------------------------------------------------
    def get_rules(self) -> dict:
        return {"rules": self.rules.to_dict(), "defaults": DEFAULT_RULES.to_dict(),
                "is_default": self.rules == DEFAULT_RULES, "changed": self.rules_changed}

    def set_rules(self, data: dict) -> dict:
        with self._lock:
            self.rules = PricingRules.from_dict(data)
            self.rules_changed = {"by": self.user, "at": self.clock()}
            return self.get_rules()

    def price_check(self, sku: str, qty: int, requested_discount: float = 0.0) -> dict:
        """Price one hypothetical line with the rules in force. Used by the rules screen."""
        if self.erp.get_product(sku.upper()) is None:
            raise ValueError(f"{sku} is not in the catalog")
        if not 1 <= qty <= 100000:
            raise ValueError("quantity must be between 1 and 100000")
        item = {"text": sku, "sku": sku.upper(), "qty": qty, "requested_discount": min(max(requested_discount, 0.0), 0.9)}
        return graph_mod.price_items([item], self.erp, self.rules)

    def catalog(self) -> list[dict]:
        floor = 1 + self.rules.min_margin
        return [p | {"floor_price": round(p["cost"] * floor, 2),
                     "list_margin": round((p["list_price"] - p["cost"]) / p["cost"], 4)} for p in self.erp.list_products()]

    def activity(self) -> list[dict]:
        """The decision log, newest first, read back from the JSONL file the graph writes."""
        records = []
        for line in self.decisions_path.read_text().splitlines():
            rec = json.loads(line)
            req = rec.get("request", {})
            by = rec.get("decided_by") or ""
            records.append({
                "id": req.get("id"), "ts": rec.get("decided_at") or rec["ts"],
                "outcome": ("auto_sent" if by == "auto" else "sent") if rec.get("sent") else "rejected",
                "decided_by": "Auto approval policy" if by == "auto" else by,
                "customer": req.get("customer") or rec.get("customer_name") or "Unknown sender",
                "company": req.get("company"), "total": rec.get("quote", {}).get("total", 0.0),
                "note": rec.get("manager_note", ""), "human_edited": bool(rec.get("human_edited")),
                "reasons": [REASON_LABELS[c] for c in dict.fromkeys(r["code"] for r in rec.get("quote", {}).get("reasons", []))],
                "minutes_to_decision": round((rec["decided_at"] - req["received_at"]) / 60, 1)
                if rec.get("decided_at") and req.get("received_at") else None,
                "record": rec,
            })
        records.sort(key=lambda r: -r["ts"])
        return records

    def overview(self, days: int = 7) -> dict:
        """Counted from the inbox, nothing stored. The window is today plus the previous days - 1 calendar days."""
        now = self.clock()
        midnight = datetime.fromtimestamp(now).replace(hour=0, minute=0, second=0, microsecond=0)
        starts = [(midnight - timedelta(days=d)).timestamp() for d in range(days - 1, -1, -1)]
        rows = [r for r in self.list()["quotes"] if (r["received_at"] or 0) >= starts[0]]
        statuses = ("needs_approval", "auto_sent", "sent", "rejected")
        by_status = {k: [r for r in rows if r["status"] == k] for k in statuses}
        waits = [(r["decided_at"] - r["received_at"]) / 60 for r in by_status["sent"] if r["decided_at"]]
        reasons: dict[str, int] = {}
        for r in rows:
            for code in r["reason_codes"]:
                reasons[code] = reasons.get(code, 0) + 1
        daily = []
        for lo, hi in zip(starts, starts[1:] + [now + 1]):
            bucket = [r for r in rows if lo <= r["received_at"] < hi]
            daily.append({"start": lo, "total": len(bucket)} | {k: sum(1 for r in bucket if r["status"] == k) for k in statuses})
        channels = []
        for source in SOURCES:
            mine = [r for r in rows if r["source"] == source]
            auto = sum(1 for r in mine if r["status"] == "auto_sent")
            channels.append({"source": source, "quotes": len(mine), "auto_sent": auto, "needed_person": len(mine) - auto,
                             "auto_share": round(auto / len(mine), 4) if mine else None,
                             "value": round(sum(r["total"] for r in mine), 2)})
        customers: dict[str, dict] = {}
        for r in rows:
            c = customers.setdefault(r["company"] or r["customer"], {"quotes": 0, "value": 0.0, "sent_value": 0.0, "waiting": 0})
            c["quotes"] += 1
            c["value"] = round(c["value"] + r["total"], 2)
            if r["status"] in ("sent", "auto_sent"):
                c["sent_value"] = round(c["sent_value"] + r["total"], 2)
            c["waiting"] += r["status"] == "needs_approval"
        top = sorted(({"customer": k} | v for k, v in customers.items()), key=lambda c: -c["value"])[:6]
        return {
            "days": days, "quotes": len(rows),
            "auto_sent": len(by_status["auto_sent"]), "needed_person": len(rows) - len(by_status["auto_sent"]),
            "auto_share": round(len(by_status["auto_sent"]) / len(rows), 4) if rows else None,
            "approved_by_person": len(by_status["sent"]), "rejected": len(by_status["rejected"]),
            "awaiting": len(by_status["needs_approval"]),
            "awaiting_value": round(sum(r["total"] for r in by_status["needs_approval"]), 2),
            "sent_value": round(sum(r["total"] for r in by_status["sent"] + by_status["auto_sent"]), 2),
            "median_minutes_to_approval": round(statistics.median(waits), 1) if waits else None,
            "decided_by_person": len(by_status["sent"]) + len(by_status["rejected"]),
            "oldest_waiting_minutes": round(max(((now - r["received_at"]) / 60 for r in by_status["needs_approval"]), default=0), 1),
            "reasons": [{"code": c, "label": REASON_LABELS[c], "count": n} for c, n in sorted(reasons.items(), key=lambda kv: -kv[1])],
            "daily": daily, "channels": channels, "top_customers": top,
        }


def from_env() -> QuoteDesk:
    from . import mailer
    live = None
    if os.environ.get("QUOTE_DESK_LIVE") == "1":
        from .llm import AnthropicLLM   # needs ANTHROPIC_API_KEY; only new requests use it
        live = AnthropicLLM()
    return QuoteDesk(seed_path=ROOT / "fixtures" / "demo_requests.json",
                     decisions_path=Path(os.environ.get("QUOTE_DESK_LOG", ROOT / "data" / "decisions.demo.jsonl")),
                     live_llm=live, demo_clock=os.environ.get("QUOTE_DESK_REAL_CLOCK") != "1",
                     email_sender=mailer.from_env())
