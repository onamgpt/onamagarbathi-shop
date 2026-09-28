// Netlify Function: records each paid order.
//
// DESIGN RULE: the order must never be lost because a database is having a bad
// day. So the proven path (Apps Script -> invoice number + email + Telegram +
// packing slip) runs FIRST and owns the response. Supabase is then written as a
// best-effort side effect. If Supabase fails, the customer still gets a real
// invoice number and you still get notified — we just log the miss.
//
// Uses plain fetch against the Supabase REST API, so there is no npm dependency
// and no CommonJS/ESM mismatch with the other functions in this folder.

const SB = () => ({ url: Netlify.env.get("SUPABASE_URL"), key: Netlify.env.get("SUPABASE_SERVICE_KEY") });

function fyLabel(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return String(start) + "-" + String(start + 1).slice(2);
}

// The shop's own invoice sequence, in kv under owner 'orders'. Volume here is
// far too low for a read-increment-write collision to matter, and a duplicate
// number would still be better than none.
async function mintInvoiceNo() {
  const { url, key } = SB();
  if (!url || !key) return null;
  const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  const cur = await fetch(url + "/rest/v1/kv?owner=eq.orders&k=eq.invoice_seq&select=v", { headers: H });
  let seq = 0;
  if (cur.ok) {
    const rows = await cur.json();
    if (rows && rows.length && rows[0].v && typeof rows[0].v.seq === "number") seq = rows[0].v.seq;
  }
  seq += 1;

  await fetch(url + "/rest/v1/kv?on_conflict=owner,k", {
    method: "POST",
    headers: Object.assign({}, H, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify([{ owner: "orders", k: "invoice_seq", v: { seq: seq } }])
  });

  return "ONAMonline/" + fyLabel(new Date()) + "/" + String(seq).padStart(4, "0");
}

// Order email and Telegram sent directly, bypassing Apps Script.
async function notifyOrder(body, invoiceNo, reason) {
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = Array.isArray(body.items) ? body.items : [];
  const lines = items.map((i) =>
    '<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">' + esc(i.name) + '</td>' +
    '<td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">' + esc(i.qty) + '</td>' +
    '<td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">' + esc(i.lineTotal) + '</td></tr>'
  ).join("");

  const key = Netlify.env.get("RESEND_API_KEY");
  if (key) {
    const html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;max-width:640px">' +
      '<p style="background:#fff1f2;color:#9f1239;padding:10px 13px;border-radius:6px;font-size:13px">' +
      'Sent directly by the website because the Apps Script order log did not respond (' +
      esc(reason) + '). This order is <strong>not in the Google Sheet</strong> - add it by hand.</p>' +
      '<h2 style="margin:6px 0 2px">New order - paid</h2>' +
      '<p style="margin:0 0 14px;color:#78716c">' + esc(invoiceNo) + ' &middot; Rs.' +
      esc(body.grandTotal) + ' &middot; payment ' + esc(body.paymentId) + '</p>' +
      '<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<thead><tr style="background:#faf9f7"><th align="left" style="padding:7px 8px">Item</th>' +
      '<th align="right" style="padding:7px 8px">Qty</th>' +
      '<th align="right" style="padding:7px 8px">Total</th></tr></thead>' +
      '<tbody>' + lines + '</tbody></table>' +
      '<div style="border:1px solid #e7e5e4;border-radius:6px;padding:11px;margin-top:14px">' +
      '<strong>' + esc(body.customerName) + '</strong> &middot; ' + esc(body.customerPhone) + '<br>' +
      esc(body.customerAddress) + '<br>' + esc(body.customerCity) + ' ' +
      esc(body.customerState) + ' ' + esc(body.customerPin) +
      (body.customerGstin ? '<br>GSTIN: ' + esc(body.customerGstin) : '') + '</div></div>';
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Onam Orders <" + (Netlify.env.get("MAIL_FROM") || "orders@onamagarbathi.com") + ">",
          to: (Netlify.env.get("EXPORT_MAIL_TO") || Netlify.env.get("MAIL_TO") || "onamagarbathi@gmail.com")
              .split(",").map(function (x) { return x.trim(); }).filter(Boolean),
          subject: "Website order " + invoiceNo + " - Rs." + body.grandTotal + " - NOT in the sheet",
          html: html
        })
      });
    } catch (e) { console.error("fallback email failed:", e.message); }
  }

  const tok = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Netlify.env.get("TELEGRAM_WEBSITE_ORDERS_ID") || Netlify.env.get("TELEGRAM_CHAT_ID");
  if (tok && chat) {
    try {
      await fetch("https://api.telegram.org/bot" + tok + "/sendMessage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text:
          "Website order " + invoiceNo + " - Rs." + body.grandTotal + "\n" +
          (body.customerName || "") + " " + (body.customerPhone || "") + "\n" +
          "Apps Script did not respond (" + reason + ") - this order is NOT in the sheet." })
      });
    } catch (e) { console.error("fallback telegram failed:", e.message); }
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const SCRIPT_URL = Netlify.env.get("ORDER_LOG_SCRIPT_URL");
  if (!SCRIPT_URL) {
    return new Response(JSON.stringify({ error: "ORDER_LOG_SCRIPT_URL not configured" }), { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  // ---------------------------------------------------------------- STEP 1
  // The path that is known to work. This decides the invoice number.
  let result, scriptError = null;
  try {
    // Bounded. A hanging Apps Script used to leave the buyer on a spinner and
    // then show them a PROVISIONAL reference.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    clearTimeout(timer);
    const text = await r.text();
    try { result = JSON.parse(text); } catch (e) { result = { raw: text }; }
    if (!r.ok) scriptError = "HTTP " + r.status;
  } catch (e) {
    // Never fail the request: the money is already taken, so losing the order
    // here is far worse than a missing spreadsheet row.
    result = {};
    scriptError = e.message || String(e);
  }

  let invoiceNo = result && result.invoiceNo ? result.invoiceNo : null;
  if (!invoiceNo && !scriptError) scriptError = "Apps Script returned no invoiceNo";

  // ------------------------------------------------------------- FALLBACK
  // Apps Script owns the invoice number, the order email and the Telegram
  // ping, so when it is down all three vanish together and the customer sees
  // "PROVISIONAL - verify with Onam Agarbathi", which reads like a failed
  // payment. Mint a number here and send the notifications ourselves.
  let fallbackUsed = false;
  if (!invoiceNo) {
    fallbackUsed = true;
    try { invoiceNo = await mintInvoiceNo(); } catch (e) { invoiceNo = null; }
    if (!invoiceNo) invoiceNo = "ONAMonline/OFFLINE/" + Date.now().toString().slice(-6);
    result = Object.assign({}, result, { invoiceNo: invoiceNo, fallback: true });
    await notifyOrder(body, invoiceNo, scriptError);
  }

  // ---------------------------------------------------------------- STEP 2
  // Best-effort mirror into Supabase. Wrapped so nothing here can throw out.
  let supabaseStatus = "skipped";
  try {
    const SB_URL = Netlify.env.get("SUPABASE_URL");
    const SB_KEY = Netlify.env.get("SUPABASE_SERVICE_KEY");

    if (SB_URL && SB_KEY && invoiceNo) {
      const H = {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      };

      const nowIso = new Date().toISOString();
      const num = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

      const state = String(body.customerState || "").trim().toUpperCase();
      const inter = state && state !== "KARNATAKA";
      const totalGst = num(body.totalGst);
      const items = Array.isArray(body.items) ? body.items : [];

      const orderRow = {
        id: invoiceNo,
        order_id: body.orderId || "",
        created_at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        created_log_ts: nowIso,
        payment_id: body.paymentId || "",
        customer_name: body.customerName || "",
        customer_phone: body.customerPhone || "",
        customer_address: body.customerAddress || "",
        customer_city: body.customerCity || "",
        customer_pin: body.customerPin || "",
        customer_state: body.customerState || "",
        customer_gstin: body.customerGstin || "",
        taxable_value: num(body.totalTaxableValue),
        cgst: inter ? 0 : Math.round(totalGst / 2 * 100) / 100,
        sgst: inter ? 0 : Math.round(totalGst / 2 * 100) / 100,
        igst: inter ? totalGst : 0,
        total_gst: totalGst,
        grand_total: num(body.grandTotal),
        tax_type: inter ? "IGST" : "CGST+SGST",
        status: "Pending",
        items_summary: items.length
          ? items.map((i) => (i.name || "?") + " x" + (i.qty || 1)).join(" | ")
          : ""
      };

      const oRes = await fetch(SB_URL + "/rest/v1/orders", {
        method: "POST",
        headers: H,
        body: JSON.stringify([orderRow])
      });

      if (!oRes.ok) {
        supabaseStatus = "order insert failed: " + oRes.status + " " + (await oRes.text()).slice(0, 200);
      } else {
        supabaseStatus = "order saved";

        if (items.length) {
          const lineRows = items.map((it, idx) => {
            const gstAmt = num(it.gstAmount);
            return {
              id: invoiceNo + "_line_" + (idx + 1),
              invoice_no: invoiceNo,
              order_id: body.orderId || "",
              created_at: orderRow.created_at,
              item_name: it.name || "",
              pack_size: it.packSize || "",
              hsn: it.hsn || "33074100",
              qty: num(it.qty),
              unit_price: num(it.unitPrice),
              taxable_value: num(it.taxableValue),
              customer_state: body.customerState || "",
              gst_rate: num(it.gstRate),
              cgst: inter ? 0 : Math.round(gstAmt / 2 * 100) / 100,
              sgst: inter ? 0 : Math.round(gstAmt / 2 * 100) / 100,
              igst: inter ? gstAmt : 0,
              gst_amount: gstAmt,
              line_total: num(it.lineTotal)
            };
          });

          const lRes = await fetch(SB_URL + "/rest/v1/order_lines", {
            method: "POST",
            headers: H,
            body: JSON.stringify(lineRows)
          });

          supabaseStatus = lRes.ok
            ? "order + " + lineRows.length + " lines saved"
            : "lines failed: " + lRes.status + " " + (await lRes.text()).slice(0, 200);
        }
      }
    } else if (!invoiceNo) {
      supabaseStatus = "no invoiceNo from Apps Script, not mirrored";
    } else {
      supabaseStatus = "SUPABASE_URL or SUPABASE_SERVICE_KEY missing";
    }
  } catch (e) {
    supabaseStatus = "exception: " + (e && e.message ? e.message : String(e));
  }

  console.log("SUPABASE MIRROR:", invoiceNo, "->", supabaseStatus);

  // Return exactly what the shop expects, plus a diagnostic field.
  return new Response(
    JSON.stringify(Object.assign({}, result, {
      supabase: supabaseStatus,
      appsScript: scriptError ? ("failed: " + scriptError) : "ok",
      fallback: fallbackUsed
    })),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  path: "/.netlify/functions/order-log"
};
