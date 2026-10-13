// Self-contained data + rules layer for House Quest — the server-side port of
// the prototype's `class Component`. Kept separate from the recipe/weight libs
// so the whole /house-quest feature can be lifted out later. Reuses
// SUPABASE_URL / SUPABASE_ANON_KEY. Auth uses Node's built-in crypto only
// (scrypt passcodes + HMAC session tokens). The server owns ALL state and ALL
// randomness (card draws, wildcard, drops); the phones render from loadState()
// and send actions through applyAction().

const crypto = require("crypto");

// ------------------------------------------------------------------ http
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
  if (!url || !anonKey) throw new Error("Supabase not configured.");
  return { url, anonKey };
}

async function sb(method, restPath, body) {
  const { url, anonKey } = supabaseConfig();
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers.Prefer = restPath.includes("on_conflict=")
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation";
  }
  const res = await fetch(`${url}${restPath}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Supabase ${method} ${restPath} failed (${res.status}): ${text}`);
    err.status = res.status; err.body = text;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const get = (path) => sb("GET", path);

// ------------------------------------------------------------------ auth
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}
function hashPasscode(passcode, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(passcode), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPasscode(passcode, saltHex, expectedHex) {
  if (!saltHex || !expectedHex) return false;
  const { hash } = hashPasscode(passcode, saltHex);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
function authSecret() {
  const s = process.env.HQ_AUTH_SECRET || process.env.WEIGHT_AUTH_SECRET || "";
  if (!s) throw new Error("HQ_AUTH_SECRET not configured.");
  return s;
}
function signToken(userId) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", authSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", authSecret()).update(payload).digest());
  const a = Buffer.from(sig || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payload).toString("utf8")); } catch { return null; }
  if (!data || !data.uid || !data.exp || Date.now() > data.exp) return null;
  return { uid: data.uid };
}
function authFromEvent(event) {
  const headers = event.headers || {};
  let token = headers["x-hq-token"] || headers["X-HQ-Token"] || "";
  const authz = headers["authorization"] || headers["Authorization"] || "";
  if (!token && /^Bearer /i.test(authz)) token = authz.replace(/^Bearer /i, "").trim();
  return verifyToken(token);
}

// ------------------------------------------------------------------ constants
// Wildcard deck, surprise-drop reasons, holidays, level names — content/logic
// that mirrors the prototype's Component constructor. Not user-editable, so
// they live here rather than in tables.
const DECK = [
  { title: "Hardware store sale", body: "Clearance week. You found deals on supplies.", delta: 75 },
  { title: "Surprise repair", body: "A leak under the sink. It jumps the line.", delta: -250 },
  { title: "Bonus round", body: "Extra room in the budget this week.", delta: 75 },
  { title: "DIY challenge", body: "Do one upgrade yourselves and keep the labor savings.", delta: 100 },
  { title: "HOA surprise", body: "A fee you forgot about.", delta: -120 },
  { title: "Quiet week", body: "Nothing happens. Enjoy it.", delta: 0 },
];
const REASONS = [
  "You found ${n} on the sidewalk outside.",
  "Couch cushion archaeology turned up ${n} and one very old Cheeto.",
  "You remembered to cancel a free trial before it charged you. +${n}.",
  "A neighbor finally returned the drill you forgot you lent out. That is ${n} you did not spend on a new one.",
  "The dog went a whole week without eating a sock. The house rewards good behavior: ${n}.",
  "Nobody ordered takeout on Tuesday. Allegedly. ${n} saved.",
  "The house settled. So did the electric bill. +${n}.",
  "You won an argument with the cable company. Spoils of war: ${n}.",
  "A ${n} bill fell out of a library book. Finders keepers.",
  "You both agreed on a paint color on the first try. Miracle bonus: ${n}.",
];
const HOLIDAYS = [
  { id: "hw", mon: "Oct", day: 31, title: "Haunted House Bonus", body: "Trick or treat. Usually a treat.", amt: 50, dateISO: "2026-10-31" },
  { id: "tg", mon: "Nov", day: 26, title: "Gratitude Grant", body: "Thankful for a roof. Literally.", amt: 75, dateISO: "2026-11-26" },
  { id: "bf", mon: "Nov", day: 27, title: "Doorbuster Savings", body: "You survived Black Friday.", amt: 60, dateISO: "2026-11-27" },
  { id: "xm", mon: "Dec", day: 25, title: "Santa Stuffed the Stocking", body: "Someone was nice this year.", amt: 100, dateISO: "2026-12-25" },
  { id: "ny", mon: "Jan", day: 1, title: "Fresh Start Fund", body: "New year, new projects.", amt: 50, dateISO: "2027-01-01" },
];
const LEVEL_NAMES = ["Fixer-Upper", "Weekend Warrior", "Handy Pair", "Home Hero", "Dream House"];
// Hints shown while a targeted card is armed (prototype cardTypes[].hint).
const CARD_HINTS = {
  champion: "pick an upgrade to boost", peek: "pick a pitch you haven’t voted on",
  double: "pick an upgrade", fast: "pick an upgrade to bump to the top",
  second: "pick a shelved upgrade", block: "pick an upgrade your partner played a card on",
  override: "pick one of your pitches still waiting on a vote",
};

const other = (me) => (me === "David" ? "Anne" : "David");

// ------------------------------------------------------------------ formatting
function money(n) { n = Number(n) || 0; const s = "$" + Math.abs(Math.round(n)).toLocaleString(); return n < 0 ? "-" + s : s; }
function signed(n) { n = Number(n) || 0; return n === 0 ? "$0" : (n > 0 ? "+" : "") + money(n); }
function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }); }
  catch { return ""; }
}
function relTime(ts) {
  const then = new Date(ts).getTime(), now = Date.now(), diff = now - then;
  if (!isFinite(then)) return "";
  if (diff < 60e3) return "Just now";
  if (diff < 3600e3) return Math.round(diff / 60e3) + "m ago";
  if (diff < 86400e3) return Math.round(diff / 3600e3) + "h ago";
  if (diff < 172800e3) return "Yesterday";
  return fmtDate(ts);
}
// ET calendar helpers (Node has full ICU).
function etParts(d) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const p = {}; fmt.formatToParts(d || new Date()).forEach((x) => { p[x.type] = x.value; });
  const hh = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, hh: Number(hh), mm: Number(p.minute), weekday: p.weekday, month: p.month, day: Number(p.day) };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthShort(d) { return MONTHS[(etParts(d).month | 0) - 1] || "Oct"; }
// Stable per-week key (the ET date 6 days of look-back lands on, good enough as a guard).
function weekKey(d) {
  const p = etParts(d);
  const base = new Date(`${p.date}T12:00:00Z`);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  base.setUTCDate(base.getUTCDate() - dow); // back to Sunday
  return etParts(base).date;
}
function seasonForMonth(d) {
  const m = etParts(d).month | 0;
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  if (m >= 9 && m <= 11) return "Fall";
  return "Winter";
}

// ------------------------------------------------------------------ rows → snapshot
const num = (v) => (v == null ? null : Number(v));
const effortName = (e) => ["", "Quick fix", "Weekend job", "Big project"][e || 1];

async function getHousehold() {
  const rows = await get("/rest/v1/hq_household?select=*&id=eq.1&limit=1");
  return (rows || [])[0];
}
function patchHousehold(patch) { return sb("PATCH", "/rest/v1/hq_household?id=eq.1", patch); }

async function getUsers() { return (await get("/rest/v1/hq_users?select=*")) || []; }
async function getUserByName(name) {
  const safe = String(name).replace(/[^A-Za-z]/g, "");
  return ((await get(`/rest/v1/hq_users?select=*&name=eq.${encodeURIComponent(safe)}&limit=1`)) || [])[0] || null;
}
async function getUserById(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  return ((await get(`/rest/v1/hq_users?select=*&id=eq.${encodeURIComponent(safe)}&limit=1`)) || [])[0] || null;
}

async function getCatalog() { return (await get("/rest/v1/hq_card_catalog?select=*")) || []; }
function catalogToTypes(catalog) {
  const types = {};
  for (const c of catalog) {
    types[c.type] = {
      name: c.name, rarity: c.rarity, glyph: c.glyph, target: c.target,
      amount: num(c.amount), pct: num(c.pct), cap: num(c.cap), value: num(c.value),
      desc: c.descr, custom: !!c.custom, hint: CARD_HINTS[c.type] || "",
    };
  }
  return types;
}

async function loadState(me) {
  const [hh, users, upgrades, votes, plays, comments, history, cards, effects, ledger, catalog, events, notifs, drafts] = await Promise.all([
    getHousehold(),
    getUsers(),
    get("/rest/v1/hq_upgrades?select=*&order=id.asc"),
    get("/rest/v1/hq_votes?select=upgrade_id,user_name,rating"),
    get("/rest/v1/hq_card_plays?select=id,upgrade_id,who,card_type&order=id.asc"),
    get("/rest/v1/hq_comments?select=*&order=id.asc"),
    get("/rest/v1/hq_history?select=*&order=id.asc"),
    get("/rest/v1/hq_cards?select=id,owner,card_type,used_at"),
    get("/rest/v1/hq_effects?select=id,who,card_type&used_at=is.null"),
    get("/rest/v1/hq_ledger?select=*&order=id.desc&limit=200"),
    getCatalog(),
    get("/rest/v1/hq_events?select=*&order=id.desc&limit=60"),
    get(`/rest/v1/hq_notifications?select=*&to_user=eq.${encodeURIComponent(me)}&order=id.desc&limit=60`),
    get("/rest/v1/hq_drafts?select=*&order=id.desc&limit=1"),
  ]);

  const cardTypes = catalogToTypes(catalog);

  // assemble per-upgrade sub-collections
  const impOf = {}; for (const v of votes || []) { (impOf[v.upgrade_id] = impOf[v.upgrade_id] || { David: null, Anne: null })[v.user_name] = v.rating; }
  const playsOf = {}; for (const p of plays || []) { (playsOf[p.upgrade_id] = playsOf[p.upgrade_id] || []).push({ id: p.id, who: p.who, type: p.card_type }); }
  const comsOf = {}; for (const c of comments || []) { (comsOf[c.upgrade_id] = comsOf[c.upgrade_id] || []).push({ who: c.who, text: c.text, time: relTime(c.created_at) }); }
  const histOf = {}; for (const h of history || []) { (histOf[h.upgrade_id] = histOf[h.upgrade_id] || []).push({ text: h.text, time: relTime(h.created_at) }); }

  const items = (upgrades || []).map((u) => ({
    id: u.id, title: u.title, cat: u.cat, cost: num(u.cost) || 0, fund: u.fund,
    saved: num(u.saved) || 0, spentSoFar: num(u.spent_so_far) || 0, actual: num(u.actual),
    effort: u.effort, who: u.who, season: u.season, link: u.link || "", note: u.note || "",
    beforePhoto: u.before_photo_url || "", afterPhoto: u.after_photo_url || "",
    pieces: u.pieces, piecesDone: u.pieces_done, unit: u.unit, by: u.by, status: u.status,
    passedBy: u.passed_by, planned: !!u.planned, doneMonth: u.done_month, doneSeason: u.done_season,
    peek: u.peek || {}, imp: impOf[u.id] || { David: null, Anne: null },
    plays: playsOf[u.id] || [], comments: comsOf[u.id] || [], history: histOf[u.id] || [],
  }));

  // hands + seen tallies
  const hands = { David: [], Anne: [] }, seen = { David: {}, Anne: {} };
  for (const c of cards || []) {
    if (!seen[c.owner]) seen[c.owner] = {};
    seen[c.owner][c.card_type] = (seen[c.owner][c.card_type] || 0) + 1;
    if (!c.used_at && hands[c.owner]) hands[c.owner].push({ id: c.id, type: c.card_type });
  }

  const cardLog = (events || []).filter((e) => e.type === "cardlog").map((e) => ({ id: e.id, ...(e.payload || {}) }));
  const dropLog = (events || []).filter((e) => e.type === "drop").map((e) => ({ text: (e.payload || {}).text, amt: num((e.payload || {}).amt) }));

  // draft
  const draftRow = (drafts || [])[0] || null;
  let dr = { open: true, pool: null, picks: [], first: hh.draft_first_next || "David", passed: { David: false, Anne: false }, locked: { David: false, Anne: false } };
  if (draftRow) {
    const picks = (await get(`/rest/v1/hq_draft_picks?select=*&draft_id=eq.${draftRow.id}&order=pick_no.asc`)) || [];
    dr = {
      open: draftRow.status === "open", pool: num(draftRow.pool), first: draftRow.first_picker,
      passed: draftRow.passed || { David: false, Anne: false }, locked: draftRow.locked || { David: false, Anne: false },
      picks: picks.map((p) => ({ itemId: p.upgrade_id, who: p.who, amt: num(p.amount) })),
    };
  }

  const prefsBy = {}; const quietBy = {};
  for (const u of users) { prefsBy[u.name] = u.notif_prefs || {}; quietBy[u.name] = !!u.quiet_hours; }
  const meRow = users.find((u) => u.name === me) || {};

  const wildcard = (hh.wildcard_week && hh.wildcard_week === weekKey() && hh.wildcard_result) ? hh.wildcard_result : null;

  return {
    me,
    budget: num(hh.weekly_budget), depositDay: hh.deposit_day, rollover: !!hh.rollover,
    dropsOn: hh.drops_per_month > 0, dropsPerMonth: hh.drops_per_month,
    holidaysOn: !!hh.holidays_on, wildOn: !!hh.wildcard_on, seasonOn: !!hh.season_boost_on,
    maxHand: hh.max_hand, treatsOn: !!hh.treats_on, xp: hh.xp, season: hh.season,
    cats: hh.cats || [], rooms: hh.rooms || [],
    yesStreak: hh.yes_streak || { David: 0, Anne: 0 },
    claimedHolidays: hh.claimed_holidays || {},
    drop: hh.current_drop || null, dropLog,
    wildcard, dr,
    items, ledger: (ledger || []).map((l) => ({ id: l.id, label: l.label, amt: num(l.amount), date: fmtDate(l.created_at), kind: l.kind })),
    hands, seen, effects: (effects || []).map((e) => ({ id: e.id, who: e.who, type: e.card_type })),
    cardLog, cardTypes, holidays: HOLIDAYS,
    customTreats: catalog.filter((c) => c.custom).map((c) => ({ key: c.type, name: c.name, rarity: c.rarity, glyph: c.glyph, desc: c.descr, value: num(c.value) })),
    notifs: (notifs || []).map((n) => ({ id: n.id, to: n.to_user, cat: n.category, text: n.text, itemId: n.upgrade_id, tab: n.tab, time: relTime(n.created_at), read: n.read })),
    notifPrefs: prefsBy, quiet: quietBy,
    seenLog: { David: (users.find((u) => u.name === "David") || {}).ui?.seenLog || null, Anne: (users.find((u) => u.name === "Anne") || {}).ui?.seenLog || null },
  };
}

// ------------------------------------------------------------------ derived math
function balanceOf(ledger) { return (ledger || []).reduce((t, l) => t + Number(l.amount || l.amt || 0), 0); }
function scoreOf(item, seasonOn, season) {
  let sc = (item.imp.David || 0) + (item.imp.Anne || 0);
  (item.plays || []).forEach((p) => { if (p.type === "champion") sc += 5; if (p.type === "double") sc += (item.imp[p.who] || 0); });
  if (seasonOn && item.season === season) sc += 3;
  return sc;
}
function rankedQueue(items, seasonOn, season) {
  const fastOf = (x) => (x.plays || []).some((p) => p.type === "fast");
  return items.filter((x) => x.status === "approved")
    .sort((a, b) => (fastOf(b) - fastOf(a)) || (scoreOf(b, seasonOn, season) - scoreOf(a, seasonOn, season)) || a.cost - b.cost);
}

// ------------------------------------------------------------------ writers
async function addLedger(label, amount, kind, upgradeId) {
  await sb("POST", "/rest/v1/hq_ledger", { label, amount, kind, upgrade_id: upgradeId || null });
}
async function addHistory(upgradeId, text) { await sb("POST", "/rest/v1/hq_history", { upgrade_id: upgradeId, text }); }
async function notify(to, category, text, upgradeId, tab) {
  await sb("POST", "/rest/v1/hq_notifications", { to_user: to, category, text, upgrade_id: upgradeId || null, tab: tab || null });
}
async function cardLogAdd(who, kind, text, itemId) {
  await sb("POST", "/rest/v1/hq_events", { type: "cardlog", payload: { who, kind, text, itemId: itemId || null } });
}
async function useCard(cardId) { await sb("PATCH", `/rest/v1/hq_cards?id=eq.${cardId}`, { used_at: new Date().toISOString() }); }

// Weighted random card type: 60% common / 30% rare / 10% legendary, treats
// filtered when off, then uniform within the tier.
function randType(cardTypes, treatsOn) {
  const r = Math.random(), tier = r < 0.6 ? "Common" : (r < 0.9 ? "Rare" : "Legendary");
  const keys = Object.keys(cardTypes).filter((t) => cardTypes[t].rarity === tier && (treatsOn || cardTypes[t].target !== "treat"));
  if (!keys.length) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}
// Draw a card into a hand if there's room. Returns { owner, type } or null.
async function drawCard(owner, hh, cardTypes, handCounts) {
  if ((handCounts[owner] || 0) >= hh.max_hand) return null;
  const type = randType(cardTypes, hh.treats_on);
  if (!type) return null;
  await sb("POST", "/rest/v1/hq_cards", { owner, card_type: type });
  handCounts[owner] = (handCounts[owner] || 0) + 1;
  return { owner, type };
}
// Apply XP. On crossing a 100-XP boundary, draw a card for BOTH players.
// Returns { xp, leveled, draws:[{owner,type}] }.
async function gainXp(hh, n, cardTypes, handCounts) {
  const before = Math.floor(hh.xp / 100), xp = hh.xp + n, after = Math.floor(xp / 100);
  const draws = [];
  let leveled = false;
  if (after > before) {
    const a = await drawCard("David", { ...hh, xp }, cardTypes, handCounts); if (a) draws.push(a);
    const b = await drawCard("Anne", { ...hh, xp }, cardTypes, handCounts); if (b) draws.push(b);
    leveled = true;
  }
  await patchHousehold({ xp });
  return { xp, leveled, draws };
}
// Consume the oldest armed refund effect for `me` against an actual cost.
async function takeEffect(me, amount, title, cardTypes) {
  if (amount <= 0) return 0;
  const rows = (await get(`/rest/v1/hq_effects?select=*&who=eq.${encodeURIComponent(me)}&used_at=is.null&order=id.asc&limit=1`)) || [];
  const eff = rows[0];
  if (!eff) return 0;
  const t = cardTypes[eff.card_type];
  const refund = Math.round(Math.min(t.cap, amount * t.pct));
  await sb("PATCH", `/rest/v1/hq_effects?id=eq.${eff.id}`, { used_at: new Date().toISOString() });
  await addLedger(t.name + ": " + title, refund, "bonus");
  return refund;
}
function makeDrop(items, perMonthReasonIdx) {
  const n = 20 + Math.floor(Math.random() * 7) * 5; // 20..50 in $5 steps
  const pool = items.filter((x) => x.status === "approved");
  const target = pool.length ? pool[Math.floor(Math.random() * pool.length)].title.toLowerCase() : "something on the list";
  const r = REASONS[perMonthReasonIdx != null ? perMonthReasonIdx : Math.floor(Math.random() * REASONS.length)].replace("${n}", "$" + n);
  return { amt: n, text: r + " Maybe put it toward the " + target + "?" };
}

// Record any newly-earned achievements (idempotent) for the historical record.
// The Trophies UI recomputes the same set client-side for display.
async function evalAchievements(state) {
  const got = achievementKeys(state);
  if (!got.length) return;
  const have = ((await get("/rest/v1/hq_events?select=payload&type=eq.achievement")) || []).map((e) => (e.payload || {}).key);
  const fresh = got.filter((k) => !have.includes(k));
  for (const key of fresh) await sb("POST", "/rest/v1/hq_events", { type: "achievement", payload: { key } });
}
// The 30 achievement keys currently satisfied (mirrors the prototype's achList).
function achievementKeys(s) {
  const items = s.items, done = items.filter((x) => x.status === "done");
  const withActual = done.filter((x) => x.actual != null);
  const live = items.filter((x) => x.status !== "shelved");
  const doneMonth = done.filter((x) => x.doneMonth === monthShort());
  const totalPlays = items.reduce((t, x) => t + (x.plays || []).length, 0);
  const level = Math.floor(s.xp / 100) + 1;
  const reserved = items.filter((x) => x.status === "approved").reduce((t, x) => t + (x.saved || 0), 0);
  const lifetimeSpend = -s.ledger.filter((l) => l.kind === "spend").reduce((t, l) => t + l.amt, 0);
  const catDone = (s.cats || []).some((c) => { const its = live.filter((x) => x.cat === c); return its.length >= 2 && its.every((x) => x.status === "done"); });
  const K = [];
  const push = (k, cond) => { if (cond) K.push(k); };
  push("keys", done.length >= 1);
  push("hattrick", doneMonth.length >= 3);
  push("penny", withActual.some((x) => x.actual < x.cost));
  push("mindmeld", items.some((x) => x.imp.David === 10 && x.imp.Anne === 10));
  push("cardshark", totalPlays >= 3);
  push("sweat", done.some((x) => x.effort === 3));
  push("cheap", done.some((x) => (x.actual != null ? x.actual : x.cost) <= 50));
  push("piece", done.some((x) => x.fund === "gradual"));
  push("room", catDone);
  push("level3", level >= 3);
  push("piggy", reserved >= 500);
  push("bigticket", done.some((x) => x.cost > 1000));
  push("exact", withActual.some((x) => Math.abs(x.actual - x.cost) <= 5));
  push("debtfree", s.ledger.some((l) => /^Rolled over/.test(l.label) && l.amt >= s.budget));
  push("tengrand", lifetimeSpend >= 10000);
  push("disagree", items.some((x) => x.imp.David && x.imp.Anne && Math.abs(x.imp.David - x.imp.Anne) >= 6));
  push("yesdear", (s.yesStreak.David >= 5) || (s.yesStreak.Anne >= 5));
  push("tagteam", done.filter((x) => x.who === "Both").length >= 3);
  push("fairshare", doneMonth.some((x) => x.who === "David") && doneMonth.some((x) => x.who === "Anne"));
  push("pitchperfect", ["David", "Anne"].some((p) => items.filter((x) => x.by === p && (x.status === "approved" || x.status === "done")).length >= 10));
  push("lazarus", done.some((x) => (x.plays || []).some((p) => p.type === "second")));
  push("underdog", done.some((x) => (x.plays || []).some((p) => p.type === "champion")));
  push("fullhand", s.hands.David.length >= s.maxHand || s.hands.Anne.length >= s.maxHand);
  push("luckystreak", s.dropLog.length >= 3);
  push("snakeeyes", !!s.wildcard && s.wildcard.delta < 0 && doneMonth.length > 0);
  push("weekend", done.filter((x) => x.effort === 2).length >= 3);
  push("elbow", done.filter((x) => (x.actual != null ? x.actual : x.cost) === 0).length >= 5);
  push("longhaul", done.some((x) => x.fund === "gradual" && x.pieces >= 10));
  push("onschedule", done.filter((x) => x.season && x.season !== "Any" && x.season === x.doneSeason).length >= 3);
  push("shutterbug", done.filter((x) => x.beforePhoto && x.afterPhoto).length >= 10);
  return K;
}

module.exports = {
  // http / auth
  jsonResponse, sb, get, b64url, b64urlDecode,
  hashPasscode, verifyPasscode, signToken, verifyToken, authFromEvent,
  // constants / helpers
  DECK, REASONS, HOLIDAYS, LEVEL_NAMES, other, money, signed, fmtDate, relTime,
  etParts, monthShort, weekKey, seasonForMonth, effortName, num,
  // data
  getHousehold, patchHousehold, getUsers, getUserByName, getUserById,
  getCatalog, catalogToTypes, loadState,
  // derived + writers
  balanceOf, scoreOf, rankedQueue, addLedger, addHistory, notify, cardLogAdd,
  useCard, randType, drawCard, gainXp, takeEffect, makeDrop, evalAchievements, achievementKeys,
};
