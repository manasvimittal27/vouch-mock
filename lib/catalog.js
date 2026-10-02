// Sample multi-seller catalogue for the Vouch demo (extra capability #1, Pine Labs).
// Every listing, seller and review here is SAMPLE DATA made up for the demo — not a real product.
// Hero items cover each filter rule so the agent's decisions are visible:
//   P01 winner · P02 same dress, pricier seller · P03 cheaper alt · P04 safest-fit alt
//   P05 out of stock in her size · P06 over budget · P07 fake discount · P08 sleeveless
//   P09 sheer georgette (her past return) · P10 slow seller · P11 heavy jewel-tone

export const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
export const SIZE_CHART = {
  XS: { chest_cm: 81, shoulder_cm: 34 }, S: { chest_cm: 86, shoulder_cm: 35 },
  M: { chest_cm: 91, shoulder_cm: 36.5 }, L: { chest_cm: 97, shoulder_cm: 38 },
  XL: { chest_cm: 102, shoulder_cm: 39.5 }, XXL: { chest_cm: 107, shoulder_cm: 41 }
};

export const MERCHANTS = {
  M01: { merchant_id: "pl_mid_80211", name: "Noor & Thread", ship_from_pin: "201301", dispatch_days: 1, exchange: "doorstep_exchange", return_window_days: 7 },
  M02: { merchant_id: "pl_mid_80377", name: "Kurti Kart", ship_from_pin: "400001", dispatch_days: 1, exchange: "doorstep_exchange", return_window_days: 7 },
  M03: { merchant_id: "pl_mid_80412", name: "Gulabi Jaipur Prints", ship_from_pin: "302001", dispatch_days: 1, exchange: "return_only", return_window_days: 7 },
  M04: { merchant_id: "pl_mid_80530", name: "Saanjh Studio", ship_from_pin: "110001", dispatch_days: 0, exchange: "doorstep_exchange", return_window_days: 10 },
  M05: { merchant_id: "pl_mid_80691", name: "Kaveri Looms", ship_from_pin: "600001", dispatch_days: 5, exchange: "return_only", return_window_days: 7 },
  M06: { merchant_id: "pl_mid_80744", name: "Bandhej House", ship_from_pin: "560034", dispatch_days: 2, exchange: "no_exchange", return_window_days: 3 }
};

const stock = (xs, s, m, l, xl, xxl) => ({ XS: xs, S: s, M: m, L: l, XL: xl, XXL: xxl });

// reviews: [height_cm, weight_kg, size_bought, verdict, note]
export const PRODUCTS = [
  {
    product_id: "P01", group_id: "G01", merchant: "M01",
    title: "Mint cotton anarkali with gota border", category: "anarkali",
    colour: "mint green", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "mehendi", "puja", "day_function", "festive"],
    mrp: 3799, price: 1899, lowest_price_30d: 1999, fit_runs: "small",
    stock: stock(2, 4, 5, 3, 2, 0),
    reviews: [
      [158, 56, "L", "fits", "Took L, shoulders perfect"], [161, 59, "L", "fits", "Runs small, size up"],
      [163, 60, "L", "fits", "L fits well, length good"], [157, 55, "L", "fits", "Comfortable for long day"],
      [160, 57, "L", "fits", "Sized up, glad I did"], [164, 61, "L", "fits", "Lovely flare"],
      [159, 58, "L", "fits", "True colour, mint"], [162, 57, "M", "tight_shoulders", "M tight at shoulders, exchanged"],
      [156, 54, "M", "tight_shoulders", "Should have taken L"], [170, 68, "XL", "fits", ""], [152, 48, "S", "fits", ""]
    ]
  },
  {
    product_id: "P02", group_id: "G01", merchant: "M02",
    title: "Mint cotton anarkali with gota border", category: "anarkali",
    colour: "mint green", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "mehendi", "puja", "day_function", "festive"],
    mrp: 3799, price: 2199, lowest_price_30d: 2199, fit_runs: "small",
    stock: stock(1, 3, 6, 5, 3, 1),
    reviews: [[160, 58, "L", "fits", "Runs small"], [162, 60, "L", "fits", ""], [158, 57, "M", "tight_shoulders", ""]]
  },
  {
    product_id: "P03", group_id: "G03", merchant: "M03",
    title: "Powder blue chanderi kurta set with dupatta", category: "kurta_set",
    colour: "powder blue", colour_family: "pastel", fabric: "chanderi cotton", sheer: false,
    silhouette: "straight", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "puja", "day_function", "festive", "office_party"],
    mrp: 2599, price: 1299, lowest_price_30d: 1299, fit_runs: "true",
    stock: stock(3, 6, 7, 4, 2, 2),
    reviews: [[159, 57, "M", "fits", "Fits as expected"], [161, 59, "M", "tight_shoulders", "A bit snug on shoulders"],
      [163, 60, "L", "fits", ""], [157, 56, "M", "fits", ""], [160, 58, "M", "fits", "Light, good for outdoors"]]
  },
  {
    product_id: "P04", group_id: "G04", merchant: "M04",
    title: "Lavender cotton A-line anarkali with thread embroidery, roomy shoulder", category: "anarkali",
    colour: "lavender", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "a_line", sleeve: "elbow", work: "medium", occasions: ["engagement", "sangeet", "festive", "day_function", "puja"],
    mrp: 3299, price: 2299, lowest_price_30d: 2299, fit_runs: "true",
    stock: stock(2, 3, 6, 6, 3, 2),
    reviews: [[160, 58, "M", "fits", "Roomy shoulders, perfect"], [158, 56, "M", "fits", ""], [162, 60, "M", "fits", ""],
      [161, 59, "M", "fits", "Broad shoulders, no issue"], [157, 55, "M", "fits", ""], [163, 61, "L", "fits", ""],
      [159, 57, "M", "fits", ""], [164, 62, "M", "fits", ""], [156, 54, "M", "fits", ""], [160, 59, "M", "fits", ""], [165, 63, "L", "loose", ""]]
  },
  {
    product_id: "P05", group_id: "G05", merchant: "M04",
    title: "Peach cotton anarkali with mirror yoke", category: "anarkali",
    colour: "peach", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "mehendi", "festive", "day_function"],
    mrp: 2999, price: 1799, lowest_price_30d: 1799, fit_runs: "small",
    stock: stock(3, 2, 0, 0, 1, 0),
    reviews: [[160, 58, "L", "fits", ""], [159, 57, "L", "fits", ""], [162, 59, "L", "fits", ""]]
  },
  {
    product_id: "P06", group_id: "G06", merchant: "M01",
    title: "Sage green linen kurta set with organza dupatta", category: "kurta_set",
    colour: "sage green", colour_family: "pastel", fabric: "linen", sheer: false,
    silhouette: "straight", sleeve: "full", work: "medium", occasions: ["engagement", "festive", "reception", "sangeet"],
    mrp: 4499, price: 3200, lowest_price_30d: 3200, fit_runs: "true",
    stock: stock(2, 4, 5, 5, 3, 1),
    reviews: [[160, 58, "M", "fits", ""], [161, 58, "M", "fits", ""], [158, 56, "M", "fits", ""]]
  },
  {
    product_id: "P07", group_id: "G07", merchant: "M02",
    title: "Blush pink cotton kurta with lace hem", category: "kurta",
    colour: "blush pink", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "festive", "day_function", "puja"],
    mrp: 5999, price: 2399, lowest_price_30d: 1899, fit_runs: "true",
    stock: stock(2, 3, 4, 4, 2, 1),
    reviews: [[160, 58, "M", "fits", ""], [162, 60, "M", "fits", ""], [158, 55, "M", "fits", "Price was lower last week"]]
  },
  {
    product_id: "P08", group_id: "G08", merchant: "M04",
    title: "Mint cotton sleeveless maxi dress", category: "dress",
    colour: "mint", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "sleeveless", work: "simple", occasions: ["engagement", "pool_party", "day_function", "brunch"],
    mrp: 2499, price: 1599, lowest_price_30d: 1599, fit_runs: "true",
    stock: stock(3, 5, 6, 4, 2, 1),
    reviews: [[160, 58, "M", "fits", ""], [161, 57, "M", "fits", ""]]
  },
  {
    product_id: "P09", group_id: "G09", merchant: "M02",
    title: "Ivory sheer georgette anarkali", category: "anarkali",
    colour: "ivory", colour_family: "pastel", fabric: "georgette", sheer: true,
    silhouette: "flowy", sleeve: "full", work: "medium", occasions: ["engagement", "reception", "festive"],
    mrp: 3999, price: 2099, lowest_price_30d: 2099, fit_runs: "true",
    stock: stock(2, 4, 5, 5, 2, 1),
    reviews: [[160, 58, "M", "fits", "Needs a full slip, quite see-through"], [159, 56, "M", "returned", "Too sheer"]]
  },
  {
    product_id: "P10", group_id: "G10", merchant: "M05",
    title: "Pastel yellow cotton anarkali with zari piping", category: "anarkali",
    colour: "pastel yellow", colour_family: "pastel", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["engagement", "mehendi", "haldi", "festive", "puja"],
    mrp: 3499, price: 1999, lowest_price_30d: 1999, fit_runs: "true",
    stock: stock(2, 4, 6, 5, 3, 1),
    reviews: [[160, 58, "M", "fits", ""], [162, 59, "M", "fits", ""], [157, 55, "M", "fits", ""]]
  },
  {
    product_id: "P11", group_id: "G11", merchant: "M04",
    title: "Emerald velvet lehenga with heavy zari work", category: "lehenga",
    colour: "emerald", colour_family: "jewel", fabric: "velvet", sheer: false,
    silhouette: "flared", sleeve: "elbow", work: "heavy", occasions: ["wedding", "reception", "sangeet", "engagement"],
    mrp: 6999, price: 3800, lowest_price_30d: 3800, fit_runs: "true",
    stock: stock(1, 2, 3, 3, 2, 1),
    reviews: [[160, 58, "M", "fits", ""], [161, 60, "M", "fits", "Heavy but stunning"]]
  },
  {
    product_id: "P12", group_id: "G12", merchant: "M03",
    title: "Maroon banarasi silk saree with zari border", category: "saree",
    colour: "maroon", colour_family: "jewel", fabric: "silk", sheer: false,
    silhouette: "drape", sleeve: "blouse_elbow", work: "heavy", occasions: ["wedding", "reception", "festive", "diwali"],
    mrp: 5499, price: 2899, lowest_price_30d: 2899, fit_runs: "true",
    stock: stock(4, 4, 4, 4, 4, 4),
    reviews: [[160, 58, "M", "fits", "Blouse stitched M, good"], [158, 55, "M", "fits", ""]]
  },
  {
    product_id: "P13", group_id: "G13", merchant: "M01",
    title: "Rani pink silk-blend anarkali with gota work", category: "anarkali",
    colour: "rani pink", colour_family: "bright", fabric: "silk blend", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "heavy", occasions: ["wedding", "sangeet", "reception", "festive", "diwali"],
    mrp: 5999, price: 3499, lowest_price_30d: 3499, fit_runs: "small",
    stock: stock(1, 3, 4, 4, 2, 1),
    reviews: [[160, 58, "L", "fits", "Size up"], [161, 59, "L", "fits", ""], [159, 57, "M", "tight_shoulders", ""]]
  },
  {
    product_id: "P14", group_id: "G14", merchant: "M04",
    title: "Wine chanderi kurta set with heavy dupatta", category: "kurta_set",
    colour: "wine", colour_family: "jewel", fabric: "chanderi", sheer: false,
    silhouette: "straight", sleeve: "three_quarter", work: "medium", occasions: ["wedding", "festive", "diwali", "reception"],
    mrp: 4999, price: 2799, lowest_price_30d: 2799, fit_runs: "true",
    stock: stock(2, 4, 5, 5, 3, 2),
    reviews: [[160, 58, "M", "fits", ""], [162, 61, "M", "fits", ""], [157, 55, "M", "fits", ""]]
  },
  {
    product_id: "P15", group_id: "G15", merchant: "M06",
    title: "Marigold cotton sharara set", category: "sharara_set",
    colour: "marigold yellow", colour_family: "bright", fabric: "cotton", sheer: false,
    silhouette: "flowy", sleeve: "three_quarter", work: "simple", occasions: ["mehendi", "haldi", "day_function", "festive"],
    mrp: 2799, price: 1499, lowest_price_30d: 1499, fit_runs: "true",
    stock: stock(2, 5, 6, 5, 3, 2),
    reviews: [[160, 58, "M", "fits", ""], [159, 57, "M", "fits", ""]]
  },
  {
    product_id: "P16", group_id: "G16", merchant: "M04",
    title: "Champagne sequin georgette gown", category: "dress",
    colour: "champagne", colour_family: "pastel", fabric: "georgette", sheer: false,
    silhouette: "fitted", sleeve: "full", work: "heavy", occasions: ["reception", "cocktail", "sangeet"],
    mrp: 5999, price: 2999, lowest_price_30d: 2999, fit_runs: "small",
    stock: stock(1, 2, 3, 3, 2, 1),
    reviews: [[160, 58, "L", "fits", "Fitted, size up"], [161, 59, "L", "fits", ""], [158, 56, "M", "tight_shoulders", ""]]
  },
  {
    product_id: "P17", group_id: "G17", merchant: "M03",
    title: "Coral cotton co-ord set with block print", category: "coord_set",
    colour: "coral", colour_family: "bright", fabric: "cotton", sheer: false,
    silhouette: "relaxed", sleeve: "short", work: "simple", occasions: ["brunch", "day_function", "pool_party", "office_party"],
    mrp: 2199, price: 1199, lowest_price_30d: 1199, fit_runs: "true",
    stock: stock(3, 5, 6, 5, 3, 2),
    reviews: [[160, 58, "M", "fits", ""], [162, 60, "M", "fits", ""]]
  },
  {
    product_id: "P18", group_id: "G18", merchant: "M02",
    title: "Red bandhani georgette lehenga", category: "lehenga",
    colour: "red", colour_family: "bright", fabric: "georgette", sheer: false,
    silhouette: "flared", sleeve: "elbow", work: "heavy", occasions: ["wedding", "sangeet", "diwali", "festive"],
    mrp: 7999, price: 4299, lowest_price_30d: 4299, fit_runs: "true",
    stock: stock(1, 2, 3, 3, 2, 1),
    reviews: [[160, 58, "M", "fits", ""]]
  }
];

const MEN = /\b(men|mens|men's|husband|pati|boy|groom|sherwani|kurta pyjama|nehru jacket|bhai ke liye|male)\b/i;

const OCCASION_SYNONYMS = {
  engagement: ["engagement", "sagai", "ring ceremony", "roka"],
  wedding: ["wedding", "shaadi", "shadi", "vivah", "bhai ki shaadi"],
  reception: ["reception"], sangeet: ["sangeet"], mehendi: ["mehendi", "mehndi"], haldi: ["haldi"],
  diwali: ["diwali", "deepavali"], festive: ["festive", "festival", "navratri", "puja", "pooja", "karva"],
  puja: ["puja", "pooja"], pool_party: ["pool party", "pool"], cocktail: ["cocktail", "party"],
  brunch: ["brunch"], office_party: ["office"], day_function: ["day function", "lunch", "daytime"]
};

export function normOccasion(s) {
  const t = String(s || "").toLowerCase();
  for (const [k, words] of Object.entries(OCCASION_SYNONYMS)) if (words.some((w) => t.includes(w))) return k;
  return t.trim() || null;
}

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function similarBuild(p, h, w) {
  if (!h || !w) return null;
  const sim = p.reviews.filter((r) => Math.abs(r[0] - h) <= 5 && Math.abs(r[1] - w) <= 5);
  const sizes = {};
  let fits = 0;
  const issues = {};
  for (const r of sim) {
    sizes[r[2]] = (sizes[r[2]] || 0) + 1;
    if (r[3] === "fits") fits++;
    else issues[`${r[2]}:${r[3]}`] = (issues[`${r[2]}:${r[3]}`] || 0) + 1;
  }
  const keptBySize = {};
  for (const r of sim) if (r[3] === "fits") keptBySize[r[2]] = (keptBySize[r[2]] || 0) + 1;
  return { window: "±5 cm, ±5 kg", count: sim.length, sizes_bought: sizes, happy_with_fit_by_size: keptBySize, fit_issues: issues };
}

export function publicView(p, { h, w } = {}) {
  const m = MERCHANTS[p.merchant];
  return {
    product_id: p.product_id, group_id: p.group_id, title: p.title, category: p.category,
    seller: { merchant_id: m.merchant_id, name: m.name, ship_from_pin: m.ship_from_pin, dispatch_days: m.dispatch_days, exchange_policy: m.exchange, return_window_days: m.return_window_days },
    attributes: { colour: p.colour, colour_family: p.colour_family, fabric: p.fabric, sheer: p.sheer, silhouette: p.silhouette, sleeve: p.sleeve, work: p.work, occasions: p.occasions },
    price: { mrp: p.mrp, selling_price: p.price, lowest_price_30d: p.lowest_price_30d, currency: "INR" },
    stock_by_size: p.stock, size_chart_cm: SIZE_CHART, fit_runs: p.fit_runs,
    review_count: p.reviews.length,
    buyers_like_you: similarBuild(p, h, w)
  };
}

export function search(args = {}) {
  const q = `${args.query || ""} ${args.occasion || ""} ${args.category || ""}`;
  if (MEN.test(q)) {
    return { items: [], total: 0, note: "No results: this catalogue covers women's occasion wear only." };
  }
  const occ = normOccasion(args.occasion || args.query);
  const maxPrice = num(args.max_price);
  const h = num(args.buyer_height_cm), w = num(args.buyer_weight_kg);
  const words = String(args.query || "").toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 3);
  const scored = PRODUCTS.map((p) => {
    let s = 0;
    if (occ && p.occasions.includes(occ)) s += 5;
    if (occ === "engagement" && p.occasions.includes("festive")) s += 1;
    const hay = `${p.title} ${p.category} ${p.colour} ${p.colour_family} ${p.fabric} ${p.work}`.toLowerCase();
    for (const wd of words) if (hay.includes(wd)) s += 1;
    return { p, s };
  })
    .filter((x) => x.s > 0 || !occ)
    .filter((x) => !maxPrice || x.p.price <= Math.round(maxPrice * 1.5)) // loose: retrieval, not the budget filter
    .sort((a, b) => b.s - a.s || a.p.product_id.localeCompare(b.p.product_id))
    .slice(0, 12);
  return {
    total: scored.length,
    note: "Retrieval only: NOT filtered by her size, budget, date or dealbreakers. Apply your rules yourself. One line per listing.",
    items: scored.map((x) => lineView(x.p, { h, w }))
  };
}

// One flat line per listing: same facts as publicView, easier for an LLM to keep straight.
const SLEEVE = { three_quarter: "3/4 sleeve", full: "full sleeve", elbow: "elbow sleeve", short: "short sleeve", sleeveless: "SLEEVELESS", blouse_elbow: "blouse elbow sleeve" };
export function lineView(p, { h, w } = {}) {
  const m = MERCHANTS[p.merchant];
  const sig = p.price < p.lowest_price_30d ? "BELOW its 30-day low (real drop)" : p.price === p.lowest_price_30d ? "equal to its 30-day low" : "ABOVE its 30-day low (inflated discount)";
  const stock = SIZES.map((s) => `${s}:${p.stock[s] || 0}`).join(" ");
  const b = similarBuild(p, h, w);
  let buyers = "buyers like you: none";
  if (b) {
    const happy = Object.entries(b.happy_with_fit_by_size).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    const issues = Object.entries(b.fit_issues).map(([k, v]) => `${k.replace(":", " ").replace("_", " ")} ${v}`).join(", ");
    buyers = `buyers like you (±5 cm, ±5 kg): ${b.count}; happy with fit by size: ${happy}${issues ? `; problems: ${issues}` : ""}`;
  }
  return `${p.product_id} | group ${p.group_id} | ${p.title} (${p.category}) | price ₹${p.price}, MRP ₹${p.mrp}, 30-day low ₹${p.lowest_price_30d} → ${sig} | seller ${m.name}, ships from ${m.ship_from_pin}, dispatch ${m.dispatch_days} day(s), ${m.exchange.replace("_", " ")}, return window ${m.return_window_days} days | ${p.colour} (${p.colour_family}) · work ${p.work} · ${p.silhouette} · ${p.fabric} · ${p.sheer ? "SHEER" : "not sheer"} · ${SLEEVE[p.sleeve] || p.sleeve} | occasions: ${p.occasions.join(", ")} | fit runs ${p.fit_runs} | stock ${stock} | ${buyers}`;
}

export const byId = (id) => PRODUCTS.find((p) => p.product_id === String(id || "").trim().toUpperCase());
