# Vouch connector server (v0.3)

The connector server for **Vouch**, an L2 personal shopper for women's occasion wear (The Ken × Pine Labs Case-Build Competition, Round 3).

AgenticOrg lets an agent use **one** custom MCP connector, so every rail sits behind a single MCP endpoint, `/mcp`.

| Rail | Real or mock | Tools |
|---|---|---|
| **Delhivery** | Mock. Endpoint names and fields mirror Delhivery's B2C API | `delhivery_pin_codes_json` (GET /c/api/pin-codes/json/), `delhivery_expected_tat` (GET /api/dc/expected_tat), `delhivery_create_shipment` (POST /api/cmu/create.json), `delhivery_track` (GET /api/v1/packages/json/) |
| **Pine Labs** | Mock. Mirrors the Plural endpoints used by AgenticOrg's own `pinelabs_plural` connector; amounts in paise | `pinelabs_create_order` (POST /api/checkout/v1/orders), `pinelabs_get_order_status` (GET /api/pay/v1/orders/{id}), `pinelabs_initiate_refund` (POST /api/pay/v1/orders/{id}/refunds) |
| **Gnani** | **Real**: forwards to `api.vachana.ai` with our key | `gnani_speech_to_text` (POST /stt/v3), `gnani_text_to_speech` (POST /api/v1/tts/inference, timbre-v2.5) |
| **WhatsApp inbound** | **Real** messages: Twilio's WhatsApp webhook posts to `/twilio/inbound` (AgenticOrg's native Twilio connector can only send) | `twilio_whatsapp_inbox` |
| Extra capability 1 (Pine Labs) | Mock | `pinelabs_catalog_search`, `pinelabs_catalog_get_item`: multi-merchant catalogue with size-level stock, 30-day low price and fit feedback from similar-build buyers |
| Extra capability 2 (Pine Labs) | Mock | `pinelabs_place_seller_order`: place the order with the seller once the payment is PROCESSED |
| Extra capability 3 (Delhivery) | Mock | `delhivery_doorstep_exchange`: same-visit size swap, booked only if it lands before the occasion |

All catalogue listings, sellers and reviews are **sample data** made up for the demo.

## Failure modes (the mock behaves like a real API, including when it breaks)

| Trigger | Behaviour |
|---|---|
| Pincode `000001` | Hangs 12 s (longer than AgenticOrg's 10 s connector timeout) |
| Pincode `000002` | Truncated, malformed JSON |
| Pincode `000003` | HTTP 500 HTML page |
| Pincode `744301`, `799999`, `190025` | Not serviceable (empty `delivery_codes`) |
| Pincode `194101`, `793001`, `176215` | ODA: prepaid only, +2 days, no replacement |
| `/admin` → checkout item: `price_jump` / `out_of_stock` | Live price +₹300 / her size sold out at checkout |
| `/admin` → payment: `timeout` | Order-status call hangs 12 s |
| Payment page "Simulate UPI timeout" | Order goes `FAILED` with `PAYMENT_TIMEOUT` |
| `/admin` → delivery: `delayed` / `delivered` | Expected delivery date slips by 3 days / marked delivered now |
| `/admin` → exchange: `no_stock` / `slow` | Exchange size unavailable / exchange can't land in time |
| `/admin` → demo clock +N days | Fast-forwards "today" for the day-2 check-in and return-window steps |

Scenarios are switched out of band. No response ever says which scenario is armed.

## Pages

- `/logs`: every tool call as it lands, with the exact arguments received. Auto-refreshes; keep it open while recording.
- `/admin?key=ADMIN_KEY`: scenario switches, demo clock, reset.
- `/twilio/inbound`: set this as the Twilio WhatsApp sandbox's "When a message comes in" URL (POST).
- `/pay/{order_id}`: the hosted checkout she opens from WhatsApp. Labelled as a mock; no real money moves.

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Needed for |
|---|---|
| `GNANI_API_KEY` | The real Gnani STT/TTS calls |
| `ADMIN_KEY` | Protects `/admin` (default `vouch-admin`; change it) |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Downloading her WhatsApp voice notes from Twilio for Gnani |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Durable state. Add via Vercel → Storage → Upstash Redis (free). Without it, state lives in memory and can be lost between calls |

## Run and test locally

```
npm run dev      # http://localhost:8787
npm test         # 28 end-to-end checks; SLOW=1 npm test adds the 12 s timeout case
```

## Register on AgenticOrg

Connectors → Register Connector: name `mcp_vouch_all`, tick **MCP**, URL `https://<your-deployment>/mcp`, category Ecommerce, auth None. Then link it to the agent and authorize its tools through the API (the UI tool picker does not list MCP tools). See `RUNBOOK.md`.
