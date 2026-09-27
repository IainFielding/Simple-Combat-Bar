import { describe, expect, it } from "vitest";
import { buildOrder, displayStart, teamRuns } from "../scripts/model/turn-order.mjs";

const entry = (id, side = "enemy", extra = {}) => ({ id, side, ...extra });
const ids = items => items.map(i => (i.type === "divider" ? `|${i.round}|` : i.id)).join(" ");

describe("buildOrder: BG3 reading order", () => {
  const turns = [entry("pc1", "ally"), entry("gob1"), entry("pc2", "ally"), entry("gob2")];

  it("shows plain initiative order before combat starts, with no divider", () => {
    expect(ids(buildOrder({ turns, turn: null, round: 0, started: false }))).toBe("pc1 gob1 pc2 gob2");
  });

  it("puts the current combatant first, then the rest of the round, then next round", () => {
    const items = buildOrder({ turns, turn: 2, round: 1, started: true });
    expect(ids(items)).toBe("pc2 gob2 |2| pc1 gob1");
    expect(items[0].current).toBe(true);
    expect(items.filter(i => i.acted).map(i => i.id)).toEqual(["pc1", "gob1"]);
  });

  it("puts the divider last on the first turn of a round", () => {
    expect(ids(buildOrder({ turns, turn: 0, round: 3, started: true }))).toBe("pc1 gob1 pc2 gob2 |4|");
  });

  it("covers every turn index without losing or duplicating anyone", () => {
    for ( let turn = 0; turn < turns.length; turn++ ) {
      const items = buildOrder({ turns, turn, round: 1, started: true }).filter(i => i.type === "combatant");
      expect(items.map(i => i.id).sort()).toEqual(turns.map(t => t.id).sort());
      expect(items.filter(i => i.current)).toHaveLength(1);
    }
  });

  it("drops combatants the user can't see", () => {
    const hidden = [entry("a"), entry("b", "enemy", { shown: false }), entry("c")];
    expect(ids(buildOrder({ turns: hidden, turn: 0, round: 1, started: true }))).toBe("a c |2|");
  });

  it("drops the defeated only when asked", () => {
    const withDead = [entry("a"), entry("b", "enemy", { defeated: true })];
    expect(ids(buildOrder({ turns: withDead, turn: 0, round: 1, started: true }))).toBe("a b |2|");
    expect(ids(buildOrder({ turns: withDead, turn: 0, round: 1, started: true, hideDefeated: true }))).toBe("a |2|");
  });

  it("handles an empty combat", () => {
    expect(buildOrder({ turns: [], turn: 0, round: 1, started: true })).toEqual([]);
  });

  it("handles 40 combatants", () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(`c${i}`, i % 2 ? "ally" : "enemy"));
    const items = buildOrder({ turns: many, turn: 17, round: 2, started: true });
    expect(items).toHaveLength(41);
    expect(items[0].id).toBe("c17");
    expect(items[23]).toMatchObject({ type: "divider", round: 3 });
  });
});

describe("teamRuns", () => {
  it("groups consecutive combatants on the same side", () => {
    const runs = teamRuns([entry("a", "ally"), entry("b", "ally"), entry("c"), entry("d"), entry("e", "ally")]);
    expect(runs.map(r => r.ids)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("never groups neutral or secret combatants", () => {
    const runs = teamRuns([entry("a", "neutral"), entry("b", "neutral"), entry("c", "secret"), entry("d", "secret")]);
    expect(runs.map(r => r.ids)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });
});

describe("buildOrder with team grouping", () => {
  const turns = [entry("pc1", "ally"), entry("pc2", "ally"), entry("gob1"), entry("gob2"), entry("wolf", "neutral")];

  it("marks run members and leaves singletons ungrouped", () => {
    const items = buildOrder({ turns, turn: 0, round: 1, started: true, grouping: "bg3" });
    const run = Object.fromEntries(items.filter(i => i.type === "combatant").map(i => [i.id, i.run]));
    expect(run.pc1).toBe(run.pc2);
    expect(run.gob1).toBe(run.gob2);
    expect(run.pc1).not.toBe(run.gob1);
    expect(run.wolf).toBeNull();
  });

  it("makes the whole run current and starts the bar at the run's first member", () => {
    // Core's pointer is on the second ally (it acted first, out of order).
    const items = buildOrder({ turns, turn: 1, round: 1, started: true, grouping: "bg3" });
    expect(ids(items)).toBe("pc1 pc2 gob1 gob2 wolf |2|");
    expect(items.filter(i => i.current).map(i => i.id)).toEqual(["pc1", "pc2"]);
  });

  it("displayStart stays on the pointer without grouping", () => {
    expect(displayStart(turns, 1, false)).toBe(1);
    expect(displayStart(turns, 3, true)).toBe(2);
  });
});
