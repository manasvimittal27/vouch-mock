import * as W from "../lib/whatsapp.js";
// Single entry point for the whole Vouch mock server (Vercel rewrites every path here).
//   /mcp                                   MCP (Streamable HTTP, stateless JSON) — the one AgenticOrg connector
//   /c/api/pin-codes/json/  /api/dc/expected_tat  /api/cmu/create.json  /api/v1/packages/json/   Delhivery REST mirrors
//   /api/checkout/v1/orders  /api/pay/v1/orders/{id}  /api/pay/v1/orders/{id}/refunds          Pine Labs REST mirrors
//   /pay/{order_id}                        hosted checkout page she opens from WhatsApp (MOCK)
//   /shop, /p/{product_id}                sample shop pages for the demo catalogue (MOCK)
//   /track/{waybill}                       parcel-tracking page she opens from WhatsApp (MOCK, same data as delhivery_track)
//   /logs  /logs.json                      every tool call as it lands (show this in the recording)
//   /admin?key=...                         out-of-band scenario switches + demo clock
//   /audio/{id}.mp3  /gnani/tts.mp3        Gnani voice replies
import { TOOLS, callTool } from "../lib/tools.js";
import * as D from "../lib/delhivery.js";
import { PRODUCTS, MERCHANTS, SIZES, byId } from "../lib/catalog.js";
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

// Her parcel-tracking page (MOCK, Delhivery sandbox look). Same data as the delhivery_track tool, so the page and the agent always agree.
async function trackPage(res, wb) {
  const out = await D.track({ waybill: wb });
  const sh = out.body?.ShipmentData?.[0]?.Shipment;
  if (!sh) return res.status(404).send(page("Tracking", `<div class="card"><span class="tag">Delhivery · sandbox tracking (MOCK)</span><h1>No shipment found</h1><p class="muted">Waybill ${esc(wb)} is not in the sandbox.</p></div>`));
  const st = sh.Status.Status;
  const fmt = (d) => { if (!d) return "—"; const x = new Date(d + "T00:00:00Z"); return x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
  const steps = sh.OrderType === "Pickup" ? ["Manifested", "Out for Pickup", "Picked Up"] : ["Manifested", "In Transit", "Out for Delivery", "Delivered"];
  const cur = Math.max(0, steps.indexOf(st === "Delayed" ? "In Transit" : st));
  const delayed = st === "Delayed";
  const late = sh.ExpectedDeliveryDate && sh.PromisedDeliveryDate && sh.ExpectedDeliveryDate > sh.PromisedDeliveryDate;
  const tl = steps.map((s, i) => `<li class="${i < cur ? "done" : i === cur ? (delayed ? "now late" : "now") : ""}"><span class="dot"></span><div><b>${esc(s)}</b>${i === cur ? `<div class="muted">${esc(sh.Status.Instructions)} · ${esc(sh.Status.StatusLocation)} · ${esc(sh.Status.StatusDateTime)}</div>` : ""}</div></li>`).join("");
  const big = st === "Delivered" ? `Delivered on ${fmt(sh.DeliveryDate)}` : st === "Picked Up" ? `Picked up on ${fmt(sh.DeliveryDate)}` : `Arriving by ${fmt(sh.ExpectedDeliveryDate)}`;
  const css = `<style>.tl{list-style:none;padding:0;margin:14px 0 4px}.tl li{display:flex;gap:12px;padding:0 0 18px;position:relative}.tl li:not(:last-child)::before{content:"";position:absolute;left:7px;top:18px;bottom:0;width:2px;background:var(--line)}.tl li.done::before{background:var(--teal)}.dot{flex:none;width:16px;height:16px;border-radius:50%;border:2px solid var(--line);background:var(--card);margin-top:2px}.done .dot{background:var(--teal);border-color:var(--teal)}.now .dot{border-color:var(--teal);box-shadow:0 0 0 4px #e9f4ef}.late .dot{border-color:var(--red);box-shadow:0 0 0 4px #fdece4}.big{font-size:24px;font-weight:700;margin:6px 0}.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px}.warn{background:#fdece4;color:var(--red);border-radius:10px;padding:10px 12px;font-size:14px;margin-top:10px}</style>`;
  return res.status(200).send(page(`Track ${wb}`, `<div class="card" style="max-width:520px;margin:0 auto">
    <span class="tag">Delhivery · sandbox tracking (MOCK, demo data)</span>
    <div class="big">${esc(big)}</div>
    <div class="muted">AWB ${esc(sh.AWB)} · ${esc(sh.Origin)} → ${esc(sh.Destination)}</div>
    ${delayed || late ? `<div class="warn">Delayed: first promised for ${fmt(sh.PromisedDeliveryDate)}, now expected ${fmt(sh.ExpectedDeliveryDate)}.</div>` : ""}
    <ol class="tl">${tl}</ol>
    <div class="kv"><span class="muted">Order ref</span><span>${esc(sh.ReferenceNo)}</span><span class="muted">Pickup date</span><span>${fmt(sh.PickUpDate)}</span><span class="muted">Promised</span><span>${fmt(sh.PromisedDeliveryDate)}</span><span class="muted">Payment</span><span>${esc(sh.OrderType === "Prepaid" ? "Prepaid (paid via Pine Labs)" : sh.OrderType)}</span></div>
    <p class="muted" style="font-size:12px;margin-top:14px">Questions about this delivery? Reply to Vouch on WhatsApp.</p></div>`, css));
}

// ---------------- Sample shop pages (MOCK catalogue, demo data) ----------------
const SWATCH = { "mint green": "#9fd8c3", mint: "#a8e0cc", "powder blue": "#b9d4ef", lavender: "#cbbbe8", peach: "#f6c3a5", "sage green": "#b5c9a5", "blush pink": "#f2c4cf", ivory: "#f3ecd9", "pastel yellow": "#f5e3a1", emerald: "#2e8a63", maroon: "#7a1f2b", "rani pink": "#d6336c", wine: "#6b1f3a", "marigold yellow": "#f2a516", champagne: "#e9d8b8", coral: "#f08a6c", red: "#c62828" };
const CAT = { anarkali: "Anarkali", kurta_set: "Kurta set", kurta: "Kurta", dress: "Dress", lehenga: "Lehenga", saree: "Saree", sharara_set: "Sharara set", coord_set: "Co-ord set" };
const rs = (n) => "₹" + Number(n).toLocaleString("en-IN");
const shopCss = `<style>.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}.pc{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--ink);display:flex;flex-direction:column}.sw{aspect-ratio:4/3;display:flex;align-items:flex-end;padding:10px;font-size:12px;font-weight:600;color:#1d1c22;text-shadow:0 1px 0 rgba(255,255,255,.4)}.pc .b{padding:10px 12px;display:flex;flex-direction:column;gap:3px}.pr{font-size:17px;font-weight:700}.strike{text-decoration:line-through;color:var(--muted);font-weight:400;font-size:13px;margin-left:6px}.sz{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.sz span{border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px;min-width:44px;text-align:center}.sz .out{color:var(--muted);text-decoration:line-through;background:var(--bg)}.hero{border-radius:12px;aspect-ratio:16/9;max-height:320px;width:100%;display:flex;align-items:flex-end;padding:16px;font-weight:700;color:#1d1c22}.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:700px){.two{grid-template-columns:1fr}}.note{font-size:13px;border-top:1px solid var(--line);padding:6px 0}.deal{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;display:inline-block}.deal.real{background:#e9f4ef;color:var(--teal)}.deal.fake{background:#fdece4;color:var(--red)}</style>`;
const dealTag = (p) => p.price < p.lowest_price_30d ? `<span class="deal real">Below its 30-day low (${rs(p.lowest_price_30d)})</span>` : p.price === p.lowest_price_30d ? `<span class="deal real">At its 30-day low</span>` : `<span class="deal fake">Above its 30-day low (${rs(p.lowest_price_30d)}): not a real deal</span>`;
const sw = (p) => SWATCH[p.colour] || "#ddd";

async function shopPage(res) {
  const cards = await Promise.all(PRODUCTS.map(async (p) => {
    const live = await P.livePrice(p, null);
    const m = MERCHANTS[p.merchant];
    return `<a class="pc" href="/p/${p.product_id}"><div class="sw" style="background:linear-gradient(160deg,${sw(p)},${sw(p)}cc)">${esc(CAT[p.category] || p.category)} · ${esc(p.colour)}</div>
      <div class="b"><b>${esc(p.title)}</b><span class="pr">${rs(live.price)}<span class="strike">${rs(p.mrp)}</span></span><span class="muted" style="font-size:13px">${esc(m.name)} · ${esc(p.product_id)}</span></div></a>`;
  }));
  return res.status(200).send(page("Vouch sample shop", `<span class="tag v">Sample catalogue for the Vouch demo (MOCK: not real products or sellers)</span>
    <h1>Occasion wear · ${PRODUCTS.length} listings from ${Object.keys(MERCHANTS).length} sellers</h1><p class="muted">The same listings Vouch searches through pinelabs_catalog_search. Prices and stock are live from the demo server.</p>
    <div class="grid">${cards.join("")}</div>`, shopCss));
}

async function productPage(res, id) {
  const p = byId(id);
  if (!p) return res.status(404).send(page("Not found", `<div class="card"><h1>Listing not found</h1><p><a href="/shop">Back to the sample shop</a></p></div>`));
  const m = MERCHANTS[p.merchant];
  const live = await P.livePrice(p, null);
  const sizes = await Promise.all(SIZES.map(async (s) => ({ s, n: (await P.livePrice(p, s)).stock })));
  const siblings = PRODUCTS.filter((x) => x.group_id === p.group_id && x.product_id !== p.product_id);
  const notes = (p.reviews || []).filter((r) => r[4]).slice(0, 6).map((r) => `<div class="note"><b>${esc(r[2])}</b> · ${r[0]} cm, ${r[1]} kg · ${esc(r[3] === "fits" ? "fits" : r[3].replace("_", " "))}<br><span class="muted">${esc(r[4])}</span></div>`).join("");
  const ex = { doorstep_exchange: "Doorstep size exchange (same visit)", return_only: "Return only, no exchange", no_exchange: "No exchange" }[m.exchange] || m.exchange;
  return res.status(200).send(page(p.title, `<p><a href="/shop">← Sample shop</a></p><span class="tag v">Sample listing for the Vouch demo (MOCK)</span>
    <div class="two" style="margin-top:10px">
      <div class="hero" style="background:linear-gradient(160deg,${sw(p)},${sw(p)}bb)">${esc(CAT[p.category] || p.category)} · ${esc(p.colour)}</div>
      <div><h1>${esc(p.title)}</h1><div class="muted">by ${esc(m.name)} · ${esc(p.product_id)}</div>
        <p class="pr" style="font-size:26px;margin:8px 0 4px">${rs(live.price)}<span class="strike">${rs(p.mrp)}</span></p>${dealTag({ ...p, price: live.price })}
        <div class="sz">${sizes.map((x) => `<span class="${x.n > 0 ? "" : "out"}" title="${x.n} in stock">${x.s}${x.n > 0 && x.n <= 2 ? ` <small class="muted">${x.n} left</small>` : ""}</span>`).join("")}</div>
        <div class="muted" style="font-size:13px">${p.fit_runs === "small" ? "Runs small: buyers usually size up." : "True to size."}</div>
        <div class="card" style="font-size:14px"><b>Details</b><br>${esc(p.fabric)} · ${esc(p.silhouette)} · ${esc(String(p.sleeve).replace("_", " "))} sleeve · ${esc(p.work)} work${p.sheer ? " · <b>sheer</b>" : ""}<br><span class="muted">Good for: ${esc(p.occasions.join(", ").replace(/_/g, " "))}</span></div>
        <div class="card" style="font-size:14px"><b>Delivery and returns</b><br>Ships from ${esc(m.ship_from_pin)} · dispatch in ${m.dispatch_days} day(s) · Delhivery<br>${esc(ex)} · ${m.return_window_days}-day return window</div>
        ${siblings.length ? `<div class="card" style="font-size:14px"><b>Same dress from other sellers</b><br>${siblings.map((x) => `<a href="/p/${x.product_id}">${esc(MERCHANTS[x.merchant].name)} · ${rs(x.price)}</a>`).join("<br>")}</div>` : ""}
      </div></div>
    ${notes ? `<div class="card"><b>Fit notes from buyers</b> <span class="muted" style="font-size:12px">(sample data)</span>${notes}</div>` : ""}
    <p class="muted" style="font-size:13px">To buy, ask Vouch on WhatsApp: it checks your size, the delivery date for your pincode, and sends a Pine Labs payment link.</p>`, shopCss));
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

const BRIDGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Vouch bridge</title>
<style>body{margin:0;background:#0f172a;color:#e2e8f0;font:13px/1.5 ui-monospace,Menlo,monospace}h1{font-size:14px;margin:0;padding:10px 12px;color:#5eead4;border-bottom:1px solid #1e293b}
#log div{padding:6px 12px;border-bottom:1px solid #1e293b}.t{color:#64748b}.in{color:#fde68a}.out{color:#a7f3d0}.warn{color:#fca5a5}.info{color:#93c5fd}</style></head>
<body><h1>Vouch bridge · WhatsApp (Vonage webhook) → AgenticOrg agent</h1><div id="log"></div>
<script>
const AO = "https://agenticorg.hackathon.pinelabs.com";
let after = new Date().toISOString(); const seen = new Set();
const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function log(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = '<span class="t">' + new Date().toLocaleTimeString("en-IN", { hour12: false }) + "</span> " + html; document.getElementById("log").prepend(d); }
async function tick() {
  if (!window.opener) { log("warn", "AgenticOrg tab closed — reopen the bridge from it."); return; }
  try {
    const j = await (await fetch("/events?after=" + encodeURIComponent(after), { cache: "no-store" })).json();
    for (const ev of j.events || []) {
      if (ev.at > after) after = ev.at;
      if (seen.has(ev.id)) continue; seen.add(ev.id);
      log("in", "⬇ <b>" + esc(ev.from) + "</b>: " + esc(ev.text || (ev.voice_note ? "[voice note]" : "")));
      window.opener.postMessage({ type: "vouch-event", event: ev }, AO);
    }
  } catch (e) { log("warn", "feed error: " + esc(e.message)); }
}
window.addEventListener("message", (m) => {
  if (m.origin !== AO || !m.data || !m.data.type) return;
  if (m.data.type === "vouch-reply") log(m.data.hitl ? "warn" : "out", (m.data.hitl ? "⚠ held for review · " : "⬆ Vouch · ") + esc(m.data.text));
  if (m.data.type === "vouch-info") log("info", esc(m.data.text));
});
log("info", "listening for new WhatsApp messages…"); setInterval(tick, 3000);
</script></body></html>`;

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
      const msg = { message_sid: b.MessageSid || b.SmsSid || "", from: String(b.From || "").replace(/^whatsapp:/, ""), to: String(b.To || "").replace(/^whatsapp:/, ""), profile_name: b.ProfileName || "", body: b.Body || "", media, received_at: istStamp(await nowIST()), at: new Date().toISOString() };
      await push("inbox", msg, 200);
      await push("calls", { ts: msg.received_at, real_ts: new Date().toISOString(), via: "twilio-webhook", tool: "INBOUND WhatsApp", rail: "Twilio WhatsApp", args: { from: msg.from }, status: 200, ms: 0, result: JSON.stringify({ body: msg.body, media: msg.media.length }) });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send("<Response></Response>");
    }
    if (path === "/bridge") {
      // Event relay window, opened by the AgenticOrg tab. AgenticOrg's CSP blocks fetches to other origins,
      // so this same-origin page polls /events and hands each event to its opener with postMessage.
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(BRIDGE_HTML);
    }
    if (path === "/events") {
      // Inbound WhatsApp events for the AgenticOrg bridge (runs in the operator's logged-in tab).
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      const after = Date.parse(q.get("after") || "") || 0;
      const inbox = (await range("inbox", 100)).filter((m) => m.at && Date.parse(m.at) > after).reverse();
      const events = inbox.map((m) => ({ id: m.message_sid || m.at, at: m.at, from: m.from, name: m.profile_name || "", text: m.body || "", provider: m.provider || "",
        voice_note: m.media?.find((x) => /audio|ogg|voice/.test(x.content_type || ""))?.media_url || null }));
      return res.status(200).json({ now: new Date().toISOString(), events });
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
    if (path === "/shop") return await shopPage(res);
    m = /^\/p\/([A-Za-z0-9]+)$/.exec(path);
    if (m) return await productPage(res, m[1]);
    m = /^\/track\/([0-9A-Za-z-]+)$/.exec(path);
    if (m) return await trackPage(res, m[1]);
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
