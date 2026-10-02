// Local dev server that mimics Vercel's req/res helpers. `npm run dev` → http://localhost:8787
import http from "node:http";
import handler from "../api/index.js";

export function makeServer() {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const ct = String(req.headers["content-type"] || "");
    req.body = raw && ct.includes("json") ? JSON.parse(raw) : raw && ct.includes("urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : raw || undefined;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
    res.send = (b) => { if (typeof b === "string" && !res.getHeader("Content-Type")) res.setHeader("Content-Type", b.trim().startsWith("<") ? "text/html; charset=utf-8" : "text/plain"); res.end(b); return res; };
    res.redirect = (code, loc) => { res.statusCode = code; res.setHeader("Location", loc); res.end(); return res; };
    await handler(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  makeServer().listen(port, () => console.log(`vouch-mock on http://localhost:${port}`));
}
