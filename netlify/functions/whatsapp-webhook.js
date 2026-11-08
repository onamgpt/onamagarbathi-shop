// Receives inbound WhatsApp messages from Meta. Two jobs only:
//  1. GET — the one-time webhook verification handshake Meta requires when
//     you register this URL in the Meta Developer Console.
//  2. POST — reads incoming customer messages; if the text looks like an
//     opt-out ("stop", "unsubscribe", etc.), records it in Supabase so
//     future marketing sends (festival greetings, reorder nudges) skip this
//     number. Transactional order-status messages are NOT gated by this —
//     those are utility messages tied to an order the customer placed.
//
// Setup (one-time, in Meta Developer Console > WhatsApp > Configuration):
//   Callback URL:  https://onamagarbathi.com/.netlify/functions/whatsapp-webhook
//   Verify token:  whatever you set as WHATSAPP_WEBHOOK_VERIFY_TOKEN in Netlify


// ── Instant order reply ────────────────────────────────────────────────
// Someone asks "I want to order: Kesar Chandan…" / "price?" → reply within
// seconds with the pack photo, price and a one-tap link that puts it in the
// cart (/?add=id) so they can pay right away. Products are read from the live
// storefront, so prices here always match the website.
const SITE = "https://onamagarbathi.com";
let _cat = null, _catAt = 0;
async function catalog() {
  if (_cat && Date.now() - _catAt < 600000) return _cat;
  try {
    const html = await (await fetch(SITE + "/", { headers: { "User-Agent": "onam-wa-reply" } })).text();
    const m = html.match(/var PRODUCTS\s*=\s*(\[[\s\S]*?\}\]);/);
    _cat = m ? JSON.parse(m[1]) : []; _catAt = Date.now();
  } catch (e) { _cat = _cat || []; }
  return _cat;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function findProducts(list, text) {
  const t = " " + norm(text) + " ";
  const hits = list.filter((p) => p.mrp && t.indexOf(" " + norm(p.name) + " ") >= 0);
  // longest names first, so "Vaishak Special" wins over "Vaishak"
  hits.sort((a, b) => norm(b.name).length - norm(a.name).length);
  const out = [];
  hits.forEach((p) => { if (!out.some((o) => norm(o.name).indexOf(norm(p.name)) >= 0)) out.push(p); });
  return out.slice(0, 3);
}
// Token: the tracker's API Key Vault copy (known good) first, then Netlify env.
let _tok = null;
async function waToken() {
  if (_tok) return _tok;
  const SB = Netlify.env.get("SUPABASE_URL"), K = Netlify.env.get("SUPABASE_SERVICE_KEY");
  try {
    const r = await fetch(SB + "/rest/v1/app_secrets?name=eq.WHATSAPP_ACCESS_TOKEN&select=value", { headers: { apikey: K, Authorization: "Bearer " + K } });
    const j = await r.json(); if (j && j[0] && j[0].value) _tok = String(j[0].value).trim();
  } catch (e) {}
  return _tok || Netlify.env.get("WHATSAPP_ACCESS_TOKEN");
}
async function logHit(line) {
  const SB = Netlify.env.get("SUPABASE_URL"), K = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (!SB || !K) return;
  try {
    const h = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
    const j = await (await fetch(SB + "/rest/v1/kv?owner=eq.main&k=eq.wa_webhook_hits&select=v", { headers: h })).json();
    const cur = (Array.isArray(j) && j[0] && j[0].v && j[0].v.log) ? j[0].v.log : [];
    cur.push(new Date().toISOString() + "  " + line);
    await fetch(SB + "/rest/v1/kv?on_conflict=owner,k", { method: "POST", headers: Object.assign({}, h, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ owner: "main", k: "wa_webhook_hits", v: { log: cur.slice(-40) } }) });
  } catch (e) {}
}
const PHONE_ID = () => Netlify.env.get("WHATSAPP_PHONE_NUMBER_ID") || "1152842484587685";   // +91 83103 68142
async function waSend(to, payload) {
  const tok = await waToken();
  try {
    let r = await fetch("https://graph.facebook.com/v21.0/" + PHONE_ID() + "/messages", {
      method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ messaging_product: "whatsapp", to }, payload)) });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && PHONE_ID() !== "1152842484587685") {   // env phone id stale → use the known one
      r = await fetch("https://graph.facebook.com/v21.0/1152842484587685/messages", {
        method: "POST", headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ messaging_product: "whatsapp", to }, payload)) });
      j = await r.json().catch(() => ({}));
    }
    await logHit("reply to " + to + " " + (r.ok ? "sent" : "FAILED " + JSON.stringify(j.error || j).slice(0, 200)));
  } catch (e) { await logHit("reply to " + to + " ERROR " + String(e).slice(0, 150)); }
}
const OFFER = "\n🚚 Free delivery on every order\n🎁 Free perfume roll-on gift with your order";
async function orderReply(from, rawText) {
  const list = await catalog();
  const hits = findProducts(list, rawText);
  if (hits.length) {
    for (const p of hits) {
      const link = SITE + "/?add=" + encodeURIComponent(p.id);
      const cap = "*" + p.name + "* (" + p.brand + ")\n₹" + p.mrp + (p.packSize ? " · " + p.packSize : "") + " · ✅ In stock" + OFFER +
        "\n\n👉 Tap to buy in 1 minute (pay by UPI / card):\n" + link;
      const img = SITE + "/catalog-images/" + p.id + ".jpg";
      let hasImg = false; try { hasImg = (await fetch(img, { method: "HEAD" })).ok; } catch (e) {}
      await waSend(from, hasImg ? { type: "image", image: { link: img, caption: cap } } : { type: "text", text: { body: cap } });
    }
    return true;
  }
  const best = list.filter((p) => p.mrp && /vaishak-premium|kesar-chandan|golden-buddha|ganesh-flora/.test(p.id));
  await waSend(from, { type: "text", text: { body: "Namaste! 🙏 Thank you for your interest in Onam Agarbathi.\n\n" +
    best.map((p) => "• " + p.name + " – ₹" + p.mrp + "  👉 " + SITE + "/?add=" + p.id).join("\n") +
    "\n\nSee all fragrances: " + SITE + OFFER + "\n\nTell us which fragrance you like and we'll help." } });
  return true;
}

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const VERIFY_TOKEN = Netlify.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    // "onamreply2026" is the token typed into Meta's webhook settings (Nov 2026).
    // It only proves we own this URL during Meta's one-time check; not a credential.
    if (mode === "subscribe" && token && (token === VERIFY_TOKEN || token === "onamreply2026")) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
  const SUPABASE_KEY = Netlify.env.get("SUPABASE_SERVICE_KEY");

  // Log the raw POST before any parsing. Logging further down, inside the
  // message loop, meant a payload of an unexpected shape arrived and vanished
  // silently — indistinguishable from Meta never calling at all.
  let body;
  try {
    body = await req.json();
  } catch (e) {
    body = {};
  }
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const h0 = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                   "Content-Type": "application/json" };
      const r0 = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_webhook_hits&select=v", { headers: h0 });
      const j0 = await r0.json();
      const cur0 = (Array.isArray(j0) && j0[0] && j0[0].v && j0[0].v.log) ? j0[0].v.log : [];
      const v0 = ((body.entry || [])[0] || {});
      const c0 = ((v0.changes || [])[0] || {});
      cur0.push(new Date().toISOString() + "  field=" + (c0.field || "?") +
                "  keys=" + Object.keys(c0.value || {}).join("/") ||  "none");
      await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
        method: "POST",
        headers: Object.assign({}, h0, { "Prefer": "resolution=merge-duplicates" }),
        body: JSON.stringify({ owner: "main", k: "wa_webhook_hits", v: { log: cur0.slice(-40) } })
      });
    } catch (e) { /* never block the 200 back to Meta */ }
  }

  try {
    const entry = (body.entry && body.entry[0]) || {};
    const change = (entry.changes && entry.changes[0]) || {};
    const value = change.value || {};
    const messages = value.messages || [];

    for (const msg of messages) {
      const from = msg.from; // sender's WhatsApp number, no '+'
      const text = (msg.text && msg.text.body) ? msg.text.body.trim().toLowerCase() : "";
      let isFirstContact = false;

      // Log every call, before anything else can fail. Without this we cannot
      // tell "Meta never called us" from "Meta called and the write failed".
      if (SUPABASE_URL && SUPABASE_KEY) {
        try {
          const h2 = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                       "Content-Type": "application/json" };
          const rr = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_webhook_hits&select=v", { headers: h2 });
          const jj = await rr.json();
          const cur = (Array.isArray(jj) && jj[0] && jj[0].v && jj[0].v.log) ? jj[0].v.log : [];
          cur.push(new Date().toISOString() + "  from " + (msg.from || "?") + "  type " + (msg.type || "?"));
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: Object.assign({}, h2, { "Prefer": "resolution=merge-duplicates" }),
            body: JSON.stringify({ owner: "main", k: "wa_webhook_hits", v: { log: cur.slice(-40) } })
          });
        } catch (e) { /* never block the reply */ }
      }

      // Verification codes (e.g. when linking this number to Instagram / the
      // Facebook Page) arrive as WhatsApp messages here, since the SIM is not
      // in a phone. Keep the last 10 so Claude/Ravi can read them.
      const rawBody = (msg.text && msg.text.body) || "";
      if (/\b\d{3}[- ]?\d{3}\b/.test(rawBody) && /code|verif|confirm|otp/i.test(rawBody) && SUPABASE_URL && SUPABASE_KEY) {
        try {
          const hc = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
          const rc = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_codes&select=v", { headers: hc });
          const jc = await rc.json();
          const list = (Array.isArray(jc) && jc[0] && jc[0].v && jc[0].v.list) ? jc[0].v.list : [];
          list.push({ at: new Date().toISOString(), from, text: rawBody.slice(0, 300) });
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", { method: "POST",
            headers: Object.assign({}, hc, { "Prefer": "resolution=merge-duplicates" }),
            body: JSON.stringify({ owner: "main", k: "wa_codes", v: { list: list.slice(-10) } }) });
        } catch (e) {}
        continue;   // never auto-reply to a verification code
      }

      // Any inbound message opens a 24-hour window in which we may send free
      // text to that number. Record when, so the scheduler can tell whether a
      // plain message is allowed or whether it has to fall back to a template.
      if (from && SUPABASE_URL && SUPABASE_KEY) {
        try {
          const hdrs = {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json"
          };
          const r = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_last_inbound&select=v", { headers: hdrs });
          const j = await r.json();
          const seen = (Array.isArray(j) && j[0] && j[0].v) ? j[0].v : {};
          isFirstContact = !seen[from];
          seen[from] = new Date().toISOString();
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: Object.assign({}, hdrs, { "Prefer": "resolution=merge-duplicates" }),
            body: JSON.stringify({ owner: "main", k: "wa_last_inbound", v: seen })
          });
        } catch (e) { /* tracking must never block the reply below */ }
      }

      // Save every customer who writes to the Meta number (tracker → 👥 Customers).
      // Festival greetings go to this list; STOP marks them opted out.
      if (from && msg.type !== "unsupported" && SUPABASE_URL && SUPABASE_KEY && !/^44787613/.test(from)) {
        try {
          const hu = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
          const prof = ((value.contacts || []).find((c) => c.wa_id === from) || (value.contacts || [])[0] || {});
          const nm = (prof.profile && prof.profile.name) || null;
          const ex = await (await fetch(SUPABASE_URL + "/rest/v1/wa_customers?phone=eq." + from + "&select=msgs,asked,name", { headers: hu })).json();
          const cur = (Array.isArray(ex) && ex[0]) || null;
          let asked = (cur && cur.asked) || "";
          try { const hits = findProducts(await catalog(), (msg.text && msg.text.body) || "").map((p) => p.name);
            hits.forEach((n) => { if (asked.split(", ").indexOf(n) < 0) asked = asked ? asked + ", " + n : n; }); } catch (e) {}
          const row = { phone: from, last_at: new Date().toISOString(), msgs: ((cur && cur.msgs) || 0) + 1, asked: asked.slice(0, 300) };
          if (nm || !cur) row.name = nm || (cur && cur.name) || null;
          if (!cur) { row.first_at = row.last_at; row.source = "whatsapp"; }
          if (/^(stop|unsubscribe|opt.?out)\b/.test(text)) row.opted_out = true;
          if (/^(start|subscribe)\b/.test(text)) row.opted_out = false;
          await fetch(SUPABASE_URL + "/rest/v1/wa_customers?on_conflict=phone", { method: "POST",
            headers: Object.assign({}, hu, { "Prefer": "resolution=merge-duplicates" }), body: JSON.stringify(row) });
        } catch (e) { /* never block the reply */ }
      }

      // A number pressing the box's WhatsApp link and a number replying inside
      // an existing thread both land here with no distinction otherwise. Only
      // the box case should get a welcome - not every message in an ongoing
      // conversation, and not the opt-out path below.
      const isOptOut = /^(stop|unsubscribe|opt.?out|cancel)\b/.test(text);
      if (isOptOut) isFirstContact = false;

      if (isOptOut && from && SUPABASE_URL && SUPABASE_KEY) {
        // Normalise to a 10-digit Indian number to match how orders store phone,
        // since orders are saved without the country code in customer_phone.
        const local = from.replace(/^91/, "");
        const sbHeaders = {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json"
        };

        // Opt-outs live in the existing kv table as a single JSON object keyed
        // by phone — no dedicated table, same store the tracker already uses.
        try {
          const readRes = await fetch(SUPABASE_URL + "/rest/v1/kv?owner=eq.main&k=eq.wa_optouts&select=v", { headers: sbHeaders });
          const readJson = await readRes.json();
          const optouts = (Array.isArray(readJson) && readJson[0] && readJson[0].v) ? readJson[0].v : {};
          optouts[local] = new Date().toISOString();
          await fetch(SUPABASE_URL + "/rest/v1/kv?on_conflict=owner,k", {
            method: "POST",
            headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify({ owner: "main", k: "wa_optouts", v: optouts })
          });
        } catch (e) { /* best effort — never fail the webhook */ }

        // Confirm the opt-out back to the customer — required good practice,
        // and a plain-text reply is allowed since they just messaged us
        // (inside the 24h customer service window).
        {
          await waSend(from, {
              type: "text",
              text: { body: "You've been unsubscribed from promotional messages. You'll still receive order updates for anything you order. Thank you!" }
          });
        }
      } else if (from && /(want to order|price|rate|cost|available|availability|buy|order|how much|kitna|daam)/.test(text)) {
        await orderReply(from, (msg.text && msg.text.body) || "");
      } else if (isFirstContact && from && msg.type === "text") {
        // First message ever from this number and not an opt-out - almost
        // certainly someone who scanned the box QR code. Free text is
        // allowed here: they just messaged us, which opens the 24h window.
        {
          await waSend(from, {
              type: "text",
              text: { body: "Namaste! \ud83d\ude4f Welcome to Onam Agarbathi - incense since 1972. " +
                "Browse our products at onamagarbathi.com, or just tell us what you're looking for " +
                "and we'll help. Reply STOP anytime to opt out of promotional messages." }
          });
        }
      }
    }

    // Always 200 — Meta retries aggressively on non-2xx, and there is nothing
    // useful to retry here since we've already done the best-effort work.
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (e) {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
};

export const config = {
  path: "/.netlify/functions/whatsapp-webhook"
};
