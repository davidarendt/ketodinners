const {
  jsonResponse, authFromEvent, getUserById, updateUser,
  listEntries, upsertEntry, upsertEntries, deleteEntry,
} = require("./_lib/weight");

// All methods require a valid session token (from /api/weight-auth).
// GET     -> { entries, user }
// POST    -> { entry }  (single) or { added, entries } (bulk import {entries:[...]})
// DELETE  -> { ok }     (?id=)
// PATCH   -> { user }   (update goalWeight / prefs)
exports.handler = async function handler(event) {
  const auth = authFromEvent(event);
  if (!auth) return jsonResponse(401, { error: "Not signed in." });
  const userId = auth.uid;

  try {
    if (event.httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      const limit = qs.limit ? Math.min(parseInt(qs.limit, 10) || 0, 5000) : undefined;
      const [entries, user] = await Promise.all([listEntries(userId, { limit }), getUserById(userId)]);
      if (!user) return jsonResponse(401, { error: "Account not found." });
      return jsonResponse(200, { entries, user });
    }

    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
      if (Array.isArray(body.entries)) {
        const added = await upsertEntries(userId, body.entries);
        return jsonResponse(200, { added: added.length, entries: added });
      }
      const entry = await upsertEntry(userId, body);
      return jsonResponse(200, { entry });
    }

    if (event.httpMethod === "PATCH") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
      const user = await updateUser(userId, { goalWeight: body.goalWeight, prefs: body.prefs });
      return jsonResponse(200, { user });
    }

    if (event.httpMethod === "DELETE") {
      const qs = event.queryStringParameters || {};
      let id = qs.id;
      if (!id) { try { id = (JSON.parse(event.body || "{}") || {}).id; } catch { /* ignore */ } }
      if (!id) return jsonResponse(400, { error: "id is required." });
      await deleteEntry(userId, id);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(405, { error: "Method not allowed." });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Request failed." });
  }
};
