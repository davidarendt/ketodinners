// Shared username+passcode auth primitives for the PWA side projects
// (The Almanac /weight, House Quest /house-quest). scrypt for passcodes; an
// HMAC-SHA256 signed token (payload.sig) sent as a Bearer header. Previously
// duplicated byte-for-byte in _lib/weight.js and _lib/housequest.js; the token
// format is UNCHANGED so existing sessions stay valid.

const crypto = require("crypto");

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
  if (!saltHex || !expectedHex) return false;
  const { hash } = hashPasscode(passcode, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Build token helpers bound to an app's TTL, bearer header name and secret env.
function makeAuth({ ttlMs, headerName, secretEnv, secretFallback }) {
  function authSecret() {
    const s = process.env[secretEnv] || (secretFallback ? process.env[secretFallback] : "") || "";
    if (!s) throw new Error(`${secretEnv} not configured.`);
    return s;
  }
  function signToken(userId) {
    const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + ttlMs }));
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
  // Reads the bearer token from the request (custom header or Authorization).
  function authFromEvent(event) {
    const headers = event.headers || {};
    const lower = headerName.toLowerCase();
    let token = headers[lower] || headers[headerName] || "";
    const authz = headers["authorization"] || headers["Authorization"] || "";
    if (!token && /^Bearer /i.test(authz)) token = authz.replace(/^Bearer /i, "").trim();
    return verifyToken(token);
  }
  return { signToken, verifyToken, authFromEvent, authSecret };
}

module.exports = { b64url, b64urlDecode, hashPasscode, verifyPasscode, makeAuth };
