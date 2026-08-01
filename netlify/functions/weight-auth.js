const {
  jsonResponse, signToken, verifyPasscode, normalizeUsername, validUsername,
  findUserRow, createUser, mapUser,
} = require("./_lib/weight");

// POST { action: 'register' | 'login', username, passcode }
// Returns { token, user } on success.
exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }

  const action = body.action === "register" ? "register" : "login";
  const username = normalizeUsername(body.username);
  const passcode = String(body.passcode || "");

  if (!validUsername(username)) {
    return jsonResponse(400, { error: "Username must be 3–30 chars: letters, numbers, . _ - (start alphanumeric)." });
  }
  if (passcode.length < 4) {
    return jsonResponse(400, { error: "Passcode must be at least 4 characters." });
  }

  try {
    if (action === "register") {
      const existing = await findUserRow(username);
      if (existing) return jsonResponse(409, { error: "That username is taken." });
      let user;
      try {
        user = await createUser(username, passcode);
      } catch (err) {
        // Unique-violation race — someone registered the same name concurrently.
        if (err.status === 409 || /23505|duplicate|unique/i.test(err.body || err.message || "")) {
          return jsonResponse(409, { error: "That username is taken." });
        }
        throw err;
      }
      return jsonResponse(200, { token: signToken(user.id), user });
    }

    // login
    const row = await findUserRow(username);
    if (!row || !verifyPasscode(passcode, row.pw_salt, row.pw_hash)) {
      return jsonResponse(401, { error: "Incorrect username or passcode." });
    }
    return jsonResponse(200, { token: signToken(row.id), user: mapUser(row) });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Auth failed." });
  }
};
