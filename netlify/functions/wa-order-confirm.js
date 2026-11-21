// Sends the WhatsApp order-confirmation template right after a paid order is
// logged. Fires alongside notify-order.js and order-email.js from the same
// client-side call site — same payload shape, so no changes needed there
// beyond adding this fetch call.
//
// Transactional (utility category) message — no opt-out gate applies here;
// opt-out only governs marketing sends (festival greetings, reorder nudges).
// Best-effort: never throws, never blocks the checkout flow if WhatsApp or
// Supabase is briefly unavailable.

import { logSend } from "../lib/wa-log.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  const PHONE_NUMBER_ID = Netlify.env.get("WHATSAPP_PHONE_NUMBER_ID") || "1152842484587685";
  const ACCESS_TOKEN = Netlify.env.get("WHATSAPP_ACCESS_TOKEN");

  // Token: the tracker's API Key Vault copy (known good, never-expiring system-user
  // token) first, then the Netlify env copy — same order whatsapp-webhook uses.
  // The env copy alone may be an old expired token (21 Nov 2026).
  let VAULT_TOKEN = null;
  try {
    const SB = Netlify.env.get("SUPABASE_URL"), K = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (SB && K) {
      const tr = await fetch(SB + "/rest/v1/app_secrets?name=eq.WHATSAPP_ACCESS_TOKEN&select=value", { headers: { apikey: K, Authorization: "Bearer " + K } });
      const tj = await tr.json(); if (tj && tj[0] && tj[0].value) VAULT_TOKEN = String(tj[0].value).trim();
    }
  } catch (e) {}
  const TOKENS = [VAULT_TOKEN, ACCESS_TOKEN].filter((t, i, a) => t && a.indexOf(t) === i);

  if (!PHONE_NUMBER_ID || !TOKENS.length) {
    return new Response(JSON.stringify({ ok: false, skipped: true, reason: "WhatsApp env vars not set on this site" }), { status: 200, headers: cors });
  }

  let body = {};
  try {
    body = JSON.parse(await req.text() || "{}");
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), { status: 200, headers: cors });
  }

  const cust = body.customer || {};
  const phone = cust.phone;
  const name = cust.name || "there";
  const orderNo = body.orderNo || "";
  const total = body.total || 0;

  if (!phone || !orderNo) {
    return new Response(JSON.stringify({ ok: false, skipped: true, reason: "missing phone or orderNo" }), { status: 200, headers: cors });
  }

  const formatPhone = (p) => {
    let d = String(p).replace(/[^\d]/g, "");
    if (d.length === 10) d = "91" + d;
    return d;
  };

  try {
    const payload = {
      messaging_product: "whatsapp",
      to: formatPhone(phone),
      type: "template",
      template: {
        // Utility, not Marketing. Same three parameters, but far cheaper per
        // message and not suppressed for customers who opt out of promotions —
        // a receipt should never depend on a marketing preference.
        name: "order_confirm_utility",
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: name },
            { type: "text", text: orderNo },
            { type: "text", text: String(total) }
          ]
        }]
      }
    };

    let j = null;
    for (const tok of TOKENS) {
      const r = await fetch("https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages", {
        method: "POST",
        headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      j = await r.json().catch(() => null);
      // Only an auth problem (code 190 / OAuthException) is worth retrying with the other token.
      if (!(j && j.error && (j.error.code === 190 || j.error.type === "OAuthException"))) break;
    }
    // Record Meta's real answer; on failure Ravi is WhatsApped and the customer
    // gets the same confirmation from the office number instead.
    const res = await logSend({ to: formatPhone(phone), template: "order_confirm_utility", orderId: orderNo,
      source: body.source || "website", reply: j, customerName: cust.name || "", fallbackText: fallbackText(name, orderNo, total) });
    return new Response(JSON.stringify({ ok: res.ok, result: j, logged: res }), { status: 200, headers: cors });
  } catch (e) {
    const res = await logSend({ to: formatPhone(phone), template: "order_confirm_utility", orderId: orderNo,
      source: body.source || "website", error: "send error: " + String(e), customerName: cust.name || "", fallbackText: fallbackText(name, orderNo, total) });
    return new Response(JSON.stringify({ ok: false, error: String(e), logged: res }), { status: 200, headers: cors });
  }
};

function fallbackText(name, orderNo, total) {
  const first = String(name || "there").trim().split(/\s+/)[0];
  return "🙏 Hi " + first + ", thank you for your order with *Onam Agarbathi*.\n" +
    "Order: " + orderNo + "\nAmount paid: Rs." + total + "\n" +
    "We have received your order and are packing it now. We will send you the courier and tracking details once it is dispatched.\n\n" +
    "Questions? Reply here or WhatsApp 83103 68142.";
}

export const config = {
  path: "/.netlify/functions/wa-order-confirm"
};
