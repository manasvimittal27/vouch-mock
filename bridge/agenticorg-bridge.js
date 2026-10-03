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
    // Known customers by WhatsApp number (in production: the CRM). Empty = every number is new, so Vouch
    // onboards her in chat (N1–N3: height, weight, size, fit, pincode, style, dealbreakers, last return).
    profiles: {}
  };
  if (window.__vouchBridge) window.__vouchBridge.stop();
  const state = { threads: {}, queue: [], busy: false, relay: null };
  const csrf = () => (document.cookie.match(/agenticorg_csrf=([^;]+)/) || [])[1];
  const tell = (msg) => {
    try { state.relay && state.relay.postMessage(msg, CFG.relayOrigin); } catch { /* relay closed */ }
    if (state.panelLog) { const d = document.createElement("div"); d.style.cssText = "padding:6px 8px;border-radius:8px;background:" + (msg.type === "vouch-reply" ? "#ecfdf5" : "#f1f5f9") + ";white-space:pre-wrap"; d.textContent = (msg.type === "vouch-reply" ? "Vouch: " : "· ") + msg.text; state.panelLog.appendChild(d); state.panelLog.scrollTop = 1e9; }
  };

  const btn = document.createElement("button");
  btn.textContent = "Connect WhatsApp → Vouch";
  btn.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#0d9488;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:600 13px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer";
  btn.onclick = () => {
    state.relay = window.open(CFG.relay, "vouch-bridge", "width=460,height=640");
    btn.textContent = "WhatsApp bridge: connected ✓";
    btn.style.background = "#1e293b";
  };
  document.body.appendChild(btn);

  // Test box: chat with Vouch from this tab without WhatsApp (keep the admin switch on "dry").
  // Messages are marked SIMULATED in the event so the decision log never passes them off as real WhatsApp.
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;right:16px;bottom:64px;z-index:99999;width:340px;max-height:60vh;display:flex;flex-direction:column;gap:6px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:12px;padding:10px;font:13px/1.4 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.2)";
  panel.innerHTML = '<b>Test Vouch (no WhatsApp)</b><div data-log style="overflow:auto;display:flex;flex-direction:column;gap:4px;min-height:60px;max-height:40vh"></div><form data-f style="display:flex;gap:6px"><input data-i placeholder="e.g. Cousin ki engagement hai 14 ko, 2500 tak" style="flex:1;min-width:0;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px"><button style="background:#0d9488;color:#fff;border:0;border-radius:8px;padding:6px 10px">Send</button></form><div style="display:flex;justify-content:space-between;color:#64748b;font-size:11px"><span>as +919811935066 · replies are DRY-RUN</span><a href="#" data-r style="color:#0d9488">new chat</a></div>';
  document.body.appendChild(panel);
  state.panelLog = panel.querySelector("[data-log]");
  panel.querySelector("[data-f]").onsubmit = (e) => {
    e.preventDefault();
    const i = panel.querySelector("[data-i]"); const text = i.value.trim(); if (!text) return; i.value = "";
    const d = document.createElement("div"); d.style.cssText = "align-self:flex-end;padding:6px 8px;border-radius:8px;background:#dcfce7"; d.textContent = text; state.panelLog.appendChild(d);
    state.queue.push({ id: "sim-" + Date.now(), from: "+919811935066", name: "Test", text, simulated: true }); drain();
  };
  panel.querySelector("[data-r]").onclick = (e) => { e.preventDefault(); state.threads = {}; tell({ type: "vouch-info", text: "new conversation: threads cleared" }); };

  async function ask(query, thread_id) {
    // AgenticOrg occasionally answers with an HTML error page (gateway timeout); retry once before giving up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const c = csrf();
      const r = await fetch("/api/v1/chat/query", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": c },
        body: JSON.stringify({ csrf_token: c, agent_id: CFG.agentId, query, thread_id })
      });
      const text = await r.text();
      try { return JSON.parse(text); } catch {
        if (attempt === 2) throw new Error(`AgenticOrg returned HTTP ${r.status} (not JSON) twice`);
        tell({ type: "vouch-info", text: `AgenticOrg returned HTTP ${r.status}; retrying once…` });
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  async function handle(ev) {
    const isNew = !state.threads[ev.from];
    if (isNew) state.threads[ev.from] = crypto.randomUUID();
    const profile = CFG.profiles[ev.from] || `PROFILE: new customer, whatsapp ${ev.from}${ev.name ? ", name " + ev.name : ""}.`;
    const payload = ` EVENT: new WhatsApp message (${ev.simulated ? "SIMULATED test message typed in the AgenticOrg tab, WhatsApp switch is dry" : "Vonage webhook"}, id ${String(ev.id).slice(0, 8)}) from ${ev.from}: "${String(ev.text || "").replace(/"/g, "'")}"` + (ev.voice_note ? ` voice_note: ${ev.voice_note}` : "") + ". Your reply reaches her only through whatsapp_send.";
    const t0 = Date.now();
    tell({ type: "vouch-info", text: "Vouch is working on it (usually 15–40 s)…" });
    let j = await ask((isNew ? profile : "") + payload, state.threads[ev.from]);
    // Send check: a turn that answers her but never reached whatsapp_send leaves her with silence.
    // Nudge once, in the same thread, and record that the nudge happened (visible in the relay log).
    const sentOk = (x) => /WHATSAPP_SID:\s*(DRY-RUN|[0-9a-f]{8}-[0-9a-f-]{20,})/i.test(String(x.answer || ""));
    if (!sentOk(j)) {
      tell({ type: "vouch-info", text: "send check: no confirmed WhatsApp send in that turn — nudging the agent once" });
      j = await ask(" SEND CHECK (bridge): your last turn's answer shows no WhatsApp message id. If whatsapp_send already succeeded in that turn, do NOT send again: just rewrite the JSON answer with that WHATSAPP_SID. Otherwise she has received nothing: if your decision stands, call whatsapp_send now with your exact reply to her (finish any step you started, e.g. after her yes create the order), then write the JSON answer.", state.threads[ev.from]);
      j.nudged = true;
    }
    window.__vouchLog = (window.__vouchLog || []).concat([{ ev, j }]);
    const a = String(j.answer || "");
    const sent = (a.match(/SENT: ([^\n]*)/) || [])[1];
    const sid = (a.match(/WHATSAPP_SID: ([^\n]*)/) || [])[1];
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    tell({ type: "vouch-reply", hitl: j.hitl_trigger || null,
      text: `${j.nudged ? "[after send check] " : ""}(${secs}s, conf ${Number(j.confidence || 0).toFixed(2)}) ${sent || a.slice(0, 220)}${sid ? ` [sid ${sid}]` : ""}${j.hitl_trigger ? ` — ${j.hitl_trigger}; see Approvals` : ""}` });
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
    stop() { window.removeEventListener("message", onMsg); btn.remove(); panel.remove(); try { state.relay && state.relay.close(); } catch {} delete window.__vouchBridge; },
    reset() { state.threads = {}; tell({ type: "vouch-info", text: "new conversation: threads cleared" }); },
    state
  };
})();
