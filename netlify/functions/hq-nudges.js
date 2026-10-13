// Vote nudges (scheduled daily ~10am ET). For each pitch that has waited 2+ days
// on someone's vote, sends one nudge to the person it's waiting on. Idempotent:
// skips an upgrade that already has a nudge notification.
const H = require("./_lib/housequest");

exports.handler = async function handler() {
  try {
    const p = H.etParts();
    if (p.hh < 10 || p.hh >= 12) return { statusCode: 200, body: "outside nudge window" };

    const twoDaysAgo = Date.now() - 2 * 86400e3;
    const pending = (await H.get("/rest/v1/hq_upgrades?select=id,title,by,created_at&status=eq.pending")) || [];
    const votes = (await H.get("/rest/v1/hq_votes?select=upgrade_id,user_name")) || [];
    const votedBy = {};
    for (const v of votes) (votedBy[v.upgrade_id] = votedBy[v.upgrade_id] || {})[v.user_name] = true;

    let sent = 0;
    for (const u of pending) {
      if (new Date(u.created_at).getTime() > twoDaysAgo) continue;
      const waiter = H.other(u.by); // the one who hasn't voted yet
      if ((votedBy[u.id] || {})[waiter]) continue;
      const existing = (await H.get(`/rest/v1/hq_notifications?select=id&upgrade_id=eq.${u.id}&category=eq.nudge&limit=1`)) || [];
      if (existing.length) continue;
      await H.notify(waiter, "nudge", `${u.title} has been waiting on your vote for 2 days.`, u.id);
      sent++;
    }
    return { statusCode: 200, body: `nudges sent: ${sent}` };
  } catch (err) {
    return { statusCode: 200, body: "nudges error: " + (err.message || err) };
  }
};
