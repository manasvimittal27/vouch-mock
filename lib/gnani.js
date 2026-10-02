// Gnani Vachana adapter: REAL calls to api.vachana.ai (not a mock).
// AgenticOrg can only call tools on MCP connectors, so this file exposes Gnani's own REST
// endpoints as MCP tools. Request shapes follow the official `gnani-vachana` 0.7.9 SDK:
//   STT  POST /stt/v3                multipart: audio_file, language_code, format
//   TTS  POST /api/v1/tts/inference  json: text, model, voice, language, speed, audio_config
// Auth header X-API-Key-ID (env GNANI_API_KEY). Cloudflare needs a normal User-Agent.
import { set, get, next } from "./store.js";

const BASE = "https://api.vachana.ai";
const KEY = () => process.env.GNANI_API_KEY || "";
const UA = "vouch-agent/0.3 (+https://vouch-mock-drab.vercel.app)";
const headers = () => ({ "X-API-Key-ID": KEY(), "X-API-Request-ID": `vouch-${Date.now()}`, "User-Agent": UA });

const STT_LANGS = new Set(["en-IN", "hi-IN", "gu-IN", "ta-IN", "kn-IN", "te-IN", "mr-IN", "bn-IN", "ml-IN", "pa-IN"]);

function directUrl(u) {
  const s = String(u || "").trim();
  const m = /drive\.google\.com\/file\/d\/([^/]+)/.exec(s) || /drive\.google\.com\/open\?id=([^&]+)/.exec(s);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : s;
}

export async function speechToText(a = {}) {
  if (!KEY()) return { status: 503, body: { success: false, error: "gnani_not_configured", message: "GNANI_API_KEY is not set on the server" } };
  const src = directUrl(a.audio_url);
  if (!/^https?:\/\//.test(src)) return { status: 400, body: { success: false, error: "audio_url must be a public http(s) link to the voice note" } };
  const lang = STT_LANGS.has(a.language_code) ? a.language_code : "hi-IN";
  const h = { "User-Agent": UA };
  // Twilio media URLs (WhatsApp voice notes) may need the Twilio account's Basic auth.
  if (/twilio\.com/.test(src) && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    h.Authorization = "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  }
  const audio = await fetch(src, { headers: h, redirect: "follow" });
  if (!audio.ok) return { status: 502, body: { success: false, error: `Could not download audio (${audio.status})` } };
  const buf = Buffer.from(await audio.arrayBuffer());
  const type = audio.headers.get("content-type") || "audio/ogg";
  const ext = type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : type.includes("mp4") || type.includes("m4a") ? "m4a" : "ogg";
  const fd = new FormData();
  fd.append("audio_file", new Blob([buf], { type }), `voice_note.${ext}`);
  fd.append("language_code", lang);
  fd.append("format", lang === "hi-IN" || lang === "en-IN" ? "transcribe" : "verbatim");
  const r = await fetch(`${BASE}/stt/v3`, { method: "POST", headers: headers(), body: fd });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { success: false, raw: text.slice(0, 300) }; }
  return { status: r.status, body: { provider: "gnani_vachana", language_code: lang, audio_bytes: buf.length, ...body } };
}

export async function synthesize(text, language = "hi-IN", voice = "Poorvi") {
  const r = await fetch(`${BASE}/api/v1/tts/inference`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: String(text).slice(0, 600), model: "timbre-v2.5", voice, language, speed: 1.0,
      audio_config: { sample_rate: 24000, encoding: "linear_pcm", num_channels: 1, sample_width: 2, container: "mp3", bitrate: "64k" }
    })
  });
  if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 300) };
  return { ok: true, bytes: Buffer.from(await r.arrayBuffer()) };
}

export async function textToSpeech(a = {}, ctx = {}) {
  if (!KEY()) return { status: 503, body: { success: false, error: "gnani_not_configured", message: "GNANI_API_KEY is not set on the server" } };
  const text = String(a.text || "").trim();
  if (!text) return { status: 400, body: { success: false, error: "text is required" } };
  const language = a.language === "en-IN" ? "en-IN" : "hi-IN";
  const voice = language === "en-IN" ? "Kaveri" : "Poorvi"; // Poorvi = Gnani's Hinglish voice
  const out = await synthesize(text, language, voice);
  if (!out.ok) return { status: out.status, body: { success: false, provider: "gnani_vachana", error: out.error } };
  const id = `a${await next("audio")}${Date.now().toString(36)}`;
  let url = `${ctx.base || ""}/gnani/tts.mp3?lang=${language}&text=${encodeURIComponent(text.slice(0, 600))}`;
  if (out.bytes.length < 700000) {
    try { await set(`audio:${id}`, out.bytes.toString("base64")); url = `${ctx.base || ""}/audio/${id}.mp3`; } catch { /* fall back to live URL */ }
  }
  return { status: 200, body: { success: true, provider: "gnani_vachana", model: "timbre-v2.5", voice, language, audio_url: url, audio_bytes: out.bytes.length } };
}

export async function storedAudio(id) {
  const b64 = await get(`audio:${id}`);
  return b64 ? Buffer.from(b64, "base64") : null;
}
