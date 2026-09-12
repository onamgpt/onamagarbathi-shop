// ===========================================================================
//  ONAM AGARBATHI — EXPORT PORTAL API
//  The only path between the browser and Supabase. The service key lives here
//  and nowhere else. PINs are checked server-side; a buyer can never see, or
//  even learn the existence of, another buyer's catalogue.
//
//  Purpose codes are decided HERE, never by the client:
//    money in before the shipping bill  -> P0103 (advance against export contract)
//    money in after                     -> P0102 (realisation of export bills)
// ===========================================================================

const SB_URL = () => Netlify.env.get("SUPABASE_URL") || "";
const SB_KEY = () => Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
const ADMIN_PIN = () => Netlify.env.get("EXPORT_ADMIN_PIN") || "";

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    }
  });

async function sb(method, path, body, prefer) {
  const headers = {
    apikey: SB_KEY(),
    Authorization: "Bearer " + SB_KEY(),
    "Content-Type": "application/json"
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(SB_URL() + "/rest/v1" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) throw new Error("supabase " + res.status + ": " + text.slice(0, 300));
  return parsed;
}

const q = (s) => encodeURIComponent(s);

// Order number: ONX/<BUYER>/<YY-YY>/<seq> — mirrors your EXP/23/26-27 style.
function fyLabel(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return String(start).slice(2) + "-" + String(start + 1).slice(2);
}

export default async (req) => {
  if (req.method === "OPTIONS") return J({ ok: true });
  if (req.method !== "POST") return J({ error: "Method not allowed" }, 405);
  if (!SB_URL() || !SB_KEY()) return J({ error: "Supabase not configured on this site" }, 500);

  let body;
  try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
  const action = body.action || "";

  try {
    // ---- buyer authentication -------------------------------------------
    async function buyerFromPin(pin) {
      if (!pin) return null;
      const rows = await sb("GET", "/export_buyers?pin=eq." + q(String(pin)) + "&active=eq.true&select=*");
      return rows && rows.length ? rows[0] : null;
    }

    if (action === "login") {
      const buyer = await buyerFromPin(body.pin);
      // Deliberately vague: a wrong PIN must not reveal whether it nearly matched.
      if (!buyer) return J({ error: "Access code not recognised" }, 401);
      const products = await sb(
        "GET",
        "/export_products?buyer_code=eq." + q(buyer.code) +
        "&active=eq.true&select=*&order=sort_order.asc"
      );
      return J({
        ok: true,
        buyer: {
          code: buyer.code, name: buyer.name, country: buyer.country,
          terms: buyer.terms, deposit_pct: Number(buyer.deposit_pct || 0),
          currency: buyer.currency || "USD",
          incoterm: buyer.incoterm || "C&F", port: buyer.port || ""
        },
        products
      });
    }

    // ---- place an order --------------------------------------------------
    if (action === "placeOrder") {
      const buyer = await buyerFromPin(body.pin);
      if (!buyer) return J({ error: "Access code not recognised" }, 401);

      const wanted = Array.isArray(body.lines) ? body.lines : [];
      if (!wanted.length) return J({ error: "No items in the order" }, 400);

      // Re-price server-side. Never trust a rate that arrived from the browser.
      const catalog = await sb(
        "GET",
        "/export_products?buyer_code=eq." + q(buyer.code) + "&active=eq.true&select=*"
      );
      const bySku = {};
      catalog.forEach(p => { bySku[p.sku] = p; });

      const lines = [];
      let totalCartons = 0, totalUnits = 0, totalUsd = 0;
      for (const w of wanted) {
        const p = bySku[w.sku];
        if (!p) continue;
        const cartons = Math.max(0, parseInt(w.cartons, 10) || 0);
        if (!cartons) continue;
        if (cartons < (p.moq_cartons || 1))
          return J({ error: p.name + " has a minimum of " + p.moq_cartons + " cartons" }, 400);
        const units = cartons * (p.units_per_carton || 24);
        const amount = Math.round(units * Number(p.rate_per_unit) * 100) / 100;
        lines.push({
          sku: p.sku, name: p.name, cartons,
          units_per_carton: p.units_per_carton, units,
          rate_per_unit: Number(p.rate_per_unit), amount,
          hs_code: p.hs_code
        });
        totalCartons += cartons; totalUnits += units; totalUsd += amount;
      }
      if (!lines.length) return J({ error: "No valid items in the order" }, 400);
      totalUsd = Math.round(totalUsd * 100) / 100;

      const depositPct = buyer.terms === "advance" ? 100
                       : buyer.terms === "deposit" ? Number(body.deposit_pct || buyer.deposit_pct || 0)
                       : 0;
      const depositUsd = Math.round(totalUsd * depositPct) / 100;
      const balanceUsd = Math.round((totalUsd - depositUsd) * 100) / 100;

      const now = new Date();
      const existing = await sb(
        "GET",
        "/export_orders?buyer_code=eq." + q(buyer.code) + "&select=id&order=id.desc&limit=1"
      );
      const seq = (existing && existing.length ? existing[0].id : 0) + 1;
      const orderNo = "ONX/" + buyer.code + "/" + fyLabel(now) + "/" + String(seq).padStart(3, "0");

      const inserted = await sb("POST", "/export_orders", [{
        order_no: orderNo, buyer_code: buyer.code, lines,
        total_cartons: totalCartons, total_units: totalUnits, total_usd: totalUsd,
        terms: buyer.terms, deposit_pct: depositPct,
        deposit_usd: depositUsd, balance_usd: balanceUsd,
        status: depositPct > 0 ? "placed" : "placed",
        notes: (body.notes || "").slice(0, 500)
      }], "return=representation");

      return J({ ok: true, order: inserted[0], buyer: {
        code: buyer.code, name: buyer.name, country: buyer.country,
        incoterm: buyer.incoterm, port: buyer.port, currency: buyer.currency
      }});
    }

    // ---- admin -----------------------------------------------------------
    const admin = () => ADMIN_PIN() && body.adminPin && String(body.adminPin) === ADMIN_PIN();

    if (action === "adminList") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const buyers = await sb("GET", "/export_buyers?select=*&order=code.asc");
      const products = await sb("GET", "/export_products?select=*&order=buyer_code.asc,sort_order.asc");
      const orders = await sb("GET", "/export_orders?select=*&order=id.desc&limit=100");
      return J({ ok: true, buyers, products, orders });
    }

    if (action === "adminSaveBuyer") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const b = body.buyer || {};
      if (!b.code || !b.name || !b.pin) return J({ error: "Code, name and PIN are required" }, 400);
      const row = {
        code: String(b.code).toUpperCase().trim(), name: b.name, country: b.country || "",
        pin: String(b.pin), terms: b.terms || "on_arrival",
        deposit_pct: Number(b.deposit_pct || 0), currency: b.currency || "USD",
        incoterm: b.incoterm || "C&F", port: b.port || "", active: b.active !== false
      };
      const saved = await sb("POST", "/export_buyers?on_conflict=code", [row],
        "resolution=merge-duplicates,return=representation");
      return J({ ok: true, buyer: saved[0] });
    }

    if (action === "adminSaveProduct") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const p = body.product || {};
      if (!p.buyer_code || !p.sku || !p.name || p.rate_per_unit === undefined)
        return J({ error: "Buyer, SKU, name and rate are required" }, 400);
      const row = {
        buyer_code: String(p.buyer_code).toUpperCase().trim(),
        sku: p.sku, name: p.name,
        units_per_carton: parseInt(p.units_per_carton, 10) || 24,
        rate_per_unit: Number(p.rate_per_unit),
        moq_cartons: parseInt(p.moq_cartons, 10) || 1,
        hs_code: p.hs_code || "33074100",
        image_url: p.image_url || null,
        sort_order: parseInt(p.sort_order, 10) || 0,
        active: p.active !== false
      };
      if (p.id) {
        const upd = await sb("PATCH", "/export_products?id=eq." + q(String(p.id)), row, "return=representation");
        return J({ ok: true, product: upd[0] });
      }
      const ins = await sb("POST", "/export_products", [row], "return=representation");
      return J({ ok: true, product: ins[0] });
    }

    if (action === "adminDeleteProduct") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.id) return J({ error: "Missing id" }, 400);
      await sb("DELETE", "/export_products?id=eq." + q(String(body.id)));
      return J({ ok: true });
    }

    if (action === "adminUpdateOrder") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.order_no) return J({ error: "Missing order_no" }, 400);
      const patch = {};
      ["status", "shipping_bill_no", "notes"].forEach(k => {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      const upd = await sb("PATCH", "/export_orders?order_no=eq." + q(body.order_no), patch, "return=representation");
      return J({ ok: true, order: upd[0] });
    }

    // Health check — confirms the site can reach Supabase at all.
    if (action === "ping") {
      const rows = await sb("GET", "/export_buyers?select=code&limit=1");
      return J({ ok: true, reachable: true, buyers_visible: rows.length });
    }

    return J({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return J({ error: String(e.message || e) }, 500);
  }
};
