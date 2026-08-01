const webpush = require("web-push");
const {
  getReminderUsers, getSubsForUser, hasEntryOn, updateUser, deleteSubscription,
} = require("./_lib/weight");

const SUBJECT = process.env.WEIGHT_VAPID_SUBJECT || "mailto:david@ologybrewing.com";

// Local "HH:MM" and "YYYY-MM-DD" in a given IANA timezone (Node has full ICU).
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = {};
  fmt.formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  const hh = p.hour === "24" ? "00" : p.hour;
  return { hm: `${hh}:${p.minute}`, date: `${p.year}-${p.month}-${p.day}` };
}
// True if now is within [target, target+15min) — matches the */15 cron cadence.
function withinWindow(targetHM, nowHM) {
  const [th, tm] = targetHM.split(":").map(Number);
  const [nh, nm] = nowHM.split(":").map(Number);
  const d = (nh * 60 + nm) - (th * 60 + tm);
  return d >= 0 && d < 15;
}

exports.handler = async function handler() {
  const pub = process.env.WEIGHT_VAPID_PUBLIC, priv = process.env.WEIGHT_VAPID_PRIVATE;
  if (!pub || !priv) return { statusCode: 200, body: "VAPID not configured" };
  webpush.setVapidDetails(SUBJECT, pub, priv);

  let sent = 0, checked = 0;
  const users = await getReminderUsers();
  for (const u of users) {
    const prefs = u.prefs || {};
    const tz = prefs.tz || "America/New_York";
    const time = /^\d{2}:\d{2}$/.test(prefs.reminderTime) ? prefs.reminderTime : "07:00";
    let lp;
    try { lp = localParts(tz); } catch { lp = localParts("America/New_York"); }
    if (!withinWindow(time, lp.hm)) continue;
    if (prefs.lastReminded === lp.date) continue;
    checked++;

    // Mark handled up front (dedupe) regardless of outcome.
    const markDone = () => updateUser(u.id, { prefs: Object.assign({}, prefs, { lastReminded: lp.date }) });

    if (await hasEntryOn(u.id, lp.date)) { await markDone(); continue; }

    const subs = await getSubsForUser(u.id);
    const payload = JSON.stringify({ title: "The Almanac", body: "Time to weigh in.", url: "/weight/" });
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          try { await deleteSubscription(s.endpoint); } catch (e) { /* ignore */ }
        }
      }
    }
    await markDone();
  }
  return { statusCode: 200, body: `checked ${checked}, sent ${sent}` };
};
