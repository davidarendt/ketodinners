const { fetchRecipeStates, fetchCookLog, jsonResponse } = require("./_lib/supabase");
const { loadRecipes } = require("./_lib/recipes");

exports.handler = async function handler() {
  try {
    const recipeIds = loadRecipes().map((recipe) => recipe.id);
    const [states, cookLog] = await Promise.all([
      fetchRecipeStates(recipeIds),
      fetchCookLog(recipeIds),
    ]);
    for (const [id, log] of Object.entries(cookLog)) {
      if (!states[id]) states[id] = {};
      states[id].cookCount = log.count;
      states[id].lastCookedAt = log.lastCookedAt;
      states[id].lastCookId = log.lastCookId;
    }
    return jsonResponse(200, { states });
  } catch (err) {
    return jsonResponse(503, { error: "Recipe states unavailable." });
  }
};
