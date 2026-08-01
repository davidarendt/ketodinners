const { jsonResponse, findUserByApiKey, upsertEntry } = require("./_lib/weight");

// Apple Health / Shortcuts ingest. No session token — the personal api_key IS
// the credential. POST { key, weight, date?, bodyFatPct?, waist?, ... }.
// Accepts key via body, ?key=, or x-api-key header for Shortcut flexibility.
exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const headers = event.headers || {};
  const qs = event.queryStringParameters || {};
  const key = body.key || qs.key || headers["x-api-key"] || headers["X-Api-Key"] || "";

  try {
    const userRow = await findUserByApiKey(key);
    if (!userRow) return jsonResponse(401, { error: "Invalid sync key." });

    // Default the date to today (UTC) if the Shortcut didn't send one.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))
      ? body.date
      : new Date().toISOString().slice(0, 10);

    const entry = await upsertEntry(userRow.id, {
      date,
      weight: body.weight,
      bodyFatPct: body.bodyFatPct,
      muscleMass: body.muscleMass,
      bodyWaterPct: body.bodyWaterPct,
      visceralFat: body.visceralFat,
      bmi: body.bmi,
      waist: body.waist,
      note: body.note,
      source: "import",
    });
    return jsonResponse(200, { ok: true, entry });
  } catch (err) {
    return jsonResponse(err.message && /weight|date/i.test(err.message) ? 400 : 503, { error: err.message || "Ingest failed." });
  }
};
