/* House Quest front-end. The UI (template + styles) is the approved prototype,
   verbatim. This file replaces the prototype's in-memory Component with a
   server-wired one: it renders from a snapshot fetched from /api/hq-state and
   routes every mutation through /api/hq-actions, so both phones share one
   authoritative state and the server owns all randomness. renderVals() keeps
   the prototype's pure display derivations; handlers call act()/setLocal(). */
(function () {
  const { h, render, Component: PComponent } = preact;
  const API = "/api";

  // ---- theme (resolve prefers-color-scheme to an explicit attribute) ----
  function applyTheme(t) { document.documentElement.dataset.theme = t; }
  applyTheme(localStorage.getItem("hq_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  // ---- PWA install prompt (captured for the Settings "Install the app" card) ----
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; if (window.__hq) window.__hq.forceUpdate(); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; if (window.__hq) window.__hq.forceUpdate(); });
  function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
  function installHintText(installed) {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    if (installed) return "House Quest is installed on this device — open it from your home screen like any app. It runs full-screen and works offline.";
    if (iOS) return "On iPhone/iPad: open this page in Safari, tap the Share button (the square with an up-arrow), scroll down and tap “Add to Home Screen,” then “Add.” House Quest then opens full-screen like a normal app.";
    if (android) return "On Android: tap the ⋮ menu in Chrome, then “Add to Home screen” (or “Install app”), and confirm. You can also use the button below if it appears.";
    return "On your computer: click the install icon in the browser’s address bar (or the button below). On your phone, open this page in Safari (iPhone) or Chrome (Android) and use “Add to Home Screen.”";
  }

  // ---- auth ----
  const tokenKey = "hq_token", userKey = "hq_user";
  const getToken = () => localStorage.getItem(tokenKey) || "";
  function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const t = getToken(); if (t) headers.Authorization = "Bearer " + t;
    return fetch(API + path, Object.assign({}, opts, { headers })).then((r) => r.json().catch(() => ({ error: "Bad response." })));
  }

  // ---- login screen wiring ----
  function initLogin() {
    const el = document.getElementById("login");
    const err = document.getElementById("hq-err");
    const pass = document.getElementById("hq-pass");
    let who = null;
    el.querySelectorAll(".hqwhobtn").forEach((b) => b.addEventListener("click", () => {
      who = b.dataset.user;
      el.querySelectorAll(".hqwhobtn").forEach((x) => x.classList.toggle("on", x === b));
      pass.focus();
    }));
    const submit = () => {
      err.textContent = "";
      if (!who) { err.textContent = "Pick who you are."; return; }
      if ((pass.value || "").length < 4) { err.textContent = "Passcode must be at least 4 characters."; return; }
      const btn = document.getElementById("hq-login"); btn.disabled = true; btn.textContent = "Signing in…";
      api("/hq-auth", { method: "POST", body: JSON.stringify({ username: who, passcode: pass.value }) })
        .then((r) => {
          if (r.error || !r.token) { err.textContent = r.error || "Login failed."; btn.disabled = false; btn.textContent = "Continue"; return; }
          localStorage.setItem(tokenKey, r.token);
          localStorage.setItem(userKey, JSON.stringify(r.user));
          el.setAttribute("hidden", "");
          startApp();
        })
        .catch(() => { err.textContent = "Network error."; btn.disabled = false; btn.textContent = "Continue"; });
    };
    document.getElementById("hq-login").addEventListener("click", submit);
    pass.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  // ---- photo downscale + upload ----
  function downscale(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 2000; let { width: w, height: hgt } = img;
          if (w > max || hgt > max) { const s = Math.min(max / w, max / hgt); w = Math.round(w * s); hgt = Math.round(hgt * s); }
          const c = document.createElement("canvas"); c.width = w; c.height = hgt;
          c.getContext("2d").drawImage(img, 0, 0, w, hgt);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = () => resolve(r.result);
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function uploadIfNeeded(photo) {
    if (!photo) return Promise.resolve("");
    if (/^https?:/.test(photo)) return Promise.resolve(photo);
    const m = /^data:([^;]+);base64,(.*)$/.exec(photo);
    if (!m) return Promise.resolve("");
    return api("/hq-upload", { method: "POST", body: JSON.stringify({ filename: "photo", contentType: m[1], data: m[2] }) })
      .then((r) => r.url || "");
  }

  // =================================================================== Component
  class Component {
    constructor() {
      const u = (() => { try { return JSON.parse(localStorage.getItem(userKey) || "{}"); } catch { return {}; } })();
      this.me = u.name || "David";
      this.cardTypes = {}; this.holidays = []; this.rooms = [];
      this.season = "Fall";
      this.s = {
        me: this.me, tab: "board", toast: "", selCard: null, reveal: null, voteDraft: {},
        filter: "all", roomFilter: "Any room", detailId: null, prevTab: "board", editing: false, edit: {}, cDraft: "",
        fTitle: "", fCost: "", fCat: "Kitchen", fNewCat: "", fImp: 5, fNote: "", fFund: "lump", fPieces: "10", fUnit: "", fEffort: 1, fWho: "Both", fSeason: "Any", fLink: "", fPhoto: "",
        finId: null, finMode: "lump", finActual: "", finAfter: "", recap: false,
        sBudget: "", adjAmt: "", adjNote: "", ctName: "", ctGlyph: "", ctDesc: "", ctValue: "", ctRarity: "Common",
        budget: 375, depositDay: "Monday", rollover: true, dropsOn: true, dropsPerMonth: 2, holidaysOn: true, wildOn: true, seasonOn: true, maxHand: 5, treatsOn: true,
        xp: 0, cats: [], items: [], ledger: [], hands: { David: [], Anne: [] }, seen: { David: {}, Anne: {} }, effects: [], cardLog: [],
        dr: { open: true, pool: null, picks: [], first: "David", passed: { David: false, Anne: false }, locked: { David: false, Anne: false } },
        claimedHolidays: {}, yesStreak: { David: 0, Anne: 0 }, drop: null, dropLog: [], wildcard: null, customTreats: [],
        notifs: [], notifPrefs: { David: {}, Anne: {} }, quiet: { David: false, Anne: false }, seenLog: { David: null, Anne: null },
      };
    }
    componentDidMount() {
      window.__hq = this;
      this.load();
      this._poll = setInterval(() => { if (!document.hidden && !this.s.finId && !this.s.reveal) this.load(); }, 20000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) this.load(); });
    }
    load() { api("/hq-state").then((r) => { if (r && r.state) this.mergeServer(r.state); else if (r && r.error === "Not signed in.") this.signOut(); }).catch(() => {}); }
    mergeServer(st) {
      ["budget", "depositDay", "rollover", "dropsOn", "dropsPerMonth", "holidaysOn", "wildOn", "seasonOn", "maxHand", "treatsOn",
        "xp", "season", "cats", "items", "ledger", "hands", "seen", "effects", "cardLog", "dr", "claimedHolidays",
        "yesStreak", "drop", "dropLog", "wildcard", "customTreats", "notifs", "notifPrefs", "quiet", "seenLog"]
        .forEach((k) => { if (st[k] !== undefined) this.s[k] = st[k]; });
      this.cardTypes = st.cardTypes || this.cardTypes;
      this.holidays = st.holidays || this.holidays;
      this.rooms = st.rooms || this.rooms;
      this.season = st.season || this.season;
      if (st.me) { this.me = st.me; this.s.me = st.me; }
      if (this.s.sBudget === "") this.s.sBudget = String(this.s.budget);
      if (this.__update) this.__update();
    }
    setLocal(patch) { Object.assign(this.s, patch); if (this.__update) this.__update(); }
    forceUpdate() { if (this.__update) this.__update(); }
    flash(msg) { this.setLocal({ toast: msg }); clearTimeout(this._t); this._t = setTimeout(() => this.setLocal({ toast: "" }), 2600); }
    act(action, payload) {
      return api("/hq-actions", { method: "POST", body: JSON.stringify(Object.assign({ action }, payload || {})) })
        .then((r) => {
          if (!r) return;
          if (r.error) { this.flash(r.error); return; }
          if (r.state) this.mergeServer(r.state);
          if (r.flash) this.flash(r.flash);
          if (r.reveal) { this.s.reveal = { type: r.reveal.type }; if (this.__update) this.__update(); }
        })
        .catch(() => this.flash("Network error. Try again."));
    }
    signOut() { clearTimeout(this._poll); localStorage.removeItem(tokenKey); localStorage.removeItem(userKey); location.reload(); }

    // ---- pure display helpers (unchanged from the prototype) ----
    effortName(e) { return ["", "Quick fix", "Weekend job", "Big project"][e || 1]; }
    whoName(w) { return w === "Both" ? "Both of us" : (w === "Hire out" ? "Hiring out" : w + "'s job"); }
    money(n) { n = Number(n) || 0; const s = "$" + Math.abs(Math.round(n)).toLocaleString(); return n < 0 ? "-" + s : s; }
    signed(n) { n = Number(n) || 0; return n === 0 ? "$0" : (n > 0 ? "+" : "") + this.money(n); }
    openDetail(id) { this.setLocal({ tab: "detail", detailId: id, prevTab: this.s.tab === "detail" ? this.s.prevTab : this.s.tab, editing: false, cDraft: "" }); }
    readImg(e, cb) { const f = e.target.files && e.target.files[0]; if (!f) return; downscale(f).then(cb); }

    renderVals() {
      const self = this, s = this.s, me = this.me, other = me === "David" ? "Anne" : "David";
      const ev = s.wildcard || null;
      const curMonth = new Date().toLocaleString("en-US", { month: "short" });
      const balance = s.ledger.reduce((t, l) => t + l.amt, 0);
      const reserved = s.items.filter((x) => x.status === "approved").reduce((t, x) => t + (x.saved || 0), 0);
      const available = balance - reserved;
      const level = Math.floor(s.xp / 100) + 1;
      const names = ["Fixer-Upper", "Weekend Warrior", "Handy Pair", "Home Hero", "Dream House"];
      const hand = s.hands[me] || [];
      const sel = s.selCard ? hand.find((c) => c.id === s.selCard) : null;
      const selT = sel ? this.cardTypes[sel.type] : null;
      const rev = s.reveal ? this.cardTypes[s.reveal.type] : null;
      const myBlock = hand.find((c) => c.type === "block");

      const notice = (() => {
        const top = s.cardLog.find((l) => l.who === other && l.kind === "play");
        if (!top) return null;
        const idx = s.cardLog.indexOf(top);
        const seenIdx = s.seenLog[me] ? s.cardLog.findIndex((l) => l.id === s.seenLog[me]) : -1;
        return (seenIdx === -1 || idx < seenIdx) ? top : null;
      })();
      const nItem = notice ? s.items.find((y) => y.id === notice.itemId) : null;
      const noticeLive = !!nItem && (nItem.plays || []).some((p) => p.who === other);

      const inSeasonOf = (x) => s.seasonOn && x.season === this.season;
      const scoreOf = (x) => {
        let sc = (x.imp.David || 0) + (x.imp.Anne || 0);
        (x.plays || []).forEach((p) => { if (p.type === "champion") sc += 5; if (p.type === "double") sc += (x.imp[p.who] || 0); });
        if (inSeasonOf(x)) sc += 3; return sc;
      };
      const fastOf = (x) => (x.plays || []).some((p) => p.type === "fast");
      const playLabel = (p) => p.who + " · " + this.cardTypes[p.type].name + (p.type === "champion" ? " +5" : "");

      const queue = s.items.filter((x) => x.status === "approved")
        .sort((a, b) => (fastOf(b) - fastOf(a)) || (scoreOf(b) - scoreOf(a)) || a.cost - b.cost)
        .map((x) => {
          const isLump = x.fund === "lump";
          const per = isLump ? 0 : x.cost / x.pieces;
          const saved = x.saved || 0;
          let fitCls, fitLabel;
          if (isLump) {
            if (saved >= x.cost) { fitCls = "chip ready"; fitLabel = x.cost === 0 ? "Free" : "Fully saved"; }
            else if (available >= x.cost - saved) { fitCls = "chip fit"; fitLabel = "Can afford"; }
            else { fitCls = "chip later"; fitLabel = "Saving up"; }
          } else if (available + saved >= per) { fitCls = "chip fit"; fitLabel = "Next one fits"; }
          else { fitCls = "chip later"; fitLabel = "Wait for deposit"; }
          const already = (x.plays || []).some((p) => p.who === me && sel && p.type === sel.type);
          const otherPlays = (x.plays || []).filter((p) => p.who === other);
          const canBoard = !!selT && selT.target === "board" && !already;
          const canBlock = !!selT && selT.target === "block" && otherPlays.length > 0;
          const canPlay = canBoard || canBlock;
          return {
            ...x, isLump, isGradual: !isLump, fundLabel: isLump ? "All at once" : "Bit by bit",
            effortLabel: this.effortName(x.effort), whoLabel: this.whoName(x.who), inSeason: inSeasonOf(x),
            hasLink: !!x.link, hasBefore: !!x.beforePhoto,
            buyLabel: x.cost - saved <= 0 ? "Mark done" : "Buy it",
            costFmt: this.money(x.cost), d: x.imp.David, a: x.imp.Anne, score: scoreOf(x), open: () => this.openDetail(x.id),
            fitCls, fitLabel, cardCls: canPlay ? "card target" : "card",
            plays: (x.plays || []).map((p) => ({ label: playLabel(p) })),
            savedFmt: this.money(saved), savePct: x.cost ? Math.min(100, Math.round(saved / x.cost * 100)) : 100,
            perFmt: this.money(per), piecePct: isLump ? 0 : Math.round(x.piecesDone / x.pieces * 100),
            canPlay, playLabel: canBlock ? "Block " + other + "’s " + this.cardTypes[otherPlays[otherPlays.length - 1].type].name : "Play " + (selT ? selT.name : "") + " here",
            play: () => { if (canBlock) { this.act("block", { cardId: sel.id, upgradeId: x.id }); } else { this.act("play_card", { cardId: sel.id, upgradeId: x.id }); } this.setLocal({ selCard: null }); },
            setAside: () => this.act("set_aside", { upgradeId: x.id }),
            startFinish: () => this.setLocal({ finId: x.id, finMode: "lump", finActual: String(x.cost), finAfter: "" }),
            doPiece: () => this.setLocal({ finId: x.id, finMode: "piece", finActual: String(Math.round(per)), finAfter: "" }),
            shelve: () => this.act("shelve", { upgradeId: x.id }),
          };
        });

      // finish sheet
      const fin = s.finId != null ? s.items.find((y) => y.id === s.finId) : null;
      const finAct = parseFloat(String(s.finActual).replace(/[^0-9.]/g, ""));
      const finPiece = s.finMode === "piece";
      const finEst = fin ? (finPiece ? Math.round(fin.cost / fin.pieces) : fin.cost) : 0;
      const finDiff = fin && !isNaN(finAct) ? finEst - finAct : 0;
      const finCovered = fin ? (fin.saved || 0) + Math.max(0, available) : 0;
      const finRed = !!fin && !isNaN(finAct) && finAct > finCovered;

      // pitches
      const pending = s.items.filter((x) => x.status === "pending");
      const toVote = pending.filter((x) => x.imp[me] == null).map((x) => {
        const picked = s.voteDraft[x.id] || 0;
        const peeked = !!(x.peek && x.peek[me]);
        const canPeek = !!selT && selT.target === "peek" && !peeked;
        return {
          ...x, costFmt: this.money(x.cost), hasNote: !!x.note, effortLabel: this.effortName(x.effort), whoLabel: this.whoName(x.who),
          peeked, canPeek, partnerVote: x.imp[other], by: x.by, open: () => this.openDetail(x.id),
          peek: () => this.act("play_card", { cardId: sel.id, upgradeId: x.id }).then(() => this.setLocal({ selCard: null })),
          hasSeason: x.season && x.season !== "Any", hasLink: !!x.link, hasBefore: !!x.beforePhoto,
          fundLabel: x.fund === "lump" ? "All at once" : "Bit by bit",
          votes: Array.from({ length: 10 }, (_, i) => i + 1).map((n) => ({ n, cls: n === picked ? "vbtn on" : "vbtn", pick: () => this.setLocal({ voteDraft: { ...s.voteDraft, [x.id]: n } }) })),
          lockIn: () => { if (!picked) { this.flash("Pick 1–10 first"); return; } this.act("vote", { upgradeId: x.id, rating: picked }); },
          pass: () => this.act("pass", { upgradeId: x.id }),
        };
      });
      const waiting = pending.filter((x) => x.imp[me] != null && x.imp[other] == null).map((x) => ({
        ...x, costFmt: this.money(x.cost), mine: x.imp[me], open: () => this.openDetail(x.id),
        canOverride: !!selT && selT.target === "override", noOverride: !(selT && selT.target === "override"),
        override: () => this.act("play_card", { cardId: sel.id, upgradeId: x.id }).then(() => this.setLocal({ selCard: null })),
        withdraw: () => this.act("withdraw", { upgradeId: x.id }),
      }));
      const reviving = !!selT && selT.target === "shelf";
      const shelf = s.items.filter((x) => x.status === "shelved").map((x) => ({
        ...x, costFmt: this.money(x.cost), open: () => this.openDetail(x.id), canRevive: reviving, plain: !reviving,
        revive: () => this.act("play_card", { cardId: sel.id, upgradeId: x.id }).then(() => this.setLocal({ selCard: null })),
        restore: () => this.act("restore", { upgradeId: x.id }),
      }));

      // trophies
      const doneItems = s.items.filter((x) => x.status === "done");
      const live = s.items.filter((x) => x.status !== "shelved");
      const known = (this.rooms || []).filter((r) => r.cats).reduce((a, r) => a.concat(r.cats), []);
      const rooms = (this.rooms || []).map((r) => {
        const inRoom = live.filter((x) => r.cats ? r.cats.includes(x.cat) : !known.includes(x.cat));
        const dn = inRoom.filter((x) => x.status === "done").length;
        return { name: r.name, span: r.span, pct: inRoom.length ? Math.round(dn / inRoom.length * 100) : 0, label: inRoom.length ? dn + " of " + inRoom.length + " done" : "Nothing yet" };
      });
      const withActual = doneItems.filter((x) => x.actual != null);
      const estTotal = withActual.reduce((t, x) => t + x.cost, 0), actTotal = withActual.reduce((t, x) => t + x.actual, 0);
      const estDiff = estTotal - actTotal;
      const totalPlays = s.items.reduce((t, x) => t + (x.plays || []).length, 0);
      const doneThisMonth = doneItems.filter((x) => x.doneMonth === curMonth);
      const lifetimeSpend = -s.ledger.filter((l) => l.kind === "spend").reduce((t, l) => t + l.amt, 0);
      const catDone = s.cats.some((c) => { const its = live.filter((x) => x.cat === c); return its.length >= 2 && its.every((x) => x.status === "done"); });
      const achList = [
        { name: "Keys in Hand", desc: "Finish your first upgrade", got: doneItems.length >= 1 },
        { name: "Hat Trick", desc: "Finish 3 upgrades in one month", got: doneThisMonth.length >= 3 },
        { name: "Penny Pincher", desc: "Finish something under your estimate", got: withActual.some((x) => x.actual < x.cost) },
        { name: "Mind Meld", desc: "Both rate something a 10", got: s.items.some((x) => x.imp.David === 10 && x.imp.Anne === 10) },
        { name: "Card Shark", desc: "Play 3 power cards", got: totalPlays >= 3 },
        { name: "Sweat Equity", desc: "Finish a Big project", got: doneItems.some((x) => x.effort === 3) },
        { name: "Cheap Thrills", desc: "Finish one for $50 or less", got: doneItems.some((x) => (x.actual != null ? x.actual : x.cost) <= 50) },
        { name: "Piece by Piece", desc: "Finish a bit-by-bit project", got: doneItems.some((x) => x.fund === "gradual") },
        { name: "Room Complete", desc: "Finish every upgrade in a room (2+)", got: catDone },
        { name: "Level 3", desc: "Get the house to level 3", got: level >= 3 },
        { name: "Piggy Bank", desc: "Have $500+ set aside in savings jars", got: reserved >= 500 },
        { name: "Big Ticket", desc: "Finish an upgrade over $1,000", got: doneItems.some((x) => x.cost > 1000) },
        { name: "Exact Change", desc: "Finish within $5 of the estimate", got: withActual.some((x) => Math.abs(x.actual - x.cost) <= 5) },
        { name: "Debt-Free Feeling", desc: "Roll a full week’s budget into the next", got: s.ledger.some((l) => /^Rolled over/.test(l.label) && l.amt >= s.budget) },
        { name: "Ten Grand Club", desc: "Spend $10,000 on the house", got: lifetimeSpend >= 10000 },
        { name: "Agree to Disagree", desc: "Approve something with votes 6+ apart", got: s.items.some((x) => x.imp.David && x.imp.Anne && Math.abs(x.imp.David - x.imp.Anne) >= 6) },
        { name: "Yes, Dear", desc: "Approve 5 of your partner’s pitches in a row", got: s.yesStreak.David >= 5 || s.yesStreak.Anne >= 5 },
        { name: "Tag Team", desc: "Finish 3 “Both of us” jobs", got: doneItems.filter((x) => x.who === "Both").length >= 3 },
        { name: "Fair Share", desc: "Each finish a solo job in the same month", got: doneThisMonth.some((x) => x.who === "David") && doneThisMonth.some((x) => x.who === "Anne") },
        { name: "Pitch Perfect", desc: "Get 10 of your pitches approved", got: ["David", "Anne"].some((p) => s.items.filter((x) => x.by === p && (x.status === "approved" || x.status === "done")).length >= 10) },
        { name: "Lazarus", desc: "Finish something revived with Second Chance", got: doneItems.some((x) => (x.plays || []).some((p) => p.type === "second")) },
        { name: "Underdog", desc: "Finish an upgrade that got a Champion card", got: doneItems.some((x) => (x.plays || []).some((p) => p.type === "champion")) },
        { name: "Full Hand", desc: "Hold the max number of cards", got: s.hands.David.length >= s.maxHand || s.hands.Anne.length >= s.maxHand },
        { name: "Lucky Streak", desc: "Claim 3 surprise drops in a month", got: s.dropLog.length >= 3 },
        { name: "Snake Eyes", desc: "Roll a bad wildcard and still finish something", got: !!ev && ev.delta < 0 && doneThisMonth.length > 0 },
        { name: "Weekend Warriors", desc: "Finish 3 Weekend jobs", got: doneItems.filter((x) => x.effort === 2).length >= 3 },
        { name: "Elbow Grease", desc: "Finish 5 jobs that cost $0", got: doneItems.filter((x) => (x.actual != null ? x.actual : x.cost) === 0).length >= 5 },
        { name: "The Long Haul", desc: "Finish a bit-by-bit project with 10+ pieces", got: doneItems.some((x) => x.fund === "gradual" && x.pieces >= 10) },
        { name: "On Schedule", desc: "Finish 3 jobs in their best season", got: doneItems.filter((x) => x.season && x.season !== "Any" && x.season === x.doneSeason).length >= 3 },
        { name: "Shutterbug", desc: "Add before and after photos to 10 jobs", got: doneItems.filter((x) => x.beforePhoto && x.afterPhoto).length >= 10 },
      ];
      const trophies = doneItems.map((x) => {
        const d = x.actual != null ? x.cost - x.actual : 0;
        return {
          ...x, open: () => this.openDetail(x.id), whoLabel: this.whoName(x.who), actualFmt: this.money(x.actual != null ? x.actual : x.cost),
          doneMonth: x.doneMonth, diffFmt: d > 0 ? this.money(d) + " under" : (d < 0 ? this.money(-d) + " over" : "On budget"), diffCls: d >= 0 ? "pos" : "neg",
          hasBefore: !!x.beforePhoto, noBefore: !x.beforePhoto, hasAfter: !!x.afterPhoto, noAfter: !x.afterPhoto,
          setBefore: (e) => this.readImg(e, (u) => uploadIfNeeded(u).then((url) => this.act("set_photo", { upgradeId: x.id, which: "before", url }))),
          setAfter: (e) => this.readImg(e, (u) => uploadIfNeeded(u).then((url) => this.act("set_photo", { upgradeId: x.id, which: "after", url }))),
        };
      });

      // recap
      const spentM = -s.ledger.filter((l) => l.kind === "spend").reduce((t, l) => t + l.amt, 0);
      const bonusM = s.ledger.filter((l) => l.kind === "bonus").reduce((t, l) => t + l.amt, 0);
      const countPlays = (who) => s.items.reduce((t, x) => t + (x.plays || []).filter((p) => p.who === who).length, 0);

      // holidays (read-only; granted by the scheduler)
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const holidays = (this.holidays || []).map((h) => {
        const claimed = !!s.claimedHolidays[h.id];
        const days = Math.max(0, Math.round((new Date(h.dateISO + "T00:00:00") - today0) / 86400000));
        return { ...h, amtFmt: this.signed(h.amt), claimed, open: !claimed, away: days === 0 ? "Today" : "In " + days + " days", result: this.signed(h.amt) + " and a card each" };
      });

      // next deposit (display only)
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const today = new Date();
      let depDelta = (dayNames.indexOf(s.depositDay) - today.getDay() + 7) % 7; if (depDelta === 0) depDelta = 7;
      const nextDepFmt = new Date(today.getTime() + depDelta * 86400000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

      // weekly draft
      const dr = s.dr;
      const drPool = dr.pool != null ? dr.pool : Math.max(0, available);
      const multOf = (rank) => Math.max(0.15, 1 - 0.15 * (rank - 1));
      const drPickedAmt = dr.picks.reduce((t, p) => t + p.amt, 0);
      const drLeft = Math.max(0, drPool - drPickedAmt);
      const firstP = dr.first, secondP = dr.first === "David" ? "Anne" : "David";
      let turn = [firstP, secondP, secondP, firstP][dr.picks.length % 4];
      if (dr.passed[turn]) turn = turn === "David" ? "Anne" : "David";
      const drRaw = queue.map((x, i) => {
        const rank = i + 1, mult = multOf(rank), pk = dr.picks.find((p) => p.itemId === x.id);
        const amt = Math.round(Math.min(x.cost * mult, Math.max(0, x.cost - (x.saved || 0)), drLeft));
        return { x, rank, mult, pk, amt };
      });
      const drFinished = dr.open && (drLeft <= 0 || (dr.passed.David && dr.passed.Anne) || !drRaw.some((o) => !o.pk && o.amt > 0));
      const myTurn = dr.open && !drFinished && turn === me && !dr.passed[me];

      // board filters
      const fdefs = [["all", "All"], ["afford", "Can afford"], ["weekend", "Free weekend"], ["mine", "Mine"], ["partner", other + "’s"], ["both", "Both of us"], ["hire", "Hiring out"]];
      const affordable = ["Can afford", "Fully saved", "Free", "Next one fits"];
      const shownQueue = queue.filter((x) => {
        if (s.roomFilter !== "Any room" && x.cat !== s.roomFilter) return false;
        switch (s.filter) {
          case "afford": return affordable.includes(x.fitLabel);
          case "weekend": return x.cost <= 100 && (x.effort || 1) >= 2;
          case "mine": return x.who === me;
          case "partner": return x.who === other;
          case "both": return x.who === "Both";
          case "hire": return x.who === "Hire out";
          default: return true;
        }
      });

      // detail
      const d = s.detailId != null ? s.items.find((y) => y.id === s.detailId) : null;
      const statusName = { pending: "Waiting on votes", approved: "On the board", done: "Finished", shelved: "On the shelf" };
      const voteShow = (who) => {
        if (!d) return "";
        const v = d.imp[who]; if (v == null) return "—";
        if (d.status === "pending" && who !== me && d.imp[me] == null && !(d.peek && d.peek[me])) return "Hidden";
        return v;
      };
      let dProg = null;
      if (d && d.status === "approved") {
        dProg = d.fund === "lump"
          ? { label: "Saved " + this.money(d.saved || 0) + " of " + this.money(d.cost), pct: d.cost ? Math.min(100, Math.round((d.saved || 0) / d.cost * 100)) : 100 }
          : { label: d.piecesDone + " of " + d.pieces + " " + d.unit + " done", pct: Math.round(d.piecesDone / d.pieces * 100) };
      }
      const dHistory = d ? [
        ...s.cardLog.filter((l) => l.itemId === d.id).map((l) => ({ text: l.text, time: "" })),
        ...(d.history || []).slice().reverse(),
        { text: "Pitched by " + d.by + " at " + this.money(d.cost), time: "" },
      ] : [];
      const ed = s.edit || {};
      const editOpt = (list, field, cls) => list.map((n) => ({ name: typeof n === "number" ? this.effortName(n) : n, cls: n === ed[field] ? cls + " on" : cls, pick: () => this.setLocal({ edit: { ...ed, [field]: n } }) }));

      // inbox
      const myNotifs = s.notifs.filter((n) => n.to === me);
      const unread = myNotifs.filter((n) => !n.read).length;
      const catNames = { plan: "Draft", pitch: "Pitch", vote: "Vote", card: "Card", comment: "Comment", finish: "Finished", money: "Money", recap: "Wrap-up", nudge: "Nudge" };
      const prefDefs = [
        ["plan", "Weekly draft", "Your turn to pick, and when the plan locks"],
        ["pitch", "New pitches", "When " + other + " pitches an upgrade"],
        ["vote", "Votes on your pitches", "Approved or passed"],
        ["card", "Cards & blocks", "When a card is played on your stuff"],
        ["comment", "Comments & edits", "Replies and changed details"],
        ["finish", "Finished upgrades", "When " + other + " checks something off"],
        ["money", "Money", "Drops, deposits and holiday bonuses"],
        ["recap", "Weekly wrap-up", "On deposit day"],
        ["nudge", "Nudges", "When a pitch waits on you 2+ days"],
      ];

      const tab = (t) => t === s.tab ? "tab on" : "tab";
      const sw = (on) => on ? "sw on" : "sw";
      const fCostN = parseFloat(String(s.fCost).replace(/[^0-9.]/g, "")) || 0;
      const fPiecesN = parseInt(s.fPieces, 10) || 0;
      const opt = (list, cur, key, cls) => list.map((n) => ({ name: typeof n === "number" ? this.effortName(n) : n, cls: (n === cur ? cls + " on" : cls), pick: () => this.setLocal({ [key]: n }) }));
      const themeDark = document.documentElement.dataset.theme === "dark";

      return {
        me, other, month: new Date().toLocaleString("en-US", { month: "long" }), season: this.season.toLowerCase(),
        signOut: () => this.signOut(),
        nextDeposit: nextDepFmt + " · " + this.money(s.budget), nextDepositDate: nextDepFmt, budgetFmt: this.money(s.budget),
        inRed: balance < 0, balColor: balance < 0 ? "#FF9A8A" : "#FFFFFF",
        balanceFmt: this.money(balance), reservedFmt: this.money(reserved), availableFmt: this.money(available),
        xp: s.xp, level, levelName: names[Math.min(level - 1, names.length - 1)], xpPct: s.xp % 100, xpToNext: 100 - (s.xp % 100), nextLevel: level + 1,

        hand: hand.map((c) => {
          const t = this.cardTypes[c.type] || { rarity: "Common", glyph: "?", name: "?", target: "", desc: "" };
          const rc = t.rarity.toLowerCase(); const tr = t.target === "treat" ? " treat" : "";
          return {
            ...t, rarity: t.rarity + tr, cls: "pc " + rc + tr + (c.id === s.selCard ? " on" : ""), bigCls: "pc big " + rc + tr,
            useLabel: tr ? "Redeem" : ((t.target === "instant" || t.target === "armed") ? "Use now" : "Choose target"),
            pick: () => this.pickCard(c, false), use: () => this.pickCard(c, true),
            isTreat: !!tr, valueLabel: tr ? "Worth " + this.money(t.value || 0) : "", cashLabel: "Bank " + this.money(t.value || 0), cashOut: () => this.act("bank_treat", { cardId: c.id }),
          };
        }),
        handCount: hand.length, handEmpty: hand.length === 0, maxHand: s.maxHand,
        playing: !!selT, playName: selT ? selT.name : "", playHint: selT ? selT.name + ": " + selT.hint : "",
        cancelPlay: () => this.setLocal({ selCard: null }),
        armed: s.effects.filter((e) => e.who === me).map((e) => ({ name: this.cardTypes[e.type].name, desc: "Next finish refunds " + Math.round(this.cardTypes[e.type].pct * 100) + "%" })),
        hasArmed: s.effects.some((e) => e.who === me),
        cardLog: s.cardLog.slice(0, 12).map((l) => ({ text: l.text })), noLog: s.cardLog.length === 0,

        collection: Object.keys(this.cardTypes).map((k) => {
          const t = this.cardTypes[k], n = (s.seen[me] || {})[k] || 0, rc = t.rarity.toLowerCase(), tr = t.target === "treat";
          return n ? { cls: "pc " + rc + (tr ? " treat" : ""), rarity: t.rarity + (tr ? " treat" : ""), glyph: t.glyph, name: t.name, count: "×" + n } : { cls: "pc ghost", rarity: t.rarity + (tr ? " treat" : ""), glyph: "?", name: "???", count: "" };
        }),
        seenCount: Object.keys(this.cardTypes).filter((k) => (s.seen[me] || {})[k]).length, deckSize: Object.keys(this.cardTypes).length,
        hasReveal: !!rev, revealTag: rev ? (rev.rarity === "Legendary" ? "LEGENDARY!" : (rev.rarity === "Rare" ? "Rare card!" : "New card")) : "",
        revealCls: rev ? "pc big revealcard " + rev.rarity.toLowerCase() + (rev.target === "treat" ? " treat" : "") : "pc big", revealRarity: rev ? rev.rarity + (rev.target === "treat" ? " treat" : "") : "", revealGlyph: rev ? rev.glyph : "",
        revealName: rev ? rev.name : "", revealDesc: rev ? rev.desc + (rev.target === "treat" ? " Or skip it and bank " + this.money(rev.value || 0) + "." : "") : "",
        closeReveal: () => this.setLocal({ reveal: null }),
        hasNotice: !!notice, noticeText: notice ? notice.text + "." : "", canBlockNotice: !!notice && !!myBlock && noticeLive,
        blockNotice: () => this.act("block", { cardId: myBlock.id, upgradeId: notice.itemId }),
        dismissNotice: () => this.act("dismiss_notice"),
        isCards: s.tab === "cards", goCards: () => this.setLocal({ tab: "cards" }),

        queue: shownQueue, queueEmpty: queue.length === 0, noMatch: queue.length > 0 && shownQueue.length === 0,
        shownCount: shownQueue.length, queueTotal: queue.length,
        filters: fdefs.map(([k, n]) => ({ name: n, cls: k === s.filter ? "cbtn on" : "cbtn", pick: () => this.setLocal({ filter: k }) })),
        roomOpts: ["Any room", ...s.cats], roomFilter: s.roomFilter, setRoomFilter: (e) => this.setLocal({ roomFilter: e.target.value }),

        drOpen: dr.open, isDraft: s.tab === "draft", goDraft: () => this.setLocal({ tab: "draft", selCard: null }),
        drPoolFmt: this.money(drPool), drLeftFmt: this.money(drLeft), drUsedPct: drPool ? Math.round(drPickedAmt / drPool * 100) : 0, drPickedFmt: this.money(drPickedAmt),
        drStatus: !dr.open ? "Plan locked. The money is in the savings jars." : (drFinished ? "Draft complete. Both of you lock it in." : (myTurn ? "Your pick." : (dr.passed[me] ? "You’re done. " + other + " is still picking." : "Waiting on " + other + " to pick."))),
        drBanner: drFinished ? "Draft complete: " + this.money(drPickedAmt) + " across " + dr.picks.length + " upgrades. Lock it in." : (myTurn ? "Your pick. " + this.money(drLeft) + " left to allocate." : "Waiting on " + other + " to pick. " + this.money(drLeft) + " left."),
        drCta: myTurn ? "Make your pick" : (drFinished ? "Review and lock" : "See the draft"),
        drOptions: drRaw.map((o) => ({
          title: o.x.title, rank: o.rank, score: o.x.score, costFmt: this.money(o.x.cost), multPct: Math.round(o.mult * 100), amtFmt: this.money(o.amt),
          picked: !!o.pk, pickedLabel: o.pk ? o.pk.who + " drafted · " + this.money(o.pk.amt) : "",
          canPick: myTurn && !o.pk && o.amt > 0, showCap: dr.open && !o.pk && o.amt > 0 && !myTurn,
          pick: () => this.act("draft_pick", { upgradeId: o.x.id }),
        })),
        drCanPass: myTurn, drPass: () => this.act("draft_done"),
        drShowPlan: drFinished || (!dr.open && dr.picks.length > 0),
        drPicks: dr.picks.map((p) => { const it = s.items.find((y) => y.id === p.itemId); return { title: it ? it.title : "", who: p.who, amtFmt: this.money(p.amt) }; }),
        drLockD: dr.locked.David ? "locked in" : "not yet", drLockA: dr.locked.Anne ? "locked in" : "not yet",
        drCanLock: drFinished && !dr.locked[me],
        drLock: () => this.act("draft_lock"),

        isDetail: !!d && s.tab === "detail", d: d || {}, dEditing: !!d && s.editing, dNotEditing: !!d && !s.editing,
        dStatus: d ? statusName[d.status] : "", dCostFmt: d ? this.money(d.cost) : "", dFund: d ? (d.fund === "lump" ? "All at once" : "Bit by bit") : "",
        dEffort: d ? this.effortName(d.effort) : "", dWho: d ? this.whoName(d.who) : "",
        dHasSeason: !!d && !!d.season && d.season !== "Any", dHasLink: !!d && !!d.link, dHasNote: !!d && !!d.note, dHasPhoto: !!d && !!d.beforePhoto,
        dPlays: d ? (d.plays || []).map((p) => ({ label: playLabel(p) })) : [],
        dVoteD: voteShow("David"), dVoteA: voteShow("Anne"),
        dHasProgress: !!dProg, dProgressLabel: dProg ? dProg.label : "", dProgressPct: dProg ? dProg.pct : 0,
        dComments: d ? (d.comments || []).map((c) => ({ ...c, cls: c.who === me ? "cm mine" : "cm" })) : [], dNoComments: !d || !(d.comments || []).length,
        dHistory,
        cDraft: s.cDraft, setCDraft: (e) => this.setLocal({ cDraft: e.target.value }),
        sendComment: () => { const t = s.cDraft.trim(); if (!t || !d) return; this.act("comment", { upgradeId: d.id, text: t }); this.setLocal({ cDraft: "" }); },
        closeDetail: () => this.setLocal({ tab: s.prevTab || "board", editing: false }),
        startEdit: () => this.setLocal({ editing: true, edit: { title: d.title, cost: String(d.cost), cat: d.cat, effort: d.effort || 1, who: d.who || "Both", season: d.season || "Any", link: d.link || "", note: d.note || "", beforePhoto: d.beforePhoto || "" } }),
        cancelEdit: () => this.setLocal({ editing: false }),
        eTitle: ed.title || "", eCost: ed.cost || "", eLink: ed.link || "", eNote: ed.note || "",
        setETitle: (e) => this.setLocal({ edit: { ...ed, title: e.target.value } }), setECost: (e) => this.setLocal({ edit: { ...ed, cost: e.target.value } }),
        setELink: (e) => this.setLocal({ edit: { ...ed, link: e.target.value } }), setENote: (e) => this.setLocal({ edit: { ...ed, note: e.target.value } }),
        eEffortOpts: editOpt([1, 2, 3], "effort", "vbtn txt"), eWhoOpts: editOpt(["David", "Anne", "Both", "Hire out"], "who", "vbtn txt"),
        eSeasonOpts: editOpt(["Any", "Spring", "Summer", "Fall", "Winter"], "season", "cbtn"), eCatOpts: editOpt(s.cats, "cat", "cbtn"),
        setDPhoto: (e) => this.readImg(e, (u) => this.setLocal({ edit: { ...(this.s.edit || {}), beforePhoto: u } })),
        saveEdit: () => {
          const cost = parseFloat(String(ed.cost).replace(/[^0-9.]/g, ""));
          if (!String(ed.title || "").trim() || isNaN(cost)) { this.flash("Needs a name and a cost"); return; }
          uploadIfNeeded(ed.beforePhoto).then((beforePhoto) => {
            this.act("edit", { upgradeId: d.id, title: ed.title.trim(), cost, cat: ed.cat, effort: ed.effort, who: ed.who, season: ed.season, link: ed.link || "", note: ed.note || "", beforePhoto });
          });
          this.setLocal({ editing: false });
        },

        isInbox: s.tab === "inbox", goInbox: () => this.setLocal({ tab: "inbox", selCard: null }),
        bellCls: s.tab === "inbox" ? "iconbtn on" : "iconbtn", unread, hasUnread: unread > 0,
        inbox: myNotifs.map((n) => ({
          ...n, cls: n.read ? "nt" : "nt unread", catLabel: catNames[n.cat] + ((s.notifPrefs[me] || {})[n.cat] ? " · pushed" : " · inbox only"),
          go: () => {
            this.act("mark_read", { id: n.id });
            if (n.itemId != null && s.items.some((y) => y.id === n.itemId)) this.setLocal({ tab: "detail", detailId: n.itemId, prevTab: "inbox", editing: false, cDraft: "" });
            else this.setLocal({ tab: n.tab || "board" });
          },
        })),
        noInbox: myNotifs.length === 0,
        markAllRead: () => this.act("mark_all_read"),
        notifPrefs: prefDefs.map(([k, name, desc]) => ({ name, desc, on: (s.notifPrefs[me] || {})[k], cls: sw((s.notifPrefs[me] || {})[k]), toggle: () => this.act("update_my_notifications", { prefs: { [k]: !(s.notifPrefs[me] || {})[k] } }) })),
        treatsOn: s.treatsOn, treatsCls: sw(s.treatsOn), toggleTreats: () => this.act("update_household", { patch: { treatsOn: !s.treatsOn } }),
        ctName: s.ctName, ctGlyph: s.ctGlyph, ctDesc: s.ctDesc, ctValue: s.ctValue, setCtValue: (e) => this.setLocal({ ctValue: e.target.value }),
        setCtName: (e) => this.setLocal({ ctName: e.target.value }), setCtGlyph: (e) => this.setLocal({ ctGlyph: e.target.value.slice(0, 5) }), setCtDesc: (e) => this.setLocal({ ctDesc: e.target.value }),
        ctRarityOpts: ["Common", "Rare", "Legendary"].map((r) => ({ name: r, cls: r === s.ctRarity ? "sbtn on" : "sbtn", pick: () => this.setLocal({ ctRarity: r }) })),
        addTreat: () => { if (!s.ctName.trim()) { this.flash("Name the treat first"); return; } this.act("add_custom_treat", { name: s.ctName, glyph: s.ctGlyph, desc: s.ctDesc, value: s.ctValue, rarity: s.ctRarity }); this.setLocal({ ctName: "", ctGlyph: "", ctDesc: "", ctValue: "" }); },
        customTreats: s.customTreats.map((k) => ({ ...k, valueFmt: this.money(k.value || 0), remove: () => this.act("remove_custom_treat", { type: k.key }) })),
        hasCustom: s.customTreats.length > 0,
        quietCls: sw((s.quiet || {})[me]), quietOn: (s.quiet || {})[me], toggleQuiet: () => this.act("update_my_notifications", { quiet: !(s.quiet || {})[me] }),
        shelf, hasShelf: shelf.length > 0,
        toVote, noVotes: toVote.length === 0, waiting, noWaiting: waiting.length === 0,
        badge: toVote.length, hasBadge: toVote.length > 0,

        finishing: !!fin, finTitle: fin ? fin.title : "", finEstFmt: this.money(finEst),
        finLabel: fin && finPiece ? "Doing 1 " + (fin.unit || "piece").replace(/s$/, "") + " · " + (fin.piecesDone + 1) + " of " + fin.pieces : "Finishing",
        finBtn: finPiece ? "Log it" : "Finish it",
        finRed, finRedText: finRed ? "This puts you " + this.money(finAct - finCovered) + " in the red until the next deposit." : "",
        finActual: s.finActual, setFinActual: (e) => this.setLocal({ finActual: e.target.value }),
        finDiffText: !fin || isNaN(finAct) ? "" : (finDiff > 0 ? this.money(finDiff) + (finPiece ? " under estimate" : " under — you get it back as a bonus") : (finDiff < 0 ? this.money(-finDiff) + " over estimate" : "Right on estimate")),
        finDiffCls: finDiff >= 0 ? "pos" : "neg",
        finBefore: fin && fin.beforePhoto ? fin.beforePhoto : "", finHasBefore: !!(fin && fin.beforePhoto), finNoBefore: !(fin && fin.beforePhoto),
        finAfter: s.finAfter, finHasAfter: !!s.finAfter, finNoAfter: !s.finAfter,
        setFinAfter: (e) => this.readImg(e, (u) => this.setLocal({ finAfter: u })),
        cancelFinish: () => this.setLocal({ finId: null }),
        confirmFinish: () => {
          if (isNaN(finAct)) { this.flash("Enter what it cost"); return; }
          const id = fin.id, mode = s.finMode;
          uploadIfNeeded(s.finAfter).then((afterPhoto) => {
            this.act(mode === "piece" ? "do_piece" : "finish", { upgradeId: id, actual: finAct, afterPhoto });
          });
          this.setLocal({ finId: null });
        },

        rooms, achievements: achList.map((a) => ({ ...a, cls: a.got ? "ach got" : "ach" })).sort((a, b) => b.got - a.got),
        achGot: achList.filter((a) => a.got).length, achTotal: achList.length,
        estHeadline: estDiff > 0 ? "Under budget overall" : (estDiff < 0 ? "Over budget overall" : "Right on estimate"),
        estDiffFmt: estDiff === 0 ? "$0" : this.money(Math.abs(estDiff)) + (estDiff > 0 ? " under" : " over"), estCls: estDiff >= 0 ? "pos" : "neg",
        estTotalFmt: this.money(estTotal), actTotalFmt: this.money(actTotal), estCount: withActual.length,
        trophies,

        showRecap: s.recap, openRecap: () => this.setLocal({ recap: true }), closeRecap: () => this.setLocal({ recap: false }),
        rcDone: doneThisMonth.length, rcSpent: this.money(spentM), rcBonus: this.money(bonusM),
        rcBestDrop: s.dropLog.length ? s.dropLog[0].text : "No drops yet this week.",
        rcCardsD: countPlays("David"), rcCardsA: countPlays("Anne"), rcTop: queue.length ? queue[0].title : "pitch something new",

        hasDrop: s.dropsOn && !!s.drop, dropText: s.drop ? s.drop.text : "", dropAmtFmt: s.drop ? this.money(s.drop.amt) : "",
        claimDrop: () => this.act("claim_drop"),
        dropLog: s.dropLog.map((dd) => ({ text: dd.text, amtFmt: "+" + this.money(dd.amt) })),
        dropsUsed: Math.min(s.dropLog.length + (s.drop ? 1 : 0), s.dropsPerMonth), dropsPerMonth: s.dropsPerMonth,

        holidays, holidaysOn: s.holidaysOn, dropsOn: s.dropsOn, wildOn: s.wildOn, rolloverOn: s.rollover, seasonOn: s.seasonOn,

        isBoard: s.tab === "board", isPitches: s.tab === "pitches", isAdd: s.tab === "add", isEvent: s.tab === "event", isSettings: s.tab === "settings", isTrophies: s.tab === "trophies",
        tabCls: { board: tab("board"), pitches: tab("pitches"), add: tab("add"), event: tab("event"), trophies: tab("trophies") },
        gearCls: s.tab === "settings" ? "iconbtn on" : "iconbtn",
        goBoard: () => this.setLocal({ tab: "board" }), goPitches: () => this.setLocal({ tab: "pitches" }),
        goAdd: () => this.setLocal({ tab: "add", selCard: null }), goEvent: () => this.setLocal({ tab: "event", selCard: null }),
        goSettings: () => this.setLocal({ tab: "settings", selCard: null }), goTrophies: () => this.setLocal({ tab: "trophies", selCard: null }),

        fTitle: s.fTitle, fCost: s.fCost, fNewCat: s.fNewCat, fNote: s.fNote, fPieces: s.fPieces, fUnit: s.fUnit, fLink: s.fLink,
        fPhoto: s.fPhoto, fHasPhoto: !!s.fPhoto, fPhotoLabel: s.fPhoto ? "Change photo" : "Add a before photo",
        setFPhoto: (e) => this.readImg(e, (u) => this.setLocal({ fPhoto: u })),
        fIsGrad: s.fFund === "gradual", fundLumpCls: s.fFund === "lump" ? "fbtn on" : "fbtn", fundGradCls: s.fFund === "gradual" ? "fbtn on" : "fbtn",
        effortOpts: opt([1, 2, 3], s.fEffort, "fEffort", "vbtn txt"),
        whoOpts: opt(["David", "Anne", "Both", "Hire out"], s.fWho, "fWho", "vbtn txt"),
        seasonOpts: opt(["Any", "Spring", "Summer", "Fall", "Winter"], s.fSeason, "fSeason", "cbtn"),
        pickLump: () => this.setLocal({ fFund: "lump" }), pickGrad: () => this.setLocal({ fFund: "gradual" }),
        fPerFmt: fPiecesN > 0 ? this.money(fCostN / fPiecesN) : "$0",
        setTitle: (e) => this.setLocal({ fTitle: e.target.value }), setCost: (e) => this.setLocal({ fCost: e.target.value }),
        setPieces: (e) => this.setLocal({ fPieces: e.target.value }), setUnit: (e) => this.setLocal({ fUnit: e.target.value }),
        setLink: (e) => this.setLocal({ fLink: e.target.value }),
        setNewCat: (e) => this.setLocal({ fNewCat: e.target.value }), setNote: (e) => this.setLocal({ fNote: e.target.value }),
        cats: s.cats.map((c) => ({ name: c, cls: c === s.fCat ? "cbtn on" : "cbtn", pick: () => this.setLocal({ fCat: c }) })),
        addCat: () => { const c = s.fNewCat.trim(); if (!c) return; const next = s.cats.includes(c) ? s.cats : [...s.cats, c]; if (!s.cats.includes(c)) this.act("update_household", { patch: { cats: next } }); this.setLocal({ cats: next, fCat: c, fNewCat: "" }); },
        myVote: Array.from({ length: 10 }, (_, i) => i + 1).map((n) => ({ n, cls: n === s.fImp ? "vbtn on" : "vbtn", pick: () => this.setLocal({ fImp: n }) })),
        submit: () => {
          if (!s.fTitle.trim() || String(s.fCost).trim() === "") { this.flash("Add a name and a cost (0 is fine)"); return; }
          if (s.fFund === "gradual" && fPiecesN < 2) { this.flash("Bit-by-bit needs at least 2 pieces"); return; }
          const payload = { title: s.fTitle.trim(), cost: fCostN, fund: s.fFund, pieces: fPiecesN, unit: s.fUnit.trim(), effort: s.fEffort, who: s.fWho, season: s.fSeason, link: s.fLink.trim(), note: s.fNote.trim(), cat: s.fCat, imp: s.fImp };
          uploadIfNeeded(s.fPhoto).then((beforePhoto) => this.act("pitch", { ...payload, beforePhoto }));
          this.setLocal({ fTitle: "", fCost: "", fNote: "", fImp: 5, fUnit: "", fPieces: "10", fLink: "", fPhoto: "", fSeason: "Any", tab: "pitches" });
        },

        hasEvent: !!ev, noEvent: !ev,
        eventTitle: ev ? ev.title : "", eventBody: ev ? ev.body : "", eventDeltaFmt: ev ? this.signed(ev.delta) : "",
        eventColor: ev && ev.delta > 0 ? "#1F3FB0" : (ev && ev.delta < 0 ? "#A3470D" : "#565D6C"),
        roll: () => this.act("roll_wildcard"),

        sBudget: s.sBudget, depositDay: s.depositDay, dayOpts: dayNames,
        setBudget: (e) => { const v = e.target.value; this.setLocal({ sBudget: v }); clearTimeout(this._budgetTimer); this._budgetTimer = setTimeout(() => this.act("update_household", { patch: { budget: v } }), 700); },
        setDay: (e) => this.act("update_household", { patch: { depositDay: e.target.value } }),
        rolloverCls: sw(s.rollover), dropsCls: sw(s.dropsOn), holidaysCls: sw(s.holidaysOn), wildCls: sw(s.wildOn), seasonCls: sw(s.seasonOn),
        toggleRollover: () => this.act("update_household", { patch: { rollover: !s.rollover } }),
        toggleDrops: () => this.act("update_household", { patch: { dropsOn: !s.dropsOn } }),
        toggleHolidays: () => this.act("update_household", { patch: { holidaysOn: !s.holidaysOn } }),
        toggleWild: () => this.act("update_household", { patch: { wildOn: !s.wildOn } }),
        toggleSeason: () => this.act("update_household", { patch: { seasonOn: !s.seasonOn } }),
        freqOpts: [1, 2, 3].map((n) => ({ n, cls: n === s.dropsPerMonth ? "sbtn on" : "sbtn", pick: () => this.act("update_household", { patch: { dropsPerMonth: n } }) })),
        handOpts: [3, 5, 7].map((n) => ({ n, cls: n === s.maxHand ? "sbtn on" : "sbtn", pick: () => this.act("update_household", { patch: { maxHand: n } }) })),
        themeOn: themeDark, themeCls: sw(themeDark), toggleTheme: () => { const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; localStorage.setItem("hq_theme", cur); applyTheme(cur); if (this.__update) this.__update(); },
        isInstalled: isStandalone(), canInstall: !!deferredPrompt && !isStandalone(), installHint: installHintText(isStandalone()),
        installApp: () => {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((c) => { this.flash(c && c.outcome === "accepted" ? "Installing…" : "Maybe later"); }).finally(() => { deferredPrompt = null; this.forceUpdate(); });
          } else {
            this.flash("Use your browser's menu to Add to Home Screen.");
          }
        },
        adjAmt: s.adjAmt, adjNote: s.adjNote,
        setAdjAmt: (e) => this.setLocal({ adjAmt: e.target.value }), setAdjNote: (e) => this.setLocal({ adjNote: e.target.value }),
        addAdj: () => { const n = parseFloat(String(s.adjAmt).replace(/[^0-9.\-]/g, "")); if (!n) { this.flash("Enter an amount like 40 or -25"); return; } this.act("adjust_balance", { amount: s.adjAmt, note: s.adjNote }); this.setLocal({ adjAmt: "", adjNote: "" }); },
        ledger: s.ledger.map((l) => ({ ...l, amtFmt: this.signed(l.amt), cls: l.amt >= 0 ? "pos" : "neg" })),

        toast: s.toast, hasToast: !!s.toast,
      };
    }

    // Card selection / immediate-use logic (ported from the prototype pickCard).
    pickCard(c, fromCards) {
      const s = this.s, t = this.cardTypes[c.type];
      if (t.target === "treat") {
        if (fromCards) { this.act("redeem_treat", { cardId: c.id }); return; }
        this.setLocal({ tab: "cards", selCard: null });
        this.flash("Redeem " + t.name + " or bank " + this.money(t.value || 0) + " for the house");
        return;
      }
      if (t.target === "instant") { this.act("play_card", { cardId: c.id }); return; }
      if (t.target === "armed") { this.act("play_card", { cardId: c.id }); return; }
      const toggled = c.id === s.selCard && !fromCards ? null : c.id;
      const tab = !toggled ? s.tab : ((t.target === "peek" || t.target === "override") ? "pitches" : (fromCards ? "board" : s.tab));
      this.setLocal({ selCard: toggled, tab });
    }
  }

  // =================================================================== template engine (verbatim)
  const tplEl = document.getElementById("dc-template").content;
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g, WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  function look(expr, scope) {
    if (expr === "true") return true; if (expr === "false") return false; if (expr === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    let v = scope; for (const k of expr.split(".")) { if (v == null) return undefined; v = v[k]; } return v;
  }
  const interp = (str, scope) => str.replace(HOLE, (_, e) => { const v = look(e, scope); return v == null ? "" : String(v); });
  const EVENTS = { onclick: "onClick", onchange: "onChange", oninput: "onInput", onkeydown: "onKeyDown", onsubmit: "onSubmit", onfocus: "onFocus", onblur: "onBlur" };
  function kids(node, scope) { const out = []; node.childNodes.forEach((c) => { const r = conv(c, scope); if (Array.isArray(r)) out.push(...r); else if (r != null) out.push(r); }); return out; }
  function conv(node, scope) {
    if (node.nodeType === 3) return interp(node.nodeValue, scope);
    if (node.nodeType !== 1) return null;
    const tag = node.localName;
    if (tag === "sc-if") { const m = (node.getAttribute("value") || "").match(WHOLE); return (m ? look(m[1], scope) : false) ? kids(node, scope) : null; }
    if (tag === "sc-for") {
      const m = (node.getAttribute("list") || "").match(WHOLE); const list = (m ? look(m[1], scope) : null) || [];
      const as = node.getAttribute("as") || "item"; const out = [];
      list.forEach((item, i) => { const sc = Object.create(scope); sc[as] = item; sc.$index = i; out.push(...kids(node, sc)); });
      return out;
    }
    const props = {}; let opts = null;
    const isText = tag === "textarea" || (tag === "input" && !/^(file|checkbox|radio)$/i.test(node.getAttribute("type") || ""));
    for (const a of Array.from(node.attributes)) {
      const name = a.name; if (name.startsWith("hint-")) continue;
      const m = a.value.match(WHOLE); const val = m ? look(m[1], scope) : interp(a.value, scope);
      if (name === "data-opts") { opts = look(a.value, scope) || []; continue; }
      if (EVENTS[name]) { props[name === "onchange" && isText ? "onInput" : EVENTS[name]] = val; continue; }
      props[name] = val;
    }
    const ch = opts ? opts.map((o) => h("option", { value: o }, String(o))) : kids(node, scope);
    return h(tag, props, ...ch);
  }
  class Host extends PComponent {
    constructor(p) { super(p); this.dc = new Component({}); this.dc.__update = () => this.forceUpdate(); }
    componentDidMount() { if (this.dc.componentDidMount) this.dc.componentDidMount(); }
    render() { const vals = this.dc.renderVals(); return h("div", { class: "dc-root" }, ...kids(tplEl, vals)); }
  }

  // ---- service worker + web push ----
  function urlB64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function registerPush() {
    if (!("serviceWorker" in navigator)) return;
    let reg;
    try { reg = await navigator.serviceWorker.register("/house-quest/sw.js", { scope: "/house-quest/" }); } catch { return; }
    if (!("PushManager" in window) || !("Notification" in window)) return;
    try {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") return;
      const { publicKey } = await api("/hq-push");
      if (!publicKey) return;
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await api("/hq-push", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch { /* push is best-effort; the inbox works without it */ }
  }

  // =================================================================== bootstrap
  function startApp() { render(h(Host), document.getElementById("root")); registerPush(); }
  initLogin();
  if (getToken()) { document.getElementById("login").setAttribute("hidden", ""); startApp(); }
})();
