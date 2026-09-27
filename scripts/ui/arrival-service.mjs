/**
 * Late arrivals in a live combat: schedule one, skip its turns until it's here, and reveal it.
 *
 * The decisions are pure (model/arrivals.mjs). Skipping happens twice over:
 *   - {@link skipBeforeUpdate} runs in core's combatStart / combatRound / combatTurn hooks, on the
 *     client moving the turn, and moves the update past an absent combatant before it's sent. The
 *     turn never lands on them, so nothing starts their turn.
 *   - {@link afterTurnChange} runs on the active GM after every turn change. It catches whatever
 *     moved the pointer without those hooks (a group turn handing on), and reveals a combatant
 *     whose turn has come in its arrival round.
 */

import { MODULE_ID, t } from "../config.mjs";
import { arrivalRound, isAway, isDue, normaliseArrival, skipAbsent } from "../model/arrivals.mjs";

const flagsOf = combatant => combatant?.flags?.[MODULE_ID] ?? {};

/**
 * Whether a combatant is scheduled to arrive and hasn't yet.
 * @param {Combatant} combatant
 */
export function isWaiting(combatant) {
  return arrivalRound(flagsOf(combatant)) !== null;
}

/** The combat's turns as the pure model wants them. */
function turnEntries(combat) {
  return combat.turns.map(c => ({ arrivesRound: arrivalRound(flagsOf(c)), defeated: c.isDefeated }));
}

/**
 * Before a turn change is sent: move it past anyone not here yet.
 * @param {Combat} combat
 * @param {{round: number, turn: number|null}} updateData  Core's pending update; changed in place.
 * @param {{direction?: 1|-1, worldTime?: {delta: number}}} [options]
 */
export function skipBeforeUpdate(combat, updateData, options = {}) {
  const next = skipAbsent({ turns: turnEntries(combat), round: updateData.round, turn: updateData.turn,
    direction: options.direction ?? 1, skipDefeated: !!combat.settings?.skipDefeated });
  if ( !next ) return;
  // Wrapping into the next round this way doesn't call core's combatRound hook; the round still
  // changes in the update, which is what the system and this module watch.
  if ( options.worldTime ) {
    options.worldTime.delta = combat.getTimeDelta(combat.round, combat.turn, next.round, next.turn);
  }
  Object.assign(updateData, next);
}

/**
 * After a turn change, on the active GM only: step off an absent combatant, or reveal one whose
 * turn has come.
 * @param {Combat} combat
 * @param {object} changes
 * @param {{direction?: 1|-1}} [options]
 */
export async function afterTurnChange(combat, changes, options = {}) {
  if ( !game.users.activeGM?.isSelf || !combat.started ) return;
  if ( !("turn" in changes) && !("round" in changes) ) return;
  const current = combat.combatant;
  if ( !current ) return;
  const flags = flagsOf(current);
  if ( isAway(flags, combat.round) ) {
    const direction = options.direction ?? 1;
    const next = skipAbsent({ turns: turnEntries(combat), round: combat.round, turn: combat.turn, direction,
      skipDefeated: !!combat.settings?.skipDefeated });
    if ( next ) await combat.update(next, { direction });
    return;
  }
  if ( isDue(flags, combat.round) ) await arrive(current, { announce: true });
}

/**
 * Put off a combatant's arrival until `round`. It's hidden from players until then.
 * @param {Combatant} combatant
 * @param {number} round
 */
export function scheduleArrival(combatant, round) {
  // A creature arrives into view. An event keeps the GM's own "hidden from players" choice.
  const flags = flagsOf(combatant);
  const hidden = flags.event ? (flags.arrival?.hidden ?? combatant.hidden) : false;
  return combatant.update({ hidden: true, [`flags.${MODULE_ID}.arrival`]: { round, hidden: !!hidden } });
}

/**
 * Bring a waiting combatant in now: shown to players, token and all (an event stays hidden if the
 * GM made it so), and its turns no longer skipped.
 * @param {Combatant} combatant
 * @param {{announce?: boolean}} [options]  Whisper the GMs that it has arrived.
 */
export async function arrive(combatant, { announce = false } = {}) {
  if ( !isWaiting(combatant) ) return;
  const hidden = !!flagsOf(combatant).arrival?.hidden;
  await combatant.update({ hidden, [`flags.${MODULE_ID}.arrival`]: null });
  if ( !hidden && combatant.token?.hidden ) await combatant.token.update({ hidden: false });
  if ( !announce ) return;
  await ChatMessage.create({
    content: `<p>${t("arrivals.arrived", { name: `<strong>${Handlebars.escapeExpression(combatant.name)}</strong>` })}</p>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: t("title") }
  });
}

/**
 * Ask the GM which round a combatant arrives in, and schedule it.
 * @param {Combatant} combatant
 */
export async function openArrivalDialog(combatant) {
  const combat = combatant?.combat;
  if ( !game.user.isGM || !combat ) return;
  const earliest = Math.max(combat.round, 1);
  const suggested = arrivalRound(flagsOf(combatant)) ?? (combat.started ? combat.round + 1 : 2);
  const content = `
    <div class="form-group">
      <label>${t("arrivals.fields.round")}</label>
      <div class="form-fields"><input type="number" name="round" min="${earliest}" step="1" value="${suggested}"
        required autofocus></div>
      <p class="hint">${t("arrivals.fields.roundHint")}</p>
    </div>`;
  const form = await foundry.applications.api.DialogV2.input({
    window: { title: t("arrivals.title", { name: combatant.name }), icon: "fa-solid fa-door-open" },
    position: { width: 400 },
    content,
    ok: { label: t("arrivals.schedule"), icon: "fa-solid fa-check" }
  });
  if ( !form ) return;
  const { round, error } = normaliseArrival(form.round, combat.round);
  if ( error || (round === null) ) {
    ui.notifications.error(t("arrivals.errors.round", { round: earliest }));
    return;
  }
  await scheduleArrival(combatant, round);
}
