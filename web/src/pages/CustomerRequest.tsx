import { useMemo, useState } from "react";
import { CheckCircle2, FileText, Loader2, Minus, Plus, Search, Send, ShoppingCart, Trash2 } from "lucide-react";
import { api, useApi, type ApiError, type QuoteDetail } from "../api";

// The distributor's public "Request a quote" page, what a customer sees on the website. It shows list
// prices and availability, never cost, margin or exact stock. A submission is sent as a plain message,
// so it goes through the same model read, pricing code and approval gate as an email would.

type Availability = "in_stock" | "low_stock" | "out_of_stock";
interface StoreProduct { sku: string; name: string; category: string; list_price: number; availability: Availability }
interface CartLine { sku: string; name: string; qty: number; availability: Availability }

const field = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";
const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD" });
const AVAIL: Record<Availability, { label: string; cls: string }> = {
  in_stock: { label: "In stock", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  low_stock: { label: "Low stock", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  out_of_stock: { label: "Out of stock", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

function Badge({ a }: { a: Availability }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${AVAIL[a].cls}`}>{AVAIL[a].label}</span>;
}

export default function CustomerRequest() {
  const products = useApi<{ products: StoreProduct[] }>("/storefront/catalog").data?.products ?? [];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<QuoteDetail | null>(null);

  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const shown = products.filter((p) => (category === "All" || p.category === category)
    && (!query || `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase())));

  function add(p: StoreProduct) {
    setCart((c) => c.some((l) => l.sku === p.sku) ? c.map((l) => l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l)
      : [...c, { sku: p.sku, name: p.name, qty: 1, availability: p.availability }]);
  }
  const setQty = (sku: string, qty: number) => setCart((c) => c.map((l) => l.sku === sku ? { ...l, qty: Math.max(1, Math.min(100000, qty || 1)) } : l));
  const remove = (sku: string) => setCart((c) => c.filter((l) => l.sku !== sku));

  function compose(): string {
    const lines = cart.map((l) => `- ${l.qty} x ${l.sku} ${l.name}`);
    return [lines.length ? `Hi, I'd like a quote for:\n${lines.join("\n")}` : "", notes.trim()].filter(Boolean).join("\n\n");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length && !notes.trim()) { setError("Add at least one product or describe what you need."); return; }
    setBusy(true); setError(null);
    try {
      setDone(await api<QuoteDetail>("/quotes", { method: "POST", body: { message: compose(), source: "web_form", customer, company, email } }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally { setBusy(false); }
  }

  const sent = done && (done.status === "auto_sent" || done.status === "sent");
  const anyOut = cart.some((l) => l.availability === "out_of_stock");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0f2a43] text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-white text-sm font-bold text-[#0f2a43]">CB</div>
          <div>
            <div className="text-lg font-semibold leading-tight">Calder Bay Industrial Supply</div>
            <div className="text-xs text-slate-300">Pumps, valves, fittings and hose</div>
          </div>
          <nav className="ml-auto hidden gap-6 text-sm text-slate-300 sm:flex">
            <span>Products</span><span>Industries</span><span className="font-medium text-white">Request a quote</span>
          </nav>
        </div>
        <div className="h-1 bg-teal-600" />
      </header>

      {done ? (
        <main className="mx-auto max-w-2xl px-6 py-12">
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <CheckCircle2 size={36} className="text-teal-700" aria-hidden />
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Thanks{done.customer ? `, ${done.customer.split(" ")[0]}` : ""}. We have your request.</h1>
            <p className="mt-2 text-sm text-slate-600">Reference <span className="font-semibold text-slate-900">{done.id}</span>.{" "}
              {sent ? `Your quote has been emailed to ${done.email} with a PDF attached.`
                : `Our sales team is checking it and will email the quote to ${done.email} with a PDF attached.`}</p>
            <button onClick={() => { setDone(null); setCart([]); setNotes(""); }} className="mt-6 text-sm font-medium text-teal-700 underline">Request another quote</button>
          </div>
        </main>
      ) : (
        <form onSubmit={submit} className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_380px]">
          {/* catalog */}
          <section className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Request a quote</h1>
            <p className="mt-1 text-sm text-slate-500">Pick products and quantities, or describe what you need. Your quote arrives by email with a PDF attached.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products or SKU" className={`${field} pl-9`} />
              </div>
              {categories.map((c) => (
                <button type="button" key={c} onClick={() => setCategory(c)}
                  className={`h-9 rounded-full px-3 text-sm font-medium ${category === c ? "bg-[#0f2a43] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{c}</button>
              ))}
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {shown.map((p, i) => {
                const inCart = cart.some((l) => l.sku === p.sku);
                return (
                  <div key={p.sku} className={`flex items-center gap-4 px-4 py-3 ${i ? "border-t border-slate-100" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.sku} · {p.category}</div>
                    </div>
                    <Badge a={p.availability} />
                    <div className="w-24 text-right text-sm tabular-nums text-slate-700">{usd(p.list_price)}<div className="text-[11px] text-slate-400">list, each</div></div>
                    <button type="button" onClick={() => add(p)}
                      className={`inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium ${inCart ? "bg-teal-50 text-teal-800 ring-1 ring-teal-600/30" : "bg-teal-700 text-white hover:bg-teal-800"}`}>
                      <Plus size={14} aria-hidden /> {inCart ? "Add 1 more" : "Add"}
                    </button>
                  </div>
                );
              })}
              {!shown.length && <div className="px-4 py-8 text-center text-sm text-slate-500">No products match. Describe it in the notes and we will find it.</div>}
            </div>
          </section>

          {/* request */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900"><ShoppingCart size={16} aria-hidden /> Your request</div>
              {cart.length === 0 ? <p className="mt-3 text-sm text-slate-500">No products yet. Add from the list, or just describe what you need below.</p> : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {cart.map((l) => (
                    <li key={l.sku} className="py-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900">{l.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">{l.sku} <Badge a={l.availability} /></div>
                        </div>
                        <button type="button" onClick={() => remove(l.sku)} className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${l.name}`}><Trash2 size={15} /></button>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <button type="button" onClick={() => setQty(l.sku, l.qty - 1)} className="grid h-7 w-7 place-items-center rounded border border-slate-300 text-slate-600" aria-label="Less"><Minus size={13} /></button>
                        <input value={l.qty} onChange={(e) => setQty(l.sku, parseInt(e.target.value, 10))} inputMode="numeric"
                          className="h-7 w-16 rounded border border-slate-300 text-center text-sm tabular-nums" aria-label={`Quantity of ${l.name}`} />
                        <button type="button" onClick={() => setQty(l.sku, l.qty + 1)} className="grid h-7 w-7 place-items-center rounded border border-slate-300 text-slate-600" aria-label="More"><Plus size={13} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {anyOut && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Some items are out of stock. A sales manager will confirm availability and a delivery date before your quote is sent.</p>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid gap-3">
                <label className="text-sm font-medium text-slate-700">Your name<input required value={customer} onChange={(e) => setCustomer(e.target.value)} className={`${field} mt-1`} maxLength={120} /></label>
                <label className="text-sm font-medium text-slate-700">Company<input value={company} onChange={(e) => setCompany(e.target.value)} className={`${field} mt-1`} maxLength={120} /></label>
                <label className="text-sm font-medium text-slate-700">Email for the quote<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} mt-1`} maxLength={200} /></label>
                <label className="text-sm font-medium text-slate-700">Anything else?
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000}
                    placeholder="Delivery date, other items, or a discount you'd like us to consider" className={`${field} mt-1`} />
                </label>
              </div>
              {error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              <button type="submit" disabled={busy}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60">
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />} Request my quote
              </button>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500"><FileText size={13} className="mt-0.5 shrink-0" aria-hidden /> Routine orders are quoted in minutes. Anything unusual, like a bigger discount or limited stock, is checked by a sales manager first.</p>
            </div>
            <p className="text-xs text-slate-400">Demo website. Calder Bay and every customer are fictional.</p>
          </aside>
        </form>
      )}
    </div>
  );
}
