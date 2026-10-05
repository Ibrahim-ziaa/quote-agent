"""The customer facing quote PDF.

It is drawn from the same priced quote the graph produced, so every number on the page came from
pricing.py. Cost, margin, floor prices and the internal rule trail are never printed: this is the
document the customer receives.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#0f2a43")
ACCENT = colors.HexColor("#1f7a8c")
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#6b7785")
RULE = colors.HexColor("#d9dee4")
STRIPE = colors.HexColor("#f4f7f9")
GOOD = colors.HexColor("#1d7a46")

VALID_DAYS = 30
SELLER = {
    "name": "Calder Bay Industrial Supply",
    "lines": ["Pumps, valves, fittings and hose", "Demo company, every business and person is fictional"],
    "contact": "sales@calderbay.example",
}

_base = ParagraphStyle("base", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
_small = ParagraphStyle("small", parent=_base, fontSize=8, leading=10.5, textColor=MUTED)
_label = ParagraphStyle("label", parent=_base, fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=MUTED)
_cell = ParagraphStyle("cell", parent=_base, fontSize=8.8, leading=11)
_cell_r = ParagraphStyle("cell_r", parent=_cell, alignment=TA_RIGHT)
_head = ParagraphStyle("head", parent=_cell, fontName="Helvetica-Bold", textColor=colors.white)
_head_r = ParagraphStyle("head_r", parent=_head, alignment=TA_RIGHT)


def money(x: float) -> str:
    return f"${x:,.2f}"


def _date(ts: float | None) -> str:
    return datetime.fromtimestamp(ts).strftime("%d %b %Y") if ts else ""


def _esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_quote_pdf(q: dict, now: float) -> bytes:
    """q: id, customer, company, email, received_at, status, decided_by, decided_at, quote."""
    quote = q.get("quote") or {}
    lines = quote.get("lines", [])
    issued = q.get("decided_at") or now
    status = q.get("status", "needs_approval")
    draft = status == "needs_approval"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=46 * mm, bottomMargin=22 * mm,
                            title=f"Quote {q.get('id', '')}", author=SELLER["name"])
    width = A4[0] - 36 * mm

    def chrome(canvas, _doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 34 * mm, w, 34 * mm, stroke=0, fill=1)
        canvas.setFillColor(ACCENT)
        canvas.rect(0, h - 35.2 * mm, w, 1.2 * mm, stroke=0, fill=1)
        # mark
        canvas.setFillColor(colors.white)
        canvas.roundRect(18 * mm, h - 25 * mm, 13 * mm, 13 * mm, 2.2 * mm, stroke=0, fill=1)
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 13)
        canvas.drawCentredString(24.5 * mm, h - 20.4 * mm, "CB")
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(35 * mm, h - 17.5 * mm, SELLER["name"])
        canvas.setFont("Helvetica", 8.5)
        canvas.setFillColor(colors.HexColor("#c9d6e2"))
        canvas.drawString(35 * mm, h - 22.5 * mm, SELLER["lines"][0])
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 20)
        canvas.drawRightString(w - 18 * mm, h - 18 * mm, "QUOTATION")
        canvas.setFont("Helvetica", 9)
        canvas.drawRightString(w - 18 * mm, h - 24 * mm, f"{q.get('id', '')}  |  {_date(issued)}")
        if draft:
            canvas.setFillColor(colors.HexColor("#e8a33d"))
            canvas.setFont("Helvetica-Bold", 8)
            canvas.drawRightString(w - 18 * mm, h - 29 * mm, "DRAFT, AWAITING MANAGER APPROVAL")
        # footer
        canvas.setStrokeColor(RULE)
        canvas.line(18 * mm, 15 * mm, w - 18 * mm, 15 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(18 * mm, 10.5 * mm, f"{SELLER['name']}  |  {SELLER['contact']}  |  {SELLER['lines'][1]}")
        canvas.drawRightString(w - 18 * mm, 10.5 * mm, f"Page {_doc.page}")
        canvas.restoreState()

    story = []

    # parties and details
    who = [Paragraph("PREPARED FOR", _label),
           Paragraph(f"<b>{_esc(q.get('company') or q.get('customer') or 'Customer')}</b>", _base)]
    if q.get("company") and q.get("customer"):
        who.append(Paragraph(_esc(q["customer"]), _base))
    if q.get("email"):
        who.append(Paragraph(_esc(q["email"]), _small))
    valid = datetime.fromtimestamp(issued) + timedelta(days=VALID_DAYS)
    details = Table([
        [Paragraph("QUOTE NUMBER", _label), Paragraph(q.get("id", ""), _cell_r)],
        [Paragraph("ISSUED", _label), Paragraph(_date(issued), _cell_r)],
        [Paragraph("VALID UNTIL", _label), Paragraph(valid.strftime("%d %b %Y"), _cell_r)],
        [Paragraph("REQUEST RECEIVED", _label), Paragraph(_date(q.get("received_at")), _cell_r)],
    ], colWidths=[34 * mm, 36 * mm], style=[("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2)])
    story.append(Table([[who, details]], colWidths=[width - 72 * mm, 72 * mm],
                       style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(Spacer(1, 8 * mm))

    # lines
    rows = [[Paragraph("SKU", _head), Paragraph("Description", _head), Paragraph("Qty", _head_r),
             Paragraph("List", _head_r), Paragraph("Discount", _head_r), Paragraph("Unit", _head_r), Paragraph("Amount", _head_r)]]
    for l in lines:
        desc = _esc(l["name"])
        if not l.get("in_stock", True):
            note = (f"Partial stock: {l['stock']} available now, balance on back order" if l.get("stock")
                    else "Out of stock, ships on back order")
            desc += f"<br/><font color='#b4561b' size='7.5'>{note}</font>"
        rows.append([Paragraph(l["sku"], _cell), Paragraph(desc, _cell), Paragraph(f"{l['qty']:,}", _cell_r),
                     Paragraph(money(l["list_price"]), _cell_r),
                     Paragraph(f"{round(l['discount'] * 100, 1):g}%" if l["discount"] else "", _cell_r),
                     Paragraph(money(l["unit_price"]), _cell_r), Paragraph(f"<b>{money(l['total'])}</b>", _cell_r)])
    table = Table(rows, colWidths=[22 * mm, width - 112 * mm, 14 * mm, 20 * mm, 18 * mm, 18 * mm, 20 * mm], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
             ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
             ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE)]
    style += [("BACKGROUND", (0, i), (-1, i), STRIPE) for i in range(2, len(rows), 2)]
    table.setStyle(TableStyle(style))
    story.append(table)
    story.append(Spacer(1, 5 * mm))

    # totals
    list_total = quote.get("list_total") or sum(l["list_price"] * l["qty"] for l in lines)
    total = quote.get("total", 0.0)
    saving = round(list_total - total, 2)
    totals = [[Paragraph("List value", _base), Paragraph(money(list_total), _cell_r)]]
    if saving > 0:
        totals.append([Paragraph(f"<font color='#1d7a46'>Your saving ({saving / list_total * 100:.1f}%)</font>", _base),
                       Paragraph(f"<font color='#1d7a46'>-{money(saving)}</font>", _cell_r)])
    totals.append([Paragraph("<b>Quote total (USD, excl. tax and freight)</b>", _base),
                   Paragraph(f"<font size='12'><b>{money(total)}</b></font>", _cell_r)])
    tt = Table(totals, colWidths=[74 * mm, 30 * mm], hAlign="RIGHT")
    tt.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 1, NAVY), ("TOPPADDING", (0, 0), (-1, -1), 4),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("BACKGROUND", (0, -1), (-1, -1), STRIPE)]))
    story.append(tt)

    unpriced = quote.get("rejected", [])
    if unpriced:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph("NOT INCLUDED IN THIS QUOTE", _label))
        for r in unpriced:
            item = r.get("item", {})
            what = (f"{item['qty']} x " if item.get("qty") else "") + (item.get("text") or "item")
            story.append(Paragraph(f"{_esc(what)}: {_esc(r.get('reason', 'not in our catalog'))}. "
                                   "Reply with a part number and we will price it.", _small))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("TERMS", _label))
    for t in (f"Prices are valid for {VALID_DAYS} days from the issue date and are subject to stock at the time of order.",
              "Payment net 30 days from invoice for approved accounts. Freight and applicable taxes are added at invoicing.",
              "Reply to the email this quote came with, quoting the quote number, to confirm and we will raise the order."):
        story.append(Paragraph(t, _small))

    story.append(Spacer(1, 8 * mm))
    if draft:
        sign = "Draft for internal review. Not yet approved, not valid as an offer."
    elif q.get("decided_by") in (None, "", "auto"):
        sign = f"Issued {_date(issued)} under standard pricing, within our approved discount policy."
    else:
        sign = f"Approved by {_esc(q['decided_by'])}, Sales Manager, on {_date(issued)}."
    stamp = Table([[Paragraph(sign, ParagraphStyle("stamp", parent=_base, textColor=colors.white, fontName="Helvetica-Bold"))]],
                  colWidths=[width])
    stamp.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), MUTED if draft else ACCENT),
                               ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                               ("LEFTPADDING", (0, 0), (-1, -1), 9)]))
    story.append(stamp)

    doc.build(story, onFirstPage=chrome, onLaterPages=chrome)
    return buf.getvalue()
