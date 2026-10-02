// REAL outbound WhatsApp through Twilio's Messages API (not a mock).
// Why it lives here: on the hackathon platform the native Twilio connector's send_whatsapp
// reaches Twilio without the message text (Twilio replies HTTP 400 "ContentSid Required"),
// so the agent sends through this tool instead. Same account, same sandbox sender.
// Admin switch scn:whatsapp = "dry" skips the real send (saves sandbox quota during eval rounds).
import { get, push } from "./store.js";

const FROM = () => (process.env.TWILIO_WHATSAPP_FROM || "+17372508034").replace(/^whatsapp:/, "");
const e164 = (n) => {
  let d = String(n || "").replace(/^whatsapp:/, "").replace(/[^0-9+]/g, "");
  if (!d.startsWith("+")) d = d.length === 10 ? "+91" + d : "+" + d;
  return d;
};

export async function sendWhatsApp(a) {
  const to = e164(a.to);
  const body = String(a.body || a.message || a.text || "").trim();
  const media = a.media_url || a.audio_url;
  if (to.length < 11) return { status: 400, body: { error: "missing_to", message: "Pass to = her number in E.164, e.g. +919812345678" } };
  if (!body && !media) return { status: 400, body: { error: "missing_body", message: "Pass body = the exact message text" } };

  const mode = ((await get("scn:whatsapp")) || { mode: "live" }).mode;
  const record = { to, from: FROM(), body, media_url: media || null };
  if (mode === "dry") {
    await push("outbox", { ...record, sid: "DRY-RUN", status: "dry_run (not sent: admin switch)", at: new Date().toISOString() });
    return { status: 200, body: { sid: "DRY-RUN", status: "dry_run", to, body, note: "Dry run: admin switch is on, nothing was sent to WhatsApp." } };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return { status: 503, body: { error: "twilio_not_configured" } };
  const form = new URLSearchParams({ To: `whatsapp:${to}`, From: `whatsapp:${FROM()}` });
  if (body) form.set("Body", body.slice(0, 1500));
  if (media) form.set("MediaUrl", media);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    await push("outbox", { ...record, sid: null, status: `error ${r.status}: ${j.message || ""}`, at: new Date().toISOString() });
    return { status: r.status, body: { error: "twilio_error", http_status: r.status, code: j.code, message: j.message } };
  }
  await push("outbox", { ...record, sid: j.sid, status: j.status, at: new Date().toISOString() });
  return { status: 200, body: { sid: j.sid, status: j.status, to, from: FROM(), body, date_created: j.date_created } };
}
