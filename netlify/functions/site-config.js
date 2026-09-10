// Public site configuration.
//
// Serves the Meta Pixel ID to the browser. A pixel ID is public by design -
// it is visible in the page source of every site that runs one - so exposing
// it here leaks nothing. It lives in an env var rather than in the HTML so the
// pixel can be switched on, changed or turned off without a code push.
//
// Nothing secret is ever added to this endpoint. The Conversions API token is
// deliberately NOT here: that one is a real credential and stays server-side.

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Short cache: long enough to avoid a request on every page view,
      // short enough that switching the pixel off takes effect quickly.
      "Cache-Control": "public, max-age=300"
    },
    body: JSON.stringify({
      pixelId: process.env.META_PIXEL_ID || null
    })
  };
};
