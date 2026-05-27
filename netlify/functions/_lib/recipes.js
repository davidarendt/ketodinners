const fs = require("fs");
const path = require("path");

const UNIT_ALIASES = {
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  cup: "cup",
  cups: "cup",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  clove: "clove",
  cloves: "clove",
  bag: "bag",
  bags: "bag",
  can: "can",
  cans: "can",
};

const CATEGORIES = {
  Produce: [
    "spinach",
    "tomato",
    "lemon",
    "cucumber",
    "onion",
    "garlic",
    "parsley",
    "dill",
    "pepper",
    "zucchini",
    "broccoli",
    "cauliflower",
  ],
  "Meat and Seafood": ["beef", "chicken", "turkey", "pork", "shrimp", "salmon", "fish", "lamb", "duck"],
  "Dairy and Eggs": ["feta", "yogurt", "cheese", "milk", "cream", "butter", "egg"],
  "Pantry and Spices": [
    "olive oil",
    "oil",
    "salt",
    "paprika",
    "oregano",
    "cumin",
    "rice",
    "flour",
    "vinegar",
    "olives",
  ],
};

const CATEGORIES_ORDER = ["Produce", "Meat and Seafood", "Dairy and Eggs", "Pantry and Spices", "Other"];

function recipesDir() {
  const fromCwd = path.resolve(process.cwd(), "recipes", "claude");
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  return path.resolve(__dirname, "..", "..", "..", "recipes", "claude");
}

function rawHtmlDir() {
  const fromCwd = path.resolve(process.cwd(), "recipes", "raw-html");
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  return path.resolve(__dirname, "..", "..", "..", "recipes", "raw-html");
}

function parseFrontmatter(lines) {
  if (lines.length < 3 || lines[0].trim() !== "---") {
    return {};
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return {};
  }
  const data = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) data[key] = value;
  }
  return data;
}

function extractIngredients(lines) {
  const ingredients = [];
  let inIngredients = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("## ingredients")) {
      inIngredients = true;
      continue;
    }
    if (inIngredients && trimmed.startsWith("## ")) {
      break;
    }
    if (!inIngredients) continue;
    if (trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim();
      if (item) ingredients.push(item);
    }
  }
  return ingredients;
}

function extractInstructions(lines) {
  const instructions = [];
  let inInstructions = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("## instructions")) {
      inInstructions = true;
      continue;
    }
    if (inInstructions && trimmed.startsWith("## ")) {
      break;
    }
    if (!inInstructions) continue;
    if (/^\d+\.\s+/.test(trimmed)) {
      instructions.push(trimmed.replace(/^\d+\.\s+/, "").trim());
    }
  }
  return instructions;
}

function sanitizeImageValue(image) {
  if (!image) return null;
  const value = image.trim();
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  return null;
}

function loadMarkdownRecipes() {
  const dir = recipesDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort();

  return files.map((name) => {
    const abs = path.join(dir, name);
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const fm = parseFrontmatter(lines);
    let title = fm.title || "";
    if (!title) {
      title = name.replace(/\.md$/i, "");
      for (const line of lines) {
        if (line.startsWith("# ")) {
          title = line.slice(2).trim();
          break;
        }
      }
    }
    const id = name.replace(/\.md$/i, "");
    const ingredients = extractIngredients(lines);
    const instructions = extractInstructions(lines);
    const prepTime = fm.prep_time || null;
    const cookTime = fm.cook_time || null;
    return {
      id,
      title,
      servings: fm.servings || null,
      image: sanitizeImageValue(fm.image || null),
      prepTime,
      cookTime,
      ingredients,
      instructions,
    };
  });
}

function extractJsonLd(html) {
  const match = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const raw = match[1].trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.find((item) => item && item["@type"] === "Recipe") || parsed[0] || null;
    }
    return parsed;
  } catch (_err) {
    return null;
  }
}

function extractFallbackImage(html) {
  const match = html.match(/<img[^>]*src="([^"]+)"/i);
  if (!match) return null;
  return sanitizeImageValue(match[1]);
}

function parseIsoDuration(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const mins = Number(match[2] || 0);
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${mins} min`);
  if (!parts.length) return null;
  return parts.join(" ");
}

function extractInstructionsFromJsonLd(jsonLd) {
  const source = jsonLd.recipeInstructions;
  if (!Array.isArray(source)) return [];
  const instructions = [];
  for (const item of source) {
    if (typeof item === "string") {
      if (item.trim()) instructions.push(item.trim());
      continue;
    }
    if (item && typeof item.text === "string" && item.text.trim()) {
      instructions.push(item.text.trim());
    }
  }
  return instructions;
}

function loadRawHtmlRecipes() {
  const dir = rawHtmlDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".html") && name.toLowerCase() !== "index.html")
    .sort();

  const results = [];
  for (const name of files) {
    const abs = path.join(dir, name);
    const html = fs.readFileSync(abs, "utf8");
    const jsonLd = extractJsonLd(html) || {};
    const id = name.replace(/\.html$/i, "");
    const rawTitle = typeof jsonLd.name === "string" && jsonLd.name.trim()
      ? jsonLd.name.trim()
      : id.replace(/-/g, " ");
    const title = rawTitle.replace(/\b\w/g, (c) => c.toUpperCase());
    const ingredients = Array.isArray(jsonLd.recipeIngredient)
      ? jsonLd.recipeIngredient.filter((item) => typeof item === "string" && item.trim())
      : [];
    const instructions = extractInstructionsFromJsonLd(jsonLd);
    const servings = typeof jsonLd.recipeYield === "string" ? jsonLd.recipeYield.trim() : null;
    const prepTime = parseIsoDuration(jsonLd.prepTime);
    const cookTime = parseIsoDuration(jsonLd.cookTime);
    const imageFromLd =
      typeof jsonLd.image === "string"
        ? jsonLd.image
        : Array.isArray(jsonLd.image) && typeof jsonLd.image[0] === "string"
          ? jsonLd.image[0]
          : null;
    const image = sanitizeImageValue(imageFromLd) || extractFallbackImage(html);
    results.push({
      id,
      title,
      servings,
      image,
      prepTime,
      cookTime,
      ingredients,
      instructions,
    });
  }
  return results;
}

function parseIndexHtmlOrder() {
  const indexFile = path.join(rawHtmlDir(), "index.html");
  if (!fs.existsSync(indexFile)) return {};
  const html = fs.readFileSync(indexFile, "utf8");
  const orderMap = {};
  let sortKey = 0;
  const blocks = html.split('<div class="week-card">');
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    const weekMatch = block.match(/Week\s+(\d+)/);
    const week = weekMatch ? parseInt(weekMatch[1], 10) : i;
    const rowRe = /href="([^"]+\.html)"\s+class="meal-row"/g;
    let m;
    while ((m = rowRe.exec(block)) !== null) {
      const id = m[1].replace(/\.html$/i, "");
      if (!orderMap[id]) orderMap[id] = [];
      orderMap[id].push({ week, sortKey: sortKey++ });
    }
  }
  return orderMap;
}

function loadRecipes() {
  const mdRecipes = loadMarkdownRecipes();
  const htmlRecipes = loadRawHtmlRecipes();
  const seenTitles = new Set(mdRecipes.map((recipe) => recipe.title.toLowerCase().trim()));
  const merged = [...mdRecipes];
  for (const recipe of htmlRecipes) {
    const titleKey = recipe.title.toLowerCase().trim();
    if (seenTitles.has(titleKey)) {
      continue;
    }
    seenTitles.add(titleKey);
    merged.push(recipe);
  }
  const orderMap = parseIndexHtmlOrder();
  if (Object.keys(orderMap).length > 0) {
    for (const recipe of merged) {
      const entries = orderMap[recipe.id];
      if (entries && entries.length > 0) {
        recipe.weeks = entries.map((e) => e.week);
        recipe._sortKey = entries[0].sortKey;
      } else {
        recipe._sortKey = 99999;
      }
    }
    merged.sort((a, b) => (a._sortKey || 99999) - (b._sortKey || 99999));
  }
  return merged;
}

function normalizeName(text) {
  return text.toLowerCase().replace("to taste", "").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
}

function canonicalParenthetical(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/\beach\b/g, "")
    .replace(/\bper\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*(oz|lb|g|kg)\b/g, "$1 $2")
    .replace(/[^\w\s./-]/g, "")
    .trim();
  return cleaned;
}

function splitNameAndQualifier(name) {
  const trimmed = name.trim();
  const leadingParen = trimmed.match(/^\(([^)]+)\)\s*(.+)$/);
  if (leadingParen) {
    return {
      qualifier: canonicalParenthetical(leadingParen[1]),
      baseName: leadingParen[2].trim(),
    };
  }
  const inlineParen = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (inlineParen) {
    return {
      qualifier: canonicalParenthetical(inlineParen[2]),
      baseName: inlineParen[1].trim(),
    };
  }
  return { qualifier: "", baseName: trimmed };
}

function parseNumber(text) {
  const value = text.trim();
  if (/^\d+\s+\d+\/\d+$/.test(value)) {
    const [whole, frac] = value.split(/\s+/);
    const [n, d] = frac.split("/").map(Number);
    if (!d) return null;
    return Number(whole) + n / d;
  }
  if (/^\d+\/\d+$/.test(value)) {
    const [n, d] = value.split("/").map(Number);
    if (!d) return null;
    return n / d;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  return null;
}

function parseIngredient(line) {
  const match = line.match(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+([A-Za-z]+)?\s+(.+?)\s*$/);
  if (!match) {
    return { raw: line, name: line.trim(), quantity: null, unit: null };
  }
  const quantity = parseNumber(match[1]);
  if (quantity === null) {
    return { raw: line, name: line.trim(), quantity: null, unit: null };
  }
  const unitRaw = match[2] || null;
  const unit = unitRaw ? UNIT_ALIASES[unitRaw.toLowerCase()] || unitRaw.toLowerCase() : null;
  return { raw: line, name: match[3].trim(), quantity, unit };
}

function formatQuantity(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded);
}

function categorize(name) {
  const low = name.toLowerCase();
  for (const [category, words] of Object.entries(CATEGORIES)) {
    if (words.some((word) => low.includes(word))) {
      return category;
    }
  }
  return "Other";
}

function buildShoppingList(selectedRecipes) {
  const aggregated = {};
  const displayNames = {};
  const asNeeded = {};

  for (const recipe of selectedRecipes) {
    for (const line of recipe.ingredients) {
      const parsed = parseIngredient(line);
      const parts = splitNameAndQualifier(parsed.name);
      const normName = normalizeName(parts.baseName);
      const qualifier = parts.qualifier;
      if (parsed.quantity !== null) {
        const key = `${normName}||${parsed.unit || ""}||${qualifier}`;
        aggregated[key] = (aggregated[key] || 0) + parsed.quantity;
        const printableQualifier = qualifier ? ` (${qualifier})` : "";
        displayNames[key] = `${parts.baseName}${printableQualifier}`;
      } else {
        if (!asNeeded[normName]) {
          asNeeded[normName] = parts.baseName;
        }
      }
    }
  }

  const consolidated = {};
  for (const key of Object.keys(aggregated).sort()) {
    const [normName, unit] = key.split("||");
    const name = displayNames[key] || normName;
    const unitPart = unit ? ` ${unit}` : "";
    const line = `${formatQuantity(aggregated[key])}${unitPart} ${name}`;
    const category = categorize(name);
    if (!consolidated[category]) consolidated[category] = [];
    consolidated[category].push(line);
  }

  const needed = {};
  for (const normName of Object.keys(asNeeded).sort()) {
    const name = asNeeded[normName];
    const category = categorize(name);
    if (!needed[category]) needed[category] = [];
    needed[category].push(name);
  }

  for (const category of CATEGORIES_ORDER) {
    if (!consolidated[category]) consolidated[category] = [];
    if (!needed[category]) needed[category] = [];
  }

  return { consolidated, asNeeded: needed };
}

function shoppingListMarkdown(selectedTitles, consolidated, asNeeded) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# Shopping List (${today})`, "", "## Selected Dinners", "");
  for (const title of selectedTitles) {
    lines.push(`- ${title}`);
  }
  lines.push("", "## Consolidated Ingredients", "");
  for (const category of CATEGORIES_ORDER) {
    const items = consolidated[category] || [];
    if (items.length === 0) continue;
    lines.push(`### ${category}`, "");
    for (const item of items) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push("");
  }
  lines.push("## Add As Needed", "");
  for (const category of CATEGORIES_ORDER) {
    const items = asNeeded[category] || [];
    if (items.length === 0) continue;
    lines.push(`### ${category}`, "");
    for (const item of items) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

module.exports = {
  CATEGORIES_ORDER,
  buildShoppingList,
  loadRecipes,
  shoppingListMarkdown,
};
