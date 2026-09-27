import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../scripts/config.mjs";
import { buildPortraitModel, changedFields, damageFill, sameModel } from "../scripts/model/portrait-model.mjs";

const facts = (over = {}) => ({
  id: "c1", name: "Goblin", img: "goblin.webp", side: "enemy",
  isGM: false, isOwner: false, canObserve: false, isPC: false,
  hidden: false, defeated: false, initiative: 14, tokenDisplayName: 0,
  hp: { value: 3, max: 7, temp: null }, description: "CR 1/4 Humanoid",
  isEvent: false, eventRoundsLeft: null, ...over
});
const ctx = (settings = {}) => ({ settings: { ...DEFAULTS, ...settings }, current: false, acted: false, run: null });

describe("buildPortraitModel", () => {
  it("shows players only the health state of an enemy by default", () => {
    const m = buildPortraitModel(facts(), ctx());
    expect(m.hpValue).toBeNull();
    expect(m.hpState).toBe("bloodied");
    expect(m.hpShown).toBe(true);
    expect(m.description).toBeNull();
  });

  it("shows owners their numbers and description", () => {
    const m = buildPortraitModel(facts({ isOwner: true, hp: { value: 20, max: 25, temp: 4 } }), ctx());
    expect([m.hpValue, m.hpMax, m.hpTemp]).toEqual([20, 25, 4]);
    expect(m.description).toBe("CR 1/4 Humanoid");
  });

  it("hides HP completely with ownerOnly", () => {
    const m = buildPortraitModel(facts(), ctx({ hpVisibility: "ownerOnly" }));
    expect(m.hpShown).toBe(false);
    expect(m.hpPct).toBeNull();
    expect(m.damagePct).toBeNull();
  });

  it("masks initiative for enemies when asked", () => {
    expect(buildPortraitModel(facts(), ctx({ hideEnemyInitiative: true })).initiative).toBe("?");
    expect(buildPortraitModel(facts(), ctx()).initiative).toBe("14");
  });

  it("shows only the decimals each initiative has", () => {
    const at = initiative => buildPortraitModel(facts({ initiative }), { ...ctx(), decimals: 2 }).initiative;
    expect(at(14.02)).toBe("14.02");
    expect(at(21.5)).toBe("21.5");
    expect(at(25)).toBe("25");
    expect(at(10.004)).toBe("10");
  });

  it("offers the roll button only to owners and the GM, and only before rolling", () => {
    expect(buildPortraitModel(facts({ initiative: null }), ctx()).canRoll).toBe(false);
    expect(buildPortraitModel(facts({ initiative: null, isOwner: true }), ctx()).canRoll).toBe(true);
    expect(buildPortraitModel(facts({ initiative: 3, isOwner: true }), ctx()).canRoll).toBe(false);
  });

  it("is made only of primitives, so comparison is exact", () => {
    const m = buildPortraitModel(facts(), ctx());
    for ( const v of Object.values(m) ) expect(v === null || typeof v !== "object").toBe(true);
  });
});

describe("damage fill (default on)", () => {
  it("is on by default", () => {
    expect(DEFAULTS.damageFill).toBe(true);
  });

  it("is exact for viewers who see numbers", () => {
    expect(buildPortraitModel(facts({ isOwner: true }), ctx()).damagePct).toBe(57);
  });

  it("is banded for viewers who see only the state, so it can't be read as a number", () => {
    expect(buildPortraitModel(facts(), ctx()).damagePct).toBe(50);
    expect(damageFill("state", 90)).toBe(0);
    expect(damageFill("state", 20)).toBe(75);
    expect(damageFill("state", 0)).toBe(100);
  });

  it("is off when the setting is off", () => {
    expect(buildPortraitModel(facts({ isOwner: true }), ctx({ damageFill: false })).damagePct).toBeNull();
  });

  it("is absent without HP", () => {
    expect(buildPortraitModel(facts({ hp: null, isOwner: true }), ctx()).damagePct).toBeNull();
  });
});

describe("viewers who don't receive HP (spec: unlinked token deltas reach players without system data)", () => {
  it("uses the status-derived state and its band, never a number", () => {
    const m = buildPortraitModel(facts({ hp: null, healthHint: "bloodied" }), ctx());
    expect(m.hpState).toBe("bloodied");
    expect(m.hpShown).toBe(true);
    expect(m.hpPct).toBeNull();
    expect(m.hpValue).toBeNull();
    expect(m.damagePct).toBe(50);
    expect(m.hpBar).toBe(false);
  });

  it("shows nothing when HP is hidden from others", () => {
    const m = buildPortraitModel(facts({ hp: null, healthHint: "bloodied" }), ctx({ hpVisibility: "ownerOnly" }));
    expect(m.hpShown).toBe(false);
    expect(m.damagePct).toBeNull();
  });

  it("falls back to the state even when the GM allows numbers for all", () => {
    const m = buildPortraitModel(facts({ hp: null, healthHint: "down" }), ctx({ hpVisibility: "all" }));
    expect(m.hpState).toBe("down");
    expect(m.damagePct).toBe(100);
  });
});

describe("sameModel / changedFields", () => {
  it("detects exactly the changed fields", () => {
    const a = buildPortraitModel(facts(), ctx());
    const b = buildPortraitModel(facts({ hp: { value: 1, max: 7 } }), ctx());
    expect(sameModel(a, { ...a })).toBe(true);
    expect(changedFields(a, b).sort()).toEqual(["damagePct", "hpPct", "hpState"]);
    expect(changedFields(null, a)).toEqual(Object.keys(a));
  });
});
