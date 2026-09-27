/**
 * BG3 group turns — pure.
 *
 * With grouping set to "bg3", a run of adjacent allies (or enemies) shares one turn: any member
 * may act, in any order, and the run is over when every member still standing has ended theirs.
 * Core's turn pointer always sits on the member who is acting, so dnd5e and other modules see an
 * ordinary turn; this file decides where it goes next.
 *
 * The state of the run for this round lives on the combat:
 *   { round, start, started: [ids], ended: [ids] }
 * `start` is the run's first index, so a state from another run or round is recognised as stale.
 */

import { teamRuns } from "./turn-order.mjs";

/**
 * The run holding the turn pointer, if it has more than one member.
 * @param {Array<{id: string, side: string}>} turns
 * @param {number|null} turn
 * @returns {{key: string, start: number, end: number, ids: string[]}|null}
 */
export function activeRun(turns, turn) {
  if ( (turn === null) || (turn === undefined) ) return null;
  const run = teamRuns(turns).find(r => (turn >= r.start) && (turn < r.end));
  return run && (run.ids.length > 1) ? run : null;
}

/**
 * This round's state for a run: the stored one if it belongs to this run and round, else fresh.
 * @param {object|null} stored
 * @param {{start: number}} run
 * @param {number} round
 * @returns {{round: number, start: number, started: string[], ended: string[]}}
 */
export function groupState(stored, run, round) {
  if ( stored && (stored.round === round) && (stored.start === run.start) ) {
    return { round, start: run.start, started: [...(stored.started ?? [])], ended: [...(stored.ended ?? [])] };
  }
  return { round, start: run.start, started: [], ended: [] };
}

/**
 * Whether a member may step in and act now.
 * @param {object} f
 * @param {{ids: string[]}|null} f.run
 * @param {{ended: string[]}} f.state
 * @param {string} f.id          The member asking.
 * @param {string} f.currentId   Who is acting.
 * @param {Set<string>} [f.defeated]
 */
export function canActivate({ run, state, id, currentId, defeated = new Set() }) {
  return !!run && run.ids.includes(id) && (id !== currentId) && !state.ended.includes(id) && !defeated.has(id);
}

/**
 * What happens when a member ends their part of the group turn.
 * @param {object} f
 * @param {{ids: string[], end: number}} f.run
 * @param {{ended: string[]}} f.state
 * @param {string} f.endedId
 * @param {Set<string>} [f.defeated]  Members who can't act; they don't hold the run open.
 * @returns {{ended: string[], next: {member: string}|{leave: number}}}
 *          `member`: who acts next; `leave`: the turn index after the run.
 */
export function afterEnd({ run, state, endedId, defeated = new Set() }) {
  const ended = state.ended.includes(endedId) ? [...state.ended] : [...state.ended, endedId];
  const waiting = id => !ended.includes(id) && !defeated.has(id);
  // Next in initiative order after the one who ended, wrapping round within the run.
  const from = run.ids.indexOf(endedId);
  const order = [...run.ids.slice(from + 1), ...run.ids.slice(0, Math.max(0, from))];
  const member = order.find(waiting);
  return { ended, next: member ? { member } : { leave: run.end } };
}

/**
 * Whether a member's action economy should be restored as the pointer reaches them. In a group
 * turn only the first time: stepping away and back mustn't hand them a fresh set of actions.
 * @param {{started: string[]}|null} state  null outside a group turn.
 * @param {string} id
 */
export function restoresEconomy(state, id) {
  return !state || !state.started.includes(id);
}
