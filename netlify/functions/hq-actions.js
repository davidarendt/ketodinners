// House Quest write actions. Every mutation goes through here so both phones
// see identical, server-authoritative state. Each action validates, writes the
// ledger/history, evaluates achievements, and notifies the partner — the faithful
// port of the prototype Component's handlers. Returns { state, flash, reveal }.
const H = require("./_lib/housequest");

const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? NaN : n; };
const findItem = (s, id) => s.items.find((x) => String(x.id) === String(id));
const normLink = (l) => { l = String(l || "").trim(); return l && !/^https?:\/\//i.test(l) ? "https://" + l : l; };

async function getDraftRow() {
  return ((await H.get("/rest/v1/hq_drafts?select=*&order=id.desc&limit=1")) || [])[0] || null;
}
function derived(s) {
  const balance = H.balanceOf(s.ledger.map((l) => ({ amount: l.amt })));
  const reserved = s.items.filter((x) => x.status === "approved").reduce((t, x) => t + (x.saved || 0), 0);
  return { balance, reserved, available: balance - reserved };
}

// Apply an action for `me`. Returns { flash, reveal }.
async function applyAction(me, action, body) {
  const you = H.other(me);
  const s = await H.loadState(me);
  const hh = await H.getHousehold();
  const cardTypes = s.cardTypes;
  const handCounts = { David: s.hands.David.length, Anne: s.hands.Anne.length };
  const { available } = derived(s);
  let out = { flash: "", reveal: null };

  switch (action) {
    // ----------------------------------------------------------- pitches
    case "pitch": {
      const title = String(body.title || "").trim();
      const cost = num(body.cost);
      if (!title || isNaN(cost)) { out.flash = "Add a name and a cost (0 is fine)"; break; }
      const fund = body.fund === "gradual" ? "gradual" : "lump";
      const pieces = fund === "gradual" ? Math.max(2, parseInt(body.pieces, 10) || 0) : 1;
      if (fund === "gradual" && pieces < 2) { out.flash = "Bit-by-bit needs at least 2 pieces"; break; }
      const rows = await H.sb("POST", "/rest/v1/hq_upgrades", {
        title, cat: body.cat || "Decor", cost, fund, pieces, pieces_done: 0,
        unit: String(body.unit || "").trim() || "pieces", effort: body.effort || 1,
        who: body.who || "Both", season: body.season || "Any", link: normLink(body.link),
        note: String(body.note || "").trim() || null, before_photo_url: body.beforePhoto || null,
        by: me, status: "pending",
      });
      const item = rows[0];
      await H.sb("POST", "/rest/v1/hq_votes", { upgrade_id: item.id, user_name: me, rating: Math.max(1, Math.min(10, parseInt(body.imp, 10) || 5)) });
      await H.notify(you, "pitch", `${me} pitched ${title} (${H.money(cost)}). Your vote?`, item.id);
      out.flash = `Sent to ${you} for a vote`;
      break;
    }
    case "vote": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const rating = Math.max(1, Math.min(10, parseInt(body.rating, 10) || 0));
      if (!rating) { out.flash = "Pick 1–10 first"; break; }
      await H.sb("POST", "/rest/v1/hq_votes?on_conflict=upgrade_id,user_name", { upgrade_id: it.id, user_name: me, rating });
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "approved" });
      await H.addHistory(it.id, `${me} voted ${rating} · approved`);
      await H.patchHousehold({ yes_streak: { ...s.yesStreak, [me]: (s.yesStreak[me] || 0) + 1 } });
      await H.notify(you, "vote", `${me} rated ${it.title} a ${rating}. It’s on the board!`, it.id);
      out.flash = `Approved · combined score ${rating + (it.imp[you] || 0)}/20`;
      break;
    }
    case "pass": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "shelved", passed_by: me });
      await H.addHistory(it.id, `${me} passed`);
      await H.patchHousehold({ yes_streak: { ...s.yesStreak, [me]: 0 } });
      await H.notify(you, "vote", `${me} passed on ${it.title}. A Second Chance card could bring it back.`, it.id);
      out.flash = "Passed · sent to the shelf";
      break;
    }
    case "withdraw": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      await H.sb("DELETE", `/rest/v1/hq_upgrades?id=eq.${it.id}`);
      out.flash = "Pitch withdrawn";
      break;
    }
    case "edit": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const cost = num(body.cost);
      const title = String(body.title || "").trim();
      if (!title || isNaN(cost)) { out.flash = "Needs a name and a cost"; break; }
      const next = { title, cost, cat: body.cat, effort: body.effort, who: body.who, season: body.season, link: normLink(body.link), note: String(body.note || "").trim() };
      const cur = { title: it.title, cost: it.cost, cat: it.cat, effort: it.effort || 1, who: it.who || "Both", season: it.season || "Any", link: it.link || "", note: it.note || "" };
      const labels = { title: "name", cost: "cost", cat: "room", effort: "effort", who: "who’s doing it", season: "season", link: "link", note: "note" };
      const fmt = (k, v) => (k === "cost" ? H.money(v) : (k === "effort" ? H.effortName(v) : v));
      const changes = Object.keys(next).filter((k) => cur[k] !== next[k])
        .map((k) => (k === "link" || k === "note") ? `updated the ${labels[k]}` : `${labels[k]} ${fmt(k, cur[k])} → ${fmt(k, next[k])}`);
      const patch = {
        title: next.title, cost: next.cost, cat: next.cat, effort: next.effort, who: next.who,
        season: next.season, link: next.link, note: next.note || null, saved: Math.min(it.saved || 0, cost),
      };
      if (body.beforePhoto !== undefined) patch.before_photo_url = body.beforePhoto || null;
      if (!changes.length && body.beforePhoto === undefined) { out.flash = ""; break; }
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, patch);
      if (changes.length) {
        await H.addHistory(it.id, `${me} changed ${changes.join(", ")}`);
        await H.notify(you, "comment", `${me} edited ${next.title}: ${changes.join(", ")}`, it.id);
      }
      out.flash = `Saved. ${you} gets a heads-up.`;
      break;
    }
    case "set_photo": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const col = body.which === "after" ? "after_photo_url" : "before_photo_url";
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { [col]: body.url || null });
      break;
    }
    case "shelve": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "shelved", saved: 0 });
      out.flash = "Moved to the shelf. Savings released.";
      break;
    }
    case "restore": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const status = it.imp.David && it.imp.Anne ? "approved" : "pending";
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status, passed_by: null });
      break;
    }
    case "comment": {
      const it = findItem(s, body.upgradeId); const text = String(body.text || "").trim();
      if (!it || !text) break;
      await H.sb("POST", "/rest/v1/hq_comments", { upgrade_id: it.id, who: me, text });
      const snip = text.length > 60 ? text.slice(0, 57) + "…" : text;
      await H.notify(you, "comment", `${me} commented on ${it.title}: “${snip}”`, it.id);
      break;
    }

    // ----------------------------------------------------------- money
    case "set_aside": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const need = it.cost - (it.saved || 0), amt = Math.min(100, need, available);
      if (amt <= 0) { out.flash = need <= 0 ? "Already fully saved" : "No free money to set aside"; break; }
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { saved: (it.saved || 0) + amt });
      out.flash = `${H.money(amt)} set aside for ${it.title}`;
      break;
    }
    case "finish": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const actual = num(body.actual);
      if (isNaN(actual)) { out.flash = "Enter what it cost"; break; }
      const diff = it.cost - actual;
      const effortXp = 25 * ((it.effort || 1) - 1);
      const xpGain = 20 + Math.round(it.cost / 10) + effortXp + (diff > 0 ? 10 : 0);
      const mine = await H.drawCard(me, hh, cardTypes, handCounts);
      const g = await H.gainXp(hh, xpGain, cardTypes, handCounts);
      await H.addLedger(it.title, -it.cost, "spend", it.id);
      if (diff > 0) await H.addLedger("Under budget: " + it.title, diff, "bonus", it.id);
      if (diff < 0) await H.addLedger("Over estimate: " + it.title, diff, "spend", it.id);
      const refund = await H.takeEffect(me, actual, it.title, cardTypes);
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, {
        status: "done", saved: 0, actual, after_photo_url: body.afterPhoto || it.afterPhoto || null,
        done_month: H.monthShort(), done_season: hh.season,
      });
      await H.notify(you, "finish", `${me} finished ${it.title}${diff > 0 ? `, ${H.money(diff)} under estimate.` : (diff < 0 ? `, ${H.money(-diff)} over estimate.` : ".")}`, it.id);
      out.reveal = mine || (g.draws.find((d) => d.owner === me) || null);
      out.flash = `+${xpGain} XP${refund ? ` · card refund ${H.money(refund)}` : ""}${g.leveled ? " · LEVEL UP" : ""}`;
      break;
    }
    case "do_piece": {
      const it = findItem(s, body.upgradeId); if (!it) break;
      const actual = num(body.actual);
      if (isNaN(actual)) { out.flash = "Enter what it cost"; break; }
      const per = it.cost / it.pieces, effortXp = 25 * ((it.effort || 1) - 1);
      const fromJar = Math.min(it.saved || 0, actual);
      const doneNow = it.piecesDone + 1, finished = doneNow >= it.pieces;
      const spent = (it.spentSoFar || 0) + actual;
      const xpGain = 5 + Math.round(per / 10) + (finished ? 20 + effortXp : 0);
      const mine = finished ? await H.drawCard(me, hh, cardTypes, handCounts) : null;
      const g = await H.gainXp(hh, xpGain, cardTypes, handCounts);
      const refund = await H.takeEffect(me, Math.round(actual), it.title, cardTypes);
      const unit = (it.unit || "piece").replace(/s$/, "");
      await H.addLedger(`${it.title} · 1 ${unit}`, -actual, "spend", it.id);
      await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, {
        saved: (it.saved || 0) - fromJar, pieces_done: doneNow, spent_so_far: spent,
        status: finished ? "done" : it.status, done_month: finished ? H.monthShort() : it.doneMonth,
        done_season: finished ? hh.season : it.doneSeason, actual: finished ? spent : it.actual,
        after_photo_url: finished && body.afterPhoto ? body.afterPhoto : (it.afterPhoto || null),
      });
      await H.addHistory(it.id, `${me} did 1 ${unit} for ${H.money(actual)}`);
      if (finished) await H.notify(you, "finish", `${me} finished ${it.title}!`, it.id);
      out.reveal = mine || (g.draws.find((d) => d.owner === me) || null);
      out.flash = `${finished ? "Finished! " : `${doneNow} of ${it.pieces} done · `}+${xpGain} XP${refund ? ` · card refund ${H.money(refund)}` : ""}${g.leveled ? " · LEVEL UP" : ""}`;
      break;
    }
    case "adjust_balance": {
      const n = num(body.amount);
      if (!n) { out.flash = "Enter an amount like 40 or -25"; break; }
      await H.addLedger(String(body.note || "").trim() || "Manual adjustment", n, n > 0 ? "adjust" : "spend");
      out.flash = `Balance ${H.signed(n)}`;
      break;
    }
    case "claim_drop": {
      const d = hh.current_drop; if (!d) break;
      await H.addLedger("Surprise drop", d.amt, "bonus");
      await H.sb("POST", "/rest/v1/hq_events", { type: "drop", payload: { text: d.text, amt: d.amt } });
      await H.patchHousehold({ current_drop: null });
      out.flash = `+${H.money(d.amt)} to the house fund`;
      break;
    }

    // ------------------------------------------------- allocation session
    // Free shared allocation: either person sets how much of the weekly pool goes
    // toward any upgrade (capped at the upgrade's remaining cost and the pool).
    // Any change resets both locks; both must lock in to move money into jars.
    case "alloc_set": {
      const row = await getDraftRow(); if (!row || row.status !== "open") break;
      const it = findItem(s, body.upgradeId); if (!it) break;
      const poolFrozen = row.pool != null ? Number(row.pool) : Math.max(0, available);
      const allocations = { ...(row.allocations || {}) };
      const key = String(it.id);
      const otherSum = Object.keys(allocations).filter((k) => k !== key).reduce((t, k) => t + Number(allocations[k] || 0), 0);
      const remaining = Math.max(0, it.cost - (it.saved || 0));
      const maxForThis = Math.max(0, Math.min(remaining, poolFrozen - otherSum));
      let amt = Math.round(Number(body.amount) || 0);
      if (amt < 0) amt = 0;
      amt = Math.min(amt, maxForThis);
      if (amt > 0) allocations[key] = amt; else delete allocations[key];
      await H.sb("PATCH", `/rest/v1/hq_drafts?id=eq.${row.id}`, { allocations, pool: poolFrozen, locked: { David: false, Anne: false } });
      break;
    }
    case "alloc_lock": {
      const row = await getDraftRow(); if (!row || row.status === "locked") break;
      const locked = { ...(row.locked || {}), [me]: true };
      const allocations = row.allocations || {};
      const total = Object.values(allocations).reduce((t, v) => t + Number(v || 0), 0);
      const count = Object.keys(allocations).filter((k) => Number(allocations[k]) > 0).length;
      if (locked.David && locked.Anne) {
        for (const id of Object.keys(allocations)) {
          const amt = Number(allocations[id] || 0); if (amt <= 0) continue;
          const it = findItem(s, id);
          await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${id}`, { saved: (it ? it.saved : 0) + amt, planned: true });
          await H.addHistory(id, `Set aside ${H.money(amt)} this week`);
        }
        await H.sb("PATCH", `/rest/v1/hq_drafts?id=eq.${row.id}`, { locked, status: "locked" });
        await H.notify(you, "plan", `This week’s plan is locked: ${H.money(total)} across ${count} upgrade${count === 1 ? "" : "s"}.`, null, "draft");
        out.flash = `Plan locked. ${H.money(total)} moved into savings jars.`;
      } else {
        await H.sb("PATCH", `/rest/v1/hq_drafts?id=eq.${row.id}`, { locked });
        await H.notify(you, "plan", `${me} locked in this week’s allocation. Your turn to lock it.`, null, "draft");
        out.flash = `Locked in. Waiting on ${you}.`;
      }
      break;
    }

    // ----------------------------------------------------------- cards
    case "play_card": {
      const card = s.hands[me].find((c) => String(c.id) === String(body.cardId)); if (!card) break;
      const t = cardTypes[card.type]; const it = body.upgradeId != null ? findItem(s, body.upgradeId) : null;
      if (t.target === "instant") {
        if (card.type === "swap") {
          const mineRest = s.hands[me].filter((c) => String(c.id) !== String(card.id));
          const theirs = s.hands[you];
          if (!mineRest.length || !theirs.length) { out.flash = "You both need another card to swap"; break; }
          const give = mineRest[Math.floor(Math.random() * mineRest.length)];
          const take = theirs[Math.floor(Math.random() * theirs.length)];
          await H.sb("PATCH", `/rest/v1/hq_cards?id=eq.${give.id}`, { owner: you });
          await H.sb("PATCH", `/rest/v1/hq_cards?id=eq.${take.id}`, { owner: me });
          await H.useCard(card.id);
          await H.cardLogAdd(me, "swap", `${me} swapped ${cardTypes[give.type].name} for ${you}’s ${cardTypes[take.type].name}`, null);
          out.flash = `Got ${cardTypes[take.type].name}, gave up ${cardTypes[give.type].name}`;
        } else {
          await H.addLedger(t.name, t.amount, "bonus");
          await H.useCard(card.id);
          await H.cardLogAdd(me, "cash", `${me} cashed in ${t.name} for ${H.money(t.amount)}`, null);
          out.flash = `+${H.money(t.amount)} from ${t.name}`;
        }
        break;
      }
      if (t.target === "armed") {
        await H.sb("POST", "/rest/v1/hq_effects", { who: me, card_type: card.type });
        await H.useCard(card.id);
        await H.cardLogAdd(me, "arm", `${me} armed ${t.name}`, null);
        out.flash = `${t.name} armed for your next finish`;
        break;
      }
      if (t.target === "treat") { out.flash = `Redeem ${t.name} or bank ${H.money(t.value || 0)} for the house`; break; }
      if (!it) break;
      if (t.target === "peek") {
        await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { peek: { ...(it.peek || {}), [me]: true } });
        await H.useCard(card.id);
        await H.cardLogAdd(me, "peek", `${me} peeked at the vote on ${it.title}`, it.id);
        await H.notify(you, "card", `${me} used Peek on your vote for ${it.title}.`, it.id);
        break;
      }
      if (t.target === "override") {
        await H.sb("POST", "/rest/v1/hq_votes?on_conflict=upgrade_id,user_name", { upgrade_id: it.id, user_name: you, rating: 5 });
        await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "approved" });
        await H.sb("POST", "/rest/v1/hq_card_plays", { upgrade_id: it.id, who: me, card_type: "override" });
        await H.useCard(card.id);
        await H.cardLogAdd(me, "play", `${me} used Executive Order on ${it.title}`, it.id);
        await H.notify(you, "card", `${me} used Executive Order to approve ${it.title}. Block it?`, it.id);
        out.flash = `${it.title} approved by Executive Order`;
        break;
      }
      if (t.target === "shelf") {
        await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "approved", passed_by: null });
        for (const who of ["David", "Anne"]) if (it.imp[who] == null) await H.sb("POST", "/rest/v1/hq_votes?on_conflict=upgrade_id,user_name", { upgrade_id: it.id, user_name: who, rating: 2 });
        await H.sb("POST", "/rest/v1/hq_card_plays", { upgrade_id: it.id, who: me, card_type: "second" });
        await H.useCard(card.id);
        await H.cardLogAdd(me, "play", `${me} played Second Chance on ${it.title}`, it.id);
        await H.notify(you, "card", `${me} played Second Chance. ${it.title} is back on the board.`, it.id);
        out.flash = `${it.title} is back on the board`;
        break;
      }
      // board target: champion / double / fast
      await H.sb("POST", "/rest/v1/hq_card_plays", { upgrade_id: it.id, who: me, card_type: card.type });
      await H.useCard(card.id);
      await H.cardLogAdd(me, "play", `${me} played ${t.name} on ${it.title}`, it.id);
      await H.notify(you, "card", `${me} played ${t.name} on ${it.title}.`, it.id);
      out.flash = `${me} played ${t.name} on ${it.title}`;
      break;
    }
    case "block": {
      const card = s.hands[me].find((c) => String(c.id) === String(body.cardId));
      const it = findItem(s, body.upgradeId);
      if (!card || !it) break;
      const ops = (it.plays || []).filter((p) => p.who === you);
      if (!ops.length) break;
      const last = ops[ops.length - 1];
      await H.sb("DELETE", `/rest/v1/hq_card_plays?id=eq.${last.id}`);
      if (last.type === "override") {
        await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "pending" });
        await H.sb("DELETE", `/rest/v1/hq_votes?upgrade_id=eq.${it.id}&user_name=eq.${you}`);
      }
      if (last.type === "second") await H.sb("PATCH", `/rest/v1/hq_upgrades?id=eq.${it.id}`, { status: "shelved" });
      await H.useCard(card.id);
      const name = cardTypes[last.type].name;
      await H.cardLogAdd(me, "block", `${me} blocked ${you}’s ${name} on ${it.title}`, it.id);
      await H.notify(you, "card", `${me} blocked your ${name} on ${it.title}.`, it.id);
      out.flash = `Blocked! ${name} cancelled`;
      break;
    }
    case "redeem_treat": {
      const card = s.hands[me].find((c) => String(c.id) === String(body.cardId)); if (!card) break;
      const t = cardTypes[card.type];
      await H.useCard(card.id);
      await H.cardLogAdd(me, "treat", `${me} redeemed ${t.name}`, null);
      await H.notify(you, "card", `${me} redeemed ${t.name}. ${t.desc}`, null, "cards");
      out.flash = `${t.name} redeemed. ${you} has been notified. Enjoy!`;
      break;
    }
    case "bank_treat": {
      const card = s.hands[me].find((c) => String(c.id) === String(body.cardId)); if (!card) break;
      const t = cardTypes[card.type], v = t.value || 0;
      await H.useCard(card.id);
      await H.addLedger("Banked treat: " + t.name, v, "bonus");
      await H.cardLogAdd(me, "bank", `${me} skipped ${t.name} and banked ${H.money(v)}`, null);
      await H.notify(you, "money", `${me} skipped ${t.name} and put ${H.money(v)} in the house fund.`, null, "board");
      out.flash = `+${H.money(v)} to the house fund. Very responsible.`;
      break;
    }
    case "add_custom_treat": {
      const name = String(body.name || "").trim(); if (!name) { out.flash = "Name the treat first"; break; }
      const type = "ct" + Date.now();
      const glyph = (String(body.glyph || "").trim() || name.split(" ")[0]).slice(0, 5);
      const value = parseInt(String(body.value).replace(/[^0-9]/g, ""), 10) || 20;
      const rarity = ["Common", "Rare", "Legendary"].includes(body.rarity) ? body.rarity : "Common";
      await H.sb("POST", "/rest/v1/hq_card_catalog", { type, name, rarity, glyph, target: "treat", value, descr: String(body.desc || "").trim() || "A treat you two made up.", custom: true, owner: me });
      out.flash = `${name} added to the deck`;
      break;
    }
    case "remove_custom_treat": {
      const type = String(body.type || "").replace(/[^a-z0-9]/gi, ""); if (!type) break;
      await H.sb("DELETE", `/rest/v1/hq_cards?card_type=eq.${type}`);
      await H.sb("DELETE", `/rest/v1/hq_card_catalog?type=eq.${type}&custom=is.true`);
      break;
    }

    // ----------------------------------------------------------- events
    case "roll_wildcard": {
      if (!s.wildOn) { out.flash = "Wildcard is off in Settings"; break; }
      const e = H.DECK[Math.floor(Math.random() * H.DECK.length)];
      await H.patchHousehold({ wildcard_week: H.weekKey(), wildcard_result: e });
      if (e.delta !== 0) await H.addLedger("Wildcard: " + e.title, e.delta, e.delta > 0 ? "bonus" : "spend");
      break;
    }

    // ----------------------------------------------------------- settings
    case "update_household": {
      const p = body.patch || {};
      const patch = {};
      if (p.budget != null) patch.weekly_budget = parseInt(String(p.budget).replace(/[^0-9]/g, ""), 10) || hh.weekly_budget;
      if (p.depositDay != null) patch.deposit_day = p.depositDay;
      if (p.rollover != null) patch.rollover = !!p.rollover;
      if (p.holidaysOn != null) patch.holidays_on = !!p.holidaysOn;
      if (p.wildOn != null) patch.wildcard_on = !!p.wildOn;
      if (p.seasonOn != null) patch.season_boost_on = !!p.seasonOn;
      if (p.treatsOn != null) patch.treats_on = !!p.treatsOn;
      if (p.maxHand != null) patch.max_hand = [3, 5, 7].includes(p.maxHand) ? p.maxHand : hh.max_hand;
      if (p.dropsPerMonth != null) patch.drops_per_month = [1, 2, 3].includes(p.dropsPerMonth) ? p.dropsPerMonth : hh.drops_per_month;
      if (p.dropsOn != null) patch.drops_per_month = p.dropsOn ? (hh.drops_per_month > 0 ? hh.drops_per_month : 2) : 0;
      if (Array.isArray(p.cats)) patch.cats = p.cats;
      if (Object.keys(patch).length) await H.patchHousehold(patch);
      break;
    }
    case "update_my_notifications": {
      const u = await H.getUserByName(me); if (!u) break;
      const patch = {};
      if (body.prefs) patch.notif_prefs = { ...(u.notif_prefs || {}), ...body.prefs };
      if (body.quiet != null) patch.quiet_hours = !!body.quiet;
      if (Object.keys(patch).length) await H.sb("PATCH", `/rest/v1/hq_users?id=eq.${u.id}`, patch);
      break;
    }
    case "mark_read": {
      if (body.id != null) await H.sb("PATCH", `/rest/v1/hq_notifications?id=eq.${parseInt(body.id, 10)}&to_user=eq.${encodeURIComponent(me)}`, { read: true });
      break;
    }
    case "mark_all_read": {
      await H.sb("PATCH", `/rest/v1/hq_notifications?to_user=eq.${encodeURIComponent(me)}&read=is.false`, { read: true });
      break;
    }
    case "dismiss_notice": {
      const u = await H.getUserByName(me); if (!u) break;
      const latest = s.cardLog[0] ? s.cardLog[0].id : null;
      await H.sb("PATCH", `/rest/v1/hq_users?id=eq.${u.id}`, { ui: { ...(u.ui || {}), seenLog: latest } });
      break;
    }

    default:
      throw Object.assign(new Error("Unknown action: " + action), { code: 400 });
  }

  // Record newly-earned achievements for the historical log (UI recomputes too).
  try { await H.evalAchievements(await H.loadState(me)); } catch (_) { /* non-fatal */ }
  return out;
}

exports.handler = async function handler(event) {
  const auth = H.authFromEvent(event);
  if (!auth) return H.jsonResponse(401, { error: "Not signed in." });
  if (event.httpMethod !== "POST") return H.jsonResponse(405, { error: "Method not allowed." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return H.jsonResponse(400, { error: "Invalid JSON." }); }

  const user = await H.getUserById(auth.uid);
  if (!user) return H.jsonResponse(401, { error: "Account not found." });
  const me = user.name;

  try {
    const result = await applyAction(me, body.action, body);
    const state = await H.loadState(me);
    return H.jsonResponse(200, { state, flash: result.flash || "", reveal: result.reveal || null });
  } catch (err) {
    if (err.code === 400) return H.jsonResponse(400, { error: err.message });
    return H.jsonResponse(503, { error: "Action failed." });
  }
};

module.exports.applyAction = applyAction;
