// Availability switch for a single product page.
//
// A QR printed on a box is permanent; stock is not. The box ships before the
// product is orderable online, so the page it points at has to be able to say
// "available shortly" today and "buy now" next month WITHOUT a code push --
// otherwise every stock change waits on a developer.
//
// Status lives in Netlify Blobs, not in the HTML. GET is public (the page
// reads it on load). POST requires the admin PIN, the same one the export
// portal already uses, so there is one credential to remember rather than two.

import { getStore } from "@netlify/blobs";

const STORE = "product-status";
const ALLOWED = ["coming_soon", "live"];
const clean = (s, max = 40) =>
  String(s || "").replace(/[^A-Za-z0-9_\-]/g, "").trim().slice(0, max);

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  let store;
  try {
    store = getStore(STORE);
  } catch (e) {
    // Blobs unavailable: fail CLOSED to coming_soon. Showing "available
    // shortly" when stock exists costs one order; showing "buy now" when
    // there is no stock costs a customer.
    return new Response(JSON.stringify({ ok: false, status: "coming_soon" }), { status: 200, headers: cors });
  }

  const url = new URL(req.url);
  const id = clean(url.searchParams.get("id")) || "vamana-100";

  if (req.method === "GET") {
    let status = "coming_soon";
    try {
      const v = await store.get("status/" + id);
      if (v && ALLOWED.includes(v)) status = v;
    } catch (e) {}
    return new Response(JSON.stringify({ ok: true, id, status }), {
      status: 200,
      headers: { ...cors, "Cache-Control": "public, max-age=60" },
    });
  }

  if (req.method !== "POST") return new Response("", { status: 405, headers: cors });

  let body = {};
  try { body = await req.json(); } catch (e) {}

  const pin = Netlify.env.get("EXPORT_ADMIN_PIN") || "";
  if (!pin || String(body.pin || "") !== pin) {
    return new Response(JSON.stringify({ ok: false, error: "pin" }), { status: 401, headers: cors });
  }
  const status = clean(body.status);
  if (!ALLOWED.includes(status)) {
    return new Response(JSON.stringify({ ok: false, error: "status" }), { status: 400, headers: cors });
  }
  // Precedence matters here: ("status/" + id) is always truthy, so the id must
  // be defaulted BEFORE it is concatenated, not after.
  const wid = clean(body.id) || "vamana-100";
  try {
    await store.set("status/" + wid, status);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "write" }), { status: 200, headers: cors });
  }
  return new Response(JSON.stringify({ ok: true, id: wid, status }), {
    status: 200, headers: cors,
  });
};

export const config = { path: "/.netlify/functions/product-status" };
