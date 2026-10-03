// Pine Labs Online (Plural) mock + two extra capabilities.
// Endpoint names and fields mirror AgenticOrg's own native pinelabs_plural connector:
//   POST /api/checkout/v1/orders            (create order, hosted checkout -> redirect_url)
//   GET  /api/pay/v1/orders/{order_id}      (order status, wrapped in "data")
//   POST /api/pay/v1/orders/{order_id}/refunds
// Amounts are in PAISE (₹1,899 = 189900), as in Plural.
import { get, set, next } from "./store.js";
import { nowIST, istStamp, ymd, addDays } from "./clock.js";
import { byId, MERCHANTS, publicView, SIZES } from "./catalog.js";

const money = (v) => ({ value: Number(v), currency: "INR" });

function toPaise(raw) {
  if (raw && typeof raw === "object") raw = raw.value ?? raw.amount;
  const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function createOrder(a = {}, ctx = {}) {
  const ref = String(a.merchant_order_reference || "").trim();
  const amount = toPaise(a.amount ?? a.order_amount);
  if (!ref || !amount) return { status: 400, body: { code: "INVALID_REQUEST", message: "merchant_order_reference and amount (in paise) are required" } };
  const now = await nowIST();
  const id = `v1-${ymd(now).replace(/-/g, "")}-aa-${String(100000 + (await next("order"))).slice(1)}`;
  const order = {
    order_id: id, merchant_order_reference: ref, type: "CHARGE", status: "CREATED",
    order_amount: money(amount), customer: { name: a.customer_name || "", mobile_number: a.customer_phone || "" },
    payments: [], created_at: istStamp(now), updated_at: istStamp(now)
  };
  await set(`pl:order:${id}`, order);
  return {
    status: 200,
    body: { order_id: id, redirect_url: `${ctx.base || ""}/pay/${id}`, status: "CREATED", merchant_order_reference: ref, order_amount: order.order_amount, integration_mode: "REDIRECT" }
  };
}

export async function getOrder(a = {}) {
  const id = String(a.order_id || "").trim();
  const o = id ? await get(`pl:order:${id}`) : null;
  if (!o) return { status: 404, body: { code: "ORDER_NOT_FOUND", message: `No order with id ${id || "(missing)"}` } };
  const scn = (await get("scn:payment")) || { mode: "normal" };
  if (scn.mode === "timeout") {
    // Gateway hangs: the status call itself times out (longer than the 10 s connector limit).
    await new Promise((r) => setTimeout(r, 12000));
    return { status: 504, raw: "upstream request timeout" };
  }
  return { status: 200, body: { data: o } };
}

// Called by the hosted checkout page when she taps Pay / when a failure is simulated.
export async function completePayment(id, outcome) {
  const o = await get(`pl:order:${id}`);
  if (!o) return null;
  const now = await nowIST();
  const pid = `v1-pay-${String(100000 + (await next("payment"))).slice(1)}`;
  if (outcome === "success") {
    o.status = "PROCESSED";
    o.payments.push({ id: pid, status: "PROCESSED", payment_method: "UPI", payment_amount: o.order_amount, acquirer_data: { rrn: String(Date.now()).slice(-12) }, created_at: istStamp(now) });
  } else {
    o.status = "FAILED";
    o.payments.push({ id: pid, status: "FAILED", payment_method: "UPI", payment_amount: o.order_amount, error_detail: { code: "PAYMENT_TIMEOUT", message: "UPI collect request expired before approval" }, created_at: istStamp(now) });
  }
  o.updated_at = istStamp(now);
  await set(`pl:order:${id}`, o);
  await set(`pl:payment:${pid}`, id); // payment id → order id, so either id finds the order
  return o;
}

export async function refund(a = {}) {
  const id = String(a.order_id || "").trim();
  const o = id ? await get(`pl:order:${id}`) : null;
  if (!o) return { status: 404, body: { code: "ORDER_NOT_FOUND", message: `No order with id ${id || "(missing)"}` } };
  if (o.status !== "PROCESSED" && o.status !== "PARTIALLY_REFUNDED") return { status: 422, body: { code: "INVALID_STATE", message: `Order is ${o.status}; only PROCESSED orders can be refunded` } };
  const amount = toPaise(a.amount) || o.order_amount.value;
  if (amount > o.order_amount.value) return { status: 422, body: { code: "AMOUNT_EXCEEDS", message: "Refund amount exceeds captured amount" } };
  const now = await nowIST();
  const rid = `v1-ref-${String(100000 + (await next("refund"))).slice(1)}`;
  o.status = amount === o.order_amount.value ? "FULLY_REFUNDED" : "PARTIALLY_REFUNDED";
  o.refunds = [...(o.refunds || []), { refund_id: rid, refund_amount: money(amount), status: "PENDING", created_at: istStamp(now) }];
  await set(`pl:order:${id}`, o);
  return { status: 200, body: { refund_id: rid, order_id: id, status: "PENDING", refund_amount: money(amount), expected_by: ymd(addDays(now, 5)) } };
}

// ---------- live stock (catalogue stock minus what this demo has sold) ----------
export async function stockFor(pid, size) {
  const p = byId(pid);
  if (!p) return 0;
  const sold = Number((await get(`sold:${p.product_id}:${size}`)) || 0);
  return Math.max(0, (p.stock[size] || 0) - sold);
}

// EXTRA CAPABILITY #1b: live price + stock for one item right before checkout.
export async function getItem(a = {}, ctx = {}) {
  const p = byId(a.product_id);
  if (!p) return { status: 404, body: { error: `Unknown product_id ${a.product_id || "(missing)"}` } };
  const size = String(a.size || "").toUpperCase();
  const view = publicView(p, { h: Number(a.buyer_height_cm) || null, w: Number(a.buyer_weight_kg) || null });
  const scn = (await get("scn:catalog_item")) || { mode: "normal" };
  const hit = scn.product_id ? scn.product_id === p.product_id : true;
  const live = {};
  for (const s of SIZES) live[s] = await stockFor(p.product_id, s);
  let price = p.price;
  if (hit && scn.mode === "price_jump") price = p.price + 300;
  if (hit && scn.mode === "out_of_stock" && size) live[size] = 0;
  view.price.selling_price = price;
  view.stock_by_size = live;
  return { status: 200, body: { ...view, checked_at: istStamp(await nowIST()), requested_size: size || null, requested_size_in_stock: size ? live[size] > 0 : null } };
}

// EXTRA CAPABILITY #2 (Pine Labs): place the order with the seller once the payment is captured.
export async function placeSellerOrder(a = {}) {
  let oid = String(a.payment_order_id || a.order_id || "").trim();
  if (oid.startsWith("v1-pay-")) oid = (await get(`pl:payment:${oid}`)) || oid; // accept the payment id too
  const o = oid ? await get(`pl:order:${oid}`) : null;
  if (!o) return { status: 404, body: { success: false, code: "PAYMENT_ORDER_NOT_FOUND", message: `No Pine Labs order ${oid || "(missing)"}` } };
  if (o.status !== "PROCESSED") return { status: 409, body: { success: false, code: "PAYMENT_NOT_CAPTURED", message: `Payment status is ${o.status}; seller order needs a PROCESSED payment` } };
  const existing = await get(`seller_order_by_payment:${oid}`);
  if (existing) return { status: 200, body: { ...(await get(`seller_order:${existing}`)), idempotent_replay: true } };
  const p = byId(a.product_id);
  const size = String(a.size || "").toUpperCase();
  if (!p || !size) return { status: 400, body: { success: false, code: "INVALID_REQUEST", message: "product_id and size are required" } };
  if (Math.round(p.price * 100) !== o.order_amount.value) {
    return { status: 409, body: { success: false, code: "AMOUNT_MISMATCH", message: `Paid ${o.order_amount.value} paise but item costs ${p.price * 100} paise` } };
  }
  if ((await stockFor(p.product_id, size)) <= 0) {
    return { status: 409, body: { success: false, code: "SELLER_OUT_OF_STOCK", message: `Seller has no ${size} left; payment will need a refund` } };
  }
  const m = MERCHANTS[p.merchant];
  const now = await nowIST();
  const soid = `SO-${m.merchant_id.slice(-5)}-${String(1000 + (await next("seller_order")))}`;
  await set(`sold:${p.product_id}:${size}`, Number((await get(`sold:${p.product_id}:${size}`)) || 0) + 1);
  const rec = {
    success: true, seller_order_id: soid, payment_order_id: oid, merchant_id: m.merchant_id, seller: m.name,
    product_id: p.product_id, title: p.title, size, amount: p.price, ship_from_pin: m.ship_from_pin,
    dispatch_days: m.dispatch_days, dispatch_by: ymd(addDays(now, m.dispatch_days)), return_window_days: m.return_window_days,
    exchange_policy: m.exchange, customer_name: a.customer_name || o.customer?.name || "", phone: a.customer_phone || o.customer?.mobile_number || "",
    address: a.address || "", pin: String(a.pin || ""), merchant_key: p.merchant, status: "CONFIRMED", created_at: istStamp(now),
    next_step: "Create the Delhivery shipment with order = seller_order_id"
  };
  await set(`seller_order:${soid}`, rec);
  await set(`seller_order_by_payment:${oid}`, soid);
  return { status: 200, body: rec };
}
