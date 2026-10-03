/**
 * Who sees what — pure, no Foundry globals.
 *
 * Callers pass plain facts (is this user the GM, an owner, what's the token's display mode) and
 * get decisions back, so the whole permission matrix is unit-tested without a Foundry page.
 */

/** Core's `CONST.TOKEN_DISPLAY_MODES`, duplicated so this file stays pure. */
export const DISPLAY_MODES = Object.freeze({
  NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50
});

/** Core's `CONST.TOKEN_DISPOSITIONS`. */
export const DISPOSITIONS = Object.freeze({ SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 });

/**
 * The bar's notion of side.
 * @param {number} disposition       Token disposition.
 * @param {boolean} hasPlayerOwner   Actor has a player owner (a PC or a player's summon).
 * @returns {"ally"|"enemy"|"neutral"|"secret"}
 */
export function sideOf(disposition, hasPlayerOwner) {
  if ( hasPlayerOwner ) return "ally";
  switch ( disposition ) {
    case DISPOSITIONS.FRIENDLY: return "ally";
    case DISPOSITIONS.HOSTILE: return "enemy";
    case DISPOSITIONS.SECRET: return "secret";
    default: return "neutral";
  }
}

/**
 * Whether this user sees the combatant on the bar at all.
 * @param {object} f
 * @param {boolean} f.isGM
 * @param {boolean} f.hidden               Combatant is hidden.
 * @param {boolean} f.canObserve           User has at least Observer on the actor, or owns the combatant.
 * @param {boolean} f.isFriendly
 * @param {boolean} f.hasActed             Has taken a turn in this combat (for first-round hiding).
 * @param {boolean} f.hideUnseenFirstRound Setting.
 */
export function isShown({ isGM, hidden, canObserve, isFriendly, hasActed, hideUnseenFirstRound }) {
  if ( isGM ) return true;
  if ( hidden ) return false;
  if ( hideUnseenFirstRound && !canObserve && !isFriendly && !hasActed ) return false;
  return true;
}

/**
 * The name to show this user.
 * @param {"always"|"token"|"owner"} mode   Setting `nameVisibility`.
 * @param {object} f
 * @param {string} f.name
 * @param {boolean} f.isGM
 * @param {boolean} f.isOwner
 * @param {boolean} [f.canObserve]          User has at least Observer on the actor.
 * @param {number|null} f.tokenDisplayName  Token's `displayName` mode, if there's a token.
 * @param {string} unknown                   What to show instead (localised "Unknown").
 */
export function displayName(mode, { name, isGM, isOwner, canObserve, tokenDisplayName }, unknown = "???") {
  if ( isGM || isOwner || canObserve || (mode === "always") ) return name;
  if ( mode === "owner" ) return unknown;
  const visible = [DISPLAY_MODES.HOVER, DISPLAY_MODES.ALWAYS].includes(tokenDisplayName);
  return visible ? name : unknown;
}

/**
 * How much of a combatant's HP this user sees.
 * @param {"all"|"owner"|"ownerOnly"} mode  Setting `hpVisibility`:
 *   all       — everyone sees numbers;
 *   owner     — owners/GM see numbers, others see the health state colour only;
 *   ownerOnly — owners/GM see numbers, others see nothing.
 * @param {{isGM: boolean, canObserve: boolean}} f
 * @returns {"numbers"|"state"|"none"}
 */
export function hpDetail(mode, { isGM, canObserve }) {
  if ( isGM || canObserve || (mode === "all") ) return "numbers";
  return mode === "owner" ? "state" : "none";
}

/**
 * The coarse health state shown when numbers are hidden. 5e's "bloodied" is at or below half.
 * @param {number|null} pct   0–100, or null when unknown.
 * @returns {"unknown"|"healthy"|"bloodied"|"down"}
 */
export function healthState(pct) {
  if ( (pct === null) || (pct === undefined) || Number.isNaN(pct) ) return "unknown";
  if ( pct <= 0 ) return "down";
  if ( pct <= 50 ) return "bloodied";
  return "healthy";
}

/**
 * Whether this user sees the initiative value.
 * @param {boolean} hideEnemyInitiative Setting.
 * @param {{isGM: boolean, isOwner: boolean}} f
 */
export function showsInitiative(hideEnemyInitiative, { isGM, isOwner }) {
  return isGM || isOwner || !hideEnemyInitiative;
}
