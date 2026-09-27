/**
 * Action economy — pure.
 *
 * Three slots, as BG3 draws them and 5e spends them: the Action, the Bonus Action and the
 * Reaction. State is "spent" flags, so a combatant with nothing recorded has everything available.
 * All three come back at the start of the combatant's own turn (a reaction included, per 5e).
 */

export const SLOTS = Object.freeze(["action", "bonus", "reaction"]);

/** A fresh turn: nothing spent. */
export function emptyEconomy() {
  return { action: false, bonus: false, reaction: false };
}

/**
 * Coerce whatever was stored into a complete state.
 * @param {object|null|undefined} raw
 * @returns {{action: boolean, bonus: boolean, reaction: boolean}}
 */
export function normaliseEconomy(raw) {
  const state = emptyEconomy();
  for ( const slot of SLOTS ) state[slot] = !!raw?.[slot];
  return state;
}

/** Whether anything is spent (so a reset has something to write). */
export function anySpent(state) {
  return SLOTS.some(slot => state?.[slot]);
}

/**
 * The slot a dnd5e activation type spends, or null for one that doesn't touch the action economy
 * (legendary and lair actions, minutes, hours, special…).
 * @param {string|null|undefined} activationType  `activity.activation.type`.
 * @returns {"action"|"bonus"|"reaction"|null}
 */
export function activationSlot(activationType) {
  switch ( activationType ) {
    case "action": return "action";
    case "bonus": return "bonus";
    case "reaction": return "reaction";
    default: return null;
  }
}

/** State with one slot spent. */
export function spend(state, slot) {
  if ( !SLOTS.includes(slot) ) return normaliseEconomy(state);
  return { ...normaliseEconomy(state), [slot]: true };
}

/** State with one slot flipped (a manual click on a pip). */
export function toggle(state, slot) {
  const next = normaliseEconomy(state);
  if ( SLOTS.includes(slot) ) next[slot] = !next[slot];
  return next;
}

/**
 * What each pip shows on a portrait. The current combatant shows all three; everyone else shows
 * only the reaction, since that is the one spent off-turn.
 * @param {{action: boolean, bonus: boolean, reaction: boolean}|null} state  null: not tracked.
 * @param {{current: boolean, shown: boolean}} options  `shown`: this viewer may see it.
 * @returns {{pipAction: string|null, pipBonus: string|null, pipReaction: string|null}}
 *          Each "available", "spent", or null when not drawn.
 */
export function pipStates(state, { current, shown }) {
  if ( !state || !shown ) return { pipAction: null, pipBonus: null, pipReaction: null };
  const look = slot => (state[slot] ? "spent" : "available");
  return {
    pipAction: current ? look("action") : null,
    pipBonus: current ? look("bonus") : null,
    pipReaction: look("reaction")
  };
}
