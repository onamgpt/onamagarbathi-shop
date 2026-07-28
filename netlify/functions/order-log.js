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
  let result;
  try {
    const r = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    try { result = JSON.parse(text); } catch (e) { result = { raw: text }; }
  } catch (e) {
    return new Response(JSON.stringify({ error: "order log failed: " + e.message }), { status: 500 });
  }

  const invoiceNo = result && result.invoiceNo ? result.invoiceNo : null;

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
    JSON.stringify(Object.assign({}, result, { supabase: supabaseStatus })),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  path: "/.netlify/functions/order-log"
};
