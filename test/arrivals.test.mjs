import { describe, expect, it } from "vitest";
import { arrivalRound, isAway, isDue, normaliseArrival, skipAbsent } from "../scripts/model/arrivals.mjs";

describe("arrivalRound / isAway / isDue", () => {
  const flags = { arrival: { round: 2, hidden: false } };

  it("reads the round, and nothing from a combatant already here", () => {
    expect(arrivalRound(flags)).toBe(2);
    expect(arrivalRound({})).toBeNull();
    expect(arrivalRound({ arrival: null })).toBeNull();
    expect(arrivalRound({ arrival: { round: 0 } })).toBeNull();
  });

  it("is away before its round and due from it on", () => {
    expect([1, 2, 3].map(r => isAway(flags, r))).toEqual([true, false, false]);
    expect([1, 2, 3].map(r => isDue(flags, r))).toEqual([false, true, true]);
    expect(isAway({}, 1)).toBe(false);
    expect(isDue({}, 1)).toBe(false);
  });
});

describe("normaliseArrival", () => {
  it("treats blank as here now", () => {
    expect(normaliseArrival("", 1)).toEqual({ round: null, error: null });
  });

  it("accepts a whole round from the current one on", () => {
    expect(normaliseArrival("2", 0)).toEqual({ round: 2, error: null });
    expect(normaliseArrival(3, 3)).toEqual({ round: 3, error: null });
  });

  it.each([["1", 2], [0, 0], ["2.5", 1], ["soon", 1]])("rejects %o in round %i", (value, round) => {
    expect(normaliseArrival(value, round).error).toBe("round");
  });
});

describe("skipAbsent", () => {
  // Six skeletons, then the Death Tyrant at -0.01: last in the order, arriving in round 2.
  const skeletons = Array.from({ length: 6 }, () => ({ arrivesRound: null }));
  const turns = [...skeletons, { arrivesRound: 2 }];

  it("leaves a move alone that lands on someone here", () => {
    expect(skipAbsent({ turns, round: 1, turn: 3 })).toBeNull();
    expect(skipAbsent({ turns, round: 2, turn: 6 })).toBeNull();
  });

  it("skips the tyrant's turn in round 1, into round 2", () => {
    expect(skipAbsent({ turns, round: 1, turn: 6 })).toEqual({ round: 2, turn: 0 });
  });

  it("skips it backwards too", () => {
    const middle = [{ arrivesRound: null }, { arrivesRound: 3 }, { arrivesRound: null }];
    expect(skipAbsent({ turns: middle, round: 2, turn: 1, direction: -1 })).toEqual({ round: 2, turn: 0 });
    expect(skipAbsent({ turns: middle, round: 2, turn: 1 })).toEqual({ round: 2, turn: 2 });
  });

  it("won't step back before round 1", () => {
    const first = [{ arrivesRound: 2 }, { arrivesRound: null }];
    expect(skipAbsent({ turns: first, round: 1, turn: 0, direction: -1 })).toBeNull();
  });

  it("steps over the defeated as well, going forward, when the combat skips them", () => {
    const mixed = [{ arrivesRound: 3 }, { arrivesRound: null, defeated: true }, { arrivesRound: null }];
    expect(skipAbsent({ turns: mixed, round: 1, turn: 0, skipDefeated: true })).toEqual({ round: 1, turn: 2 });
    expect(skipAbsent({ turns: mixed, round: 1, turn: 0 })).toEqual({ round: 1, turn: 1 });
  });

  it("gives up after a lap when nobody is here", () => {
    expect(skipAbsent({ turns: [{ arrivesRound: 5 }, { arrivesRound: 5 }], round: 1, turn: 0 })).toBeNull();
  });

  it("does nothing with no turn, or before combat starts", () => {
    expect(skipAbsent({ turns, round: 1, turn: null })).toBeNull();
    expect(skipAbsent({ turns, round: 0, turn: 6 })).toBeNull();
  });
});
