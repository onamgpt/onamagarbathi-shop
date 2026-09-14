// Where are the QR codes actually being scanned?
//
// A QR carries no location. The only signal available is the IP the request
// arrives on, which Netlify resolves to a country/state for us. That is an
// approximate area, never a person and never an address — nothing here is
// joined to identity, and no IP is stored.
//
// Mobile carriers route through regional gateways, so CITY is unreliable
// (a scan in Kannur can report as Kochi). STATE is broadly trustworthy, so
// state is what this records and reports.
//
// Storage trick: the state is part of the blob KEY, not the body. Counting by
// state is then a key listing with no reads at all, which keeps the report
// cheap however many scans accumulate.

import { getStore } from "@netlify/blobs";

const STORE = "scan-log";
const clean = (s, max = 40) =>
  String(s || "").replace(/[^A-Za-z0-9 _.\-]/g, "").trim().slice(0, max);

export default async (req, context) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

  let store;
  try {
    store = getStore(STORE);
  } catch (e) {
    // Blobs unavailable: never let this break the page it is called from.
    return new Response(JSON.stringify({ ok: false, error: "store" }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── report ────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("pin") !== (Netlify.env.get("EXPORT_ADMIN_PIN") || "")) {
      return new Response(JSON.stringify({ ok: false, error: "pin" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const days = Math.min(parseInt(url.searchParams.get("days") || "30", 10) || 30, 365);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const byState = {}, byTag = {}, byDay = {};
    let total = 0;
    try {
      const { blobs } = await store.list({ prefix: "scan/" });
      for (const b of blobs) {
        // scan/<date>/<country>/<state>/<tag>/<id>
        const p = b.key.split("/");
        if (p.length < 6) continue;
        const [, date, country, state, tag] = p;
        if (date < since) continue;
        total++;
        const where = country === "IN" ? state : country + " · " + state;
        byState[where] = (byState[where] || 0) + 1;
        byTag[tag] = (byTag[tag] || 0) + 1;
        byDay[date] = (byDay[date] || 0) + 1;
      }
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "list" }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const sort = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    return new Response(JSON.stringify({
      ok: true, days, total,
      states: sort(byState), tags: sort(byTag),
      daily: Object.entries(byDay).sort(),
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── record ────────────────────────────────────────────────────────────────
  if (req.method !== "POST") return new Response("", { status: 405, headers: cors });

  let body = {};
  try { body = await req.json(); } catch (e) {}

  const geo = context.geo || {};
  const country = clean(geo.country?.code || "XX", 4) || "XX";
  // subdivision is the state/province; unknown resolves to "Unknown" rather
  // than being dropped, so the totals still add up.
  const state = clean(geo.subdivision?.name || geo.subdivision?.code || "Unknown", 40) || "Unknown";
  const tag = clean(body.src, 32) || "untagged";

  const now = new Date();
  const key = [
    "scan", now.toISOString().slice(0, 10), country, state, tag,
    now.getTime() + "-" + Math.random().toString(36).slice(2, 8),
  ].join("/");

  try {
    await store.set(key, JSON.stringify({
      t: now.toISOString(),
      src: tag,
      campaign: clean(body.campaign, 40),
      product: clean(body.product, 60),
      country, state,
    }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
};

export const config = { path: "/.netlify/functions/scan-log" };
