/**
 * Timed events — pure.
 *
 * An event is a combatant with no actor: a spell running out, a ceiling collapsing, reinforcements
 * arriving. It takes a turn at its initiative like anyone else, and if it has a duration the
 * active GM removes it once that many rounds have passed.
 */

import { normaliseArrival } from "./arrivals.mjs";

/** Recent events the Add Event dialog remembers. */
export const RECENT_LIMIT = 10;

/** Image for an event created without one. */
export const DEFAULT_EVENT_IMG = "icons/svg/clockwork.svg";

/**
 * @typedef {object} EventData
 * @property {string} name
 * @property {string} [img]
 * @property {number} initiative
 * @property {number|null} [duration]  Rounds; null or 0 lasts until removed.
 * @property {boolean} [hidden]
 * @property {number|null} [arrivesRound]  Round it arrives in (model/arrivals.mjs); null for now.
 */

/**
 * Validate and normalise what the dialog submitted.
 * @param {object} form  Raw form data.
 * @param {number} [round=0]  The combat's current round, which an arrival can't be before.
 * @returns {{data: EventData|null, error: string|null}}  `error` is an i18n key under `events.errors`.
 */
export function normaliseEvent(form, round = 0) {
  const name = String(form?.name ?? "").trim();
  if ( !name ) return { data: null, error: "name" };
  const initiative = Number(form.initiative);
  if ( (form.initiative === "") || (form.initiative === null) || !Number.isFinite(initiative) ) {
    return { data: null, error: "initiative" };
  }
  let duration = form.duration === "" || form.duration === null || form.duration === undefined
    ? null : Number(form.duration);
  if ( (duration !== null) && (!Number.isInteger(duration) || (duration < 0)) ) return { data: null, error: "duration" };
  if ( duration === 0 ) duration = null;
  const arrival = normaliseArrival(form.arrivesRound, round);
  if ( arrival.error ) return { data: null, error: "arrivesRound" };
  const img = String(form.img ?? "").trim() || DEFAULT_EVENT_IMG;
  return { data: { name, img, initiative, duration, hidden: !!form.hidden, arrivesRound: arrival.round }, error: null };
}

/**
 * Rounds an event has left, counting the current round. Null if it has no duration.
 * @param {{duration?: number|null, roundCreated?: number}} flags
 * @param {number} round  The combat's current round.
 * @returns {number|null}
 */
export function roundsLeft(flags, round) {
  if ( !flags?.duration ) return null;
  return Math.max(0, flags.duration - (round - (flags.roundCreated ?? 0)));
}

/**
 * The events whose time is up at `round`.
 * @param {Array<{id: string, flags: object}>} events  Event combatants, with their module flags.
 * @param {number} round
 * @returns {string[]}  Combatant ids to remove.
 */
export function expiredEvents(events, round) {
  return events.filter(e => roundsLeft(e.flags, round) === 0).map(e => e.id);
}

/**
 * The recent-events list with `event` at the front, one entry per name, at most
 * {@link RECENT_LIMIT} long. (The reference module's filter used `&&` where it meant `||`, so its
 * list filled with near-duplicates.)
 * @param {EventData[]} recent
 * @param {EventData} event
 * @returns {EventData[]}
 */
export function rememberEvent(recent, event) {
  const key = event.name.toLowerCase();
  const rest = (recent ?? []).filter(e => e?.name?.toLowerCase() !== key);
  return [event, ...rest].slice(0, RECENT_LIMIT);
}
