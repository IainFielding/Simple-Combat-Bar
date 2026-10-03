/**
 * System adapters: the only place system-specific data shapes are known.
 *
 * @typedef {object} SystemAdapter
 * @property {string} id                                  A game system id, or "generic".
 * @property {(actor: Actor) => string|null} describe     One-line summary for the tooltip.
 * @property {(actor: Actor) => {value: number|null, max: number|null, temp: number|null}|null} hp
 * @property {(actor: Actor) => ("healthy"|"bloodied"|"critical"|"down"|null)} [healthState]
 *           Coarse health from data every user receives (statuses), for viewers who can't observe
 *           the actor and so never receive its HP.
 * @property {(actor: Actor, event?: Event) => Promise<{messageMode?: string}|false>} [configureInitiative]
 *           Show the system's initiative roll dialog and prepare the roll the next initiative
 *           roll for this actor will use. Resolves to options for `Combat#rollInitiative` (the
 *           message mode picked in the dialog), or false if the user cancelled.
 * @property {(actor: Actor) => void} [clearInitiative]  Drop a roll prepared by configureInitiative.
 * @property {(path: string) => string|null} [attributeLabel]  A readable name for an attribute path.
 * @property {(actor: Actor) => {actions: {value: number, max: number}|null,
 *   resistances: {value: number, max: number}|null}} [legendary]  Legendary counters, if any.
 * @property {(actor: Actor, kind: "actions"|"resistances", delta: number) => Promise<void>} [adjustLegendary]
 * @property {() => Array<{attr: string, label: string, icon?: string}>} [defaultAttributes]
 *           Tooltip values a new world starts with.
 * @property {(actor: Actor) => Set<string>} [watchedPaths]  Top-level `system` keys whose change
 *           should refresh a portrait. Anything else in an actor update is ignored.
 * @property {(actor: Actor) => number|null} [xp]  XP for defeating this actor, or null if it gives none.
 * @property {(xp: number) => string} [awardCommand]  Chat text that lets the GM award this much XP.
 */

import { genericAdapter } from "./generic.mjs";
import { dnd5eAdapter } from "./dnd5e.mjs";

const adapters = new Map([
  [genericAdapter.id, genericAdapter],
  [dnd5eAdapter.id, dnd5eAdapter]
]);

/**
 * Register (or replace) an adapter. Exposed on the module API for other systems.
 * @param {SystemAdapter} adapter
 */
export function registerAdapter(adapter) {
  if ( !adapter?.id ) throw new Error("A system adapter needs an id.");
  adapters.set(adapter.id, { ...genericAdapter, ...adapter });
}

/**
 * The adapter for a system, falling back to the generic one.
 * @param {string} systemId
 * @returns {SystemAdapter}
 */
export function adapterFor(systemId) {
  return adapters.get(systemId) ?? genericAdapter;
}
