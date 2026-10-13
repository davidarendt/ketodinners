// House Quest login. Two fixed accounts (david, anne) seeded empty; the passcode
// is CLAIMED on first login (whatever you type becomes your passcode), then
// verified thereafter. No open registration. Returns { token, user }.
const H = require("./_lib/housequest");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return H.jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return H.jsonResponse(400, { error: "Invalid JSON." }); }

  const username = String(body.username || "").trim().toLowerCase();
  const passcode = String(body.passcode || "");
  if (username !== "david" && username !== "anne") return H.jsonResponse(401, { error: "Unknown account. This app is just for David and Anne." });
  if (passcode.length < 4) return H.jsonResponse(400, { error: "Passcode must be at least 4 characters." });

  try {
    const rows = await H.get(`/rest/v1/hq_users?select=*&username=eq.${encodeURIComponent(username)}&limit=1`);
    const row = (rows || [])[0];
    if (!row) return H.jsonResponse(401, { error: "Account not set up. Run the migration seed." });

    if (!row.pw_hash) {
      // Claim-on-first-login: set the passcode now.
      const { salt, hash } = H.hashPasscode(passcode);
      const updated = await H.sb("PATCH", `/rest/v1/hq_users?id=eq.${row.id}`, { pw_hash: hash, pw_salt: salt });
      const u = (updated || [row])[0];
      return H.jsonResponse(200, { token: H.signToken(u.id), user: { id: u.id, name: u.name, username: u.username }, claimed: true });
    }

    if (!H.verifyPasscode(passcode, row.pw_salt, row.pw_hash)) {
      return H.jsonResponse(401, { error: "Incorrect passcode." });
    }
    return H.jsonResponse(200, { token: H.signToken(row.id), user: { id: row.id, name: row.name, username: row.username } });
  } catch (err) {
    return H.jsonResponse(503, { error: err.message || "Login failed." });
  }
};
