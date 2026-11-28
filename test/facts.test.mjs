/**
 * What the bar reads from live documents for one card (ui/facts.mjs).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { DEFAULTS } from "../scripts/config.mjs";
import { combatantFacts } from "../scripts/ui/facts.mjs";

let adapter;
let tokenDoc;
let combatant;
const settings = { ...DEFAULTS, trackEconomy: false, showEffects: false };

beforeEach(() => {
  installFoundryShims();
  game.user = { isGM: true };
  adapter = { hp: () => null, describe: () => null, movementSpeed: vi.fn(() => 30) };
  tokenDoc = {
    movementHistory: [{ cost: 0, action: "walk" }, { cost: 10, action: "walk" }],
    movementAction: "walk",
    parent: { grid: { units: "ft" } },
    measureMovementPath: vi.fn(() => ({ waypoints: [{ backward: null }, { backward: { distance: 10 } }] }))
  };
  const actor = { statuses: new Set(), testUserPermission: () => true };
  combatant = { id: "hero", name: "Hero", img: "", flags: {}, hidden: false, isDefeated: false, isOwner: true,
    initiative: 12, actor, token: tokenDoc, combat: { started: true, round: 1, combatants: new Map() } };
});

describe("movement this turn", () => {
  it("is read for the acting card", () => {
    const facts = combatantFacts(combatant, { adapter, settings, current: true });
    expect(facts.movement).toEqual({ used: "10", speed: "30", units: "ft", state: "normal" });
  });

  it("isn't measured at all for any other card: it's shown on the acting one only", () => {
    expect(combatantFacts(combatant, { adapter, settings }).movement).toBeNull();
    expect(tokenDoc.measureMovementPath).not.toHaveBeenCalled();
    expect(adapter.movementSpeed).not.toHaveBeenCalled();
  });

  it("isn't read before the combat starts, or with the setting off", () => {
    combatant.combat.started = false;
    expect(combatantFacts(combatant, { adapter, settings, current: true }).movement).toBeNull();
    combatant.combat.started = true;
    const off = { ...settings, movementTracker: false };
    expect(combatantFacts(combatant, { adapter, settings: off, current: true }).movement).toBeNull();
  });
});
