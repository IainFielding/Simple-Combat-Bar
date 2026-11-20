/**
 * The GM's side of an initiative swap. Like group turns, it's a permission boundary: the request
 * comes from a player's client, so the handler re-checks everything against the live combat and the
 * sender core reports, and again after waiting for the ally to agree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { invalidateSettings } from "../scripts/config.mjs";
import { CONSENT_QUERY, handleSwapRequest, registerSwapQueries, swapTargets } from "../scripts/ui/swap-service.mjs";

const FRIENDLY = 1;
const HOSTILE = -1;

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  filter(fn) { return [...this.values()].filter(fn); }
}

const user = (id, more = {}) => ({ id, isGM: false, active: true, isSelf: false, character: null,
  query: vi.fn(async () => true), ...more });

let p1;
let p2;
let gm;
let combat;

/** Aoth (p1's, with Alert) and Krusk (p2's) before the fight, a friendly guard, and a goblin. */
function makeCombat() {
  const owners = { aoth: p1, krusk: p2, guard: null, goblin: null };
  const init = { aoth: 18, krusk: 7, guard: 12, goblin: 15 };
  const combat = {
    id: "combat", started: false,
    updateEmbeddedDocuments: vi.fn(async () => {})
  };
  combat.combatants = new Collection(Object.entries(owners).map(([id, owner]) => {
    const actor = {
      id: `actor-${id}`,
      hasPlayerOwner: !!owner,
      flags: { dnd5e: { initiativeAlert: id === "aoth" } },
      statuses: new Set(),
      testUserPermission: u => u.isGM || (u === owner)
    };
    return [id, {
      id, name: id[0].toUpperCase() + id.slice(1), combat, flags: {}, hidden: false, isDefeated: false,
      initiative: init[id],
      token: { disposition: id === "goblin" ? HOSTILE : FRIENDLY },
      actor,
      testUserPermission: u => u.isGM || (u === owner)
    }];
  }));
  combat.turns = [...combat.combatants.values()];
  return combat;
}

const request = (requester, allyId = "krusk", swapperId = "aoth") =>
  handleSwapRequest({ combatId: "combat", swapperId, allyId }, requester);

beforeEach(() => {
  installFoundryShims();
  globalThis.dnd5e = { settings: { rulesVersion: "modern" } };
  globalThis.ChatMessage = { create: vi.fn(async () => {}) };
  globalThis.Handlebars = { escapeExpression: s => String(s).replace(/</g, "&lt;") };
  globalThis.CONFIG.queries = {};
  invalidateSettings();
  p1 = user("p1");
  p2 = user("p2", { character: { id: "actor-krusk" } });
  gm = user("gm", { isGM: true, isSelf: true });
  combat = makeCombat();
  game.combats = new Map([[combat.id, combat]]);
  const users = [p1, p2, gm];
  game.users = Object.assign(new Collection(users.map(u => [u.id, u])), { activeGM: gm });
});

describe("swapTargets", () => {
  it("offers the owner of a combatant with Alert their allies who have rolled", () => {
    game.user = p1;
    expect(swapTargets(combat.combatants.get("aoth")).map(c => c.id)).toEqual(["krusk", "guard"]);
  });

  it("offers nothing for someone else's combatant, or one without Alert", () => {
    game.user = p2;
    expect(swapTargets(combat.combatants.get("aoth"))).toEqual([]);
    expect(swapTargets(combat.combatants.get("krusk"))).toEqual([]);
  });

  it("offers nothing once the combat has started", () => {
    combat.started = true;
    expect(swapTargets(combat.combatants.get("aoth"), gm)).toEqual([]);
  });

  it("keeps a hidden ally out of a player's list, not the GM's", () => {
    combat.combatants.get("guard").hidden = true;
    expect(swapTargets(combat.combatants.get("aoth"), p1).map(c => c.id)).toEqual(["krusk"]);
    expect(swapTargets(combat.combatants.get("aoth"), gm).map(c => c.id)).toEqual(["krusk", "guard"]);
  });
});

describe("handleSwapRequest", () => {
  it("asks the ally's player, then swaps both in one update and tells the table", async () => {
    expect(await request(p1)).toBe("done");
    expect(p2.query).toHaveBeenCalledWith(CONSENT_QUERY, { combatId: "combat", swapperId: "aoth", allyId: "krusk" },
      expect.objectContaining({ timeout: expect.any(Number) }));
    expect(combat.updateEmbeddedDocuments).toHaveBeenCalledWith("Combatant", [
      { _id: "aoth", initiative: 7 }, { _id: "krusk", initiative: 18 }
    ]);
    expect(ChatMessage.create).toHaveBeenCalledOnce();
  });

  it("doesn't swap when the ally says no", async () => {
    p2.query.mockResolvedValue(false);
    expect(await request(p1)).toBe("declined");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("counts a question that times out or fails as no", async () => {
    p2.query.mockRejectedValue(new Error("timed out"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await request(p1)).toBe("declined");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("asks the GM when the ally's player isn't connected", async () => {
    p2.active = false;
    const confirm = vi.fn(async () => true);
    globalThis.foundry = { applications: { api: { DialogV2: { confirm } } } };
    expect(await request(p1)).toBe("done");
    expect(p2.query).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("swaps straight away when allies needn't agree", async () => {
    game.settings._values.allySwapConsent = false;
    invalidateSettings();
    expect(await request(p1)).toBe("done");
    expect(p2.query).not.toHaveBeenCalled();
    expect(combat.updateEmbeddedDocuments).toHaveBeenCalledOnce();
  });

  it("refuses a player swapping someone else's combatant", async () => {
    expect(await request(p2)).toBe("invalid");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("refuses an enemy, an unrolled ally and an Incapacitated one", async () => {
    expect(await request(p1, "goblin")).toBe("invalid");
    combat.combatants.get("krusk").initiative = null;
    expect(await request(p1)).toBe("invalid");
    combat.combatants.get("krusk").initiative = 7;
    combat.combatants.get("krusk").actor.statuses.add("incapacitated");
    expect(await request(p1)).toBe("invalid");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("refuses once the combat has started", async () => {
    combat.started = true;
    expect(await request(p1)).toBe("invalid");
  });

  it("doesn't swap if anything changed while the ally was deciding", async () => {
    p2.query.mockImplementation(async () => {
      combat.combatants.get("krusk").initiative = 3;
      return true;
    });
    expect(await request(p1)).toBe("invalid");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("doesn't swap if the combat started while the ally was deciding", async () => {
    p2.query.mockImplementation(async () => {
      combat.started = true;
      return true;
    });
    expect(await request(p1)).toBe("invalid");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("refuses a second swap for someone already waiting on one", async () => {
    let answer;
    p2.query.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const first = request(p1);
    expect(await request(gm, "guard")).toBe("busy");
    answer(true);
    expect(await first).toBe("done");
  });

  it("refuses unknown combats and combatants", async () => {
    expect(await request(p1, "nobody")).toBe("invalid");
    expect(await handleSwapRequest({ combatId: "elsewhere", swapperId: "aoth", allyId: "krusk" }, p1)).toBe("invalid");
  });

  it("does nothing on a client that isn't the active GM", async () => {
    game.users.activeGM = { isSelf: false };
    expect(await request(gm)).toBe("invalid");
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });
});

describe("the consent query", () => {
  it("ignores a question that didn't come from a GM", async () => {
    registerSwapQueries();
    const confirm = vi.fn(async () => true);
    globalThis.foundry = { applications: { api: { DialogV2: { confirm } } } };
    const data = { combatId: "combat", swapperId: "aoth", allyId: "krusk" };
    expect(await CONFIG.queries[CONSENT_QUERY](data, { user: p1 })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(await CONFIG.queries[CONSENT_QUERY](data, { user: gm, timeout: 60_000 })).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
