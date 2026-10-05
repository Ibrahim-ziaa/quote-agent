import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, CircleSlash, FileText, Info, Mail, Paperclip, Pencil, Plus, Send, ShieldAlert, Trash2, X, Zap } from "lucide-react";
import { api, useApi, type ApiError, type HistoryEvent, type Preview, type PricedQuote, type Product, type QuoteDetail, type QuoteLine, type Rules, type Unpriced } from "../api";
import { useApp } from "../App";
import { age, clock, dateTime, money, pct } from "../format";
import { Button, Card, CardHeader, ErrorBox, Origin, SOURCE_LABEL, SkeletonRows, StatusPill, cx, inputClass } from "../ui";

interface DraftLine { sku: string; qty: string; discount: string; touched: boolean }

const REJECT_PRESETS = ["Discount is deeper than we can offer", "Cannot supply in the time they need", "Not a product line we carry", "Duplicate of another request"];

export default function QuoteReview() {
  const { id = "" } = useParams();
  const { version, bump, meta } = useApp();
  const [params, setParams] = useSearchParams();
  const { data, error, reload, setData } = useApi<QuoteDetail>(`/quotes/${id}`, version);

  const waiting = data?.status === "needs_approval";
  const editing = waiting && params.get("edit") === "1";
  const rejecting = waiting && params.get("reject") === "1";

  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [keptUnpriced, setKeptUnpriced] = useState<Unpriced[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const catalog = useApi<{ products: Product[] }>(editing ? "/catalog" : null).data?.products;

  useEffect(() => { if (data) setEmail(data.draft_email); }, [data?.draft_email, data?.id]); // eslint-disable-line
  const emailDirty = !!data && email !== data.draft_email;

  // entering edit mode: start from the quote as priced
  const editKey = `${data?.id}:${editing}`;
  const startedFor = useRef("");
  useEffect(() => {
    if (!data || !editing || startedFor.current === editKey) return;
    startedFor.current = editKey;
    // ?lines=PMP-100*3*10,VLV-050*200 opens the editor with those lines (sku*qty*discount%), so an edit can be linked to
    const linked = params.get("lines");
    setDraft(linked
      ? linked.split(",").map((part) => { const [sku, qty = "1", d] = part.split("*"); return { sku: sku.toUpperCase(), qty, discount: d ?? "0", touched: d !== undefined }; })
      : data.quote.lines.map((l) => ({ sku: l.sku, qty: String(l.qty), discount: trimPct(l.discount), touched: l.discount_override !== null })));
    setKeptUnpriced(linked && params.get("drop_unpriced") === "1" ? [] : data.quote.rejected);
    setPreview(null); setPreviewError(null);
  }, [data, editing, editKey]); // eslint-disable-line
  useEffect(() => { if (!editing) startedFor.current = ""; }, [editing]);

  // live preview through the real pricing code
  const payload = useMemo(() => ({
    lines: draft.map((d) => ({ sku: d.sku, qty: parseInt(d.qty, 10) || 0, discount: d.touched ? (parseFloat(d.discount) || 0) / 100 : null })),
    unpriced: keptUnpriced.map((u) => u.item),
  }), [draft, keptUnpriced]);
  useEffect(() => {
    if (!editing || !data) return;
    if (payload.lines.some((l) => l.qty <= 0)) { setPreviewError("Enter a quantity of 1 or more on every line."); return; }
    const t = setTimeout(() => {
      api<Preview>(`/quotes/${data.id}/preview`, { method: "POST", body: payload })
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((e: ApiError) => setPreviewError(e.message));
    }, 180);
    return () => clearTimeout(t);
  }, [payload, editing, data?.id]); // eslint-disable-line

  function setParam(key: string, on: boolean) {
    const next = new URLSearchParams(params);
    next.delete("edit"); next.delete("reject");
    if (on) next.set(key, "1");
    setParams(next, { replace: true });
    setActionError(null);
  }

  async function run(name: string, fn: () => Promise<QuoteDetail>, done?: string) {
    setBusy(name); setActionError(null); setNotice(null);
    try {
      const next = await fn();
      setData(next); bump();
      if (done) setNotice(done);
      setParams(new URLSearchParams(), { replace: true });
    } catch (e) {
      setActionError((e as ApiError).message);
    } finally { setBusy(null); }
  }

  if (error) return <div className="mx-auto max-w-xl pt-10"><ErrorBox message={error.status === 404 ? `There is no quote ${id}. It may have been cleared by a demo reset.` : error.message} onRetry={error.status === 404 ? undefined : reload} /><Link to="/inbox" className="mt-4 inline-block text-sm text-accent-700 underline">Back to the inbox</Link></div>;
  if (!data) return <Card><SkeletonRows rows={10} /></Card>;

  const quote: PricedQuote = editing && preview ? preview.quote : data.quote;
  const rules = data.rules;
  const reasons = explainReasons(quote, rules);
  const canSend = quote.lines.length > 0;

  const approve = () => run("approve", async () => {
    if (emailDirty) await api(`/quotes/${data.id}/email`, { method: "PUT", body: { draft_email: email } });
    return api<QuoteDetail>(`/quotes/${data.id}/approve`, { method: "POST", body: { note } });
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link to="/inbox" className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900"><ArrowLeft size={13} aria-hidden /> Inbox</Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{data.company ?? data.customer}</h1>
            <span className="num text-sm text-ink-500">{data.id}</span>
            <StatusPill status={data.status} />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {data.company ? `${data.customer}, ` : ""}{SOURCE_LABEL[data.source]?.toLowerCase()} received {age(data.received_at)}
            <span className="text-ink-400"> ({dateTime(data.received_at)})</span>
          </p>
        </div>
        {!waiting && data.quote.lines.length > 0 && (
          <div className="ml-auto flex items-center gap-2 pt-4">
            <a href={`/api/quotes/${data.id}/pdf`} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 shadow-sm hover:bg-ink-50">
              <FileText size={14} aria-hidden /> Quote PDF
            </a>
          </div>
        )}
        {waiting && (
          <div className="ml-auto flex items-center gap-2 pt-4">
            {canSend && (
              <a href={`/api/quotes/${data.id}/pdf`} target="_blank" rel="noreferrer" title="Preview the PDF the customer will receive"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 shadow-sm hover:bg-ink-50">
                <FileText size={14} aria-hidden /> Preview PDF
              </a>
            )}
            <Button variant="danger" onClick={() => setParam("reject", !rejecting)} disabled={!!busy || editing}><X size={15} aria-hidden /> Reject</Button>
            <Button onClick={() => setParam("edit", !editing)} disabled={!!busy || editing}><Pencil size={14} aria-hidden /> Edit quote</Button>
            <Button variant="primary" onClick={approve} busy={busy === "approve"} disabled={!!busy || editing || !canSend}
              title={!canSend ? "Nothing is priced on this quote yet. Edit it or reject it." : editing ? "Save or cancel your edit first" : undefined}>
              {busy !== "approve" && <Send size={14} aria-hidden />} Approve and send
            </Button>
          </div>
        )}
      </div>

      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}
      {notice && <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-4 py-2.5 text-sm text-accent-700"><Info size={15} aria-hidden /> {notice}</div>}

      {rejecting && (
        <Card className="mb-4 border-bad-200">
          <form className="p-4" onSubmit={(e) => { e.preventDefault(); run("reject", () => api<QuoteDetail>(`/quotes/${data.id}/reject`, { method: "POST", body: { reason } })); }}>
            <label htmlFor="reason" className="text-sm font-semibold">Reject this quote</label>
            <p className="mt-0.5 text-sm text-ink-500">Nothing is sent to the customer. The reason is saved to the activity log with your name.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {REJECT_PRESETS.map((p) => <button type="button" key={p} onClick={() => setReason(p)} className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-700 hover:bg-ink-50">{p}</button>)}
            </div>
            <textarea id="reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)"
              className={cx(inputClass, "mt-2 block h-auto w-full max-w-2xl py-2")} />
            <div className="mt-3 flex gap-2">
              <Button type="submit" variant="dangerSolid" busy={busy === "reject"} disabled={!reason.trim()}>Reject quote</Button>
              <Button type="button" variant="ghost" onClick={() => setParam("reject", false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[330px_minmax(0,1fr)_410px]">
        {/* left: what the customer sent */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer request" tag={<Origin by="customer" />} />
            <div className="p-4">
              <dl className="grid grid-cols-[64px_1fr] gap-y-1 text-[13px]">
                <dt className="text-ink-500">From</dt><dd className="truncate font-medium">{data.customer}</dd>
                {data.email && <><dt className="text-ink-500">Email</dt><dd className="truncate">{data.email}</dd></>}
                <dt className="text-ink-500">Via</dt><dd>{SOURCE_LABEL[data.source]}</dd>
              </dl>
              {data.attachment && <div className="mt-3 inline-flex items-center gap-1.5 rounded border border-ink-200 bg-ink-25 px-2 py-1 text-xs text-ink-700"><Paperclip size={12} aria-hidden /> {data.attachment}</div>}
              <blockquote className={cx("mt-3 whitespace-pre-wrap rounded-md border-l-2 border-ink-300 bg-ink-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-800", data.source === "rfq_upload" && "font-mono text-[12.5px]")}>{data.message}</blockquote>
            </div>
          </Card>

          <Card>
            <CardHeader title="What the model read" />
            <div className="p-4 pt-3">
              {data.extracted_items.length === 0 ? <p className="text-sm text-ink-500">No products found in the message.</p> : (
                <>
                  <ul className="divide-y divide-ink-100 text-[13px]">
                    {data.extracted_items.map((it, i) => (
                      <li key={i} className="flex items-baseline gap-2 py-1.5">
                        <span className="num w-9 shrink-0 text-right font-medium">{it.qty ? it.qty : "?"}</span>
                        <span className="text-ink-400">of</span>
                        <span className="min-w-0 flex-1">{it.sku ?? it.text}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="num mt-1.5 flex justify-between border-t border-ink-100 pt-2 text-[13px]">
                    <span className="text-ink-500">Discount asked for</span>
                    <span className="font-medium">{Math.max(0, ...data.extracted_items.map((it) => it.requested_discount ?? 0)) > 0 ? `${pct(Math.max(...data.extracted_items.map((it) => it.requested_discount ?? 0)))} off` : "None"}</span>
                  </div>
                </>
              )}
              <p className="mt-2 border-t border-ink-100 pt-2 text-xs leading-relaxed text-ink-500">The model only lists what was asked for. Matching products, checking stock and every price are done by code.</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity on this quote" />
            <Timeline events={data.history} />
            {!waiting && <div className="border-t border-ink-100 px-4 py-2.5"><Link className="text-xs font-medium text-accent-700 hover:underline" to={`/activity?record=${data.id}`}>Open the full decision record</Link></div>}
          </Card>
        </div>

        {/* centre: the priced quote */}
        <div className="min-w-0 space-y-4">
          <DecisionBanner q={data} />
          {waiting && reasons.length > 0 && (
            <div className="rounded-lg border border-warn-200 bg-warn-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-warn-800"><ShieldAlert size={16} aria-hidden /> Held for your approval: {reasons.length} {reasons.length === 1 ? "reason" : "reasons"}{editing ? " (live preview)" : ""}</div>
              <ul className="mt-1.5 space-y-0.5 pl-6 text-[13.5px] text-warn-800">
                {reasons.map((r) => <li key={r} className="list-disc">{r}</li>)}
              </ul>
              {!editing && (
                <div className="mt-3 flex items-center gap-2 border-t border-warn-200 pt-3">
                  <label htmlFor="approve-note" className="shrink-0 text-xs font-medium text-warn-800">Approval note</label>
                  <input id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional. Saved to the activity log with your name when you approve."
                    className="h-8 min-w-0 flex-1 rounded-md border border-warn-200 bg-white px-2.5 text-[13px] placeholder:text-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-100" />
                </div>
              )}
            </div>
          )}
          {waiting && reasons.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-good-200 bg-good-50 px-4 py-3 text-sm text-good-700">
              <Check size={16} aria-hidden /> {editing ? "With these changes no pricing rule is triggered." : "No pricing rule is triggered any more."} A quote a person has edited still waits for that person to approve it.
            </div>
          )}

          <Card className={cx("overflow-hidden", editing && "ring-2 ring-accent-200")}>
            <CardHeader title={editing ? "Editing quote" : "Quote"} tag={<Origin by="code" />}>
              {editing && (
                <>
                  <span className="hidden text-xs text-ink-500 sm:inline">Totals and flags update as you type</span>
                  <Button size="sm" variant="ghost" onClick={() => setParam("edit", false)}>Cancel</Button>
                  <Button size="sm" variant="primary" busy={busy === "edit"} disabled={!!previewError || draft.length + keptUnpriced.length === 0}
                    onClick={() => run("edit", () => api<QuoteDetail>(`/quotes/${data.id}/edit`, { method: "POST", body: payload }), "Quote updated. The pricing code re-ran and the email was redrafted from the new numbers.")}>
                    Save changes
                  </Button>
                </>
              )}
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-25 text-xs text-ink-500">
                    <th className="py-2 pl-4 font-medium">Item</th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-right font-medium">List price</th>
                    <th className="px-2 py-2 text-right font-medium">Discount</th>
                    <th className="px-2 py-2 text-right font-medium">Unit price</th>
                    <th className="px-2 py-2 text-right font-medium">Margin</th>
                    <th className="px-2 py-2 text-right font-medium">Stock</th>
                    <th className="py-2 pl-2 pr-4 text-right font-medium">Line total</th>
                    {editing && <th className="w-9" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {!editing && quote.lines.map((l, i) => (
                    <LineRow key={`${l.sku}-${i}`} line={l} rules={rules} editing={false} onChange={() => {}} onRemove={() => {}} />
                  ))}
                  {editing && draft.map((d, i) => {
                    const l = quote.lines[i]?.sku === d.sku ? quote.lines[i] : undefined;   // the preview may be a keystroke behind
                    return l ? (
                      <LineRow key={`${d.sku}-${i}`} line={l} rules={rules} editing draft={d}
                        onChange={(patch) => setDraft((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                        onRemove={() => setDraft((all) => all.filter((_, j) => j !== i))} />
                    ) : <tr key={`pending-${i}`}><td className="py-3 pl-4 text-sm text-ink-400" colSpan={9}><span className="font-mono text-xs">{d.sku}</span> pricing...</td></tr>;
                  })}
                  {(editing ? keptUnpriced : quote.rejected).map((u, i) => (
                    <tr key={`u-${i}`} className="bg-warn-50/50">
                      <td className="py-2.5 pl-4" colSpan={editing ? 3 : 3}>
                        <div className="font-medium text-ink-800">{u.item.qty ? `${u.item.qty} x ` : ""}{u.item.text || "Unnamed item"}</div>
                        <div className="text-xs text-ink-500">as written by the customer</div>
                      </td>
                      <td className="px-2 py-2.5 text-right" colSpan={5}>
                        <span className="inline-flex items-center gap-1.5 rounded bg-warn-100 px-2 py-1 text-xs font-medium text-warn-800"><AlertTriangle size={12} aria-hidden /> Not priced: {u.reason}</span>
                      </td>
                      {editing && <td className="pr-3 text-right"><button aria-label="Leave this item off the quote" title="Leave this item off the quote" onClick={() => setKeptUnpriced((k) => k.filter((_, j) => j !== i))} className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-700"><Trash2 size={15} /></button></td>}
                    </tr>
                  ))}
                  {quote.lines.length === 0 && quote.rejected.length === 0 && !editing && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-500">Nothing could be priced from this request. Use Edit quote to add lines, or reject it.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {editing && catalog && (
              <div className="flex items-center gap-2 border-t border-ink-100 px-4 py-2.5">
                <Plus size={14} className="text-ink-400" aria-hidden />
                <label htmlFor="add-line" className="sr-only">Add a product</label>
                <select id="add-line" value="" className={cx(inputClass, "h-8 w-full max-w-md")}
                  onChange={(e) => { if (e.target.value) setDraft((d) => [...d, { sku: e.target.value, qty: "1", discount: "0", touched: false }]); }}>
                  <option value="">Add a product from the catalog</option>
                  {catalog.filter((p) => !draft.some((d) => d.sku === p.sku)).map((p) => <option key={p.sku} value={p.sku}>{p.sku}  {p.name}  ({money(p.list_price)}, {p.stock} in stock)</option>)}
                </select>
              </div>
            )}
            {previewError && editing && <div className="border-t border-ink-100 p-3"><ErrorBox message={previewError} /></div>}
            <div className="flex justify-end border-t border-ink-200 bg-ink-25 px-4 py-3">
              <dl className="num grid grid-cols-[auto_120px] gap-x-8 gap-y-0.5 text-right text-[13px]">
                <dt className="text-ink-500">List total</dt><dd className="text-ink-700">{money(quote.list_total)}</dd>
                <dt className="text-ink-500">Discounts</dt><dd className="text-ink-700">{quote.list_total - quote.total > 0 ? "-" : ""}{money(Math.max(0, quote.list_total - quote.total))}</dd>
                <dt className="pt-1 text-sm font-semibold text-ink-900">Quote total</dt><dd className="pt-1 text-base font-semibold text-ink-900">{money(quote.total)}</dd>
              </dl>
            </div>
          </Card>

          <Explainer quote={quote} rules={rules} />
        </div>

        {/* right: the email */}
        <div className="lg:col-start-2 2xl:col-start-3">
          <Card>
            <CardHeader title={waiting ? "Email to customer" : data.status === "rejected" ? "Email draft (never sent)" : "Email sent to customer"} tag={<Origin by="model" />} />
            <div className="border-b border-ink-100 px-4 py-2.5 text-[13px]">
              <div className="flex gap-2"><span className="w-14 shrink-0 text-ink-500">To</span><span className="truncate">{data.email ?? "No reply address on the request"}</span></div>
              <div className="mt-0.5 flex gap-2"><span className="w-14 shrink-0 text-ink-500">Subject</span><span className="truncate">Quote {data.id} from {meta?.distributor ?? "our sales team"}</span></div>
            </div>
            {editing && <div className="border-b border-warn-200 bg-warn-50 px-4 py-2 text-xs text-warn-800">This wording still has the numbers from before your edit. It is redrafted from the new numbers when you save.</div>}
            <label htmlFor="email-body" className="sr-only">Email body</label>
            <textarea id="email-body" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!waiting || editing} spellCheck={false}
              rows={Math.min(30, Math.max(14, email.split("\n").length + 6))}
              className={cx("block w-full resize-y border-0 bg-white px-4 py-3 text-[13.5px] leading-relaxed text-ink-800 focus:bg-accent-50/30", !waiting && "bg-ink-25 text-ink-600", editing && "bg-ink-25 text-ink-400")} />
            <div className="flex items-center gap-2 border-t border-ink-100 px-4 py-2.5">
              {waiting ? (
                emailDirty ? (
                  <>
                    <span className="text-xs text-ink-500">Unsaved wording. It is saved when you approve.</span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEmail(data.draft_email)}>Discard</Button>
                    <Button size="sm" busy={busy === "email"} onClick={() => run("email", () => api<QuoteDetail>(`/quotes/${data.id}/email`, { method: "PUT", body: { draft_email: email } }), "Email wording saved.")}>Save wording</Button>
                  </>
                ) : <span className="text-xs text-ink-500">{editing ? "The email is redrafted from the new numbers when you save the quote." : "Drafted from the priced quote. Click in the text to change the wording before it goes out."}</span>
              ) : <span className="text-xs text-ink-500">{data.sent_at ? `Sent ${dateTime(data.sent_at)}. Read only.` : "This draft was never sent."}</span>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const trimPct = (x: number) => String(Math.round(x * 1000) / 10);

function LineRow({ line: l, rules, editing, draft, onChange, onRemove }: {
  line: QuoteLine; rules: Rules; editing: boolean; draft?: DraftLine; onChange: (p: Partial<DraftLine>) => void; onRemove: () => void;
}) {
  const over = l.flags.includes("discount_over_limit");
  const clamped = l.flags.includes("margin_clamped");
  const short = l.flags.includes("short_stock");
  const cellInput = "num h-8 w-[68px] rounded-md border border-ink-300 px-2 text-right text-sm focus:border-accent-600 focus:ring-2 focus:ring-accent-100";
  return (
    <tr className="align-top">
      <td className="py-2.5 pl-4">
        <div className="font-medium text-ink-900">{l.name}</div>
        <div className="num font-mono text-xs text-ink-500">{l.sku}</div>
      </td>
      <td className="num px-2 py-2.5 text-right">
        {editing && draft ? <input aria-label={`Quantity for ${l.sku}`} inputMode="numeric" className={cellInput} value={draft.qty} onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d]/g, "") })} /> : l.qty.toLocaleString("en-US")}
      </td>
      <td className="num px-2 py-2.5 text-right text-ink-600">{money(l.list_price)}</td>
      <td className={cx("num px-2 py-2.5 text-right", over && "bg-warn-50")}>
        {editing && draft ? (
          <span className="inline-flex items-center gap-1">
            <input aria-label={`Discount percent for ${l.sku}`} inputMode="decimal" className={cx(cellInput, "w-[60px]")} value={draft.touched ? draft.discount : trimPct(l.discount)}
              onChange={(e) => onChange({ discount: e.target.value.replace(/[^\d.]/g, ""), touched: true })} />
            <span className="text-ink-500">%</span>
          </span>
        ) : <span className={cx(over && "font-semibold text-warn-800")}>{pct(l.discount)}</span>}
        {over && <div className="mt-0.5 text-[11px] font-medium leading-tight text-warn-800">over {pct(rules.max_discount_without_approval)} limit</div>}
        {!over && l.discount > 0 && <div className="mt-0.5 text-[11px] leading-tight text-ink-500">{l.discount_override !== null ? "set by manager" : clamped ? "cut to protect margin" : l.requested_discount > l.volume_discount ? "customer asked" : "volume tier"}</div>}
        {over && <div className="text-[11px] leading-tight text-warn-700">{l.discount_override !== null ? "set by manager" : l.requested_discount > l.volume_discount ? "customer asked" : "volume tier"}</div>}
      </td>
      <td className="num px-2 py-2.5 text-right font-medium">{money(l.unit_price)}</td>
      <td className={cx("num px-2 py-2.5 text-right", clamped && "bg-accent-50")}>
        {pct(l.margin)}
        {clamped && <div className="mt-0.5 text-[11px] font-medium leading-tight text-accent-700">held at {pct(rules.min_margin)} floor</div>}
      </td>
      <td className={cx("num px-2 py-2.5 text-right", short && "bg-bad-50")}>
        <span className={cx(short && "font-semibold text-bad-700")}>{l.stock.toLocaleString("en-US")}</span>
        {short && <div className="mt-0.5 text-[11px] font-medium leading-tight text-bad-700">short by {(l.qty - l.stock).toLocaleString("en-US")}</div>}
      </td>
      <td className="num py-2.5 pl-2 pr-4 text-right font-medium">{money(l.total)}</td>
      {editing && <td className="pr-3 pt-2 text-right"><button aria-label={`Remove ${l.sku}`} onClick={onRemove} className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-700"><Trash2 size={15} /></button></td>}
    </tr>
  );
}

function explainReasons(q: PricedQuote, rules: Rules): string[] {
  const out: string[] = [];
  const byDiscount = new Map<number, string[]>();
  for (const l of q.lines) if (l.flags.includes("discount_over_limit")) byDiscount.set(l.discount, [...(byDiscount.get(l.discount) ?? []), l.sku]);
  for (const [d, skus] of byDiscount) out.push(`${pct(d)} discount on ${skus.join(", ")} is over the ${pct(rules.max_discount_without_approval)} that can go out without approval`);
  for (const l of q.lines) if (l.flags.includes("short_stock")) out.push(`${l.sku} ${l.name}: ${l.stock} in stock, ${l.qty} requested`);
  for (const u of q.rejected) out.push(`"${u.item.text || "An item"}" could not be priced: ${u.reason}`);
  if (q.lines.length === 0 && q.rejected.length === 0) out.push("No products were found in the request");
  return out;
}

function DeliveryLine({ q }: { q: QuoteDetail }) {
  const d = q.delivery;
  if (!d) return null;
  const tone = d.status === "delivered" ? "text-good-700" : d.status === "failed" ? "text-bad-700" : "text-ink-500";
  return (
    <p className={cx("mt-1 flex items-center gap-1.5 pl-6 text-[13px]", tone)}>
      <Mail size={13} aria-hidden /> {d.detail}
      {d.status === "delivered" && <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" className="underline">View {d.pdf}</a>}
    </p>
  );
}

function DecisionBanner({ q }: { q: QuoteDetail }) {
  if (q.status === "needs_approval") return null;
  const when = q.decided_at ? dateTime(q.decided_at) : "";
  if (q.status === "rejected") return (
    <div className="rounded-lg border border-bad-200 bg-bad-50 px-4 py-3 text-sm text-bad-700">
      <div className="flex items-center gap-2 font-semibold"><CircleSlash size={16} aria-hidden /> Rejected by {q.decided_by || "a bypassed gate"}{when && `, ${when}`}. Nothing was sent.</div>
      {q.manager_note && <p className="mt-1 pl-6">Reason: {q.manager_note}</p>}
    </div>
  );
  if (q.status === "auto_sent") return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
      <div className="flex items-center gap-2 font-semibold text-ink-900"><Zap size={16} aria-hidden /> Auto approved and sent, {when}</div>
      <p className="mt-1 pl-6">No pricing rule was triggered: every discount is within the limit, every line is in stock and every item was priced. Sent to {q.email ?? "the customer"}.</p>
      <DeliveryLine q={q} />
    </div>
  );
  return (
    <div className="rounded-lg border border-good-200 bg-good-50 px-4 py-3 text-sm text-good-700">
      <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> Approved by {q.decided_by}, {when}. Sent to {q.email ?? "the customer"}.</div>
      {q.manager_note && <p className="mt-1 pl-6">Note: {q.manager_note}</p>}
      <DeliveryLine q={q} />
    </div>
  );
}

function Explainer({ quote, rules }: { quote: PricedQuote; rules: Rules }) {
  if (quote.lines.length === 0) return null;
  const tiers = [...rules.volume_tiers].sort((a, b) => a.min_qty - b.min_qty);
  return (
    <Card>
      <CardHeader title="How this quote was priced" />
      <div className="px-4 py-3">
        <p className="text-[13px] leading-relaxed text-ink-600">
          The model read the request and wrote the email. It never sees cost and never sets a price. Every number above comes from the pricing rules, run in this order for each line.
        </p>
        <div className="mt-3 grid gap-x-6 gap-y-4 xl:grid-cols-2">
          {quote.lines.map((l, i) => (
            <div key={`${l.sku}-${i}`}>
              <div className="flex items-baseline gap-2 border-b border-ink-100 pb-1.5">
                <span className="font-mono text-xs font-semibold text-ink-900">{l.sku}</span>
                <span className="truncate text-xs text-ink-500">{l.qty.toLocaleString("en-US")} x {l.name}</span>
                <span className="num ml-auto text-xs font-medium text-ink-900">{money(l.unit_price)}</span>
              </div>
              <ol className="mt-1.5 space-y-1">
                {l.trail.map((s, k) => (
                  <li key={k} className="grid grid-cols-[16px_96px_1fr] items-baseline gap-x-2 text-xs leading-snug">
                    <span className="translate-y-0.5" aria-hidden>
                      {s.outcome === "ok" ? <Check size={13} className="text-good-600" /> : s.outcome === "flag" ? <AlertTriangle size={13} className="text-warn-700" /> : s.outcome === "clamped" ? <ShieldAlert size={13} className="text-accent-600" /> : <span className="ml-1 block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-ink-300" />}
                    </span>
                    <span className="font-medium text-ink-800">{s.rule}</span>
                    <span className={cx("num", s.outcome === "flag" ? "text-warn-800" : "text-ink-600")}>{s.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
          Rules in force when this was priced: margin floor {pct(rules.min_margin)} over cost, discounts over {pct(rules.max_discount_without_approval)} need approval, volume tiers {tiers.map((t) => `${t.min_qty}+ units ${pct(t.discount)}`).join(", ")}.{" "}
          <Link to="/rules" className="font-medium text-accent-700 hover:underline">View pricing rules</Link>
        </p>
      </div>
    </Card>
  );
}

const EVENT_TEXT: Record<string, (actor: string) => string> = {
  read_request: () => "Model read the request",
  priced: () => "Pricing code priced the quote",
  drafted_email: () => "Model drafted the email",
  edited_quote: (a) => `${a} edited the quote`,
  edited_email: (a) => `${a} edited the email wording`,
  approved: (a) => `${a} approved`,
  rejected: (a) => `${a} rejected`,
  auto_approved: () => "Auto approved by policy",
  sent: () => "Email sent to the customer",
};

export function Timeline({ events }: { events: HistoryEvent[] }) {
  return (
    <ol className="px-4 py-3">
      {events.map((e, i) => {
        const person = !["model", "pricing code", "policy", "system"].includes(e.actor);
        return (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {i < events.length - 1 && <span className="absolute left-[4.5px] top-3 h-full w-px bg-ink-200" aria-hidden />}
            <span className={cx("relative mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white", e.event === "rejected" ? "bg-bad-600" : e.event === "sent" || e.event === "approved" ? "bg-good-600" : person ? "bg-accent-600" : "bg-ink-300")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-ink-900">{(EVENT_TEXT[e.event] ?? (() => e.event))(e.actor)}</span>
                <span className="num ml-auto shrink-0 text-[11px] text-ink-400" title={dateTime(e.ts)}>{clock(e.ts)}</span>
              </div>
              {e.detail && !["drafted_email", "sent", "edited_email"].includes(e.event) && <div className="text-xs text-ink-500">{e.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
