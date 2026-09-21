import { useState } from "react";
import { useApi, type Product } from "../api";
import { money, pct } from "../format";
import { Card, ErrorBox, PageHeader, SkeletonRows, cx, inputClass } from "../ui";

export default function CatalogPage() {
  const { data, error, reload } = useApi<{ products: Product[] }>("/catalog");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = (data?.products ?? []).filter((p) => !needle || `${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(needle));
  return (
    <>
      <PageHeader title="Catalog" sub="Products, cost and stock as the pricing code sees them. In production this is read from your ERP, here it is a fixture file. The floor price is the lowest any quote can go.">
        <label className="sr-only" htmlFor="cat-q">Search products</label>
        <input id="cat-q" className={cx(inputClass, "w-64")} placeholder="Search SKU or name" value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHeader>
      <Card className="overflow-hidden">
        {error ? <div className="p-4"><ErrorBox message={error.message} onRetry={reload} /></div> : !data ? <SkeletonRows rows={10} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-25 text-xs text-ink-500">
                  <th className="py-2 pl-4 font-medium">SKU</th><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th><th className="px-3 py-2 text-right font-medium">List price</th>
                  <th className="px-3 py-2 text-right font-medium">Margin at list</th><th className="px-3 py-2 text-right font-medium">Floor price</th><th className="py-2 pl-3 pr-4 text-right font-medium">In stock</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-ink-100">
                {rows.map((p) => (
                  <tr key={p.sku}>
                    <td className="py-2 pl-4 font-mono text-xs font-medium">{p.sku}</td>
                    <td className="px-3 py-2 font-medium text-ink-900">{p.name}</td>
                    <td className="px-3 py-2 text-[13px] text-ink-600">{p.category}</td>
                    <td className="px-3 py-2 text-right text-ink-600">{money(p.cost)}</td>
                    <td className="px-3 py-2 text-right">{money(p.list_price)}</td>
                    <td className="px-3 py-2 text-right text-ink-600">{pct(p.list_margin)}</td>
                    <td className="px-3 py-2 text-right text-ink-600">{money(p.floor_price)}</td>
                    <td className={cx("py-2 pl-3 pr-4 text-right", p.stock === 0 ? "font-semibold text-bad-700" : p.stock < 10 ? "font-medium text-warn-800" : "")}>{p.stock === 0 ? "Out of stock" : p.stock.toLocaleString("en-US")}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-500">No product matches "{q}".</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && <p className="mt-3 text-xs text-ink-500">{rows.length} of {data.products.length} products.</p>}
    </>
  );
}
