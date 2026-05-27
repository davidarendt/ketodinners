function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  return { url, anonKey };
}

function assertSupabaseConfigured() {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  }
  return cfg;
}

async function supabaseRequest(method, restPath, body) {
  const { url, anonKey } = assertSupabaseConfigured();
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers.Prefer =
      restPath.includes("on_conflict=") ? "resolution=merge-duplicates,return=representation" : "return=representation";
  }
  const response = await fetch(`${url}${restPath}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchRecipeStates(recipeIds) {
  if (!recipeIds.length) return {};
  const quoted = recipeIds
    .map((id) => id.replace(/[^a-zA-Z0-9_.-]/g, ""))
    .filter(Boolean)
    .map((id) => `"${id}"`)
    .join(",");
  if (!quoted) return {};
  const rows = await supabaseRequest(
    "GET",
    `/rest/v1/recipe_states?select=recipe_id,rating,completed,completed_at,teddy_approved,ease,updated_at&recipe_id=in.(${encodeURIComponent(
      quoted
    )})`
  );
  const states = {};
  for (const row of rows || []) {
    states[row.recipe_id] = {
      rating: row.rating,
      completed: Boolean(row.completed),
      completedAt: row.completed_at,
      teddyApproved: row.teddy_approved ?? null,
      ease: row.ease ?? null,
      updatedAt: row.updated_at,
    };
  }
  return states;
}

async function fetchRecipeOverrides(recipeIds) {
  if (!recipeIds.length) return {};
  const quoted = recipeIds
    .map((id) => id.replace(/[^a-zA-Z0-9_.-]/g, ""))
    .filter(Boolean)
    .map((id) => `"${id}"`)
    .join(",");
  if (!quoted) return {};
  const rows = await supabaseRequest(
    "GET",
    `/rest/v1/recipe_overrides?select=recipe_id,title,description,image,servings,prep_time,cook_time,ingredients,instructions,updated_at&recipe_id=in.(${encodeURIComponent(
      quoted
    )})`
  );
  const overrides = {};
  for (const row of rows || []) {
    overrides[row.recipe_id] = {
      title: row.title || null,
      description: row.description || null,
      image: row.image || null,
      servings: row.servings || null,
      prepTime: row.prep_time || null,
      cookTime: row.cook_time || null,
      ingredients: Array.isArray(row.ingredients) ? row.ingredients : null,
      instructions: Array.isArray(row.instructions) ? row.instructions : null,
      updatedAt: row.updated_at || null,
    };
  }
  return overrides;
}

async function upsertRecipeState(recipeId, { rating, completed, teddyApproved, ease } = {}) {
  const payload = { recipe_id: recipeId, updated_at: new Date().toISOString() };
  if (rating !== undefined) payload.rating = rating;
  if (completed !== undefined) {
    payload.completed = completed;
    if (completed) payload.completed_at = new Date().toISOString();
    // When uncompleting, leave completed_at intact so "last cooked" date is preserved
  }
  if (teddyApproved !== undefined) payload.teddy_approved = teddyApproved;
  if (ease !== undefined) payload.ease = ease;
  const rows = await supabaseRequest("POST", "/rest/v1/recipe_states?on_conflict=recipe_id", payload);
  const row = (rows || [])[0] || payload;
  return {
    rating: row.rating ?? null,
    completed: Boolean(row.completed),
    completedAt: row.completed_at || null,
    teddyApproved: row.teddy_approved ?? null,
    ease: row.ease ?? null,
    updatedAt: row.updated_at || payload.updated_at,
  };
}

async function upsertRecipeOverride(recipeId, patch) {
  const payload = { recipe_id: recipeId, updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.image !== undefined) payload.image = patch.image;
  if (patch.servings !== undefined) payload.servings = patch.servings;
  if (patch.prepTime !== undefined) payload.prep_time = patch.prepTime;
  if (patch.cookTime !== undefined) payload.cook_time = patch.cookTime;
  if (patch.ingredients !== undefined) payload.ingredients = patch.ingredients;
  if (patch.instructions !== undefined) payload.instructions = patch.instructions;

  const rows = await supabaseRequest("POST", "/rest/v1/recipe_overrides?on_conflict=recipe_id", payload);
  const row = (rows || [])[0] || payload;
  return {
    title: row.title || null,
    image: row.image || null,
    servings: row.servings || null,
    prepTime: row.prep_time || null,
    cookTime: row.cook_time || null,
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : null,
    instructions: Array.isArray(row.instructions) ? row.instructions : null,
    updatedAt: row.updated_at || payload.updated_at,
  };
}

module.exports = {
  fetchRecipeOverrides,
  fetchRecipeStates,
  jsonResponse,
  upsertRecipeOverride,
  upsertRecipeState,
};
