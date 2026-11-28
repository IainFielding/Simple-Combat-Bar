/**
 * Surprise: the GM marks who is surprised before the fight starts, and the bar takes the status
 * off again once it has done its work, which differs between the rule sets:
 *
 *   - 2024 ("modern"): a surprised combatant rolls initiative with Disadvantage (dnd5e applies
 *     that itself) and nothing more. The status comes off once its initiative is rolled.
 *   - 2014 ("legacy"): a surprised combatant can't move or act on its first turn, and can't take a
 *     reaction until that turn ends. Its card shows every pip spent while it's surprised, and the
 *     status comes off when that turn ends.
 *
 * Only the active GM clears it, so it happens once whoever rolled or moved the turn on.
 */

import { MODULE_ID } from "../config.mjs";
import { adapterFor } from "../systems/adapter.mjs";

/** The actor's surprise, as the system reads it, or null if the system has none. */
export function surpriseOf(actor) {
  if ( !actor ) return null;
  try {
    return adapterFor(game.system.id).surprise?.(actor) ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} |`, err);
    return null;
  }
}

/**
 * Mark (or clear) a combatant's surprise.
 * @param {Combatant} combatant
 * @param {boolean} active
 */
export async function setSurprised(combatant, active) {
  const actor = combatant?.actor;
  if ( !actor || !game.user.isGM ) return;
  await adapterFor(game.system.id).setSurprised?.(actor, active);
}

/**
 * Whether the GM may mark this combatant surprised now: before the combat starts, when surprise is
 * decided, and only once its initiative isn't rolled yet under the 2024 rules (where rolling it is
 * all surprise affects).
 * @param {Combatant} combatant
 */
export function canMarkSurprised(combatant) {
  const surprise = surpriseOf(combatant?.actor);
  if ( !game.user.isGM || !surprise || surprise.surprised || combatant.combat?.started ) return false;
  return (surprise.rules === "legacy") || (combatant.initiative === null);
}

/** Whether the GM may clear this combatant's surprise. */
export function canClearSurprised(combatant) {
  return game.user.isGM && !!surpriseOf(combatant?.actor)?.surprised;
}

/**
 * 2024 rules: once a surprised combatant's initiative is rolled, its surprise has done its work.
 * @param {Combatant} combatant
 * @param {object} changes
 */
export async function afterInitiative(combatant, changes) {
  if ( !game.users.activeGM?.isSelf || (typeof changes?.initiative !== "number") ) return;
  const surprise = surpriseOf(combatant.actor);
  if ( surprise?.surprised && (surprise.rules === "modern") ) await setSurprised(combatant, false);
}

/**
 * 2014 rules: a surprised combatant's surprise ends with its first turn.
 * @param {Combat} combat
 * @param {{round?: number, combatantId?: string|null}} prior  Core's combatTurnChange "prior" state.
 */
export async function afterTurn(combat, prior) {
  // The change that starts the combat ends nobody's turn: before it, it's round 0.
  if ( !game.users.activeGM?.isSelf || !prior?.combatantId || !(prior.round > 0) ) return;
  const combatant = combat.combatants.get(prior.combatantId);
  const surprise = surpriseOf(combatant?.actor);
  if ( surprise?.surprised && (surprise.rules === "legacy") ) await setSurprised(combatant, false);
}
