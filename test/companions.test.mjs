import { describe, expect, it } from "vitest";
import { companionPlacements, companionUpdates, followedId, orphanedCompanions, ownerCandidates, sameInitiative }
  from "../scripts/model/companions.mjs";

const entry = (id, initiative, follows = null, since = 0) => ({ id, initiative, follows, since });

describe("followedId", () => {
  it("reads the owner's id, and nothing from a missing or malformed flag", () => {
    expect(followedId({ follows: { id: "owner" } })).toBe("owner");
    expect(followedId({ follows: null })).toBeNull();
    expect(followedId({ follows: { id: "" } })).toBeNull();
    expect(followedId(undefined)).toBeNull();
  });
});

describe("companionPlacements", () => {
  it("puts a companion halfway between its owner and the next combatant down", () => {
    const placed = companionPlacements([entry("ranger", 15), entry("goblin", 12), entry("wolf", null, "ranger")]);
    expect(placed.get("wolf")).toBe(13.5);
  });

  it("puts two companions after their owner in the order they were linked", () => {
    const placed = companionPlacements([entry("wizard", 18), entry("orc", 15),
      entry("owl", 3, "wizard", 2), entry("spirit", 9, "wizard", 1)]);
    expect(placed.get("spirit")).toBe(17);
    expect(placed.get("owl")).toBe(16);
  });

  it("goes a point below an owner with nobody after them", () => {
    expect(companionPlacements([entry("ranger", 4), entry("wolf", null, "ranger")]).get("wolf")).toBe(3);
  });

  it("ignores other companions, and ties with the owner, when finding the next one down", () => {
    const placed = companionPlacements([entry("a", 15), entry("b", 15), entry("c", 11),
      entry("aPet", null, "a"), entry("cPet", 14.9, "c")]);
    expect(placed.get("aPet")).toBe(13);
    expect(placed.get("cPet")).toBe(10);
  });

  it("follows the owner's tiebreaker decimals", () => {
    expect(companionPlacements([entry("a", 15.14), entry("b", 15.12), entry("pet", null, "a")]).get("pet")).toBe(15.13);
  });

  it("has no initiative while the owner hasn't rolled", () => {
    expect(companionPlacements([entry("ranger", null), entry("wolf", 12, "ranger")]).get("wolf")).toBeNull();
  });

  it("leaves out a companion whose owner is gone or is a companion too", () => {
    const placed = companionPlacements([entry("a", 10), entry("b", 8, "a"), entry("c", 5, "b"), entry("d", 3, "gone")]);
    expect([...placed.keys()]).toEqual(["b"]);
  });
});

describe("companionUpdates", () => {
  it("lists only the companions out of place", () => {
    const entries = [entry("ranger", 15), entry("goblin", 12), entry("wolf", 13.5, "ranger"),
      entry("wizard", 8), entry("owl", 20, "wizard")];
    expect(companionUpdates(entries)).toEqual([{ id: "owl", initiative: 7 }]);
  });

  it("settles: placing everyone leaves nothing to move", () => {
    const entries = [entry("a", 17), entry("b", 9), entry("aPet", 2, "a"), entry("bPet", 30, "b")];
    for ( const u of companionUpdates(entries) ) entries.find(e => e.id === u.id).initiative = u.initiative;
    expect(companionUpdates(entries)).toEqual([]);
  });
});

describe("orphanedCompanions", () => {
  it("finds companions whose owner has left or follows someone", () => {
    expect(orphanedCompanions([entry("a", 10), entry("b", 8, "a"), entry("c", 5, "b"), entry("d", 3, "gone")]))
      .toEqual(["c", "d"]);
  });
});

describe("ownerCandidates", () => {
  const facts = (id, more = {}) => ({ id, actorId: `actor-${id}`, isEvent: false, follows: null,
    hasCompanions: false, hidden: false, playerOwnerIds: [], ...more });
  const wolf = facts("wolf", { playerOwnerIds: ["p1"] });
  const others = [
    facts("goblin"),
    facts("krusk", { playerOwnerIds: ["p2"] }),
    facts("aoth", { playerOwnerIds: ["p1"] }),
    facts("lia", { playerOwnerIds: ["p1", "p2"] }),
    facts("event", { actorId: null, isEvent: true }),
    wolf
  ];
  const ids = list => list.map(f => f.id);

  it("offers a player the characters sharing one of the pet's players", () => {
    expect(ids(ownerCandidates({ pet: wolf, others, isGM: false }))).toEqual(["aoth", "lia"]);
  });

  it("offers the summoner first, even when it shares no player", () => {
    expect(ids(ownerCandidates({ pet: wolf, others, isGM: false, summonerActorId: "actor-krusk" })))
      .toEqual(["krusk", "aoth", "lia"]);
  });

  it("offers the GM everyone with an actor, best guesses first", () => {
    expect(ids(ownerCandidates({ pet: wolf, others, isGM: true }))).toEqual(["aoth", "lia", "goblin", "krusk"]);
  });

  it("doesn't offer a player someone the GM is hiding", () => {
    const hidden = others.map(o => (o.id === "lia" ? { ...o, hidden: true } : o));
    expect(ids(ownerCandidates({ pet: wolf, others: hidden, isGM: false }))).toEqual(["aoth"]);
  });

  it("doesn't chain: no owner that follows someone, and no pet that has companions or already follows", () => {
    const following = others.map(o => (o.id === "aoth" ? { ...o, follows: "lia" } : o));
    expect(ids(ownerCandidates({ pet: wolf, others: following, isGM: false }))).toEqual(["lia"]);
    expect(ownerCandidates({ pet: { ...wolf, hasCompanions: true }, others, isGM: true })).toEqual([]);
    expect(ownerCandidates({ pet: { ...wolf, follows: "aoth" }, others, isGM: true })).toEqual([]);
    expect(ownerCandidates({ pet: facts("e", { isEvent: true }), others, isGM: true })).toEqual([]);
  });
});

describe("sameInitiative", () => {
  it("compares within floating-point noise, and null to null", () => {
    expect(sameInitiative(13.5, 13.5000000001)).toBe(true);
    expect(sameInitiative(null, null)).toBe(true);
    expect(sameInitiative(null, 0)).toBe(false);
    expect(sameInitiative(12, 13)).toBe(false);
  });
});
