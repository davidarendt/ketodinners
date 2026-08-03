const { jsonResponse, findUserByApiKey, upsertEntry } = require("./_lib/weight");

// Pull a number out of whatever the Shortcut sends: a number, a string like
// "190.6 lb" / "190,6", or a Health-sample object (…value / quantity / magnitude).
function extractNumber(raw) {
  if (raw == null) return { value: NaN, note: "field was missing" };
  if (typeof raw === "number") return { value: raw, note: "number" };
  if (typeof raw === "boolean") return { value: NaN, note: "was a boolean" };
  if (typeof raw === "string") {
    const m = raw.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? { value: parseFloat(m[0]), note: "parsed from text" } : { value: NaN, note: "no number found in text" };
  }
  if (typeof raw === "object") {
    for (const k of ["value", "Value", "quantity", "Quantity", "magnitude", "doubleValue", "amount"]) {
      if (raw[k] != null) {
        const inner = extractNumber(raw[k]);
        if (isFinite(inner.value)) return { value: inner.value, note: "read from ." + k };
      }
    }
    return { value: NaN, note: "was an object with no value/quantity field" };
  }
  return { value: NaN, note: "unsupported type: " + typeof raw };
}

function preview(v) {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return String(s).slice(0, 140);
  } catch (e) { return String(v).slice(0, 140); }
}

// Apple Health / Shortcuts ingest. The personal api_key IS the credential.
// POST { key, weight, date?, bodyFatPct?, waist?, ... }.
exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Use POST to this URL (in Shortcuts: Get Contents of URL → Method: POST)." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, {
      error: "The request body wasn't valid JSON.",
      hint: "In Shortcuts: Get Contents of URL → Request Body → JSON (not Form/File), with a header Content-Type: application/json.",
      received: preview(event.body),
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(400, {
      error: 'The JSON body must be an object, e.g. {"key":"ak_…","weight":190.6}.',
      receivedType: Array.isArray(body) ? "array" : typeof body,
    });
  }

  const headers = event.headers || {};
  const qs = event.queryStringParameters || {};
  const key = body.key || body.Key || qs.key || headers["x-api-key"] || headers["X-Api-Key"] || "";

  const userRow = await findUserByApiKey(key).catch(() => null);
  if (!userRow) {
    return jsonResponse(401, {
      error: "Invalid or missing sync key.",
      hint: 'Copy your key from Settings → Apple Health sync (tap "Generate sync key" if there isn\'t one) and send it as the "key" field.',
      keyReceived: key ? String(key).slice(0, 6) + "…(" + String(key).length + " chars)" : "(none sent)",
      fieldsReceived: Object.keys(body),
    });
  }

  const rawWeight = body.weight !== undefined ? body.weight
    : body.Weight !== undefined ? body.Weight
    : body.bodyMass !== undefined ? body.bodyMass
    : undefined;
  const parsed = extractNumber(rawWeight);
  if (!isFinite(parsed.value) || parsed.value <= 0) {
    return jsonResponse(400, {
      error: "Couldn't read a weight from the request.",
      hint: 'In Shortcuts use the "Weight" sample type, and set the JSON "weight" field to that value. A number (190.6) or text ("190.6 lb") both work.',
      diagnostics: {
        weightValue: preview(rawWeight),
        weightType: Array.isArray(rawWeight) ? "array" : typeof rawWeight,
        why: parsed.note,
        fieldsReceived: Object.keys(body),
      },
    });
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))
    ? body.date
    : new Date().toISOString().slice(0, 10);

  try {
    const entry = await upsertEntry(userRow.id, {
      date,
      weight: parsed.value,
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
    return jsonResponse(503, { error: err.message || "Save failed." });
  }
};
