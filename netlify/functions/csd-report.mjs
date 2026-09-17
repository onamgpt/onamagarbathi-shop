// ===========================================================================
//  CSD RECEIVABLES REPORT
//  Runs on a schedule and emails the CSD ageing picture so overdue bills can
//  be chased without anyone remembering to look.
//
//  Reads what the tracker already holds in Supabase:
//    kv / pf_csd_payments  — CSD HO realisation statements
//    kv / pf_csd_register  — invoices, from the monthly Tally exports
//
//  The honest-reporting rule this file exists to enforce: CSD statements
//  arrive with gaps, and a bill that looks unpaid may simply sit inside a
//  month we never received. Those are reported SEPARATELY and never counted
//  as overdue, because chasing CSD for money already paid costs more
//  goodwill than the invoice is worth.
//
//  Manual run: POST { action: "run", adminPin } to this function.
// ===========================================================================

const SB_URL  = () => Netlify.env.get("SUPABASE_URL") || "";
const SB_KEY  = () => Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
const MAIL_KEY= () => Netlify.env.get("RESEND_API_KEY") || "";
const MAIL_FROM=() => Netlify.env.get("MAIL_FROM") || "orders@onamagarbathi.com";
// Deliberately NOT EXPORT_MAIL_TO: this report goes to the owner alone.
const MAIL_TO = () => (Netlify.env.get("CSD_REPORT_TO") || "onamagarbathi@gmail.com")
                      .split(",").map(s => s.trim()).filter(Boolean);
const ADMIN_PIN = () => Netlify.env.get("EXPORT_ADMIN_PIN") || "";
const TG_TOKEN = () => Netlify.env.get("TELEGRAM_BOT_TOKEN") || "";
// The owner's own chat, not the website-orders group.
const TG_CHAT  = () => Netlify.env.get("TELEGRAM_CHAT_ID") || "";

const MON = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
const MONTH_NAME = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const inr = n => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const esc = v => String(v == null ? "" : v)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d) ? null : d;
}
const days = (a, b) => Math.round((b - a) / 86400000);

async function sb(path) {
  const r = await fetch(SB_URL() + "/rest/v1" + path, {
    headers: { apikey: SB_KEY(), Authorization: "Bearer " + SB_KEY() }
  });
  if (!r.ok) throw new Error("supabase " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}
async function kv(key) {
  const rows = await sb("/kv?owner=eq.main&k=eq." + encodeURIComponent(key) + "&select=v");
  return rows && rows.length ? rows[0].v : null;
}

// Which months do the statements actually cover? Anything between the first
// and last covered month that is absent is a hole in the evidence.
function coverage(statements) {
  const covered = new Set();
  let lo = null, hi = null;
  for (const s of statements) {
    const m = String(s.period || "").match(
      /(\d{2})-([A-Z]{3})-(\d{2})\s+to\s+(\d{2})-([A-Z]{3})-(\d{2})/);
    if (!m) continue;
    let y1 = 2000 + +m[3], m1 = MON[m[2]], y2 = 2000 + +m[6], m2 = MON[m[5]];
    for (let y = y1, mo = m1; y < y2 || (y === y2 && mo <= m2); ) {
      covered.add(y * 100 + mo);
      if (lo === null || y * 100 + mo < lo) lo = y * 100 + mo;
      if (hi === null || y * 100 + mo > hi) hi = y * 100 + mo;
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  }
  const gaps = [];
  if (lo !== null) {
    for (let y = Math.floor(lo / 100), mo = lo % 100;
         y * 100 + mo <= hi; ) {
      if (!covered.has(y * 100 + mo)) gaps.push({ y, m: mo });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  }
  return { covered, gaps, lo, hi };
}

function build(statements, invoices, now) {
  const paid = new Map();
  const notes = [];
  for (const s of statements || []) {
    for (const b of s.bills || []) {
      if (b.docType === "BILL") { if (!paid.has(b.billNo)) paid.set(b.billNo, b); }
      else notes.push(b);
    }
  }

  // CSD's real cycle, measured on bills we can see both ends of.
  const lags = [];
  for (const [bn, b] of paid) {
    const inv = invoices.find(i => i.billNo === bn);
    if (!inv) continue;
    const bd = parseDate(inv.date), pd = parseDate(b.utrDate);
    if (bd && pd && pd > bd) lags.push(days(bd, pd));
  }
  lags.sort((a, b) => a - b);
  const pick = p => lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * p))] : 0;
  const median = pick(0.5), p90 = pick(0.9) || 115;

  const { gaps } = coverage(statements || []);
  // A bill raised before the earliest gap cannot be hiding in a missing
  // statement, so it is safe to chase. Anything later is only "unconfirmed".
  const firstGap = gaps.length
    ? new Date(Date.UTC(gaps[0].y, gaps[0].m - 1, 1))
    : null;

  const overdue = [], unconfirmed = [];
  for (const inv of invoices) {
    if (paid.has(inv.billNo)) continue;
    const bd = parseDate(inv.date);
    if (!bd) continue;
    const age = days(bd, now);
    if (age <= p90) continue;
    const row = { billNo: inv.billNo, depot: inv.depotName, date: inv.date,
                  amount: Number(inv.gross || inv.taxable || 0), age };
    if (!firstGap || bd < firstGap) overdue.push(row); else unconfirmed.push(row);
  }
  overdue.sort((a, b) => b.age - a.age);
  unconfirmed.sort((a, b) => b.age - a.age);

  // Debit notes still inside CSD's 15-day discrepancy window.
  const live = notes.filter(n => {
    const d = parseDate(n.utrDate);
    return d && days(d, now) <= 15;
  });

  const byDepot = {};
  for (const r of overdue.concat(unconfirmed)) {
    byDepot[r.depot] = byDepot[r.depot] || { n: 0, amt: 0 };
    byDepot[r.depot].n++; byDepot[r.depot].amt += r.amount;
  }
  const depots = Object.entries(byDepot)
    .map(([d, v]) => ({ depot: d, ...v }))
    .sort((a, b) => b.amt - a.amt).slice(0, 8);

  return {
    median, p90, gaps, overdue, unconfirmed, notes, live, depots,
    overdueValue: overdue.reduce((s, r) => s + r.amount, 0),
    unconfirmedValue: unconfirmed.reduce((s, r) => s + r.amount, 0),
    noteValue: notes.reduce((s, n) => s + Math.abs(n.dbNoteAmt || 0), 0)
  };
}

function html(r, now) {
  const rows = list => list.slice(0, 15).map(x => `
    <tr>
      <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(x.billNo)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(x.depot)}</td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">
        <strong>${x.age}</strong></td>
      <td align="right" style="padding:5px 8px;border-bottom:1px solid #eee">
        ${inr(x.amount)}</td>
    </tr>`).join("");

  const gapText = r.gaps.length
    ? r.gaps.map(g => MONTH_NAME[g.m] + " " + g.y).join(", ")
    : "none — statement coverage is complete";

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;max-width:760px;line-height:1.55">
    <p style="font-size:12px;color:#78716c;letter-spacing:.08em;text-transform:uppercase;margin:0">
      CSD receivables &middot; ${now.toISOString().slice(0,10)}</p>
    <h2 style="margin:4px 0 6px">₹${inr(r.overdueValue)} overdue and chaseable</h2>
    <p style="margin:0 0 20px;color:#78716c;font-size:14px">
      CSD's own cycle, measured on ${r.overdue.length + r.unconfirmed.length ? "your paid bills" : "history"}:
      median <strong>${r.median} days</strong>, 90% settled within <strong>${r.p90}</strong>.
      Anything below is past that.</p>

    ${r.overdue.length ? `
    <h3 style="font-size:15px;margin:22px 0 8px">Chase these — raised before any gap in statement coverage</h3>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#faf9f7">
        <th align="left" style="padding:7px 8px">Bill</th>
        <th align="left" style="padding:7px 8px">Depot</th>
        <th align="right" style="padding:7px 8px">Days</th>
        <th align="right" style="padding:7px 8px">Amount ₹</th>
      </tr></thead><tbody>${rows(r.overdue)}</tbody></table>
    ${r.overdue.length > 15 ? `<p style="font-size:13px;color:#78716c">…and ${r.overdue.length - 15} more.</p>` : ""}
    ` : `<p style="background:#f0fdf4;color:#166534;padding:11px 14px;border-radius:7px">
           Nothing is confidently overdue this month.</p>`}

    ${r.live.length ? `
    <h3 style="font-size:15px;margin:24px 0 8px">Debit notes inside the 15-day dispute window</h3>
    <p style="margin:0;font-size:14px">${r.live.map(n =>
      `${esc(n.depot)} ${esc(n.billNo)} — ₹${inr(Math.abs(n.dbNoteAmt))}`).join(" · ")}</p>
    <p style="margin:6px 0 0;font-size:13px;color:#9f1239">
      Check these against dispatch records before the window closes.</p>` : ""}

    <h3 style="font-size:15px;margin:24px 0 8px">Where the money sits</h3>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">
      <tbody>${r.depots.map(d => `
        <tr><td style="padding:4px 8px">${esc(d.depot)}</td>
            <td align="right" style="padding:4px 8px">${d.n} bills</td>
            <td align="right" style="padding:4px 8px">₹${inr(d.amt)}</td></tr>`).join("")}
      </tbody></table>

    <h3 style="font-size:15px;margin:24px 0 8px">Not counted above</h3>
    <p style="margin:0;font-size:14px">
      ${r.unconfirmed.length} bills worth <strong>₹${inr(r.unconfirmedValue)}</strong>
      look unpaid, but statements are missing for <strong>${gapText}</strong>.
      Several were probably paid in those. Requesting them from CSD HO closes the gap —
      until then these are not worth chasing.</p>

    <p style="margin:24px 0 0;font-size:13px;color:#78716c">
      Total debit notes on record: ₹${inr(r.noteValue)}.
      Figures come from CSD HO statements and your Tally sales registers; nothing is estimated.</p>
  </div>`;
}

// Short nudge on Telegram. The email carries the detail; this is just enough
// to know whether opening it is worth doing now.
async function telegram(r) {
  if (!TG_TOKEN() || !TG_CHAT()) return { sent: false, reason: "not configured" };
  const top = r.overdue.slice(0, 3)
    .map(x => `• ${x.billNo} ${x.depot} — ₹${inr(x.amount)} (${x.age}d)`).join("\n");
  const text =
    `*CSD receivables*\n` +
    `₹${inr(r.overdueValue)} overdue across ${r.overdue.length} bills\n` +
    (top ? `\n${top}\n` : "\nNothing confidently overdue.\n") +
    (r.live.length ? `\n⚠️ ${r.live.length} debit note(s) inside the 15-day dispute window\n` : "") +
    `\nCSD pays in ${r.median}d median, ${r.p90}d at the 90th percentile.` +
    (r.gaps.length ? `\n${r.unconfirmed.length} more bills unverifiable — ${r.gaps.length} statement(s) missing.` : "") +
    `\n\nFull detail emailed.`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN()}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT(), text, parse_mode: "Markdown" })
    });
    return { sent: res.ok };
  } catch (e) { return { sent: false, reason: String(e.message || e) }; }
}

async function run() {
  if (!SB_URL() || !SB_KEY()) throw new Error("Supabase not configured");
  const pay = await kv("pf_csd_payments");
  const reg = await kv("pf_csd_register");
  const statements = (pay && pay.statements) || [];
  const invoices = (reg && reg.invoices) || [];
  if (!invoices.length) return { ok: false, reason: "no invoice register loaded" };

  const now = new Date();
  const r = build(statements, invoices, now);

  const tg = await telegram(r);

  if (!MAIL_KEY()) return { ok: false, reason: "no mail key", telegram: tg,
    summary: { overdue: r.overdue.length, overdueValue: r.overdueValue } };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + MAIL_KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Onam CSD <" + MAIL_FROM() + ">",
      to: MAIL_TO(),
      subject: "CSD receivables — ₹" + inr(r.overdueValue) + " overdue, " +
               r.overdue.length + " bills to chase",
      html: html(r, now)
    })
  });
  return { ok: res.ok, sent_to: MAIL_TO(), telegram: tg,
           overdue: r.overdue.length, overdueValue: r.overdueValue,
           unconfirmed: r.unconfirmed.length, gaps: r.gaps.length };
}

export default async (req) => {
  // Manual run, for testing or an ad-hoc chase list.
  if (req && req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    if (!ADMIN_PIN() || String(body.adminPin) !== ADMIN_PIN())
      return new Response(JSON.stringify({ error: "Not authorised" }),
        { status: 401, headers: { "Content-Type": "application/json" } });
    try {
      return new Response(JSON.stringify(await run()),
        { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
  // Scheduled invocation.
  try { console.log("[csd-report]", JSON.stringify(await run())); }
  catch (e) { console.error("[csd-report] failed:", e.message); }
  return new Response("ok");
};

// 1st of each month, 04:00 UTC = 09:30 IST.
export const config = { schedule: "0 4 1 * *" };
