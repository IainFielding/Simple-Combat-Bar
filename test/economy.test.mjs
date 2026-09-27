import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationSlot, anySpent, emptyEconomy, normaliseEconomy, pipStates, spend, toggle }
  from "../scripts/model/economy.mjs";
import { MIDI_EFFECT_IDS, bg3Bridge, economyProvider, midiEconomy, nativeEconomy, spendSlot, syncMidiEffects, toggleSlot }
  from "../scripts/systems/economy.mjs";
import { DEFAULTS, MODULE_ID } from "../scripts/config.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

describe("economy rules", () => {
  it("maps dnd5e activation types to slots", () => {
    expect(["action", "bonus", "reaction", "legendary", "lair", "minute", undefined].map(activationSlot))
      .toEqual(["action", "bonus", "reaction", null, null, null, null]);
  });

  it("spends and toggles without touching the other slots", () => {
    expect(spend(emptyEconomy(), "bonus")).toEqual({ action: false, bonus: true, reaction: false });
    expect(toggle({ action: true }, "action")).toEqual(emptyEconomy());
    expect(spend(emptyEconomy(), "nonsense")).toEqual(emptyEconomy());
  });

  it("normalises whatever was stored", () => {
    expect(normaliseEconomy(null)).toEqual(emptyEconomy());
    expect(normaliseEconomy({ action: 1, extra: true })).toEqual({ action: true, bonus: false, reaction: false });
    expect(anySpent(emptyEconomy())).toBe(false);
    expect(anySpent({ reaction: true })).toBe(true);
  });

  it("shows all three pips on the current card and only the reaction elsewhere", () => {
    const state = { action: true, bonus: false, reaction: false };
    expect(pipStates(state, { current: true, shown: true }))
      .toEqual({ pipAction: "spent", pipBonus: "available", pipReaction: "available" });
    expect(pipStates(state, { current: false, shown: true }))
      .toEqual({ pipAction: null, pipBonus: null, pipReaction: "available" });
  });

  it("shows nothing untracked, or to a viewer who may not see it", () => {
    const none = { pipAction: null, pipBonus: null, pipReaction: null };
    expect(pipStates(null, { current: true, shown: true })).toEqual(none);
    expect(pipStates(emptyEconomy(), { current: true, shown: false })).toEqual(none);
  });

  it("is on, and auto-spends, by default", () => {
    expect(DEFAULTS.trackEconomy).toBe(true);
    expect(DEFAULTS.autoSpendEconomy).toBe(true);
  });
});

/** A combatant and actor just real enough for the providers. */
function fakes({ economy, midiFlags } = {}) {
  const effects = new Map();
  const actor = {
    flags: { "midi-qol": { actions: midiFlags ?? {} } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    setFlag: vi.fn(async function(scope, key, value) {
      const [group, slot] = key.split(".");
      this.flags[scope][group][slot] = value;
    }),
    effects: { get: id => effects.get(id) },
    createEmbeddedDocuments: vi.fn(async (_type, docs) => docs.forEach(d => effects.set(d._id, d))),
    deleteEmbeddedDocuments: vi.fn(async (_type, ids) => ids.forEach(id => effects.delete(id)))
  };
  const combatant = {
    actor,
    flags: { [MODULE_ID]: { economy } },
    update: vi.fn(async function(changes) {
      this.flags[MODULE_ID].economy = changes[`flags.${MODULE_ID}.economy`];
    })
  };
  return { actor, combatant, effects };
}

describe("providers", () => {
  beforeEach(() => {
    installFoundryShims();
    delete globalThis.MidiQOL;
  });

  const active = ids => { game.modules = { get: id => (ids.includes(id) ? { active: true } : null) }; };

  it("use the bar's own tracking unless midi-qol is active", () => {
    active([]);
    expect(economyProvider()).toBe(nativeEconomy);
    active(["midi-qol"]);
    expect(economyProvider()).toBe(midiEconomy);
  });

  it("native: reads and writes the combatant flag", async () => {
    active([]);
    const { combatant } = fakes({ economy: { reaction: true } });
    expect(nativeEconomy.read(combatant)).toEqual({ action: false, bonus: false, reaction: true });
    await spendSlot(combatant, "action");
    expect(combatant.flags[MODULE_ID].economy).toEqual({ action: true, bonus: false, reaction: true });
    await toggleSlot(combatant, "reaction");
    expect(combatant.flags[MODULE_ID].economy.reaction).toBe(false);
  });

  it("native: doesn't write when the slot is already spent", async () => {
    active([]);
    const { combatant } = fakes({ economy: { action: true } });
    await spendSlot(combatant, "action");
    expect(combatant.update).not.toHaveBeenCalled();
  });

  it("native: events and actorless combatants aren't tracked", () => {
    expect(nativeEconomy.read({ actor: null, flags: {} })).toBeNull();
    expect(nativeEconomy.read({ actor: {}, flags: { [MODULE_ID]: { event: true } } })).toBeNull();
  });

  it("midi-qol: reads its flags, and its API when it has one", () => {
    const { combatant, actor } = fakes({ midiFlags: { action: true, bonus: false, reaction: false } });
    expect(midiEconomy.read(combatant)).toEqual({ action: true, bonus: false, reaction: false });
    globalThis.MidiQOL = { hasUsedReaction: a => a === actor, hasUsedBonusAction: () => false };
    expect(midiEconomy.read(combatant).reaction).toBe(true);
  });

  it("midi-qol: spends the reaction through its API, and the action through its flag", async () => {
    const { combatant, actor } = fakes({ midiFlags: {} });
    globalThis.MidiQOL = {
      hasUsedReaction: () => false, hasUsedBonusAction: () => false,
      setReactionUsed: vi.fn(async () => {}), setBonusActionUsed: vi.fn(async () => {})
    };
    await midiEconomy.write(combatant, { action: true, bonus: false, reaction: true });
    expect(globalThis.MidiQOL.setReactionUsed).toHaveBeenCalledWith(actor);
    expect(globalThis.MidiQOL.setBonusActionUsed).not.toHaveBeenCalled();
    expect(actor.flags["midi-qol"].actions.action).toBe(true);
  });

  it("bridges to BG3 Inspired HUD only when it's active without midi-qol", () => {
    active(["bg3-inspired-hotbar"]);
    expect(bg3Bridge()).toBe(true);
    active(["bg3-inspired-hotbar", "midi-qol"]);
    expect(bg3Bridge()).toBe(false);
    active([]);
    expect(bg3Bridge()).toBe(false);
  });

  it("the bridge applies and removes midi-qol's effects to match", async () => {
    const { actor, effects } = fakes();
    await syncMidiEffects(actor, { bonus: true, reaction: false });
    expect([...effects.keys()]).toEqual([MIDI_EFFECT_IDS.bonus]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", expect.any(Array), { keepId: true });
    await syncMidiEffects(actor, { bonus: false, reaction: true });
    expect([...effects.keys()]).toEqual([MIDI_EFFECT_IDS.reaction]);
  });

  it("native writes go through the bridge when BG3 Inspired HUD is on", async () => {
    active(["bg3-inspired-hotbar"]);
    const { combatant, effects } = fakes({ economy: {} });
    await spendSlot(combatant, "reaction");
    expect(effects.has(MIDI_EFFECT_IDS.reaction)).toBe(true);
  });
});
