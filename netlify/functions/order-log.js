// Netlify Function: logs each completed order to a Google Sheet (via Apps Script)
// in a GST-ready, Tally-import-friendly structure.
// This does NOT generate a government e-invoice itself - it only logs clean,
// structured order data (HSN, taxable value, GST breakup, customer GSTIN/address)
// for your auditor/Tally workflow to pick up and generate the actual e-invoice from.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const SCRIPT_URL = process.env.ORDER_LOG_SCRIPT_URL;
  if (!SCRIPT_URL) {
    return new Response(JSON.stringify({ error: "ORDER_LOG_SCRIPT_URL not configured" }), { status: 500 });
  }

  try {
    const body = await req.json();
    const r = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/order-log"
};
