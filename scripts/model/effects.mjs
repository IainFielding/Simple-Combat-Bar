/**
 * Status effect icons — pure.
 *
 * Which effects to draw is decided in ui/facts.mjs with core's own rule for token icons (so the
 * card shows what the token on the map shows). This file turns them into what a card draws: at
 * most a few icons, each with how much of its duration is left, and a count of the rest.
 */

/** Icons a card draws before it shows "+N". */
export const MAX_ICONS = 4;

/**
 * @typedef {object} EffectInfo
 * @property {string} id
 * @property {string} uuid
 * @property {string} img
 * @property {string} name
 * @property {number|null} remaining   In the duration's own units (rounds, turns, seconds).
 * @property {number|null} total       The duration's value in the same units.
 * @property {string} [label]          Core's "3 rounds" style label.
 * @property {string} [description]    HTML.
 */

/**
 * How much of an effect's duration is left, 0–100, or null when it has no measurable duration.
 * @param {number|null} remaining
 * @param {number|null} total
 */
export function remainingPct(remaining, total) {
  if ( !Number.isFinite(remaining) || !Number.isFinite(total) || (total <= 0) ) return null;
  return Math.min(100, Math.max(0, Math.round((remaining / total) * 100)));
}

/**
 * What a card draws.
 * @param {EffectInfo[]} effects
 * @param {number} [max]
 * @returns {{icons: Array<{uuid: string, img: string, name: string, pct: number|null}>, extra: number}}
 */
export function effectIcons(effects, max = MAX_ICONS) {
  const list = effects ?? [];
  const icons = list.slice(0, max).map(e => ({ uuid: e.uuid, img: e.img, name: e.name, pct: remainingPct(e.remaining, e.total) }));
  return { icons, extra: Math.max(0, list.length - max) };
}

/**
 * An effect's description as plain text, short enough for a tooltip line. Tags are stripped, not
 * rendered: nothing in a tooltip is enriched, so nothing a description contains can run.
 * @param {string} html
 * @param {number} [max=160]
 */
export function plainText(html, max = 160) {
  const text = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Whether a viewer is shown effect descriptions.
 * @param {"none"|"owner"|"all"} mode  Setting `effectDescriptions`.
 * @param {boolean} trusted            GM, owner or observer.
 */
export function showsDescriptions(mode, trusted) {
  return (mode === "all") || ((mode === "owner") && trusted);
}
