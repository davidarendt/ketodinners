// Weekly deposit + draft open (scheduled hourly; acts once per week on the
// household's deposit day around 6am ET). Applies the deposit per the rollover
// rule (rollover off keeps a negative balance — adds the budget on top), opens
// a fresh draft with the alternating first picker, resets the wildcard, and
// sends the weekly wrap-up to both players.
const H = require("./_lib/housequest");

const DAYS = { Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };

exports.handler = async function handler() {
  try {
    const hh = await H.getHousehold();
    if (!hh) return { statusCode: 200, body: "no household" };
    const p = H.etParts();
    const wk = H.weekKey();
    if (DAYS[hh.deposit_day] !== p.weekday) return { statusCode: 200, body: "not deposit day" };
    if (p.hh < 6) return { statusCode: 200, body: "too early" };
    if (hh.last_deposit_week === wk) return { statusCode: 200, body: "already deposited this week" };

    const budget = Number(hh.weekly_budget);
    const ledger = (await H.get("/rest/v1/hq_ledger?select=amount")) || [];
    const balance = ledger.reduce((t, l) => t + Number(l.amount), 0);

    let delta = budget; // rollover on, or rollover off with a negative balance (keep the debt)
    if (!hh.rollover && balance >= 0) delta = budget - balance; // top up to exactly the budget
    if (delta !== 0) await H.addLedger("Weekly budget", delta, "deposit");

    // open a new draft; alternate who picks first
    const first = hh.draft_first_next || "David";
    await H.sb("POST", "/rest/v1/hq_drafts", { week_start: wk, first_picker: first, status: "open" });

    await H.patchHousehold({
      last_deposit_week: wk,
      draft_first_next: H.other(first),
      wildcard_week: null, wildcard_result: null,
      season: H.seasonForMonth(),
    });

    // weekly wrap-up (counts finished this month, like the prototype recap)
    const done = (await H.get(`/rest/v1/hq_upgrades?select=done_month&status=eq.done`)) || [];
    const finishedThisMonth = done.filter((d) => d.done_month === H.monthShort()).length;
    const msg = `New week at the house. ${H.money(budget)} landed — time to allocate it together. ${finishedThisMonth} finished this month so far.`;
    await H.notify("David", "recap", msg, null, "draft");
    await H.notify("Anne", "recap", msg, null, "draft");

    return { statusCode: 200, body: `deposited ${H.money(delta)}; draft opened (first ${first})` };
  } catch (err) {
    return { statusCode: 200, body: "deposit error: " + (err.message || err) };
  }
};
