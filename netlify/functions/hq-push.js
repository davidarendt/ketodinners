// House Quest push subscription endpoint.
// GET    -> { publicKey }                 (VAPID public key for the client)
// POST   -> save a web-push subscription for the signed-in user
// DELETE -> remove a subscription by endpoint
const H = require("./_lib/housequest");

function vapidPublic() { return process.env.HQ_VAPID_PUBLIC || process.env.WEIGHT_VAPID_PUBLIC || ""; }

exports.handler = async function handler(event) {
  const auth = H.authFromEvent(event);
  if (!auth) return H.jsonResponse(401, { error: "Not signed in." });

  try {
    if (event.httpMethod === "GET") return H.jsonResponse(200, { publicKey: vapidPublic() });

    if (event.httpMethod === "POST") {
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return H.jsonResponse(400, { error: "Invalid JSON." }); }
      const sub = body.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return H.jsonResponse(400, { error: "Invalid push subscription." });
      await H.sb("POST", "/rest/v1/hq_push_subs?on_conflict=endpoint", {
        user_id: auth.uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
      });
      return H.jsonResponse(200, { ok: true });
    }

    if (event.httpMethod === "DELETE") {
      let body; try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
      if (body.endpoint) await H.sb("DELETE", `/rest/v1/hq_push_subs?endpoint=eq.${encodeURIComponent(body.endpoint)}`);
      return H.jsonResponse(200, { ok: true });
    }

    return H.jsonResponse(405, { error: "Method not allowed." });
  } catch (err) {
    return H.jsonResponse(503, { error: err.message || "Push request failed." });
  }
};
