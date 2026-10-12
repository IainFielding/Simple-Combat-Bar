/**
 * Whose turn it is, and who is up next, from one user's point of view — pure.
 *
 * "Acting" is whoever may act now: the current combatant, or with BG3 group turns every member of
 * the run holding the turn who hasn't ended their part. "Up next" is whoever acts once they're
 * done. Both are only ever reported for the user's own combatants, so nothing here can tell a
 * player about an enemy they can't see.
 */

import { activeRun } from "./group-turns.mjs";
import { teamRuns } from "./turn-order.mjs";

/**
 * @typedef {object} WatchEntry
 * @property {string} id
 * @property {"ally"|"enemy"|"neutral"|"secret"} side  For team runs.
 * @property {boolean} [mine]   This user's own combatant.
 * @property {boolean} [skip]   Passed over when the turn moves on: defeated, or not arrived yet.
 */

/**
 * @typedef {object} TurnWatch
 * @property {string[]} mine    The user's combatants acting now.
 * @property {string[]} upNext  The user's combatants acting next, and not already acting.
 */

/** Nothing happening: before the start, or no combat. */
export const IDLE = Object.freeze({ mine: Object.freeze([]), upNext: Object.freeze([]) });

/**
 * @param {object} f
 * @param {WatchEntry[]} f.turns     Core's `combat.turns` order.
 * @param {number|null} f.turn       Core's turn pointer.
 * @param {boolean} f.started
 * @param {boolean} [f.grouped]      BG3 group turns are on.
 * @param {string[]} [f.ended]       Members of the active run who have ended their part.
 * @returns {TurnWatch}
 */
export function turnWatch({ turns, turn, started, grouped = false, ended = [] }) {
  if ( !started || (turn === null) || (turn === undefined) || !turns[turn] ) return IDLE;
  const run = grouped ? activeRun(turns, turn) : null;
  // The pointer's own combatant always counts, even if marked to skip: it's their turn regardless.
  const acting = run
    ? run.ids.filter(id => (id === turns[turn].id) || (!ended.includes(id) && !turns.find(t => t.id === id).skip))
    : [turns[turn].id];

  // The first combatant after the acting slot who'll take a turn, going round once.
  const after = run ? run.end : turn + 1;
  let next = null;
  for ( let step = 0; step < turns.length; step++ ) {
    const index = (after + step) % turns.length;
    if ( !turns[index].skip && !acting.includes(turns[index].id) ) {
      next = index;
      break;
    }
  }
  let upcoming = [];
  if ( next !== null ) {
    const nextRun = grouped ? teamRuns(turns).find(r => (next >= r.start) && (next < r.end)) : null;
    upcoming = nextRun ? nextRun.ids.filter(id => !turns.find(t => t.id === id).skip) : [turns[next].id];
  }

  const mine = new Set(turns.filter(t => t.mine).map(t => t.id));
  return {
    mine: acting.filter(id => mine.has(id)),
    upNext: upcoming.filter(id => mine.has(id) && !acting.includes(id))
  };
}

/**
 * What to tell the user after a turn change: their turn has begun, or they're up next. A turn that
 * was already theirs (the pointer moving within their group) says nothing again.
 * @param {TurnWatch} before
 * @param {TurnWatch} now
 * @returns {{kind: "yourTurn"|"upNext", ids: string[]}|null}
 */
export function turnNotice(before, now) {
  const began = now.mine.filter(id => !before.mine.includes(id));
  if ( began.length ) return { kind: "yourTurn", ids: began };
  const queued = now.upNext.filter(id => !before.upNext.includes(id));
  if ( queued.length ) return { kind: "upNext", ids: queued };
  return null;
}
