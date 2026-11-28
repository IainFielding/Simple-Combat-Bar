/**
 * Movement this turn — pure.
 *
 * Core records each token's movement as it goes (`TokenDocument#movementHistory`) and clears every
 * combatant's at the start of each turn, so the history is what the token has moved this turn.
 * Each waypoint carries the cost of the step that reached it, difficult terrain included, in the
 * scene's grid units — but only when the client that moved it had the token drawn on its canvas.
 * A move made anywhere else (a macro, a module, a GM viewing another scene) is stored as costing
 * nothing, so each step also has core's plain measurement of its distance to fall back on.
 *
 * The bar adds the steps up and compares them with the speed for the way the token is moving, as
 * dnd5e's own ruler does: within speed, within twice it (Dash), or beyond.
 */

/** dnd5e's ruler allows this much rounding before a step counts as over. */
const TOLERANCE = 0.1;

/**
 * How far the token has moved this turn: each step at the cost recorded for it, or at its measured
 * distance when that's more (a step recorded without a canvas costs nothing). Steps that aren't
 * movement count for nothing: teleports, and the "displace" step core adds when a token jumps.
 * @param {Array<{cost?: number, action?: string}>} history  Core's movement history.
 * @param {Array<number|null>} [measured]  Each step's distance as core measures the path now
 *                                         (`TokenDocument#measureMovementPath`).
 * @param {(action: string) => boolean} [moves]  Whether an action is movement (not a teleport).
 * @returns {number}
 */
export function movementUsed(history, measured = [], moves = action => action !== "displace") {
  let used = 0;
  (history ?? []).forEach((waypoint, i) => {
    if ( !moves(waypoint?.action) ) return;
    used += Math.max(finitePositive(waypoint?.cost), finitePositive(measured[i]));
  });
  return Math.round(used * 100) / 100;
}

function finitePositive(value) {
  return Number.isFinite(value) && (value > 0) ? value : 0;
}

/**
 * The movement action to judge speed by: the one the token last moved with, else its current one.
 * @param {Array<{action?: string}>} history
 * @param {string|null} current  The token's movement action.
 * @returns {string}
 */
export function movementAction(history, current) {
  const last = history?.length ? history[history.length - 1]?.action : null;
  return last || current || "walk";
}

/**
 * Where this much movement stands against a speed.
 * @param {number} used
 * @param {number} speed
 * @returns {"normal"|"dash"|"over"}  Within speed, within twice it, or beyond.
 */
export function movementState(used, speed) {
  if ( used <= TOLERANCE ) return "normal";
  if ( !(speed > 0) ) return "over";
  const increment = (used - TOLERANCE) / speed;
  if ( increment <= 1 ) return "normal";
  return increment <= 2 ? "dash" : "over";
}

/**
 * A length as the card writes it: only the decimals it has, at most two.
 * @param {number} value
 */
export function formatDistance(value) {
  return String(Math.round(value * 100) / 100);
}
