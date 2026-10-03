// End-to-end test over real HTTP: Riya's happy path + every failure mode. `npm test`
import { makeServer } from "./dev.js";
import assert from "node:assert/strict";

const srv = makeServer().listen(0);
const base = `http://localhost:${srv.address().port}`;
let id = 0, pass = 0;
const results = [];

async function rpc(method, params) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return r.json();
}
async function tool(name, args) {
  const j = await rpc("tools/call", { name, arguments: args });
  if (j.error) throw new Error(JSON.stringify(j.error));
  const text = j.result.content[0].text;
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { body, isError: j.result.isError, text };
}
async function check(label, fn) {
  try { await fn(); pass++; results.push(`PASS  ${label}`); }
  catch (e) { results.push(`FAIL  ${label}: ${e.message}`); }
}
const adm = (qs) => fetch(`${base}/admin?key=vouch-admin&${qs}`, { redirect: "manual" });

await check("initialize + tools/list has 15 tools", async () => {
  const i = await rpc("initialize", { protocolVersion: "2025-03-26" });
  assert.equal(i.result.serverInfo.name, "vouch-mock");
  const l = await rpc("tools/list");
  assert.equal(l.result.tools.length, 15);
  for (const t of l.result.tools) assert.ok(t.name && t.description && t.inputSchema);
});

await check("pincode 110017 serviceable", async () => {
  const r = await tool("delhivery_pin_codes_json", { filter_codes: "110017" });
  assert.equal(r.body.delivery_codes[0].postal_code.pin, 110017);
});
await check("pincode 744301 NOT serviceable (empty list)", async () => {
  const r = await tool("delhivery_pin_codes_json", { filter_codes: "744301" });
  assert.deepEqual(r.body.delivery_codes, []);
});
await check("000002 malformed JSON", async () => {
  const r = await tool("delhivery_pin_codes_json", { filter_codes: "000002" });
  assert.equal(typeof r.body, "string");
});
await check("search with Delhivery down (000001) → delivery_check_failed, never 'not deliverable'", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "anarkali", occasion: "engagement", needed_by: "2026-10-14", max_price: 2500, delivery_pin: "000001", size_tag: "M" });
  assert.equal(r.body.delivery_check_failed, true);
  assert.equal(r.body.searched, false);
  assert.ok(!/not deliverable/i.test(r.text));
});
await check("000003 HTTP 500 → isError", async () => {
  const r = await tool("delhivery_pin_codes_json", { filter_codes: "000003" });
  assert.equal(r.isError, true);
});
await check("TAT Noida→Delhi = 1 day, has today + EDD", async () => {
  const r = await tool("delhivery_expected_tat", { origin_pin: "201301", destination_pin: "110017" });
  assert.equal(r.body.data.tat, 1);
  assert.ok(r.body.data.today && r.body.data.expected_delivery_date_if_picked_up_today);
});
await check("TAT Chennai→Delhi = 5 days", async () => {
  const r = await tool("delhivery_expected_tat", { origin_pin: "600001", destination_pin: "110017" });
  assert.equal(r.body.data.tat, 5);
});

let search;
await check("catalogue search returns heroes with buyers_like_you", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "pastel cotton anarkali", occasion: "cousin ki engagement", buyer_height_cm: 160, buyer_weight_kg: 58 });
  search = r.body;
  const p01 = search.items.find((x) => x.startsWith("P01 |"));
  assert.ok(p01, "P01 present");
  assert.match(p01, /7 of 9 buyers like you happy in L \(78%\)/);
  assert.match(p01, /also sold by: P02 Kurti Kart/);
  assert.ok(!search.items.find((x) => x.startsWith("P02 |")), "P02 folded into P01");
  assert.match(p01, /BELOW its 30-day low/);
  assert.ok(search.items.find((x) => x.startsWith("P09 |") && x.includes("SHEER")), "sheer P09 present (agent must drop it)");
});
await check("ranked search with full profile: P01 main, P03 cheaper, P04 safest, rules cited", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "pastel cotton anarkali", occasion: "engagement", setting: "outdoor", needed_by: "2026-12-30", max_price: 2500, delivery_pin: "110017", size_tag: "M", buyer_height_cm: 160, buyer_weight_kg: 58, fit_notes: "broad shoulders", taps_colour: "pastel", taps_work: "simple", taps_silhouette: "flowy", taps_fabric: "cotton_linen", dealbreakers: "sleeveless", past_return: "sheer, see-through" });
  assert.equal(r.body.picks.main.product_id, "P01");
  assert.equal(r.body.picks.main.size, "L");
  assert.equal(r.body.picks.cheaper.product_id, "P03");
  assert.equal(r.body.picks.safest_fit.product_id, "P04");
  assert.ok(r.body.rows.some((x) => x.startsWith("FAIL F5") && x.includes("P09")));
  assert.ok(r.body.rows.some((x) => x.startsWith("FAIL F4") && x.includes("P08")));
  assert.ok(r.body.rows.some((x) => x.startsWith("FAIL F1") && x.includes("P05")));
});
await check("search without a budget asks for it instead of failing", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "dress", occasion: "engagement", needed_by: "2026-10-05", max_price: null, size_tag: "M", delivery_pin: "110017" });
  assert.equal(r.isError, false);
  assert.deepEqual(r.body.missing, ["budget"]);
  assert.match(r.body.next_step, /whatsapp_send/);
});
await check("unknown occasion (get together) still returns ranked rows, never a false 'out of scope'", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "occasion wear", occasion: "Get together", needed_by: "2026-12-30", max_price: 2500, size_tag: "M", buyer_height_cm: 160, buyer_weight_kg: 58, delivery_pin: "110017", taps_colour: "pastel" });
  assert.ok(r.body.rows.length > 3, "rows returned");
  assert.ok(r.body.picks.main, "has a main pick");
});
await check("'in N days' is converted by the tool; earliest arrival given when only timing blocks", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "wedding", occasion: "wedding", needed_in_days: 2, max_price: 4000, delivery_pin: "110034", size_tag: "M", buyer_height_cm: 160, buyer_weight_kg: 54, taps_colour: "pastel", taps_work: "simple" });
  assert.match(r.body.needed_by, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.body.needed_by_text);
  assert.ok(r.body.earliest_possible_arrival && r.body.earliest_possible_arrival.date);
  assert.match(r.body.if_nothing_passes, /Earliest/);
});
await check("men's wear request returns no results", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "kurta for my husband" });
  assert.equal(r.body.items.length, 0);
});
await check("kwargs-wrapped arguments are unwrapped", async () => {
  const r = await tool("pinelabs_catalog_get_item", { kwargs: { product_id: "P01", size: "L" } });
  assert.equal(r.body.product_id, "P01");
});

await check("get_item P01 L live: ₹1,899, in stock", async () => {
  const r = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L" });
  assert.equal(r.body.price.selling_price, 1899);
  assert.equal(r.body.requested_size_in_stock, true);
});
await check("scenario price_jump → ₹2,199", async () => {
  await adm("set=catalog_item&v=price_jump&product_id=P01");
  const r = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L" });
  assert.equal(r.body.price.selling_price, 2199);
  await adm("set=catalog_item&v=out_of_stock&product_id=P01");
  const r2 = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L" });
  assert.equal(r2.body.requested_size_in_stock, false);
  await adm("set=catalog_item&v=normal");
});

await check("price jump: get_item verdict PRICE_CHANGED; create_order refuses the stale amount", async () => {
  await adm("set=catalog_item&v=price_jump&product_id=P01");
  const g = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L", quoted_price: 1899 });
  assert.equal(g.body.verdict, "PRICE_CHANGED");
  assert.equal(g.body.live_price, 2199);
  const o = await tool("pinelabs_create_order", { product_id: "P01", size: "L", amount: 189900 });
  assert.equal(o.body.code, "PRICE_MISMATCH");
  await adm("set=catalog_item&v=out_of_stock&product_id=P01");
  const g2 = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L", quoted_price: 1899 });
  assert.equal(g2.body.verdict, "OUT_OF_STOCK");
  const o2 = await tool("pinelabs_create_order", { product_id: "P01", size: "L", amount: 189900 });
  assert.equal(o2.body.code, "OUT_OF_STOCK");
  await adm("set=catalog_item&v=normal");
  const g3 = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L", quoted_price: 1899 });
  assert.equal(g3.body.verdict, "OK");
});
let order;
await check("create order 189900 paise → redirect_url /pay/", async () => {
  const r = await tool("pinelabs_create_order", { merchant_order_reference: "vouch-riya-P01-L", amount: 189900, customer_name: "Riya" });
  order = r.body;
  assert.match(order.redirect_url, /\/pay\/v1-/);
  assert.equal(order.order_amount.value, 189900);
});
await check("seller order refused before payment", async () => {
  const r = await tool("pinelabs_place_seller_order", { payment_order_id: order.order_id, product_id: "P01", size: "L" });
  assert.equal(r.body.code, "PAYMENT_NOT_CAPTURED");
});
await check("payment page renders and fail path → FAILED", async () => {
  const pg = await (await fetch(`${base}/pay/${order.order_id}`)).text();
  assert.match(pg, /Pay ₹1,899/);
  await fetch(`${base}/pay/${order.order_id}?outcome=fail`);
  const s = await tool("pinelabs_get_order_status", { order_id: order.order_id });
  assert.equal(s.body.data.status, "FAILED");
  assert.equal(s.body.data.payments[0].error_detail.code, "PAYMENT_TIMEOUT");
});
await check("retry payment succeeds → PROCESSED", async () => {
  await fetch(`${base}/pay/${order.order_id}?outcome=success`);
  const s = await tool("pinelabs_get_order_status", { order_id: order.order_id });
  assert.equal(s.body.data.status, "PROCESSED");
});

let so, wb;
await check("place seller order → seller_order_id, idempotent", async () => {
  const r = await tool("pinelabs_place_seller_order", { payment_order_id: order.order_id, product_id: "P01", size: "L", pin: "110017", customer_name: "Riya" });
  so = r.body;
  assert.equal(so.status, "CONFIRMED");
  const again = await tool("pinelabs_place_seller_order", { payment_order_id: order.order_id, product_id: "P01", size: "L" });
  assert.equal(again.body.seller_order_id, so.seller_order_id);
});
await check("seller order also accepts the payment id (v1-pay-…)", async () => {
  const st = await tool("pinelabs_get_order_status", { order_id: order.order_id });
  assert.match(st.body.next_step, /place_seller_order/);
  const payId = st.body.data.payments.slice(-1)[0].id;
  const r = await tool("pinelabs_place_seller_order", { payment_order_id: payId, product_id: "P01", size: "L" });
  assert.equal(r.body.seller_order_id, so.seller_order_id);
});
await check("create Delhivery shipment → waybill", async () => {
  const r = await tool("delhivery_create_shipment", { order: so.seller_order_id, pin: "110017", payment_mode: "Prepaid" });
  wb = r.body.packages[0].waybill;
  assert.match(wb, /^14908\d{8}$/);
});
await check("track: not yet delivered today", async () => {
  const r = await tool("delhivery_track", { waybill: wb });
  assert.notEqual(r.body.ShipmentData[0].Shipment.Status.Status, "Delivered");
});
await check("track: delayed scenario pushes EDD +3", async () => {
  await adm("set=tracking&v=delayed");
  const r = await tool("delhivery_track", { waybill: wb });
  const sh = r.body.ShipmentData[0].Shipment;
  assert.equal(sh.Status.Status, "Delayed");
  assert.notEqual(sh.ExpectedDeliveryDate, sh.PromisedDeliveryDate);
  await adm("set=tracking&v=normal");
});
await check("demo clock +3 → Delivered", async () => {
  await adm("set=clock&v=3");
  const r = await tool("delhivery_track", { waybill: wb });
  assert.equal(r.body.ShipmentData[0].Shipment.Status.Status, "Delivered");
});
await check("doorstep exchange to XL before 14 Oct-ish is feasible", async () => {
  const far = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const q = await tool("delhivery_doorstep_exchange", { waybill: wb, new_size: "XL", needed_by: far });
  assert.equal(q.body.booked, false, "quote only without her yes");
  assert.match(q.body.next_step, /wait for her clear yes/);
  const r = await tool("delhivery_doorstep_exchange", { waybill: wb, new_size: "XL", needed_by: far, confirmed_by_customer: true });
  assert.equal(r.body.feasible, true);
  assert.equal(r.body.same_visit, true);
});
await check("doorstep exchange too late is refused with earliest date", async () => {
  const today = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const r = await tool("delhivery_doorstep_exchange", { waybill: wb, new_size: "XL", needed_by: today });
  assert.equal(r.body.feasible, false);
  assert.ok(r.body.earliest_visit_date);
});
await check("return pickup + full refund", async () => {
  const p = await tool("delhivery_create_shipment", { order: so.seller_order_id, pin: "110017", payment_mode: "Pickup" });
  assert.equal(p.body.pickups_count, 1);
  const r = await tool("pinelabs_initiate_refund", { order_id: order.order_id });
  assert.equal(r.body.refund_amount.value, 189900);
});
await check("gnani tools fail cleanly without key", async () => {
  const r = await tool("gnani_text_to_speech", { text: "Namaste" });
  assert.equal(r.isError, true);
  assert.equal(r.body.error, "gnani_not_configured");
});

await check("REST mirrors need auth and work", async () => {
  const a = await fetch(`${base}/c/api/pin-codes/json/?filter_codes=110017`);
  assert.equal(a.status, 401);
  const b = await fetch(`${base}/c/api/pin-codes/json/?filter_codes=110017`, { headers: { Authorization: "Token x" } });
  assert.equal((await b.json()).delivery_codes.length, 1);
  const c = await fetch(`${base}/api/v1/packages/json/?waybill=${wb}`, { headers: { Authorization: "Token x" } });
  assert.equal((await c.json()).ShipmentData.length, 1);
  const d = await fetch(`${base}/api/pay/v1/orders/${order.order_id}`, { headers: { Authorization: "Bearer x" } });
  assert.equal((await d.json()).data.order_id, order.order_id);
  const e = await fetch(`${base}/api/cmu/create.json`, { method: "POST", headers: { Authorization: "Token x", "Content-Type": "application/x-www-form-urlencoded" }, body: "format=json&data=" + encodeURIComponent(JSON.stringify({ shipments: [{ order: "X1", pin: "400001", payment_mode: "Prepaid" }] })) });
  assert.equal((await e.json()).success, true);
});
await check("Twilio inbound webhook → whatsapp_inbox (voice note)", async () => {
  const form = new URLSearchParams({ MessageSid: "SM1", From: "whatsapp:+919812345678", To: "whatsapp:+14155238886", Body: "", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media/x", MediaContentType0: "audio/ogg", ProfileName: "Riya" });
  const w = await fetch(`${base}/twilio/inbound`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  assert.equal(w.status, 200);
  const r = await tool("whatsapp_inbox", { from: "+919812345678" });
  assert.match(r.body.messages[0].voice_note, /twilio\.com\/media/);
});
await check("whatsapp_send: validates input, dry-run switch works", async () => {
  const bad = await tool("whatsapp_send", { to: "+919812345678" });
  assert.equal(bad.body.error, "missing_body");
  await adm("set=whatsapp&v=dry");
  const r = await tool("whatsapp_send", { kwargs: { to: "9812345678", body: "Hi Riya" } });
  assert.equal(r.body.status, "dry_run");
  assert.equal(r.body.to, "+919812345678");
  const nl = await tool("whatsapp_send", { to: "+919812345678", body: "line one\\nline two" });
  assert.equal(nl.body.body, "line one\nline two");
  await adm("set=whatsapp&v=live");
  const l = await (await fetch(`${base}/logs.json`)).json();
  assert.equal(l.outbox[0].sid, "DRY-RUN");
});
await check("Meta webhook: verify handshake + inbound text and voice note land in whatsapp_inbox", async () => {
  const v = await fetch(`${base}/meta/webhook?hub.mode=subscribe&hub.verify_token=vouch-verify&hub.challenge=12345`);
  assert.equal(await v.text(), "12345");
  const bad = await fetch(`${base}/meta/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
  assert.equal(bad.status, 403);
  const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { display_phone_number: "15550000000" }, contacts: [{ wa_id: "919811900001", profile: { name: "Riya" } }],
    messages: [{ id: "wamid.A1", from: "919811900001", type: "audio", audio: { id: "MEDIA123", mime_type: "audio/ogg; codecs=opus" } }, { id: "wamid.A2", from: "919811900001", type: "text", text: { body: "haan, order karo" } }] } }] }] };
  const w = await fetch(`${base}/meta/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(w.status, 200);
  const r = await tool("whatsapp_inbox", { from: "+919811900001" });
  assert.equal(r.body.messages[1].text, "haan, order karo");
  assert.match(r.body.messages[0].voice_note, /\/meta\/media\/MEDIA123$/);
});
await check("Vonage webhook: inbound text + voice note land in whatsapp_inbox; status logged", async () => {
  const w = await fetch(`${base}/vonage/inbound`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", message_uuid: "v-1", from: "919811900002", to: "14157386102", message_type: "audio", audio: { url: "https://api-us.nexmo.com/v3/media/abc" }, profile: { name: "Riya" } }) });
  assert.equal(w.status, 200);
  await fetch(`${base}/vonage/inbound`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", message_uuid: "v-2", from: "919811900002", message_type: "text", text: "Cousin ki engagement hai" }) });
  const r = await tool("whatsapp_inbox", { from: "+919811900002" });
  assert.equal(r.body.messages[1].text, "Cousin ki engagement hai");
  assert.match(r.body.messages[0].voice_note, /\/vonage\/media\?u=/);
  const st = await fetch(`${base}/vonage/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message_uuid: "v-9", status: "delivered", to: "919811900002" }) });
  assert.equal(st.status, 200);
  const l = await (await fetch(`${base}/logs.json`)).json();
  assert.equal(l.wa_status[0].status, "delivered");
});
await check("/events feed returns new inbound WhatsApp messages after a timestamp, with CORS", async () => {
  const t0 = new Date(Date.now() - 1000).toISOString();
  await fetch(`${base}/vonage/inbound`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", message_uuid: "ev-1", from: "919811900003", message_type: "text", text: "2500 tak" }) });
  const r = await fetch(`${base}/events?after=${encodeURIComponent(t0)}`);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const j = await r.json();
  const e = j.events.find((x) => x.id === "ev-1");
  assert.equal(e.text, "2500 tak");
  assert.equal(e.from, "+919811900003");
});
await check("/logs and /health", async () => {
  const l = await (await fetch(`${base}/logs.json`)).json();
  assert.ok(l.calls.length > 10);
  const h = await (await fetch(`${base}/`)).json();
  assert.equal(h.tools, 15);
});

await check("shipment returns tracking_url and /track page renders", async () => {
  const r = await tool("delhivery_create_shipment", { order: "SO-TEST-TRACK", pin: "110017", payment_mode: "Prepaid" });
  assert.ok(/\/track\/14908\d+$/.test(r.body.tracking_url), r.text);
  const wb = r.body.packages[0].waybill;
  const html = await (await fetch(`${base}/track/${wb}`)).text();
  assert.ok(html.includes("Arriving by") || html.includes("Delivered on"));
  assert.ok(html.includes("MOCK"));
  const t = await tool("delhivery_track", { waybill: wb });
  assert.equal(t.body.tracking_url.endsWith(`/track/${wb}`), true);
});

await check("search without a pincode asks for it (no 'arrival unknown' rows)", async () => {
  const r = await tool("pinelabs_catalog_search", { query: "engagement", occasion: "engagement", needed_by: "2026-10-14", max_price: 10000, delivery_pin: null, size_tag: null });
  assert.equal(r.body.searched, false);
  assert.ok(r.body.missing.includes("delivery pincode"));
});

await check("sample shop + product page render; picks carry product_url", async () => {
  const shop = await (await fetch(`${base}/shop`)).text();
  assert.ok(shop.includes("/p/P01") && shop.includes("MOCK"));
  const pg = await (await fetch(`${base}/p/P01`)).text();
  assert.ok(pg.includes("Mint cotton anarkali") && pg.includes("Sample listing"));
  const r = await tool("pinelabs_catalog_search", { query: "engagement", occasion: "engagement", needed_by: "2026-10-14", max_price: 2500, delivery_pin: "110017", size_tag: "M", buyer_height_cm: 160, buyer_weight_kg: 54 });
  assert.ok(/\/p\/P\d+$/.test(r.body.picks.main.product_url), r.text.slice(0, 200));
  const g = await tool("pinelabs_catalog_get_item", { product_id: "P01", size: "L", quoted_price: 1899 });
  assert.ok(g.body.product_url.endsWith("/p/P01"));
});

if (process.env.SLOW) {
  await check("000001 times out after 12 s", async () => {
    const t = Date.now();
    await tool("delhivery_pin_codes_json", { filter_codes: "000001" });
    assert.ok(Date.now() - t >= 11900);
  });
}

await adm("reset=all");
console.log(results.join("\n"));
console.log(`\n${pass}/${results.length} passed`);
srv.close();
process.exit(pass === results.length ? 0 : 1);
