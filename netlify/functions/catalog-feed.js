// Meta / Instagram commerce catalogue feed.
//
// Served as a live URL rather than a file you upload once, so Meta can be set
// to re-fetch on a schedule and the catalogue stays in step with the site. Add
// or edit a product through the tracker's New Product tool and the feed follows
// on the next fetch - nobody has to remember to re-upload anything.
//
// Reads the same PRODUCTS array the storefront renders from, so the feed can
// never disagree with what is actually on sale.
//
// Netlify Functions v2 format, matching the rest of this site.

const SITE = "https://onamagarbathi.com";

// Meta rejects the whole row if a required field is missing, so a product
// without a usable image is left out rather than sent broken.
const REQUIRED = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];

function csvCell(v) {
  const s = String(v == null ? "" : v);
  // Quote whenever the value could break the row, and double any inner quotes.
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default async () => {
  let html;
  try {
    const r = await fetch(SITE + "/", { headers: { "User-Agent": "onam-catalog-feed" } });
    html = await r.text();
  } catch (e) {
    return new Response("Could not read the storefront: " + String((e && e.message) || e), { status: 502 });
  }

  const m = html.match(/var PRODUCTS\s*=\s*(\[[\s\S]*?\}\]);/);
  if (!m) {
    return new Response("Product list not found on the storefront.", { status: 500 });
  }

  let products;
  try { products = JSON.parse(m[1]); }
  catch (e) { return new Response("Product list could not be parsed.", { status: 500 }); }

  // Image filenames follow the product id but the extension varies (.jpg and
  // .webp are both in use), so each one is probed rather than assumed. Guessing
  // .jpg for everything would hand Meta dead URLs for the webp products and it
  // would reject those rows. Probes run in parallel and the result is cached
  // for an hour, so this costs one burst per fetch.
  async function imageFor(id) {
    for (const ext of ["jpg", "webp", "png", "jpeg"]) {
      const url = SITE + "/catalog-images/" + id + "." + ext;
      try {
        const r = await fetch(url, { method: "HEAD" });
        if (r.ok) return url;
      } catch (e) { /* try the next extension */ }
    }
    return null;   // no image - the row gets skipped below
  }

  const headers = [
    "id", "title", "description", "availability", "condition", "price",
    "link", "image_link", "brand", "product_type", "google_product_category"
  ];

  const rows = [];
  const skipped = [];

  // Resolve every image up front, in parallel.
  const images = {};
  await Promise.all(products.map(async (p) => { images[p.id] = await imageFor(p.id); }));

  for (const p of products) {
    const row = {
      id: p.id || "",
      title: (p.name || "").slice(0, 200),
      // Meta truncates hard at 9999 but a clean short description performs
      // better than a padded one.
      description: (p.desc || p.name || "").slice(0, 900),
      availability: "in stock",
      condition: "new",
      // Meta wants "<amount> <currency>". mrp is the consumer price; price is
      // the per-case figure and would be wrong to show a shopper.
      price: (Number(p.mrp) || 0).toFixed(2) + " INR",
      link: SITE + "/",
      image_link: images[p.id] || "",
      brand: p.brand || "Onam",
      product_type: p.cat || "incense",
      // Home & Garden > Decor > Incense
      google_product_category: "596"
    };

    const missing = REQUIRED.filter((k) => !row[k] || row[k] === "0.00 INR");
    if (missing.length) { skipped.push(p.id + " (" + missing.join(", ") + ")"); continue; }
    rows.push(row);
  }

  const csv = [headers.join(",")]
    .concat(rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")))
    .join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="onam-catalog.csv"',
      // Meta re-fetches on its own schedule; an hour keeps it fresh without
      // hammering the storefront.
      "Cache-Control": "public, max-age=3600",
      "X-Products-Included": String(rows.length),
      "X-Products-Skipped": skipped.join("; ") || "none"
    }
  });
};
