const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (n: number) => usd.format(n);

export function pct(x: number, digits = 1): string {
  const v = (x * 100).toFixed(digits);
  return `${v.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")}%`;
}

// The server owns the clock (the demo runs on a working-hours clock), the browser only follows it.
let skew = 0;
export const setServerNow = (serverNow: number) => { skew = serverNow - Date.now() / 1000; };
export const serverNow = () => Date.now() / 1000 + skew;

export function age(ts: number, now = serverNow()): string {
  const mins = Math.max(0, Math.round((now - ts) / 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ${mins % 60 ? `${mins % 60} min ` : ""}ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24 ? `${hours % 24} h ` : ""}ago`;
}

export function duration(minutes: number): string {
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function dateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function dayLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}
