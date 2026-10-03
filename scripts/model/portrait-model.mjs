/**
 * Combatant → portrait view-model.
 *
 * Split in two so the decisions stay testable:
 *   - {@link buildPortraitModel} is pure. It takes plain facts and the settings snapshot, and
 *     returns a flat object of primitives that a portrait style can render.
 *   - `combatantFacts` (in ui/facts.mjs) is the only place that reads live Foundry documents.
 *
 * Models are flat and made of primitives so {@link sameModel} can compare them field by field;
 * the flush skips any portrait whose model didn't change.
 */

import { displayName, healthState, hpDetail, showsInitiative } from "./visibility.mjs";
import { pipStates } from "./economy.mjs";
import { legendaryCounter } from "./legendary.mjs";
import { effectIcons } from "./effects.mjs";

/**
 * @typedef {object} CombatantFacts
 * @property {string} id
 * @property {string} name
 * @property {string} img
 * @property {"ally"|"enemy"|"neutral"|"secret"} side
 * @property {boolean} isGM
 * @property {boolean} isOwner          User owns the combatant.
 * @property {boolean} canObserve       User has Observer+ on the actor.
 * @property {boolean} isPC             Actor has a player owner.
 * @property {boolean} hidden
 * @property {boolean} defeated
 * @property {number|null} initiative
 * @property {number|null} tokenDisplayName
 * @property {{value: number|null, max: number|null, temp: number|null}|null} hp
 * @property {"healthy"|"bloodied"|"down"|null} [healthHint]
 *           Coarse health from statuses, for viewers who don't receive HP numbers.
 * @property {{value: number, max: number, pct: number}|null} [secondary]  The second bar, if any.
 * @property {boolean} [trusted]  This viewer receives the actor's data (GM, owner, observer).
 * @property {{action: boolean, bonus: boolean, reaction: boolean}|null} [economy]  Spent slots.
 * @property {string|null} description
 * @property {boolean} isEvent          An "Add Event" pseudo-combatant.
 * @property {number|null} eventRoundsLeft
 * @property {number|null} [arrivesRound]  Round it arrives in, if it hasn't yet (model/arrivals.mjs).
 */

/**
 * @param {CombatantFacts} facts
 * @param {object} ctx
 * @param {object} ctx.settings            Settings snapshot.
 * @param {boolean} ctx.current       Acting now (core's pointer).
 * @param {boolean} ctx.acted
 * @param {boolean} [ctx.activeRun]   In the run sharing a BG3 group turn.
 * @param {boolean} [ctx.ended]       Has ended their part of that group turn.
 * @param {boolean} [ctx.canTakeTurn] This viewer may click to have them act now.
 * @param {string|null} ctx.run
 * @param {number} [ctx.decimals=0]        Initiative decimals to show.
 * @param {string} [ctx.unknownName]
 * @returns {object}
 */
export function buildPortraitModel(facts, { settings, current, acted, run, activeRun = false, ended = false,
  canTakeTurn = false, decimals = 0, unknownName = "???" }) {
  const viewer = { isGM: facts.isGM, isOwner: facts.isOwner, canObserve: facts.canObserve || facts.isOwner };
  const hpMode = hpDetail(settings.hpVisibility, viewer);

  let hpValue = null;
  let hpMax = null;
  let hpTemp = null;
  let hpPct = null;
  if ( facts.hp && (typeof facts.hp.value === "number") && (typeof facts.hp.max === "number") && (facts.hp.max > 0) ) {
    hpPct = Math.min(100, Math.max(0, Math.round((facts.hp.value / facts.hp.max) * 100)));
    if ( hpMode === "numbers" ) {
      hpValue = facts.hp.value;
      hpMax = facts.hp.max;
      hpTemp = facts.hp.temp || null;
    }
  }

  // No numbers for this viewer, but a status-derived state: show the state, never a number.
  let hpState = hpMode === "none" ? "unknown" : healthState(hpPct);
  let damagePct = settings.damageFill ? damageFill(hpMode, hpPct) : null;
  if ( (hpPct === null) && facts.healthHint && (hpMode !== "none") ) {
    hpState = facts.healthHint;
    damagePct = settings.damageFill ? STATE_FILL[hpState] ?? null : null;
  }

  const rolled = (facts.initiative !== null) && (facts.initiative !== undefined);
  const initVisible = showsInitiative(settings.hideEnemyInitiative, viewer);
  let initiative = null;
  // Each value shows only the decimals it has: one event at 21.5 mustn't turn every 25 into "25.00".
  if ( rolled ) initiative = initVisible ? String(Number(Number(facts.initiative).toFixed(decimals))) : "?";

  return {
    id: facts.id,
    // An event is the GM's announcement, not a creature: anyone who can see it can read it.
    name: facts.isEvent ? facts.name : displayName(settings.nameVisibility, { ...facts, ...viewer }, unknownName),
    img: facts.img,
    side: facts.side,
    pc: facts.isPC,
    current,
    acted,
    run,
    activeRun,
    ended,
    canTakeTurn,
    hidden: facts.hidden,
    defeated: facts.defeated,
    owner: facts.isOwner,
    initiative,
    canRoll: !rolled && (facts.isOwner || facts.isGM) && !facts.isEvent,
    hpShown: (hpMode !== "none") && ((hpPct !== null) || (hpState !== "unknown")),
    // The bar needs a number; a viewer who only knows the state gets the damage fill instead.
    hpBar: settings.hpBar && (hpMode !== "none") && (hpPct !== null),
    secPct: facts.secondary?.pct ?? null,
    secValue: facts.secondary?.value ?? null,
    secMax: facts.secondary?.max ?? null,
    trusted: !!facts.trusted,
    // Action pips: like HP numbers, only for viewers who receive the actor's data.
    ...pipStates(facts.economy ?? null, { current, shown: !!facts.trusted }),
    canTogglePips: !!facts.economy && (facts.isOwner || facts.isGM),
    ...legendaryFields(facts),
    ...effectFields(facts),
    hpState,
    hpPct: hpMode === "none" ? null : hpPct,
    hpValue,
    hpMax,
    hpTemp,
    damagePct,
    description: (viewer.canObserve || facts.isGM) ? (facts.description ?? null) : null,
    isEvent: facts.isEvent,
    eventRoundsLeft: facts.eventRoundsLeft ?? null,
    arrivesRound: facts.arrivesRound ?? null
  };
}

/**
 * The effect icons as one string, so the model stays primitives only and an unchanged set of
 * effects compares equal (and doesn't repaint).
 */
function effectFields(facts) {
  const { icons, extra } = effectIcons(facts.effects ?? []);
  return { effects: JSON.stringify(icons), effectsExtra: extra };
}

/** Flat legendary fields: the model stays primitives only. */
function legendaryFields(facts) {
  const shown = !!facts.trusted;
  const actions = legendaryCounter(facts.legendary?.actions ?? null, shown);
  const resistances = legendaryCounter(facts.legendary?.resistances ?? null, shown);
  return {
    legActValue: actions?.value ?? null,
    legActMax: actions?.max ?? null,
    legResValue: resistances?.value ?? null,
    legResMax: resistances?.max ?? null,
    canAdjustLegendary: !!(actions || resistances) && (facts.isOwner || facts.isGM)
  };
}

/**
 * How much of the portrait the red damage overlay covers, 0–100, or null for none.
 *
 * A viewer who may see HP numbers gets the exact missing fraction. A viewer limited to the health
 * *state* gets the fill for that state's band instead, so the overlay can't be read as a number.
 * @param {"numbers"|"state"|"none"} hpMode
 * @param {number|null} hpPct
 * @returns {number|null}
 */
export function damageFill(hpMode, hpPct) {
  if ( (hpMode === "none") || (hpPct === null) ) return null;
  if ( hpMode === "numbers" ) return 100 - hpPct;
  return STATE_FILL[healthState(hpPct)];
}

/** The overlay for each coarse health state. */
export const STATE_FILL = Object.freeze({ healthy: 0, bloodied: 50, down: 100 });

/**
 * Shallow equality over model fields. Models are flat and primitive, so this is exact.
 * @returns {boolean}
 */
export function sameModel(a, b) {
  if ( a === b ) return true;
  if ( !a || !b ) return false;
  const keys = Object.keys(a);
  if ( keys.length !== Object.keys(b).length ) return false;
  return keys.every(k => Object.is(a[k], b[k]));
}

/**
 * The fields that differ between two models.
 * @returns {string[]}
 */
export function changedFields(prev, next) {
  if ( !prev ) return Object.keys(next);
  return Object.keys(next).filter(k => !Object.is(prev[k], next[k]));
}
