// MCP endpoint (Streamable HTTP, stateless, JSON responses) at /mcp.
// AgenticOrg discovers these tools automatically when the connector is registered with "MCP" ticked.
// Each tool mirrors one Delhivery endpoint with the same request and response fields.
import { pincodeServiceability, expectedTat, failureFor } from "../lib/delhivery.js";

const SERVER_INFO = { name: "vouch-delhivery-mock", version: "0.1.0" };
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "delhivery_pin_codes_json",
    title: "Delhivery: Pincode Serviceability",
    description:
      "Mirrors Delhivery GET /c/api/pin-codes/json/?filter_codes=<pin>. Checks whether Delhivery delivers to a pincode. " +
      "Returns {delivery_codes:[{postal_code:{pin, city, district, state_code, pre_paid, cod, pickup, repl, is_oda, remarks}}]}. " +
      "An EMPTY delivery_codes list means the pincode is NOT serviceable. is_oda 'Y' means out-of-delivery-area (slower, prepaid only).",
    inputSchema: {
      type: "object",
      properties: {
        filter_codes: { type: "string", description: "One pincode, or several separated by commas, e.g. '110017' or '110017,400001'" }
      },
      required: ["filter_codes"]
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "delhivery_expected_tat",
    title: "Delhivery: Expected TAT",
    description:
      "Mirrors Delhivery GET /api/dc/expected_tat?origin_pin=&destination_pin=&mot=&pdt=. Returns expected transit time in days " +
      "from the seller's ship-from pincode to the buyer's pincode: {success, msg, data:{tat, origin_pin, destination_pin, mot, pdt}}. " +
      "success=false means not serviceable or invalid input.",
    inputSchema: {
      type: "object",
      properties: {
        origin_pin: { type: "string", description: "Seller's ship-from pincode" },
        destination_pin: { type: "string", description: "Buyer's delivery pincode" },
        mot: { type: "string", enum: ["S", "E"], description: "Mode of transport: S = surface (default), E = express" },
        pdt: { type: "string", enum: ["B2C"], description: "Product type, B2C" }
      },
      required: ["origin_pin", "destination_pin"]
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
];

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (obj) => [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }];

async function callTool(name, args = {}) {
  if (name === "delhivery_pin_codes_json") {
    const fail = await failureFor(args.filter_codes);
    if (fail) return { content: text(fail.raw), isError: fail.status >= 500 };
    return { content: text(pincodeServiceability(args.filter_codes)), isError: false };
  }
  if (name === "delhivery_expected_tat") {
    const fail = await failureFor(args.origin_pin, args.destination_pin);
    if (fail) return { content: text(fail.raw), isError: fail.status >= 500 };
    const out = expectedTat(args);
    return { content: text(out.body), isError: out.status >= 400 };
  }
  return null;
}

async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const result = await callTool(params?.name, params?.arguments);
      if (!result) return err(id, -32602, `Unknown tool: ${params?.name}`);
      return ok(id, result);
    }
    default:
      return isNotification ? null : err(id, -32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const accept = String(req.headers["accept"] || "");
    if (accept.includes("text/event-stream")) return res.status(405).send("SSE stream not supported (stateless server)");
    return res.status(200).json({ status: "ok", server: SERVER_INFO, tools: TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json(err(null, -32700, "Parse error")); }
  }

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(handleMessage))).filter(Boolean);
    return replies.length ? res.status(200).json(replies) : res.status(202).end();
  }
  const reply = await handleMessage(body);
  return reply ? res.status(200).json(reply) : res.status(202).end();
}
