/**
 * What the map does for this user as turns change, each by a setting of their own (the My Turn
 * window): select the acting token (GM), pan to their token as their turn begins, and clear or
 * bring back their targets between their turns.
 *
 * Driven by ui/turn-watch.mjs. Only the active combat counts: a second encounter being stepped
 * through in the sidebar shouldn't move anyone's view.
 */

import { settings } from "../config.mjs";
import { isWaiting } from "./arrival-service.mjs";

/** Targets put away at the end of a turn, by combatant id, for `targetsOnTurnEnd: "restore"`. */
const remembered = new Map();

/**
 * @param {import("./turn-watch.mjs").TurnChange} event
 */
export function turnHabits({ combat, before, now }) {
  if ( !canvas.ready || !combat.isActive ) return;
  const cfg = settings();
  // A GM runs every creature, so each turn is theirs to tidy up after; a player's are their own.
  const key = game.user.isGM ? "acting" : "mine";
  const ended = before[key].filter(id => !now[key].includes(id));
  const began = now[key].filter(id => !before[key].includes(id));

  if ( (cfg.targetsOnTurnEnd !== "keep") && ended.length ) {
    const targets = Array.from(game.user.targets, token => token.id);
    if ( cfg.targetsOnTurnEnd === "restore" ) for ( const id of ended ) remembered.set(id, targets);
    if ( targets.length ) canvas.tokens.setTargets([], { mode: "replace" });
  }
  if ( (cfg.targetsOnTurnEnd === "restore") && began.length ) {
    // Only what is still there to be seen: a target may have died, or slipped out of sight.
    const targets = began.flatMap(id => remembered.get(id) ?? []).filter(id => canvas.tokens.get(id)?.visible);
    for ( const id of began ) remembered.delete(id);
    if ( targets.length ) canvas.tokens.setTargets(targets, { mode: "replace" });
  }

  const current = combat.combatant;
  if ( cfg.autoSelectCurrent && game.user.isGM && current?.token?.object && !isWaiting(current) ) {
    current.token.object.control({ releaseOthers: true });
  }

  const mine = now.mine.filter(id => !before.mine.includes(id));
  const token = cfg.panOnMyTurn ? combat.combatants.get(mine[0])?.token?.object : null;
  if ( token ) {
    if ( token.isOwner ) token.control({ releaseOthers: true });
    canvas.animatePan(token.center);
  }
}

/** A combat is gone: forget the targets kept for its combatants. */
export function forgetTurnHabits(combat) {
  for ( const combatant of combat.combatants ) remembered.delete(combatant.id);
}
