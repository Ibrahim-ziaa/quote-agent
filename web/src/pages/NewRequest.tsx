import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, X } from "lucide-react";
import { api, type ApiError, type QuoteDetail, type Source } from "../api";
import { useApp } from "../App";
import { Button, ErrorBox, SOURCE_LABEL, cx, inputClass } from "../ui";

const SAMPLES: { label: string; source: Source; customer: string; company: string; email: string; message: string; attachment?: string }[] = [
  { label: "Routine order", source: "web_form", customer: "Mina Castellan", company: "Castellan Nurseries", email: "mina@castellannurseries.example",
    message: "Hi, could I get 4 sump pumps and 12 float switches for our potting sheds? Thanks." },
  { label: "Asks for a deep discount", source: "email", customer: "Victor Hale", company: "Hale & Drummond Builders", email: "victor@haledrummond.example",
    message: "Hello,\n\nWe are fitting out a site and need 2 2.5hp pumps, 40 3/4 inch ball valves and 6 lengths of 20m hose. Can you do 18% off?\n\nRegards,\nVictor Hale" },
  { label: "RFQ with an unknown item", source: "rfq_upload", customer: "Buying office", company: "Lowmoor Textiles", email: "buying@lowmoortextiles.example", attachment: "lowmoor-rfq-0417.csv",
    message: "sku, description, qty\nVLV-C10, Check valve 1 inch, 30\nFLT-Y10, Y strainer 1 inch, 12\n8 steam trap valves DN25" },
];

export default function NewRequest({ onClose }: { onClose: () => void }) {
  const { bump, meta } = useApp();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source>("web_form");
  const [customer, setCustomer] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const s = SAMPLES[Number(new URLSearchParams(window.location.search).get("sample")) - 1];   // ?new=1&sample=2 opens with an example filled in
    if (s) { setSource(s.source); setCustomer(s.customer); setCompany(s.company); setEmail(s.email); setMessage(s.message); setAttachment(s.attachment ?? null); }
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 100_000) { setError("That file is over 100 KB. Paste the lines instead."); return; }
    setMessage(await file.text());
    setAttachment(file.name);
    setSource("rfq_upload");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) { setError("Paste the customer's message first."); return; }
    setBusy(true); setError(null);
    try {
      const created = await api<QuoteDetail>("/quotes", { method: "POST", body: { message, source, customer, company, email, attachment } });
      bump();
      navigate(`/quotes/${created.id}`);
    } catch (err) {
      setError((err as ApiError).message); setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="new-title">
      <div className="absolute inset-0 bg-ink-900/25" onClick={onClose} />
      <form onSubmit={submit} className="relative flex h-full w-full max-w-[520px] flex-col border-l border-ink-200 bg-white shadow-xl">
        <header className="flex items-start gap-3 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 id="new-title" className="text-base font-semibold">New request</h2>
            <p className="mt-0.5 text-sm text-ink-500">Paste what the customer sent. It runs through the same steps as every request: read, price, draft, then the approval check.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-ink-500 hover:bg-ink-100"><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-600">Try an example</div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLES.map((s) => (
                <button key={s.label} type="button" className="rounded-md border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50"
                  onClick={() => { setSource(s.source); setCustomer(s.customer); setCompany(s.company); setEmail(s.email); setMessage(s.message); setAttachment(s.attachment ?? null); setError(null); }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-600">Came in by</legend>
            <div className="inline-flex rounded-md border border-ink-300 p-0.5">
              {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
                <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)}
                  className={cx("rounded px-3 py-1 text-sm font-medium", source === s ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900")}>
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name"><input className={cx(inputClass, "w-full")} value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
            <Field label="Company"><input className={cx(inputClass, "w-full")} value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          </div>
          <Field label="Reply to email"><input type="email" className={cx(inputClass, "w-full")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.example" /></Field>

          <Field label={source === "rfq_upload" ? "RFQ lines" : "Customer message"}>
            <textarea ref={first} value={message} onChange={(e) => setMessage(e.target.value)} rows={10}
              placeholder={source === "rfq_upload" ? "VLV-050 x 200\nPMP-100 x 3" : "We need 3 one horsepower pumps and 200 half inch valves. Can you do 15% off?"}
              className={cx(inputClass, "h-auto w-full resize-y py-2 leading-relaxed", source === "rfq_upload" && "font-mono text-[13px]")} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink-300 px-3 py-2.5 text-sm text-ink-600 hover:bg-ink-50">
            <Upload size={15} aria-hidden />
            {attachment ? <span>Loaded <span className="font-medium text-ink-900">{attachment}</span></span> : <span>Upload an RFQ file (.csv or .txt)</span>}
            <input type="file" accept=".csv,.txt,text/plain,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          {error && <ErrorBox message={error} />}

          <div className="rounded-md border border-ink-200 bg-ink-25 px-4 py-3">
            <div className="text-xs font-semibold text-ink-700">What happens when you press the button</div>
            <ol className="mt-2 space-y-1.5 text-[13px] text-ink-600">
              {[
                ["Read", "The model lists the products, quantities and any discount the customer asked for."],
                ["Price", "Code matches each item to the catalog, checks stock and applies your pricing rules."],
                ["Draft", "The model writes the email around the exact numbers it is given."],
                ["Check", "If no rule is triggered the quote is sent. Otherwise it waits in the inbox for approval."],
              ].map(([step, text], i) => (
                <li key={step} className="grid grid-cols-[18px_44px_1fr] gap-x-1.5"><span className="num text-ink-400">{i + 1}</span><span className="font-medium text-ink-800">{step}</span><span>{text}</span></li>
              ))}
            </ol>
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-ink-200 bg-ink-25 px-5 py-3">
          <p className="text-xs text-ink-500">{meta?.mode === "live" ? "Live model reads the message." : "Demo mode: a scripted stand-in reads the message."} Prices always come from the pricing code.</p>
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Price this request</Button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-600">{label}</span>
      {children}
    </label>
  );
}
