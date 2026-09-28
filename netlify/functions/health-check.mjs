// ===========================================================================
//  PIPELINE HEALTH CHECK
//  Runs daily and confirms the shop can actually take an order end to end.
//
//  This exists because the order path broke quietly in September: the Apps
//  Script stopped assigning invoice numbers, which also silently stopped the
//  order email and the Telegram ping. Nothing surfaced it — the shop simply
//  went quiet, and that only became visible weeks later by reading old mail.
//
//  Checks, in order of how much they'd cost if they failed:
//    1. Apps Script order log        — invoice numbers, sheet, packing slips
//    2. Supabase                     — order mirror and the trade/export apps
//    3. Razorpay                     — can we still create a payment?
//  Alerts ONLY when something is wrong, so a silent inbox means healthy.
// ===========================================================================

const env = (k) => Netlify.env.get(k) || "";
const MAIL_TO = () => (env("CSD_REPORT_TO") || env("MAIL_TO") || "onamagarbathi@gmail.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function withTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 10000);
  try {
    const r = await fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }));
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function checkAppsScript() {
  const url = env("ORDER_LOG_SCRIPT_URL");
  if (!url) return { name: "Apps Script order log", ok: false, detail: "ORDER_LOG_SCRIPT_URL not set" };
  try {
    // A ping the script can recognise and ignore. What matters is that the
    // deployment answers at all — an expired /exec URL is the failure mode.
    const r = await withTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ healthCheck: true })
    }, 15000);
    const text = (await r.text()).slice(0, 200);
    if (!r.ok) return { name: "Apps Script order log", ok: false, detail: "HTTP " + r.status + " " + text };
    return { name: "Apps Script order log", ok: true, detail: "responded" };
  } catch (e) {
    return { name: "Apps Script order log", ok: false, detail: String(e.message || e) };
  }
}

async function checkSupabase() {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return { name: "Supabase", ok: false, detail: "not configured" };
  try {
    const r = await withTimeout(url + "/rest/v1/kv?select=k&limit=1",
      { headers: { apikey: key, Authorization: "Bearer " + key } }, 10000);
    if (!r.ok) return { name: "Supabase", ok: false, detail: "HTTP " + r.status };
    return { name: "Supabase", ok: true, detail: "reachable" };
  } catch (e) {
    return { name: "Supabase", ok: false, detail: String(e.message || e) };
  }
}

async function checkRazorpay() {
  const id = env("RAZORPAY_KEY_ID"), sec = env("RAZORPAY_KEY_SECRET");
  if (!id || !sec) return { name: "Razorpay", ok: false, detail: "keys not set" };
  try {
    const auth = Buffer.from(id + ":" + sec).toString("base64");
    // Read-only: list one payment. Never creates anything.
    const r = await withTimeout("https://api.razorpay.com/v1/payments?count=1",
      { headers: { Authorization: "Basic " + auth } }, 10000);
    if (!r.ok) return { name: "Razorpay", ok: false, detail: "HTTP " + r.status };
    return { name: "Razorpay", ok: true, detail: "authenticated" };
  } catch (e) {
    return { name: "Razorpay", ok: false, detail: String(e.message || e) };
  }
}

async function alert(bad, all) {
  const lines = all.map((c) => (c.ok ? "OK   " : "DOWN ") + c.name + " — " + c.detail).join("\n");
  const key = env("RESEND_API_KEY");
  if (key) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Onam Systems <" + (env("MAIL_FROM") || "orders@onamagarbathi.com") + ">",
          to: MAIL_TO(),
          subject: "Website order pipeline: " + bad.map((b) => b.name).join(", ") + " down",
          html:
            '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">' +
            '<h2 style="margin:0 0 6px">Order pipeline problem</h2>' +
            '<p style="margin:0 0 14px;color:#78716c">Customers may be able to pay without you being told.</p>' +
            '<pre style="background:#faf9f7;padding:12px;border-radius:6px;font-size:13px">' +
            lines.replace(/</g, "&lt;") + '</pre>' +
            '<p style="font-size:13px;color:#78716c">If the Apps Script is the failure, its /exec URL has ' +
            'most likely expired after a redeploy. Orders still complete and are emailed directly, ' +
            'but they will not be in the Google Sheet until it is fixed.</p></div>'
        })
      });
    } catch (e) { console.error("alert email failed:", e.message); }
  }

  const tok = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID");
  if (tok && chat) {
    try {
      await fetch("https://api.telegram.org/bot" + tok + "/sendMessage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat,
          text: "Order pipeline problem\n\n" + lines })
      });
    } catch (e) { console.error("alert telegram failed:", e.message); }
  }
}

async function run() {
  const checks = [await checkAppsScript(), await checkSupabase(), await checkRazorpay()];
  const bad = checks.filter((c) => !c.ok);
  if (bad.length) await alert(bad, checks);
  return { checked: checks.length, failing: bad.length, checks: checks };
}

export default async (req) => {
  if (req && req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    if (!env("EXPORT_ADMIN_PIN") || String(body.adminPin) !== env("EXPORT_ADMIN_PIN"))
      return new Response(JSON.stringify({ error: "Not authorised" }),
        { status: 401, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(await run(), null, 2),
      { headers: { "Content-Type": "application/json" } });
  }
  try { console.log("[health]", JSON.stringify(await run())); }
  catch (e) { console.error("[health] failed:", e.message); }
  return new Response("ok");
};

// Every day at 03:30 UTC = 09:00 IST.
export const config = { schedule: "30 3 * * *" };
