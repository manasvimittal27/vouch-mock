// Vouch event bridge — paste into the browser console of a logged-in AgenticOrg tab, then click "Connect WhatsApp".
// Why it exists: AgenticOrg workflows/triggers do not fire on this tenant, members cannot mint API keys, and the
// AgenticOrg page's CSP blocks fetches to other origins. So a small relay window from vouch-mock (/bridge) polls the
// real inbound WhatsApp events (Vonage webhook) and hands each one to this tab via postMessage; this tab calls the
// agent's chat endpoint (one thread per customer) and the agent replies to her itself with whatsapp_send.
(() => {
  const CFG = {
    agentId: "90bed2cb-2792-4b40-bfc0-7882dc869c00",
    relay: "https://vouch-mock-drab.vercel.app/bridge",
    relayOrigin: "https://vouch-mock-drab.vercel.app",
    // Customer profile by WhatsApp number (in production: the CRM). Sent once, at the start of each thread.
    profiles: {
      "+919811935066": 'PROFILE: Riya, whatsapp +919811935066, size tag M, 160 cm, 58 kg, fit notes "broad shoulders, long torso", past return "sheer georgette kurta, too see-through", taps: pastel, simple, flowy, cotton/linen, pincode 110017, dealbreakers: sleeveless.'
    }
  };
  if (window.__vouchBridge) window.__vouchBridge.stop();
  const state = { threads: {}, queue: [], busy: false, relay: null };
  const csrf = () => (document.cookie.match(/agenticorg_csrf=([^;]+)/) || [])[1];
  const tell = (msg) => { try { state.relay && state.relay.postMessage(msg, CFG.relayOrigin); } catch { /* relay closed */ } };

  const btn = document.createElement("button");
  btn.textContent = "Connect WhatsApp → Vouch";
  btn.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#0d9488;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:600 13px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer";
  btn.onclick = () => {
    state.relay = window.open(CFG.relay, "vouch-bridge", "width=460,height=640");
    btn.textContent = "WhatsApp bridge: connected ✓";
    btn.style.background = "#1e293b";
  };
  document.body.appendChild(btn);

  async function ask(query, thread_id) {
    const c = csrf();
    const r = await fetch("/api/v1/chat/query", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": c },
      body: JSON.stringify({ csrf_token: c, agent_id: CFG.agentId, query, thread_id })
    });
    return r.json();
  }

  async function handle(ev) {
    const isNew = !state.threads[ev.from];
    if (isNew) state.threads[ev.from] = crypto.randomUUID();
    const profile = CFG.profiles[ev.from] || `PROFILE: new customer, whatsapp ${ev.from}${ev.name ? ", name " + ev.name : ""}.`;
    const payload = ` EVENT: new WhatsApp message (Vonage webhook, id ${String(ev.id).slice(0, 8)}) from ${ev.from}: "${String(ev.text || "").replace(/"/g, "'")}"` + (ev.voice_note ? ` voice_note: ${ev.voice_note}` : "");
    const t0 = Date.now();
    const j = await ask((isNew ? profile : "") + payload, state.threads[ev.from]);
    const a = String(j.answer || "");
    const sent = (a.match(/SENT: ([^\n]*)/) || [])[1];
    const sid = (a.match(/WHATSAPP_SID: ([^\n]*)/) || [])[1];
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    tell({ type: "vouch-reply", hitl: j.hitl_trigger || null,
      text: `(${secs}s, conf ${Number(j.confidence || 0).toFixed(2)}) ${sent || a.slice(0, 220)}${sid ? ` [sid ${sid}]` : ""}${j.hitl_trigger ? ` — ${j.hitl_trigger}; see Approvals` : ""}` });
  }

  async function drain() {
    if (state.busy) return;
    state.busy = true;
    while (state.queue.length) {
      const ev = state.queue.shift();
      try { await handle(ev); } catch (e) { tell({ type: "vouch-info", text: "agent call failed: " + (e.message || e) }); }
    }
    state.busy = false;
  }

  const onMsg = (m) => {
    if (m.origin !== CFG.relayOrigin || !m.data || m.data.type !== "vouch-event") return;
    state.queue.push(m.data.event);
    drain();
  };
  window.addEventListener("message", onMsg);

  window.__vouchBridge = {
    stop() { window.removeEventListener("message", onMsg); btn.remove(); try { state.relay && state.relay.close(); } catch {} delete window.__vouchBridge; },
    reset() { state.threads = {}; tell({ type: "vouch-info", text: "new conversation: threads cleared" }); },
    state
  };
})();
