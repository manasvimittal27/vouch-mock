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
//   Twilio WhatsApp inbound (REAL msgs) twilio_whatsapp_inbox — Twilio's inbound webhook lands here; the
//                                      platform's native Twilio connector only sends, it cannot receive.
//   Twilio WhatsApp outbound (REAL)    twilio_send_whatsapp — real Twilio Messages API (native connector drops the body).
import * as D from "./delhivery.js";
import * as P from "./pinelabs.js";
import * as G from "./gnani.js";
import { sendWhatsApp } from "./whatsapp.js";
import { search, SIZE_CHART } from "./catalog.js";
import { push, range } from "./store.js";
import { nowIST, ymd, addDays, istStamp } from "./clock.js";

const S = (d) => ({ type: "string", description: d });
const N = (d) => ({ type: "number", description: d });

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
    description: "EXTRA CAPABILITY (Delhivery): book a same-visit size exchange (new size delivered, old piece collected in one visit) only if it lands at least 1 day before needed_by. Returns feasible true/false, visit_date and buffer_days. Only call after her explicit yes. Example: {\"waybill\": \"1490810000001\", \"new_size\": \"XL\", \"needed_by\": \"2026-10-14\"}",
    inputSchema: { type: "object", properties: { waybill: S("Waybill of the delivered order"), new_size: S("Size to send, e.g. 'XL'"), needed_by: S("Occasion date YYYY-MM-DD") }, required: ["waybill", "new_size", "needed_by"] }
  },
  {
    name: "pinelabs_catalog_search", rail: "Pine Labs", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Pine Labs): search occasion wear across Pine Labs merchants. Returns up to 12 listings with seller ship_from_pin and dispatch_days, price, lowest_price_30d, stock_by_size, fit_runs, and buyers_like_you (reviewers within ±5 cm and ±5 kg of her), fit points, and the arrival date at her delivery_pin (seller dispatch + Delhivery expected_tat). NOT filtered: you apply F1-F5. Example: {\"query\": \"pastel cotton anarkali\", \"occasion\": \"engagement\", \"buyer_height_cm\": 160, \"buyer_weight_kg\": 58, \"delivery_pin\": \"110017\"}",
    inputSchema: { type: "object", properties: { query: S("What to look for, e.g. 'pastel cotton anarkali'"), occasion: S("e.g. engagement, wedding, mehendi"), buyer_height_cm: N("Her height in cm"), buyer_weight_kg: N("Her weight in kg"), max_price: N("Her budget cap in rupees"), delivery_pin: S("Her delivery pincode, e.g. '110017': each line then shows its arrival date (dispatch + Delhivery tat)") }, required: ["query"] }
  },
  {
    name: "pinelabs_catalog_get_item", rail: "Pine Labs", kind: "extra_capability",
    description: "EXTRA CAPABILITY (Pine Labs): live price and stock for one listing right before checkout. Always call this after her yes and before pinelabs_create_order; if price or stock changed, stop and ask her again. Example: {\"product_id\": \"P01\", \"size\": \"L\"}",
    inputSchema: { type: "object", properties: { product_id: S("e.g. 'P01'"), size: S("e.g. 'L'") }, required: ["product_id", "size"] }
  },
  {
    name: "pinelabs_create_order", rail: "Pine Labs", kind: "mock",
    description: "Pine Labs Plural POST /api/checkout/v1/orders. Creates the payment order and returns order_id and redirect_url (her payment link). amount is in PAISE: ₹1,899 = 189900. Only after her explicit yes to item, size, price and date. Example: {\"merchant_order_reference\": \"vouch-riya-P01-L\", \"amount\": 189900, \"customer_name\": \"Riya\"}",
    inputSchema: { type: "object", properties: { merchant_order_reference: S("Your unique reference, e.g. 'vouch-riya-P01-L'"), amount: N("Amount in paise, e.g. 189900"), customer_name: S("Her name"), customer_phone: S("Her mobile") }, required: ["merchant_order_reference", "amount"] }
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
    description: "EXTRA CAPABILITY (Pine Labs): once the payment is PROCESSED, place the order with the seller and get seller_order_id, ship_from_pin and dispatch_by. Then call delhivery_create_shipment. Example: {\"payment_order_id\": \"v1-20261003-aa-00001\", \"product_id\": \"P01\", \"size\": \"L\", \"pin\": \"110017\"}",
    inputSchema: { type: "object", properties: { payment_order_id: S("Pine Labs order_id that is PROCESSED"), product_id: S("e.g. 'P01'"), size: S("e.g. 'L'"), pin: S("Her pincode"), address: S("Her address"), customer_name: S("Her name") }, required: ["payment_order_id", "product_id", "size"] }
  },
  {
    name: "twilio_whatsapp_inbox", rail: "Twilio WhatsApp", kind: "real_relay",
    description: "Her WhatsApp messages, as received by Twilio (real WhatsApp, delivered here by Twilio's inbound webhook). Returns newest first: from, body, media (voice notes: content_type audio/*, pass media_url to gnani_speech_to_text), received_at. Call this whenever you are told a new message arrived. Example: {\"from\": \"+919812345678\"}",
    inputSchema: { type: "object", properties: { from: S("Her number in E.164, e.g. '+919812345678'; omit for all"), limit: N("How many messages, default 5") }, required: [] }
  },
  {
    name: "twilio_send_whatsapp", rail: "Twilio WhatsApp", kind: "real",
    description: "Send her a REAL WhatsApp message (Twilio Messages API, Vouch sandbox sender +17372508034). Returns sid and status on success. Optional media_url attaches a voice note (e.g. the audio_url from gnani_text_to_speech). Example: {\"to\": \"+919812345678\", \"body\": \"Riya, ek accha option mila hai...\"}",
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
      return D.createShipment(a);
    }
    case "delhivery_track": return D.track(a);
    case "delhivery_doorstep_exchange": return D.doorstepExchange(a, { stockFor: P.stockFor });
    case "pinelabs_catalog_search": {
      const r = search({ ...a, _today: ymd(await nowIST()) });
      return ok({ today: ymd(await nowIST()), searched_at: istStamp(await nowIST()), ...r, data_notice: "Sample listings for the Vouch demo, not real products or sellers." });
    }
    case "pinelabs_catalog_get_item": return P.getItem(a, ctx);
    case "pinelabs_create_order": return P.createOrder(a, ctx);
    case "pinelabs_get_order_status": return P.getOrder(a);
    case "pinelabs_initiate_refund": return P.refund(a);
    case "pinelabs_place_seller_order": return P.placeSellerOrder(a);
    case "gnani_speech_to_text": return G.speechToText(a);
    case "twilio_whatsapp_inbox": {
      const want = String(a.from || "").replace(/[^0-9+]/g, "");
      const n = Math.min(20, Math.max(1, Number(a.limit) || 5));
      const all = await range("inbox", 100);
      const msgs = all.filter((m) => !want || m.from.replace(/[^0-9+]/g, "").endsWith(want.replace(/^\+/, "").slice(-10))).slice(0, n);
      return ok({ count: msgs.length, messages: msgs, today: ymd(await nowIST()) });
    }
    case "gnani_text_to_speech": return G.textToSpeech(a, ctx);
    case "twilio_send_whatsapp": return sendWhatsApp(a);
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
