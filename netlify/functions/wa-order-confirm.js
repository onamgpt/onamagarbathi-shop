// Sends the WhatsApp order-confirmation template right after a paid order is
// logged. Fires alongside notify-order.js and order-email.js from the same
// client-side call site — same payload shape, so no changes needed there
// beyond adding this fetch call.
//
// Transactional (utility category) message — no opt-out gate applies here;
// opt-out only governs marketing sends (festival greetings, reorder nudges).
// Best-effort: never throws, never blocks the checkout flow if WhatsApp or
// Supabase is briefly unavailable.

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

  const PHONE_NUMBER_ID = Netlify.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const ACCESS_TOKEN = Netlify.env.get("WHATSAPP_ACCESS_TOKEN");

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
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

    const r = await fetch("https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages", {
      method: "POST",
      headers: { "Authorization": "Bearer " + ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    return new Response(JSON.stringify({ ok: !j.error, result: j }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: cors });
  }
};

export const config = {
  path: "/.netlify/functions/wa-order-confirm"
};
