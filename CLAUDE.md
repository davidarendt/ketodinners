# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

A keto meal-plan site deployed to Netlify (site: `ketodinners`), **rebranded in the UI as "Dinner Planner"** (cream/terracotta/sage, Caprasimo + Figtree). The backend, data layer, and Supabase project names are unchanged — only the skin. Two coexisting stacks:

- **Deployed app** — static SPA in `web/` + Netlify Functions in `netlify/functions/`, backed by Supabase. This is what users see.
- **Legacy Python tools** — `meal_planner.py` (CLI) and `meal_planner_web.py` (local Flask-style server). Predate the Netlify deploy and are not part of the live site. Only touch them if the user explicitly says so.

No `package.json` at the repo root. Netlify Functions rely on Node built-ins (`fs`, `path`, `fetch`) — no `npm install` step.

### Second app: "The Almanac" weight tracker (`/weight/`)

An unrelated personal side project piggybacks on the same Netlify site + Supabase project to avoid standing up new infra. It is deliberately self-contained so it can be lifted into its own project later. It's a multi-user PWA (share the link → each person gets their own account + data) that ports the `almanac-handoff` design/spec (a newspaper/lab-notebook weight dashboard: rolling averages, goal projection, trend table, SVG chart). The handoff targeted native iOS + HealthKit; we built the web PWA instead because the reference is already a web React/Recharts dashboard, it's shareable by link, and it runs on Windows. HealthKit sync is the one dropped feature (web can't).

- **Front-end**: `web/weight/` — its own PWA (manifest + service worker scoped to `/weight/`, own icons). Vanilla JS (no build step); `app.js` is a port of `reference/dashboard.jsx`, chart drawn as inline SVG (Recharts is web-only and unavailable here). Installs as a separate home-screen app from the keto site.
- **API**: `netlify/functions/weight-auth.js` (register/login) + `weight-entries.js` (per-user CRUD) + self-contained `_lib/weight.js` (does not share `_lib/supabase.js`). Mapped at `/api/weight-auth` and `/api/weight-entries`.
- **Data**: `public.weight_users` + `public.weight_entries` (user_id-scoped, one row per calendar day via `on_conflict=user_id,entry_date` upsert). Reuses `SUPABASE_URL`/`SUPABASE_ANON_KEY`.
- **Auth**: username + passcode. Passcodes hashed with Node's built-in `crypto` scrypt; login returns an HMAC-signed session token (payload.sig) that the client sends as `Authorization: Bearer …`. The signing key is the `WEIGHT_AUTH_SECRET` Netlify env var — set it with `netlify env:set WEIGHT_AUTH_SECRET <random>`. No new npm deps (built-in crypto only). RLS stays permissive-anon; the function enforces per-user scoping via the token.

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

## Dinner Planner reskin (2026-08)

The user-facing skin was rebranded to "Dinner Planner" from a design handoff kit. Key facts for future work:

- **Design system** lives in `web/static/styles.css` (tokens: cream `#f9f4ed` / terracotta `#c67139` / sage `#7a8a5e`, Caprasimo display + Figtree body, pill controls, soft cards). The SPA is a bottom-nav app (Plan / Browse / Shop) — no more top hero/tabs.
- **Brand assets**: `web/icons/*`, `web/favicon.svg`, `web/static/mark.svg`, `web/og-image.png` (from the kit). Manifest is Dinner Planner (sage theme).
- **Recipe cards use real macros**: `_lib/recipes.js#loadRawHtmlRecipes` now extracts `cuisine`, `totalTime`, and `nutrition` (calories/protein/fat/netCarbs) from each file's JSON-LD; `recipes.js` passes them through `/api/recipes`. Add new recipe fields in BOTH places.
- **SSR recipe pages** (`recipe-page.js`) are reskinned WITHOUT editing the 105 raw files: `RESKIN_STYLES` is injected after each file's own `<style>` and **redefines the raw CSS variables** (`--cream`, `--terra`, `--navy`, `--gold`…) + swaps fonts. To restyle recipe pages, edit `RESKIN_STYLES`, not the source files.
- **Out of scope (deferred, need backend)**: onboarding wizard, $7/mo paywall/subscription, household/multi-user, "Tonight" tab, "Cook mode". The design kit shows these but they were not built.

## Conventions worth knowing

- Recipe IDs are the slug (filename without extension). The SSR path also accepts dated variants (`YYYY-MM-DD-<slug>`) via a fallback in `mealime-recipe.js#findRecipe`.
- Slugs are sanitized to `[a-z0-9-]` before touching the filesystem — see `sanitizeSlug` in `recipe-page.js`.
- The edit modal is inline JS emitted from a JS template literal (`recipe-page.js#editPanel`). Backticks and `${...}` inside that block need escaping; everything else is plain string concatenation.
