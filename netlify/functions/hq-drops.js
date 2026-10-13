// Surprise cash drops (scheduled a few times a day). Between 9am–8pm ET, if the
// household is under its monthly drop quota and none is currently waiting,
// creates one at random ($20–$50 + a ridiculous reason) and notifies both.
const H = require("./_lib/housequest");

exports.handler = async function handler() {
  try {
    const hh = await H.getHousehold();
    if (!hh || hh.drops_per_month <= 0) return { statusCode: 200, body: "drops off" };
    const p = H.etParts();
    if (p.hh < 9 || p.hh >= 20) return { statusCode: 200, body: "outside drop window" };
    if (hh.current_drop) return { statusCode: 200, body: "a drop is already waiting" };

    // how many already this ET month
    const monthPrefix = p.date.slice(0, 7); // YYYY-MM
    const recent = (await H.get("/rest/v1/hq_events?select=created_at&type=eq.drop&order=id.desc&limit=30")) || [];
    const usedThisMonth = recent.filter((e) => {
      try { return H.etParts(new Date(e.created_at)).date.slice(0, 7) === monthPrefix; } catch { return false; }
    }).length;
    if (usedThisMonth >= hh.drops_per_month) return { statusCode: 200, body: "monthly quota met" };

    // probabilistic so drops are spread across the month's runs
    if (Math.random() > 0.15) return { statusCode: 200, body: "no drop this run" };

    const items = (await H.get("/rest/v1/hq_upgrades?select=title,status")) || [];
    const drop = H.makeDrop(items.map((i) => ({ title: i.title, status: i.status })));
    await H.patchHousehold({ current_drop: drop });
    await H.notify("David", "money", `Surprise drop! ${H.money(drop.amt)} is waiting on the Board.`, null, "board");
    await H.notify("Anne", "money", `Surprise drop! ${H.money(drop.amt)} is waiting on the Board.`, null, "board");
    return { statusCode: 200, body: `drop created: ${H.money(drop.amt)}` };
  } catch (err) {
    return { statusCode: 200, body: "drops error: " + (err.message || err) };
  }
};
