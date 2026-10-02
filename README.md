# Vouch: Delhivery mock server (v0.1)

Mock of Delhivery's B2C APIs for the Vouch agent (The Ken × Pine Labs, Round 3).
It exposes the same endpoints **two ways**:

| Way | Used by | Path |
|---|---|---|
| **MCP** (tools auto-discovered by AgenticOrg) | Vouch agent | `/mcp` |
| **REST** (Delhivery's exact paths and fields) | Judges / curl / docs | `/c/api/pin-codes/json/`, `/api/dc/expected_tat` |

AgenticOrg's custom connectors only get tools when **MCP** is ticked, so the agent talks to `/mcp`.
Each MCP tool mirrors one Delhivery endpoint with the same request and response fields.

## Tools / endpoints

| MCP tool | Mirrors | Inputs |
|---|---|---|
| `delhivery_pin_codes_json` | `GET /c/api/pin-codes/json/?filter_codes=` | `filter_codes` |
| `delhivery_expected_tat` | `GET /api/dc/expected_tat?origin_pin=&destination_pin=&mot=&pdt=` | `origin_pin`, `destination_pin`, `mot` (S/E), `pdt` (B2C) |

⚠️ Check the Expected TAT path and response fields against your Delhivery developer-portal docs and adjust `lib/delhivery.js` if they differ.

## Test pincodes (for eval cases)

| Pincode | Behaviour |
|---|---|
| 110017, 110001, 122002, 201301, 400001, 560034, 302001, 700001, 600001 | Serviceable |
| 194101 (Leh), 793001 (Shillong), 176215 | Serviceable but **ODA**: prepaid only, +2 days |
| 744301, 799999, 190025 | **Not serviceable** (empty `delivery_codes`) |
| 000001 | **Timeout** (12 s, longer than AgenticOrg's 10 s limit) |
| 000002 | **Malformed** reply (truncated JSON) |
| 000003 | **Server error** (HTTP 500 HTML page) |

Expected TAT: same city/metro 1 day, same or neighbouring zone 3, far 5, ODA +2, express −1.

## Deploy on Vercel (about 10 minutes)

**Option A: GitHub + Vercel website (no terminal)**
1. Create a free GitHub account if needed → **New repository** → name `vouch-mock` → Create.
2. On the empty repo page click **uploading an existing file** → drag in *everything inside* this folder (keep the `api` and `lib` folders) → **Commit**.
3. Go to vercel.com → sign in with GitHub → **Add New → Project** → import `vouch-mock` → **Deploy** (no settings needed).
4. Copy your URL, e.g. `https://vouch-mock-abc.vercel.app`.

**Option B: terminal**
```
cd vouch-mock
npx vercel --prod
```

## Check it works
Open in a browser:
- `https://YOUR-URL/` → `{"status":"ok", ...}`
- `https://YOUR-URL/mcp` → lists the two tools

Or with curl:
```
curl -s https://YOUR-URL/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s 'https://YOUR-URL/c/api/pin-codes/json/?filter_codes=110017' -H 'Authorization: Token test'
```

## Register in AgenticOrg
Connectors → **Register Connector**:
- Connector Name: `delhivery_mock_vouch`
- Tick **MCP**
- Base URL: `https://YOUR-URL/mcp`
- Category: Ecommerce (or Custom)
- Auth Type: **None**
- Register → open it → **Health Check**

Then on the Vouch agent → **Config** → add `delhivery_mock_vouch`, authorize its two tools, remove any unhealthy connector, save, run.
