// Serves a real, shareable, reloadable invoice page at /invoice/{invoiceNo}.
// This solves the problem where the original browser-tab invoice had no real
// URL of its own to share - sharing the page only ever shared the homepage
// URL, since the invoice content only ever existed as transient JS-written
// HTML in a blank tab.
//
// This page looks up the permanent invoice record from the GST Order Log
// Google Sheet (the same one written to at payment time) and renders it
// fresh every time it's loaded - so the link works whenever it's opened,
// not just in the original browser session. A "Download as PDF" button uses
// the browser's native print-to-PDF, which is the most reliable cross-device
// approach without needing a separate PDF-generation library.

const COMPANY_DETAILS = {
  name: "Onam Agarbathi Pvt. Ltd.",
  gstin: "29AAACO2213Q1Z8",
  address: "Bengaluru 560 076, Karnataka",
  email: "customercare@onamagarbathi.com",
  whatsapp: "+91 98455 63633"
};

function numberToWordsIndian(num) {
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function inWords(n) {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n/10)] + (n%10 ? " " + a[n%10] : "");
    if (n < 1000) return a[Math.floor(n/100)] + " Hundred" + (n%100 ? " " + inWords(n%100) : "");
    if (n < 100000) return inWords(Math.floor(n/1000)) + " Thousand" + (n%1000 ? " " + inWords(n%1000) : "");
    if (n < 10000000) return inWords(Math.floor(n/100000)) + " Lakh" + (n%100000 ? " " + inWords(n%100000) : "");
    return inWords(Math.floor(n/10000000)) + " Crore" + (n%10000000 ? " " + inWords(n%10000000) : "");
  }
  const rupees = Math.floor(num);
  return (rupees === 0 ? "Zero" : inWords(rupees)) + " Rupees Only";
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInvoiceHtml(data) {
  const items = data.items || [];
  const totalTaxable = items.reduce((s, i) => s + Number(i.taxableValue || 0), 0);
  const totalGst = items.reduce((s, i) => s + Number(i.gstAmount || 0), 0);
  const grandTotal = items.reduce((s, i) => s + Number(i.lineTotal || 0), 0);

  const invDate = data.date ? new Date(data.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

  const rowsHtml = items.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td style="text-align:left">${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.hsn)}</td>
      <td>${escapeHtml(item.qty)}</td>
      <td>Rs.${Number(item.mrpPerUnit || 0).toFixed(2)}</td>
      <td>Rs.${Number(item.taxableValue || 0).toFixed(2)}</td>
      <td>${escapeHtml(item.gstRate)}%</td>
      <td>Rs.${Number(item.gstAmount || 0).toFixed(2)}</td>
      <td>Rs.${Number(item.lineTotal || 0).toFixed(2)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escapeHtml(data.invoiceNo)}</title>
<style>
body{font-family:Arial,sans-serif;padding:30px;color:#1a1208;max-width:800px;margin:0 auto}
h1{font-size:22px;border-bottom:3px solid #C9A84C;padding-bottom:10px;margin-bottom:4px}
.sub{color:#888;font-size:12px;margin-bottom:20px}
.grid{display:flex;justify-content:space-between;margin-bottom:20px;font-size:13px;flex-wrap:wrap}
.box{width:48%;min-width:200px}
.box h3{font-size:11px;text-transform:uppercase;color:#888;margin-bottom:6px;letter-spacing:0.05em}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
th,td{border:1px solid #ccc;padding:7px;text-align:center}
th{background:#1a1208;color:#f5d890}
.totals{margin-top:14px;text-align:right;font-size:13px}
.totals div{margin-bottom:4px}
.grand{font-size:16px;font-weight:bold;color:#1a1208;border-top:2px solid #1a1208;padding-top:8px;margin-top:6px}
.words{margin-top:10px;font-size:11px;font-style:italic;color:#555}
.footer{margin-top:40px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:14px}
.actions{margin-bottom:24px;display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;background:#1a1208;color:#f5d890;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;border:none;cursor:pointer}
@media print{.actions{display:none}body{padding:10px}}
</style></head><body>
<div class="actions">
  <button class="btn" onclick="window.print()">Download as PDF</button>
</div>
<h1>${COMPANY_DETAILS.name}</h1>
<div class="sub">GSTIN: ${COMPANY_DETAILS.gstin} | ${COMPANY_DETAILS.address} | ${COMPANY_DETAILS.email}</div>
<div class="grid">
  <div class="box"><h3>Invoice To</h3>
    <div>${escapeHtml(data.customerName)}</div>
    <div>${escapeHtml(data.customerAddress)}</div>
    <div>${escapeHtml(data.customerCity)} - ${escapeHtml(data.customerPin)}, ${escapeHtml(data.customerState)}</div>
    <div>Phone: ${escapeHtml(data.customerPhone)}</div>
    ${data.customerGstin ? `<div>GSTIN: ${escapeHtml(data.customerGstin)}</div>` : ""}
  </div>
  <div class="box" style="text-align:right"><h3>Invoice Details</h3>
    <div>Invoice No: ${escapeHtml(data.invoiceNo)}</div>
    <div>Date: ${invDate}</div>
    <div>Payment ID: ${escapeHtml(data.paymentId)}</div>
    <div>Place of Supply: ${escapeHtml(data.customerState) || "Karnataka"}</div>
  </div>
</div>
<table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable Value</th><th>GST</th><th>GST Amt</th><th>Total</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<div class="totals">
  <div>Taxable Value: Rs.${totalTaxable.toFixed(2)}</div>
  <div>Total GST: Rs.${totalGst.toFixed(2)}</div>
  <div class="grand">Grand Total: Rs.${grandTotal.toFixed(2)}</div>
</div>
<div class="words">Amount in words: ${numberToWordsIndian(grandTotal)}</div>
<div class="footer">This is a system-generated invoice for B2C retail sale. Thank you for your purchase from ${COMPANY_DETAILS.name}.</div>
</body></html>`;
}

export default async (req) => {
  const url = new URL(req.url);
  const invoiceNo = decodeURIComponent(url.pathname.replace(/^\/invoice\//, ""));

  if (!invoiceNo) {
    return new Response("Invoice number missing", { status: 400 });
  }

  const SCRIPT_URL = Netlify.env.get("ORDER_LOG_SCRIPT_URL");
  if (!SCRIPT_URL) {
    return new Response("Order log not configured", { status: 500 });
  }

  try {
    const lookupUrl = SCRIPT_URL + "?invoice=" + encodeURIComponent(invoiceNo);
    const r = await fetch(lookupUrl);
    const data = await r.json();

    if (!data.found) {
      return new Response(
        `<body style="font-family:Arial;padding:40px;text-align:center;color:#555"><h2>Invoice not found</h2><p>No invoice matches: ${escapeHtml(invoiceNo)}</p></body>`,
        { status: 404, headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response(renderInvoiceHtml(data), {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });

  } catch (e) {
    return new Response(
      `<body style="font-family:Arial;padding:40px;text-align:center;color:#555"><h2>Could not load invoice</h2><p>Please contact Onam Agarbathi with Invoice No: ${escapeHtml(invoiceNo)}</p></body>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
};

export const config = {
  path: "/invoice/*"
};
