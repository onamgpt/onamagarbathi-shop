// Razorpay webhook handler - receives server-to-server notifications when
// a Payment Link is paid, completely independent of whether the customer's
// browser/WhatsApp session is still open. This is what gives "full coverage"
// for GST logging on the WhatsApp/proforma checkout path, matching what the
// main on-site checkout already gets via the synchronous Razorpay handler.
//
// SECURITY: every request is verified against RAZORPAY_WEBHOOK_SECRET using
// HMAC-SHA256, per Razorpay's documented signature scheme. Requests with a
// missing or invalid signature are rejected outright - this prevents anyone
// from POSTing fake "payment successful" events to this public endpoint.

import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const WEBHOOK_SECRET = Netlify.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!WEBHOOK_SECRET) {
    // Fail closed - never process unverifiable webhooks.
    return new Response("Webhook secret not configured", { status: 500 });
  }

  // IMPORTANT: signature must be verified against the RAW request body,
  // exactly as Razorpay sent it - parsing to JSON first and re-serializing
  // would change whitespace/key order and break the signature check.
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // Constant-time comparison to avoid timing attacks.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  const validSignature = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!validSignature) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only act on a fully-paid Payment Link. partially_paid is intentionally
  // ignored here since GST logging for a partial payment needs separate
  // handling and that flow isn't enabled on this site's payment links
  // (accept_partial is not set, so this should not normally occur).
  if (event.event !== "payment_link.paid") {
    return new Response("Event ignored", { status: 200 });
  }

  // De-duplication: Razorpay may send the same event more than once.
  // Use the dedicated event-id store, keyed by x-razorpay-event-id, and
  // skip processing if we've already handled this exact event.
  const eventId = req.headers.get("x-razorpay-event-id");
  const dedupeStore = getStore("processed-webhook-events");
  if (eventId) {
    const alreadyProcessed = await dedupeStore.get(eventId);
    if (alreadyProcessed) {
      return new Response("Already processed", { status: 200 });
    }
  }

  try {
    const paymentLink = event.payload.payment_link.entity;
    const payment = event.payload.payment.entity;
    const referenceId = paymentLink.reference_id;
    const paymentId = payment.id;
    const amountPaid = paymentLink.amount_paid / 100; // paise -> rupees

    // Retrieve the original cart/GST/customer data stored when the link
    // was created. If this lookup fails (e.g. very old link, or storage
    // hiccup at creation time), we still log a best-effort single-line entry
    // rather than silently dropping the order from GST records entirely.
    const orderStore = getStore("payment-link-orders");
    const storedOrder = await orderStore.get(referenceId, { type: "json" });

    let lineItems;
    let customerDetails;

    if (storedOrder && storedOrder.lineItems && storedOrder.lineItems.length > 0) {
      lineItems = storedOrder.lineItems;
      customerDetails = storedOrder;
    } else {
      // Fallback: reconstruct a single generic GST line item from the
      // webhook's own amount, assuming the standard 5% rate used across
      // this catalog, so the order is never silently missing from GST logs
      // even if the original cart detail could not be retrieved.
      const gstRate = 5;
      const taxableValue = amountPaid / (1 + gstRate / 100);
      const gstAmount = amountPaid - taxableValue;
      lineItems = [{
        name: paymentLink.description || "WhatsApp order (detail unavailable)",
        hsn: "33074100",
        qty: 1,
        mrpPerUnit: amountPaid,
        lineTotal: Math.round(amountPaid * 100) / 100,
        taxableValue: Math.round(taxableValue * 100) / 100,
        gstRate: gstRate,
        gstAmount: Math.round(gstAmount * 100) / 100
      }];
      customerDetails = {
        customerName: paymentLink.customer ? paymentLink.customer.name : "",
        customerPhone: paymentLink.customer ? (paymentLink.customer.contact || "").replace(/^\+91/, "") : "",
        customerAddress: "", customerCity: "", customerPin: "", customerState: "", customerGstin: ""
      };
    }

    const ORDER_LOG_SCRIPT_URL = Netlify.env.get("ORDER_LOG_SCRIPT_URL");
    if (ORDER_LOG_SCRIPT_URL) {
      const totalTaxable = lineItems.reduce((s, i) => s + i.taxableValue, 0);
      const totalGst = lineItems.reduce((s, i) => s + i.gstAmount, 0);

      await fetch(ORDER_LOG_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: referenceId,
          paymentId: paymentId,
          date: new Date().toISOString(),
          customerName: customerDetails.customerName || "",
          customerPhone: customerDetails.customerPhone || "",
          customerAddress: customerDetails.customerAddress || "",
          customerCity: customerDetails.customerCity || "",
          customerPin: customerDetails.customerPin || "",
          customerState: customerDetails.customerState || "",
          customerGstin: customerDetails.customerGstin || "",
          items: lineItems,
          totalTaxableValue: Math.round(totalTaxable * 100) / 100,
          totalGst: Math.round(totalGst * 100) / 100,
          grandTotal: amountPaid
        })
      }).catch(() => {}); // GST logging failure should not fail the webhook ack
    }

    // Mark this event as processed (24h is more than enough given Razorpay's
    // documented retry window for failed webhook deliveries).
    if (eventId) {
      await dedupeStore.set(eventId, "1");
    }

    // Best-effort Telegram notification so payment confirmations from this
    // path are visible the same way other tracker/order events already are.
    const BOT_TOKEN = Netlify.env.get("TELEGRAM_BOT_TOKEN");
    const CHAT_ID = Netlify.env.get("TELEGRAM_CHAT_ID");
    if (BOT_TOKEN && CHAT_ID) {
      const msg = `\u2705 WhatsApp order PAID\n\nRef: ${referenceId}\nPayment ID: ${paymentId}\nAmount: Rs.${amountPaid}\nCustomer: ${customerDetails.customerName || "N/A"}`;
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    // Razorpay retries on non-2xx responses, so a genuine processing error
    // here will be retried automatically per Razorpay's exponential backoff.
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/razorpay-webhook"
};
