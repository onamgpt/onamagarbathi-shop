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

  // Read as text first, then parse. req.json() throwing leaves an empty object
  // behind and the message goes out with nothing but a header — which is what
  // happened. Reading the raw text lets us see whether the body arrived at all.
  let body = {};
  let raw = "";
  let parseError = null;
  try {
    raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch (e) {
    parseError = String(e && e.message ? e.message : e);
  }

  const inr = (n) => "Rs." + Number(n || 0).toLocaleString("en-IN");
  const items = Array.isArray(body.items) ? body.items : [];
  const cust = body.customer || {};

  const lines = [];
  lines.push("NEW ORDER - PAID");

  // An order with no usable data is a fault, not a notification. Say so, and
  // carry enough detail to find the cause rather than sending a bare heading.
  const gotAnything = body && (body.orderNo || body.paymentId || body.total ||
    (Array.isArray(body.items) && body.items.length));
  if (!gotAnything) {
    lines.push("⚠ the order details did not reach this message");
    lines.push("");
    lines.push("bytes received: " + (raw ? raw.length : 0));
    if (parseError) lines.push("could not read it: " + parseError);
    else if (raw) lines.push("first part: " + raw.slice(0, 180));
    lines.push("");
    lines.push("The payment went through. Open Razorpay or the order sheet");
    lines.push("for the items and the address.");
    const r0 = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(CHAT_ID), text: lines.join("\n") })
    });
    const j0 = await r0.json();
    return new Response(JSON.stringify({ ok: !!j0.ok, empty: true, bytes: raw.length }),
      { status: 200, headers: cors });
  }
  lines.push("");
  if (body.orderNo) lines.push(body.orderNo);
  const stamp = [body.date, body.time].filter(Boolean).join("  ");
  lines.push([stamp, body.total != null ? inr(body.total) : null].filter(Boolean).join("  |  "));
  if (body.paymentId) lines.push("Payment: " + body.paymentId);
  // Where this order came from. The single most useful line on this message
  // once sampling starts, because it says whether the boxes are working.
  if (body.source) {
    lines.push("Came from: " + body.source +
      (body.campaign ? (" / " + body.campaign) : ""));
  }

  lines.push("");
  if (items.length) {
    lines.push("PACK:");
    items.forEach((it, i) => {
      const size = it.size ? " (" + it.size + ")" : "";
      const qty = it.qty != null ? "  x " + it.qty : "";
      lines.push("  " + (i + 1) + ". " + (it.name || "unnamed item") + size + qty);
    });
  } else {
    // Never send a silent order. If the items did not arrive, say so —
    // otherwise the message looks complete and the packer has nothing to pack.
    lines.push("PACK: NOT RECEIVED — open the invoice for the items");
    lines.push("  (the checkout sent no line items with this order)");
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
