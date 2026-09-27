/**
 * The end-of-combat XP summary — pure, no Foundry globals.
 */

/**
 * @typedef {object} XPLine
 * @property {string} name
 * @property {number} count    How many were defeated.
 * @property {number} xp       XP for one.
 * @property {number} subtotal
 */

/**
 * Tally defeated enemies into one line per creature, in the order first seen. Two creatures share
 * a line only when both the name and the XP match, so a renamed or re-statted copy stays separate.
 * Anything without an XP value (not an NPC, or a system that has none) is left out.
 * @param {Array<{name: string, xp: number|null}>} defeated
 * @returns {{lines: XPLine[], total: number}}
 */
export function tallyDefeated(defeated) {
  const lines = new Map();
  for ( const { name, xp } of defeated ?? [] ) {
    if ( !Number.isFinite(xp) || (xp < 0) ) continue;
    const key = `${name}\u0000${xp}`;
    const line = lines.get(key) ?? { name, count: 0, xp, subtotal: 0 };
    line.count += 1;
    line.subtotal += xp;
    lines.set(key, line);
  }
  const list = [...lines.values()];
  return { lines: list, total: list.reduce((sum, l) => sum + l.subtotal, 0) };
}
