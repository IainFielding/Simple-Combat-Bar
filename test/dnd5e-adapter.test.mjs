import { beforeEach, describe, expect, it, vi } from "vitest";
import { dnd5eAdapter, formatCR } from "../scripts/systems/dnd5e.mjs";
import { adapterFor, registerAdapter } from "../scripts/systems/adapter.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

describe("dnd5e adapter", () => {
  beforeEach(() => installFoundryShims());

  it("formats fractional CRs like the stat block", () => {
    expect([0, 0.125, 0.25, 0.5, 1, 17].map(formatCR)).toEqual(["0", "1/8", "1/4", "1/2", "1", "17"]);
    expect(formatCR(null)).toBeNull();
  });

  it("describes an NPC", () => {
    const actor = { type: "npc", system: { details: { cr: 0.25, type: { value: "humanoid" } } } };
    expect(dnd5eAdapter.describe(actor)).toBe("CR 1/4 Humanoid");
  });

  it("describes an NPC with a custom type", () => {
    const actor = { type: "npc", system: { details: { cr: 5, type: { value: "custom", custom: "Spirit" } } } };
    expect(dnd5eAdapter.describe(actor)).toBe("CR 5 Spirit");
  });

  it("describes a character", () => {
    const actor = {
      type: "character",
      classes: { wizard: { name: "Wizard" }, fighter: { name: "Fighter" } },
      system: { details: { level: 7, race: { name: "Elf" } } }
    };
    expect(dnd5eAdapter.describe(actor)).toBe('DND5E.LevelNumber:{"level":7} Wizard / Fighter (Elf)');
  });

  it("reads HP with temp and the effective max", () => {
    const actor = { system: { attributes: { hp: { value: 20, max: 30, effectiveMax: 35, temp: 5 } } } };
    expect(dnd5eAdapter.hp(actor)).toEqual({ value: 20, max: 35, temp: 5 });
  });

  it("derives health from the statuses every user receives", () => {
    const state = statuses => dnd5eAdapter.healthState({ statuses: new Set(statuses) });
    expect(state([])).toBe("healthy");
    expect(state(["bloodied"])).toBe("bloodied");
    expect(state(["bloodied", "dead"])).toBe("down");
    expect(dnd5eAdapter.healthState({})).toBeNull();
  });

  it("returns null HP for actors without it (vehicles, groups)", () => {
    expect(dnd5eAdapter.hp({ system: { attributes: {} } })).toBeNull();
  });

  it("reads an NPC's XP, and none for anything else", () => {
    expect(dnd5eAdapter.xp({ type: "npc", system: { details: { xp: { value: 450 } } } })).toBe(450);
    expect(dnd5eAdapter.xp({ type: "npc", system: { details: {} } })).toBeNull();
    expect(dnd5eAdapter.xp({ type: "character", system: { details: { xp: { value: 900 } } } })).toBeNull();
  });

  it("writes the award enricher", () => {
    expect(dnd5eAdapter.awardCommand(450)).toBe("[[/award 450xp]]");
  });

  it("offers no award when the world levels without XP", () => {
    game.settings._values.levelingMode = "noxp";
    expect(dnd5eAdapter.awardCommand(450)).toBeNull();
    game.settings._values.levelingMode = "xpBoons";
    expect(dnd5eAdapter.awardCommand(450)).toBe("[[/award 450xp]]");
  });
});

describe("dnd5e initiative dialog", () => {
  beforeEach(() => installFoundryShims());

  /** dnd5e's D20Roll.build: the dialog writes the chosen mode into the message config it's given. */
  const dice = picked => ({
    BasicRoll: { getMessageMode: () => "public" },
    D20Roll: { build: async (_config, _dialog, message) => {
      if ( picked === null ) return [];
      message.rollMode = picked;
      return [{ formula: "1d20" }];
    } }
  });

  it("caches the roll and hands back the roll mode picked in the dialog", async () => {
    globalThis.CONFIG = { Dice: dice("gmroll") };
    const actor = { getInitiativeRollConfig: () => ({ options: {} }) };
    expect(await dnd5eAdapter.configureInitiative(actor)).toEqual({ messageMode: "gmroll" });
    expect(actor._cachedInitiativeRoll).toEqual({ formula: "1d20" });
  });

  it("resolves false when the dialog is closed", async () => {
    globalThis.CONFIG = { Dice: dice(null) };
    const actor = { getInitiativeRollConfig: () => ({ options: {} }) };
    expect(await dnd5eAdapter.configureInitiative(actor)).toBe(false);
    expect(actor._cachedInitiativeRoll).toBeUndefined();
  });
});

describe("adapter registry", () => {
  it("falls back to the generic adapter", () => {
    expect(adapterFor("pf2e").id).toBe("generic");
    expect(adapterFor("dnd5e").id).toBe("dnd5e");
  });

  it("fills unregistered methods from the generic adapter", () => {
    registerAdapter({ id: "test-system", describe: () => "hi" });
    const adapter = adapterFor("test-system");
    expect(adapter.describe()).toBe("hi");
    expect(typeof adapter.hp).toBe("function");
  });
});

describe("dnd5e Alert and Incapacitated", () => {
  beforeEach(() => {
    installFoundryShims();
    globalThis.dnd5e = { settings: { rulesVersion: "modern" } };
  });

  const alert = { flags: { dnd5e: { initiativeAlert: true } } };

  it("offers the swap with Alert under the 2024 rules", () => {
    expect(dnd5eAdapter.initiativeSwap(alert)).toBe(true);
    expect(dnd5eAdapter.initiativeSwap({ flags: {} })).toBe(false);
    expect(dnd5eAdapter.initiativeSwap(null)).toBe(false);
  });

  it("has no swap under the 2014 rules, where Alert is only +5", () => {
    globalThis.dnd5e.settings.rulesVersion = "legacy";
    expect(dnd5eAdapter.initiativeSwap(alert)).toBe(false);
  });

  it("reads the rules version from the setting when dnd5e's global hasn't got it", () => {
    globalThis.dnd5e = undefined;
    game.settings._values.rulesVersion = "legacy";
    expect(dnd5eAdapter.initiativeSwap(alert)).toBe(false);
  });

  it("reads a character's Inspiration as Heroic under the 2024 rules and plain under 2014", () => {
    const hero = inspired => ({ type: "character", system: { attributes: { inspiration: inspired } } });
    expect(dnd5eAdapter.inspiration(hero(true))).toEqual({ active: true, rules: "heroic" });
    expect(dnd5eAdapter.inspiration(hero(false))).toEqual({ active: false, rules: "heroic" });
    globalThis.dnd5e.settings.rulesVersion = "legacy";
    expect(dnd5eAdapter.inspiration(hero(true))).toEqual({ active: true, rules: "legacy" });
    expect(dnd5eAdapter.inspiration({ type: "npc", system: {} })).toBeNull();
  });

  it("gives and uses Inspiration on characters only", async () => {
    const hero = { type: "character", update: vi.fn() };
    await dnd5eAdapter.setInspiration(hero, true);
    expect(hero.update).toHaveBeenCalledWith({ "system.attributes.inspiration": true });
    const npc = { type: "npc", update: vi.fn() };
    await dnd5eAdapter.setInspiration(npc, true);
    expect(npc.update).not.toHaveBeenCalled();
  });

  it("explains Exhaustion under the 2024 rules: a running penalty, in the actor's units", () => {
    const key = "sogrom-simple-combat-bar.exhaustion.modern.penalty";
    expect(dnd5eAdapter.conditionLevelText("exhaustion", 3, {})).toBe(`${key}:{"rolls":6,"speed":"15 ft"}`);
    globalThis.dnd5e.utils = {
      convertLength: (v, _from, { to }) => ({ value: to === "m" ? v * 0.3 : v, unit: to }),
      formatLength: (v, unit) => `${v} ${unit}`
    };
    const metric = { system: { attributes: { movement: { units: "m" } } } };
    expect(dnd5eAdapter.conditionLevelText("exhaustion", 2, metric)).toBe(`${key}:{"rolls":4,"speed":"3 m"}`);
    expect(dnd5eAdapter.conditionLevelText("exhaustion", 6, {})).toBe("sogrom-simple-combat-bar.exhaustion.modern.dead");
  });

  it("explains Exhaustion under the 2014 rules: every level's effect so far", () => {
    globalThis.dnd5e.settings.rulesVersion = "legacy";
    const key = n => `sogrom-simple-combat-bar.exhaustion.legacy.${n}`;
    expect(dnd5eAdapter.conditionLevelText("exhaustion", 3, {})).toBe([key(1), key(2), key(3)].join(" "));
  });

  it("explains nothing for other conditions or no level", () => {
    expect(dnd5eAdapter.conditionLevelText("prone", 2, {})).toBeNull();
    expect(dnd5eAdapter.conditionLevelText("exhaustion", 0, {})).toBeNull();
  });

  it("reads Incapacitated from the actor's statuses", () => {
    expect(dnd5eAdapter.incapacitated({ statuses: new Set(["incapacitated", "stunned"]) })).toBe(true);
    expect(dnd5eAdapter.incapacitated({ statuses: new Set(["prone"]) })).toBe(false);
    expect(dnd5eAdapter.incapacitated(null)).toBe(false);
  });
});
