// Self-contained data + auth layer for the Almanac weight tracker.
// Kept separate from the recipe helpers so the whole /weight feature can be
// extracted later. Reuses SUPABASE_URL / SUPABASE_ANON_KEY. Auth uses Node's
// built-in crypto only (no dependencies): scrypt for passcodes, HMAC for tokens.

const crypto = require("crypto");

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
    headers.Prefer = restPath.includes("on_conflict=")
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation";
  }
  const response = await fetch(`${url}${restPath}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`Supabase request failed (${response.status}): ${text}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- auth utils
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function hashPasscode(passcode, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(passcode), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPasscode(passcode, saltHex, expectedHex) {
  const { hash } = hashPasscode(passcode, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function authSecret() {
  const s = process.env.WEIGHT_AUTH_SECRET || "";
  if (!s) throw new Error("WEIGHT_AUTH_SECRET not configured.");
  return s;
}
function signToken(userId) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", authSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", authSecret()).update(payload).digest());
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payload).toString("utf8")); } catch { return null; }
  if (!data || !data.uid || !data.exp || Date.now() > data.exp) return null;
  return { uid: data.uid };
}

// Reads the bearer token from the request and returns { uid } or null.
function authFromEvent(event) {
  const headers = event.headers || {};
  let token = headers["x-weight-token"] || headers["X-Weight-Token"] || "";
  const authz = headers["authorization"] || headers["Authorization"] || "";
  if (!token && /^Bearer /i.test(authz)) token = authz.replace(/^Bearer /i, "").trim();
  return verifyToken(token);
}

// ---------------------------------------------------------------- validation
function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}
function validUsername(u) {
  return /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(u); // 3–30 chars
}

// ---------------------------------------------------------------- user ops
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    goalWeight: row.goal_weight != null ? Number(row.goal_weight) : 175,
    prefs: row.prefs || {},
    apiKey: row.api_key || null,
  };
}

function newApiKey() { return "ak_" + crypto.randomBytes(24).toString("hex"); }

async function findUserRow(username) {
  const rows = await supabaseRequest(
    "GET",
    `/rest/v1/weight_users?select=*&username=eq.${encodeURIComponent(normalizeUsername(username))}&limit=1`
  );
  return (rows || [])[0] || null;
}

async function getUserById(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  const rows = await supabaseRequest("GET", `/rest/v1/weight_users?select=*&id=eq.${encodeURIComponent(safe)}&limit=1`);
  return mapUser((rows || [])[0] || null);
}

async function createUser(username, passcode) {
  const { salt, hash } = hashPasscode(passcode);
  const rows = await supabaseRequest("POST", "/rest/v1/weight_users", {
    username: normalizeUsername(username),
    pw_hash: hash,
    pw_salt: salt,
    api_key: newApiKey(),
  });
  return mapUser((rows || [])[0]);
}

async function findUserByApiKey(key) {
  const safe = String(key || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (safe.length < 16) return null;
  const rows = await supabaseRequest("GET",
    `/rest/v1/weight_users?select=*&api_key=eq.${encodeURIComponent(safe)}&limit=1`);
  return (rows || [])[0] || null;
}

async function regenerateApiKey(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  const rows = await supabaseRequest("PATCH",
    `/rest/v1/weight_users?id=eq.${encodeURIComponent(safe)}`, { api_key: newApiKey() });
  return mapUser((rows || [])[0] || null);
}

async function updateUser(id, patch) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  const payload = {};
  if (patch.goalWeight !== undefined && patch.goalWeight !== null) payload.goal_weight = Number(patch.goalWeight);
  if (patch.prefs !== undefined) payload.prefs = patch.prefs;
  if (!Object.keys(payload).length) return getUserById(id);
  const rows = await supabaseRequest("PATCH", `/rest/v1/weight_users?id=eq.${encodeURIComponent(safe)}`, payload);
  return mapUser((rows || [])[0] || null);
}

// ---------------------------------------------------------------- entry ops
// Optional body-composition metrics carried alongside weight.
const METRIC_COLS = {
  bodyFatPct: "body_fat_pct",
  muscleMass: "muscle_mass",
  bodyWaterPct: "body_water_pct",
  visceralFat: "visceral_fat",
  bmi: "bmi",
  waist: "waist",
};

function mapEntry(row) {
  if (!row) return null;
  const out = {
    id: row.id,
    date: row.entry_date,          // 'YYYY-MM-DD'
    weight: row.weight != null ? Number(row.weight) : null,
    source: row.source || "manual",
    timestamp: row.measured_at,
    note: row.note || null,
  };
  for (const key of Object.keys(METRIC_COLS)) {
    const col = METRIC_COLS[key];
    out[key] = row[col] != null ? Number(row[col]) : null;
  }
  return out;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const ENTRY_SELECT = "id,entry_date,weight,source,measured_at,note," + Object.values(METRIC_COLS).join(",");

async function listEntries(userId, { limit } = {}) {
  const safe = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  let q = `/rest/v1/weight_entries?select=${ENTRY_SELECT}&user_id=eq.${encodeURIComponent(safe)}&order=entry_date.desc`;
  if (limit) q += `&limit=${encodeURIComponent(limit)}`;
  const rows = await supabaseRequest("GET", q);
  return (rows || []).map(mapEntry);
}

function entryPayload(userId, input) {
  const date = isDate(input.date) ? input.date : null;
  if (!date) throw new Error("Valid date (YYYY-MM-DD) is required.");
  const weight = Number(input.weight);
  if (!isFinite(weight) || weight <= 0) throw new Error("Valid weight is required.");
  const payload = {
    user_id: userId,
    entry_date: date,
    weight,
    measured_at: input.timestamp ? new Date(input.timestamp).toISOString() : new Date(`${date}T12:00:00Z`).toISOString(),
    source: input.source === "import" ? "import" : "manual",
  };
  // Only include optional fields when provided, so a weight-only upsert doesn't
  // wipe metrics logged earlier for the same day.
  for (const key of Object.keys(METRIC_COLS)) {
    const v = input[key];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (isFinite(n)) payload[METRIC_COLS[key]] = n;
    }
  }
  if (typeof input.note === "string") payload.note = input.note.trim() || null;
  return payload;
}

// One entry per calendar day — latest write wins (upsert on user_id, entry_date).
async function upsertEntry(userId, input) {
  const payload = entryPayload(userId, input);
  const rows = await supabaseRequest("POST", "/rest/v1/weight_entries?on_conflict=user_id,entry_date", payload);
  return mapEntry((rows || [])[0]);
}

async function upsertEntries(userId, list) {
  const payloads = [];
  for (const item of list || []) {
    try { payloads.push(entryPayload(userId, item)); } catch { /* skip invalid */ }
  }
  if (!payloads.length) return [];
  const rows = await supabaseRequest("POST", "/rest/v1/weight_entries?on_conflict=user_id,entry_date", payloads);
  return (rows || []).map(mapEntry);
}

async function deleteEntry(userId, id) {
  const safeUser = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeId) throw new Error("id is required.");
  await supabaseRequest(
    "DELETE",
    `/rest/v1/weight_entries?id=eq.${encodeURIComponent(safeId)}&user_id=eq.${encodeURIComponent(safeUser)}`
  );
}

// ---------------------------------------------------------------- push subs
async function upsertSubscription(userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error("Invalid push subscription.");
  }
  await supabaseRequest("POST", "/rest/v1/weight_push_subs?on_conflict=endpoint", {
    user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
  });
}
async function deleteSubscription(endpoint) {
  await supabaseRequest("DELETE", `/rest/v1/weight_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`);
}
async function getSubsForUser(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  return (await supabaseRequest("GET",
    `/rest/v1/weight_push_subs?select=id,endpoint,p256dh,auth&user_id=eq.${encodeURIComponent(safe)}`)) || [];
}

// ---------------------------------------------------------------- reminders
async function getReminderUsers() {
  const rows = await supabaseRequest("GET",
    "/rest/v1/weight_users?select=id,prefs&prefs->>reminderEnabled=eq.true");
  return (rows || []).map((r) => ({ id: r.id, prefs: r.prefs || {} }));
}
async function hasEntryOn(userId, dateStr) {
  const safe = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  const rows = await supabaseRequest("GET",
    `/rest/v1/weight_entries?select=id&user_id=eq.${encodeURIComponent(safe)}&entry_date=eq.${encodeURIComponent(dateStr)}&limit=1`);
  return (rows || []).length > 0;
}

module.exports = {
  jsonResponse,
  // auth
  authFromEvent,
  signToken,
  verifyPasscode,
  normalizeUsername,
  validUsername,
  // users
  findUserRow,
  getUserById,
  createUser,
  updateUser,
  mapUser,
  findUserByApiKey,
  regenerateApiKey,
  // entries
  listEntries,
  upsertEntry,
  upsertEntries,
  deleteEntry,
  // push
  upsertSubscription,
  deleteSubscription,
  getSubsForUser,
  getReminderUsers,
  hasEntryOn,
};
