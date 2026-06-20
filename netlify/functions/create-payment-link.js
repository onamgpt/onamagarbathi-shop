// Creates a Razorpay Payment Link for a WhatsApp checkout order.
// Runs server-side ONLY - this is the one place the Key Secret is used,
// since it must never be exposed in browser-visible code.
//
// Also stores the order's GST line items + customer details in Netlify Blobs,
// keyed by referenceId, so the payment-webhook function can retrieve them
// later and log a complete GST order record WITHOUT depending on the
// customer's browser still being open (Payment Links are paid asynchronously,
// often well after the customer has closed the tab).

import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const KEY_ID = Netlify.env.get("RAZORPAY_KEY_ID");
  const KEY_SECRET = Netlify.env.get("RAZORPAY_KEY_SECRET");

  if (!KEY_ID || !KEY_SECRET) {
    return new Response(JSON.stringify({ error: "Razorpay keys not configured" }), { status: 500 });
  }

  try {
    const body = await req.json();
    const amountPaise = Math.round((body.total || 0) * 100);

    if (amountPaise <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400 });
    }

    const itemsDesc = (body.itemsDescription || "Order from Onam Agarbathi").slice(0, 250);
    const referenceId = body.referenceId || ("WA-" + Date.now());

    const payload = {
      amount: amountPaise,
      currency: "INR",
      description: itemsDesc,
      reference_id: referenceId,
      customer: {
        name: body.customerName || "",
        contact: body.customerPhone ? ("+91" + body.customerPhone) : "",
        email: ""
      },
      notify: { sms: false, email: false }, // we send the link ourselves via WhatsApp
      reminder_enable: false,
      notes: {
        source: "website-whatsapp-checkout",
        items: itemsDesc
      }
    };

    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

    const r = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + auth
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    if (!r.ok) {
      return new Response(JSON.stringify({ error: data.error ? data.error.description : "Razorpay error" }), { status: 502 });
    }

    // Store the order details for the webhook to pick up once payment completes.
    // This is best-effort: if it fails, the payment link itself is still valid
    // and usable - we just won't be able to auto-log full GST detail later
    // (the webhook will fall back to a single generic line item in that case).
    try {
      const store = getStore("payment-link-orders");
      await store.setJSON(referenceId, {
        referenceId: referenceId,
        total: body.total,
        lineItems: body.lineItems || [],
        customerName: body.customerName || "",
        customerPhone: body.customerPhone || "",
        customerAddress: body.customerAddress || "",
        customerCity: body.customerCity || "",
        customerPin: body.customerPin || "",
        customerState: body.customerState || "",
        customerGstin: body.customerGstin || "",
        createdAt: new Date().toISOString()
      });
    } catch (blobErr) {
      // never block the payment link from being returned to the customer
      // over a storage hiccup - logging can degrade gracefully
    }

    return new Response(JSON.stringify({
      success: true,
      paymentLinkUrl: data.short_url,
      paymentLinkId: data.id,
      referenceId: referenceId
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/create-payment-link"
};
