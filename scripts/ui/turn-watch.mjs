/**
 * Turn changes in a live combat, as they matter to this user: has my turn begun, am I up next.
 *
 * The decisions are pure (model/turn-watch.mjs). This reads the combat for them, remembers what it
 * said last so a change can be told from more of the same, and tells whoever is listening. It runs
 * from main.mjs's session hooks, not from the bar, so it keeps working for a user who has hidden
 * the bar.
 */

import { settings } from "../config.mjs";
import { IDLE, turnNotice, turnWatch } from "../model/turn-watch.mjs";
import { isWaiting } from "./arrival-service.mjs";
import { runSideOf } from "./facts.mjs";
import { groupContext } from "./group-service.mjs";

/** What was last seen in each combat, by combat id. */
const last = new Map();

/** @type {Set<(event: TurnChange) => void>} */
const listeners = new Set();

/**
 * @typedef {object} TurnChange
 * @property {Combat} combat
 * @property {import("../model/turn-watch.mjs").TurnWatch} before
 * @property {import("../model/turn-watch.mjs").TurnWatch} now
 * @property {{kind: "yourTurn"|"upNext", ids: string[]}|null} notice
 */

/**
 * Be told of every turn change. Registered once per session; there is nothing to undo.
 * @param {(event: TurnChange) => void} fn
 */
export function onTurnChange(fn) {
  listeners.add(fn);
}

/**
 * Whose turn it is in a combat, for this user.
 * @param {Combat} combat
 * @param {User} [user=game.user]
 * @returns {import("../model/turn-watch.mjs").TurnWatch}
 */
export function readTurnWatch(combat, user = game.user) {
  // A GM owns every combatant, so "mine" would be all of them: for a GM, only their own character.
  const mine = c => (user.isGM ? (!!c.actor && (c.actor === user.character)) : c.isOwner);
  const skipDefeated = !!combat.settings?.skipDefeated;
  return turnWatch({
    turns: combat.turns.map(c => ({ id: c.id, side: runSideOf(c), mine: mine(c),
      skip: isWaiting(c) || (skipDefeated && c.isDefeated) })),
    turn: combat.turn,
    started: combat.started,
    grouped: settings().groupTeams === "bg3",
    ended: groupContext(combat)?.state.ended ?? []
  });
}

/**
 * A combat's turn has changed: work out what that means for this user and tell the listeners.
 * @param {Combat} combat
 */
export function watchTurn(combat) {
  const before = last.get(combat.id) ?? IDLE;
  const now = readTurnWatch(combat);
  last.set(combat.id, now);
  const event = { combat, before, now, notice: turnNotice(before, now) };
  for ( const fn of listeners ) fn(event);
}

/** A combat is gone: drop what was remembered of it. */
export function forgetTurnWatch(combat) {
  last.delete(combat.id);
}
