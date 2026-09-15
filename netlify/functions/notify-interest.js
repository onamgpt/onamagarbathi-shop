// "Tell me when it's available" capture.
//
// Every scan that lands on a coming-soon page is someone holding the physical
// box, wanting to buy. Without capture that intent evaporates. With it, launch
// day opens against a warm list instead of cold traffic.
//
// Only the contact the person typed is stored -- no IP, no device, nothing
// derived. GET (PIN-protected) returns the list for export.

import { getStore } from "@netlify/blobs";

const STORE = "notify-interest";
const clean = (s, max = 120) => String(s || "").trim().slice(0, max);

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  let store;
  try { store = getStore(STORE); }
  catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: cors });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("pin") !== (Netlify.env.get("EXPORT_ADMIN_PIN") || "")) {
      return new Response(JSON.stringify({ ok: false, error: "pin" }), { status: 401, headers: cors });
    }
    const out = [];
    try {
      const { blobs } = await store.list({ prefix: "lead/" });
      for (const b of blobs) {
        const raw = await store.get(b.key);
        if (raw) { try { out.push(JSON.parse(raw)); } catch (e) {} }
      }
    } catch (e) {}
    out.sort((a, b) => String(b.t).localeCompare(String(a.t)));
    return new Response(JSON.stringify({ ok: true, count: out.length, leads: out }), {
      status: 200, headers: cors,
    });
  }

  if (req.method !== "POST") return new Response("", { status: 405, headers: cors });

  let body = {};
  try { body = await req.json(); } catch (e) {}
  const contact = clean(body.contact);
  // Loose on purpose: a phone, an email, either is fine. Rejecting a real
  // customer over a format quibble is worse than storing one odd row.
  if (contact.length < 6) {
    return new Response(JSON.stringify({ ok: false, error: "contact" }), { status: 400, headers: cors });
  }
  const now = new Date();
  const key = "lead/" + now.toISOString().slice(0, 10) + "/" +
    now.getTime() + "-" + Math.random().toString(36).slice(2, 8);
  try {
    await store.set(key, JSON.stringify({
      t: now.toISOString(),
      contact,
      product: clean(body.product, 60) || "vamana-100",
      src: clean(body.src, 32) || "box",
    }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: cors });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
};

export const config = { path: "/.netlify/functions/notify-interest" };
