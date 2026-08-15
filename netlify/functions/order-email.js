// Order emails, sent from here rather than from inside Apps Script.
//
// Apps Script cannot be changed without a manual redeployment and fails
// quietly when it does fail. This lives in the repository, so it can be
// fixed and reverted like any other code.
//
// Deliberately best effort: an order must never fail because an email did
// not send. Errors are reported in the response, not thrown at the customer.

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: {
      ...cors,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }});
  }

  const KEY  = Netlify.env.get("RESEND_API_KEY");
  const FROM = Netlify.env.get("MAIL_FROM");
  const TO   = Netlify.env.get("MAIL_TO");

  if (!KEY || !FROM || !TO) {
    return new Response(JSON.stringify({
      ok: false, skipped: true,
      reason: !KEY ? "RESEND_API_KEY not set"
            : !FROM ? "MAIL_FROM not set"
            : "MAIL_TO not set"
    }), { status: 200, headers: cors });
  }

  // Read as text first. req.json() throwing leaves an empty object behind and
  // the email goes out with nothing in it — the same fault the Telegram
  // notification had.
  let body = {};
  let raw = "";
  try {
    raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "could not read the order", bytes: raw.length }),
      { status: 200, headers: cors });
  }

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inr = (n) => "Rs." + Number(n || 0).toLocaleString("en-IN");

  const items = Array.isArray(body.items) ? body.items : [];
  const cust  = body.customer || {};
  const orderNo = body.orderNo || body.paymentId || "order";

  const rows = items.length
    ? items.map((it, i) => `
        <tr>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${i + 1}</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">
            <b>${esc(it.name)}</b>${it.size ? ` <span style="color:#888">(${esc(it.size)})</span>` : ""}
          </td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee;text-align:right">${esc(it.qty)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding:12px 10px;color:#a33">
         The item list did not reach this email — open the invoice for details.
       </td></tr>`;

  const addr = [cust.address, cust.city,
    [cust.state, cust.pincode].filter(Boolean).join(" ")]
    .filter(Boolean).map(esc).join("<br>");

  const html = `
  <div style="font-family:Georgia,serif;color:#1a2a1a;max-width:600px;margin:0 auto;padding:22px">
    <div style="font-size:11px;letter-spacing:2px;color:#8a6a2a">ONAM AGARBATHI</div>
    <h2 style="margin:6px 0 2px;font-size:21px">New order — paid</h2>
    <div style="color:#7a8a7a;font-size:13px;margin-bottom:18px">
      ${esc(orderNo)} &nbsp;·&nbsp; ${esc(body.date || "")} ${esc(body.time || "")}
      ${body.total != null ? " &nbsp;·&nbsp; <b>" + inr(body.total) + "</b>" : ""}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
      <tr style="background:#f4f8f4">
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#5a7a5a;width:30px">#</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#5a7a5a">Item</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#5a7a5a;width:60px">Qty</th>
      </tr>
      ${rows}
    </table>

    <div style="background:#f7faf7;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.7">
      <div style="font-size:11px;color:#5a7a5a;letter-spacing:1px;margin-bottom:6px">SHIP TO</div>
      <b>${esc(cust.name)}</b><br>
      ${cust.phone ? esc(cust.phone) + "<br>" : ""}
      ${addr}
    </div>

    <div style="margin-top:16px;font-size:12.5px;color:#7a8a7a;line-height:1.7">
      ${body.paymentId ? "Payment: " + esc(body.paymentId) + "<br>" : ""}
      ${body.source ? "Came from: " + esc(body.source) +
        (body.campaign ? " / " + esc(body.campaign) : "") : ""}
    </div>

    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e4e8e4;
                font-size:11px;color:#a0a898">
      Sent by onamagarbathi.com
    </div>
  </div>`;

  const text = [
    "NEW ORDER - PAID",
    "",
    orderNo,
    [body.date, body.time].filter(Boolean).join(" ") +
      (body.total != null ? "  |  " + inr(body.total) : ""),
    body.paymentId ? "Payment: " + body.paymentId : "",
    "",
    "PACK:",
    ...(items.length
      ? items.map((it, i) => `  ${i + 1}. ${it.name}${it.size ? " (" + it.size + ")" : ""}  x ${it.qty}`)
      : ["  (not received — open the invoice)"]),
    "",
    "SHIP TO:",
    "  " + (cust.name || ""),
    cust.phone ? "  " + cust.phone : "",
    cust.address ? "  " + cust.address : "",
    [cust.city, cust.pincode].filter(Boolean).join(" - ") ? "  " + [cust.city, cust.pincode].filter(Boolean).join(" - ") : "",
    cust.state ? "  " + cust.state : ""
  ].filter(l => l !== "").join("\n");

  const to = String(TO).split(",").map(s => s.trim()).filter(Boolean);
  const subject = "Order " + orderNo +
    (body.total != null ? " — " + inr(body.total) : "") +
    (cust.name ? " — " + cust.name : "");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: FROM, to, subject, html, text })
    });
    const j = await r.json();
    return new Response(JSON.stringify({ ok: r.status >= 200 && r.status < 300, status: r.status, result: j }),
      { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }),
      { status: 200, headers: cors });
  }
};
