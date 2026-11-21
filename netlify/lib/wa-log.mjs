// Records every customer WhatsApp template send in Supabase (table wa_send_log)
// with Meta's real reply, and WhatsApps Ravi when one fails — so a customer
// never silently misses an order confirmation again (21 Nov 2026).
//
// Alerts go through the office-number queue (wa_outbox). Sunday rest still
// applies there (the DB trigger holds non-reply messages on Sundays); the
// failure is always kept in wa_send_log either way.

const RAVI_JID = "919845563633@c.us";

const sbHeaders = (key, extra) => Object.assign({
  apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json"
}, extra || {});

function env(name) {
  try { if (typeof Netlify !== "undefined" && Netlify.env) { const v = Netlify.env.get(name); if (v) return v; } } catch (e) {}
  return process.env[name];
}

export function metaError(j) {
  if (!j) return "no reply from Meta";
  if (j.error) {
    const e = j.error;
    return [e.message, e.error_data && e.error_data.details, e.code ? "code " + e.code : ""].filter(Boolean).join(" — ");
  }
  return j.messages ? "" : "unexpected reply: " + JSON.stringify(j).slice(0, 200);
}

async function outbox(rows) {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return;
  await fetch(url + "/rest/v1/wa_outbox", { method: "POST", headers: sbHeaders(key, { Prefer: "return=minimal" }), body: JSON.stringify(rows) });
}

export async function alertRavi(text) {
  try { await outbox([{ to_jid: RAVI_JID, body: String(text).slice(0, 3800), kind: "alert" }]); } catch (e) {}
}

// rec: { to, template, orderId, source, reply (Meta JSON), error (string),
//        customerName, fallbackText (sent from the office number if Meta failed) }
export async function logSend(rec) {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_KEY");
  const err = rec.error || metaError(rec.reply);
  const ok = !err;
  const wamid = rec.reply && rec.reply.messages && rec.reply.messages[0] && rec.reply.messages[0].id;
  let fallback = null;
  if (!ok && rec.fallbackText && rec.to) {
    try {
      let d = String(rec.to).replace(/\D/g, ""); if (d.length === 10) d = "91" + d;
      await outbox([{ to_jid: d + "@c.us", body: rec.fallbackText.slice(0, 3800), kind: "web" }]);
      fallback = "office number";
    } catch (e) { fallback = "office send failed"; }
  }
  if (url && key) {
    try {
      await fetch(url + "/rest/v1/wa_send_log", { method: "POST", headers: sbHeaders(key, { Prefer: "return=minimal" }),
        body: JSON.stringify([{ to_phone: String(rec.to || ""), template: rec.template || null, order_id: rec.orderId || null,
          source: rec.source || null, ok, wamid: wamid || null, error: err || null, status: ok ? "accepted" : "failed", fallback }]) });
    } catch (e) {}
  }
  if (!ok) {
    await alertRavi("⚠️ WhatsApp to customer FAILED\n" +
      "Customer: " + (rec.customerName || "") + " (" + (rec.to || "no phone") + ")\n" +
      "Order: " + (rec.orderId || "-") + "\nMessage: " + (rec.template || "-") + "\n" +
      "Reason: " + err + "\n" +
      (fallback === "office number" ? "Sent instead from the office number 91804 57950." : "Please message the customer yourself."));
  }
  return { ok, wamid, error: err, fallback };
}

// Meta delivery callbacks (sent / delivered / read / failed) → update the log row;
// a "failed" callback also alerts Ravi.
export async function recordStatuses(statuses) {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_KEY");
  if (!url || !key || !Array.isArray(statuses)) return;
  for (const s of statuses) {
    if (!s || !s.id) continue;
    try {
      const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
      const errTxt = (s.errors || []).map((e) => [e.title, e.message, e.error_data && e.error_data.details, e.code ? "code " + e.code : ""].filter(Boolean).join(" — ")).join("; ");
      const patch = { status: s.status, status_at: at };
      if (s.status === "failed") { patch.ok = false; patch.error = errTxt || "failed"; }
      const r = await fetch(url + "/rest/v1/wa_send_log?wamid=eq." + encodeURIComponent(s.id), {
        method: "PATCH", headers: sbHeaders(key, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
      const rows = await r.json().catch(() => []);
      if (s.status === "failed") {
        const row = (Array.isArray(rows) && rows[0]) || {};
        await alertRavi("⚠️ WhatsApp NOT delivered to customer\n" +
          "Number: " + (row.to_phone || s.recipient_id || "?") + "\nOrder: " + (row.order_id || "-") +
          "\nMessage: " + (row.template || "-") + "\nReason: " + (errTxt || "failed") + "\nPlease message the customer yourself.");
      }
    } catch (e) {}
  }
}
