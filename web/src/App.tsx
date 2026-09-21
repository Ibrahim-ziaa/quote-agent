import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { api, useApi, type Counts, type Meta, type QuoteSummary } from "./api";
import { cx } from "./ui";
import Inbox from "./pages/Inbox";
import QuoteReview from "./pages/QuoteReview";
import Activity from "./pages/Activity";
import OverviewPage from "./pages/Overview";
import RulesPage from "./pages/Rules";
import CatalogPage from "./pages/Catalog";

interface AppState { version: number; bump: () => void; meta: Meta | null }
const Ctx = createContext<AppState>({ version: 0, bump: () => {}, meta: null });
export const useApp = () => useContext(Ctx);

const NAV = [
  { to: "/inbox", label: "Inbox" },
  { to: "/overview", label: "Overview" },
  { to: "/activity", label: "Activity log" },
  { to: "/rules", label: "Pricing rules" },
  { to: "/catalog", label: "Catalog" },
];

export default function App() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const meta = useApi<Meta>("/meta").data;
  const counts = useApi<{ quotes: QuoteSummary[]; counts: Counts }>("/quotes", version).data?.counts;
  const [resetting, setResetting] = useState(false);
  const location = useLocation();
  const state = useMemo(() => ({ version, bump, meta }), [version, bump, meta]);

  async function reset() {
    setResetting(true);
    try { await api("/reset", { method: "POST" }); bump(); } finally { setResetting(false); }
  }

  return (
    <Ctx.Provider value={state}>
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
          <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-6 px-6">
            <NavLink to="/inbox" className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-bold tracking-tight text-ink-900">Quote Desk</span>
              <span className="hidden text-xs text-ink-500 xl:inline">{meta?.distributor ?? ""}</span>
            </NavLink>
            <nav className="flex h-full items-stretch gap-1" aria-label="Main">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to}
                  className={({ isActive }) => cx("relative flex items-center gap-1.5 px-2.5 text-sm font-medium transition-colors",
                    isActive || (n.to === "/inbox" && location.pathname.startsWith("/quotes")) ? "text-ink-900 after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-accent-600" : "text-ink-500 hover:text-ink-900")}>
                  {n.label}
                  {n.to === "/inbox" && counts && counts.needs_approval > 0 && (
                    <span className="num rounded-full bg-warn-100 px-1.5 text-[11px] font-semibold leading-[18px] text-warn-800">{counts.needs_approval}</span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <span title="Fictional distributor and customers. The model is a scripted stand-in, the pricing code and approval flow are real."
                className="rounded border border-dashed border-ink-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                Demo data{meta?.mode === "live" ? ", live model" : ""}
              </span>
              <button onClick={reset} disabled={resetting}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-50">
                <RotateCcw size={13} className={resetting ? "animate-spin" : ""} aria-hidden /> Reset demo
              </button>
              <div className="border-l border-ink-200 pl-4 text-right leading-tight">
                <div className="text-[13px] font-medium text-ink-900">{meta?.user ?? ""}</div>
                <div className="text-[11px] text-ink-500">{meta?.role ?? ""}</div>
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-6 py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/quotes/:id" element={<QuoteReview />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="*" element={<div className="py-20 text-center text-sm text-ink-500">That page does not exist. <NavLink className="text-accent-700 underline" to="/inbox">Back to the inbox</NavLink></div>} />
          </Routes>
        </main>
      </div>
    </Ctx.Provider>
  );
}
