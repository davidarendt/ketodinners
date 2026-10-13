// Holiday bonuses (scheduled daily ~8am ET). On a holiday date, grants the
// ledger bonus plus a card for each player and notifies both. Idempotent via
// the household's claimed_holidays map.
const H = require("./_lib/housequest");

async function handCounts() {
  const cards = (await H.get("/rest/v1/hq_cards?select=owner&used_at=is.null")) || [];
  const c = { David: 0, Anne: 0 };
  for (const x of cards) c[x.owner] = (c[x.owner] || 0) + 1;
  return c;
}

exports.handler = async function handler() {
  try {
    const hh = await H.getHousehold();
    if (!hh || !hh.holidays_on) return { statusCode: 200, body: "holidays off" };
    const today = H.etParts().date;
    const claimed = hh.claimed_holidays || {};
    const hol = H.HOLIDAYS.find((h) => h.dateISO === today && !claimed[h.id]);
    if (!hol) return { statusCode: 200, body: "no holiday today" };

    await H.addLedger(hol.title, hol.amt, "bonus");
    const counts = await handCounts();
    const cardTypes = H.catalogToTypes(await H.getCatalog());
    await H.drawCard("David", hh, cardTypes, counts);
    await H.drawCard("Anne", hh, cardTypes, counts);
    await H.patchHousehold({ claimed_holidays: { ...claimed, [hol.id]: true } });
    await H.sb("POST", "/rest/v1/hq_events", { type: "holiday", payload: { id: hol.id, title: hol.title, amt: hol.amt } });

    const msg = `${hol.title} · ${H.signed(hol.amt)} and a card each.`;
    await H.notify("David", "money", msg, null, "board");
    await H.notify("Anne", "money", msg, null, "board");
    return { statusCode: 200, body: `granted ${hol.title}` };
  } catch (err) {
    return { statusCode: 200, body: "holidays error: " + (err.message || err) };
  }
};
