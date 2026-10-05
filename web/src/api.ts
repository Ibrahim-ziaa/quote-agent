import { useCallback, useEffect, useRef, useState } from "react";
import { setServerNow } from "./format";

export type Status = "needs_approval" | "auto_sent" | "sent" | "rejected";
export type Source = "web_form" | "email" | "rfq_upload";
export type ReasonCode = "discount_over_limit" | "short_stock" | "unpriced_items" | "no_items";

export interface QuoteSummary {
  id: string;
  status: Status;
  source: Source;
  customer: string;
  company: string | null;
  email: string | null;
  received_at: number;
  decided_at: number | null;
  decided_by: string | null;
  summary: string;
  line_count: number;
  total: number;
  reason_codes: ReasonCode[];
  reasons: string[];
  human_edited: boolean;
}

export interface TrailStep { rule: string; outcome: "info" | "ok" | "flag" | "clamped"; detail: string }

export interface QuoteLine {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  list_price: number;
  discount: number;
  margin: number;
  in_stock: boolean;
  notes: string[];
  cost: number;
  stock: number;
  floor_price: number;
  volume_discount: number;
  requested_discount: number;
  discount_override: number | null;
  flags: string[];
  trail: TrailStep[];
  total: number;
}

export interface RequestedItem { text?: string; qty?: number; requested_discount?: number; sku?: string }
export interface Unpriced { item: RequestedItem; reason: string }

export interface PricedQuote {
  lines: QuoteLine[];
  rejected: Unpriced[];
  total: number;
  list_total: number;
  reasons: { code: ReasonCode; sku: string | null; text: string }[];
}

export interface Rules {
  min_margin: number;
  max_discount_without_approval: number;
  volume_tiers: { min_qty: number; discount: number }[];
}

export interface HistoryEvent { ts: number; actor: string; event: string; detail: string }

export interface QuoteDetail extends QuoteSummary {
  message: string;
  attachment: string | null;
  extracted_items: RequestedItem[];
  quote: PricedQuote;
  needs_manager: string[];
  draft_email: string;
  manager_note: string;
  rules: Rules;
  history: HistoryEvent[];
  sent_at: number | null;
  delivery: Delivery | null;
}

export interface Delivery { status: "delivered" | "failed" | "not_on_allowlist" | "recorded"; detail: string; to: string | null; ts: number; pdf: string }

export interface Preview { quote: PricedQuote; needs_manager: string[] }

export interface Counts { needs_approval: number; auto_sent: number; sent: number; rejected: number; all: number }

export interface Overview {
  days: number;
  quotes: number;
  auto_sent: number;
  needed_person: number;
  auto_share: number | null;
  approved_by_person: number;
  rejected: number;
  awaiting: number;
  awaiting_value: number;
  sent_value: number;
  median_minutes_to_approval: number | null;
  decided_by_person: number;
  oldest_waiting_minutes: number;
  reasons: { code: ReasonCode; label: string; count: number }[];
  daily: { start: number; total: number; needs_approval: number; auto_sent: number; sent: number; rejected: number }[];
  channels: { source: Source; quotes: number; auto_sent: number; needed_person: number; auto_share: number | null; value: number }[];
  top_customers: { customer: string; quotes: number; value: number; sent_value: number; waiting: number }[];
}

export interface ActivityRecord {
  id: string;
  ts: number;
  outcome: "auto_sent" | "sent" | "rejected";
  decided_by: string;
  customer: string;
  company: string | null;
  total: number;
  note: string;
  human_edited: boolean;
  reasons: string[];
  minutes_to_decision: number | null;
  record: Record<string, unknown> & {
    history?: HistoryEvent[];
    draft_email?: string;
    rules?: Rules;
    quote?: PricedQuote;
    request?: { email?: string | null; source?: Source; received_at?: number };
  };
}

export interface Product {
  sku: string;
  name: string;
  category: string;
  cost: number;
  list_price: number;
  stock: number;
  floor_price: number;
  list_margin: number;
}

export interface Meta { product: string; mode: "demo" | "live"; user: string; role: string; distributor: string; email?: { enabled: boolean; sender: string | null; allowlist: string[] } }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the Quote Desk server. Check that it is running.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) detail = data.detail[0].msg;
    } catch { /* keep the generic message */ }
    throw new ApiError(res.status, detail);
  }
  const data = await res.json();
  if (data && typeof data.now === "number") setServerNow(data.now);
  return data as T;
}

/** Fetch on mount and whenever `path` or `version` changes. Keeps the last data while reloading. */
export function useApi<T>(path: string | null, version = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    if (lastPath.current !== path) setData(null);
    lastPath.current = path;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: ApiError) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, version, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
