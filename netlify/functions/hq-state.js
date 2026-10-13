// House Quest full state snapshot for the authenticated user. The phone renders
// entirely from this and re-fetches it after every action and on a ~20s poll.
const H = require("./_lib/housequest");

exports.handler = async function handler(event) {
  const auth = H.authFromEvent(event);
  if (!auth) return H.jsonResponse(401, { error: "Not signed in." });
  try {
    const user = await H.getUserById(auth.uid);
    if (!user) return H.jsonResponse(401, { error: "Account not found." });
    const state = await H.loadState(user.name);
    return H.jsonResponse(200, { state });
  } catch (err) {
    return H.jsonResponse(503, { error: err.message || "Could not load state." });
  }
};
