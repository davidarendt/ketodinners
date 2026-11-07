# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

One Netlify site (`appsbydavid`, formerly `ketodinners`; `https://appsbydavid.netlify.app`) hosting a small **app launcher at `/` (`web/index.html`)** plus **four independent apps** that share the origin (and, where they need one, the Supabase project and the `netlify/functions/` dir):

- **Dinner Planner** (`/planner/`) — the keto meal-plan SPA, reskinned from "keto dinners". It lived at `/` until the launcher took the root; its assets still live under `web/static/` and `web/planner/index.html` references them with **origin-absolute** paths (so the move needed no asset changes). Backend/data/Supabase names are unchanged — only the skin.
- **The Almanac** (`/weight/`) — a weight-tracker PWA (details below).
- **House Quest** (`/house-quest/`) — a two-player house-upgrade game PWA (details below).
- **Teddy's Day** (`/teddys-day/`) — a kid's daily activity-picker PWA (picture tiles, a must-do row, numbered slots, grown-up settings behind a math gate). Delivered as a finished self-contained bundle (`web/teddys-day/`: `index.html` + `manifest.json` + `sw.js` + icons) — **no backend, no Supabase, no functions, all relative paths**. Its SW (`teddys-day-vN`) is scoped to `/teddys-day/` and, like the others, prunes **only** its own-prefixed caches on activate (the shared-CacheStorage rule). To update, just edit the bundle and bump its SW cache name.
- **Legacy Python tools** — `meal_planner.py` (CLI) and `meal_planner_web.py` (local Flask-style server). Predate the Netlify deploy, not part of the live site. Only touch if the user explicitly says so.

The apps are **deliberately self-contained** (own front-end dir, own functions where needed, own tables) so any can be lifted into its own project later. All front-ends are **vanilla JS with no build step** — no bundler/minifier/transpile, no fingerprinted filenames. There is a root `package.json`, but only for the `web-push` dependency used by the push-sender functions; everything else uses Node built-ins (`fs`, `path`, `fetch`, `crypto`).

### Second app: "The Almanac" weight tracker (`/weight/`)

An unrelated personal side project piggybacks on the same Netlify site + Supabase project to avoid standing up new infra. It is deliberately self-contained so it can be lifted into its own project later. It's a multi-user PWA (share the link → each person gets their own account + data) that ports the `almanac-handoff` design/spec (a newspaper/lab-notebook weight dashboard: rolling averages, goal projection, trend table, SVG chart). The handoff targeted native iOS + HealthKit; we built the web PWA instead because the reference is already a web React/Recharts dashboard, it's shareable by link, and it runs on Windows. HealthKit sync is the one dropped feature (web can't).

- **Front-end**: `web/weight/` — its own PWA (manifest + service worker scoped to `/weight/`, own icons). Vanilla JS (no build step); `app.js` is a port of `reference/dashboard.jsx`, chart drawn as inline SVG (Recharts is web-only and unavailable here). Installs as a separate home-screen app from the keto site.
- **API**: `netlify/functions/weight-auth.js` (register/login) + `weight-entries.js` (per-user CRUD) + `_lib/weight.js` (data layer). HTTP + auth are **no longer duplicated per-app** — see "Shared backend libs" below. Mapped at `/api/weight-auth` and `/api/weight-entries`.
- **Data**: `public.weight_users` + `public.weight_entries` (user_id-scoped, one row per calendar day via `on_conflict=user_id,entry_date` upsert). Reuses `SUPABASE_URL`/`SUPABASE_ANON_KEY`.
- **Auth**: username + passcode. Passcodes hashed with Node's built-in `crypto` scrypt; login returns an HMAC-signed session token (payload.sig) that the client sends as `Authorization: Bearer …`. The signing key is the `WEIGHT_AUTH_SECRET` Netlify env var — set it with `netlify env:set WEIGHT_AUTH_SECRET <random>`. No new npm deps (built-in crypto only). RLS stays permissive-anon; the function enforces per-user scoping via the token.

Note: all apps share one origin, so CacheStorage is shared. Each service worker's `activate` cleanup only deletes caches matching **its own** name prefix (`ketodinners` / `weighttracker` / `housequest`) so they don't wipe each other. See "Installed-PWA update workflow" for how the cache name is versioned.

### Third app: "House Quest" two-player house-upgrade game (`/house-quest/`)

Another self-contained side project on the same Netlify site + Supabase project, built to a handoff spec + clickable prototype (kept in the user's Downloads: `house-quest-spec.md`, `house-quest-prototype.html`). It's a two-player (David & Anne, one fixed household) PWA for pitching, voting on, budgeting and tracking house upgrades, with game mechanics (a shared weekly **allocation session**, power/treat cards, XP/levels, 30 achievements, surprise drops, holidays, weekly wildcard). Like the Almanac, it's deliberately self-contained (`hq_*` tables, own `_lib`, own functions) so it can be lifted out later. Note: the prototype's original turn-based "snake draft" was replaced by the shared allocation session (`alloc_set`/`alloc_lock`, `hq_drafts.allocations` jsonb) — either player funds any upgrade with −/+/Max, no turns, both lock in to move money to the jars.

- **Server owns all state and randomness.** The prototype's `class Component` was the reference implementation; its game rules are ported server-side. The phone renders entirely from a snapshot and sends actions — it never decides a card draw, wildcard roll or drop.
- **Front-end**: `web/house-quest/` — the prototype's `<style>` + `<template id="dc-template">` + inlined Preact runtime + template engine, **verbatim**. `static/app.js` replaces the in-memory Component with a server-wired one: `renderVals()` keeps the prototype's pure display derivations; every mutation calls `/api/hq-actions` and re-renders from the returned snapshot; polls `/api/hq-state` every ~20s. To change behavior/rules, edit the server (`hq-actions.js` + `_lib/housequest.js`), not the display derivations. Dark mode resolves to `:root[data-theme=…]`.
  - **Layout**: the prototype was a fixed 390×844 phone frame with an inner scroll box. That fights iOS standalone (`innerHeight`/`100vh`/`fill-available` all report short of the physical screen), so the shell was converted to the Almanac's pattern — **natural document scroll, `position:sticky` header, `position:fixed` bottom nav**, overlays switched to `position:fixed`. Don't reintroduce a fixed-height `.app`.
  - **Views beyond the prototype** (added via new `tab` values + `sc-if` blocks + `renderVals` fields): a **Cards** bottom-nav tab, an **All projects** screen (sortable/filterable across all statuses, reached from the Board), and a **How to play** help screen (from Settings). The two selects use the engine's `data-opts` attribute.
  - **Versioning / updates**: `static/app.js` has a `HQ_BUILD` string shown in Settings ("build N") — bump it on each front-end change, and see "Installed-PWA update workflow".
- **API**: `_lib/housequest.js` (the `loadState()` snapshot assembler + rule helpers like `scoreOf`/`randType`/`drawCard`/`gainXp`/`takeEffect`/`evalAchievements`; HTTP/auth come from the shared libs below), `hq-auth.js` (login; two seeded accounts, passcode claimed on first login), `hq-state.js` (snapshot GET), `hq-actions.js` (the ~25-action dispatcher = `applyAction`), `hq-upload.js` (photos → `house-quest-photos` bucket), `hq-push.js` (VAPID sub). Mapped at `/api/hq-*`.
- **Scheduled functions** (cron is UTC; each self-gates to America/New_York): `hq-deposit` (weekly deposit + opens a fresh allocation session; rollover-off **keeps a negative balance**, adding the budget on top), `hq-drops`, `hq-holidays`, `hq-nudges`, `hq-push-sender` (respects per-category prefs + quiet hours).
- **Data**: `public.hq_*` tables + `hq_household` singleton (balance is never stored — it's the sum of `hq_ledger`). Permissive-anon RLS; the function is the trust boundary. Content/logic (achievement defs, holidays, wildcard deck, drop reasons) are server constants in `_lib/housequest.js`; only `hq_card_catalog` is a table (so custom treats persist).
- **Auth**: `HQ_AUTH_SECRET` (falls back to `WEIGHT_AUTH_SECRET`). **Push**: `HQ_VAPID_*` (falls back to `WEIGHT_VAPID_*`). Set with `netlify env:set`.

### Shared backend libs (`netlify/functions/_lib/`)

The HTTP + Supabase + auth plumbing is shared so the three stacks don't each carry a copy:
- `core-supabase.js` — `jsonResponse` + `supabaseRequest` (thrown errors carry `.status`/`.body`). Used by `supabase.js` (recipes), `weight.js`, and `housequest.js`.
- `auth.js` — scrypt passcode hashing + an HMAC-token factory `makeAuth({ ttlMs, headerName, secretEnv, secretFallback })`. `weight.js` and `housequest.js` each call it with their own TTL/header/secret; **the token format is identical to the old per-app code**, so existing sessions stay valid. If you touch this, keep the sign/verify algorithm byte-identical or you log everyone out.
- The app-specific libs (`recipes.js`/`supabase.js`, `weight.js`, `housequest.js`) hold only their own queries/rules.

Handlers return **generic** error strings to clients (never raw Supabase text).

## Common commands

Daily deploy (Windows PowerShell, from repo root):
```powershell
.\scripts\sync.ps1                # supabase db push  +  git push  +  netlify deploy --prod
.\scripts\sync.ps1 -SkipDbPush    # flags: -SkipDbPush | -SkipGitPush | -SkipNetlifyDeploy
```

One-time setup: `.\scripts\setup-once.ps1` (Supabase + Netlify login/link, sets env vars).

**Deploy quirk:** `netlify deploy --prod` uploads the current **working directory**, so it ships uncommitted edits — deploying does **not** require a git commit, and `sync.ps1`'s `git push` only pushes what you've committed ("Everything up-to-date" is the tell that nothing was committed but the deploy still went out). Commit/push separately when you want GitHub in sync.

Supabase migrations live in `supabase/migrations/` (timestamped; prefer a new one over editing `supabase/schema.sql`, which is legacy). Apply either via `npx supabase db push` (the `sync.ps1` path) **or** the Supabase MCP `apply_migration` straight to the remote when the CLI isn't linked — keep the two in sync and write DDL idempotent (`if not exists` / `on conflict`) since it's additive on a shared live DB.

`netlify.toml` holds the `/api/*` → `/.netlify/functions/*` redirects, the scheduled-function cron, and a `[[headers]]` block: site-wide security headers + a pragmatic CSP, and long-cache `immutable` for icons/images **only** (never js/css/html — those stay revalidated so SW network-first deploys surface). If you add an external host for images/fonts/XHR, widen the CSP's `img-src`/`font-src`/`connect-src` or it's blocked. There is no local test runner or linter; verify by driving the live site (Playwright/curl).

### Installed-PWA update workflow

All three apps are used as **installed, standalone home-screen apps** (iOS/Android), not browser tabs — so layout bugs are often standalone-only (safe-area insets, short `innerHeight`) and **can't be reproduced in a desktop browser** (insets read 0). To ship a front-end change so installed apps actually pick it up: **bump that app's service-worker `CACHE` constant** (`ketodinners-vN` / `weighttracker-vN` / `housequest-vN`). The SWs are network-first with `skipWaiting` + `clients.claim`, and Dinner Planner + House Quest also `location.reload()` on `controllerchange`, so a cache bump makes the new version appear on one reopen. iOS keeps a PWA's SW/cache even when the home-screen icon is deleted, so a stale install sometimes needs Settings → Safari → Clear Website Data.

## Architecture

### Two rendering paths

1. **SPA** (`web/planner/index.html` + `web/static/`): the Dinner Planner meal-plan/browse/shop view. Fetches `/api/recipes`, `/api/recipe-states`, etc. (`web/index.html` is the launcher page, not the SPA.) DOM-toggle views, no URL router.
2. **SSR** (Netlify Functions returning HTML):
   - `/recipes/<slug>` → `recipe-page.js` reads `recipes/raw-html/<slug>.html`, mutates it in-memory (strips personal labels, applies overrides, injects the edit modal), and returns HTML. Its "← All Recipes" link points at `/planner/`.
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
- **Shopping selection is client-side**: the "Shop" cart is a `Set` of recipe ids in `localStorage['cartSelected']` (`web/static/app.js`); `/api/shopping-list` builds the aggregated list from the selected ids. The Plan tab pins the selected dinners in an **"On deck"** strip (`renderOnDeck`, kept in sync via `updateCartBar`). After the `/planner/` move, the manifest `start_url` and the keto SW shell point at `/planner/`.
- **Out of scope (deferred, need backend)**: onboarding wizard, $7/mo paywall/subscription, household/multi-user, "Tonight" tab, "Cook mode". The design kit shows these but they were not built.

## Conventions worth knowing

- Recipe IDs are the slug (filename without extension). The SSR path also accepts dated variants (`YYYY-MM-DD-<slug>`) via a fallback in `mealime-recipe.js#findRecipe`.
- Slugs are sanitized to `[a-z0-9-]` before touching the filesystem — see `sanitizeSlug` in `recipe-page.js`.
- The edit modal is inline JS emitted from a JS template literal (`recipe-page.js#editPanel`). Backticks and `${...}` inside that block need escaping; everything else is plain string concatenation.
