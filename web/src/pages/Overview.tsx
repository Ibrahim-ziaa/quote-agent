import { Link } from "react-router-dom";
import { useApi, type Overview } from "../api";
import { useApp } from "../App";
import { dayLabel, money, pct } from "../format";
import { Card, CardHeader, ErrorBox, PageHeader, SOURCE_LABEL } from "../ui";
import { StatsStrip } from "../StatsStrip";

const SERIES = [
  { key: "auto_sent", label: "Auto approved and sent", color: "var(--color-ink-700)" },
  { key: "sent", label: "Approved by a person", color: "var(--color-good-600)" },
  { key: "rejected", label: "Rejected", color: "var(--color-bad-600)" },
  { key: "needs_approval", label: "Still waiting", color: "var(--color-warn-200)" },
] as const;

export default function OverviewPage() {
  const { version } = useApp();
  const { data: o, error, reload } = useApi<Overview>("/overview", version);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Overview" sub="How much of the quoting runs itself, and how long customers wait when it does not. Every figure is counted from the requests in the inbox." />
      {!o ? <div className="skeleton h-[104px]" /> : (
        <>
          <StatsStrip o={o} />
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card>
                <CardHeader title="Requests per day, by outcome" />
                <div className="p-4"><DailyChart o={o} /></div>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader title="By channel" />
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-ink-200 bg-ink-25 text-xs text-ink-500">
                    <th className="py-2 pl-4 font-medium">Came in by</th><th className="px-3 py-2 text-right font-medium">Requests</th><th className="px-3 py-2 font-medium">Sent without a person</th>
                    <th className="px-3 py-2 text-right font-medium">Needed a person</th><th className="py-2 pl-3 pr-4 text-right font-medium">Value quoted</th>
                  </tr></thead>
                  <tbody className="num divide-y divide-ink-100">
                    {o.channels.map((c) => (
                      <tr key={c.source}>
                        <td className="py-2.5 pl-4 font-medium text-ink-900">{SOURCE_LABEL[c.source]}</td>
                        <td className="px-3 py-2.5 text-right">{c.quotes}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-100" aria-hidden><span className="block h-full bg-ink-700" style={{ width: `${(c.auto_share ?? 0) * 100}%` }} /></span>
                            {c.auto_share === null ? "No requests" : `${pct(c.auto_share, 0)} (${c.auto_sent})`}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">{c.needed_person}</td>
                        <td className="py-2.5 pl-3 pr-4 text-right font-medium">{money(c.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader title="Why quotes needed a person" />
                <div className="space-y-3 p-4">
                  {o.reasons.length === 0 && <p className="text-sm text-ink-500">No rule was triggered in this period.</p>}
                  {o.reasons.map((r) => (
                    <div key={r.code}>
                      <div className="flex items-baseline text-[13px]"><span className="font-medium">{r.label}</span><span className="num ml-auto text-ink-600">{r.count} of {o.needed_person} quotes</span></div>
                      <div className="mt-1 h-2 rounded-full bg-ink-100"><div className="h-2 rounded-full bg-warn-700/70" style={{ width: `${(r.count / Math.max(1, o.needed_person)) * 100}%` }} /></div>
                    </div>
                  ))}
                  <p className="pt-1 text-xs text-ink-500">A quote can trigger more than one rule. The thresholds are on the <Link to="/rules" className="font-medium text-accent-700 hover:underline">pricing rules</Link> page.</p>
                </div>
              </Card>
              <Card>
                <CardHeader title="What people decided" />
                <dl className="num grid grid-cols-3 divide-x divide-ink-100 text-center">
                  <Mini label="Approved" value={o.approved_by_person} />
                  <Mini label="Rejected" value={o.rejected} />
                  <Mini label="Waiting now" value={o.awaiting} />
                </dl>
                <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500">
                  {o.decided_by_person > 0 ? `${pct(o.rejected / o.decided_by_person, 0)} of reviewed quotes were stopped before reaching a customer.` : "No quotes reviewed yet."} {money(o.sent_value)} of quotes went out in total.
                </p>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader title="Customers by value quoted" />
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-ink-200 bg-ink-25 text-xs text-ink-500">
                    <th className="py-2 pl-4 font-medium">Customer</th><th className="px-3 py-2 text-right font-medium">Requests</th><th className="px-3 py-2 text-right font-medium">Quoted</th><th className="py-2 pl-3 pr-4 text-right font-medium">Sent</th>
                  </tr></thead>
                  <tbody className="num divide-y divide-ink-100">
                    {o.top_customers.map((c) => (
                      <tr key={c.customer}>
                        <td className="py-2 pl-4"><span className="font-medium text-ink-900">{c.customer}</span>{c.waiting > 0 && <span className="ml-2 rounded bg-warn-50 px-1.5 py-0.5 text-[11px] font-medium text-warn-800 ring-1 ring-inset ring-warn-200">{c.waiting} waiting</span>}</td>
                        <td className="px-3 py-2 text-right">{c.quotes}</td>
                        <td className="px-3 py-2 text-right">{money(c.value)}</td>
                        <td className="py-2 pl-3 pr-4 text-right text-ink-600">{money(c.sent_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return <div className="px-3 py-4"><dd className="text-xl font-semibold">{value}</dd><dt className="mt-0.5 text-xs text-ink-500">{label}</dt></div>;
}

function DailyChart({ o }: { o: Overview }) {
  const W = 760, H = 260, padL = 28, padB = 28, padT = 20;
  const max = Math.max(4, ...o.daily.map((d) => d.total));
  const top = Math.ceil(max / 2) * 2;
  const slot = (W - padL) / o.daily.length;
  const bar = Math.min(56, slot * 0.55);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = Array.from({ length: top / 2 + 1 }, (_, i) => i * 2);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Requests per day for the last ${o.days} days, stacked by outcome`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-ink-100)" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-500)" className="num">{t}</text>
          </g>
        ))}
        {o.daily.map((d, i) => {
          const x = padL + slot * i + (slot - bar) / 2;
          let acc = 0;
          return (
            <g key={i}>
              {SERIES.map((s) => {
                const v = d[s.key];
                if (!v) return null;
                const y0 = y(acc + v), h = y(acc) - y0;
                acc += v;
                return <rect key={s.key} x={x} y={y0 + 1} width={bar} height={Math.max(0, h - 1)} fill={s.color} rx="1.5"><title>{`${s.label}: ${v}`}</title></rect>;
              })}
              {d.total > 0 && <text x={x + bar / 2} y={y(d.total) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-ink-800)" className="num">{d.total}</text>}
              <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-ink-500)">{i === o.daily.length - 1 ? "Today" : dayLabel(d.start)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-600">
        {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}</span>)}
      </figcaption>
    </figure>
  );
}
