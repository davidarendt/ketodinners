const { jsonResponse, upsertRecipeOverride } = require("./_lib/supabase");

function toNullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toStringArray(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

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

  const patch = {
    title: toNullableString(body.title),
    description: toNullableString(body.description),
    image: toNullableString(body.image),
    servings: toNullableString(body.servings),
    prepTime: toNullableString(body.prepTime),
    cookTime: toNullableString(body.cookTime),
    ingredients: toStringArray(body.ingredients),
    instructions: toStringArray(body.instructions),
  };

  const hasAnyField = Object.values(patch).some((value) => value !== undefined);
  if (!hasAnyField) {
    return jsonResponse(400, { error: "No editable fields provided." });
  }
  if (patch.ingredients === null || patch.instructions === null) {
    return jsonResponse(400, { error: "ingredients/instructions must be arrays of strings." });
  }

  if (patch.image && !/^https?:\/\/|^\//i.test(patch.image)) {
    return jsonResponse(400, { error: "Image must be an absolute http(s) URL or site-relative path." });
  }

  try {
    const saved = await upsertRecipeOverride(recipeId, patch);
    return jsonResponse(200, { recipeId, override: saved });
  } catch (err) {
    return jsonResponse(503, { error: "Failed to save recipe override." });
  }
};
