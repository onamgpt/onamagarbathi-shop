// IndexNow - tell Bing, Yandex and DuckDuckGo to re-crawl the shop.
//
// The only search-engine integration needing no account, no verification and no
// approval: ownership is proved by the key file at the site root. Google does
// not participate, so this complements Search Console rather than replacing it.
//
// Netlify Functions v2 format, matching the rest of this site.

const KEY = "25a0b33ac357dff8caf8140c17a69f0e";
const HOST = "onamagarbathi.com";

export default async (req) => {
  let urls = ["https://" + HOST + "/"];
  try {
    const b = await req.json();
    if (Array.isArray(b.urls) && b.urls.length) {
      // Only ever submit URLs on our own host: IndexNow rejects the entire
      // batch if any single entry belongs elsewhere.
      const own = b.urls.filter((u) => String(u).indexOf("https://" + HOST) === 0);
      if (own.length) urls = own.slice(0, 100);
    }
  } catch (e) { /* no body or bad JSON - fall back to the homepage */ }

  let result;
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST, key: KEY,
        keyLocation: "https://" + HOST + "/" + KEY + ".txt",
        urlList: urls
      })
    });
    const body = await r.text().catch(() => "");
    result = {
      ok: r.status === 200 || r.status === 202,
      status: r.status,
      // 422 nearly always means the key file is not reachable; saying so beats
      // a generic failure.
      detail: r.status === 422
        ? "Key file not reachable at https://" + HOST + "/" + KEY + ".txt"
        : body.slice(0, 200)
    };
  } catch (e) {
    result = { ok: false, status: 0, detail: String((e && e.message) || e) };
  }

  return new Response(JSON.stringify({ ...result, submitted: urls.length, urls }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};
