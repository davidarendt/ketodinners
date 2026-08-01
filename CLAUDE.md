# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

A keto meal-plan site deployed to Netlify (site: `ketodinners`). Two coexisting stacks:

- **Deployed app** — static SPA in `web/` + Netlify Functions in `netlify/functions/`, backed by Supabase. This is what users see.
- **Legacy Python tools** — `meal_planner.py` (CLI) and `meal_planner_web.py` (local Flask-style server). Predate the Netlify deploy and are not part of the live site. Only touch them if the user explicitly says so.

No `package.json` at the repo root. Netlify Functions rely on Node built-ins (`fs`, `path`, `fetch`) — no `npm install` step.

### Second app: weight tracker (`/weight/`)

An unrelated personal side project piggybacks on the same Netlify site + Supabase project to avoid standing up new infra. It is deliberately self-contained so it can be lifted into its own project later:

- **Front-end**: `web/weight/` — its own PWA (manifest + service worker scoped to `/weight/`, own icons). Installs as a separate home-screen app from the keto site.
- **API**: `netlify/functions/weight-entries.js` + self-contained `netlify/functions/_lib/weight.js` (does not share `_lib/supabase.js`). Mapped at `/api/weight-entries`.
- **Data**: `public.weight_entries` table (migration `..._weight_entries.sql`). Reuses `SUPABASE_URL`/`SUPABASE_ANON_KEY`.
- **Auth**: PIN gate. The correct PIN is the `WEIGHT_PIN` Netlify env var; the client sends it in the `x-weight-pin` header and the function rejects mismatches. Set it with `netlify env:set WEIGHT_PIN <value>`.

Note: both apps share one origin, so CacheStorage is shared. Each service worker's `activate` cleanup only deletes caches matching its own name prefix (`ketodinners` / `weighttracker`) so they don't wipe each other.

## Common commands

Daily deploy (Windows PowerShell, from repo root):
```powershell
.\scripts\sync.ps1                # supabase db push  +  git push  +  netlify deploy --prod
.\scripts\sync.ps1 -SkipDbPush    # flags: -SkipDbPush | -SkipGitPush | -SkipNetlifyDeploy
```

One-time setup: `.\scripts\setup-once.ps1` (Supabase + Netlify login/link, sets env vars).

Supabase migrations live in `supabase/migrations/` and are applied via `npx supabase db push`. `supabase/schema.sql` is a legacy full-schema file — prefer adding a new timestamped migration.

Netlify Functions run at `/.netlify/functions/*`; the friendly `/api/*` paths are mapped in `netlify.toml` redirects. There is no local test runner or linter configured.

## Architecture

### Two rendering paths

1. **SPA** (`web/index.html` + `web/static/`): the meal-plan/browse view. Fetches `/api/recipes`, `/api/recipe-states`, etc.
2. **SSR** (Netlify Functions returning HTML):
   - `/recipes/<slug>` → `recipe-page.js` reads `recipes/raw-html/<slug>.html`, mutates it in-memory (strips personal labels, applies overrides, injects the edit modal), and returns HTML.
   - `/mealime/<slug>` → `mealime-recipe.js` returns a JSON-LD-tagged page for import by Mealime and similar apps.

### Recipe data is layered

Every rendered recipe is (base file) + (Supabase overrides on top):

- **Base**: static `recipes/raw-html/*.html` (SSR path) and `recipes/claude/*.md` (SPA path via `_lib/recipes.js#loadRecipes`). Both are bundled into function deploys by `netlify.toml`'s `included_files`.
- **Overrides**: rows in `public.recipe_overrides` (title, image, description, ingredients, instructions, times). Applied by string-replace on the raw HTML in `recipe-page.js#applyOverrides`, or field-by-field merge in `recipes.js`.

When adding a new recipe field, both layers need updating: extend `recipe_overrides` schema + the merge logic in `_lib/supabase.js#upsertRecipeOverride` + the extractor/applier in `recipe-page.js`.

### Supabase surface

Three tables in `public`:
- `recipe_states` — rating (1–5), completed flag, `teddy_approved`, `ease` (1–3)
- `recipe_overrides` — user edits layered onto base recipes
- `cook_log` — append-only cook history (UUID primary key)

Plus a public Storage bucket `recipe-images` (10 MiB cap, image/* only).

**RLS is intentionally permissive for the `anon` role** — the site has no auth. The Netlify function acts as the trust boundary and uses only the anon key. Don't add auth-required policies without also introducing an auth model.

### The photo upload gotcha

Netlify Functions have a **6 MB request body cap**. Base64 inflates ~33%, so raw images >~4.5 MB hit the cap before the function runs — request never reaches Supabase, client sees `"Upload failed."` from the `.catch()` in `recipe-page.js`. The edit modal downscales client-side (max 2000 px, JPEG q=0.85) to stay under this limit. If you touch `recipe-upload.js` or the modal's upload flow, keep that resize step in.

### Supabase project matching

There are multiple Supabase projects in this org; the one that backs this site is `OlogyCalendar` (project ref `qrakimvzrtuboyhexgli`, hosts the `recipe-images` bucket + `recipe_states`/`recipe_overrides`/`cook_log`). The other, `OlogyHQ`, is unrelated infra. `SUPABASE_URL`/`SUPABASE_ANON_KEY` in Netlify env vars must point at OlogyCalendar.

## Conventions worth knowing

- Recipe IDs are the slug (filename without extension). The SSR path also accepts dated variants (`YYYY-MM-DD-<slug>`) via a fallback in `mealime-recipe.js#findRecipe`.
- Slugs are sanitized to `[a-z0-9-]` before touching the filesystem — see `sanitizeSlug` in `recipe-page.js`.
- The edit modal is inline JS emitted from a JS template literal (`recipe-page.js#editPanel`). Backticks and `${...}` inside that block need escaping; everything else is plain string concatenation.
