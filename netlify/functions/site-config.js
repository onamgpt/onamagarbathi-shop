// Public site configuration.
//
// Serves the Meta Pixel ID to the browser. A pixel ID is public by design - it
// is visible in the page source of every site that runs one - so exposing it
// here leaks nothing. It lives in an env var rather than in the HTML so the
// pixel can be switched on, changed or turned off without a code push.
//
// Nothing secret is ever added here. The Conversions API token is deliberately
// NOT in this response: that one is a real credential and stays server-side.
//
// Netlify Functions v2 format (export default + Netlify.env.get) to match every
// other function on this site. The first version used exports.handler and
// process.env, which ran but could not read the environment - the pixel ID came
// back null and the pixel silently never loaded.

export default async () => {
  return new Response(
    JSON.stringify({ pixelId: Netlify.env.get("META_PIXEL_ID") || null }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // Short cache: avoids a request per page view, but switching the pixel
        // off still takes effect quickly.
        "Cache-Control": "public, max-age=300"
      }
    }
  );
};
