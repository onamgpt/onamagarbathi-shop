// Tells us whether Meta's webhook is reaching this site, and whether it can
// write to Supabase. Separates "never called" from "called but write failed" —
// the webhook swallows its own errors so neither is visible otherwise.

export default async () => {
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY");
  const verify = Netlify.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

  const out = [];
  out.push("WhatsApp webhook check (shop site)");
  out.push("==================================");
  out.push("");
  out.push("SUPABASE_URL                    " + (url ? "set" : "MISSING"));
  out.push("SUPABASE_SERVICE_KEY            " + (key ? "set" : "MISSING"));
  out.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN   " + (verify ? "set" : "MISSING"));
  out.push("");

  if (!url || !key) {
    out.push("PROBLEM FOUND");
    out.push("The webhook cannot record anything without these. It receives the");
    out.push("message, skips the write, and returns 200 — so Meta sees success");
    out.push("and nothing is stored.");
    out.push("");
    out.push("FIX: add SUPABASE_URL and SUPABASE_SERVICE_KEY to THIS site");
    out.push("(onamagarbathi-shop). Copy the same values from rk-tracker-v2.");
    return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const hdrs = { apikey: key, Authorization: "Bearer " + key };
  const read = async (k) => {
    try {
      const r = await fetch(url + "/rest/v1/kv?owner=eq.main&k=eq." + k + "&select=v", { headers: hdrs });
      const j = await r.json();
      return (Array.isArray(j) && j[0] && j[0].v) ? j[0].v : null;
    } catch (e) { return "ERROR: " + e.message; }
  };

  const hits = await read("wa_webhook_hits");
  const inbound = await read("wa_last_inbound");

  out.push("Webhook calls received: " + (hits && hits.log ? hits.log.length : 0));
  if (hits && hits.log) for (const h of hits.log.slice(-10)) out.push("  " + h);
  out.push("");
  out.push("Inbound numbers recorded: " +
           (inbound && Object.keys(inbound).length ? Object.keys(inbound).join(", ") : "none"));
  out.push("");
  if (!hits || !hits.log || !hits.log.length) {
    out.push("No webhook calls logged. Either Meta is not delivering to this URL,");
    out.push("or the subscription is not active. Check the callback URL is:");
    out.push("  https://onamagarbathi.com/.netlify/functions/whatsapp-webhook");
    out.push("and that 'messages' is subscribed under WhatsApp > Configuration.");
  }
  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
