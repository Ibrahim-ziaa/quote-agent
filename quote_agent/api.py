"""HTTP API and static host for Quote Desk.

    uvicorn quote_agent.api:app --port 8101

JSON lives under /api. The built React app in web/dist is served at /, so one process on one
port runs the whole product. Nothing in this file prices or sends: it calls the service, which
drives the graph.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .service import ROOT, Conflict, NotFound, QuoteDesk, from_env


class NewRequest(BaseModel):
    message: str = Field(max_length=6000)
    source: str = "web_form"
    customer: str | None = Field(default=None, max_length=120)
    company: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=200)
    attachment: str | None = Field(default=None, max_length=200)


class EditLine(BaseModel):
    sku: str
    qty: int
    discount: float | None = None   # only when a manager typed one; otherwise tiers and the ask apply


class EditBody(BaseModel):
    lines: list[EditLine] = Field(max_length=50)
    unpriced: list[dict] = Field(default_factory=list, max_length=50)


class EmailBody(BaseModel):
    draft_email: str = Field(max_length=10000)


class ApproveBody(BaseModel):
    note: str = Field(default="", max_length=500)


class RejectBody(BaseModel):
    reason: str = Field(max_length=500)


class Tier(BaseModel):
    min_qty: int
    discount: float


class RulesBody(BaseModel):
    min_margin: float
    max_discount_without_approval: float
    volume_tiers: list[Tier]


def create_app(desk: QuoteDesk | None = None, static_dir: Path | None = None) -> FastAPI:
    desk = desk or from_env()
    app = FastAPI(title="Quote Desk", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.desk = desk

    @app.exception_handler(NotFound)
    async def _not_found(_, exc: NotFound):
        return JSONResponse({"detail": f"No quote with id {exc}"}, status_code=404)

    @app.exception_handler(Conflict)
    async def _conflict(_, exc: Conflict):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ValueError)
    async def _bad_value(_, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/meta")
    def meta():
        return {"product": "Quote Desk", "mode": desk.mode, "user": desk.user, "role": "Sales manager",
                "distributor": "Calder Bay Industrial Supply", "currency": "USD", "now": desk.clock()}

    @app.get("/api/quotes")
    def list_quotes():
        return desk.list()

    @app.post("/api/quotes", status_code=201)
    def new_quote(body: NewRequest):
        return desk.create(body.message, body.source, body.customer, body.company, body.email, body.attachment)

    @app.get("/api/quotes/{qid}")
    def get_quote(qid: str):
        return desk.detail(qid)

    @app.post("/api/quotes/{qid}/preview")
    def preview(qid: str, body: EditBody):
        return desk.preview(qid, [l.model_dump() for l in body.lines], body.unpriced)

    @app.post("/api/quotes/{qid}/edit")
    def edit(qid: str, body: EditBody):
        return desk.edit(qid, [l.model_dump() for l in body.lines], body.unpriced)

    @app.put("/api/quotes/{qid}/email")
    def email(qid: str, body: EmailBody):
        return desk.set_email(qid, body.draft_email)

    @app.post("/api/quotes/{qid}/approve")
    def approve(qid: str, body: ApproveBody | None = None):
        return desk.approve(qid, body.note if body else "")

    @app.post("/api/quotes/{qid}/reject")
    def reject(qid: str, body: RejectBody):
        return desk.reject(qid, body.reason)

    @app.get("/api/activity")
    def activity():
        return {"records": desk.activity(), "log_file": desk.decisions_path.name}

    @app.get("/api/outbox")
    def outbox():
        return {"messages": list(reversed(desk.outbox))}

    @app.get("/api/overview")
    def overview(days: int = 7):
        if not 1 <= days <= 90:
            raise HTTPException(422, "days must be between 1 and 90")
        return desk.overview(days)

    @app.get("/api/rules")
    def rules():
        return desk.get_rules()

    @app.put("/api/rules")
    def put_rules(body: RulesBody):
        return desk.set_rules(body.model_dump())

    @app.get("/api/price-check")
    def price_check(sku: str, qty: int = 1, asked: float = 0.0):
        return desk.price_check(sku, qty, asked)

    @app.get("/api/catalog")
    def catalog():
        return {"products": desk.catalog()}

    @app.post("/api/reset")
    def reset():
        desk.reset()
        return desk.list()["counts"]

    dist = static_dir or ROOT / "web" / "dist"
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "Not found")
            file = (dist / path).resolve()
            if path and file.is_file() and dist.resolve() in file.parents:
                return FileResponse(file)
            return FileResponse(dist / "index.html")   # client side routes

    return app


def __getattr__(name: str):
    # `uvicorn quote_agent.api:app` builds the seeded demo app on first access, importing this
    # module (as the tests do) does not.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
