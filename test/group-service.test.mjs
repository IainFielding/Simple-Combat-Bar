/**
 * The GM's side of a group turn request. It's the permission boundary for group turns: the payload
 * comes from a player's client, so the handler must re-check everything against the live combat and
 * the sender core reports, never trust what it was told.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { invalidateSettings } from "../scripts/config.mjs";
import { handleGroupRequest } from "../scripts/ui/group-service.mjs";

const FRIENDLY = 1;
const HOSTILE = -1;

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
}

const p1 = { id: "p1", isGM: false };
const p2 = { id: "p2", isGM: false };
const gm = { id: "gm", isGM: true };

/** Three allies sharing a group turn, then a goblin. Ann and Cal are p1's, Bo is p2's. */
function makeCombat() {
  const owners = { ann: p1, bo: p2, cal: p1, goblin: null };
  const combat = {
    id: "combat", started: true, round: 1, turn: 0, flags: {},
    getFlag: () => undefined,
    update: vi.fn(async () => {}),
    setFlag: vi.fn(async () => {}),
    nextRound: vi.fn(async () => {})
  };
  combat.combatants = new Collection(Object.entries(owners).map(([id, owner]) => [id, {
    id, flags: {}, isDefeated: false,
    token: { disposition: owner ? FRIENDLY : HOSTILE },
    actor: { hasPlayerOwner: !!owner },
    testUserPermission: user => user === owner
  }]));
  combat.turns = [...combat.combatants.values()];
  Object.defineProperty(combat, "combatant", { get: () => combat.turns[combat.turn] ?? null });
  return combat;
}

let combat;
const request = (action, combatantId, user) => handleGroupRequest({ action, combatId: "combat", combatantId }, user);

beforeEach(() => {
  installFoundryShims();
  game.settings._values.groupTeams = "bg3";
  invalidateSettings();
  combat = makeCombat();
  game.combats = new Map([[combat.id, combat]]);
  game.users = { activeGM: { isSelf: true } };
});

describe("handleGroupRequest", () => {
  it("lets a player step in with a waiting member they own", async () => {
    expect(await request("activate", "cal", p1)).toBe(true);
    expect(combat.update).toHaveBeenCalledWith(expect.objectContaining({ turn: 2 }));
  });

  it("refuses a player stepping in with someone else's member", async () => {
    expect(await request("activate", "bo", p1)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("lets the GM step in with any member", async () => {
    expect(await request("activate", "bo", gm)).toBe(true);
    expect(combat.update).toHaveBeenCalledWith(expect.objectContaining({ turn: 1 }));
  });

  it("refuses a player ending a turn that isn't theirs", async () => {
    expect(await request("end", "ann", p2)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("refuses ending for a member who isn't the one acting", async () => {
    expect(await request("end", "cal", p1)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("hands the turn to the next waiting member when its owner ends it", async () => {
    expect(await request("end", "ann", p1)).toBe(true);
    expect(combat.update).toHaveBeenCalledWith(expect.objectContaining({ turn: 1 }));
  });

  it("refuses a combatant outside a group turn", async () => {
    combat.turn = 3;
    expect(await request("activate", "goblin", gm)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("refuses unknown actions, combats and combatants", async () => {
    expect(await request("delete", "cal", gm)).toBe(false);
    expect(await request("activate", "nobody", gm)).toBe(false);
    expect(await handleGroupRequest({ action: "activate", combatId: "elsewhere", combatantId: "cal" }, gm)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("does nothing on a client that isn't the active GM", async () => {
    game.users.activeGM = { isSelf: false };
    expect(await request("activate", "cal", gm)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });

  it("does nothing when group turns are off", async () => {
    game.settings._values.groupTeams = "visual";
    invalidateSettings();
    expect(await request("activate", "cal", p1)).toBe(false);
    expect(combat.update).not.toHaveBeenCalled();
  });
});
