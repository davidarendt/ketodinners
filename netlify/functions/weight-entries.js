const { jsonResponse, checkPin, listEntries, addEntry, addEntries, deleteEntry } = require("./_lib/weight");

// All methods are PIN-gated. GET doubles as the PIN-verification endpoint used
// by the unlock screen (401 => wrong PIN).
exports.handler = async function handler(event) {
  const pin = checkPin(event);
  if (!pin.ok) return jsonResponse(pin.code, { error: pin.error });

  try {
    if (event.httpMethod === "GET") {
      const qs = event.queryStringParameters || {};
      const limit = qs.limit ? Math.min(parseInt(qs.limit, 10) || 0, 5000) : undefined;
      const entries = await listEntries({ limit, since: qs.since });
      return jsonResponse(200, { entries });
    }

    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
      // Bulk import path: { entries: [...] }
      if (Array.isArray(body.entries)) {
        const added = await addEntries(body.entries);
        return jsonResponse(200, { added: added.length, entries: added });
      }
      const entry = await addEntry(body);
      return jsonResponse(200, { entry });
    }

    if (event.httpMethod === "DELETE") {
      const qs = event.queryStringParameters || {};
      let id = qs.id;
      if (!id) {
        try { id = (JSON.parse(event.body || "{}") || {}).id; } catch { /* ignore */ }
      }
      if (!id) return jsonResponse(400, { error: "id is required." });
      await deleteEntry(id);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(405, { error: "Method not allowed." });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Request failed." });
  }
};
