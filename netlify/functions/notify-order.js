// Website order notifications.
//
// These used to be sent from inside Apps Script, which hardcoded the chat id
// and meant every routing change needed a manual redeployment. Keeping it here
// puts the destination in code and in an environment variable instead.

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

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const BOT_TOKEN = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  // Website orders belong in their own group, not the internal tracker group.
  const CHAT_ID = Netlify.env.get("TELEGRAM_WEBSITE_ORDERS_ID");

  if (!BOT_TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({
      ok: false,
      skipped: true,
      reason: !BOT_TOKEN ? "TELEGRAM_BOT_TOKEN not set" : "TELEGRAM_WEBSITE_ORDERS_ID not set"
    }), { status: 200, headers: cors });
  }

  let body = {};
  try { body = await req.json(); } catch (e) {}

  const inr = (n) => "Rs." + Number(n || 0).toLocaleString("en-IN");
  const items = Array.isArray(body.items) ? body.items : [];
  const cust = body.customer || {};

  const lines = [];
  lines.push("NEW ORDER - PAID");
  lines.push("");
  if (body.orderNo) lines.push(body.orderNo);
  const stamp = [body.date, body.time].filter(Boolean).join("  ");
  lines.push([stamp, body.total != null ? inr(body.total) : null].filter(Boolean).join("  |  "));
  if (body.paymentId) lines.push("Payment: " + body.paymentId);

  if (items.length) {
    lines.push("");
    lines.push("PACK:");
    items.forEach((it, i) => {
      const size = it.size ? " (" + it.size + ")" : "";
      const qty = it.qty != null ? "  x " + it.qty : "";
      lines.push("  " + (i + 1) + ". " + (it.name || "item") + size + qty);
    });
  }

  const addr = [
    cust.name,
    cust.phone,
    cust.address,
    [cust.city, cust.pincode].filter(Boolean).join(" - "),
    cust.state
  ].filter(Boolean);

  if (addr.length) {
    lines.push("");
    lines.push("SHIP TO:");
    addr.forEach(l => lines.push("  " + l));
  }

  try {
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(CHAT_ID), text: lines.join("\n") })
    });
    const j = await r.json();
    return new Response(JSON.stringify({ ok: !!j.ok, result: j }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: cors });
  }
};
