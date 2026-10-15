// @vitest-environment jsdom
/**
 * The bar controller against a stand-in combat: what each kind of change costs. The model and view
 * layers have their own suites; this one checks the flush decides correctly what to redo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { invalidateSettings } from "../scripts/config.mjs";
import { CombatBar } from "../scripts/ui/combat-bar.mjs";

/** Foundry's Collection iterates values, not entries, and has find. */
class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  find(fn) {
    for ( const value of this.values() ) if ( fn(value) ) return value;
    return undefined;
  }
}

function makeActor(id, hp = 30) {
  return {
    id, name: id, img: `${id}.webp`, type: "npc", hasPlayerOwner: false,
    system: { attributes: { hp: { value: hp, max: 30 } }, details: {}, resources: {} },
    statuses: new Set(), appliedEffects: [],
    testUserPermission: () => true,
    getFlag: () => undefined
  };
}

function makeCombat() {
  const combat = { id: "combat", started: true, round: 1, turn: 0, settings: {}, getFlag: () => undefined };
  const combatants = new Collection();
  for ( const [index, id] of ["goblin", "ogre"].entries() ) {
    combatants.set(id, {
      id, name: id, img: `${id}.webp`, actor: makeActor(id), actorId: id, token: null, tokenId: null,
      flags: {}, hidden: false, isDefeated: false, initiative: 20 - index, isOwner: true, isNPC: true,
      group: null, parent: combat, combat
    });
  }
  combat.combatants = combatants;
  combat.turns = [...combatants.values()];
  Object.defineProperty(combat, "combatant", { get: () => combat.turns[combat.turn] ?? null });
  return combat;
}

/** Fire a hook the bar listens to, as core would after a document update. */
const updateActor = (actor, changes) => Hooks.callAll("updateActor", actor, changes);

let bar;
let combat;
let host;

beforeEach(() => {
  installFoundryShims();
  invalidateSettings();
  game.users = { activeGM: null };
  CONST.ACTIVE_EFFECT_SHOW_ICON = { NONE: 0, CONDITIONAL: 1, ALWAYS: 2 };
  CONFIG.specialStatusEffects = { DEFEATED: "dead" };
  globalThis.foundry = { applications: { ux: { ContextMenu: class {} } } };
  // Flushes are run by hand with flushNow; reduced motion keeps jsdom (no Element#animate) off the slides.
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: true });

  document.body.replaceChildren();
  host = document.createElement("div");
  host.id = "ui-top";
  document.body.append(host);

  combat = makeCombat();
  bar = new CombatBar();
  bar.bind(combat);
  bar.flushNow();
});

afterEach(() => {
  bar.destroy();
});

describe("CombatBar", () => {
  it("draws a portrait per combatant and sizes the bar on bind", () => {
    expect(bar.track.querySelectorAll(".scb-portrait")).toHaveLength(2);
    expect(bar.root.style.getPropertyValue("--scb-size")).toBe("100px");
  });

  it("keeps the track out of screen readers' live announcements", () => {
    expect(bar.track.closest("[aria-live]")).toBeNull();
  });

  it("re-derives a portrait without measuring the page when only its HP changes", () => {
    const measure = vi.spyOn(host, "getBoundingClientRect");
    const flushes = bar.stats.flushes;
    const goblin = combat.combatants.get("goblin").actor;
    goblin.system.attributes.hp.value = 10;
    updateActor(goblin, { system: { attributes: { hp: { value: 10 } } } });
    bar.flushNow();
    expect(bar.stats.flushes).toBe(flushes + 1);
    expect(bar.track.querySelector('[data-combatant-id="goblin"] .scb-damage')
      .style.getPropertyValue("--scb-damage-pct")).not.toBe("0%");
    expect(measure).not.toHaveBeenCalled();
  });

  it("measures the page once when the order changes", () => {
    const measure = vi.spyOn(host, "getBoundingClientRect");
    combat.turn = 1;
    Hooks.callAll("updateCombat", combat, { turn: 1 });
    bar.flushNow();
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("ignores another module's actor flags", () => {
    const flushes = bar.stats.flushes;
    updateActor(combat.combatants.get("goblin").actor, { flags: { "some-module": { seen: true } } });
    bar.flushNow();
    expect(bar.stats.flushes).toBe(flushes);
  });

  it("ignores midi-qol's flags while midi-qol is installed but not active", () => {
    game.modules.get = id => (id === "midi-qol" ? { active: false } : null);
    const flushes = bar.stats.flushes;
    updateActor(combat.combatants.get("goblin").actor, { flags: { "midi-qol": { actions: { bonus: true } } } });
    bar.flushNow();
    expect(bar.stats.flushes).toBe(flushes);
  });

  it.each([
    ["a change", { "midi-qol": { actions: { bonus: true } } }],
    ["a removal", { "-=midi-qol": null }]
  ])("refreshes on %s to midi-qol's flags with midi-qol active", (_label, flags) => {
    game.modules.get = id => (id === "midi-qol" ? { active: true } : null);
    const flushes = bar.stats.flushes;
    updateActor(combat.combatants.get("goblin").actor, { flags });
    bar.flushNow();
    expect(bar.stats.flushes).toBe(flushes + 1);
  });
});
