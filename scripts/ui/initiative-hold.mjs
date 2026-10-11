/**
 * Keeps a freshly rolled initiative off the bar while Dice So Nice is still rolling its dice.
 *
 * Dice So Nice hides a roll's chat message (and masks core's combat tracker) until the dice stop,
 * unless its *Display chat messages immediately* setting is on. Core writes the initiative to the
 * combatant first and creates the chat message after, so the hold comes in two parts: a short
 * wait for the message, then the wait for that message's dice.
 */

/** How long to wait for a roll's chat message. One that is whispered to someone else never comes. */
export const MESSAGE_WAIT_MS = 1000;

const MESSAGE = Symbol("message");

/**
 * Whether Dice So Nice is holding initiative results back until its dice stop.
 * @returns {boolean}
 */
export function diceHoldInitiative() {
  if ( !game.modules.get("dice-so-nice")?.active || !game.dice3d ) return false;
  try {
    return !game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages")
      && !game.settings.get("dice-so-nice", "disabledForInitiative");
  } catch {
    return false;
  }
}

export class InitiativeHold {

  /** @type {Map<string, Set<string|symbol>>}  Combatant id → what its result is waiting for. */
  #waiting = new Map();
  /** @type {Map<string, string>}  Chat message id → combatant id. */
  #messages = new Map();
  #timers = new Map();
  #life;
  #onChange;

  /**
   * @param {import("../core/lifecycle.mjs").Lifecycle} life  Owns the timers.
   * @param {() => void} onChange                             A combatant started or stopped being held.
   */
  constructor(life, onChange) {
    this.#life = life;
    this.#onChange = onChange;
  }

  /** Whether any result is being held. */
  get active() {
    return this.#waiting.size > 0;
  }

  /** Whether this combatant's result is being held. */
  has(id) {
    return this.#waiting.has(id);
  }

  /** A roll was written to this combatant; its chat message should follow. */
  expect(id) {
    this.#add(id, MESSAGE);
    this.#life.clearTimeout(this.#timers.get(id));
    this.#timers.set(id, this.#life.timeout(() => this.#drop(id, MESSAGE), MESSAGE_WAIT_MS));
  }

  /** The roll's chat message arrived: hold until {@link finished} is called for it. */
  arrived(id, messageId) {
    this.#messages.set(messageId, id);
    this.#add(id, messageId);
    this.#life.clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.#drop(id, MESSAGE);
  }

  /** This message's dice have stopped, or the message is gone. */
  finished(messageId) {
    const id = this.#messages.get(messageId);
    if ( id === undefined ) return;
    this.#messages.delete(messageId);
    this.#drop(id, messageId);
  }

  #add(id, reason) {
    const reasons = this.#waiting.get(id);
    if ( reasons ) return void reasons.add(reason);
    this.#waiting.set(id, new Set([reason]));
    this.#onChange();
  }

  #drop(id, reason) {
    const reasons = this.#waiting.get(id);
    if ( !reasons?.delete(reason) || reasons.size ) return;
    this.#waiting.delete(id);
    this.#onChange();
  }
}
