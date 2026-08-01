const {
  jsonResponse, authFromEvent, getUserById, updateUser,
  upsertSubscription, deleteSubscription,
} = require("./_lib/weight");

// Manages a user's push subscription + reminder settings.
// GET    -> { publicKey, reminder }
// POST   -> save subscription + enable reminder at { reminderTime, tz }
// DELETE -> remove subscription + disable reminder
exports.handler = async function handler(event) {
  const auth = authFromEvent(event);
  if (!auth) return jsonResponse(401, { error: "Not signed in." });
  const userId = auth.uid;
  const publicKey = process.env.WEIGHT_VAPID_PUBLIC || "";

  try {
    if (event.httpMethod === "GET") {
      const user = await getUserById(userId);
      const prefs = (user && user.prefs) || {};
      return jsonResponse(200, {
        publicKey,
        reminder: { enabled: !!prefs.reminderEnabled, time: prefs.reminderTime || "07:00", tz: prefs.tz || null },
      });
    }

    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
      if (body.subscription) await upsertSubscription(userId, body.subscription);
      const user = await getUserById(userId);
      const cur = (user && user.prefs) || {};
      const prefs = Object.assign({}, cur, {
        reminderEnabled: true,
        reminderTime: /^\d{2}:\d{2}$/.test(body.reminderTime) ? body.reminderTime : (cur.reminderTime || "07:00"),
        tz: body.tz || cur.tz || null,
      });
      await updateUser(userId, { prefs });
      return jsonResponse(200, { ok: true, reminder: { enabled: true, time: prefs.reminderTime, tz: prefs.tz } });
    }

    if (event.httpMethod === "DELETE") {
      let body; try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
      if (body.endpoint) await deleteSubscription(body.endpoint);
      const user = await getUserById(userId);
      const prefs = Object.assign({}, (user && user.prefs) || {}, { reminderEnabled: false });
      await updateUser(userId, { prefs });
      return jsonResponse(200, { ok: true, reminder: { enabled: false } });
    }

    return jsonResponse(405, { error: "Method not allowed." });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Push request failed." });
  }
};
