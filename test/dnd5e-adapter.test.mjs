import { beforeEach, describe, expect, it } from "vitest";
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
