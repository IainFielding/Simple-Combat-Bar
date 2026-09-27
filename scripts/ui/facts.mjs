/**
 * The one place that reads live Foundry documents for a portrait. Everything downstream of
 * {@link combatantFacts} is pure (see model/portrait-model.mjs).
 */

import { MODULE_ID } from "../config.mjs";
import { sideOf } from "../model/visibility.mjs";
import { roundsLeft } from "../model/events.mjs";
import { secondaryBar } from "../model/trackers.mjs";
import { economyProvider } from "../systems/economy.mjs";

/**
 * @param {Combatant} combatant
 * @param {object} ctx
 * @param {import("../systems/adapter.mjs").SystemAdapter} ctx.adapter
 * @param {object} ctx.settings
 * @param {User} [ctx.user=game.user]
 * @returns {import("../model/portrait-model.mjs").CombatantFacts}
 */
export function combatantFacts(combatant, { adapter, settings, user = game.user }) {
  const actor = combatant.actor;
  const tokenDoc = combatant.token;
  const flags = combatant.flags?.[MODULE_ID] ?? {};
  const isEvent = !!flags.event;
  const canObserve = actor ? actor.testUserPermission(user, "OBSERVER") : combatant.isOwner;
  // Only trust HP numbers this user actually receives (see SystemAdapter#healthState).
  const trustsHP = user.isGM || canObserve || combatant.isOwner;

  let img = combatant.img;
  if ( (settings.portraitImage === "actor") && actor?.img && !isEvent ) img = actor.img;

  const eventRoundsLeft = isEvent ? roundsLeft(flags, combatant.combat?.round ?? 0) : null;

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
    initiative: combatant.initiative ?? null,
    tokenDisplayName: tokenDoc?.displayName ?? null,
    hp: actor && !isEvent && trustsHP ? safe(() => adapter.hp(actor)) : null,
    healthHint: actor && !isEvent && !trustsHP ? safe(() => adapter.healthState?.(actor)) : null,
    // Like HP numbers: only for viewers who actually receive the actor's data.
    secondary: actor && !isEvent && trustsHP ? safe(() => secondaryBar(actor.system, settings.secondaryResource)) : null,
    trusted: trustsHP,
    effects: settings.showEffects && actor && !isEvent ? safe(() => readEffects(actor, { card: true })) : null,
    legendary: settings.legendaryBadges && actor && !isEvent && trustsHP
      ? safe(() => adapter.legendary?.(actor)) : null,
    economy: settings.trackEconomy && !isEvent ? safe(() => economyProvider().read(combatant)) : null,
    description: actor && !isEvent ? safe(() => adapter.describe(actor)) : null,
    isEvent,
    eventRoundsLeft
  };
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
      label: e.duration?.label ?? "", description: e.description ?? ""
    }));
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

/** Adapter code is the most likely to meet data it doesn't expect; never let it break a render. */
function safe(fn) {
  try {
    return fn() ?? null;
  } catch ( err ) {
    console.error(`${MODULE_ID} |`, err);
    return null;
  }
}
