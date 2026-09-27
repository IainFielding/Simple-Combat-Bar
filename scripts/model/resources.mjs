/**
 * Reading tracked attributes off actor system data — pure.
 *
 * Attribute paths are the ones a GM types or picks in core's tracked-attribute list:
 * `attributes.hp` (a bar: has value and max), `attributes.hp.value`, `attributes.ac.value`,
 * `details.cr`. Both spellings of a bar resolve to the same thing.
 */

/** Read a dotted path; `undefined` if any step is missing. */
export function getPath(object, path) {
  if ( !path ) return undefined;
  let node = object;
  for ( const part of path.split(".") ) {
    if ( (node === null) || (node === undefined) ) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Normalise a raw value for display: numbers stay numbers, booleans become ticks, arrays and
 * sets are joined, empty strings and objects are dropped.
 * @returns {number|string|null}
 */
export function displayValue(value) {
  if ( typeof value === "boolean" ) return value ? "✓" : "✗";
  if ( value instanceof Set ) value = Array.from(value);
  if ( Array.isArray(value) ) return value.length ? value.join(", ") : null;
  if ( (value === "") || (value === null) || (value === undefined) ) return null;
  if ( typeof value === "number" ) return Number.isFinite(value) ? value : null;
  if ( typeof value === "string" ) return value;
  return null;
}

/**
 * Resolve an attribute path against system data.
 * @param {object} system    `actor.system`.
 * @param {string} path
 * @returns {{value: number|string|null, max: number|null, pct: number|null}}
 */
export function resolveResource(system, path) {
  const empty = { value: null, max: null, pct: null };
  if ( !system || !path ) return empty;

  let raw = getPath(system, path);
  let max;
  if ( raw && (typeof raw === "object") && !Array.isArray(raw) && !(raw instanceof Set) && ("value" in raw) ) {
    max = raw.max;
    raw = raw.value;
  } else if ( path.endsWith(".value") ) {
    max = getPath(system, `${path.slice(0, -".value".length)}.max`);
  }

  const value = displayValue(raw);
  const numericMax = (typeof max === "number") && Number.isFinite(max) && (max > 0) ? max : null;
  const pct = (typeof value === "number") && numericMax
    ? Math.min(100, Math.max(0, Math.round((value / numericMax) * 100)))
    : null;
  return { value, max: numericMax, pct };
}
