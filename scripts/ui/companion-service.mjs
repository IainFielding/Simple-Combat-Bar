/**
 * Companions in a live combat: linking a pet or summon to its owner, keeping it right after them,
 * and adding summons to the combat as they appear.
 *
 * The rules are pure (model/companions.mjs). As with initiative swaps, only the active GM writes:
 * a player's "Act on Owner's Initiative" is a query to that GM (core's User#query, which tells the
 * handler who sent it), and the GM re-checks it against the live combat. The GM also moves every
 * companion whenever an initiative in the combat changes.
 *
 * A companion's initiative belongs to its owner while they're linked. Rolling or typing one for it
 * is put right before the update is sent ({@link guardCompanionInitiative}); "Act on Own
 * Initiative" unlinks it first.
 */

import { MODULE_ID, settings, t } from "../config.mjs";
import { companionComparator, companionPlacements, companionUpdates, followedId, orphanedCompanions,
  ownerCandidates } from "../model/companions.mjs";
import { adapterFor } from "../systems/adapter.mjs";

export const FOLLOW_QUERY = `${MODULE_ID}.follow`;

/** Options marking the bar's own companion writes, so the guard lets them through. Fresh each time:
    Foundry adds to the options object it is given. */
const ownWrite = () => ({ [MODULE_ID]: { companions: true } });

const flagsOf = combatant => combatant?.flags?.[MODULE_ID] ?? {};

/** Combats with a placement queued (GM side). */
const queued = new Set();

/** Marks a turn-order comparator this module has already wrapped. */
const SORT_WRAPPED = Symbol(`${MODULE_ID}.companionSort`);

/**
 * Keep companions right after their owner in the combat's turn order itself, so core's tracker, the
 * turn pointer and the bar all agree, ties included. `Combat#_sortCombatants` is the documented
 * place for this (dnd5e overrides it too); it's wrapped, not replaced, so the system's tie-breaks
 * still decide everything else. Core calls it unbound, so the wrapper needs no `this`.
 * @param {typeof Combat} [cls]  The combat document class.
 */
export function installCompanionSort(cls = CONFIG.Combat?.documentClass) {
  const proto = cls?.prototype;
  const original = proto?._sortCombatants;
  if ( (typeof original !== "function") || original[SORT_WRAPPED] ) return;
  const sort = companionComparator(original, leaderOf, c => flagsOf(c).follows?.since ?? 0);
  sort[SORT_WRAPPED] = true;
  proto._sortCombatants = sort;
  for ( const combat of game.combats ?? [] ) combat.setupTurns?.();
}

/** Register the query handler. Called at init, on every client. */
export function registerCompanionQueries() {
  CONFIG.queries[FOLLOW_QUERY] = (data, { user }) => handleFollowRequest(data, user);
}

/**
 * The owner a combatant acts after, if it's linked to one still in its combat.
 * @param {Combatant} combatant
 * @returns {Combatant|null}
 */
export function leaderOf(combatant) {
  const id = followedId(flagsOf(combatant));
  return id ? combatant.combat?.combatants.get(id) ?? null : null;
}

/** Whether a combatant acts on its owner's initiative. */
export function isCompanion(combatant) {
  return !!leaderOf(combatant);
}

/**
 * The facts the companion rules need about one combatant.
 * @param {Combatant} combatant
 * @param {object} ctx
 * @param {Set<string>} ctx.followed  Ids of combatants someone follows (see {@link followedIds}).
 * @param {User[]} ctx.players        The world's non-GM users.
 * @returns {import("../model/companions.mjs").CompanionFacts}
 */
export function companionFacts(combatant, { followed, players }) {
  const flags = flagsOf(combatant);
  return {
    id: combatant.id,
    actorId: combatant.actor?.id ?? null,
    isEvent: !!flags.event,
    follows: followedId(flags),
    hasCompanions: followed.has(combatant.id),
    hidden: !!combatant.hidden,
    playerOwnerIds: players.filter(u => combatant.testUserPermission(u, "OWNER")).map(u => u.id)
  };
}

/** Ids of the combatants in a combat that someone follows. One pass, not one per combatant. */
function followedIds(combat) {
  const ids = new Set();
  for ( const c of combat.combatants ) {
    const id = followedId(flagsOf(c));
    if ( id ) ids.add(id);
  }
  return ids;
}

/**
 * Who this user could have the combatant act after, best guesses first. Empty when it can't follow
 * anyone, or isn't this user's to link.
 * @param {Combatant} pet
 * @param {User} [user]
 * @returns {Combatant[]}
 */
export function followTargets(pet, user = game.user) {
  const combat = pet?.combat;
  if ( !combat || !pet.actor || !(user.isGM || pet.testUserPermission(user, "OWNER")) ) return [];
  // Cheap refusals first: this runs for every portrait right-clicked.
  const followed = followedIds(combat);
  if ( followedId(flagsOf(pet)) || followed.has(pet.id) || flagsOf(pet).event ) return [];
  const ctx = { followed, players: game.users.filter(u => !u.isGM) };
  const summoner = summonerOf(pet.actor);
  return ownerCandidates({ pet: companionFacts(pet, ctx), others: combat.turns.map(c => companionFacts(c, ctx)),
    isGM: user.isGM,
    summonerActorId: summoner?.id ?? null }).map(f => combat.combatants.get(f.id)).filter(Boolean);
}

/**
 * Right-click → "Act on Owner's Initiative". A player with one possible owner is linked straight
 * away; otherwise (and always for the GM, who may pick anyone) a window asks who it follows.
 * @param {Combatant} pet
 */
export async function openFollowDialog(pet) {
  const owners = followTargets(pet);
  if ( !owners.length ) return;
  if ( !game.user.isGM && (owners.length === 1) ) return requestFollow(pet, owners[0]);

  const esc = value => Handlebars.escapeExpression(String(value ?? ""));
  const options = owners.map((owner, index) => `
    <label class="scb-follow-option">
      <input type="radio" name="owner" value="${esc(owner.id)}"${index === 0 ? " checked" : ""}>
      <img src="${esc(owner.img)}" alt="">
      <span>${esc(owner.name)}</span>
    </label>`).join("");
  const content = `<p>${t("companions.choose", { name: `<strong>${esc(pet.name)}</strong>` })}</p>
    <div class="scb-follow-list">${options}</div>`;
  const form = await foundry.applications.api.DialogV2.input({
    window: { title: t("companions.title"), icon: "fa-solid fa-paw" },
    classes: ["scb-follow-dialog"],
    position: { width: 360 },
    content,
    ok: { label: t("companions.follow"), icon: "fa-solid fa-check" }
  });
  const owner = form?.owner ? pet.combat?.combatants.get(form.owner) : null;
  if ( owner ) await requestFollow(pet, owner);
}

/**
 * Ask the active GM to link a combatant to an owner, or (with `owner` null) to unlink it.
 * @param {Combatant} pet
 * @param {Combatant|null} owner
 * @returns {Promise<boolean>}  Whether it was done.
 */
export async function requestFollow(pet, owner) {
  const gm = game.users.activeGM;
  if ( !gm ) {
    ui.notifications.warn(t("companions.noGM"));
    return false;
  }
  const data = { combatId: pet.combat?.id, companionId: pet.id, ownerId: owner?.id ?? null };
  let result;
  if ( gm.isSelf ) result = await handleFollowRequest(data, game.user);
  else {
    // The query throws if it times out, the GM drops, or this user's role may not query users.
    try {
      result = await gm.query(FOLLOW_QUERY, data, { timeout: 15_000 });
    } catch ( err ) {
      console.warn(`${MODULE_ID} |`, err);
      ui.notifications.warn(t("companions.failed"));
      return false;
    }
  }
  if ( result === "done" ) return true;
  ui.notifications.warn(t("companions.unavailable"));
  return false;
}

/**
 * The GM's side. Re-derives everything from the live combat rather than trusting the request.
 * @param {{combatId: string, companionId: string, ownerId: string|null}} data
 * @param {User} user  Who asked (from core's query context, not from the payload).
 * @returns {Promise<"done"|"invalid">}
 */
export async function handleFollowRequest({ combatId, companionId, ownerId = null } = {}, user) {
  if ( !game.users.activeGM?.isSelf || !user ) return "invalid";
  const combat = game.combats.get(combatId);
  const pet = combat?.combatants.get(companionId);
  if ( !pet ) return "invalid";
  if ( !user.isGM && !pet.testUserPermission(user, "OWNER") ) return "invalid";
  if ( !ownerId ) {
    if ( !followedId(flagsOf(pet)) ) return "invalid";
    await pet.update({ [`flags.${MODULE_ID}.follows`]: null }, ownWrite());
    return "done";
  }
  if ( !followTargets(pet, user).some(c => c.id === ownerId) ) return "invalid";
  await pet.update({ [`flags.${MODULE_ID}.follows`]: { id: ownerId, since: Date.now() } }, ownWrite());
  await placeCompanions(combat);
  return "done";
}

/**
 * The placement input for a combat.
 * @param {Combat} combat
 * @returns {import("../model/companions.mjs").PlacementEntry[]}
 */
function placementEntries(combat) {
  return Array.from(combat.combatants, c => ({
    id: c.id,
    initiative: c.initiative ?? null,
    follows: followedId(flagsOf(c)),
    since: flagsOf(c).follows?.since ?? 0
  }));
}

/**
 * Put every companion back right after its owner, and unlink any whose owner has gone. Active GM
 * only; one update for all of them, and none when nothing has to move.
 * @param {Combat} combat
 */
export async function placeCompanions(combat) {
  if ( !combat || !game.users.activeGM?.isSelf ) return;
  const entries = placementEntries(combat);
  const updates = companionUpdates(entries).map(u => ({ _id: u.id, initiative: u.initiative }));
  for ( const id of orphanedCompanions(entries) ) updates.push({ _id: id, [`flags.${MODULE_ID}.follows`]: null });
  if ( updates.length ) await combat.updateEmbeddedDocuments("Combatant", updates, ownWrite());
}

/**
 * Queue a placement for after the current batch of updates (a Roll All changes everyone at once).
 * @param {Combat} combat
 */
export function schedulePlacement(combat) {
  if ( !combat || !game.users.activeGM?.isSelf || queued.has(combat.id) ) return;
  queued.add(combat.id);
  setTimeout(() => {
    queued.delete(combat.id);
    const live = game.combats.get(combat.id);
    if ( live ) placeCompanions(live).catch(err => console.error(`${MODULE_ID} |`, err));
  }, 0);
}

/**
 * Before a combatant update is sent, on whichever client sends it: a linked companion's initiative
 * is its owner's business, so a roll or a typed number for it is replaced by where it belongs
 * (nothing, while the owner hasn't rolled). Clearing it is let through; the GM places it again.
 * @param {Combatant} combatant
 * @param {object} changes  Core's pending changes; changed in place.
 * @param {object} [options]
 */
export function guardCompanionInitiative(combatant, changes, options) {
  if ( options?.[MODULE_ID]?.companions ) return;
  if ( !("initiative" in changes) || (changes.initiative === null) ) return;
  const ours = changes.flags?.[MODULE_ID];
  if ( ours && (("follows" in ours) || ("-=follows" in ours)) ) return;
  const combat = combatant.combat;
  if ( !combat || !followedId(flagsOf(combatant)) ) return;
  const target = companionPlacements(placementEntries(combat)).get(combatant.id);
  if ( target !== undefined ) changes.initiative = target;
}

/**
 * A token was created: if it's a summon whose summoner is in a combat on its scene, add it to that
 * combat, acting after them. Active GM only, and only with "Add Summons to Combat" on.
 * @param {TokenDocument} tokenDoc
 */
export async function addSummon(tokenDoc) {
  if ( !settings().autoAddSummons || !game.users.activeGM?.isSelf ) return;
  const summoner = summonerOf(tokenDoc?.actor);
  if ( !summoner ) return;
  const sceneId = tokenDoc.parent?.id ?? null;
  for ( const combat of game.combats ) {
    if ( combat.scene && (combat.scene.id !== sceneId) ) continue;
    const owner = combat.combatants.find(c => c.actor && (c.actor.uuid === summoner.uuid) && !followedId(flagsOf(c)));
    if ( !owner ) continue;
    if ( combat.combatants.some(c => (c.tokenId === tokenDoc.id) && (c.sceneId === sceneId)) ) return;
    await combat.createEmbeddedDocuments("Combatant", [{
      tokenId: tokenDoc.id, sceneId, actorId: tokenDoc.actorId, hidden: !!tokenDoc.hidden,
      flags: { [MODULE_ID]: { follows: { id: owner.id, since: Date.now() } } }
    }], ownWrite());
    await placeCompanions(combat);
    return;
  }
}

/** The actor that summoned this one, as far as the system records it. */
function summonerOf(actor) {
  if ( !actor ) return null;
  try {
    return adapterFor(game.system.id).summoner?.(actor) ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} |`, err);
    return null;
  }
}
