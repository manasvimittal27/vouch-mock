// REAL WhatsApp, send + receive. Not a mock.
// Provider: Meta WhatsApp Cloud API (graph.facebook.com) when META_WA_TOKEN + META_WA_PHONE_ID are set,
// otherwise Twilio's Messages API. (Our Twilio trial account only allows pre-approved templates —
// Twilio error 21654 "ContentSid Required" — so free-form replies go through Meta's Cloud API.)
// Admin switch scn:whatsapp = "dry" skips the real send (saves quota during eval rounds).
import { get, push } from "./store.js";
import { istStamp, nowIST } from "./clock.js";

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
export const PROVIDER = () => (process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET ? "vonage" : process.env.META_WA_TOKEN && process.env.META_WA_PHONE_ID ? "meta" : "twilio");
const VONAGE_URL = () => process.env.VONAGE_MESSAGES_URL || "https://messages-sandbox.nexmo.com/v1/messages";
const VONAGE_FROM = () => String(process.env.VONAGE_WA_FROM || "14157386102").replace(/[^0-9]/g, "");
const vonageAuth = () => "Basic " + Buffer.from(`${process.env.VONAGE_API_KEY}:${process.env.VONAGE_API_SECRET}`).toString("base64");

async function vonagePost(payload) {
  const r = await fetch(VONAGE_URL(), {
    method: "POST",
    headers: { Authorization: vonageAuth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ channel: "whatsapp", from: VONAGE_FROM(), ...payload }),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

async function sendVonage(to, body, media) {
  const num = to.replace(/^\+/, "");
  const ids = [];
  if (body) {
    const t = await vonagePost({ to: num, message_type: "text", text: body.slice(0, 4000) });
    if (!t.ok) return { status: t.status, body: { error: "whatsapp_error", provider: "vonage", http_status: t.status, code: t.j.type || t.j.title, message: t.j.detail || t.j.title || JSON.stringify(t.j).slice(0, 200) } };
    ids.push(t.j.message_uuid);
  }
  if (media) {
    const a = await vonagePost({ to: num, message_type: "audio", audio: { url: media } });
    if (!a.ok) return { status: a.status, body: { error: "whatsapp_error", provider: "vonage", part: "audio", message: a.j.detail || a.j.title, text_sid: ids[0] } };
    ids.push(a.j.message_uuid);
  }
  return { status: 200, body: { sid: ids.join(","), status: "accepted", provider: "Vonage Messages API (WhatsApp)", to } };
}
const TW_FROM = () => (process.env.TWILIO_WHATSAPP_FROM || "+17372508034").replace(/^whatsapp:/, "");
const e164 = (n) => {
  let d = String(n || "").replace(/^whatsapp:/, "").replace(/[^0-9+]/g, "");
  if (!d.startsWith("+")) d = d.length === 10 ? "+91" + d : "+" + d;
  return d;
};

async function metaPost(payload) {
  const r = await fetch(`${GRAPH()}/${process.env.META_WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.META_WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

async function sendMeta(to, body, media) {
  const num = to.replace(/^\+/, "");
  const ids = [];
  if (body) {
    const t = await metaPost({ to: num, type: "text", text: { preview_url: true, body: body.slice(0, 4000) } });
    if (!t.ok) return { status: t.status, body: { error: "whatsapp_error", provider: "meta", http_status: t.status, code: t.j.error?.code, message: t.j.error?.message, hint: t.j.error?.code === 131047 ? "Outside the 24-hour window: she must message first." : undefined } };
    ids.push(t.j.messages?.[0]?.id);
  }
  if (media) {
    const a = await metaPost({ to: num, type: "audio", audio: { link: media } });
    if (!a.ok) return { status: a.status, body: { error: "whatsapp_error", provider: "meta", part: "audio", code: a.j.error?.code, message: a.j.error?.message, text_sid: ids[0] } };
    ids.push(a.j.messages?.[0]?.id);
  }
  return { status: 200, body: { sid: ids.join(","), status: "accepted", provider: "Meta WhatsApp Cloud API", to } };
}

async function sendTwilio(to, body, media) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return { status: 503, body: { error: "whatsapp_not_configured" } };
  const form = new URLSearchParams({ To: `whatsapp:${to}`, From: `whatsapp:${TW_FROM()}` });
  if (body) form.set("Body", body.slice(0, 1500));
  if (media) form.set("MediaUrl", media);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(), signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, body: { error: "whatsapp_error", provider: "twilio", http_status: r.status, code: j.code, message: j.message } };
  return { status: 200, body: { sid: j.sid, status: j.status, provider: "Twilio", to } };
}

export async function sendWhatsApp(a) {
  const to = e164(a.to);
  const body = String(a.body || a.message || a.text || "").trim();
  const media = a.media_url || a.audio_url || null;
  if (to.length < 11) return { status: 400, body: { error: "missing_to", message: "Pass to = her number in E.164, e.g. +919812345678" } };
  if (!body && !media) return { status: 400, body: { error: "missing_body", message: "Pass body = the exact message text" } };
  const mode = ((await get("scn:whatsapp")) || { mode: "live" }).mode;
  const at = new Date().toISOString();
  if (mode === "dry") {
    await push("outbox", { to, body, media_url: media, sid: "DRY-RUN", status: "dry_run (not sent: admin switch)", provider: PROVIDER(), at });
    return { status: 200, body: { sid: "DRY-RUN", status: "dry_run", to, body, note: "Dry run: admin switch is on, nothing was sent to WhatsApp." } };
  }
  const p = PROVIDER();
  const out = p === "vonage" ? await sendVonage(to, body, media) : p === "meta" ? await sendMeta(to, body, media) : await sendTwilio(to, body, media);
  await push("outbox", { to, body, media_url: media, sid: out.body.sid || null, status: out.status === 200 ? out.body.status : `error ${out.status}: ${out.body.message || ""}`, provider: PROVIDER(), at });
  if (out.status === 200) out.body.body = body;
  return out;
}

// ---- Meta inbound webhook ----
export function metaVerify(q) {
  const ok = q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === (process.env.META_VERIFY_TOKEN || "vouch-verify");
  return ok ? { status: 200, text: q.get("hub.challenge") || "" } : { status: 403, text: "verify token mismatch" };
}

export async function metaInbound(body, base) {
  const stored = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const m of v.messages || []) {
        const media = [];
        for (const kind of ["audio", "voice", "image", "document", "video"]) {
          if (m[kind]?.id) media.push({ media_url: `${base}/meta/media/${m[kind].id}`, content_type: m[kind].mime_type || kind });
        }
        const msg = {
          message_sid: m.id, from: "+" + m.from, to: v.metadata?.display_phone_number || "", profile_name: names[m.from] || "",
          body: m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "",
          media, received_at: istStamp(await nowIST()), provider: "meta"
        };
        await push("inbox", msg, 200);
        await push("calls", { ts: msg.received_at, real_ts: new Date().toISOString(), via: "meta-webhook", tool: "INBOUND WhatsApp", rail: "WhatsApp (Meta Cloud API)", args: { from: msg.from }, status: 200, ms: 0, result: JSON.stringify({ body: msg.body, media: media.length }) });
        stored.push(msg.message_sid);
      }
    }
  }
  return stored;
}

// Voice notes: Meta media needs the bearer token; this proxy makes it a plain link Gnani can fetch.
export async function metaMedia(id) {
  const h = { Authorization: `Bearer ${process.env.META_WA_TOKEN}` };
  const meta = await fetch(`${GRAPH()}/${id}`, { headers: h, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  if (!meta.url) return null;
  const r = await fetch(meta.url, { headers: h, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  return { type: meta.mime_type || r.headers.get("content-type") || "application/octet-stream", bytes: Buffer.from(await r.arrayBuffer()) };
}

// ---- Vonage inbound webhook (Messages API, JSON) ----
export async function vonageInbound(m, base) {
  if (!m || m.channel !== "whatsapp" || !m.from) return null;
  const media = [];
  for (const kind of ["audio", "image", "video", "file"]) {
    if (m[kind]?.url) media.push({ media_url: `${base}/vonage/media?u=${encodeURIComponent(m[kind].url)}`, content_type: kind === "audio" ? "audio/ogg" : kind });
  }
  const msg = {
    message_sid: m.message_uuid || "", from: "+" + String(m.from).replace(/^\+/, ""), to: m.to || "", profile_name: m.profile?.name || "",
    body: m.text || m.reply?.title || "", media, received_at: istStamp(await nowIST()), provider: "vonage"
  };
  await push("inbox", msg, 200);
  await push("calls", { ts: msg.received_at, real_ts: new Date().toISOString(), via: "vonage-webhook", tool: "INBOUND WhatsApp", rail: "WhatsApp (Vonage)", args: { from: msg.from }, status: 200, ms: 0, result: JSON.stringify({ body: msg.body, media: media.length }) });
  return msg;
}

// Voice notes: Vonage media links may need the account's credentials; this proxy makes them a plain link Gnani can fetch.
export async function vonageMedia(url) {
  if (!/^https:\/\/[a-z0-9.-]*(vonage|nexmo)\.com\//i.test(url)) return null;
  let r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) r = await fetch(url, { headers: { Authorization: vonageAuth() }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  return { type: r.headers.get("content-type") || "audio/ogg", bytes: Buffer.from(await r.arrayBuffer()) };
}
