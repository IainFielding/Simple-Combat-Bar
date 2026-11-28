/**
 * Surprise under both rule sets: who the GM may mark, and when the bar takes it off again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { afterInitiative, afterTurn, canClearSurprised, canMarkSurprised } from "../scripts/ui/surprise-service.mjs";

let gm;
let combat;
let goblin;

/** A goblin whose statuses dnd5e's toggleStatusEffect really changes. */
function makeGoblin(surprised = false) {
  const statuses = new Set(surprised ? ["surprised"] : []);
  const actor = {
    statuses,
    toggleStatusEffect: vi.fn(async (id, { active }) => (active ? statuses.add(id) : statuses.delete(id)))
  };
  return { id: "goblin", initiative: null, actor, combat };
}

const rules = version => { globalThis.dnd5e = { settings: { rulesVersion: version } }; };

beforeEach(() => {
  installFoundryShims();
  gm = { id: "gm", isGM: true, isSelf: true };
  game.user = gm;
  game.users = { activeGM: gm };
  combat = { started: false, combatants: new Map() };
  goblin = makeGoblin();
  combat.combatants.set(goblin.id, goblin);
  rules("modern");
});

describe("marking", () => {
  it("lets the GM mark someone surprised before the fight, and clear it", () => {
    expect(canMarkSurprised(goblin)).toBe(true);
    goblin.actor.statuses.add("surprised");
    expect(canMarkSurprised(goblin)).toBe(false);
    expect(canClearSurprised(goblin)).toBe(true);
  });

  it("offers no marking once the combat has started, or to a player", () => {
    combat.started = true;
    expect(canMarkSurprised(goblin)).toBe(false);
    combat.started = false;
    game.user = { isGM: false };
    expect(canMarkSurprised(goblin)).toBe(false);
  });

  it("2024: offers no marking once initiative is rolled, since that's all surprise affects", () => {
    goblin.initiative = 12;
    expect(canMarkSurprised(goblin)).toBe(false);
    rules("legacy");
    expect(canMarkSurprised(goblin)).toBe(true);
  });
});

describe("2024 rules", () => {
  it("clears surprise once initiative is rolled, and not at the end of a turn", async () => {
    goblin.actor.statuses.add("surprised");
    await afterTurn(combat, { round: 1, combatantId: "goblin" });
    expect(goblin.actor.statuses.has("surprised")).toBe(true);
    await afterInitiative(goblin, { initiative: 7 });
    expect(goblin.actor.statuses.has("surprised")).toBe(false);
  });
});

describe("2014 rules", () => {
  beforeEach(() => rules("legacy"));

  it("keeps surprise through the initiative roll and clears it when its first turn ends", async () => {
    goblin.actor.statuses.add("surprised");
    await afterInitiative(goblin, { initiative: 7 });
    expect(goblin.actor.statuses.has("surprised")).toBe(true);
    await afterTurn(combat, { round: 1, combatantId: "goblin" });
    expect(goblin.actor.statuses.has("surprised")).toBe(false);
  });

  it("doesn't count the combat starting as the end of a turn", async () => {
    goblin.actor.statuses.add("surprised");
    await afterTurn(combat, { round: 0, combatantId: "goblin" });
    expect(goblin.actor.statuses.has("surprised")).toBe(true);
  });
});

it("leaves the clearing to the active GM", async () => {
  game.users.activeGM = { id: "other", isSelf: false };
  goblin.actor.statuses.add("surprised");
  await afterInitiative(goblin, { initiative: 7 });
  expect(goblin.actor.toggleStatusEffect).not.toHaveBeenCalled();
});
