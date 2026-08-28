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

  try {
    const body = await req.json();
    const entry = (body.entry && body.entry[0]) || {};
    const change = (entry.changes && entry.changes[0]) || {};
    const value = change.value || {};
    const messages = value.messages || [];

    for (const msg of messages) {
      const from = msg.from; // sender's WhatsApp number, no '+'
      const text = (msg.text && msg.text.body) ? msg.text.body.trim().toLowerCase() : "";

      const isOptOut = /^(stop|unsubscribe|opt.?out|cancel)\b/.test(text);

      if (isOptOut && from && SUPABASE_URL && SUPABASE_KEY) {
        // Normalise to a 10-digit Indian number to match how orders store phone,
        // since orders are saved without the country code in customer_phone.
        const local = from.replace(/^91/, "");
        await fetch(SUPABASE_URL + "/rest/v1/wa_optouts", {
          method: "POST",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
          },
          body: JSON.stringify([{ phone: local, opted_out_at: new Date().toISOString() }])
        }).catch(() => {});

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
