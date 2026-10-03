// One registry for every tool the Vouch agent can call through the single MCP connector.
// AgenticOrg scopes at most ONE custom connector per agent, so all rails live behind /mcp.
//
//   Delhivery (MOCK, mandatory)        delhivery_pin_codes_json, delhivery_expected_tat,
//                                      delhivery_create_shipment, delhivery_track
//   Delhivery extra capability #3      delhivery_doorstep_exchange
//   Pine Labs (MOCK, Plural shapes)    pinelabs_create_order, pinelabs_get_order_status, pinelabs_initiate_refund
//   Pine Labs extra capability #1      pinelabs_catalog_search, pinelabs_catalog_get_item
//   Pine Labs extra capability #2      pinelabs_place_seller_order
//   Gnani (REAL, via adapter)          gnani_speech_to_text, gnani_text_to_speech
//   WhatsApp inbound (REAL)            whatsapp_inbox — the provider's inbound webhook (Vonage Messages API) lands here.
//   WhatsApp outbound (REAL)           whatsapp_send — Vonage Messages API (Meta Cloud API / Twilio supported too).
import * as D from "./delhivery.js";
import * as P from "./pinelabs.js";
import * as G from "./gnani.js";
import { sendWhatsApp } from "./whatsapp.js";
import { search, SIZE_CHART, normOccasion } from "./catalog.js";
import { rank } from "./rank.js";
import { push, range } from "./store.js";
import { nowIST, ymd, addDays, istStamp } from "./clock.js";

// Nullable on purpose: the platform rejects a call when the model passes null for a typed field,
// and the model does that whenever she has not said something yet (e.g. no budget).
const S = (d) => ({ type: ["string", "null"], description: d });
const N = (d) => ({ type: ["number", "null"], description: d });

export const TOOLS = [
  {
    name: "delhivery_pin_codes_json", rail: "Delhivery", kind: "mock",
    description: "Delhivery GET /c/api/pin-codes/json/. Is a pincode serviceable? Returns {delivery_codes:[{postal_code:{pin, city, pre_paid, cod, repl, is_oda, ...}}]}. EMPTY delivery_codes = NOT serviceable. is_oda 'Y' = remote area, slower, prepaid only. Example: {\"filter_codes\": \"110017\"}",
    inputSchema: { type: "object", properties: { filter_codes: S("Pincode(s), comma separated, e.g. '110017'") }, required: ["filter_codes"] }
  },
  {
    name: "delhivery_expected_tat", rail: "Delhivery", kind: "mock",
    description: "Delhivery GET /api/dc/expected_tat. Transit days from the seller's ship-from pincode to her pincode, plus today's date and the expected delivery date if picked up today. Add the seller's dispatch_days yourself. Example: {\"origin_pin\": \"201301\", \"destination_pin\": \"110017\"}",
    inputSchema: { type: "object", properties: { origin_pin: S("Seller ship-from pincode, e.g. '201301'"), destination_pin: S("Her pincode, e.g. '110017'"), mot: S("S = surface (default), E = express") }, required: ["origin_pin", "destination_pin"] }
  },
  {
    name: "delhivery_create_shipment", rail: "Delhivery", kind: "mock",
    description: "Delhivery POST /api/cmu/create.json. Books a shipment and returns its waybill. Use payment_mode 'Prepaid' for a paid order after pinelabs_place_seller_order, or 'Pickup' to book a return pickup from her. Example: {\"order\": \"SO-80211-1001\", \"pin\": \"110017\", \"payment_mode\": \"Prepaid\"}",
    inputSchema: { type: "object", properties: { order: S("Your order reference: the seller_order_id"), pin: S("Delivery (or pickup) pincode"), payment_mode: S("Prepaid | Pickup"), name: S("Consignee name"), add: S("Address line") }, required: ["order", "pin"] }
  },
  {
    name: "delhivery_track", rail: "Delhivery", kind: "mock",
    description: "Delhivery GET /api/v1/packages/json/?waybill=. Live status and ExpectedDeliveryDate for a waybill. Compare ExpectedDeliveryDate with her needed_by date. Example: {\"waybill\": \"1490810000001\"}",
    inputSchema: { type: "object", properties: { waybill: S("Waybill / AWB number") }, required: ["waybill"] }
  },
  {
    name: "delhivery_doorstep_exchange", rail: "Delhivery", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Delhivery): book a same-visit size exchange (new size delivered, old piece collected in one visit) only if it lands at least 1 day before needed_by. Returns feasible true/false, visit_date and buffer_days. Without confirmed_by_customer it only QUOTES (nothing booked); offer the quote to her, and after her yes call again with confirmed_by_customer: true. Example: {\"waybill\": \"1490810000001\", \"new_size\": \"XL\", \"needed_by\": \"2026-10-14\"}",
    inputSchema: { type: "object", properties: { waybill: S("Waybill of the delivered order"), new_size: S("Size to send, e.g. 'XL'"), needed_by: S("Occasion date YYYY-MM-DD"), confirmed_by_customer: { type: ["boolean", "null"], description: "true ONLY after she said yes to this exact exchange in her own words; otherwise omit to get a quote" } }, required: ["waybill", "new_size", "needed_by"] }
  },
  {
    name: "pinelabs_catalog_search", rail: "Pine Labs", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Pine Labs): search occasion wear across Pine Labs merchants and rank it for HER. Pass her full profile and the request. Returns rows sorted best first: PASS rows show score = fit + style + occasion + value + delivery, FAIL rows name the rule that failed (F1 stock, F2 budget, F3 arrival buffer < 3 days, F4 dealbreaker, F5 sheer); every row shows the predicted size and fit confidence (Z1-Z4, from buyers within ±5 cm / ±5 kg), price vs 30-day low, and arrival date (seller dispatch + Delhivery expected_tat to her pincode). Also returns picks {main, cheaper, safest_fit}. Example: {\"query\": \"pastel cotton anarkali\", \"occasion\": \"engagement\", \"setting\": \"outdoor day\", \"needed_by\": \"2026-10-14\", \"max_price\": 2500, \"delivery_pin\": \"110017\", \"size_tag\": \"M\", \"buyer_height_cm\": 160, \"buyer_weight_kg\": 58, \"fit_notes\": \"broad shoulders\", \"taps_colour\": \"pastel\", \"taps_work\": \"simple\", \"taps_silhouette\": \"flowy\", \"taps_fabric\": \"cotton_linen\", \"dealbreakers\": \"sleeveless\", \"past_return\": \"sheer, see-through\"}",
    inputSchema: { type: "object", properties: { query: S("What to look for, e.g. 'pastel cotton anarkali'"), occasion: S("e.g. engagement, wedding, mehendi"), buyer_height_cm: N("Her height in cm"), buyer_weight_kg: N("Her weight in kg"), max_price: N("Her budget cap in rupees"), delivery_pin: S("Her delivery pincode, e.g. '110017'"), needed_by: S("Occasion date YYYY-MM-DD, only if she gave a calendar date"), needed_in_days: N("If she said 'in N days' / 'N din mein', pass N here instead of computing a date"), setting: S("e.g. outdoor day, indoor evening"), size_tag: S("Her usual size, e.g. 'M'"), fit_notes: S("e.g. 'broad shoulders, long torso'"), taps_colour: S("pastel | bright"), taps_work: S("simple | heavy"), taps_silhouette: S("flowy | fitted"), taps_fabric: S("cotton_linen | satin_georgette"), dealbreakers: S("e.g. 'sleeveless'"), past_return: S("Why she returned something before, e.g. 'sheer, see-through'") }, required: ["query"] }
  },
  {
    name: "pinelabs_catalog_get_item", rail: "Pine Labs", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Pine Labs): live price and stock for one listing right before checkout. Always call this after her yes and before pinelabs_create_order, passing quoted_price; read verdict first (OK / PRICE_CHANGED / OUT_OF_STOCK) and follow next_step. Example: {\"product_id\": \"P01\", \"size\": \"L\"}",
    inputSchema: { type: "object", properties: { product_id: S("e.g. 'P01'"), size: S("e.g. 'L'"), quoted_price: N("The ₹ price you quoted her for this item (so the tool can flag a change)") }, required: ["product_id", "size"] }
  },
  {
    name: "pinelabs_create_order", rail: "Pine Labs", kind: "mock",
    description: "Pine Labs Plural POST /api/checkout/v1/orders. Creates the payment order and returns order_id and redirect_url (her payment link). amount is in PAISE: ₹1,899 = 189900. Only after her explicit yes to item, size, price and date. Example: {\"merchant_order_reference\": \"vouch-riya-P01-L\", \"amount\": 189900, \"customer_name\": \"Riya\"}",
    inputSchema: { type: "object", properties: { product_id: S("e.g. 'P01'"), size: S("e.g. 'L'"), merchant_order_reference: S("Your unique reference, e.g. 'vouch-riya-P01-L'"), amount: N("Amount in paise, e.g. 189900"), customer_name: S("Her name"), customer_phone: S("Her mobile") }, required: ["product_id", "size", "amount"] }
  },
  {
    name: "pinelabs_get_order_status", rail: "Pine Labs", kind: "mock",
    description: "Pine Labs Plural GET /api/pay/v1/orders/{order_id}. Status is CREATED (not paid yet), PROCESSED (paid), FAILED (payment failed; see payments[].error_detail), or refunded. Example: {\"order_id\": \"v1-20261003-aa-00001\"}",
    inputSchema: { type: "object", properties: { order_id: S("Pine Labs order_id") }, required: ["order_id"] }
  },
  {
    name: "pinelabs_initiate_refund", rail: "Pine Labs", kind: "mock",
    description: "Pine Labs Plural POST /api/pay/v1/orders/{order_id}/refunds. Refund a PROCESSED order (amount in paise; omit for full refund). Only after her yes, or automatically if the seller cannot fulfil a paid order. Example: {\"order_id\": \"v1-20261003-aa-00001\", \"amount\": 189900}",
    inputSchema: { type: "object", properties: { order_id: S("Pine Labs order_id"), amount: N("Refund in paise; omit = full") }, required: ["order_id"] }
  },
  {
    name: "pinelabs_place_seller_order", rail: "Pine Labs", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Pine Labs): once the payment is PROCESSED, place the order with the seller and get seller_order_id, ship_from_pin and dispatch_by. Then call delhivery_create_shipment. payment_order_id is the order_id (v1-YYYYMMDD-...), not a payment id. Example: {\"payment_order_id\": \"v1-20261003-aa-00001\", \"product_id\": \"P01\", \"size\": \"L\", \"pin\": \"110017\"}",
    inputSchema: { type: "object", properties: { payment_order_id: S("Pine Labs order_id that is PROCESSED"), product_id: S("e.g. 'P01'"), size: S("e.g. 'L'"), pin: S("Her pincode"), address: S("Her address"), customer_name: S("Her name") }, required: ["payment_order_id", "product_id", "size"] }
  },
  {
    name: "whatsapp_inbox", rail: "WhatsApp", kind: "real_relay",
    description: "Her real WhatsApp messages, delivered here by the WhatsApp provider's inbound webhook. Returns newest first: from, body, media (voice notes: content_type audio/*, pass media_url to gnani_speech_to_text), received_at. Call this whenever you are told a new message arrived. Example: {\"from\": \"+919812345678\"}",
    inputSchema: { type: "object", properties: { from: S("Her number in E.164, e.g. '+919812345678'; omit for all"), limit: N("How many messages, default 5") }, required: [] }
  },
  {
    name: "whatsapp_send", rail: "WhatsApp", kind: "real",
    description: "Send her a REAL WhatsApp message from Vouch's WhatsApp number. Works within 24 hours of her last message. Returns sid on success. Optional media_url attaches a voice note (e.g. the audio_url from gnani_text_to_speech). Example: {\"to\": \"+919812345678\", \"body\": \"Riya, ek accha option mila hai...\"}",
    inputSchema: { type: "object", properties: { to: S("Her WhatsApp number in E.164, e.g. '+919812345678'"), body: S("Exact message text"), media_url: S("Optional public audio/image link to attach") }, required: ["to", "body"] }
  },
  {
    name: "gnani_speech_to_text", rail: "Gnani", kind: "real",
    description: "Gnani Vachana STT (real API, POST /stt/v3). Transcribes her voice note from a public link. Use language_code 'hi-IN' for Hindi/Hinglish, 'en-IN' for English. If a number in the transcript is unclear, read it back to her. Example: {\"audio_url\": \"https://.../note.ogg\", \"language_code\": \"hi-IN\"}",
    inputSchema: { type: "object", properties: { audio_url: S("Public link to the voice note"), language_code: S("hi-IN or en-IN") }, required: ["audio_url"] }
  },
  {
    name: "gnani_text_to_speech", rail: "Gnani", kind: "real",
    description: "Gnani Vachana TTS (real API, POST /api/v1/tts/inference, model timbre-v2.5). Turns your short reply into a voice note and returns audio_url to send her. Use when she wrote to you by voice. Example: {\"text\": \"Riya, ek accha option mila hai...\", \"language\": \"hi-IN\"}",
    inputSchema: { type: "object", properties: { text: S("What to say, max ~2 sentences"), language: S("hi-IN or en-IN") }, required: ["text"] }
  }
];

const ok = (body) => ({ status: 200, body });
const lc = (v) => String(v || "").toLowerCase().trim();

async function run(name, a, ctx) {
  switch (name) {
    case "delhivery_pin_codes_json": {
      const f = await D.failureFor(a.filter_codes);
      if (f) return f;
      return ok(D.pincodeServiceability(a.filter_codes));
    }
    case "delhivery_expected_tat": {
      const f = await D.failureFor(a.origin_pin, a.destination_pin);
      if (f) return f;
      const out = D.expectedTat(a);
      if (out.body?.success) {
        const now = await nowIST();
        out.body.data.today = ymd(now);
        out.body.data.expected_delivery_date_if_picked_up_today = ymd(addDays(now, out.body.data.tat));
      }
      return out;
    }
    case "delhivery_create_shipment": {
      const f = await D.failureFor(a.pin);
      if (f) return f;
      const r = await D.createShipment(a);
      const wb = r.body?.packages?.[0]?.waybill;
      if (wb) { r.body.tracking_url = `${ctx.base || ""}/track/${wb}`; r.body.next_step = `Tell her the order is placed, the delivery date, and include her tracking link exactly: ${r.body.tracking_url}`; }
      return r;
    }
    case "delhivery_track": {
      const r = await D.track(a);
      const wb = r.body?.ShipmentData?.[0]?.Shipment?.AWB;
      if (wb) r.body.tracking_url = `${ctx.base || ""}/track/${wb}`;
      return r;
    }
    case "delhivery_doorstep_exchange": return D.doorstepExchange(a, { stockFor: P.stockFor });
    case "pinelabs_catalog_search": {
      const today = ymd(await nowIST());
      // Relative deadlines ("in 4 days") are converted here, not by the model, so the date math is always right.
      const inDays = Number(String(a.needed_in_days ?? "").replace(/[^0-9]/g, ""));
      if (!a.needed_by && inDays > 0) a = { ...a, needed_by: ymd(addDays(await nowIST(), inDays)) };
      if (a.size_tag || a.needed_by || a.taps_colour || a.dealbreakers || a.max_price === null || a.needed_in_days === null) {
        const missing = [];
        if (!a.occasion) missing.push("occasion");
        if (!a.needed_by) missing.push("date she needs it by");
        if (!(Number(String(a.max_price ?? "").replace(/[^0-9.]/g, "")) > 0)) missing.push("budget");
        if (missing.length) {
          return ok({ today, searched: false, missing, rule: "U1/U2: occasion, date and budget are required before searching",
            next_step: `Do not propose anything yet. CALL whatsapp_send to her with ONE short question asking only for: ${missing.join(", ")} — and read back what she already told you (e.g. "Engagement, 5 Oct tak — budget kitna rakhein?"). Then write ONE JSON object {"answer": "<the 12-line decision log>", "confidence": <0-1>}.` });
        }
        // E7: the ranking computes arrival dates with Delhivery's TAT; if Delhivery is down for this pincode,
        // say so instead of letting every row fail as "not deliverable".
        const dpin = String(a.delivery_pin || "");
        if (Object.values(D.TRIGGERS).some((t) => dpin.includes(t))) {
          return ok({ today, searched: false, delivery_check_failed: true, delivery_pin: dpin, rule: "E7",
            note: `Delhivery did not answer for pincode ${dpin} (timeout / error). This says NOTHING about whether ${dpin} is serviceable.`,
            next_step: `Do not propose anything and do not say delivery to ${dpin} is impossible. Retry delhivery_pin_codes_json once. If it fails again, CALL whatsapp_send to her: read back her request and say the delivery check is not working right now and you will update her shortly (in her language). Then write ONE JSON object {"answer": "<the 12-line decision log>", "confidence": <0-1>}.` });
        }
        const products = search({ ...a, _raw: true });
        if (!products.length) {
          const men = /\b(men|mens|men's|husband|pati|boy|groom|sherwani|kurta pyjama|nehru jacket|male|kids?|baby|beta|beti)\b/i.test(`${a.query || ""} ${a.occasion || ""}`);
          return ok({ today, rows: [], picks: {}, searched: true, note: men ? "Out of scope: this catalogue covers women's occasion wear only (SC1)." : "No listings matched this search. Try a broader query (e.g. 'kurta set', 'anarkali', 'dress')." });
        }
        const n = (v) => (v === undefined || v === null || v === "" ? null : Number(String(v).replace(/[^0-9.]/g, "")) || null);
        const prof = { size_tag: a.size_tag, h: n(a.buyer_height_cm), w: n(a.buyer_weight_kg), fit_notes: a.fit_notes,
          taps: { colour: lc(a.taps_colour), work: lc(a.taps_work), silhouette: lc(a.taps_silhouette), fabric: lc(a.taps_fabric).replace(/[\/ ]+/g, "_") } };
        const ctx = { today, pin: String(a.delivery_pin || "").trim(), budget: n(a.max_price), needed_by: a.needed_by || null,
          occasion: normOccasion(a.occasion || a.query), setting: lc(a.setting), deal: lc(a.dealbreakers), past: lc(a.past_return) };
        const nb = new Date(ctx.needed_by + "T00:00:00Z");
        const needed_by_text = `${nb.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][nb.getUTCMonth()]}`;
        return ok({ today, needed_by: ctx.needed_by, needed_by_text, ...rank(products, prof, ctx), searched_at: istStamp(await nowIST()), data_notice: "Sample listings for the Vouch demo, not real products or sellers.",
          next_step: "Read back the date as needed_by_text in your message (e.g. '7 Oct tak'). If picks is empty, tell her why using if_nothing_passes (including the earliest possible date) and ask what to relax. If style_note is set, mention it in one line. Otherwise check the picks against their rows, then CALL whatsapp_send with your proposal (main pick, then cheaper and safest fit, each with arrives_text and reason_for_her). Only after it returns a sid, write ONE JSON object {\"answer\": \"<the 12-line decision log>\", \"confidence\": <0-1>}." });
      }
      const r = search({ ...a, _today: today });
      return ok({ today: ymd(await nowIST()), searched_at: istStamp(await nowIST()), ...r, data_notice: "Sample listings for the Vouch demo, not real products or sellers." });
    }
    case "pinelabs_catalog_get_item": return P.getItem(a, ctx);
    case "pinelabs_create_order": return P.createOrder(a, ctx);
    case "pinelabs_get_order_status": {
      const out = await P.getOrder(a);
      const d = out.body?.data;
      if (d?.status === "PROCESSED") out.body.next_step = `Paid. CALL pinelabs_place_seller_order {payment_order_id: "${d.order_id}", product_id, size, pin}, then delhivery_create_shipment {order: <seller_order_id>, pin, payment_mode: "Prepaid"}, then tell her the expected delivery date with whatsapp_send. It is an order only after the seller confirms.`;
      else if (d?.status === "FAILED") out.body.next_step = `Payment failed (${d.payments?.slice(-1)[0]?.error_detail?.code || "unknown"}). Nothing was charged. Do not retry yourself: tell her with whatsapp_send and offer the same link again.`;
      else if (d?.status === "CREATED") out.body.next_step = "Not paid yet. Remind her once, gently, with the same link via whatsapp_send.";
      return out;
    }
    case "pinelabs_initiate_refund": return P.refund(a);
    case "pinelabs_place_seller_order": return P.placeSellerOrder(a);
    case "gnani_speech_to_text": return G.speechToText(a);
    case "whatsapp_inbox": {
      // Only what she still needs an answer to: her messages since Vouch's last WhatsApp to her.
      const want = String(a.from || "").replace(/[^0-9]/g, "").slice(-10);
      const mine = (m) => !want || String(m.from || m.to || "").replace(/[^0-9]/g, "").endsWith(want);
      const inbox = (await range("inbox", 100)).filter(mine);
      const lastOut = (await range("outbox", 50)).filter(mine)[0];
      const cut = lastOut ? Date.parse(lastOut.at) : 0;
      let fresh = inbox.filter((m) => m.at && Date.parse(m.at) > cut);
      const note = fresh.length ? "unanswered messages, oldest first" : "no new message since your last reply; showing her latest message";
      if (!fresh.length) fresh = inbox.slice(0, 1);
      const messages = fresh.slice(0, 5).reverse().map((m) => ({ from: m.from, text: m.body || "", voice_note: m.media?.find((x) => /audio|ogg|voice/.test(x.content_type))?.media_url || null, received_at: m.received_at }));
      const who = messages[messages.length - 1]?.from || (want ? "+91" + want : "her number");
      return ok({ today: ymd(await nowIST()), note, messages,
        next_step: `Treat these as her message${messages.length > 1 ? "s" : ""}${messages.some((m) => m.voice_note) ? " (transcribe voice_note with gnani_speech_to_text first)" : ""}. Decide your reply by the rules, then CALL whatsapp_send {to: "${who}", body: <your exact reply>} — even when the reply is only a question. Only after whatsapp_send returns a sid, write ONE JSON object {"answer": "<the 12-line decision log>", "confidence": <0-1>}.` });
    }
    case "gnani_text_to_speech": return G.textToSpeech(a, ctx);
    case "whatsapp_send": return sendWhatsApp(a);
    default: return null;
  }
}

// Calls a tool and logs the call (for /logs, the decision log, and debugging empty arguments).
export async function callTool(name, args = {}, ctx = {}) {
  const t0 = Date.now();
  // AgenticOrg sometimes wraps arguments as {kwargs:{...}}; unwrap it.
  let a = args && typeof args === "object" ? args : {};
  if (a.kwargs && typeof a.kwargs === "object") a = { ...a, ...a.kwargs };
  let out;
  try {
    out = await run(name, a, ctx);
  } catch (e) {
    out = { status: 500, body: { error: "internal_error", message: String(e?.message || e).slice(0, 200) } };
  }
  if (!out) return null;
  const text = out.raw !== undefined ? out.raw : JSON.stringify(out.body);
  try {
    await push("calls", {
      ts: istStamp(await nowIST()), real_ts: new Date().toISOString(), via: ctx.via || "mcp", tool: name,
      rail: (TOOLS.find((t) => t.name === name) || {}).rail, args: a, status: out.status, ms: Date.now() - t0,
      result: String(text).slice(0, 700)
    });
  } catch { /* logging must never break a call */ }
  return { status: out.status, text, isError: out.status >= 400 };
}
