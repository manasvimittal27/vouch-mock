// Delhivery mock logic for Vouch (Round 3, The Ken x Pine Labs).
// Endpoint paths and field names follow Delhivery's B2C API docs:
//   GET /c/api/pin-codes/json/?filter_codes=<pin>   (Pincode Serviceability)
//   GET /api/dc/expected_tat?origin_pin=&destination_pin=&mot=&pdt=   (Expected TAT)
// NOTE: verify the Expected TAT path and response fields against your Delhivery
// developer-portal docs and adjust here if they differ.

// ---- Test pincodes that trigger failure modes (for eval cases) ----
export const TRIGGERS = {
  TIMEOUT: "000001",    // sleeps longer than AgenticOrg's 10 s connector timeout
  MALFORMED: "000002",  // returns a broken, non-JSON body
  SERVER_ERROR: "000003" // returns HTTP 500
};

// Pincodes Delhivery does not serve (non-serviceable)
const NOT_SERVICEABLE = new Set(["744301", "799999", "190025"]);

// Out-of-delivery-area pincodes: serviceable but slower, often prepaid only
const ODA = new Set(["194101", "793001", "176215"]);

// Friendly names for the pincodes used in demos
const PLACES = {
  "110017": { city: "New Delhi", district: "South Delhi", state_code: "DL" },
  "110001": { city: "New Delhi", district: "Central Delhi", state_code: "DL" },
  "122002": { city: "Gurugram", district: "Gurugram", state_code: "HR" },
  "201301": { city: "Noida", district: "Gautam Buddha Nagar", state_code: "UP" },
  "400001": { city: "Mumbai", district: "Mumbai", state_code: "MH" },
  "560034": { city: "Bengaluru", district: "Bengaluru Urban", state_code: "KA" },
  "302001": { city: "Jaipur", district: "Jaipur", state_code: "RJ" },
  "700001": { city: "Kolkata", district: "Kolkata", state_code: "WB" },
  "600001": { city: "Chennai", district: "Chennai", state_code: "TN" },
  "194101": { city: "Leh", district: "Leh", state_code: "LA" },
  "793001": { city: "Shillong", district: "East Khasi Hills", state_code: "ML" },
  "176215": { city: "Dharamshala", district: "Kangra", state_code: "HP" }
};

export const isValidPin = (pin) => /^[1-9][0-9]{5}$/.test(String(pin || ""));

// Metro areas whose pincodes start differently but deliver like one city
const METROS = [
  ["110", "121", "122", "124", "201"],        // Delhi NCR
  ["400", "401", "410", "421"],                // Mumbai MMR
  ["560", "562"],                              // Bengaluru
  ["700", "711", "712"],                       // Kolkata
  ["600", "601", "603"]                        // Chennai
];
const sameMetro = (a, b) => METROS.some((m) => m.includes(a.slice(0, 3)) && m.includes(b.slice(0, 3)));

// Neighbouring postal zones (first digit): 1 North, 2 UP/UK, 3 RJ/GJ, 4 MH/MP, 5 South-central, 6 TN/KL, 7 East/NE, 8 BR/JH
const NEIGHBOURS = new Set(["12", "13", "23", "28", "24", "34", "45", "46", "56", "78", "47"]);
const neighbourZones = (a, b) => NEIGHBOURS.has([a[0], b[0]].sort().join(""));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Pincode serviceability: same shape as Delhivery's /c/api/pin-codes/json/ ----
export function pincodeServiceability(filterCodes) {
  const pins = String(filterCodes || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const delivery_codes = [];
  for (const pin of pins) {
    if (!isValidPin(pin) || NOT_SERVICEABLE.has(pin)) continue; // Delhivery omits unserved pins
    const place = PLACES[pin] || { city: "", district: "", state_code: "" };
    const oda = ODA.has(pin);
    delivery_codes.push({
      postal_code: {
        pin: Number(pin),
        city: place.city,
        district: place.district,
        state_code: place.state_code,
        country_code: "IN",
        pre_paid: "Y",
        cash: oda ? "N" : "Y",
        cod: oda ? "N" : "Y",
        pickup: oda ? "N" : "Y",
        repl: oda ? "N" : "Y",
        is_oda: oda ? "Y" : "N",
        remarks: oda ? "Out of delivery area: extra transit time" : ""
      }
    });
  }
  return { delivery_codes };
}

// ---- Expected TAT (days) between two pincodes ----
// Deterministic so eval runs are repeatable:
//   same first 3 digits or same metro (e.g. Delhi NCR) -> 1 day
//   same first 2 digits (same circle)-> 2 days
//   same first digit (same zone)     -> 3 days
//   neighbouring zone                -> 3 days
//   distant zone                     -> 5 days
//   ODA destination                  -> +2 days
//   mot "E" (express/air)            -> -1 day (min 1)
export function expectedTat({ origin_pin, destination_pin, mot = "S", pdt = "B2C" }) {
  if (!isValidPin(origin_pin) || !isValidPin(destination_pin)) {
    return { status: 400, body: { success: false, msg: "Invalid origin_pin or destination_pin", data: {} } };
  }
  if (NOT_SERVICEABLE.has(String(destination_pin))) {
    return { status: 200, body: { success: false, msg: "Destination pincode not serviceable", data: {} } };
  }
  const o = String(origin_pin), d = String(destination_pin);
  let tat = o.slice(0, 3) === d.slice(0, 3) || sameMetro(o, d) ? 1
    : o.slice(0, 2) === d.slice(0, 2) ? 2
    : o[0] === d[0] ? 3
    : neighbourZones(o, d) ? 3
    : 5;
  if (ODA.has(d)) tat += 2;
  if (String(mot).toUpperCase() === "E") tat = Math.max(1, tat - 1);
  return {
    status: 200,
    body: { success: true, msg: "", data: { tat, origin_pin: Number(o), destination_pin: Number(d), mot, pdt } }
  };
}

// ---- Shared failure-mode handling ----
// Returns null when no trigger applies; otherwise { status, raw } describing the failure.
export async function failureFor(...pins) {
  const all = pins.map((p) => String(p || ""));
  if (all.some((p) => p.includes(TRIGGERS.TIMEOUT))) {
    await sleep(12000);
    return { status: 504, raw: "Gateway Timeout" };
  }
  if (all.some((p) => p.includes(TRIGGERS.MALFORMED))) {
    return { status: 200, raw: '{"delivery_codes": [{"postal_code": {"pin": 1100' }; // truncated JSON
  }
  if (all.some((p) => p.includes(TRIGGERS.SERVER_ERROR))) {
    return { status: 500, raw: "<html><body><h1>500 Internal Server Error</h1></body></html>" };
  }
  return null;
}

// ======================================================================
// v0.3 additions: shipment creation, tracking, doorstep exchange
// ======================================================================
import { get as sget, set as sset, next as snext } from "./store.js";
import { nowIST, ymd, addDays, parseYmd, istStamp, daysBetween } from "./clock.js";

const CITY = (pin) => (PLACES[String(pin)] || {}).city || "";

// Mirrors POST /api/cmu/create.json (form: format=json&data={shipments:[...], pickup_location:{name}}).
// payment_mode: "Prepaid" (forward), "Pickup" (reverse pickup / return), "REPL" (replacement).
export async function createShipment(a = {}) {
  const pin = String(a.pin || a.destination_pin || "").trim();
  const ref = String(a.order || a.order_ref || a.seller_order_id || "").trim();
  const mode = String(a.payment_mode || "Prepaid");
  if (!ref) return { status: 400, body: { success: false, rmk: "order (your order reference) is required", packages: [] } };
  if (!isValidPin(pin) || NOT_SERVICEABLE.has(pin)) {
    return { status: 200, body: { success: false, package_count: 1, packages: [{ status: "Fail", refnum: ref, serviceable: false, remarks: [`Pincode ${pin || "(missing)"} is not serviceable`] }] } };
  }
  const sellerOrder = (await sget(`seller_order:${ref}`)) || {};
  const origin = String(a.pickup_pin || a.origin_pin || sellerOrder.ship_from_pin || "110001");
  const dispatch = Number(sellerOrder.dispatch_days ?? 1);
  const tat = expectedTat({ origin_pin: origin, destination_pin: pin }).body.data?.tat ?? 5;
  const now = await nowIST();
  const waybill = `14908${String(100000000 + (await snext("waybill"))).slice(1)}`;
  const pickup = addDays(now, mode === "Pickup" ? 1 : dispatch);
  const edd = addDays(pickup, mode === "Pickup" ? 0 : tat);
  const shipment = {
    waybill, refnum: ref, payment_mode: mode, origin_pin: origin, destination_pin: pin,
    consignee: a.name || a.consignee_name || sellerOrder.customer_name || "", phone: a.phone || sellerOrder.phone || "",
    products_desc: a.products_desc || sellerOrder.title || "", total_amount: Number(a.total_amount || sellerOrder.amount || 0),
    product_id: sellerOrder.product_id || null, size: sellerOrder.size || null, merchant_key: sellerOrder.merchant_key || null,
    created_at: istStamp(now), pickup_date: ymd(pickup), promised_delivery_date: ymd(edd), expected_delivery_date: ymd(edd)
  };
  await sset(`shp:${waybill}`, shipment);
  if (ref) await sset(`shp_by_ref:${ref}`, waybill);
  return {
    status: 200,
    body: {
      success: true, package_count: 1, upload_wbn: `UPL${waybill.slice(-8)}`, rmk: "",
      prepaid_count: mode === "Prepaid" ? 1 : 0, pickups_count: mode === "Pickup" ? 1 : 0, replacement_count: mode === "REPL" ? 1 : 0, cod_count: 0,
      packages: [{ status: "Success", waybill, refnum: ref, payment: mode === "Prepaid" ? "Pre-paid" : mode, serviceable: true, sort_code: `${(CITY(pin) || "HUB").slice(0, 3).toUpperCase()}/ODH`, remarks: [] }]
    }
  };
}

// Mirrors GET /api/v1/packages/json/?waybill=<awb>
export async function track(a = {}) {
  let wb = String(a.waybill || "").trim();
  if (!wb && a.ref_ids) wb = (await sget(`shp_by_ref:${String(a.ref_ids).trim()}`)) || "";
  const s = wb ? await sget(`shp:${wb}`) : null;
  if (!s) return { status: 200, body: { ShipmentData: [], Error: `No data found for waybill ${wb || "(missing)"}` } };
  const now = await nowIST();
  const scn = (await sget("scn:tracking")) || { mode: "normal" };
  let edd = parseYmd(s.expected_delivery_date);
  const forced = scn.waybill ? scn.waybill === wb : true;
  let status = "In Transit", type = "UD", loc = `${CITY(s.origin_pin) || s.origin_pin} hub`, instr = "Shipment in transit";
  if (forced && scn.mode === "delayed") {
    edd = addDays(parseYmd(s.promised_delivery_date), 3);
    status = "Delayed"; instr = "Shipment held at hub due to line-haul capacity; revised EDD shared";
  }
  if (forced && scn.mode === "delivered" && !s.delivered_on) { s.delivered_on = ymd(now); await sset(`shp:${wb}`, s); }
  const pickup = parseYmd(s.pickup_date);
  const delayed = forced && scn.mode === "delayed";
  if (s.delivered_on || (!delayed && daysBetween(edd, now) >= 0)) {
    const on = s.delivered_on || ymd(edd);
    const isPickup = s.payment_mode === "Pickup";
    status = isPickup ? "Picked Up" : "Delivered"; type = isPickup ? "PU" : "DL";
    loc = CITY(s.destination_pin) || s.destination_pin; instr = isPickup ? "Return picked up from customer" : "Delivered to consignee";
    if (!s.delivered_on) { s.delivered_on = on; await sset(`shp:${wb}`, s); }
  } else if (delayed) {
    // status/instructions already set above
  } else if (daysBetween(pickup, now) < 0) {
    status = "Manifested"; instr = "Pickup scheduled"; loc = CITY(s.origin_pin) || s.origin_pin;
  } else if (daysBetween(edd, now) === -1) {
    status = "Out for Delivery"; loc = CITY(s.destination_pin) || s.destination_pin; instr = "Out for delivery";
  }
  return {
    status: 200,
    body: {
      ShipmentData: [{
        Shipment: {
          AWB: wb, ReferenceNo: s.refnum, Origin: CITY(s.origin_pin) || s.origin_pin, Destination: CITY(s.destination_pin) || s.destination_pin,
          PickUpDate: s.pickup_date, PromisedDeliveryDate: s.promised_delivery_date, ExpectedDeliveryDate: ymd(edd),
          DeliveryDate: status === "Delivered" || status === "Picked Up" ? s.delivered_on : null,
          OrderType: s.payment_mode, Status: { Status: status, StatusType: type, StatusDateTime: istStamp(now), StatusLocation: loc, Instructions: instr }
        }
      }]
    }
  };
}

// EXTRA CAPABILITY #3 (Delhivery): same-visit doorstep size exchange that must land before a date.
// Builds on Delhivery's existing REPL (replacement) shipments + reverse pickup network; the new part
// is the deadline check and booking both legs as one visit.
export async function doorstepExchange(a = {}, ctx = {}) {
  const wb = String(a.waybill || "").trim();
  const newSize = String(a.new_size || "").trim().toUpperCase();
  const neededBy = parseYmd(a.needed_by);
  const s = wb ? await sget(`shp:${wb}`) : null;
  if (!s) return { status: 404, body: { success: false, error: `Unknown waybill ${wb || "(missing)"}` } };
  if (!newSize) return { status: 400, body: { success: false, error: "new_size is required, e.g. 'XL'" } };
  if (!neededBy) return { status: 400, body: { success: false, error: "needed_by is required as YYYY-MM-DD" } };
  const pc = ODA.has(s.destination_pin) ? "N" : "Y";
  if (pc === "N") return { status: 200, body: { success: true, feasible: false, reason: "Replacement (REPL) not available at this pincode", waybill: wb } };
  const scn = (await sget("scn:exchange")) || { mode: "normal" };
  const inStock = ctx.stockFor ? await ctx.stockFor(s.product_id, newSize) : 1;
  if (scn.mode === "no_stock" || inStock <= 0) {
    return { status: 200, body: { success: true, feasible: false, reason: `Seller has no ${newSize} in stock for this item`, waybill: wb } };
  }
  const now = await nowIST();
  const tat = expectedTat({ origin_pin: s.origin_pin, destination_pin: s.destination_pin }).body.data?.tat ?? 5;
  const visit = addDays(now, 1 + tat + (scn.mode === "slow" ? 4 : 0));
  const buffer = daysBetween(visit, neededBy);
  if (buffer < 1) {
    return { status: 200, body: { success: true, feasible: false, reason: "Same-visit swap cannot reach before needed_by", earliest_visit_date: ymd(visit), needed_by: ymd(neededBy), waybill: wb } };
  }
  const exId = `EXC${String(1000 + (await snext("exchange")))}`;
  const replWb = `14908${String(100000000 + (await snext("waybill"))).slice(1)}`;
  const repl = { ...s, waybill: replWb, refnum: exId, payment_mode: "REPL", size: newSize, pickup_date: ymd(addDays(now, 1)), promised_delivery_date: ymd(visit), expected_delivery_date: ymd(visit), delivered_on: null, created_at: istStamp(now) };
  await sset(`shp:${replWb}`, repl);
  await sset(`exchange:${exId}`, { exId, original_waybill: wb, replacement_waybill: replWb, new_size: newSize, visit_date: ymd(visit) });
  return {
    status: 200,
    body: {
      success: true, feasible: true, exchange_id: exId, original_waybill: wb, replacement_waybill: replWb,
      new_size: newSize, same_visit: true, visit_date: ymd(visit), needed_by: ymd(neededBy), buffer_days: buffer,
      note: "Courier delivers the new size and collects the old piece in the same visit; old piece must be unworn with tags."
    }
  };
}
