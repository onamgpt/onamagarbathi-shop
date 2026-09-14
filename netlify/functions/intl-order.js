// International order requests.
//
// Nothing is charged here. A request is a statement of intent: the parcel is
// packed and weighed first, and only then is a payment link raised for goods
// plus the postage actually paid at the counter. That is the whole point —
// freight is never estimated into an invoice, so it can never be absorbed.
//
// Stored in Blobs and emailed. The email is best effort: a request must never
// be lost because Resend was down.

import { getStore } from "@netlify/blobs";

const STORE = "intl-orders";
const MIN_GRAMS = 900;

const clean = (s, max = 120) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, max);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  let store = null;
  try { store = getStore(STORE); } catch (e) { store = null; }

  // ── your list of requests ────────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("pin") !== (Netlify.env.get("EXPORT_ADMIN_PIN") || "")) {
      return new Response(JSON.stringify({ ok: false, error: "pin" }), { status: 401, headers: cors });
    }
    if (!store) return new Response(JSON.stringify({ ok: false, error: "store" }), { status: 200, headers: cors });
    const out = [];
    try {
      const { blobs } = await store.list({ prefix: "req/" });
      for (const b of blobs.sort((a, z) => (a.key < z.key ? 1 : -1)).slice(0, 200)) {
        const v = await store.get(b.key, { type: "json" });
        if (v) out.push(v);
      }
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "list" }), { status: 200, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true, count: out.length, requests: out }),
      { status: 200, headers: cors });
  }

  if (req.method !== "POST") return new Response("", { status: 405, headers: cors });

  let body = {};
  try { body = JSON.parse(await req.text() || "{}"); } catch (e) {}

  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 60) : [];
  const grams = lines.reduce((s, l) => s + (Number(l.grams) || 0) * (Number(l.qty) || 0), 0);
  const goods = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);

  // The floor is enforced here as well as in the page. A page can be edited
  // in a browser; this cannot.
  if (!lines.length) {
    return new Response(JSON.stringify({ ok: false, error: "Add at least one item" }), { status: 200, headers: cors });
  }
  if (grams < MIN_GRAMS) {
    return new Response(JSON.stringify({ ok: false, error: "Minimum order is " + MIN_GRAMS + "g" }), { status: 200, headers: cors });
  }
  const c = body.customer || {};
  for (const f of ["name", "email", "address", "city", "country"]) {
    if (!clean(c[f])) {
      return new Response(JSON.stringify({ ok: false, error: "Missing " + f }), { status: 200, headers: cors });
    }
  }

  const now = new Date();
  const ref = "INT-" + now.toISOString().slice(2, 10).replace(/-/g, "") + "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  const rec = {
    ref, at: now.toISOString(), status: "new",
    customer: {
      name: clean(c.name), email: clean(c.email, 120), phone: clean(c.phone, 30),
      address: clean(c.address, 300), city: clean(c.city), postcode: clean(c.postcode, 20),
      country: clean(c.country, 60),
    },
    lines: lines.map((l) => ({
      id: clean(l.id, 60), name: clean(l.name, 80),
      qty: Number(l.qty) || 0, grams: Number(l.grams) || 0, price: Number(l.price) || 0,
    })),
    goodsTotal: goods, estGrams: grams, note: clean(body.note, 400),
  };

  let stored = false;
  if (store) {
    try { await store.set("req/" + now.getTime() + "-" + ref, JSON.stringify(rec)); stored = true; } catch (e) {}
  }

  // ── notify ───────────────────────────────────────────────────────────────
  const KEY = Netlify.env.get("RESEND_API_KEY");
  const FROM = Netlify.env.get("MAIL_FROM");
  const TO = Netlify.env.get("MAIL_TO");
  let mailed = false;
  if (KEY && FROM && TO) {
    const rows = rec.lines.map((l) =>
      `<tr><td>${esc(l.name)}</td><td align="right">${l.qty}</td>` +
      `<td align="right">${l.grams * l.qty}g</td>` +
      `<td align="right">Rs.${(l.price * l.qty).toFixed(0)}</td></tr>`).join("");
    const html =
      `<h3>International request ${esc(ref)}</h3>` +
      `<p><b>${esc(rec.customer.name)}</b> — ${esc(rec.customer.country)}<br>` +
      `${esc(rec.customer.email)} ${rec.customer.phone ? "· " + esc(rec.customer.phone) : ""}</p>` +
      `<p>${esc(rec.customer.address)}<br>${esc(rec.customer.city)} ${esc(rec.customer.postcode)}<br>` +
      `${esc(rec.customer.country)}</p>` +
      `<table border="1" cellpadding="6" cellspacing="0">` +
      `<tr><th align="left">Item</th><th>Qty</th><th>Weight</th><th>Value</th></tr>${rows}` +
      `<tr><td colspan="2"><b>Total</b></td><td align="right"><b>${grams}g</b></td>` +
      `<td align="right"><b>Rs.${goods.toFixed(0)}</b></td></tr></table>` +
      (rec.note ? `<p><b>Note:</b> ${esc(rec.note)}</p>` : "") +
      `<p style="color:#666">Goods weight only — add packing before booking. ` +
      `Weigh the packed parcel, book EMS, then send a payment link for goods plus actual postage.</p>`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: String(TO).split(",").map((s) => s.trim()).filter(Boolean),
          subject: "International request " + ref + " — " + rec.customer.country + " — " + grams + "g",
          html,
        }),
      });
      mailed = r.status >= 200 && r.status < 300;
    } catch (e) {}
  }

  return new Response(JSON.stringify({ ok: true, ref, stored, mailed, grams, goodsTotal: goods }),
    { status: 200, headers: cors });
};

export const config = { path: "/.netlify/functions/intl-order" };
