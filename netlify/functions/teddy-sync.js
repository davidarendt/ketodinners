// Cross-device sync for Teddy's Day (/teddys-day/).
// The sync "code" IS the shared key — any device using the same code reads and
// writes the same state blob. No accounts, no auth token. Permissive-anon RLS;
// this function (anon key) is the only client and always scopes by code.
//
//   GET  /api/teddy-sync?code=xxx      -> { state, updated_at } | { state:null }
//   POST /api/teddy-sync {code,state}  -> { updated_at }  (upsert, last write wins)
const { jsonResponse, supabaseRequest } = require("./_lib/core-supabase");

const TABLE = "/rest/v1/teddy_state";
const codeOk = (c) => typeof c === "string" && /^[a-z0-9-]{3,40}$/.test(c);

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === "GET") {
      const code = ((event.queryStringParameters && event.queryStringParameters.code) || "").trim();
      if (!codeOk(code)) return jsonResponse(400, { error: "bad code" });
      const rows = await supabaseRequest(
        "GET",
        `${TABLE}?code=eq.${encodeURIComponent(code)}&select=state,updated_at`
      );
      if (!rows || !rows.length) return jsonResponse(200, { state: null, updated_at: null });
      return jsonResponse(200, { state: rows[0].state, updated_at: rows[0].updated_at });
    }

    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch (e) { return jsonResponse(400, { error: "bad json" }); }
      const code = (body.code || "").trim();
      if (!codeOk(code)) return jsonResponse(400, { error: "bad code" });
      const state = body.state;
      if (typeof state !== "object" || state === null || Array.isArray(state)) {
        return jsonResponse(400, { error: "bad state" });
      }
      const row = { code, state, updated_at: new Date().toISOString() };
      const res = await supabaseRequest("POST", `${TABLE}?on_conflict=code`, row);
      const updated_at = (res && res[0] && res[0].updated_at) || row.updated_at;
      return jsonResponse(200, { updated_at });
    }

    return jsonResponse(405, { error: "method not allowed" });
  } catch (err) {
    return jsonResponse(500, { error: "sync failed" });
  }
};
