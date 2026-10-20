// Shared HTTP + Supabase REST helpers used by every function lib
// (_lib/supabase.js, _lib/weight.js, _lib/housequest.js). Previously each file
// carried its own near-identical copy. Behavior is the superset of all three:
// errors carry .status/.body so callers that inspect them (e.g. weight-auth's
// 409 race detection) keep working.

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
  if (!url || !anonKey) throw new Error("Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
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

module.exports = { jsonResponse, supabaseConfig, supabaseRequest };
