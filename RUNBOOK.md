# Vouch on AgenticOrg: setup runbook (v0.3)

Facts below were verified on `agenticorg.hackathon.pinelabs.com` by us and by another team on the same tenant (Kirro, `github.com/Cheetos-gif/kirro/docs/agenticorg/platform-map.md`).

## Platform rules that shape the build

| Rule | Consequence for Vouch |
|---|---|
| The Authorized Tools picker never lists MCP tools, but `PATCH /api/v1/agents/{id}` accepts `mcp_<connector>__<tool>` | Authorize our tools through the API (step 4) |
| At most **one** untrusted custom connector per agent; linking a second fails with 503 | Everything is behind one connector, `mcp_vouch_all` |
| Native connectors (Twilio, Gmail…) are trusted and can sit alongside it | Twilio sends her WhatsApp messages |
| Connector names must start with a native registry name | `mcp_…`, `twilio_…` |
| Tools are discovered **at registration**; redeploying does not refresh them | A schema change means registering `mcp_vouch_all_v2`, relinking, re-authorizing |
| After linking, call `GET /api/v1/connectors/{id}/health` or the agent refuses to run | Step 5 |
| Any unhealthy linked connector blocks the agent | Link only healthy ones |
| Shadow agents hold every tool call for HITL; Active agents run them | Vouchken is already Active |
| Prompt is locked on Active agents; `pause` → `PATCH system_prompt_text` → `resume` works | Step 6 |
| Writes need `csrf_token` in the body equal to the `agenticorg_csrf` cookie | The console helper below |
| Workflows run zero steps; `agent_scheduler` tools can't be granted | Check-in and reminders are triggered by events, not timers |
| Tool arguments occasionally arrive empty (platform-side, intermittent) | Prompt rule E9; the server logs the arguments it receives on `/logs` |

## 0. Console helper (paste once per page load, on any AgenticOrg page, F12 → Console)

```js
window.__ao = async (method, path, body) => {
  const csrf = document.cookie.match(/agenticorg_csrf=([^;]+)/)[1];
  const r = await fetch('/api/v1' + path, { method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body ? JSON.stringify({ ...body, csrf_token: csrf }) : undefined });
  const t = await r.text(); console.log(r.status, t.slice(0, 2000)); return r.status + ' ' + t.slice(0, 4000);
};
```

## 1. Deploy the server
Upload this repo to GitHub (`manasvimittal27/vouch-mock`); Vercel redeploys. In Vercel → Settings → Environment Variables add `GNANI_API_KEY`, `ADMIN_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`; in Storage add Upstash Redis. Redeploy. Check `https://vouch-mock-drab.vercel.app/` shows `"tools": 14` and `"store": "upstash"`.

## 2. Register the connector
Connectors → Register Connector: name `mcp_vouch_all`, tick **MCP**, URL `https://vouch-mock-drab.vercel.app/mcp`, category Ecommerce, auth None → Register. Open it: Registered Tools should show **14**. Copy its id.

## 3. Twilio WhatsApp (real)
1. twilio.com free trial → Messaging → Try it out → **WhatsApp sandbox**. From Riya's phone (and Didi's) send the join code to +1 415 523 8886.
2. Sandbox settings → "When a message comes in" = `https://vouch-mock-drab.vercel.app/twilio/inbound`, method POST → Save.
3. Register the native connector `twilio_vouch` (name must start with `twilio`), then set credentials with the helper (the Edit form can't):
   `await __ao('PUT', '/connectors/<twilio_id>', { auth_config: { account_sid: 'AC…', access_token: '<auth token>' } })`
   then `await __ao('GET', '/connectors/<twilio_id>/health')` → healthy.

## 4. Link and authorize on Vouchken (`90bed2cb-2792-4b40-bfc0-7882dc869c00`)
```js
const A = '/agents/90bed2cb-2792-4b40-bfc0-7882dc869c00';
await __ao('PATCH', A, { connector_ids: ['<mcp_vouch_all_id>', '<twilio_id>'] });
const T = ['delhivery_pin_codes_json','delhivery_expected_tat','delhivery_create_shipment','delhivery_track','delhivery_doorstep_exchange',
  'pinelabs_catalog_search','pinelabs_catalog_get_item','pinelabs_create_order','pinelabs_get_order_status','pinelabs_place_seller_order','pinelabs_initiate_refund',
  'gnani_speech_to_text','gnani_text_to_speech','twilio_whatsapp_inbox'].map(t => 'mcp_vouch_all__' + t);
await __ao('PATCH', A, { authorized_tools: [...T, 'twilio_vouch__send_whatsapp'] });
await __ao('GET', A);   // check authorized_tools now lists 15
```
If the second PATCH returns 422 for the Twilio tool, try `twilio__send_whatsapp`, or drop it and keep the 14.

## 5. Health check (required after every relink)
`await __ao('GET', '/connectors/<mcp_vouch_all_id>/health')` and the same for `twilio_vouch`.

## 6. Update the prompt on an Active agent
```js
await __ao('POST', A + '/pause');
await __ao('PATCH', A, { system_prompt_text: `<paste prompt v0.3>` });
await __ao('POST', A + '/resume');
```
The platform does not version prompts: keep every version in `prompts/`.

## 7. Smoke test
Open `https://vouch-mock-drab.vercel.app/logs` in a second window. On Vouchken → Chat with Agent send:
`PROFILE: … pincode 110017 … MESSAGE: "Cousin ki engagement hai 14 ko, outdoor, 2500 tak."`
Pass = `/logs` shows `delhivery_pin_codes_json`, `pinelabs_catalog_search` and several `delhivery_expected_tat` calls with real arguments.

## 8. Before each recording
`/admin?key=…` → Reset all demo state, all switches `normal`, clock `+0`.
