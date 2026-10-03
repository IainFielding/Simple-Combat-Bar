/**
 * Where the action economy lives, and who spends and resets it.
 *
 *   midi-qol          If active, it owns the economy: it spends slots as abilities are used and
 *                     resets them itself. The pips read its state and toggle it through its API.
 *   the bar (native)  Otherwise the state is a flag on the combatant, spent when dnd5e reports an
 *                     activity used, reset at the start of the combatant's turn by the active GM.
 *
 * BG3 Inspired HUD keeps its own "used" filters in memory and, when its "sync with midi-qol"
 * setting is on, follows the two effects midi-qol applies for a used Bonus Action and Reaction
 * (`dnd5ebonusaction`, `dnd5ereaction000`). With the HUD active and midi-qol not, the bar applies
 * those same two effects, so the HUD greys its filters exactly as it would under midi-qol.
 */

import { MODULE_ID } from "../config.mjs";
import { emptyEconomy, normaliseEconomy, spend, toggle } from "../model/economy.mjs";

/** midi-qol's ids for its "used" effects, which BG3 Inspired HUD also watches. */
export const MIDI_EFFECT_IDS = Object.freeze({ bonus: "dnd5ebonusaction", reaction: "dnd5ereaction000" });

/**
 * @typedef {object} EconomyProvider
 * @property {string} id
 * @property {boolean} spendsItself   It spends slots as abilities are used (the bar mustn't too).
 * @property {boolean} resetsItself   It restores slots at the start of a turn (the bar mustn't too).
 * @property {(combatant: Combatant) => {action: boolean, bonus: boolean, reaction: boolean}|null} read
 * @property {(combatant: Combatant, state: object) => Promise<void>} write
 */

/** @type {EconomyProvider} */
export const nativeEconomy = {
  id: "native",
  spendsItself: false,
  resetsItself: false,
  read(combatant) {
    if ( !combatant?.actor || combatant.flags?.[MODULE_ID]?.event ) return null;
    return normaliseEconomy(combatant.flags?.[MODULE_ID]?.economy);
  },
  async write(combatant, state) {
    await combatant.update({ [`flags.${MODULE_ID}.economy`]: normaliseEconomy(state) });
    if ( bg3Bridge() ) await syncMidiEffects(combatant.actor, state);
  }
};

/** @type {EconomyProvider} */
export const midiEconomy = {
  id: "midi-qol",
  spendsItself: true,
  resetsItself: true,
  read(combatant) {
    const actor = combatant?.actor;
    if ( !actor || combatant.flags?.[MODULE_ID]?.event ) return null;
    const midi = globalThis.MidiQOL;
    const flags = actor.getFlag?.("midi-qol", "actions") ?? {};
    return {
      action: !!flags.action,
      bonus: midi?.hasUsedBonusAction ? !!midi.hasUsedBonusAction(actor) : !!flags.bonus,
      reaction: midi?.hasUsedReaction ? !!midi.hasUsedReaction(actor) : !!flags.reaction
    };
  },
  async write(combatant, state) {
    const actor = combatant?.actor;
    if ( !actor ) return;
    const midi = globalThis.MidiQOL;
    const before = this.read(combatant) ?? emptyEconomy();
    const next = normaliseEconomy(state);
    // Bonus and reaction through midi's API when it has one, so its effects follow; the action,
    // which midi only records as a flag, through the flag.
    if ( before.bonus !== next.bonus ) {
      if ( next.bonus && midi?.setBonusActionUsed ) await midi.setBonusActionUsed(actor);
      else if ( !next.bonus && midi?.removeBonusActionUsed ) await midi.removeBonusActionUsed(actor, true);
      else await actor.setFlag("midi-qol", "actions.bonus", next.bonus);
    }
    if ( before.reaction !== next.reaction ) {
      if ( next.reaction && midi?.setReactionUsed ) await midi.setReactionUsed(actor);
      else if ( !next.reaction && midi?.removeReactionUsed ) await midi.removeReactionUsed(actor, true);
      else await actor.setFlag("midi-qol", "actions.reaction", next.reaction);
    }
    if ( before.action !== next.action ) await actor.setFlag("midi-qol", "actions.action", next.action);
  }
};

/** The provider in charge in this world. */
export function economyProvider() {
  return globalThis.game?.modules?.get("midi-qol")?.active ? midiEconomy : nativeEconomy;
}

/** Whether to mirror our state into midi-qol's effects for BG3 Inspired HUD. */
export function bg3Bridge() {
  const modules = globalThis.game?.modules;
  return !!modules?.get("bg3-inspired-hotbar")?.active && !modules?.get("midi-qol")?.active;
}

/**
 * Make the actor carry midi-qol's "used" effects for exactly the spent Bonus Action and Reaction.
 * @param {Actor} actor
 * @param {{bonus: boolean, reaction: boolean}} state
 */
export async function syncMidiEffects(actor, state) {
  if ( !actor ) return;
  const want = { bonus: !!state?.bonus, reaction: !!state?.reaction };
  const create = [];
  const remove = [];
  for ( const [slot, id] of Object.entries(MIDI_EFFECT_IDS) ) {
    const has = !!actor.effects.get(id);
    if ( want[slot] && !has ) create.push(midiEffectData(slot, id));
    if ( !want[slot] && has ) remove.push(id);
  }
  if ( create.length ) await actor.createEmbeddedDocuments("ActiveEffect", create, { keepId: true });
  if ( remove.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);
}

/** The effect midi-qol would apply for a used slot, as far as BG3 Inspired HUD needs it. */
export function midiEffectData(slot, id) {
  const bonus = slot === "bonus";
  return {
    _id: id,
    name: game.i18n.localize(`${MODULE_ID}.economy.${slot}Used`),
    img: bonus ? "icons/skills/movement/feet-winged-boots-brown.webp" : "icons/magic/time/clock-stopwatch-white-blue.webp",
    flags: { [MODULE_ID]: { economyBridge: slot } },
    duration: { value: 1, units: "turns" }
  };
}

/**
 * Spend one slot, through whichever provider is in charge.
 * @param {Combatant} combatant
 * @param {"action"|"bonus"|"reaction"} slot
 */
export async function spendSlot(combatant, slot) {
  const provider = economyProvider();
  const state = provider.read(combatant);
  if ( !state || state[slot] ) return;
  await provider.write(combatant, spend(state, slot));
}

/**
 * Flip one slot (a click on a pip).
 * @param {Combatant} combatant
 * @param {"action"|"bonus"|"reaction"} slot
 */
export async function toggleSlot(combatant, slot) {
  const provider = economyProvider();
  const state = provider.read(combatant);
  if ( !state ) return;
  await provider.write(combatant, toggle(state, slot));
}
