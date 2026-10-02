// Personalised fit-and-fulfilment ranking (part of Pine Labs extra capability #1, catalogue).
// Deterministic rules so every verdict is reproducible and cites its rule ID:
//   Z1–Z4 size prediction · F1–F5 hard filters · S1–S2 score · P1 picks · P3 same dress, several sellers.
// The agent reads these rows, checks them, decides what to propose and talks to her.
import { MERCHANTS, SIZES, similarBuild } from "./catalog.js";
import { expectedTat } from "./delhivery.js";

const lc = (v) => String(v || "").toLowerCase();
const up = (size) => SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)] || size;
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const BREATHABLE = /cotton|linen|mulmul|chanderi/;

export function predictSize(p, prof) {
  const tag = String(prof.size_tag || "M").toUpperCase();
  const b = similarBuild(p, prof.h, prof.w);
  if (b && b.count >= 5) {
    const best = Object.entries(b.happy_with_fit_by_size).sort((x, y) => y[1] - x[1])[0];
    if (best) {
      const pct = Math.round((best[1] / b.count) * 100);
      return { size: best[0], conf: pct, why: `Z3: ${best[1]} of ${b.count} buyers like you happy in ${best[0]}` };
    }
  }
  let size = tag, why = "Z1: her size tag";
  if (p.fit_runs === "small") { size = up(tag); why = "Z2: runs small, one size up"; }
  else if (p.silhouette === "fitted" && /broad shoulder/.test(lc(prof.fit_notes))) { size = up(tag); why = "Z2: fitted + broad shoulders, one size up"; }
  return { size, conf: 70, why: `${why} (too few similar buyers, Z4 70%)` };
}

function arrival(m, pin, today) {
  if (!pin || !today) return { ok: false, text: "arrival unknown" };
  const t = expectedTat({ origin_pin: m.ship_from_pin, destination_pin: pin });
  if (!t.body?.success) return { ok: false, text: `not deliverable to ${pin}` };
  const tat = t.body.data.tat;
  return { ok: true, date: addDays(today, m.dispatch_days + tat), tat, dispatch: m.dispatch_days };
}

function evaluate(p, prof, ctx) {
  const m = MERCHANTS[p.merchant];
  const z = predictSize(p, prof);
  const stockN = p.stock[z.size] || 0;
  const arr = arrival(m, ctx.pin, ctx.today);
  const buffer = arr.ok && ctx.needed_by ? daysBetween(arr.date, ctx.needed_by) : null;
  let fail = null;
  if (ctx.budget && p.price > ctx.budget) fail = `F2 ₹${p.price} over budget ₹${ctx.budget}`;
  else if (stockN <= 0) fail = `F1 no stock in ${z.size}`;
  else if (p.sleeve === "sleeveless" && /sleeveless/.test(ctx.deal)) fail = "F4 sleeveless (her dealbreaker)";
  else if (p.sheer && /sheer|see.?through/.test(ctx.past)) fail = "F5 sheer (her past return was see-through)";
  else if (!arr.ok) fail = `F3 ${arr.text}`;
  else if (buffer !== null && buffer < 3) fail = `F3 arrives ${arr.date}, buffer ${buffer} day(s) < 3`;
  return { p, m, z, stockN, arr, buffer, fail };
}

function score(e, prof, ctx) {
  const { p } = e;
  const fit = Math.round(35 * e.z.conf / 100);
  const t = prof.taps;
  let style = 0;
  if (t.colour && lc(p.colour_family) === t.colour) style += 10;
  if (t.work && lc(p.work) === t.work) style += 5;
  if (t.silhouette && lc(p.silhouette) === t.silhouette) style += 5;
  if (t.fabric === "cotton_linen" ? /^(cotton|linen)$/.test(lc(p.fabric)) : t.fabric === "satin_georgette" ? /satin|georgette/.test(lc(p.fabric)) : false) style += 5;
  const lists = ctx.occasion && p.occasions.includes(ctx.occasion);
  const outdoorDay = /outdoor|day/.test(ctx.setting);
  const suits = outdoorDay ? BREATHABLE.test(lc(p.fabric)) : true;
  const big = ctx.occasion === "wedding" || ctx.occasion === "reception";
  let occ = (lists ? 15 : 0) + (suits ? 5 : 0);
  if (big) { occ = (lists ? 25 : 0) + (suits ? 5 : 0); style = Math.round(style * 15 / 25); }
  const value = p.price < p.lowest_price_30d ? 10 : p.price === p.lowest_price_30d ? 7 : 2;
  const delivery = e.buffer === null ? 6 : e.buffer >= 5 ? 10 : e.buffer === 4 ? 8 : 6;
  return { fit, style, occ, value, delivery, total: fit + style + occ + value + delivery };
}

const valueWord = (p) => p.price < p.lowest_price_30d ? "below its 30-day low (real drop)" : p.price === p.lowest_price_30d ? "at its 30-day low" : "ABOVE its 30-day low (inflated discount, never call it a deal)";

export function rank(products, prof, ctx) {
  // P3: same dress from several sellers → keep the cheapest seller that passes.
  const groups = {};
  for (const p of products) (groups[p.group_id] ||= []).push(p);
  const evals = [];
  for (const g of Object.values(groups)) {
    const list = g.sort((a, b) => a.price - b.price).map((p) => evaluate(p, prof, ctx));
    const pass = list.find((e) => !e.fail);
    const chosen = pass || list[0];
    chosen.others = list.filter((e) => e !== chosen);
    evals.push(chosen);
  }
  for (const e of evals) if (!e.fail) e.s = score(e, prof, ctx);
  const passed = evals.filter((e) => !e.fail).sort((a, b) => b.s.total - a.s.total || a.p.price - b.p.price);
  const failed = evals.filter((e) => e.fail);

  const row = (e) => {
    const base = `${e.p.product_id} ${e.p.title} | ₹${e.p.price} (${valueWord(e.p)}) | size ${e.z.size}: fit ${e.z.conf}% [${e.z.why}], stock ${e.stockN} | ${e.arr.ok ? `arrives ${e.arr.date} (dispatch ${e.arr.dispatch} + Delhivery tat ${e.arr.tat})${e.buffer !== null ? `, buffer ${e.buffer} days` : ""}` : e.arr.text} | seller ${e.m.name}, ${e.m.exchange.replace("_", " ")}, return ${e.m.return_window_days} days`;
    const alt = e.others?.length ? ` | P3: same dress also from ${e.others.map((o) => `${o.p.product_id} ${o.m.name} ₹${o.p.price}${o.fail ? ` (${o.fail.split(" ")[0]})` : ""}`).join(", ")}` : "";
    if (e.fail) return `FAIL ${e.fail} | ${base}${alt}`;
    const s = e.s;
    return `PASS score ${s.total} = fit ${s.fit} + style ${s.style} + occasion ${s.occ} + value ${s.value} + delivery ${s.delivery} | ${base}${alt}`;
  };

  // P1 picks
  const main = passed[0] || null;
  const rest = passed.slice(1);
  const cheaper = main ? rest.filter((e) => e.p.price < main.p.price).sort((a, b) => a.p.price - b.p.price)[0] || null : null;
  const safest = main ? rest.filter((e) => e !== cheaper).sort((a, b) => b.z.conf - a.z.conf || b.s.total - a.s.total)[0] || null : null;
  const pick = (e, why) => e && { product_id: e.p.product_id, title: e.p.title, size: e.z.size, price: e.p.price, arrives: e.arr.date, fit_confidence: e.z.conf, score: e.s.total, why };

  // P2: what would open choices
  const counts = {};
  for (const e of failed) { const k = e.fail.split(" ")[0]; counts[k] = (counts[k] || 0) + 1; }
  return {
    profile_used: { size_tag: prof.size_tag, height_cm: prof.h, weight_kg: prof.w, budget: ctx.budget, needed_by: ctx.needed_by, delivery_pin: ctx.pin, occasion: ctx.occasion, setting: ctx.setting, taps: prof.taps, dealbreakers: ctx.deal, past_return: ctx.past },
    rows: [...passed.map(row), ...failed.map(row)],
    picks: {
      main: pick(main, main && `highest score ${main.s.total}`),
      cheaper: pick(cheaper, cheaper && `lowest price among the other PASS rows`),
      safest_fit: pick(safest, safest && `highest fit confidence among the other PASS rows (${safest.z.conf}%)`)
    },
    low_fit_warning: main && main.z.conf < 60 ? `Main pick fit confidence ${main.z.conf}% is below 60%: say so and prefer a doorstep-exchange seller` : null,
    if_nothing_passes: passed.length ? null : `No row passes. Fails by rule: ${JSON.stringify(counts)}. Ask her which constraint to relax (budget, date, style).`
  };
}
