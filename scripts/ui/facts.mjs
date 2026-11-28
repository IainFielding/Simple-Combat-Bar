/**
 * The one place that reads live Foundry documents for a portrait. Everything downstream of
 * {@link combatantFacts} is pure (see model/portrait-model.mjs).
 */

import { MODULE_ID } from "../config.mjs";
import { sideOf } from "../model/visibility.mjs";
import { roundsLeft } from "../model/events.mjs";
import { arrivalRound } from "../model/arrivals.mjs";
import { followedId } from "../model/companions.mjs";
import { secondaryBar } from "../model/trackers.mjs";
import { effectLevel } from "../model/effects.mjs";
import { economyProvider } from "../systems/economy.mjs";
import { surpriseOf } from "./surprise-service.mjs";
import { formatDistance, movementAction, movementState, movementUsed } from "../model/movement.mjs";

/**
 * @param {Combatant} combatant
 * @param {object} ctx
 * @param {import("../systems/adapter.mjs").SystemAdapter} ctx.adapter
 * @param {object} ctx.settings
 * @param {User} [ctx.user=game.user]
 * @param {boolean} [ctx.current=false]  Acting now. Movement this turn is read for this card only:
 *   it's shown nowhere else, so measuring everyone's path would be work thrown away.
 * @returns {import("../model/portrait-model.mjs").CombatantFacts}
 */
export function combatantFacts(combatant, { adapter, settings, user = game.user, current = false }) {
  const actor = combatant.actor;
  const tokenDoc = combatant.token;
  const flags = combatant.flags?.[MODULE_ID] ?? {};
  const isEvent = !!flags.event;
  const canObserve = actor ? actor.testUserPermission(user, "OBSERVER") : combatant.isOwner;
  // Only trust HP numbers this user actually receives (see SystemAdapter#healthState).
  const trustsHP = user.isGM || canObserve || combatant.isOwner;

  let img = combatant.img;
  if ( (settings.portraitImage === "actor") && actor?.img && !isEvent ) img = actor.img;

  // A companion shows its owner's initiative: its own sits just below it, to keep the order.
  const leaderId = followedId(flags);
  const leader = leaderId ? combatant.combat?.combatants.get(leaderId) ?? null : null;
  const namesLeader = !!leader && (user.isGM || !!leader.actor?.hasPlayerOwner
    || !!leader.actor?.testUserPermission(user, "OBSERVER"));

  // Surprised under the 2014 rules: no action, bonus action or reaction until its first turn ends.
  const surprise = actor && !isEvent ? surpriseOf(actor) : null;
  const surprised = surprise?.surprised ? surprise.rules : null;

  const arrivesRound = arrivalRound(flags);
  // A waiting event's countdown starts when it arrives.
  const eventRoundsLeft = isEvent && (arrivesRound === null) ? roundsLeft(flags, combatant.combat?.round ?? 0) : null;

  return {
    id: combatant.id,
    name: combatant.name,
    img,
    side: sideOfCombatant(combatant),
    isGM: user.isGM,
    isOwner: combatant.isOwner,
    canObserve,
    isPC: !!actor?.hasPlayerOwner,
    hidden: combatant.hidden,
    defeated: combatant.isDefeated,
    initiative: (leader ? leader.initiative : combatant.initiative) ?? null,
    isCompanion: !!leader,
    leaderName: namesLeader ? leader.name : null,
    tokenDisplayName: tokenDoc?.displayName ?? null,
    hp: actor && !isEvent && trustsHP ? safe(() => adapter.hp(actor)) : null,
    healthHint: actor && !isEvent && !trustsHP ? safe(() => adapter.healthState?.(actor)) : null,
    // Like HP numbers: only for viewers who actually receive the actor's data.
    secondary: actor && !isEvent && trustsHP ? safe(() => secondaryBar(actor.system, settings.secondaryResource)) : null,
    trusted: trustsHP,
    effects: settings.showEffects && actor && !isEvent ? safe(() => readEffects(actor, { card: true })) : null,
    legendary: settings.legendaryBadges && actor && !isEvent && trustsHP
      ? safe(() => adapter.legendary?.(actor)) : null,
    // Like the legendary badges: only for viewers who receive the actor's data.
    inspiration: settings.inspirationMarker && actor && !isEvent && trustsHP
      ? safe(() => adapter.inspiration?.(actor)) : null,
    economy: settings.trackEconomy && !isEvent
      ? ((surprised === "legacy") ? SURPRISED_ECONOMY : safe(() => economyProvider().read(combatant))) : null,
    surprised,
    // Like HP numbers: only for viewers who receive the actor's data.
    movement: current && settings.movementTracker && actor && tokenDoc && !isEvent && trustsHP
      && combatant.combat?.started ? safe(() => readMovement(tokenDoc, actor, adapter)) : null,
    description: actor && !isEvent ? safe(() => adapter.describe(actor)) : null,
    isEvent,
    eventRoundsLeft,
    arrivesRound
  };
}

/** Every slot spent: a combatant surprised under the 2014 rules has none to use yet. */
const SURPRISED_ECONOMY = Object.freeze({ action: true, bonus: true, reaction: true });

/**
 * How far a combatant's token has moved this turn, against its speed for the way it's moving.
 * @returns {{used: string, speed: string, units: string, state: "normal"|"dash"|"over"}|null}
 */
function readMovement(tokenDoc, actor, adapter) {
  const history = tokenDoc.movementHistory ?? [];
  const speed = adapter.movementSpeed?.(actor, movementAction(history, tokenDoc.movementAction));
  if ( (speed === null) || (speed === undefined) ) return null;
  // Core's plain measurement of each step's distance, for steps recorded without a canvas (costed at 0).
  const measured = history.length > 1
    ? (tokenDoc.measureMovementPath?.(history)?.waypoints ?? []).map(w => w?.backward?.distance ?? null) : [];
  const moves = action => (action !== "displace") && !CONFIG.Token?.movement?.actions?.[action]?.teleport;
  const used = movementUsed(history, measured, moves);
  return { used: formatDistance(used), speed: formatDistance(speed), units: tokenDoc.parent?.grid?.units ?? "",
    state: movementState(used, speed) };
}

/** Statuses the card already shows another way, left off its icons (the tooltip still lists them). */
const CARD_SKIPS = Object.freeze(["bloodied"]);

/**
 * The effects to draw for an actor, by core's own rule for token icons (Token#_drawEffects): the
 * applied effects shown ALWAYS, or CONDITIONAL and temporary. Defeated is left out (the card has its
 * own skull), as are the bar's own midi-qol bridge effects.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.card]  For the card's icons: also leave out statuses the card already
 *   shows (dnd5e's Bloodied is the damage fill and health state).
 * @returns {import("../model/effects.mjs").EffectInfo[]}
 */
export function readEffects(actor, { card = false } = {}) {
  const SHOW = CONST.ACTIVE_EFFECT_SHOW_ICON;
  const defeated = CONFIG.specialStatusEffects?.DEFEATED;
  return (actor.appliedEffects ?? [])
    .filter(e => e.img && ((e.showIcon === SHOW.ALWAYS) || ((e.showIcon === SHOW.CONDITIONAL) && e.isTemporary)))
    .filter(e => !(defeated && e.statuses?.has(defeated)) && !e.flags?.[MODULE_ID]?.economyBridge)
    .filter(e => !card || !CARD_SKIPS.some(s => e.statuses?.has(s)))
    .map(e => ({
      id: e.id, uuid: e.uuid, img: e.img, name: e.name,
      remaining: e.duration?.remaining ?? null, total: e.duration?.value ?? null,
      label: e.duration?.label ?? "", description: e.description ?? "", modified: e._stats?.modifiedTime ?? null,
      // A leveled condition (dnd5e's Exhaustion) carries its level, and which condition it is.
      ...leveled(e)
    }));
}

/** A leveled condition's level and status id; nulls for any other effect. */
function leveled(effect) {
  const level = effectLevel(effect.system?.level);
  return { level, statusId: level === null ? null : (effect.statuses?.values().next().value ?? null) };
}

/**
 * The bar's side for a combatant: events are neutral, anything with a player owner is an ally,
 * otherwise the token's disposition decides.
 * @param {Combatant} combatant
 */
export function sideOfCombatant(combatant) {
  if ( combatant.flags?.[MODULE_ID]?.event ) return "neutral";
  return sideOf(combatant.token?.disposition ?? 0, !!combatant.actor?.hasPlayerOwner);
}

/**
 * A combatant's side for team runs. One that hasn't arrived yet counts as neutral, so it never
 * joins a group turn it isn't there for.
 * @param {Combatant} combatant
 */
export function runSideOf(combatant) {
  if ( arrivalRound(combatant.flags?.[MODULE_ID]) !== null ) return "neutral";
  return sideOfCombatant(combatant);
}

/** Adapter code is the most likely to meet data it doesn't expect; never let it break a render. */
function safe(fn) {
  try {
    return fn() ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} |`, err);
    return null;
  }
}
