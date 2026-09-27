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
    side: isEvent ? "neutral" : sideOf(tokenDoc?.disposition ?? 0, !!actor?.hasPlayerOwner),
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
    legendary: settings.legendaryBadges && actor && !isEvent && trustsHP
      ? safe(() => adapter.legendary?.(actor)) : null,
    economy: settings.trackEconomy && !isEvent ? safe(() => economyProvider().read(combatant)) : null,
    description: actor && !isEvent ? safe(() => adapter.describe(actor)) : null,
    isEvent,
    eventRoundsLeft
  };
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
