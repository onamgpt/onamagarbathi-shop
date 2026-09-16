// ===========================================================================
//  ONAM AGARBATHI — DOMESTIC TRADE ORDER API
//  Sales-team order collection. Every rate and every discount is computed
//  here, never in the browser: a rep cannot alter a price or switch on a
//  scheme that has not been approved.
//
//  Pricing, in order:
//    list rate per dozen
//      less trade discount (11% by default)
//      less scheme discount, only if approved AND today is inside its window
//    = net rate per dozen  ->  x dozens per carton  x cartons
//    + GST on the net value
// ===========================================================================

const SB_URL    = () => Netlify.env.get("SUPABASE_URL") || "";
const SB_KEY    = () => Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
const ADMIN_PIN = () => Netlify.env.get("EXPORT_ADMIN_PIN") || "";
const MAIL_KEY  = () => Netlify.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = () => Netlify.env.get("MAIL_FROM") || "orders@onamagarbathi.com";
const MAIL_TO   = () => (Netlify.env.get("EXPORT_MAIL_TO") ||
                         Netlify.env.get("MAIL_TO") || "onamagarbathi@gmail.com")
                        .split(",").map(x => x.trim()).filter(Boolean);

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
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) throw new Error("supabase " + res.status + ": " + String(text).slice(0, 300));
  return parsed;
}

const q  = (s) => encodeURIComponent(s);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inr = (n) => Number(n || 0).toLocaleString("en-IN",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fyLabel(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return String(start).slice(2) + "-" + String(start + 1).slice(2);
}

// A scheme counts only when it has been approved and today falls inside the
// window. Everything else is treated as no scheme at all.
function liveScheme(p, today) {
  const pct = Number(p.scheme_pct || 0);
  if (!p.scheme_approved || !(pct > 0)) return 0;
  if (p.scheme_from && today < p.scheme_from) return 0;
  if (p.scheme_to   && today > p.scheme_to)   return 0;
  return pct;
}

function priceOf(p, today) {
  const list   = Number(p.rate_per_doz);
  const trade  = Number(p.trade_disc_pct || 0);
  const scheme = liveScheme(p, today);
  const net    = r2(r2(list * (1 - trade / 100)) * (1 - scheme / 100));
  return { list, trade, scheme, net };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

async function mailOrder(order, rep) {
  if (!MAIL_KEY()) return { sent: false, reason: "no key" };
  const rows = order.lines.map(l => `
    <tr>
      <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(l.name)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${l.cartons}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${l.dozens}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${inr(l.list_rate)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">
        ${l.trade_pct}%${l.scheme_pct ? " + " + l.scheme_pct + "%" : ""}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${inr(l.net_rate)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">${inr(l.amount)}</td>
    </tr>`).join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;max-width:760px">
    <p style="font-size:13px;color:#78716c;letter-spacing:.08em;text-transform:uppercase;margin:0">
      Trade order received</p>
    <h2 style="margin:4px 0 2px">${esc(order.party_name)}</h2>
    <p style="margin:0 0 4px;color:#78716c">
      ${esc(order.party_town || "")}${order.party_phone ? " &middot; " + esc(order.party_phone) : ""}
      ${order.party_gstin ? " &middot; GSTIN " + esc(order.party_gstin) : ""}</p>
    <p style="margin:0 0 18px;color:#78716c">
      <strong>${esc(order.order_no)}</strong> &middot; booked by ${esc(rep.name)}
      (${esc(rep.code)})${rep.territory ? " &middot; " + esc(rep.territory) : ""}</p>

    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#faf9f7">
        <th align="left"  style="padding:7px 8px">Product</th>
        <th align="right" style="padding:7px 8px">Ctns</th>
        <th align="right" style="padding:7px 8px">Doz</th>
        <th align="right" style="padding:7px 8px">List/Doz</th>
        <th align="right" style="padding:7px 8px">Disc.</th>
        <th align="right" style="padding:7px 8px">Net/Doz</th>
        <th align="right" style="padding:7px 8px">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <table cellspacing="0" cellpadding="0"
           style="margin-top:14px;font-size:13px;margin-left:auto;min-width:290px">
      <tr><td style="padding:3px 8px">Gross (list)</td>
          <td align="right" style="padding:3px 8px">${inr(order.gross_amount)}</td></tr>
      <tr><td style="padding:3px 8px">Less discount</td>
          <td align="right" style="padding:3px 8px">- ${inr(order.discount_amount)}</td></tr>
      <tr><td style="padding:3px 8px"><strong>Taxable value</strong></td>
          <td align="right" style="padding:3px 8px"><strong>${inr(order.net_amount)}</strong></td></tr>
      <tr><td style="padding:3px 8px">GST</td>
          <td align="right" style="padding:3px 8px">${inr(order.gst_amount)}</td></tr>
      <tr style="border-top:2px solid #1c1917;font-size:15px">
        <td style="padding:8px"><strong>Order value</strong></td>
        <td align="right" style="padding:8px"><strong>Rs. ${inr(order.grand_total)}</strong></td></tr>
    </table>

    ${order.notes ? `<p style="background:#f5f5f4;padding:10px;border-radius:6px;margin-top:16px">
        <strong>Note:</strong> ${esc(order.notes)}</p>` : ""}
  </div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + MAIL_KEY(), "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Onam Orders <" + MAIL_FROM() + ">",
        to: MAIL_TO(),
        subject: "Trade order " + order.order_no + " — " + order.party_name +
                 " — Rs. " + inr(order.grand_total),
        html
      })
    });
    return { sent: r.ok };
  } catch (e) {
    return { sent: false, reason: String(e.message || e) };
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") return J({ ok: true });
  if (req.method !== "POST") return J({ error: "Method not allowed" }, 405);
  if (!SB_URL() || !SB_KEY()) return J({ error: "Supabase not configured" }, 500);

  let body;
  try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
  const action = body.action || "";
  const today = todayISO();

  try {
    async function repFromPin(pin) {
      if (!pin) return null;
      const rows = await sb("GET",
        "/trade_reps?pin=eq." + q(String(pin)) + "&active=eq.true&select=*");
      return rows && rows.length ? rows[0] : null;
    }

    if (action === "login") {
      const rep = await repFromPin(body.pin);
      if (!rep) return J({ error: "Access code not recognised" }, 401);

      const channels = (rep.channels && rep.channels.length) ? rep.channels : ["TRADE"];
      const channel = channels.includes(body.channel) ? body.channel : channels[0];

      const raw = await sb("GET",
        "/trade_products?active=eq.true&channel=eq." + q(channel) +
        "&select=*&order=sort_order.asc");
      const products = raw.map(p => {
        const pr = priceOf(p, today);
        return {
          sku: p.sku, name: p.name,
          rate_per_doz: pr.list, doz_per_ctn: Number(p.doz_per_ctn),
          trade_disc_pct: pr.trade, scheme_pct: pr.scheme,
          scheme_from: p.scheme_from, scheme_to: p.scheme_to,
          net_rate: pr.net,
          amount_per_ctn: r2(pr.net * Number(p.doz_per_ctn)),
          list_per_ctn:   r2(pr.list * Number(p.doz_per_ctn)),
          rate_per_case: p.rate_per_case == null ? null : Number(p.rate_per_case),
          moq_cartons: p.moq_cartons || 1, gst_pct: Number(p.gst_pct || 5),
          image_url: p.image_url
        };
      });

      // Commission is occasional, so agents are offered rather than assumed.
      const agents = await sb("GET",
        "/trade_agents?active=eq.true&select=name,default_pct&order=name.asc");

      // Parties this rep has booked before, so the next order autofills.
      const past = await sb("GET",
        "/trade_orders?rep_code=eq." + q(rep.code) +
        "&select=party_name,party_town,party_phone,party_gstin&order=id.desc&limit=60");
      const seen = new Set(), parties = [];
      (past || []).forEach(o => {
        const k = (o.party_name || "").toUpperCase();
        if (!k || seen.has(k)) return;
        seen.add(k); parties.push(o);
      });

      return J({ ok: true, products, parties, agents, channel, channels,
        rep: { code: rep.code, name: rep.name, territory: rep.territory } });
    }

    if (action === "placeOrder") {
      const rep = await repFromPin(body.pin);
      if (!rep) return J({ error: "Access code not recognised" }, 401);

      const party = body.party || {};
      if (!party.name || !String(party.name).trim())
        return J({ error: "Party name is required" }, 400);

      const wanted = Array.isArray(body.lines) ? body.lines : [];
      if (!wanted.length) return J({ error: "No items in the order" }, 400);

      const repChannels = (rep.channels && rep.channels.length) ? rep.channels : ["TRADE"];
      const channel = repChannels.includes(body.channel) ? body.channel : repChannels[0];
      const catalog = await sb("GET",
        "/trade_products?active=eq.true&channel=eq." + q(channel) + "&select=*");
      const bySku = {};
      catalog.forEach(p => { bySku[p.sku] = p; });

      const lines = [];
      let cartons = 0, gross = 0, net = 0, gst = 0;
      for (const w of wanted) {
        const p = bySku[w.sku];
        if (!p) continue;
        const ctn = Math.max(0, parseInt(w.cartons, 10) || 0);
        if (!ctn) continue;
        if (ctn < (p.moq_cartons || 1))
          return J({ error: p.name + " has a minimum of " + p.moq_cartons + " carton(s)" }, 400);

        const pr  = priceOf(p, today);
        const doz = r2(Number(p.doz_per_ctn) * ctn);
        const listAmt = r2(pr.list * doz);
        const netAmt  = r2(pr.net  * doz);
        const gstPct  = Number(p.gst_pct || 5);
        const gstAmt  = r2(netAmt * gstPct / 100);

        lines.push({
          sku: p.sku, name: p.name, cartons: ctn,
          doz_per_ctn: Number(p.doz_per_ctn), dozens: doz,
          list_rate: pr.list, trade_pct: pr.trade, scheme_pct: pr.scheme,
          net_rate: pr.net, list_amount: listAmt, amount: netAmt,
          gst_pct: gstPct, gst_amount: gstAmt, hsn: p.hsn
        });
        cartons += ctn; gross = r2(gross + listAmt);
        net = r2(net + netAmt); gst = r2(gst + gstAmt);
      }
      if (!lines.length) return J({ error: "No valid items in the order" }, 400);

      const existing = await sb("GET",
        "/trade_orders?rep_code=eq." + q(rep.code) + "&select=id&order=id.desc&limit=1");
      const seq = (existing && existing.length ? existing[0].id : 0) + 1;
      const orderNo = "ONT/" + rep.code + "/" + fyLabel(new Date()) + "/" +
                      String(seq).padStart(3, "0");

      // Commission: taken on the taxable value, before GST. The percentage is
      // whatever was agreed on this order; the agent's standing rate is only a
      // default, so an override is allowed but must be deliberate.
      let agent = (body.agent || "").trim().slice(0, 80) || null;
      let commPct = 0;
      if (agent) {
        const known = await sb("GET",
          "/trade_agents?name=eq." + q(agent) + "&select=default_pct");
        const fallback = known && known.length ? Number(known[0].default_pct || 0) : 0;
        commPct = (body.commission_pct === undefined || body.commission_pct === "")
                  ? fallback : Number(body.commission_pct);
        if (!(commPct >= 0 && commPct <= 100)) commPct = fallback;
      }
      const commAmt = r2(net * commPct / 100);

      const row = {
        order_no: orderNo, rep_code: rep.code, channel,
        agent, commission_pct: commPct,
        commission_amount: commAmt, commission_base: net,
        collection_status: "pending", collected_amount: 0,
        party_name: String(party.name).trim().slice(0, 120),
        party_town: (party.town || "").slice(0, 80),
        party_phone: (party.phone || "").slice(0, 20),
        party_gstin: (party.gstin || "").toUpperCase().slice(0, 15),
        lines, total_cartons: cartons,
        gross_amount: gross, discount_amount: r2(gross - net),
        net_amount: net, gst_amount: gst, grand_total: r2(net + gst),
        notes: (body.notes || "").slice(0, 500)
      };
      const inserted = await sb("POST", "/trade_orders", [row], "return=representation");
      const order = inserted[0];
      const mail = await mailOrder(order, rep);
      return J({ ok: true, order, rep, mail });
    }

    // ---- admin ------------------------------------------------------------
    const admin = () => ADMIN_PIN() && body.adminPin && String(body.adminPin) === ADMIN_PIN();

    if (action === "adminList") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const reps     = await sb("GET", "/trade_reps?select=*&order=code.asc");
      const products = await sb("GET", "/trade_products?select=*&order=sort_order.asc");
      const orders   = await sb("GET", "/trade_orders?select=*&order=id.desc&limit=100");
      const agents   = await sb("GET", "/trade_agents?select=*&order=name.asc");
      return J({ ok: true, reps, products, orders, agents, today });
    }

    if (action === "adminSaveRep") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const r = body.rep || {};
      if (!r.code || !r.name || !r.pin)
        return J({ error: "Code, name and PIN are required" }, 400);
      const saved = await sb("POST", "/trade_reps?on_conflict=code", [{
        code: String(r.code).toUpperCase().trim(), name: r.name,
        territory: r.territory || "", pin: String(r.pin), active: r.active !== false
      }], "resolution=merge-duplicates,return=representation");
      return J({ ok: true, rep: saved[0] });
    }

    if (action === "adminSaveProduct") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      const p = body.product || {};
      if (!p.sku || !p.name || p.rate_per_doz === undefined || p.rate_per_doz === "")
        return J({ error: "SKU, name and rate are required" }, 400);
      const row = {
        sku: p.sku, name: p.name,
        rate_per_doz: Number(p.rate_per_doz),
        doz_per_ctn: Number(p.doz_per_ctn || 1),
        trade_disc_pct: Number(p.trade_disc_pct || 0),
        scheme_pct: Number(p.scheme_pct || 0),
        scheme_from: p.scheme_from || null,
        scheme_to: p.scheme_to || null,
        scheme_approved: !!p.scheme_approved,
        moq_cartons: parseInt(p.moq_cartons, 10) || 1,
        gst_pct: Number(p.gst_pct || 5),
        image_url: p.image_url || null,
        sort_order: parseInt(p.sort_order, 10) || 0,
        active: p.active !== false
      };
      if (p.id) {
        const upd = await sb("PATCH", "/trade_products?id=eq." + q(String(p.id)),
                             row, "return=representation");
        return J({ ok: true, product: upd[0] });
      }
      const ins = await sb("POST", "/trade_products", [row], "return=representation");
      return J({ ok: true, product: ins[0] });
    }

    if (action === "adminDeleteProduct") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.id) return J({ error: "Missing id" }, 400);
      await sb("DELETE", "/trade_products?id=eq." + q(String(body.id)));
      return J({ ok: true });
    }

    if (action === "adminRecordCollection") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.order_no) return J({ error: "Missing order_no" }, 400);
      const rows = await sb("GET",
        "/trade_orders?order_no=eq." + q(body.order_no) + "&select=grand_total,collected_amount");
      if (!rows.length) return J({ error: "Order not found" }, 404);
      const total = Number(rows[0].grand_total || 0);
      const already = Number(rows[0].collected_amount || 0);
      const add = Number(body.amount || 0);
      if (!(add > 0)) return J({ error: "Enter an amount" }, 400);

      const now = r2(already + add);
      const status = now >= total - 0.5 ? "paid" : (now > 0 ? "part" : "pending");
      const upd = await sb("PATCH", "/trade_orders?order_no=eq." + q(body.order_no),
        { collected_amount: now, collection_status: status,
          collected_at: new Date().toISOString() }, "return=representation");
      return J({ ok: true, order: upd[0], outstanding: r2(total - now) });
    }

    if (action === "adminUpdateOrder") {
      if (!admin()) return J({ error: "Not authorised" }, 401);
      if (!body.order_no) return J({ error: "Missing order_no" }, 400);
      const patch = {};
      ["status", "notes"].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
      const upd = await sb("PATCH", "/trade_orders?order_no=eq." + q(body.order_no),
                           patch, "return=representation");
      return J({ ok: true, order: upd[0] });
    }

    if (action === "ping") {
      const rows = await sb("GET", "/trade_products?select=sku&limit=1");
      return J({ ok: true, reachable: true, products_visible: rows.length, today });
    }

    return J({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return J({ error: String(e.message || e) }, 500);
  }
};
