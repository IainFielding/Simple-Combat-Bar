/**
 * Trackers beyond HP — pure.
 *
 * The second bar tracks one attribute that has a value and a max (a "bar" attribute in core's
 * sense: legendary actions, spell slots, a class resource). Tooltip values are a GM-chosen list of
 * attributes shown when hovering a portrait (AC, speed, spell DC…), read at hover time.
 */

import { resolveResource } from "./resources.mjs";

/**
 * @typedef {object} TooltipAttribute
 * @property {string} attr    Path under `actor.system`, e.g. "attributes.ac.value".
 * @property {string} label   Text or an i18n key.
 * @property {string} [icon]  Font Awesome classes, e.g. "fa-solid fa-shield-halved".
 */

/**
 * The second bar's fill for an actor, or null when the actor doesn't have that resource (or it
 * has no max to measure against).
 * @param {object|null} system  `actor.system`.
 * @param {string} path
 * @returns {{value: number, max: number, pct: number}|null}
 */
export function secondaryBar(system, path) {
  if ( !path ) return null;
  const { value, max, pct } = resolveResource(system, path);
  if ( (typeof value !== "number") || (max === null) || (pct === null) ) return null;
  return { value, max, pct };
}

/**
 * Tooltip rows for an actor: each configured attribute that has a value, as display text.
 * @param {object|null} system
 * @param {TooltipAttribute[]} attributes
 * @param {object} [options]
 * @param {(key: string) => string} [options.localize]        Resolves an i18n key (or returns text as is).
 * @param {(path: string) => string|null} [options.labelFor]  A readable name for a path, used when a
 *   row has no label of its own (SystemAdapter#attributeLabel).
 * @returns {Array<{label: string, icon: string, text: string}>}
 */
export function readAttributes(system, attributes, { localize = s => s, labelFor = () => null } = {}) {
  if ( !system || !Array.isArray(attributes) ) return [];
  const rows = [];
  for ( const a of attributes ) {
    if ( !a?.attr ) continue;
    const { value, max } = resolveResource(system, a.attr);
    if ( value === null ) continue;
    rows.push({
      label: localize(a.label || labelFor(a.attr) || a.attr),
      icon: a.icon || "fa-solid fa-circle-info",
      text: max !== null ? `${value} / ${max}` : String(value)
    });
  }
  return rows;
}

/**
 * Clean the rows the Trackers window submitted: trimmed, blank attributes dropped.
 * @param {Array<{attr?: string, label?: string, icon?: string}>} rows
 * @returns {TooltipAttribute[]}
 */
export function normaliseAttributes(rows) {
  return (rows ?? [])
    .map(r => ({ attr: String(r?.attr ?? "").trim(), label: String(r?.label ?? "").trim(),
      icon: String(r?.icon ?? "").trim() }))
    .filter(r => r.attr);
}

/** A colour setting value, or the fallback when it isn't a #rgb/#rrggbb hex. */
export function safeColor(value, fallback) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value ?? "").trim()) ? String(value).trim() : fallback;
}
