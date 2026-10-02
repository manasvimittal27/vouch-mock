// GET /c/api/pin-codes/json/?filter_codes=110017   (rewritten here by vercel.json)
import { pincodeServiceability, failureFor } from "../lib/delhivery.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ detail: "Method not allowed" });
  const auth = req.headers["authorization"] || "";
  if (!/^Token\s+\S+/.test(auth)) {
    return res.status(401).json({ detail: "Authentication credentials were not provided." });
  }
  const filter = req.query.filter_codes;
  const fail = await failureFor(filter);
  if (fail) return res.status(fail.status).send(fail.raw);
  return res.status(200).json(pincodeServiceability(filter));
}
