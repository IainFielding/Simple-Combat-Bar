/**
 * The GM's side of companions. Like swaps, it's a permission boundary: a player's request comes
 * from their client, so the handler re-checks it against the live combat and the sender core reports.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { MODULE_ID, invalidateSettings } from "../scripts/config.mjs";
import { addSummon, followTargets, guardCompanionInitiative, handleFollowRequest, isCompanion, placeCompanions }
  from "../scripts/ui/companion-service.mjs";

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  some(fn) { return [...this.values()].some(fn); }
}

const user = (id, more = {}) => ({ id, isGM: false, active: true, isSelf: false, ...more });

let p1;
let p2;
let gm;
let combat;

/** Aoth (p1's) at 15, Krusk (p2's) at 9, a goblin at 12, and Aoth's wolf (p1's) not yet linked. */
function makeCombat() {
  const owners = { aoth: [p1], krusk: [p2], goblin: [], wolf: [p1] };
  const init = { aoth: 15, krusk: 9, goblin: 12, wolf: null };
  const combat = { id: "combat", started: false, scene: { id: "scene" } };
  const update = (c, changes) => {
    for ( const [key, value] of Object.entries(changes) ) {
      if ( key === "_id" ) continue;
      if ( key === "initiative" ) c.initiative = value;
      else if ( key === `flags.${MODULE_ID}.follows` ) c.flags[MODULE_ID] = { ...c.flags[MODULE_ID], follows: value };
    }
  };
  combat.updateEmbeddedDocuments = vi.fn(async (_type, updates) => {
    for ( const u of updates ) update(combat.combatants.get(u._id), u);
  });
  combat.createEmbeddedDocuments = vi.fn(async (_type, docs) => {
    for ( const d of docs ) {
      const c = combatant(`new-${d.tokenId}`, [p1], null, { uuid: "Actor.summon" });
      c.flags = foundry.utils.deepClone(d.flags);
      c.tokenId = d.tokenId;
      c.sceneId = d.sceneId;
      combat.combatants.set(c.id, c);
    }
  });
  const combatant = (id, owned, initiative, actorMore = {}) => {
    const c = {
      id, name: id, img: `${id}.webp`, combat, flags: {}, hidden: false, initiative,
      actor: { id: `actor-${id}`, uuid: `Actor.${id}`, ...actorMore },
      testUserPermission: u => u.isGM || owned.includes(u)
    };
    c.update = vi.fn(async changes => update(c, changes));
    return c;
  };
  combat.combatants = new Collection(Object.entries(owners).map(([id, owned]) => [id, combatant(id, owned, init[id])]));
  Object.defineProperty(combat, "turns", { get: () => [...combat.combatants.values()] });
  return combat;
}

const follow = (requester, ownerId = "aoth", companionId = "wolf") =>
  handleFollowRequest({ combatId: "combat", companionId, ownerId }, requester);

beforeEach(() => {
  installFoundryShims();
  globalThis.foundry = { utils: { deepClone: v => structuredClone(v) } };
  globalThis.CONFIG.queries = {};
  globalThis.fromUuidSync = () => null;
  invalidateSettings();
  p1 = user("p1");
  p2 = user("p2");
  gm = user("gm", { isGM: true, isSelf: true });
  combat = makeCombat();
  game.combats = new Collection([[combat.id, combat]]);
  game.users = Object.assign(new Collection([p1, p2, gm].map(u => [u.id, u])), { activeGM: gm });
});

describe("followTargets", () => {
  it("offers a player the characters sharing one of the pet's players", () => {
    expect(followTargets(combat.combatants.get("wolf"), p1).map(c => c.id)).toEqual(["aoth"]);
  });

  it("offers nothing for someone else's pet", () => {
    expect(followTargets(combat.combatants.get("wolf"), p2)).toEqual([]);
  });

  it("offers the GM everyone, the pet's players' characters first", () => {
    expect(followTargets(combat.combatants.get("wolf"), gm).map(c => c.id)).toEqual(["aoth", "krusk", "goblin"]);
  });

  it("offers the summoner first", () => {
    globalThis.fromUuidSync = uuid => (uuid === "Item.call" ? { actor: { id: "actor-krusk" } } : null);
    combat.combatants.get("wolf").actor.flags = { dnd5e: { summon: { origin: "Item.call" } } };
    expect(followTargets(combat.combatants.get("wolf"), p1).map(c => c.id)).toEqual(["krusk", "aoth"]);
  });
});

describe("handleFollowRequest", () => {
  it("links the pet and puts it right after its owner", async () => {
    expect(await follow(p1)).toBe("done");
    const wolf = combat.combatants.get("wolf");
    expect(wolf.flags[MODULE_ID].follows.id).toBe("aoth");
    expect(wolf.initiative).toBe(13.5);
    expect(isCompanion(wolf)).toBe(true);
  });

  it("refuses a player linking someone else's pet, or to an owner they weren't offered", async () => {
    expect(await follow(p2)).toBe("invalid");
    expect(await follow(p1, "goblin")).toBe("invalid");
    expect(combat.combatants.get("wolf").flags[MODULE_ID]).toBeUndefined();
  });

  it("lets the GM link anything to anyone", async () => {
    expect(await follow(gm, "goblin")).toBe("done");
    expect(combat.combatants.get("wolf").initiative).toBe(10.5);
  });

  it("does nothing unless this client is the active GM", async () => {
    gm.isSelf = false;
    expect(await follow(gm)).toBe("invalid");
  });

  it("unlinks, keeping the initiative it has", async () => {
    await follow(p1);
    expect(await follow(p1, null)).toBe("done");
    const wolf = combat.combatants.get("wolf");
    expect(isCompanion(wolf)).toBe(false);
    expect(wolf.initiative).toBe(13.5);
  });
});

describe("placeCompanions", () => {
  it("moves companions after their owner re-rolls, and unlinks those whose owner left", async () => {
    await follow(p1);
    combat.combatants.get("aoth").initiative = 5;
    await placeCompanions(combat);
    expect(combat.combatants.get("wolf").initiative).toBe(4);

    combat.combatants.delete("aoth");
    await placeCompanions(combat);
    expect(combat.combatants.get("wolf").flags[MODULE_ID].follows).toBeNull();
    expect(combat.combatants.get("wolf").initiative).toBe(4);
  });

  it("sends nothing when everyone is in place", async () => {
    await follow(p1);
    combat.updateEmbeddedDocuments.mockClear();
    await placeCompanions(combat);
    expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });
});

describe("guardCompanionInitiative", () => {
  it("replaces a roll for a companion with where it belongs", async () => {
    await follow(p1);
    const changes = { initiative: 19 };
    guardCompanionInitiative(combat.combatants.get("wolf"), changes, {});
    expect(changes.initiative).toBe(13.5);
  });

  it("keeps a companion unrolled while its owner hasn't rolled", async () => {
    await follow(p1);
    combat.combatants.get("aoth").initiative = null;
    const changes = { initiative: 19 };
    guardCompanionInitiative(combat.combatants.get("wolf"), changes, {});
    expect(changes.initiative).toBeNull();
  });

  it("lets through clearing, the bar's own writes, and anyone who isn't a companion", async () => {
    await follow(p1);
    const wolf = combat.combatants.get("wolf");
    for ( const [changes, options] of [[{ initiative: null }, {}], [{ initiative: 3 }, { [MODULE_ID]: { companions: true } }]] ) {
      const before = changes.initiative;
      guardCompanionInitiative(wolf, changes, options);
      expect(changes.initiative).toBe(before);
    }
    const goblin = { initiative: 8 };
    guardCompanionInitiative(combat.combatants.get("goblin"), goblin, {});
    expect(goblin.initiative).toBe(8);
  });
});

describe("addSummon", () => {
  const summonToken = () => ({ id: "tok", actorId: "actor-summon", hidden: false, parent: { id: "scene" },
    actor: { flags: { dnd5e: { summon: { origin: "Item.call" } } } } });

  beforeEach(() => {
    globalThis.fromUuidSync = uuid => (uuid === "Item.call" ? { actor: { id: "actor-aoth", uuid: "Actor.aoth" } } : null);
  });

  it("does nothing with the setting off (the default)", async () => {
    await addSummon(summonToken());
    expect(combat.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("adds a summon after its summoner, once", async () => {
    game.settings._values.autoAddSummons = true;
    invalidateSettings();
    await addSummon(summonToken());
    const added = combat.combatants.get("new-tok");
    expect(added.flags[MODULE_ID].follows.id).toBe("aoth");
    expect(added.initiative).toBe(13.5);
    await addSummon(summonToken());
    expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  it("leaves alone a summon from someone not in the combat, or on another scene", async () => {
    game.settings._values.autoAddSummons = true;
    invalidateSettings();
    await addSummon({ ...summonToken(), parent: { id: "elsewhere" } });
    globalThis.fromUuidSync = () => ({ actor: { id: "actor-x", uuid: "Actor.x" } });
    await addSummon(summonToken());
    expect(combat.createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
