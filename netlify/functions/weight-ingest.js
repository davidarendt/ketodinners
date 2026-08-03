const { jsonResponse, findUserByApiKey, upsertEntry, upsertEntries } = require("./_lib/weight");

// Normalize a date that might arrive as "2026-03-15", a full ISO timestamp, or
// any Date-parseable string, down to "YYYY-MM-DD".
function normDate(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

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

// Clean one item of a bulk batch into { date, weight, ...metrics } or null.
function normalizeBulkEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const R = {};
  Object.keys(raw).forEach(function (k) { R[String(k).trim()] = raw[k]; });
  const wRaw = R.weight !== undefined ? R.weight : R.Weight !== undefined ? R.Weight : R.value;
  const w = extractNumber(wRaw).value;
  if (!isFinite(w) || w <= 0) return null;
  const date = normDate(R.date || R.startDate || R.endDate || R.day);
  if (!date) return null;
  const out = { date: date, weight: Math.round(w * 10) / 10, source: "import" };
  ["bodyFatPct", "muscleMass", "bodyWaterPct", "visceralFat", "bmi", "waist"].forEach(function (k) {
    if (R[k] != null && R[k] !== "") { const n = extractNumber(R[k]).value; if (isFinite(n)) out[k] = Math.round(n * 10) / 10; }
  });
  if (typeof R.note === "string") out.note = R.note;
  return out;
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

  // Tolerate stray whitespace in field names (a common Shortcuts slip, e.g. "weight ").
  const F = {};
  Object.keys(body).forEach(function (k) { F[String(k).trim()] = body[k]; });

  const headers = event.headers || {};
  const qs = event.queryStringParameters || {};
  const key = F.key || F.Key || qs.key || headers["x-api-key"] || headers["X-Api-Key"] || "";

  const userRow = await findUserByApiKey(key).catch(() => null);
  if (!userRow) {
    return jsonResponse(401, {
      error: "Invalid or missing sync key.",
      hint: 'Copy your key from Settings → Apple Health sync (tap "Generate sync key" if there isn\'t one) and send it as the "key" field.',
      keyReceived: key ? String(key).slice(0, 6) + "…(" + String(key).length + " chars)" : "(none sent)",
      fieldsReceived: Object.keys(body),
    });
  }

  // Bulk history import: { key, entries: [ {weight/value, date/startDate}, … ] }.
  const bulk = Array.isArray(F.entries) ? F.entries : Array.isArray(body.entries) ? body.entries : null;
  if (bulk) {
    // De-dupe to one row per calendar day (later item in the batch wins) — a
    // single upsert can't touch the same (user, day) twice, and Health often
    // has multiple weigh-ins per day.
    const byDate = {};
    let invalid = 0;
    for (const raw of bulk) { const n = normalizeBulkEntry(raw); if (n) byDate[n.date] = n; else invalid++; }
    const clean = Object.keys(byDate).map(function (d) { return byDate[d]; });
    if (!clean.length) {
      return jsonResponse(400, {
        error: "No valid entries found in the batch.",
        hint: 'Each item needs a weight and a date, e.g. {"key":"…","entries":[{"date":"2026-01-04","weight":244}]}.',
        received: bulk.length,
        sample: bulk.length ? preview(bulk[0]) : null,
      });
    }
    const added = await upsertEntries(userRow.id, clean).catch(function () { return null; });
    if (added == null) return jsonResponse(503, { error: "Batch save failed." });
    return jsonResponse(200, { ok: true, imported: added.length, days: clean.length, received: bulk.length, skipped: invalid });
  }

  const rawWeight = F.weight !== undefined ? F.weight
    : F.Weight !== undefined ? F.Weight
    : F.bodyMass !== undefined ? F.bodyMass
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

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(F.date || ""))
    ? F.date
    : new Date().toISOString().slice(0, 10);

  // Health samples are doubles with float noise (e.g. 192.19999…) — round to 0.1.
  const round1 = (v) => (v == null || v === "" || isNaN(Number(v)) ? v : Math.round(Number(v) * 10) / 10);

  try {
    const entry = await upsertEntry(userRow.id, {
      date,
      weight: Math.round(parsed.value * 10) / 10,
      bodyFatPct: round1(F.bodyFatPct),
      muscleMass: round1(F.muscleMass),
      bodyWaterPct: round1(F.bodyWaterPct),
      visceralFat: round1(F.visceralFat),
      bmi: round1(F.bmi),
      waist: round1(F.waist),
      note: F.note,
      source: "import",
    });
    return jsonResponse(200, { ok: true, entry });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Save failed." });
  }
};
