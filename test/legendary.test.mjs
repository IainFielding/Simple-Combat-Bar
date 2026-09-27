import { describe, expect, it, vi } from "vitest";
import { adjustSpent, legendaryCounter } from "../scripts/model/legendary.mjs";
import { dnd5eAdapter } from "../scripts/systems/dnd5e.mjs";
import { genericAdapter } from "../scripts/systems/generic.mjs";
import { DEFAULTS } from "../scripts/config.mjs";

describe("legendaryCounter", () => {
  it("shows a creature's counter to viewers who may see it", () => {
    expect(legendaryCounter({ value: 2, max: 3 }, true)).toEqual({ value: 2, max: 3 });
    expect(legendaryCounter({ value: 2, max: 3 }, false)).toBeNull();
  });

  it("hides counters a creature doesn't have", () => {
    expect(legendaryCounter({ value: 0, max: 0 }, true)).toBeNull();
    expect(legendaryCounter(null, true)).toBeNull();
  });

  it("keeps the value within range", () => {
    expect(legendaryCounter({ value: 5, max: 3 }, true)).toEqual({ value: 3, max: 3 });
    expect(legendaryCounter({ value: -1, max: 3 }, true)).toEqual({ value: 0, max: 3 });
  });
});

describe("adjustSpent", () => {
  it("spends and restores one at a time, within 0..max", () => {
    expect(adjustSpent(0, 3, 1)).toBe(1);
    expect(adjustSpent(3, 3, 1)).toBe(3);
    expect(adjustSpent(1, 3, -1)).toBe(0);
    expect(adjustSpent(0, 3, -1)).toBe(0);
  });
});

describe("adapters", () => {
  const dragon = {
    system: { resources: { legact: { value: 2, max: 3, spent: 1 }, legres: { value: 3, max: 3, spent: 0 } } },
    update: vi.fn(async () => {})
  };

  it("dnd5e reads legendary actions and resistances", () => {
    expect(dnd5eAdapter.legendary(dragon)).toEqual({ actions: { value: 2, max: 3 }, resistances: { value: 3, max: 3 } });
    expect(dnd5eAdapter.legendary({ system: { resources: { legact: { max: 0 }, legres: { max: 0 } } } }))
      .toEqual({ actions: null, resistances: null });
    expect(dnd5eAdapter.legendary({ system: {} })).toEqual({ actions: null, resistances: null });
  });

  it("dnd5e adjusts by writing `spent`, as dnd5e itself does", async () => {
    await dnd5eAdapter.adjustLegendary(dragon, "actions", 1);
    expect(dragon.update).toHaveBeenCalledWith({ "system.resources.legact.spent": 2 });
    await dnd5eAdapter.adjustLegendary(dragon, "resistances", -1);
    expect(dragon.update).toHaveBeenLastCalledWith({ "system.resources.legres.spent": 0 });
  });

  it("the generic adapter has none", () => {
    expect(genericAdapter.legendary({})).toEqual({ actions: null, resistances: null });
  });

  it("badges are on by default", () => {
    expect(DEFAULTS.legendaryBadges).toBe(true);
  });
});
