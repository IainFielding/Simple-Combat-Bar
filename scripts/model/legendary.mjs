/**
 * Legendary actions and resistances — pure.
 */

/**
 * A counter's display, or null when the creature has none of that kind (or the viewer may not see).
 * @param {{value: number, max: number}|null} counter
 * @param {boolean} shown
 * @returns {{value: number, max: number}|null}
 */
export function legendaryCounter(counter, shown) {
  if ( !shown || !counter ) return null;
  const max = Number(counter.max);
  if ( !Number.isFinite(max) || (max <= 0) ) return null;
  const value = Math.min(max, Math.max(0, Number(counter.value) || 0));
  return { value, max };
}

/**
 * The new `spent` after spending (+1) or restoring (-1) one, kept within 0..max.
 * @param {number} spent
 * @param {number} max
 * @param {number} delta  +1 spends one, -1 gives one back.
 * @returns {number}
 */
export function adjustSpent(spent, max, delta) {
  return Math.min(max, Math.max(0, (Number(spent) || 0) + delta));
}
