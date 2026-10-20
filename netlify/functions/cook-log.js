const { jsonResponse, logCook, deleteLastCook, fetchCookLog } = require("./_lib/supabase");

async function cookSummary(recipeId) {
  const cookLog = await fetchCookLog([recipeId]);
  const log = cookLog[recipeId] || { count: 0, lastCookedAt: null, lastCookId: null };
  return { recipeId, cookCount: log.count, lastCookedAt: log.lastCookedAt, lastCookId: log.lastCookId };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
    const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
    if (!recipeId) return jsonResponse(400, { error: "recipeId is required." });
    try {
      await logCook(recipeId);
      return jsonResponse(200, await cookSummary(recipeId));
    } catch (err) {
      return jsonResponse(503, { error: "Failed to log cook." });
    }
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
    const { id, recipeId } = body;
    if (!id || !recipeId) return jsonResponse(400, { error: "id and recipeId are required." });
    try {
      await deleteLastCook(id);
      return jsonResponse(200, await cookSummary(recipeId));
    } catch (err) {
      return jsonResponse(503, { error: "Failed to undo cook." });
    }
  }

  return jsonResponse(405, { error: "Method not allowed." });
};
