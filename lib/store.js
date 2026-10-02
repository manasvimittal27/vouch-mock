// Tiny key-value store.
// Uses Upstash Redis over REST when its env vars are set (Vercel → Storage → Upstash Redis
// sets KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
// Falls back to process memory, which only survives while one warm instance serves every request.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const STORE_KIND = URL_ && TOKEN ? "upstash" : "memory";

const mem = globalThis.__vouchMem || (globalThis.__vouchMem = { kv: new Map(), lists: new Map() });

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(`store: ${j.error}`);
  return j.result;
}

export async function get(key) {
  if (STORE_KIND === "memory") return mem.kv.has(key) ? JSON.parse(mem.kv.get(key)) : null;
  const v = await redis(["GET", `vouch:${key}`]);
  return v == null ? null : JSON.parse(v);
}

export async function set(key, value) {
  const s = JSON.stringify(value);
  if (STORE_KIND === "memory") { mem.kv.set(key, s); return; }
  await redis(["SET", `vouch:${key}`, s, "EX", 60 * 60 * 24 * 30]);
}

export async function del(key) {
  if (STORE_KIND === "memory") { mem.kv.delete(key); return; }
  await redis(["DEL", `vouch:${key}`]);
}

// Append to a capped list (newest first).
export async function push(list, value, cap = 300) {
  const s = JSON.stringify(value);
  if (STORE_KIND === "memory") {
    const arr = mem.lists.get(list) || [];
    arr.unshift(s);
    mem.lists.set(list, arr.slice(0, cap));
    return;
  }
  await redis(["LPUSH", `vouch:${list}`, s]);
  await redis(["LTRIM", `vouch:${list}`, 0, cap - 1]);
}

export async function range(list, n = 100) {
  if (STORE_KIND === "memory") return (mem.lists.get(list) || []).slice(0, n).map((s) => JSON.parse(s));
  const arr = (await redis(["LRANGE", `vouch:${list}`, 0, n - 1])) || [];
  return arr.map((s) => JSON.parse(s));
}

// Monotonic counter for readable ids.
export async function next(name) {
  if (STORE_KIND === "memory") {
    const k = `ctr:${name}`;
    const v = (Number(mem.kv.get(k)) || 0) + 1;
    mem.kv.set(k, String(v));
    return v;
  }
  return Number(await redis(["INCR", `vouch:ctr:${name}`]));
}

export async function wipe() {
  if (STORE_KIND === "memory") { mem.kv.clear(); mem.lists.clear(); return; }
  const keys = (await redis(["KEYS", "vouch:*"])) || [];
  for (let i = 0; i < keys.length; i += 100) await redis(["DEL", ...keys.slice(i, i + 100)]);
}
