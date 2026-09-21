import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, PenLine, Plus, Search } from "lucide-react";
import { useApi, type Counts, type Overview, type QuoteSummary, type Source, type Status } from "../api";
import { useApp } from "../App";
import { age, money } from "../format";
import { Button, Card, Empty, ErrorBox, ReasonChip, SOURCE_LABEL, SkeletonRows, SourceTag, StatusPill, cx, inputClass } from "../ui";
import { StatsStrip } from "../StatsStrip";
import NewRequest from "./NewRequest";

const TABS: { key: Status | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_approval", label: "Needs approval" },
  { key: "auto_sent", label: "Auto approved and sent" },
  { key: "sent", label: "Sent" },
  { key: "rejected", label: "Rejected" },
];

export default function Inbox() {
  const { version } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const list = useApi<{ quotes: QuoteSummary[]; counts: Counts }>("/quotes", version);
  const overview = useApi<Overview>("/overview", version);

  const status = (params.get("status") ?? "all") as Status | "all";
  const source = (params.get("source") ?? "all") as Source | "all";
  const q = params.get("q") ?? "";

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === "" || value === "all") next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  }

  // Tab counts respect the source and search filters, so a count always matches the rows behind it.
  const scoped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data?.quotes ?? []).filter((r) =>
      (source === "all" || r.source === source) &&
      (!needle || [r.id, r.customer, r.company ?? "", r.summary, r.reasons.join(" ")].join(" ").toLowerCase().includes(needle)));
  }, [list.data, source, q]);
  const rows = scoped.filter((r) => status === "all" || r.status === status);
  const count = (k: Status | "all") => (k === "all" ? scoped.length : scoped.filter((r) => r.status === k).length);
  const filtered = source !== "all" || q.trim() !== "";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-ink-500">Every customer request is priced by your rules. Routine quotes go out on their own, anything unusual waits here for you.</p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => set("new", "1")}><Plus size={15} aria-hidden /> New request</Button>
      </div>

      {overview.data ? <StatsStrip o={overview.data} /> : overview.error ? <ErrorBox message={overview.error.message} onRetry={overview.reload} /> : <div className="skeleton h-[104px]" />}

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-200 px-3">
          <div role="tablist" aria-label="Filter by status" className="flex">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={status === t.key} onClick={() => set("status", t.key)}
                className={cx("relative flex h-11 items-center gap-1.5 px-2.5 text-sm font-medium",
                  status === t.key ? "text-ink-900 after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-accent-600" : "text-ink-500 hover:text-ink-800")}>
                {t.label}
                <span className={cx("num rounded-full px-1.5 text-[11px] leading-[18px]", status === t.key ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600")}>{count(t.key)}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 py-1.5">
            <label className="sr-only" htmlFor="source">Source</label>
            <select id="source" value={source} onChange={(e) => set("source", e.target.value)} className={cx(inputClass, "h-8 w-36 pr-7")}>
              <option value="all">All sources</option>
              {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
              <label className="sr-only" htmlFor="search">Search quotes</label>
              <input id="search" value={q} onChange={(e) => set("q", e.target.value)} placeholder="Customer, product, quote number"
                className={cx(inputClass, "h-8 w-64 pl-8")} />
            </div>
          </div>
        </div>

        {list.error ? <div className="p-4"><ErrorBox message={list.error.message} onRetry={list.reload} /></div>
          : !list.data ? <SkeletonRows rows={8} />
          : rows.length === 0 ? (
            <Empty title={filtered ? "No quotes match these filters" : status === "needs_approval" ? "Nothing is waiting for you" : "No quotes here yet"}>
              {filtered ? <button className="text-accent-700 underline underline-offset-2" onClick={() => setParams(status === "all" ? {} : { status })}>Clear filters</button>
                : "New requests are priced the moment they arrive. Use New request to try one."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] table-fixed text-left">
                <colgroup>
                  <col className="w-[104px]" /><col className="w-[190px] 2xl:w-[220px]" /><col /><col className="w-[230px] 2xl:w-[270px]" /><col className="w-[116px]" /><col className="w-[132px]" /><col className="w-[190px] 2xl:w-[206px]" /><col className="w-9" />
                </colgroup>
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-25 text-xs font-medium text-ink-500">
                    <th className="py-2 pl-4 font-medium">Quote</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Request</th>
                    <th className="px-3 py-2 font-medium">Why it needs a person</th>
                    <th className="px-3 py-2 text-right font-medium">Quote total</th>
                    <th className="px-3 py-2 font-medium">Received</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/quotes/${r.id}`)}
                      className={cx("group cursor-pointer hover:bg-accent-50/40", r.status === "needs_approval" && "bg-warn-50/30")}>
                      <td className="py-2.5 pl-4 align-top">
                        <Link to={`/quotes/${r.id}`} onClick={(e) => e.stopPropagation()} className="num text-[13px] font-medium text-ink-900 hover:text-accent-700">{r.id}</Link>
                        <div className="mt-0.5"><SourceTag source={r.source} /></div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="truncate font-medium text-ink-900">{r.company ?? r.customer}</div>
                        <div className="truncate text-xs text-ink-500">{r.company ? r.customer : r.email ?? ""}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="line-clamp-2 text-ink-800 2xl:line-clamp-1" title={r.summary}>{r.summary}</div>
                        <div className="text-xs text-ink-500">{r.line_count} priced {r.line_count === 1 ? "line" : "lines"}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {r.reasons.map((x) => <ReasonChip key={x} tone={r.status === "needs_approval" ? "warn" : "muted"}>{x}</ReasonChip>)}
                          {r.reasons.length === 0 && (r.human_edited
                            ? <span className="inline-flex items-center gap-1 text-xs text-ink-500"><PenLine size={12} aria-hidden /> Resolved by an edit</span>
                            : <span className="text-xs text-ink-400">No rule triggered</span>)}
                        </div>
                      </td>
                      <td className="num px-3 py-2.5 text-right align-top font-medium text-ink-900">{money(r.total)}</td>
                      <td className="num whitespace-nowrap px-3 py-2.5 align-top text-[13px] text-ink-600">{age(r.received_at)}</td>
                      <td className="px-3 py-2.5 align-top"><StatusPill status={r.status} /></td>
                      <td className="pr-3 align-middle text-ink-300 group-hover:text-ink-600"><ChevronRight size={16} aria-hidden /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      {list.data && <p className="mt-3 text-xs text-ink-500">Showing {rows.length} of {list.data.counts.all} requests.</p>}

      {params.get("new") === "1" && <NewRequest onClose={() => set("new", null)} />}
    </>
  );
}
