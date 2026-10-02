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
