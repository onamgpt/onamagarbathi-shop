// Creates a Razorpay Payment Link for a WhatsApp checkout order.
// Runs server-side ONLY - this is the one place the Key Secret is used,
// since it must never be exposed in browser-visible code.

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
