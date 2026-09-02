// Receives inbound WhatsApp messages from Meta. Two jobs only:
//  1. GET — the one-time webhook verification handshake Meta requires when
//     you register this URL in the Meta Developer Console.
//  2. POST — reads incoming customer messages; if the text looks like an
//     opt-out ("stop", "unsubscribe", etc.), records it in Supabase so
//     future marketing sends (festival greetings, reorder nudges) skip this
//     number. Transactional order-status messages are NOT gated by this —
//     those are utility messages tied to an order the customer placed.
//
// Setup (one-time, in Meta Developer Console > WhatsApp > Configuration):
//   Callback URL:  https://onamagarbathi.com/.netlify/functions/whatsapp-webhook
//   Verify token:  whatever you set as WHATSAPP_WEBHOOK_VERIFY_TOKEN in Netlify

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const VERIFY_TOKEN = Netlify.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
  const SUPABASE_KEY = Netlify.env.get("SUPABASE_SERVICE_KEY");

  // Log the raw POST before any parsing. Logging further down, inside the
  // message loop, meant a payload of an unexpected shape arrived and vanished
  // silently — indistinguishable from Meta never calling at all.
  let body;
  try {
    body = await req.json();
  } catch (e) {
    body = {};
  }
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const h0 = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                   "Content-Type": "application/json" };
      const r0 = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_webhook_hits&select=v", { headers: h0 });
      const j0 = await r0.json();
      const cur0 = (Array.isArray(j0) && j0[0] && j0[0].v && j0[0].v.log) ? j0[0].v.log : [];
      const v0 = ((body.entry || [])[0] || {});
      const c0 = ((v0.changes || [])[0] || {});
      cur0.push(new Date().toISOString() + "  field=" + (c0.field || "?") +
                "  keys=" + Object.keys(c0.value || {}).join("/") ||  "none");
      await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
        method: "POST",
        headers: Object.assign({}, h0, { "Prefer": "resolution=merge-duplicates" }),
        body: JSON.stringify({ owner: "main", k: "wa_webhook_hits", v: { log: cur0.slice(-40) } })
      });
    } catch (e) { /* never block the 200 back to Meta */ }
  }

  try {
    const entry = (body.entry && body.entry[0]) || {};
    const change = (entry.changes && entry.changes[0]) || {};
    const value = change.value || {};
    const messages = value.messages || [];

    for (const msg of messages) {
      const from = msg.from; // sender's WhatsApp number, no '+'
      const text = (msg.text && msg.text.body) ? msg.text.body.trim().toLowerCase() : "";

      // Log every call, before anything else can fail. Without this we cannot
      // tell "Meta never called us" from "Meta called and the write failed".
      if (SUPABASE_URL && SUPABASE_KEY) {
        try {
          const h2 = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                       "Content-Type": "application/json" };
          const rr = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_webhook_hits&select=v", { headers: h2 });
          const jj = await rr.json();
          const cur = (Array.isArray(jj) && jj[0] && jj[0].v && jj[0].v.log) ? jj[0].v.log : [];
          cur.push(new Date().toISOString() + "  from " + (msg.from || "?") + "  type " + (msg.type || "?"));
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: Object.assign({}, h2, { "Prefer": "resolution=merge-duplicates" }),
            body: JSON.stringify({ owner: "main", k: "wa_webhook_hits", v: { log: cur.slice(-40) } })
          });
        } catch (e) { /* never block the reply */ }
      }

      // Any inbound message opens a 24-hour window in which we may send free
      // text to that number. Record when, so the scheduler can tell whether a
      // plain message is allowed or whether it has to fall back to a template.
      if (from && SUPABASE_URL && SUPABASE_KEY) {
        try {
          const hdrs = {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json"
          };
          const r = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_last_inbound&select=v", { headers: hdrs });
          const j = await r.json();
          const seen = (Array.isArray(j) && j[0] && j[0].v) ? j[0].v : {};
          seen[from] = new Date().toISOString();
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: Object.assign({}, hdrs, { "Prefer": "resolution=merge-duplicates" }),
            body: JSON.stringify({ owner: "main", k: "wa_last_inbound", v: seen })
          });
        } catch (e) { /* tracking must never block the reply below */ }
      }

      const isOptOut = /^(stop|unsubscribe|opt.?out|cancel)\b/.test(text);

      if (isOptOut && from && SUPABASE_URL && SUPABASE_KEY) {
        // Normalise to a 10-digit Indian number to match how orders store phone,
        // since orders are saved without the country code in customer_phone.
        const local = from.replace(/^91/, "");
        const sbHeaders = {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json"
        };

        // Opt-outs live in the existing kv table as a single JSON object keyed
        // by phone — no dedicated table, same store the tracker already uses.
        try {
          const readRes = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_optouts&select=v", { headers: sbHeaders });
          const readJson = await readRes.json();
          const optouts = (Array.isArray(readJson) && readJson[0] && readJson[0].v) ? readJson[0].v : {};
          optouts[local] = new Date().toISOString();
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify({ owner: "main", k: "wa_optouts", v: optouts })
          });
        } catch (e) { /* best effort — never fail the webhook */ }

        // Confirm the opt-out back to the customer — required good practice,
        // and a plain-text reply is allowed since they just messaged us
        // (inside the 24h customer service window).
        const PHONE_NUMBER_ID = Netlify.env.get("WHATSAPP_PHONE_NUMBER_ID");
        const ACCESS_TOKEN = Netlify.env.get("WHATSAPP_ACCESS_TOKEN");
        if (PHONE_NUMBER_ID && ACCESS_TOKEN) {
          fetch("https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages", {
            method: "POST",
            headers: { "Authorization": "Bearer " + ACCESS_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              type: "text",
              text: { body: "You've been unsubscribed from promotional messages. You'll still receive order updates for anything you order. Thank you!" }
            })
          }).catch(() => {});
        }
      }
    }

    // Always 200 — Meta retries aggressively on non-2xx, and there is nothing
    // useful to retry here since we've already done the best-effort work.
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (e) {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
};

export const config = {
  path: "/.netlify/functions/whatsapp-webhook"
};
