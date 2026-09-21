import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PenLine, X } from "lucide-react";
import { useApi, type ActivityRecord } from "../api";
import { useApp } from "../App";
import { dateTime, duration, money, pct } from "../format";
import { Card, Empty, ErrorBox, PageHeader, SkeletonRows, StatusPill, cx } from "../ui";
import { Timeline } from "./QuoteReview";

const FILTERS = [
  { key: "all", label: "All decisions" },
  { key: "person", label: "Decided by a person" },
  { key: "auto", label: "Auto approved" },
  { key: "rejected", label: "Rejected" },
] as const;

export default function Activity() {
  const { version } = useApp();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useApi<{ records: ActivityRecord[]; log_file: string }>("/activity", version);
  const filter = (params.get("show") ?? "all") as (typeof FILTERS)[number]["key"];
  const selectedId = params.get("record");

  const records = (data?.records ?? []).filter((r) =>
    filter === "all" || (filter === "person" && r.outcome !== "auto_sent") || (filter === "auto" && r.outcome === "auto_sent") || (filter === "rejected" && r.outcome === "rejected"));
  const selected = data?.records.find((r) => r.id === selectedId) ?? null;

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader title="Activity log"
        sub={<>Who approved what, and when. One record is appended per decision with the full quote, the rules in force and the email as sent{data ? <> (file: <span className="font-mono text-xs">{data.log_file}</span>)</> : null}. Records are never edited.</>} />
      <div className={cx("grid items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_520px]")}>
        <Card className="overflow-hidden">
          <div className="flex gap-1 border-b border-ink-200 px-3 py-2">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => set("show", f.key)} aria-pressed={filter === f.key}
                className={cx("rounded-md px-2.5 py-1 text-sm font-medium", filter === f.key ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100")}>{f.label}</button>
            ))}
            {data && <span className="num ml-auto self-center text-xs text-ink-500">{records.length} records</span>}
          </div>
          {error ? <div className="p-4"><ErrorBox message={error.message} onRetry={reload} /></div>
            : !data ? <SkeletonRows rows={8} />
            : records.length === 0 ? <Empty title="No decisions recorded yet">Approve or reject a quote from the inbox and the record appears here.</Empty>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left">
                  <thead>
                    <tr className="border-b border-ink-200 bg-ink-25 text-xs text-ink-500">
                      <th className="py-2 pl-4 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Quote</th>
                      <th className="px-3 py-2 font-medium">Decision</th>
                      <th className="px-3 py-2 font-medium">Decided by</th>
                      <th className="px-3 py-2 text-right font-medium">Time to decision</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      {!selected && <th className="px-3 py-2 font-medium">Note</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {records.map((r) => (
                      <tr key={r.id} onClick={() => set("record", r.id === selectedId ? null : r.id)} aria-selected={r.id === selectedId}
                        className={cx("cursor-pointer align-top hover:bg-accent-50/40", r.id === selectedId && "bg-accent-50")}>
                        <td className="num whitespace-nowrap py-2.5 pl-4 text-[13px] text-ink-600">{dateTime(r.ts)}</td>
                        <td className="px-3 py-2.5">
                          <div className="num text-[13px] font-medium">{r.id}</div>
                          <div className="max-w-[200px] truncate text-xs text-ink-500">{r.company ?? r.customer}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill status={r.outcome} short />
                          {r.human_edited && <div className="mt-1 flex items-center gap-1 text-[11px] text-ink-500"><PenLine size={11} aria-hidden /> edited first</div>}
                        </td>
                        <td className="px-3 py-2.5 text-[13px]">{r.decided_by || "Gate bypassed"}</td>
                        <td className="num px-3 py-2.5 text-right text-[13px] text-ink-600">{r.outcome === "auto_sent" ? "instant" : r.minutes_to_decision !== null ? duration(r.minutes_to_decision) : ""}</td>
                        <td className="num px-3 py-2.5 text-right font-medium">{money(r.total)}</td>
                        {!selected && <td className="max-w-[340px] px-3 py-2.5 text-[13px] text-ink-600"><div className="line-clamp-2">{r.outcome === "auto_sent" ? <span className="text-ink-400">No rule triggered</span> : r.note || <span className="text-ink-400">No note</span>}</div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
        {selected && <RecordPanel r={selected} onClose={() => set("record", null)} />}
      </div>
    </>
  );
}

function RecordPanel({ r, onClose }: { r: ActivityRecord; onClose: () => void }) {
  const [raw, setRaw] = useState(false);
  const rec = r.record;
  return (
    <Card className="sticky top-[72px] max-h-[calc(100vh-96px)] overflow-y-auto">
      <header className="flex items-start gap-3 border-b border-ink-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h2 className="num text-sm font-semibold">Decision record {r.id}</h2><StatusPill status={r.outcome} short /></div>
          <p className="mt-0.5 truncate text-xs text-ink-500">{r.company ? `${r.company}, ` : ""}{r.customer}</p>
        </div>
        <button onClick={onClose} aria-label="Close record" className="ml-auto rounded p-1 text-ink-500 hover:bg-ink-100"><X size={16} /></button>
      </header>
      <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 border-b border-ink-100 px-4 py-3 text-[13px]">
        <dt className="text-ink-500">Decided by</dt><dd className="font-medium">{r.decided_by || "Gate bypassed"}</dd>
        <dt className="text-ink-500">When</dt><dd className="num">{dateTime(r.ts)}</dd>
        <dt className="text-ink-500">Quote total</dt><dd className="num font-medium">{money(r.total)}</dd>
        <dt className="text-ink-500">Rules triggered</dt><dd>{r.reasons.length ? r.reasons.join(", ") : "None"}</dd>
        <dt className="text-ink-500">{r.outcome === "rejected" ? "Reason" : "Note"}</dt><dd>{r.note || <span className="text-ink-400">None</span>}</dd>
        {rec.rules && <><dt className="text-ink-500">Rules in force</dt><dd className="num text-ink-700">floor {pct(rec.rules.min_margin)}, approval over {pct(rec.rules.max_discount_without_approval)}, tiers {[...rec.rules.volume_tiers].reverse().map((t) => `${t.min_qty}+ ${pct(t.discount)}`).join(", ")}</dd></>}
        <dt className="text-ink-500">Sent to</dt><dd>{r.outcome === "rejected" ? <span className="text-ink-400">Nothing sent</span> : rec.request?.email ?? "customer"}</dd>
      </dl>
      {rec.quote && rec.quote.lines.length > 0 && (
        <table className="w-full border-b border-ink-100 text-left text-[13px]">
          <thead><tr className="text-xs text-ink-500"><th className="py-2 pl-4 font-medium">Line</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Discount</th><th className="px-2 py-2 text-right font-medium">Unit</th><th className="py-2 pl-2 pr-4 text-right font-medium">Total</th></tr></thead>
          <tbody className="num divide-y divide-ink-100 border-t border-ink-100">
            {rec.quote.lines.map((l, i) => (
              <tr key={i}><td className="py-1.5 pl-4"><span className="font-mono text-xs">{l.sku}</span></td><td className="px-2 text-right">{l.qty}</td><td className="px-2 text-right">{pct(l.discount)}</td><td className="px-2 text-right">{money(l.unit_price)}</td><td className="pl-2 pr-4 text-right">{money(l.total)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-b border-ink-100"><div className="px-4 pt-3 text-xs font-semibold text-ink-500">Trail</div><Timeline events={rec.history ?? []} /></div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Link to={`/quotes/${r.id}`} className="text-[13px] font-medium text-accent-700 hover:underline">Open quote</Link>
        <button onClick={() => setRaw((v) => !v)} className="text-[13px] font-medium text-accent-700 hover:underline">{raw ? "Hide" : "Show"} raw log line</button>
      </div>
      {raw && <pre className="max-h-96 overflow-auto border-t border-ink-100 bg-ink-900 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-100">{JSON.stringify(rec, null, 2)}</pre>}
    </Card>
  );
}
