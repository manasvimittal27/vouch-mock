import * as W from "../lib/whatsapp.js";
// Single entry point for the whole Vouch mock server (Vercel rewrites every path here).
//   /mcp                                   MCP (Streamable HTTP, stateless JSON) — the one AgenticOrg connector
//   /c/api/pin-codes/json/  /api/dc/expected_tat  /api/cmu/create.json  /api/v1/packages/json/   Delhivery REST mirrors
//   /api/checkout/v1/orders  /api/pay/v1/orders/{id}  /api/pay/v1/orders/{id}/refunds          Pine Labs REST mirrors
//   /pay/{order_id}                        hosted checkout page she opens from WhatsApp (MOCK)
//   /logs  /logs.json                      every tool call as it lands (show this in the recording)
//   /admin?key=...                         out-of-band scenario switches + demo clock
//   /audio/{id}.mp3  /gnani/tts.mp3        Gnani voice replies
import { TOOLS, callTool } from "../lib/tools.js";
import * as D from "../lib/delhivery.js";
import * as P from "../lib/pinelabs.js";
import * as G from "../lib/gnani.js";
import { range, set, get, wipe, push, STORE_KIND } from "../lib/store.js";
import { offsetDays, nowIST, istStamp } from "../lib/clock.js";

const SERVER_INFO = { name: "vouch-mock", version: "0.3.0" };
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const ADMIN_KEY = process.env.ADMIN_KEY || "vouch-admin";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const baseOf = (req) => `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;

function send(res, out) {
  if (out.raw !== undefined) return res.status(out.status).send(out.raw);
  return res.status(out.status).json(out.body);
}

// ---------------- MCP ----------------
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(msg, ctx) {
  const { id, method, params } = msg || {};
  const isNote = id === undefined || id === null;
  switch (method) {
    case "initialize": {
      const v = SUPPORTED_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0];
      return rpcOk(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return rpcOk(id, {});
    case "tools/list":
      return rpcOk(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const r = await callTool(params?.name, params?.arguments || {}, ctx);
      if (!r) return rpcErr(id, -32602, `Unknown tool: ${params?.name}`);
      return rpcOk(id, { content: [{ type: "text", text: r.text }], isError: r.isError });
    }
    default:
      return isNote ? null : rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

async function mcp(req, res, ctx) {
  if (req.method === "GET") {
    if (String(req.headers.accept || "").includes("text/event-stream")) return res.status(405).send("SSE not supported (stateless server)");
    return res.status(200).json({ status: "ok", server: SERVER_INFO, tools: TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json(rpcErr(null, -32700, "Parse error")); } }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleRpc(m, ctx)))).filter(Boolean);
    return replies.length ? res.status(200).json(replies) : res.status(202).end();
  }
  const reply = await handleRpc(body, ctx);
  return reply ? res.status(200).json(reply) : res.status(202).end();
}

// ---------------- REST mirrors ----------------
const needToken = (req, res) => {
  if (!/^Token\s+\S+/.test(req.headers.authorization || "")) { res.status(401).json({ detail: "Authentication credentials were not provided." }); return true; }
  return false;
};
const needBearer = (req, res) => {
  if (!/^Bearer\s+\S+/.test(req.headers.authorization || "")) { res.status(401).json({ code: "UNAUTHORIZED", message: "Missing bearer token" }); return true; }
  return false;
};
async function rest(req, res, path, q, ctx) {
  const viaRest = { ...ctx, via: "rest" };
  if (path === "/c/api/pin-codes/json" && req.method === "GET") {
    if (needToken(req, res)) return;
    const r = await callTool("delhivery_pin_codes_json", { filter_codes: q.get("filter_codes") }, viaRest);
    return res.status(r.status).send(r.text);
  }
  if (path === "/api/dc/expected_tat" && req.method === "GET") {
    if (needToken(req, res)) return;
    const r = await callTool("delhivery_expected_tat", Object.fromEntries(q), viaRest);
    return res.status(r.status).send(r.text);
  }
  if (path === "/api/cmu/create.json" && req.method === "POST") {
    if (needToken(req, res)) return;
    let data = req.body?.data ?? req.body;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { return res.status(400).json({ success: false, rmk: "data is not valid JSON" }); } }
    const s = (data?.shipments || [])[0] || {};
    const r = await callTool("delhivery_create_shipment", { order: s.order, pin: s.pin, payment_mode: s.payment_mode, name: s.name, add: s.add, total_amount: s.total_amount }, viaRest);
    return res.status(r.status).send(r.text);
  }
  if (path === "/api/v1/packages/json" && req.method === "GET") {
    if (needToken(req, res)) return;
    const r = await callTool("delhivery_track", { waybill: q.get("waybill"), ref_ids: q.get("ref_ids") }, viaRest);
    return res.status(r.status).send(r.text);
  }
  if (path === "/api/checkout/v1/orders" && req.method === "POST") {
    if (needBearer(req, res)) return;
    const b = req.body || {};
    const r = await callTool("pinelabs_create_order", { merchant_order_reference: b.merchant_order_reference, amount: b.order_amount?.value, customer_name: b.purchase_details?.customer?.first_name }, viaRest);
    return res.status(r.status).send(r.text);
  }
  let m = /^\/api\/pay\/v1\/orders\/([^/]+)$/.exec(path);
  if (m && req.method === "GET") {
    if (needBearer(req, res)) return;
    const r = await callTool("pinelabs_get_order_status", { order_id: m[1] }, viaRest);
    return res.status(r.status).send(r.text);
  }
  m = /^\/api\/pay\/v1\/orders\/([^/]+)\/refunds$/.exec(path);
  if (m && req.method === "POST") {
    if (needBearer(req, res)) return;
    const r = await callTool("pinelabs_initiate_refund", { order_id: m[1], amount: req.body?.refund_amount?.value }, viaRest);
    return res.status(r.status).send(r.text);
  }
  return false;
}

// ---------------- HTML helpers ----------------
const page = (title, body, extraHead = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${extraHead}<style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1c22;--muted:#6b6a73;--line:#e6e4de;--teal:#0f6e56;--red:#c2410c;--violet:#534ab7}
@media (prefers-color-scheme:dark){:root{--bg:#141317;--card:#1d1c22;--ink:#f1f0ec;--muted:#a3a1aa;--line:#2e2d34}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:20px;margin:6px 0 2px}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
code,pre{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:0}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;background:#e9f4ef;color:var(--teal)}
.tag.err{background:#fdece4;color:var(--red)}.tag.v{background:#eeecff;color:var(--violet)}
a.btn,button{display:inline-block;border:0;border-radius:10px;padding:11px 16px;font-weight:600;font-size:15px;text-decoration:none;cursor:pointer;margin:4px 4px 4px 0}
.go{background:var(--teal);color:#fff}.no{background:transparent;color:var(--red);border:1px solid var(--red)!important}.sm{padding:6px 10px;font-size:13px;background:var(--card);color:var(--ink);border:1px solid var(--line)!important}
.on{outline:2px solid var(--teal)}
</style></head><body><div class="wrap">${body}</div></body></html>`;

async function payPage(req, res, id, q) {
  const outcome = q.get("outcome");
  if (outcome) {
    const o = await P.completePayment(id, outcome === "success" ? "success" : "fail");
    if (!o) return res.status(404).send(page("Not found", "<h1>Order not found</h1>"));
    const okp = o.status === "PROCESSED";
    return res.status(200).send(page("Payment", `<div class="card"><span class="tag">Pine Labs Plural · sandbox (MOCK)</span>
      <h1>${okp ? "Payment successful" : "Payment failed"}</h1><p class="muted">${okp ? "You can go back to WhatsApp. Vouch will confirm your order." : "UPI request expired. Nothing was charged. Ask Vouch for a fresh link."}</p>
      <p><code>${esc(o.order_id)} · ${esc(o.status)}</code></p></div>`));
  }
  const o = await get(`pl:order:${id}`);
  if (!o) return res.status(404).send(page("Not found", "<h1>Order not found</h1>"));
  const rupees = (o.order_amount.value / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 });
  const done = o.status !== "CREATED" && o.status !== "FAILED";
  return res.status(200).send(page("Pay ₹" + rupees, `<div class="card"><span class="tag">Pine Labs Plural · sandbox checkout (MOCK — no real money)</span>
    <h1>Pay ₹${rupees}</h1><p class="muted">Order ${esc(o.order_id)} · ref ${esc(o.merchant_order_reference)}</p>
    ${done ? `<p>Status: <b>${esc(o.status)}</b></p>` : `<a class="btn go" href="/pay/${esc(id)}?outcome=success">Pay ₹${rupees} with UPI</a>
    <a class="btn no" href="/pay/${esc(id)}?outcome=fail">Simulate UPI timeout</a>`}</div>`));
}

async function logsPage(res, json) {
  const calls = await range("calls", 150);
  if (json) return res.status(200).json({ store: STORE_KIND, calls, outbox: await range("outbox", 50), inbox: await range("inbox", 50), wa_status: await range("wa_status", 50) });
  const rows = calls.map((c) => `<tr><td><code>${esc(c.ts)}</code><br><span class="muted">${esc(c.via)} · ${c.ms} ms</span></td>
    <td><b>${esc(c.tool)}</b><br><span class="tag ${c.status >= 400 ? "err" : ""}">${esc(c.rail || "")} · ${c.status}</span></td>
    <td><pre>${esc(JSON.stringify(c.args))}</pre></td><td><pre>${esc(c.result)}</pre></td></tr>`).join("");
  return res.status(200).send(page("Vouch tool calls", `<h1>Tool calls landing on the Vouch connector</h1>
    <p class="muted">Newest first · auto-refreshes every 4 s · store: ${STORE_KIND} · demo clock ${istStamp(await nowIST())}</p>
    <div class="card" style="overflow-x:auto"><table><tr><th>When</th><th>Tool</th><th>Arguments received</th><th>Response</th></tr>${rows || '<tr><td colspan="4" class="muted">No calls yet.</td></tr>'}</table></div>`,
    '<meta http-equiv="refresh" content="4">'));
}

const SWITCHES = [
  ["catalog_item", "Checkout item check (pinelabs_catalog_get_item)", ["normal", "price_jump", "out_of_stock"]],
  ["payment", "Payment status (pinelabs_get_order_status)", ["normal", "timeout"]],
  ["tracking", "Delivery (delhivery_track)", ["normal", "delayed", "delivered"]],
  ["exchange", "Doorstep exchange", ["normal", "no_stock", "slow"]],
  ["whatsapp", "Outbound WhatsApp (whatsapp_send)", ["live", "dry"]]
];

async function admin(req, res, q) {
  if (q.get("key") !== ADMIN_KEY) return res.status(401).send(page("Admin", "<h1>Admin key required</h1><p class='muted'>Open /admin?key=YOUR_KEY</p>"));
  const k = encodeURIComponent(ADMIN_KEY);
  if (q.get("set")) {
    const name = q.get("set");
    if (name === "clock") await set("clock_offset_days", Number(q.get("v") || 0));
    else if (SWITCHES.some((s) => s[0] === name)) await set(`scn:${name}`, { mode: q.get("v") || "normal", product_id: q.get("product_id") || undefined, waybill: q.get("waybill") || undefined });
    return res.redirect(302, `/admin?key=${k}`);
  }
  if (q.get("reset") === "all") { await wipe(); return res.redirect(302, `/admin?key=${k}`); }
  let html = `<h1>Vouch mock · scenario switches</h1><p class="muted">Out of band: the agent never sees which scenario is armed. Store: ${STORE_KIND}. Demo clock: ${istStamp(await nowIST())} (offset ${await offsetDays()} days)</p>`;
  for (const [name, label, modes] of SWITCHES) {
    const cur = ((await get(`scn:${name}`)) || { mode: "normal" }).mode;
    html += `<div class="card"><b>${esc(label)}</b><br>${modes.map((m) => `<a class="btn sm ${m === cur ? "on" : ""}" href="/admin?key=${k}&set=${name}&v=${m}${name === "catalog_item" ? "&product_id=P01" : ""}">${m}</a>`).join("")}</div>`;
  }
  const off = await offsetDays();
  html += `<div class="card"><b>Demo clock (days ahead of real time)</b><br>${[0, 1, 2, 3, 5, 7, 9, 12].map((d) => `<a class="btn sm ${d === off ? "on" : ""}" href="/admin?key=${k}&set=clock&v=${d}">+${d}</a>`).join("")}</div>
  <div class="card"><b>Delhivery failure pincodes</b><p class="muted">000001 timeout (12 s) · 000002 malformed JSON · 000003 HTTP 500 · 744301 not serviceable · 194101 ODA</p></div>
  <div class="card"><a class="btn no" href="/admin?key=${k}&reset=all">Reset all demo state</a> <a class="btn sm" href="/logs">Open /logs</a></div>`;
  return res.status(200).send(page("Vouch admin", html));
}

// ---------------- router ----------------
export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const path = (u.searchParams.has("__path") ? "/" + u.searchParams.get("__path") : u.pathname).replace(/\/+$/, "") || "/";
  u.searchParams.delete("__path");
  const q = u.searchParams;
  const ctx = { base: baseOf(req) };
  try {
    if (path === "/mcp" || path === "/api/mcp") return await mcp(req, res, ctx);
    if (path === "/" || path === "/health") {
      return res.status(200).json({ status: "ok", service: SERVER_INFO, store: STORE_KIND, gnani_configured: Boolean(process.env.GNANI_API_KEY), whatsapp_provider: W.PROVIDER(), mcp_endpoint: "/mcp", tools: TOOLS.length, logs: "/logs", time: new Date().toISOString() });
    }
    if (path === "/twilio/inbound" && req.method === "POST") {
      // Twilio WhatsApp sandbox → "When a message comes in" webhook (form-encoded). Stores the real message.
      const b = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
      const media = [];
      for (let i = 0; i < Number(b.NumMedia || 0); i++) media.push({ media_url: b[`MediaUrl${i}`], content_type: b[`MediaContentType${i}`] });
      const msg = { message_sid: b.MessageSid || b.SmsSid || "", from: String(b.From || "").replace(/^whatsapp:/, ""), to: String(b.To || "").replace(/^whatsapp:/, ""), profile_name: b.ProfileName || "", body: b.Body || "", media, received_at: istStamp(await nowIST()) };
      await push("inbox", msg, 200);
      await push("calls", { ts: msg.received_at, real_ts: new Date().toISOString(), via: "twilio-webhook", tool: "INBOUND WhatsApp", rail: "Twilio WhatsApp", args: { from: msg.from }, status: 200, ms: 0, result: JSON.stringify({ body: msg.body, media: msg.media.length }) });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send("<Response></Response>");
    }
    if (path === "/vonage/inbound" && req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      await W.vonageInbound(body, ctx.base);
      return res.status(200).json({ ok: true });
    }
    if (path === "/vonage/status") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.message_uuid) await push("wa_status", { uuid: body.message_uuid, status: body.status, to: body.to, error: body.error?.title || body.error?.detail || null, at: new Date().toISOString() }, 200);
      return res.status(200).json({ ok: true });
    }
    if (path === "/vonage/media") {
      const f = await W.vonageMedia(q.get("u") || "");
      if (!f) return res.status(404).send("media not found");
      res.setHeader("Content-Type", f.type);
      return res.status(200).send(f.bytes);
    }
    if (path === "/meta/webhook") {
      if (req.method === "GET") { const v = W.metaVerify(q); return res.status(v.status).send(v.text); }
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      await W.metaInbound(body, ctx.base);
      return res.status(200).json({ ok: true });
    }
    let mm = /^\/meta\/media\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (mm) {
      const f = await W.metaMedia(mm[1]);
      if (!f) return res.status(404).send("media not found");
      res.setHeader("Content-Type", f.type);
      return res.status(200).send(f.bytes);
    }
    if (path === "/logs") return await logsPage(res, false);
    if (path === "/logs.json") return await logsPage(res, true);
    if (path === "/admin") return await admin(req, res, q);
    let m = /^\/pay\/([^/]+)$/.exec(path);
    if (m) return await payPage(req, res, m[1], q);
    m = /^\/audio\/([a-z0-9]+)\.mp3$/.exec(path);
    if (m) {
      const buf = await G.storedAudio(m[1]);
      if (!buf) return res.status(404).send("audio expired");
      res.setHeader("Content-Type", "audio/mpeg");
      return res.status(200).send(buf);
    }
    if (path === "/gnani/tts.mp3") {
      const out = await G.synthesize(q.get("text") || "", q.get("lang") === "en-IN" ? "en-IN" : "hi-IN", q.get("lang") === "en-IN" ? "Kaveri" : "Poorvi");
      if (!out.ok) return res.status(out.status || 502).send(out.error);
      res.setHeader("Content-Type", "audio/mpeg");
      return res.status(200).send(out.bytes);
    }
    const handled = await rest(req, res, path, q, ctx);
    if (handled !== false) return;
    return res.status(404).json({ error: "not_found", path });
  } catch (e) {
    return res.status(500).json({ error: "internal_error", message: String(e?.message || e).slice(0, 200) });
  }
}
