import { describe, expect, it } from "vitest";
import { activeRun, afterEnd, canActivate, groupState, restoresEconomy } from "../scripts/model/group-turns.mjs";
import { buildOrder } from "../scripts/model/turn-order.mjs";

const e = (id, side) => ({ id, side });
// Three allies acting together, then two goblins, then a neutral wolf.
const turns = [e("a", "ally"), e("b", "ally"), e("c", "ally"), e("g1", "enemy"), e("g2", "enemy"), e("w", "neutral")];

describe("activeRun", () => {
  it("finds the run holding the pointer", () => {
    expect(activeRun(turns, 1)).toMatchObject({ start: 0, end: 3, ids: ["a", "b", "c"] });
    expect(activeRun(turns, 4)).toMatchObject({ start: 3, end: 5, ids: ["g1", "g2"] });
  });

  it("is null for a lone combatant or before the start", () => {
    expect(activeRun(turns, 5)).toBeNull();
    expect(activeRun(turns, null)).toBeNull();
  });
});

describe("groupState", () => {
  const run = { start: 0 };
  it("keeps this round's state for this run", () => {
    expect(groupState({ round: 2, start: 0, started: ["a"], ended: ["b"] }, run, 2))
      .toEqual({ round: 2, start: 0, started: ["a"], ended: ["b"] });
  });

  it("starts fresh for another round or another run", () => {
    expect(groupState({ round: 1, start: 0, started: ["a"], ended: ["a"] }, run, 2).ended).toEqual([]);
    expect(groupState({ round: 2, start: 3, started: ["g1"], ended: [] }, run, 2).started).toEqual([]);
    expect(groupState(null, run, 2)).toEqual({ round: 2, start: 0, started: [], ended: [] });
  });
});

describe("canActivate", () => {
  const run = activeRun(turns, 0);
  const state = { ended: ["c"] };
  it("lets a waiting member step in", () => {
    expect(canActivate({ run, state, id: "b", currentId: "a" })).toBe(true);
  });
  it("refuses the one already acting, one who has ended, a defeated one, or an outsider", () => {
    expect(canActivate({ run, state, id: "a", currentId: "a" })).toBe(false);
    expect(canActivate({ run, state, id: "c", currentId: "a" })).toBe(false);
    expect(canActivate({ run, state, id: "b", currentId: "a", defeated: new Set(["b"]) })).toBe(false);
    expect(canActivate({ run, state, id: "g1", currentId: "a" })).toBe(false);
    expect(canActivate({ run: null, state, id: "b", currentId: "a" })).toBe(false);
  });
});

describe("afterEnd", () => {
  const run = activeRun(turns, 0);

  it("hands the turn to the next waiting member, in initiative order", () => {
    expect(afterEnd({ run, state: { ended: [] }, endedId: "a" })).toEqual({ ended: ["a"], next: { member: "b" } });
  });

  it("wraps round within the run, to someone who acted out of order", () => {
    // c went first, out of order; then a and b are still to go.
    expect(afterEnd({ run, state: { ended: [] }, endedId: "c" }).next).toEqual({ member: "a" });
  });

  it("skips members who have ended or can't act", () => {
    expect(afterEnd({ run, state: { ended: ["b"] }, endedId: "a", defeated: new Set(["c"]) }))
      .toEqual({ ended: ["b", "a"], next: { leave: 3 } });
  });

  it("leaves the run when the last member ends", () => {
    expect(afterEnd({ run, state: { ended: ["a", "c"] }, endedId: "b" }).next).toEqual({ leave: 3 });
  });

  it("doesn't count the same member twice", () => {
    expect(afterEnd({ run, state: { ended: ["a"] }, endedId: "a" }).ended).toEqual(["a"]);
  });
});

describe("restoresEconomy", () => {
  it("restores a member's actions only the first time they start in a group turn", () => {
    expect(restoresEconomy(null, "a")).toBe(true);
    expect(restoresEconomy({ started: [] }, "a")).toBe(true);
    expect(restoresEconomy({ started: ["a"] }, "a")).toBe(false);
  });
});

describe("buildOrder in a group turn", () => {
  it("enlarges only the member acting; the rest of the run is marked as in it", () => {
    const items = buildOrder({ turns, turn: 1, round: 1, started: true, grouping: "bg3", ended: new Set(["c"]) });
    const byId = Object.fromEntries(items.filter(i => i.type === "combatant").map(i => [i.id, i]));
    expect(items[0].id).toBe("a");
    expect(byId.b.current).toBe(true);
    expect(byId.a.current).toBe(false);
    expect([byId.a.activeRun, byId.b.activeRun, byId.c.activeRun, byId.g1.activeRun]).toEqual([true, true, true, false]);
    expect([byId.a.ended, byId.c.ended]).toEqual([false, true]);
  });
});
