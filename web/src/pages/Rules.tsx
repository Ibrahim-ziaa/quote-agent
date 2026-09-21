import { useEffect, useState } from "react";
import { AlertTriangle, Check, Lock, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { api, useApi, type ApiError, type Preview, type Product, type Rules } from "../api";
import { dateTime, money, pct } from "../format";
import { Button, Card, CardHeader, ErrorBox, Origin, PageHeader, SkeletonRows, cx, inputClass } from "../ui";

interface RulesResponse { rules: Rules; defaults: Rules; is_default: boolean; changed: { by: string; at: number } | null }
interface Form { margin: string; limit: string; tiers: { min_qty: string; discount: string }[] }

const toForm = (r: Rules): Form => ({
  margin: String(+(r.min_margin * 100).toFixed(2)),
  limit: String(+(r.max_discount_without_approval * 100).toFixed(2)),
  tiers: [...r.volume_tiers].sort((a, b) => a.min_qty - b.min_qty).map((t) => ({ min_qty: String(t.min_qty), discount: String(+(t.discount * 100).toFixed(2)) })),
});
const fromForm = (f: Form): Rules => ({
  min_margin: (parseFloat(f.margin) || 0) / 100,
  max_discount_without_approval: (parseFloat(f.limit) || 0) / 100,
  volume_tiers: f.tiers.map((t) => ({ min_qty: parseInt(t.min_qty, 10) || 0, discount: (parseFloat(t.discount) || 0) / 100 })),
});

export default function RulesPage() {
  const { data, error, reload, setData } = useApi<RulesResponse>("/rules");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  useEffect(() => { if (data) setForm(toForm(data.rules)); }, [data]);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;

  const dirty = !!data && !!form && JSON.stringify(toForm(data.rules)) !== JSON.stringify(form);

  async function save(rules: Rules) {
    setSaving(true); setSaveError(null);
    try { setData(await api<RulesResponse>("/rules", { method: "PUT", body: rules })); setSaved((n) => n + 1); }
    catch (e) { setSaveError((e as ApiError).message); }
    finally { setSaving(false); }
  }

  const num = "num h-9 w-24 rounded-md border border-ink-300 px-2.5 text-right text-sm focus:border-accent-600 focus:ring-2 focus:ring-accent-100";

  return (
    <>
      <PageHeader title="Pricing rules"
        sub="These are the thresholds the pricing code runs on every request. The model cannot see or change them. Tighten a limit and more quotes wait for you, loosen it and more go out on their own." />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Thresholds" tag={<Origin by="code" />}>
            {data && !data.is_default && <span className="text-xs text-ink-500">Changed by {data.changed?.by}{data.changed ? `, ${dateTime(data.changed.at)}` : ""}</span>}
          </CardHeader>
          {!form || !data ? <SkeletonRows rows={6} /> : (
            <form onSubmit={(e) => { e.preventDefault(); save(fromForm(form)); }}>
              <Section title="Volume discounts" help="Applied automatically by quantity on each line. If the customer asks for more than the tier gives, the larger of the two is used.">
                <table className="text-left text-sm">
                  <thead><tr className="text-xs text-ink-500"><th className="pb-1.5 pr-4 font-medium">From quantity</th><th className="pb-1.5 pr-4 font-medium">Discount off list</th><th /></tr></thead>
                  <tbody>
                    {form.tiers.map((t, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-4"><span className="inline-flex items-center gap-2"><input aria-label={`Tier ${i + 1} minimum quantity`} className={num} inputMode="numeric" value={t.min_qty} onChange={(e) => setForm({ ...form, tiers: form.tiers.map((x, j) => (j === i ? { ...x, min_qty: e.target.value.replace(/\D/g, "") } : x)) })} /><span className="text-ink-500">units or more</span></span></td>
                        <td className="py-1 pr-4"><span className="inline-flex items-center gap-2"><input aria-label={`Tier ${i + 1} discount percent`} className={num} inputMode="decimal" value={t.discount} onChange={(e) => setForm({ ...form, tiers: form.tiers.map((x, j) => (j === i ? { ...x, discount: e.target.value.replace(/[^\d.]/g, "") } : x)) })} /><span className="text-ink-500">%</span></span></td>
                        <td><button type="button" aria-label={`Remove tier ${i + 1}`} onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, j) => j !== i) })} className="rounded p-1.5 text-ink-400 hover:bg-bad-50 hover:text-bad-700"><Trash2 size={15} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {form.tiers.length < 6 && <button type="button" onClick={() => setForm({ ...form, tiers: [...form.tiers, { min_qty: "", discount: "" }] })} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent-700 hover:underline"><Plus size={14} aria-hidden /> Add a tier</button>}
              </Section>

              <Section title="Margin floor" help="No quote goes below cost plus this margin, whoever asks and whatever discount is typed. The price is held at the floor and the discount shrinks to match.">
                <span className="inline-flex items-center gap-2 text-sm"><input aria-label="Margin floor percent" className={num} inputMode="decimal" value={form.margin} onChange={(e) => setForm({ ...form, margin: e.target.value.replace(/[^\d.]/g, "") })} /><span className="text-ink-500">% over cost, minimum</span></span>
              </Section>

              <Section title="When a person must approve" help="A quote that triggers none of these is sent on its own. Everything else waits in the inbox.">
                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-center gap-2.5"><AlertTriangle size={15} className="shrink-0 text-warn-700" aria-hidden /><span>Any line discounted more than</span><input aria-label="Discount limit percent" className={cx(num, "w-20")} inputMode="decimal" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value.replace(/[^\d.]/g, "") })} /><span>%</span></li>
                  <Fixed>Any line where stock on hand is less than the quantity asked for</Fixed>
                  <Fixed>Any item that could not be priced: not in the catalog, or no quantity given</Fixed>
                  <Fixed>Any quote a person has edited, even if the edit cleared every flag</Fixed>
                </ul>
              </Section>

              {saveError && <div className="px-5 pb-4"><ErrorBox message={saveError} /></div>}
              <footer className="flex flex-wrap items-center gap-3 border-t border-ink-200 bg-ink-25 px-5 py-3">
                <p className="max-w-md text-xs text-ink-500">Changes apply to new requests and to any quote you edit afterwards. Quotes already waiting keep the numbers they were priced with.</p>
                <div className="ml-auto flex items-center gap-2">
                  {saved > 0 && !dirty && <span className="inline-flex items-center gap-1 text-xs font-medium text-good-700"><Check size={13} aria-hidden /> Saved</span>}
                  {!data.is_default && <Button type="button" variant="ghost" onClick={() => save(data.defaults)} disabled={saving}>Restore defaults</Button>}
                  <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>Save rules</Button>
                </div>
              </footer>
            </form>
          )}
        </Card>

        <div className="space-y-4">
          <TryAPrice key={saved} rules={data?.rules} />
          <Card>
            <CardHeader title="Who does what" />
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-ink-100">
                {[
                  ["Understand the customer's message", "Model", "Free text is what models are good at"],
                  ["Match products and check stock", "Code", "The catalog and stock levels are the source of truth"],
                  ["Price, discounts and margin floor", "Code", "Rules you can read, change and test"],
                  ["Write the customer email", "Model", "It is handed exact numbers and only phrases them"],
                  ["Decide to send a flagged quote", "You", "The send step checks for approval again before anything leaves"],
                ].map(([step, who, why]) => (
                  <tr key={step}>
                    <td className="py-2.5 pl-4 pr-3 font-medium text-ink-900">{step}</td>
                    <td className="px-3 py-2.5"><span className={cx("rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", who === "Code" ? "bg-accent-50 text-accent-700 ring-accent-200" : who === "You" ? "bg-ink-900 text-white ring-ink-900" : "bg-ink-50 text-ink-600 ring-ink-200")}>{who}</span></td>
                    <td className="py-2.5 pl-3 pr-4 text-ink-600">{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}

function Section({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-3 border-b border-ink-100 px-5 py-5 md:grid-cols-[240px_1fr]">
      <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">{help}</p></div>
      <div>{children}</div>
    </div>
  );
}

function Fixed({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2.5 text-ink-800"><Lock size={14} className="mt-[3px] shrink-0 text-ink-400" aria-hidden /><span>{children} <span className="text-xs text-ink-500">(always on)</span></span></li>;
}

function TryAPrice({ rules }: { rules?: Rules }) {
  const products = useApi<{ products: Product[] }>("/catalog").data?.products;
  const [sku, setSku] = useState("PMP-500");
  const [qty, setQty] = useState("2");
  const [asked, setAsked] = useState("10");
  const [result, setResult] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const n = parseInt(qty, 10);
    if (!n) { setErr("Enter a quantity."); return; }
    const t = setTimeout(() => {
      api<Preview>(`/price-check?sku=${encodeURIComponent(sku)}&qty=${n}&asked=${(parseFloat(asked) || 0) / 100}`)
        .then((r) => { setResult(r); setErr(null); }).catch((e: ApiError) => setErr(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [sku, qty, asked, rules]);

  const line = result?.quote.lines[0];
  return (
    <Card>
      <CardHeader title="Try a price" tag={<span className="text-xs text-ink-500">runs the saved rules, sends nothing</span>} />
      <div className="flex flex-wrap items-end gap-3 px-4 pt-4">
        <label className="min-w-[220px] flex-1 text-xs font-medium text-ink-600">Product
          <select className={cx(inputClass, "mt-1 block w-full")} value={sku} onChange={(e) => setSku(e.target.value)}>
            {(products ?? [{ sku, name: "" } as Product]).map((p) => <option key={p.sku} value={p.sku}>{p.sku}  {p.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-600">Quantity<input className={cx(inputClass, "num mt-1 block w-24 text-right")} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} /></label>
        <label className="text-xs font-medium text-ink-600">Customer asks, % off<input className={cx(inputClass, "num mt-1 block w-28 text-right")} inputMode="decimal" value={asked} onChange={(e) => setAsked(e.target.value.replace(/[^\d.]/g, ""))} /></label>
      </div>
      <div className="p-4">
        {err ? <ErrorBox message={err} /> : !line ? <div className="skeleton h-40" /> : (
          <>
            <div className="num flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md bg-ink-50 px-4 py-3">
              <div><div className="text-xs text-ink-500">Unit price</div><div className="text-xl font-semibold">{money(line.unit_price)}</div></div>
              <div><div className="text-xs text-ink-500">Discount</div><div className="text-base font-medium">{pct(line.discount)}</div></div>
              <div><div className="text-xs text-ink-500">Margin</div><div className="text-base font-medium">{pct(line.margin)}</div></div>
              <div><div className="text-xs text-ink-500">Line total</div><div className="text-base font-medium">{money(line.total)}</div></div>
              <div className="ml-auto self-center">
                {result.needs_manager.length ? <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-50 px-2.5 py-1 text-xs font-medium text-warn-800 ring-1 ring-inset ring-warn-200"><AlertTriangle size={12} aria-hidden /> Would wait for approval</span>
                  : <span className="inline-flex items-center gap-1.5 rounded-full bg-good-50 px-2.5 py-1 text-xs font-medium text-good-700 ring-1 ring-inset ring-good-200"><Check size={12} aria-hidden /> Would send on its own</span>}
              </div>
            </div>
            <ol className="mt-3 space-y-1.5">
              {line.trail.map((s, k) => (
                <li key={k} className="grid grid-cols-[16px_110px_1fr] items-baseline gap-x-2 text-[13px] leading-snug">
                  <span className="translate-y-0.5" aria-hidden>{s.outcome === "ok" ? <Check size={13} className="text-good-600" /> : s.outcome === "flag" ? <AlertTriangle size={13} className="text-warn-700" /> : s.outcome === "clamped" ? <ShieldAlert size={13} className="text-accent-600" /> : <span className="ml-1 block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-ink-300" />}</span>
                  <span className="font-medium">{s.rule}</span>
                  <span className={cx("num", s.outcome === "flag" ? "text-warn-800" : "text-ink-600")}>{s.detail}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Card>
  );
}
