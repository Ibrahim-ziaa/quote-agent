import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleSlash, Clock3, FileSpreadsheet, Globe, Loader2, Mail, Zap } from "lucide-react";
import type { Source, Status } from "./api";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const STATUS_LABEL: Record<Status, string> = {
  needs_approval: "Needs approval",
  auto_sent: "Auto approved and sent",
  sent: "Sent",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<Status, string> = {
  needs_approval: "bg-warn-50 text-warn-800 ring-warn-200",
  auto_sent: "bg-ink-100 text-ink-700 ring-ink-200",
  sent: "bg-good-50 text-good-700 ring-good-200",
  rejected: "bg-bad-50 text-bad-700 ring-bad-200",
};

const STATUS_ICON: Record<Status, typeof Clock3> = {
  needs_approval: Clock3,
  auto_sent: Zap,
  sent: CheckCircle2,
  rejected: CircleSlash,
};

export function StatusPill({ status, short = false }: { status: Status; short?: boolean }) {
  const Icon = STATUS_ICON[status];
  const label = short && status === "auto_sent" ? "Auto sent" : STATUS_LABEL[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_STYLE[status])}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  );
}

export const SOURCE_LABEL: Record<Source, string> = { web_form: "Web form", email: "Email", rfq_upload: "RFQ upload" };
const SOURCE_ICON: Record<Source, typeof Mail> = { web_form: Globe, email: Mail, rfq_upload: FileSpreadsheet };

export function SourceTag({ source }: { source: Source }) {
  const Icon = SOURCE_ICON[source] ?? Globe;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
      <Icon size={13} aria-hidden />
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

export function ReasonChip({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "bad" | "muted" }) {
  const style = tone === "bad" ? "bg-bad-50 text-bad-700 ring-bad-200" : tone === "muted" ? "bg-ink-50 text-ink-600 ring-ink-200" : "bg-warn-50 text-warn-800 ring-warn-200";
  return <span className={cx("inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", style)}>{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerSolid"; busy?: boolean; size?: "sm" | "md" };

export function Button({ variant = "secondary", busy, size = "md", className, children, disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm",
    secondary: "bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 shadow-sm",
    ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
    danger: "bg-white text-bad-700 ring-1 ring-inset ring-ink-300 hover:bg-bad-50 hover:ring-bad-200 shadow-sm",
    dangerSolid: "bg-bad-600 text-white hover:bg-bad-700 shadow-sm",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm", styles, className)}
    >
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-ink-200 bg-white", className)}>{children}</section>;
}

export function CardHeader({ title, tag, children }: { title: string; tag?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-11 items-center gap-2.5 border-b border-ink-200 px-4 py-2">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      {tag}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}

/** Who produced this block: the model, the pricing code, or a person. */
export function Origin({ by }: { by: "code" | "model" | "customer" }) {
  const text = { code: "Calculated by pricing code", model: "Written by the model", customer: "As received" }[by];
  const style = { code: "text-accent-700 bg-accent-50 ring-accent-200", model: "text-ink-600 bg-ink-50 ring-ink-200", customer: "text-ink-600 bg-ink-50 ring-ink-200" }[by];
  return <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", style)}>{text}</span>;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink-900">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-ink-500">{sub}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad-200 bg-bad-50 px-4 py-3 text-sm text-bad-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="font-medium underline underline-offset-2">Try again</button>}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-9" style={{ opacity: 1 - i * 0.12 }} />)}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-500">{children}</div>}
    </div>
  );
}

export const inputClass =
  "h-9 rounded-md border border-ink-300 bg-white px-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent-600 focus:ring-2 focus:ring-accent-100";
