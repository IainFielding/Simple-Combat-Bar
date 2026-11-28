/**
 * Companions — pure.
 *
 * A companion (a Beast Master's beast, a Steel Defender, a summon) acts on its owner's initiative,
 * immediately after them. Core has no such link, so the bar keeps the companion's initiative just
 * below its owner's: between the owner and the next combatant down, so nobody lands in between.
 *
 * Stored on the companion as `flags[MODULE_ID].follows = {id, since}`: `id` is the owner's
 * combatant id, and `since` (a timestamp) orders two companions of the same owner, first linked
 * first. Companions don't chain: an owner can't follow anyone, and a companion has no companions.
 */

/** How far apart companions go below an owner with nobody below them. */
const NOBODY_BELOW_GAP = 1;

/** Companion initiatives are rounded to this many decimals, so they stay readable as numbers. */
const PRECISION = 4;

/**
 * The owner a combatant follows, or null.
 * @param {{follows?: {id?: string}|null}} flags  The module's flags.
 * @returns {string|null}
 */
export function followedId(flags) {
  const id = flags?.follows?.id;
  return (typeof id === "string") && id ? id : null;
}

/**
 * @typedef {object} PlacementEntry
 * @property {string} id
 * @property {number|null} initiative
 * @property {string|null} follows  The owner's combatant id, if a companion.
 * @property {number} [since]       When it was linked.
 */

/**
 * Where every companion's initiative should be. Companions whose owner isn't in the combat, or is
 * a companion itself, are left out: the caller unlinks them, or leaves them be.
 * @param {PlacementEntry[]} entries  Everyone in the combat.
 * @returns {Map<string, number|null>}  Companion id → initiative (null while the owner has none).
 */
export function companionPlacements(entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  // Only the combatants that aren't companions decide the gaps, so placing one never moves another.
  const leaders = entries.filter(e => !e.follows && isNumber(e.initiative)).map(e => e.initiative);
  const byOwner = new Map();
  for ( const e of entries ) {
    if ( !e.follows ) continue;
    const owner = byId.get(e.follows);
    if ( !owner || owner.follows || (owner.id === e.id) ) continue;
    if ( !byOwner.has(owner.id) ) byOwner.set(owner.id, []);
    byOwner.get(owner.id).push(e);
  }

  const placements = new Map();
  for ( const [ownerId, pets] of byOwner ) {
    const owner = byId.get(ownerId);
    pets.sort((a, b) => ((a.since ?? 0) - (b.since ?? 0)) || a.id.localeCompare(b.id));
    if ( !isNumber(owner.initiative) ) {
      for ( const pet of pets ) placements.set(pet.id, null);
      continue;
    }
    const below = leaders.filter(i => i < owner.initiative);
    // With nobody below, each companion goes a whole point further down.
    const gap = below.length ? owner.initiative - Math.max(...below) : NOBODY_BELOW_GAP * (pets.length + 1);
    pets.forEach((pet, index) => {
      placements.set(pet.id, round(owner.initiative - (gap * (index + 1) / (pets.length + 1))));
    });
  }
  return placements;
}

/**
 * The companions whose stored initiative differs from where they should be.
 * @param {PlacementEntry[]} entries
 * @returns {Array<{id: string, initiative: number|null}>}
 */
export function companionUpdates(entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const updates = [];
  for ( const [id, initiative] of companionPlacements(entries) ) {
    if ( !sameInitiative(byId.get(id).initiative, initiative) ) updates.push({ id, initiative });
  }
  return updates;
}

/**
 * Companions whose owner has left the combat (or became a companion): they go back to their own
 * initiative, keeping the number they have.
 * @param {PlacementEntry[]} entries
 * @returns {string[]}
 */
export function orphanedCompanions(entries) {
  const byId = new Map(entries.map(e => [e.id, e]));
  return entries.filter(e => {
    if ( !e.follows ) return false;
    const owner = byId.get(e.follows);
    return !owner || !!owner.follows || (owner.id === e.id);
  }).map(e => e.id);
}

/**
 * @typedef {object} CompanionFacts
 * @property {string} id
 * @property {string|null} actorId
 * @property {boolean} isEvent
 * @property {string|null} follows         Who it follows already, if anyone.
 * @property {boolean} hasCompanions       Somebody follows it.
 * @property {boolean} hidden
 * @property {string[]} playerOwnerIds     Its non-GM owners.
 */

/**
 * Who a combatant could act after, best guesses first: the creature that summoned it, then
 * characters sharing one of its players, then (for the GM only) everyone else in turn order.
 *
 * A player is offered only characters that share one of the pet's players (or its summoner), and
 * none the GM is hiding. The GM may link anything to anyone.
 * @param {object} input
 * @param {CompanionFacts} input.pet
 * @param {CompanionFacts[]} input.others    Everyone in the combat, in turn order (the pet may be among them).
 * @param {boolean} input.isGM               Whether the one asking is a GM.
 * @param {string|null} [input.summonerActorId]  The actor that summoned the pet, if known.
 * @returns {CompanionFacts[]}
 */
export function ownerCandidates({ pet, others, isGM, summonerActorId = null }) {
  if ( !pet || pet.isEvent || pet.follows || pet.hasCompanions ) return [];
  const players = new Set(pet.playerOwnerIds ?? []);
  const rank = o => {
    if ( summonerActorId && (o.actorId === summonerActorId) ) return 0;
    if ( (o.playerOwnerIds ?? []).some(id => players.has(id)) ) return 1;
    return 2;
  };
  const eligible = others.filter(o => (o.id !== pet.id) && o.actorId && !o.isEvent && !o.follows)
    .map((o, index) => ({ o, index, rank: rank(o) }))
    .filter(({ o, rank }) => isGM || (!o.hidden && (rank < 2)));
  return eligible.sort((a, b) => (a.rank - b.rank) || (a.index - b.index)).map(({ o }) => o);
}

/**
 * A turn-order comparator that keeps each companion right after its owner, wrapping the system's
 * own. Initiative alone can't: dnd5e breaks a tie by name, so an owner tied with someone who sorts
 * after them would put that someone between owner and pet. Everyone is compared as their owner
 * (companions) or themselves; an owner and their companions then go owner first, companions in the
 * order they were linked.
 * @param {(a: object, b: object) => number} compare  The system's comparator.
 * @param {(c: object) => object|null} leaderOf        A companion's owner, or null.
 * @param {(c: object) => number} sinceOf              When a companion was linked.
 * @returns {(a: object, b: object) => number}
 */
export function companionComparator(compare, leaderOf, sinceOf) {
  return function(a, b) {
    const la = leaderOf(a) ?? a;
    const lb = leaderOf(b) ?? b;
    if ( la !== lb ) return compare.call(this, la, lb);
    if ( a === b ) return 0;
    if ( a === la ) return -1;
    if ( b === lb ) return 1;
    return (sinceOf(a) - sinceOf(b)) || (a.id > b.id ? 1 : -1);
  };
}

/** Whether two initiatives are the same, within floating-point noise. */
export function sameInitiative(a, b) {
  if ( !isNumber(a) || !isNumber(b) ) return !isNumber(a) && !isNumber(b);
  return Math.abs(a - b) < 1e-6;
}

function isNumber(value) {
  return (typeof value === "number") && Number.isFinite(value);
}

function round(value) {
  const f = 10 ** PRECISION;
  return Math.round(value * f) / f;
}
