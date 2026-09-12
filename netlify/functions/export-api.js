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
const MAIL_KEY  = () => Netlify.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = () => Netlify.env.get("MAIL_FROM") || "orders@onamagarbathi.com";
const MAIL_TO   = () => (Netlify.env.get("EXPORT_MAIL_TO") ||
                         Netlify.env.get("MAIL_TO") || "onamagarbathi@gmail.com")
                        .split(",").map(x => x.trim()).filter(Boolean);

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => Number(n || 0).toLocaleString("en-US",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Order notification. Never allowed to break the order itself — a mail
// outage must not lose a customer's consignment.
async function mailOrder(order, buyer) {
  if (!MAIL_KEY()) return { sent: false, reason: "no key" };
  const rows = order.lines.map(l => `
    <tr>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${l.cartons}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${l.units_per_carton}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(l.name)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${l.units}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${Number(l.rate_per_unit).toFixed(2)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${fmt(l.amount)}</td>
    </tr>`).join("");

  let terms = "Payable on arrival of shipment.";
  if (order.deposit_pct >= 100) terms = "100% advance with order: US$ " + fmt(order.total_usd);
  else if (order.deposit_pct > 0)
    terms = order.deposit_pct + "% with order (US$ " + fmt(order.deposit_usd) +
            "), balance US$ " + fmt(order.balance_usd) + " on arrival.";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;max-width:700px">
    <p style="font-size:13px;color:#78716c;letter-spacing:.08em;text-transform:uppercase;margin:0">
      Export order received</p>
    <h2 style="margin:4px 0 2px">${esc(buyer.name)}</h2>
    <p style="margin:0 0 18px;color:#78716c">
      ${esc(buyer.country || "")} &middot; ${esc(buyer.incoterm || "")} ${esc(buyer.port || "")}
      &middot; <strong>${esc(order.order_no)}</strong></p>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#faf9f7">
        <th align="right" style="padding:7px 8px">Ctns</th>
        <th align="right" style="padding:7px 8px">Unit/Ctn</th>
        <th align="left"  style="padding:7px 8px">Particulars</th>
        <th align="right" style="padding:7px 8px">Units</th>
        <th align="right" style="padding:7px 8px">Rate US$</th>
        <th align="right" style="padding:7px 8px">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid #1c1917">
        <td align="right" style="padding:8px">${order.total_cartons}</td>
        <td></td><td></td>
        <td align="right" style="padding:8px">${order.total_units}</td>
        <td></td>
        <td align="right" style="padding:8px">US$ ${fmt(order.total_usd)}</td>
      </tr></tfoot>
    </table>
    <p style="margin-top:16px"><strong>Terms:</strong> ${terms}</p>
    ${order.notes ? `<p style="background:#f5f5f4;padding:10px;border-radius:6px">
        <strong>Buyer's note:</strong> ${esc(order.notes)}</p>` : ""}
    <p style="margin-top:22px">
      <a href="https://onamagarbathi.com/export-admin"
         style="background:#1c1917;color:#fff;padding:10px 18px;border-radius:6px;
                text-decoration:none;font-weight:600">Open Export Admin</a></p>
  </div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + MAIL_KEY(), "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Onam Exports <" + MAIL_FROM() + ">",
        to: MAIL_TO(),
        subject: "Export order " + order.order_no + " — " + buyer.name +
                 " — US$ " + fmt(order.total_usd),
        html
      })
    });
    return { sent: r.ok };
  } catch (e) {
    return { sent: false, reason: String(e.message || e) };
  }
}

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
      // Everything in the range that is NOT already theirs — names only.
      // Rates are deliberately withheld: an unquoted price is not theirs to see.
      const all = await sb("GET", "/export_products?active=eq.true&select=sku,name");
      const mine = new Set(products.map(p => p.name.toUpperCase()));
      const seen = new Set();
      const available = [];
      all.forEach(p => {
        const k = p.name.toUpperCase();
        if (mine.has(k) || seen.has(k)) return;
        seen.add(k);
        available.push({ sku: p.sku, name: p.name });
      });
      available.sort((a, b) => a.name.localeCompare(b.name));

      const openReqs = await sb("GET",
        "/export_requests?buyer_code=eq." + q(buyer.code) +
        "&status=eq.open&select=name&order=id.desc");

      return J({
        ok: true,
        available,
        pending: openReqs.map(r => r.name),
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

      const buyerOut = {
        code: buyer.code, name: buyer.name, country: buyer.country,
        incoterm: buyer.incoterm, port: buyer.port, currency: buyer.currency
      };
      const mail = await mailOrder(inserted[0], buyerOut);
      return J({ ok: true, order: inserted[0], buyer: buyerOut, mail });
    }

    // ---- buyer asks for an item not yet in their catalogue ---------------
    if (action === "requestProduct") {
      const buyer = await buyerFromPin(body.pin);
      if (!buyer) return J({ error: "Access code not recognised" }, 401);

      const items = Array.isArray(body.items) ? body.items : [];
      const note = (body.note || "").slice(0, 300);
      const rows = [];
      items.slice(0, 40).forEach(it => {
        const name = String(it.name || "").trim().slice(0, 120);
        if (!name) return;
        rows.push({ buyer_code: buyer.code, sku: it.sku || null, name, note, status: "open" });
      });
      if (!rows.length) return J({ error: "Nothing to request" }, 400);

      // Don't stack duplicates of something already pending.
      const open = await sb("GET",
        "/export_requests?buyer_code=eq." + q(buyer.code) + "&status=eq.open&select=name");
      const already = new Set(open.map(r => r.name.toUpperCase()));
      const fresh = rows.filter(r => !already.has(r.name.toUpperCase()));
      if (!fresh.length) return J({ ok: true, added: 0, message: "Already on your pending list" });

      await sb("POST", "/export_requests", fresh);
      return J({ ok: true, added: fresh.length });
    }

    // ---- admin -----------------------------------------------------------
    const admin = () => ADMIN_PIN() && body.adminPin && String(body.adminPin) === ADMIN_PIN();

    if (action === "adminList") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const buyers = await sb("GET", "/export_buyers?select=*&order=code.asc");
      const products = await sb("GET", "/export_products?select=*&order=buyer_code.asc,sort_order.asc");
      const orders = await sb("GET", "/export_orders?select=*&order=id.desc&limit=100");
      const requests = await sb("GET", "/export_requests?status=eq.open&select=*&order=id.desc");
      return J({ ok: true, buyers, products, orders, requests });
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

    if (action === "adminResolveRequest") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.id) return J({ error: "Missing id" }, 400);

      if (body.decision === "approve") {
        const p = body.product || {};
        if (!p.sku || !p.name || p.rate_per_unit === undefined || p.rate_per_unit === "")
          return J({ error: "SKU, name and rate are required to approve" }, 400);
        await sb("POST", "/export_products", [{
          buyer_code: String(p.buyer_code).toUpperCase().trim(),
          sku: p.sku, name: p.name,
          units_per_carton: parseInt(p.units_per_carton, 10) || 24,
          rate_per_unit: Number(p.rate_per_unit),
          moq_cartons: parseInt(p.moq_cartons, 10) || 1,
          hs_code: p.hs_code || "33074100",
          image_url: p.image_url || null,
          sort_order: parseInt(p.sort_order, 10) || 999,
          active: true
        }]);
      }
      await sb("PATCH", "/export_requests?id=eq." + q(String(body.id)),
        { status: body.decision === "approve" ? "approved" : "declined" });
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

    if (action === "adminTestMail") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const m = await mailOrder({
        order_no: "TEST/0000", lines: [{ name: "Test line", cartons: 1, units_per_carton: 24,
          units: 24, rate_per_unit: 2.28, amount: 54.72 }],
        total_cartons: 1, total_units: 24, total_usd: 54.72, deposit_pct: 0, notes: "Test only"
      }, { name: "Mail test", country: "—", incoterm: "C&F", port: "—" });
      return J({ ok: true, mail: m, to: MAIL_TO() });
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
