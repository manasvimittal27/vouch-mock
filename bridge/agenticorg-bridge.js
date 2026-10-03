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
    const payload = ` EVENT: new WhatsApp message (Vonage webhook, id ${String(ev.id).slice(0, 8)}) from ${ev.from}: "${String(ev.text || "").replace(/"/g, "'")}"` + (ev.voice_note ? ` voice_note: ${ev.voice_note}` : "") + ". Your reply reaches her only through whatsapp_send.";
    const t0 = Date.now();
    let j = await ask((isNew ? profile : "") + payload, state.threads[ev.from]);
    // Send check: a turn that answers her but never reached whatsapp_send leaves her with silence.
    // Nudge once, in the same thread, and record that the nudge happened (visible in the relay log).
    const sentOk = (x) => /WHATSAPP_SID:\s*(DRY-RUN|[0-9a-f]{8}-[0-9a-f-]{20,})/i.test(String(x.answer || ""));
    if (!sentOk(j)) {
      tell({ type: "vouch-info", text: "send check: no confirmed WhatsApp send in that turn — nudging the agent once" });
      j = await ask(" SEND CHECK (bridge): your last turn ended without a successful whatsapp_send, so she has received nothing. If your decision stands, call whatsapp_send now with your exact reply to her (finish any step you started, e.g. after her yes create the order), then write the JSON answer.", state.threads[ev.from]);
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
    stop() { window.removeEventListener("message", onMsg); btn.remove(); try { state.relay && state.relay.close(); } catch {} delete window.__vouchBridge; },
    reset() { state.threads = {}; tell({ type: "vouch-info", text: "new conversation: threads cleared" }); },
    state
  };
})();
