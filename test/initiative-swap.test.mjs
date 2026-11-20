import { describe, expect, it } from "vitest";
import { canSwap, consentUser, swapAllies } from "../scripts/model/initiative-swap.mjs";

/** @returns {import("../scripts/model/initiative-swap.mjs").SwapFacts} */
const facts = (id, more = {}) => ({ id, side: "ally", initiative: 10, alert: false, incapacitated: false,
  defeated: false, ...more });

const aoth = facts("aoth", { alert: true, initiative: 18 });
const krusk = facts("krusk", { initiative: 7 });

describe("canSwap", () => {
  it("lets a combatant with Alert swap with a rolled ally before the combat starts", () => {
    expect(canSwap({ started: false, swapper: aoth, ally: krusk })).toBe(true);
  });

  it("refuses once the combat has started", () => {
    expect(canSwap({ started: true, swapper: aoth, ally: krusk })).toBe(false);
  });

  it("refuses without Alert", () => {
    expect(canSwap({ started: false, swapper: { ...aoth, alert: false }, ally: krusk })).toBe(false);
  });

  it("refuses until both have rolled", () => {
    expect(canSwap({ started: false, swapper: { ...aoth, initiative: null }, ally: krusk })).toBe(false);
    expect(canSwap({ started: false, swapper: aoth, ally: { ...krusk, initiative: null } })).toBe(false);
  });

  it("refuses if either is Incapacitated or defeated", () => {
    expect(canSwap({ started: false, swapper: { ...aoth, incapacitated: true }, ally: krusk })).toBe(false);
    expect(canSwap({ started: false, swapper: aoth, ally: { ...krusk, incapacitated: true } })).toBe(false);
    expect(canSwap({ started: false, swapper: aoth, ally: { ...krusk, defeated: true } })).toBe(false);
  });

  it("only swaps between allies", () => {
    for ( const side of ["enemy", "neutral", "secret"] ) {
      expect(canSwap({ started: false, swapper: aoth, ally: { ...krusk, side } })).toBe(false);
      expect(canSwap({ started: false, swapper: { ...aoth, side }, ally: krusk })).toBe(false);
    }
  });

  it("can't swap with itself", () => {
    expect(canSwap({ started: false, swapper: aoth, ally: aoth })).toBe(false);
  });

  it("allows a swap at initiative 0", () => {
    expect(canSwap({ started: false, swapper: aoth, ally: { ...krusk, initiative: 0 } })).toBe(true);
  });
});

describe("swapAllies", () => {
  it("lists the eligible allies in the order given", () => {
    const others = [aoth, facts("goblin", { side: "enemy" }), krusk, facts("sefris", { initiative: 12 }),
      facts("quillathe", { initiative: null })];
    expect(swapAllies({ started: false, swapper: aoth, others }).map(f => f.id)).toEqual(["krusk", "sefris"]);
  });

  it("lists nobody for a swapper who can't swap", () => {
    expect(swapAllies({ started: false, swapper: { ...aoth, alert: false }, others: [krusk] })).toEqual([]);
    expect(swapAllies({ started: false, swapper: aoth, others: undefined })).toEqual([]);
  });
});

describe("consentUser", () => {
  const owner = (id, more = {}) => ({ id, active: true, isCharacter: false, ...more });

  it("asks nobody when the requester owns the ally", () => {
    expect(consentUser({ requesterId: "p1", owners: [owner("p1")], gmId: "gm" })).toBeNull();
  });

  it("asks the player whose character the ally is, before other owners", () => {
    const owners = [owner("p2"), owner("p3", { isCharacter: true })];
    expect(consentUser({ requesterId: "p1", owners, gmId: "gm" })).toBe("p3");
  });

  it("asks another connected owner when the character's player is away", () => {
    const owners = [owner("p3", { isCharacter: true, active: false }), owner("p2")];
    expect(consentUser({ requesterId: "p1", owners, gmId: "gm" })).toBe("p2");
  });

  it("asks the GM when no owner is connected, or the ally has none", () => {
    expect(consentUser({ requesterId: "p1", owners: [owner("p2", { active: false })], gmId: "gm" })).toBe("gm");
    expect(consentUser({ requesterId: "p1", owners: [], gmId: "gm" })).toBe("gm");
  });

  it("asks nobody when the GM asks for a swap they would answer themselves", () => {
    expect(consentUser({ requesterId: "gm", owners: [], gmId: "gm" })).toBeNull();
  });

  it("asks the ally's player when the GM asks for a swap", () => {
    expect(consentUser({ requesterId: "gm", owners: [owner("p2")], gmId: "gm" })).toBe("p2");
  });
});
