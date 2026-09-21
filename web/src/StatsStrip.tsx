import type { Overview } from "./api";
import { duration, money, pct } from "./format";

export function StatsStrip({ o }: { o: Overview }) {
  const auto = o.auto_share ?? 0;
  return (
    <dl className="grid grid-cols-2 divide-ink-200 rounded-lg border border-ink-200 bg-white lg:grid-cols-4 lg:divide-x">
      <Stat label={`Quotes, last ${o.days} days`} value={String(o.quotes)}
        foot={`${money(o.sent_value)} sent to customers`} />
      <Stat label="Sent without a person" value={o.auto_share === null ? "No data" : pct(auto, 0)}
        foot={
          <span className="flex items-center gap-2">
            <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-warn-200" aria-hidden>
              <span className="bg-ink-700" style={{ width: `${auto * 100}%` }} />
            </span>
            {o.auto_sent} auto approved, {o.needed_person} needed a person
          </span>
        } />
      <Stat label="Median time to approval" value={o.median_minutes_to_approval === null ? "No data" : duration(o.median_minutes_to_approval)}
        foot={`across ${o.approved_by_person} quotes approved by a person`} />
      <Stat label="Value awaiting approval" value={money(o.awaiting_value)} accent={o.awaiting > 0}
        foot={o.awaiting ? `${o.awaiting} quotes, oldest waiting ${duration(o.oldest_waiting_minutes)}` : "Nothing is waiting"} />
    </dl>
  );
}

function Stat({ label, value, foot, accent }: { label: string; value: string; foot: React.ReactNode; accent?: boolean }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className={`num mt-1 text-2xl font-semibold tracking-tight ${accent ? "text-warn-800" : "text-ink-900"}`}>{value}</dd>
      <dd className="mt-1 text-xs text-ink-500">{foot}</dd>
    </div>
  );
}
