// Diagnostic for the order-notification path.
//
// Open this in a browser and it reports, in plain language, whether the
// environment variables exist, whether Telegram recognises the bot, and
// whether it can actually post to the orders group. No token typing.
//
// Tokens are never echoed back — only their length and last four characters,
// which is enough to tell one token from another without exposing it.

export default async () => {
  const out = [];
  const token = Netlify.env.get("TELEGRAM_BOT_TOKEN");
  const chat  = Netlify.env.get("TELEGRAM_WEBSITE_ORDERS_ID");

  const tail = (s) => s ? ("…" + String(s).slice(-4) + "  (" + String(s).length + " chars)") : "NOT SET";

  out.push("ORDER NOTIFICATION CHECK");
  out.push("========================");
  out.push("");
  out.push("TELEGRAM_BOT_TOKEN          : " + tail(token));
  out.push("TELEGRAM_WEBSITE_ORDERS_ID  : " + (chat || "NOT SET"));
  out.push("");

  if (!token) {
    out.push("PROBLEM: no bot token on this site. Nothing can be sent.");
    return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });
  }

  // 1. Is the token valid at all?
  let botName = null;
  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/getMe");
    const j = await r.json();
    if (j.ok) {
      botName = j.result.username;
      out.push("STEP 1  token valid    -> bot is @" + botName);
    } else {
      out.push("STEP 1  token REJECTED -> " + j.error_code + " " + j.description);
      out.push("");
      out.push("PROBLEM: Telegram does not recognise this token. The bot it");
      out.push("belonged to has been deleted, or the value is incomplete.");
      out.push("FIX: copy TELEGRAM_BOT_TOKEN from the rk-tracker-v2 site");
      out.push("     and paste it here, then redeploy.");
      return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });
    }
  } catch (e) {
    out.push("STEP 1  could not reach Telegram: " + String(e));
    return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });
  }

  if (!chat) {
    out.push("");
    out.push("PROBLEM: TELEGRAM_WEBSITE_ORDERS_ID is not set on this site.");
    out.push("FIX: add it with the value -5479964253, then redeploy.");
    return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });
  }

  // 2. Can the bot actually post to that group?
  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(chat),
        text: "Notification check — if you can read this, website orders will arrive here."
      })
    });
    const j = await r.json();
    if (j.ok) {
      out.push("STEP 2  message sent   -> check the group now");
      out.push("");
      out.push("EVERYTHING IS WORKING. Website orders will arrive in this group.");
      out.push("Next: remove the Telegram send from Apps Script, or every order");
      out.push("will arrive twice.");
    } else {
      out.push("STEP 2  send REJECTED  -> " + j.error_code + " " + j.description);
      out.push("");
      if (/chat not found/i.test(j.description || "")) {
        out.push("PROBLEM: @" + botName + " is not a member of group " + chat + ".");
        out.push("FIX: open that Telegram group, add @" + botName + " as a member.");
      } else if (/kicked|not enough rights|forbidden/i.test(j.description || "")) {
        out.push("PROBLEM: the bot was removed from the group, or lacks rights.");
        out.push("FIX: add @" + botName + " back and make it an admin.");
      } else {
        out.push("PROBLEM: " + j.description);
      }
    }
  } catch (e) {
    out.push("STEP 2  could not reach Telegram: " + String(e));
  }

  return new Response(out.join("\n"), { headers: { "Content-Type": "text/plain" } });
};
