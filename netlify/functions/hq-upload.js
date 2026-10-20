// House Quest before/after photo upload to the house-quest-photos bucket.
// Mirrors recipe-upload.js. The client downscales (max 2000px, JPEG q0.85)
// before sending so the base64 body stays under Netlify's 6 MB function cap.
const H = require("./_lib/housequest");

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const BUCKET = "house-quest-photos";

exports.handler = async function handler(event) {
  const auth = H.authFromEvent(event);
  if (!auth) return H.jsonResponse(401, { error: "Not signed in." });
  if (event.httpMethod !== "POST") return H.jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return H.jsonResponse(400, { error: "Invalid JSON." }); }

  const { filename, contentType, data } = body;
  if (!filename || !contentType || !data) return H.jsonResponse(400, { error: "filename, contentType, and data are required." });
  if (!ALLOWED_TYPES.includes(contentType)) return H.jsonResponse(400, { error: "Only JPEG, PNG, WebP, or GIF images are allowed." });

  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return H.jsonResponse(503, { error: "Storage not configured." });

  const ext = contentType.split("/")[1].replace("jpeg", "jpg");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase().replace(/\.[^.]+$/, "");
  const objectPath = Date.now() + "-" + safeName + "." + ext;

  let buffer;
  try { buffer = Buffer.from(data, "base64"); } catch { return H.jsonResponse(400, { error: "Invalid image data." }); }

  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey, "Content-Type": contentType },
    body: buffer,
  });
  if (!res.ok) {
    return H.jsonResponse(503, { error: "Upload failed." });
  }
  return H.jsonResponse(200, { url: `${url}/storage/v1/object/public/${BUCKET}/${objectPath}` });
};
