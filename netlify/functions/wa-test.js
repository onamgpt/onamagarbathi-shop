// Fire a single WhatsApp template at one number, on demand, from the browser.
//
//   /.netlify/functions/wa-test?to=918310368142&template=order_confirmation
//   /.netlify/functions/wa-test                      -> lists what's available
//
// Sample values below deliberately mirror the parameter counts the real senders
// use. If a template's variable count is changed in WhatsApp Manager without
// changing them here, this endpoint fails the same way a live order would —
// which is the point: find it here, not on a customer's phone.

const SAMPLES = {
  order_confirmation: ["Test Customer", "TEST-001", "\u20b91,250"],
  order_shipped:      ["Test Customer", "TEST-001", "Professional Transport"],
  order_delivered:    ["Test Customer", "TEST-001"],
  reorder_nudge:      ["Test Customer"],
};

export default async (request) => {
  const url = new URL(request.url);
  const to = (url.searchParams.get("to") || "").replace(/[^\d]/g, "");
  const template = url.searchParams.get("template") || "";

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const out = [];
  const reply = () =>
    new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });

  out.push("WhatsApp template test");
  out.push("======================");
  out.push("");
  out.push("WHATSAPP_ACCESS_TOKEN     " + (token ? "set" : "MISSING"));
  out.push("WHATSAPP_PHONE_NUMBER_ID  " + (phoneId ? phoneId : "MISSING"));
  out.push("");

  if (!token || !phoneId) {
    out.push("PROBLEM: add the missing variable in Netlify env vars, then redeploy.");
    return reply();
  }

  if (!to || !SAMPLES[template]) {
    out.push("Usage: ?to=<number with country code>&template=<name>");
    out.push("");
    out.push("Templates: " + Object.keys(SAMPLES).join(", "));
    out.push("");
    out.push("Example:");
    out.push("  ?to=918310368142&template=order_confirmation");
    return reply();
  }

  const params = SAMPLES[template];
  out.push("Sending '" + template + "' to " + to);
  out.push("Values: " + params.join(" | "));
  out.push("");

  try {
    const res = await fetch(
      "https://graph.facebook.com/v21.0/" + phoneId + "/messages",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: params.map((p) => ({ type: "text", text: String(p) })),
              },
            ],
          },
        }),
      }
    );

    const data = await res.json();

    if (res.ok && data.messages) {
      out.push("SENT. Check the phone.");
      out.push("Message id: " + data.messages[0].id);
      out.push("");
      out.push("Delivery is not guaranteed by this result — a template can be");
      out.push("accepted here and still not arrive if the number never opted in.");
      return reply();
    }

    const err = data.error || {};
    out.push("FAILED (HTTP " + res.status + ")");
    out.push("Code:    " + (err.code || "?"));
    out.push("Message: " + (err.message || JSON.stringify(data)));
    if (err.error_data && err.error_data.details) {
      out.push("Details: " + err.error_data.details);
    }
    out.push("");

    if (err.code === 132000) {
      out.push("This means the number of values sent does not match the number of");
      out.push("variables in the template. Compare the count above against the");
      out.push("template body in WhatsApp Manager.");
    } else if (err.code === 132001) {
      out.push("This means the template name or language does not exist. Check the");
      out.push("name is exact, and that its language is English (code 'en').");
    } else if (err.code === 132015 || err.code === 132005) {
      out.push("This means the template is paused or not yet approved. Check its");
      out.push("status is Active in WhatsApp Manager.");
    } else if (err.code === 131030) {
      out.push("This number is not on the allowed recipient list. While the app is");
      out.push("in development mode, only numbers added under API Setup can receive.");
    } else if (err.code === 190) {
      out.push("The access token is invalid or expired. Generate a new permanent");
      out.push("token from the system user and update it in Netlify env vars.");
    }
    return reply();
  } catch (e) {
    out.push("ERROR: " + e.message);
    return reply();
  }
};
