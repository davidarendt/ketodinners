// Self-contained data layer for the weight tracker. Kept separate from the
// recipe helpers so the whole /weight feature can be extracted later.
// Reuses the same SUPABASE_URL / SUPABASE_ANON_KEY env vars.

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) throw new Error("Supabase not configured.");
  return { url, anonKey };
}

async function supabaseRequest(method, restPath, body) {
  const { url, anonKey } = supabaseConfig();
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  const response = await fetch(`${url}${restPath}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ---- PIN gate ----
// Correct PIN lives in the WEIGHT_PIN env var (set via `netlify env:set`).
// The client sends it in the `x-weight-pin` header on every request.
function checkPin(event) {
  const required = process.env.WEIGHT_PIN || "";
  if (!required) return { ok: false, code: 500, error: "Server PIN not configured (set WEIGHT_PIN)." };
  const headers = event.headers || {};
  const provided = (headers["x-weight-pin"] || headers["X-Weight-Pin"] || "").toString();
  if (provided.length !== required.length || provided !== required) {
    return { ok: false, code: 401, error: "Invalid PIN." };
  }
  return { ok: true };
}

// ---- mapping ----
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    measuredAt: row.measured_at,
    weight: row.weight,
    unit: row.unit || "lb",
    bodyFatPct: row.body_fat_pct,
    muscleMass: row.muscle_mass,
    bodyWaterPct: row.body_water_pct,
    bmi: row.bmi,
    boneMass: row.bone_mass,
    visceralFat: row.visceral_fat,
    bmr: row.bmr,
    metabolicAge: row.metabolic_age,
    note: row.note,
    source: row.source || "manual",
    metrics: row.metrics || null,
    createdAt: row.created_at,
  };
}

const NUM = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));

function toPayload(input) {
  const p = {};
  if (input.measuredAt) p.measured_at = new Date(input.measuredAt).toISOString();
  if (NUM(input.weight) !== undefined) p.weight = NUM(input.weight);
  if (input.unit) p.unit = input.unit === "kg" ? "kg" : "lb";
  if (NUM(input.bodyFatPct) !== undefined) p.body_fat_pct = NUM(input.bodyFatPct);
  if (NUM(input.muscleMass) !== undefined) p.muscle_mass = NUM(input.muscleMass);
  if (NUM(input.bodyWaterPct) !== undefined) p.body_water_pct = NUM(input.bodyWaterPct);
  if (NUM(input.bmi) !== undefined) p.bmi = NUM(input.bmi);
  if (NUM(input.boneMass) !== undefined) p.bone_mass = NUM(input.boneMass);
  if (NUM(input.visceralFat) !== undefined) p.visceral_fat = NUM(input.visceralFat);
  if (NUM(input.bmr) !== undefined) p.bmr = Math.round(NUM(input.bmr));
  if (NUM(input.metabolicAge) !== undefined) p.metabolic_age = Math.round(NUM(input.metabolicAge));
  if (typeof input.note === "string") p.note = input.note;
  if (input.source) p.source = input.source;
  if (input.metrics && typeof input.metrics === "object") p.metrics = input.metrics;
  return p;
}

// ---- operations ----
async function listEntries({ limit, since } = {}) {
  let q = "/rest/v1/weight_entries?select=*&order=measured_at.desc";
  if (since) q += `&measured_at=gte.${encodeURIComponent(new Date(since).toISOString())}`;
  if (limit) q += `&limit=${encodeURIComponent(limit)}`;
  const rows = await supabaseRequest("GET", q);
  return (rows || []).map(mapRow);
}

async function addEntry(input) {
  const payload = toPayload(input);
  if (payload.weight === undefined) throw new Error("weight is required.");
  const rows = await supabaseRequest("POST", "/rest/v1/weight_entries", payload);
  return mapRow((rows || [])[0]);
}

async function addEntries(list) {
  const payloads = (list || []).map(toPayload).filter((p) => p.weight !== undefined);
  if (!payloads.length) return [];
  const rows = await supabaseRequest("POST", "/rest/v1/weight_entries", payloads);
  return (rows || []).map(mapRow);
}

async function deleteEntry(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("id is required.");
  await supabaseRequest("DELETE", `/rest/v1/weight_entries?id=eq.${encodeURIComponent(safe)}`);
}

module.exports = {
  jsonResponse,
  checkPin,
  listEntries,
  addEntry,
  addEntries,
  deleteEntry,
};
