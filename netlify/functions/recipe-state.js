const { jsonResponse, upsertRecipeState } = require("./_lib/supabase");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_err) {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const recipeId = typeof body.recipeId === "string" ? body.recipeId.trim() : "";
  if (!recipeId) {
    return jsonResponse(400, { error: "recipeId is required." });
  }

  const hasRating = body.rating !== undefined;
  const hasCompleted = body.completed !== undefined;
  const hasTeddyApproved = body.teddyApproved !== undefined;
  const hasEase = body.ease !== undefined;

  if (!hasRating && !hasCompleted && !hasTeddyApproved && !hasEase) {
    return jsonResponse(400, { error: "Send rating, completed, teddyApproved, or ease." });
  }

  let rating;
  if (hasRating) {
    if (!Number.isInteger(body.rating) || body.rating < 0 || body.rating > 5) {
      return jsonResponse(400, { error: "rating must be an integer between 0 and 5." });
    }
    rating = body.rating === 0 ? null : body.rating;
  }

  let completed;
  if (hasCompleted) {
    if (typeof body.completed !== "boolean") {
      return jsonResponse(400, { error: "completed must be a boolean." });
    }
    completed = body.completed;
  }

  let teddyApproved;
  if (hasTeddyApproved) {
    if (body.teddyApproved !== null && typeof body.teddyApproved !== "boolean") {
      return jsonResponse(400, { error: "teddyApproved must be a boolean or null." });
    }
    teddyApproved = body.teddyApproved;
  }

  let ease;
  if (hasEase) {
    if (body.ease !== null && (!Number.isInteger(body.ease) || body.ease < 1 || body.ease > 3)) {
      return jsonResponse(400, { error: "ease must be 1, 2, 3, or null." });
    }
    ease = body.ease;
  }

  try {
    const state = await upsertRecipeState(recipeId, { rating, completed, teddyApproved, ease });
    return jsonResponse(200, { recipeId, state });
  } catch (err) {
    return jsonResponse(503, { error: err.message || "Failed to save recipe state." });
  }
};
