const { fetchRecipeOverrides, jsonResponse } = require("./_lib/supabase");
const { loadRecipes } = require("./_lib/recipes");

exports.handler = async function handler() {
  try {
    const baseRecipes = loadRecipes();
    let overrides = {};
    try {
      overrides = await fetchRecipeOverrides(baseRecipes.map((recipe) => recipe.id));
    } catch (_err) {
      overrides = {};
    }

    const recipes = baseRecipes.map((recipe) => {
      const o = overrides[recipe.id] || {};
      const ingredients = Array.isArray(o.ingredients) ? o.ingredients : recipe.ingredients;
      const instructions = Array.isArray(o.instructions) ? o.instructions : recipe.instructions || [];
      return {
        id: recipe.id,
        title: o.title || recipe.title,
        positions: recipe.positions || [],
        day: recipe.day || null,
        servings: o.servings || recipe.servings,
        image: o.image || recipe.image,
        prepTime: o.prepTime || recipe.prepTime || null,
        cookTime: o.cookTime || recipe.cookTime || null,
        ingredientCount: ingredients.length,
        ingredients,
        instructions,
      };
    });
    return jsonResponse(200, { recipes });
  } catch (err) {
    return jsonResponse(500, { error: err.message || "Failed to load recipes." });
  }
};
