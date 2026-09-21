// Smoke test of the real UI through the Chrome DevTools Protocol. No test dependencies.
//   make demo   (in another terminal)   then   node scripts/e2e_smoke.mjs
// It resets the demo before and after.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
const base = "http://localhost:8101";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1600,1200", `--user-data-dir=${tmpdir()}/quote-desk-e2e`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2000);
const targets = await (await fetch("http://localhost:9333/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const goto = async (p) => { await send("Page.navigate", { url: base + p }); await sleep(1200); };
const click = (text) => js(`(() => { const b = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled); if (!b) return 'NO BUTTON ${text}'; b.click(); return 'ok'; })()`);
const setInput = (sel, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NO INPUT'; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return 'ok'; })()`);
const text = () => js("document.body.innerText");
const log = (name, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", name, extra);
await send("Page.enable"); await send("Runtime.enable");
const errors = []; 
await fetch(base + "/api/reset", { method: "POST" });

// 1. new request through the drawer
await goto("/inbox?new=1");
await click("Asks for a deep discount"); await sleep(200);
await click("Price this request"); await sleep(1500);
let t = await text(); const url1 = await js("location.pathname");
log("new request lands on its review page", url1 === "/quotes/Q-1038" && t.includes("Hale & Drummond Builders") && t.includes("Held for your approval"), url1);

// 2. edit: change discount, live preview, save
await click("Edit quote"); await sleep(800);
await setInput('input[aria-label="Discount percent for PMP-250"]', "9"); 
await setInput('input[aria-label="Quantity for PMP-250"]', "1"); await sleep(900);
t = await text();
log("live preview reprices (1 x 980 at 9% = 891.80)", t.includes("$891.80"));
await click("Save changes"); await sleep(1500);
t = await text();
log("saved edit re-ran pricing and redrafted email", t.includes("Quote updated") && (await js("document.querySelector('#email-body').value")).includes("$891.80"));

// 3. email wording edit then approve with a note
await setInput("#email-body", (await js("document.querySelector('#email-body').value")).replace("Thanks for your request.", "Thanks Victor, good to hear from you."));
await sleep(200);
t = await text(); log("unsaved wording is flagged", t.includes("Unsaved wording"));
await setInput("#approve-note", "Agreed 9% on the pump by phone"); 
await click("Approve and send"); await sleep(1500);
t = await text();
log("approve moves it to Sent with the note", t.includes("Approved by Marta Kowalski") && t.includes("Agreed 9% on the pump by phone") && !t.includes("Approve and send"));
const out = await (await fetch(base + "/api/outbox")).json();
log("outbox has the edited wording", out.messages[0].request_id === "Q-1038" && out.messages[0].body.includes("good to hear from you"));

// 4. reject needs a reason
await goto("/quotes/Q-1036"); await click("Reject"); await sleep(300);
const disabled = await js("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reject quote').disabled");
await click("Cannot supply in the time they need"); await sleep(200); await click("Reject quote"); await sleep(1200);
t = await text(); log("reject requires a reason then records it", disabled === true && t.includes("Rejected by Marta Kowalski") && t.includes("Nothing was sent"));

// 5. inbox filters and counts
await goto("/inbox?status=rejected"); t = await text();
const rows = await js("document.querySelectorAll('tbody tr').length");
log("rejected tab shows 5 rows and matching count", rows === 5 && /Rejected\s*5/.test(t), `rows=${rows}`);
await goto("/inbox?source=rfq_upload&q=dunmore"); const rows2 = await js("document.querySelectorAll('tbody tr').length");
log("source + search filter", rows2 === 1, `rows=${rows2}`);
await goto("/inbox?q=zzzz"); t = await text(); log("empty state", t.includes("No quotes match these filters"));

// 6. activity record + rules save
await goto("/activity?record=Q-1038"); t = await text();
log("activity shows the decision record and trail", t.includes("Decision record Q-1038") && t.includes("edited the quote") && t.includes("Email sent to the customer"));
await goto("/rules"); await setInput('input[aria-label="Discount limit percent"]', "5"); await sleep(200); await click("Save rules"); await sleep(1000);
t = await text(); log("rules save and show who changed them", t.includes("Changed by Marta Kowalski") && t.includes("Restore defaults"));
await goto("/quotes/Q-9999"); t = await text(); log("unknown quote error state", t.includes("There is no quote Q-9999"));

await click("Reset demo").catch(() => {}); await fetch(base + "/api/reset", { method: "POST" });
ws.close(); chrome.kill();
