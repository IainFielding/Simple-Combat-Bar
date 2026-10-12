import { describe, expect, it } from "vitest";
import { IDLE, turnNotice, turnWatch } from "../scripts/model/turn-watch.mjs";

const e = (id, side, extra = {}) => ({ id, side, ...extra });
// Two heroes of mine either side of a goblin, then another player's hero and a wolf.
const turns = [e("a", "ally", { mine: true }), e("g", "enemy"), e("b", "ally", { mine: true }), e("c", "ally"),
  e("w", "neutral")];
const watch = (turn, extra = {}) => turnWatch({ turns, turn, started: true, ...extra });

describe("turnWatch", () => {
  it("is idle before the combat starts", () => {
    expect(turnWatch({ turns, turn: 0, started: false })).toBe(IDLE);
    expect(turnWatch({ turns, turn: null, started: true })).toBe(IDLE);
  });

  it("reports my combatant acting, and mine up next", () => {
    expect(watch(0)).toEqual({ mine: ["a"], upNext: [] });
    expect(watch(1)).toEqual({ mine: [], upNext: ["b"] });
    expect(watch(2)).toEqual({ mine: ["b"], upNext: [] });
  });

  it("says nothing about anyone else's turn", () => {
    expect(watch(3)).toEqual({ mine: [], upNext: [] });
  });

  it("looks round the end of the round for who's next", () => {
    expect(watch(4)).toEqual({ mine: [], upNext: ["a"] });
  });

  it("passes over the defeated and those not here yet", () => {
    const skipped = [e("x", "enemy"), e("g", "enemy", { skip: true }), e("a", "ally", { mine: true })];
    expect(turnWatch({ turns: skipped, turn: 0, started: true })).toEqual({ mine: [], upNext: ["a"] });
  });

  it("isn't up next after itself when alone", () => {
    expect(turnWatch({ turns: [e("a", "ally", { mine: true })], turn: 0, started: true }))
      .toEqual({ mine: ["a"], upNext: [] });
  });

  describe("with group turns", () => {
    // a b | g1 g2 | c d: mine are a, b and d.
    const grouped = [e("a", "ally", { mine: true }), e("b", "ally", { mine: true }), e("g1", "enemy"), e("g2", "enemy"),
      e("c", "ally"), e("d", "ally", { mine: true })];
    const group = (turn, extra = {}) => turnWatch({ turns: grouped, turn, started: true, grouped: true, ...extra });

    it("has every member of my run acting at once", () => {
      expect(group(0)).toEqual({ mine: ["a", "b"], upNext: [] });
      expect(group(1)).toEqual({ mine: ["a", "b"], upNext: [] });
    });

    it("drops a member who has ended their part", () => {
      expect(group(1, { ended: ["a"] })).toEqual({ mine: ["b"], upNext: [] });
    });

    it("has the whole next run up next", () => {
      expect(group(2)).toEqual({ mine: [], upNext: ["d"] });
      expect(group(4)).toEqual({ mine: ["d"], upNext: ["a", "b"] });
    });

    it("treats the run as single turns when grouping is off", () => {
      expect(turnWatch({ turns: grouped, turn: 0, started: true })).toEqual({ mine: ["a"], upNext: ["b"] });
    });
  });
});

describe("turnNotice", () => {
  it("announces a turn that has just become mine", () => {
    expect(turnNotice({ mine: [], upNext: ["a"] }, { mine: ["a"], upNext: [] })).toEqual({ kind: "yourTurn", ids: ["a"] });
  });

  it("announces being up next", () => {
    expect(turnNotice(IDLE, { mine: [], upNext: ["b"] })).toEqual({ kind: "upNext", ids: ["b"] });
  });

  it("prefers the turn to what's next", () => {
    expect(turnNotice(IDLE, { mine: ["a"], upNext: ["b"] })).toEqual({ kind: "yourTurn", ids: ["a"] });
  });

  it("stays quiet while the pointer moves within my group", () => {
    expect(turnNotice({ mine: ["a", "b"], upNext: [] }, { mine: ["a", "b"], upNext: [] })).toBeNull();
    expect(turnNotice({ mine: ["a", "b"], upNext: [] }, { mine: ["b"], upNext: [] })).toBeNull();
  });

  it("stays quiet when nothing of mine is involved", () => {
    expect(turnNotice(IDLE, IDLE)).toBeNull();
  });
});
