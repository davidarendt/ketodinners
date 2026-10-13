// Push sender (scheduled every ~15 min). Delivers unpushed notifications whose
// category is enabled for the recipient, as web-push to their devices. Honors
// quiet hours (holds 10pm–7am ET and releases at 7am). Inbox-only categories are
// marked handled without a push. Prunes dead (404/410) subscriptions.
const webpush = require("web-push");
const H = require("./_lib/housequest");

const SUBJECT = process.env.HQ_VAPID_SUBJECT || process.env.WEIGHT_VAPID_SUBJECT || "mailto:david@ologybrewing.com";
const TAB_LABELS = { pitch: "Pitches", vote: "Board", card: "Cards", comment: "Upgrade", finish: "Trophies", money: "Board", recap: "Trophies", plan: "Draft", nudge: "Pitches" };

exports.handler = async function handler() {
  const pub = process.env.HQ_VAPID_PUBLIC || process.env.WEIGHT_VAPID_PUBLIC;
  const priv = process.env.HQ_VAPID_PRIVATE || process.env.WEIGHT_VAPID_PRIVATE;
  if (!pub || !priv) return { statusCode: 200, body: "VAPID not configured" };
  webpush.setVapidDetails(SUBJECT, pub, priv);

  try {
    const p = H.etParts();
    const quietNow = p.hh >= 22 || p.hh < 7;
    const users = await H.getUsers();
    const byName = {}; for (const u of users) byName[u.name] = u;

    const pending = (await H.get("/rest/v1/hq_notifications?select=*&pushed=is.false&order=id.asc&limit=50")) || [];
    let sent = 0, held = 0;

    for (const n of pending) {
      const u = byName[n.to_user];
      if (!u) { await markPushed(n.id); continue; }
      const prefs = u.notif_prefs || {};
      if (!prefs[n.category]) { await markPushed(n.id); continue; } // inbox-only
      if (u.quiet_hours && quietNow) { held++; continue; }          // hold until 7am

      const subs = (await H.get(`/rest/v1/hq_push_subs?select=endpoint,p256dh,auth&user_id=eq.${u.id}`)) || [];
      const payload = JSON.stringify({ title: "House Quest", body: n.text, url: "/house-quest/" + (n.tab ? "#" + n.tab : "") });
      for (const sub of subs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            try { await H.sb("DELETE", `/rest/v1/hq_push_subs?endpoint=eq.${encodeURIComponent(sub.endpoint)}`); } catch (_) { /* ignore */ }
          }
        }
      }
      await markPushed(n.id);
    }
    return { statusCode: 200, body: `pushed ${sent}, held ${held}` };
  } catch (err) {
    return { statusCode: 200, body: "push-sender error: " + (err.message || err) };
  }
};

async function markPushed(id) { try { await H.sb("PATCH", `/rest/v1/hq_notifications?id=eq.${id}`, { pushed: true }); } catch (_) { /* ignore */ } }
