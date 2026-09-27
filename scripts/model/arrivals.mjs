/**
 * Late arrivals — pure.
 *
 * A combatant (or event) can be put in the order now but arrive later: a Death Tyrant erupting from
 * the canal on initiative count 0 of round 2. Until its round it is hidden from players and its
 * turn is skipped. It arrives when its turn comes up in that round, when the active GM reveals it.
 *
 * Stored on the combatant as `flags[MODULE_ID].arrival = {round, hidden}`: `round` is the round it
 * arrives in, and `hidden` is whether it stays hidden after it arrives (as it was before it was
 * scheduled). The flag is cleared on arrival.
 */

/**
 * The round a combatant arrives in, or null if it's already here.
 * @param {{arrival?: {round?: number}|null}} flags  The module's flags.
 * @returns {number|null}
 */
export function arrivalRound(flags) {
  const round = flags?.arrival?.round;
  return Number.isInteger(round) && (round >= 1) ? round : null;
}

/**
 * Whether its turn in `round` is skipped: its arrival round hasn't come yet.
 * @param {object} flags
 * @param {number} round
 */
export function isAway(flags, round) {
  const arrives = arrivalRound(flags);
  return (arrives !== null) && (round < arrives);
}

/**
 * Whether it arrives as its turn starts in `round`.
 * @param {object} flags
 * @param {number} round
 */
export function isDue(flags, round) {
  const arrives = arrivalRound(flags);
  return (arrives !== null) && (round >= arrives);
}

/**
 * Validate the round the GM typed.
 * @param {string|number|null|undefined} value  Blank means "here now".
 * @param {number} round  The combat's current round (0 before it starts).
 * @returns {{round: number|null, error: string|null}}  `error` is an i18n key under `arrivals.errors`.
 */
export function normaliseArrival(value, round = 0) {
  if ( (value === "") || (value === null) || (value === undefined) ) return { round: null, error: null };
  const arrives = Number(value);
  if ( !Number.isInteger(arrives) || (arrives < Math.max(round, 1)) ) return { round: null, error: "round" };
  return { round: arrives, error: null };
}

/**
 * Where the turn pointer should go instead, if it's about to land on a combatant that isn't here
 * yet. Steps on in `direction`, across round boundaries, for at most one lap of the order.
 * @param {object} input
 * @param {Array<{arrivesRound: number|null, defeated?: boolean}>} input.turns  Core's `combat.turns`.
 * @param {number} input.round   The round the pointer is moving to.
 * @param {number|null} input.turn  The turn it's moving to.
 * @param {1|-1} [input.direction=1]
 * @param {boolean} [input.skipDefeated=false]  Core's combat setting: also step over the defeated
 *   when moving forward, as core's own nextTurn does.
 * @returns {{round: number, turn: number}|null}  null to leave the move as it is: it doesn't land on
 *   an absent combatant, or there's nobody present to move to instead.
 */
export function skipAbsent({ turns, round, turn, direction = 1, skipDefeated = false }) {
  if ( (turn === null) || (turn === undefined) || !turns?.length || (round < 1) ) return null;
  const away = (index, r) => (turns[index]?.arrivesRound ?? 0) > r;
  if ( !away(turn, round) ) return null;
  const skipped = (index, r) => away(index, r) || ((direction > 0) && skipDefeated && !!turns[index].defeated);

  let r = round;
  let i = turn;
  for ( let step = 0; step < turns.length; step++ ) {
    i += direction > 0 ? 1 : -1;
    if ( i >= turns.length ) {
      r++;
      i = 0;
    }
    else if ( i < 0 ) {
      r--;
      i = turns.length - 1;
      if ( r < 1 ) return null;
    }
    if ( !skipped(i, r) ) return { round: r, turn: i };
  }
  return null;
}
