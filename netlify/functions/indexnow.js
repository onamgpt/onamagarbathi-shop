// IndexNow — tell Bing, Yandex and DuckDuckGo to re-crawl the shop.
//
// Chosen because it is the only search-engine integration that needs no
// account, no verification and no approval: ownership is proved by hosting a
// key file at the site root. Google does not participate, so this does not
// replace Search Console — it covers the engines behind Copilot, ChatGPT
// search and DuckDuckGo, which are far less contested than Google.
//
// Called automatically after a product is added or edited, and manually from
// the Growth tab.

const https = require("https");

const KEY = "25a0b33ac357dff8caf8140c17a69f0e";
const HOST = "onamagarbathi.com";

function submit(urls) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: "https://" + HOST + "/" + KEY + ".txt",
      urlList: urls
    });
    const req = https.request({
      hostname: "api.indexnow.org",
      path: "/indexnow",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", (c) => { if (body.length < 500) body += c; });
      res.on("end", () => {
        // 200 and 202 both mean accepted. 422 usually means the key file
        // is not reachable yet - worth saying so rather than "failed".
        resolve({
          ok: res.statusCode === 200 || res.statusCode === 202,
          status: res.statusCode,
          detail: res.statusCode === 422
            ? "Key file not reachable at https://" + HOST + "/" + KEY + ".txt"
            : (body.slice(0, 200) || "")
        });
      });
    });
    req.on("error", (e) => resolve({ ok: false, status: 0, detail: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, detail: "timed out" }); });
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const H = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  let urls = ["https://" + HOST + "/"];
  try {
    if (event && event.body) {
      const b = JSON.parse(event.body);
      if (Array.isArray(b.urls) && b.urls.length) {
        // Only ever submit URLs on our own host; IndexNow rejects the whole
        // batch if any entry belongs elsewhere.
        urls = b.urls.filter((u) => String(u).indexOf("https://" + HOST) === 0).slice(0, 100);
      }
    }
  } catch (e) { /* fall back to the homepage */ }

  if (!urls.length) urls = ["https://" + HOST + "/"];

  const r = await submit(urls);
  return {
    statusCode: 200,
    headers: H,
    body: JSON.stringify({ ok: r.ok, status: r.status, detail: r.detail, submitted: urls.length, urls: urls })
  };
};
