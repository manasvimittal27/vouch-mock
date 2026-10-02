// GET /api/dc/expected_tat?origin_pin=400001&destination_pin=110017&mot=S&pdt=B2C
import { expectedTat, failureFor } from "../../lib/delhivery.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, msg: "Method not allowed" });
  const auth = req.headers["authorization"] || "";
  if (!/^Token\s+\S+/.test(auth)) {
    return res.status(401).json({ detail: "Authentication credentials were not provided." });
  }
  const { origin_pin, destination_pin, mot, pdt } = req.query;
  const fail = await failureFor(origin_pin, destination_pin);
  if (fail) return res.status(fail.status).send(fail.raw);
  const out = expectedTat({ origin_pin, destination_pin, mot, pdt });
  return res.status(out.status).json(out.body);
}
