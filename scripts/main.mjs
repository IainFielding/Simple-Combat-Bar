/**
 * Simple Combat Bar — entry point.
 *
 * Wires Foundry's lifecycle to one long-lived {@link CombatBar} (spec R1). The session-level hooks
 * registered here only ever call `bar.sync()`, which decides what the bar should be bound to.
 */

import { HOOKS, MODULE_ID, invalidateSettings, settings, t } from "./config.mjs";
import { registerKeybindings, registerSettings } from "./settings.mjs";
import { CombatBar } from "./ui/combat-bar.mjs";
import { registerPortraitStyle } from "./ui/portrait-styles.mjs";
import { adapterFor, registerAdapter } from "./systems/adapter.mjs";
import { expiredEvents } from "./model/events.mjs";
import { activationSlot, anySpent, emptyEconomy } from "./model/economy.mjs";
import { economyProvider, spendSlot } from "./systems/economy.mjs";
import { groupContext, registerGroupQuery } from "./ui/group-service.mjs";
import { afterTurnChange, skipBeforeUpdate } from "./ui/arrival-service.mjs";
import { restoresEconomy } from "./model/group-turns.mjs";
import { tallyDefeated } from "./model/xp-award.mjs";
import { DISPOSITIONS } from "./model/visibility.mjs";

/** The session's bar. Null until `ready`, and stays null if the bar mustn't mount. */
let bar = null;

const api = {
  get bar() { return bar; },
  get stats() { return bar?.stats ?? null; },
  registerAdapter,
  registerPortraitStyle,
  refresh: () => bar?.refresh(),
  HOOKS
};

Hooks.once("init", () => {
  registerSettings(() => bar);
  registerKeybindings(() => bar);
  registerGroupQuery();
  game.modules.get(MODULE_ID).api = api;
  Hooks.callAll(HOOKS.init, api);
});

Hooks.once("ready", () => {
  invalidateSettings();
  if ( conflictActive() ) return;
  bar = new CombatBar();
  const sync = () => (settings().enabled ? bar.sync() : bar.bind(null));

  Hooks.on("createCombat", sync);
  Hooks.on("deleteCombat", sync);
  Hooks.on("deleteCombat", postXPSummary);
  // Late arrivals: move a turn change past anyone not here yet, before it's sent.
  Hooks.on("combatStart", (combat, updateData) => skipBeforeUpdate(combat, updateData));
  Hooks.on("combatRound", skipBeforeUpdate);
  Hooks.on("combatTurn", skipBeforeUpdate);
  Hooks.on("updateCombat", (combat, changes, options) => {
    if ( ("active" in changes) || ("scene" in changes) || ("started" in changes) || ("round" in changes) ) sync();
    if ( "round" in changes ) expireEvents(combat);
    afterTurnChange(combat, changes, options);
  });
  Hooks.on("canvasReady", sync);
  Hooks.on("renderCombatTracker", () => {
    // The sidebar's viewed combat can change without any combat document changing (the encounter
    // arrows). Only re-sync when it actually differs; this hook fires on every tracker render.
    const viewed = ui.combat?.viewed ?? null;
    if ( viewed !== bar.combat ) sync();
  });
  // Action economy: spend on use (on the client that used it, which owns the combatant), and
  // restore at the start of each combatant's turn (on the active GM's client only). Core fires
  // combatTurnChange for the first turn too, once the start has been saved.
  Hooks.on("dnd5e.postUseActivity", activity => spendForActivity(activity));
  Hooks.on("combatTurnChange", (combat, _previous, current) => resetEconomy(combat, current?.combatantId));

  Hooks.on("combatStart", () => {
    if ( settings().sidebarOnCombat === "collapse" ) ui.sidebar?.collapse();
  });

  sync();
  Hooks.callAll(HOOKS.ready, api);
});

/**
 * Spend the slot a used activity costs, for its actor's combatant in the bar's combat.
 * @param {Activity} activity
 */
async function spendForActivity(activity) {
  const cfg = settings();
  const provider = economyProvider();
  if ( !cfg.trackEconomy || !cfg.autoSpendEconomy || provider.spendsItself ) return;
  const slot = activationSlot(activity?.activation?.type);
  const combat = bar?.combat;
  if ( !slot || !combat?.started ) return;
  const actor = activity.actor;
  const combatant = combat.combatants.find(c => c.actor === actor);
  if ( !combatant?.isOwner ) return;
  await spendSlot(combatant, slot);
}

/**
 * Restore a combatant's action economy as their turn begins.
 * @param {Combat} combat
 * @param {string} combatantId
 */
async function resetEconomy(combat, combatantId) {
  if ( !game.users.activeGM?.isSelf || !settings().trackEconomy ) return;
  const provider = economyProvider();
  if ( provider.resetsItself ) return;
  const combatant = combat.combatants.get(combatantId);
  if ( !combatant ) return;
  // In a group turn, only the first time this member starts: stepping away and back to them
  // mustn't hand them a fresh set of actions.
  const group = groupContext(combat);
  if ( group ) {
    if ( !restoresEconomy(group.state, combatantId) ) return;
    await combat.setFlag(MODULE_ID, "groupTurn", { ...group.state, started: [...group.state.started, combatantId] });
  }
  const state = provider.read(combatant);
  if ( state && anySpent(state) ) await provider.write(combatant, emptyEconomy());
}

/**
 * Remove events whose duration has run out, and tell the GMs. Only the active GM does this, so a
 * table of five players doesn't try it five times (the reference module ran it on every client).
 * @param {Combat} combat
 */
async function expireEvents(combat) {
  if ( !game.users.activeGM?.isSelf ) return;
  const events = combat.combatants.filter(c => c.flags?.[MODULE_ID]?.event)
    .map(c => ({ id: c.id, name: c.name, flags: c.flags[MODULE_ID] }));
  const ids = expiredEvents(events, combat.round);
  if ( !ids.length ) return;
  const names = events.filter(e => ids.includes(e.id)).map(e => e.name);
  await combat.deleteEmbeddedDocuments("Combatant", ids);
  const list = game.i18n.getListFormatter().format(names.map(n => `<strong>${Handlebars.escapeExpression(n)}</strong>`));
  await ChatMessage.create({
    content: `<p>${t("events.expired", { names: list })}</p>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: t("title") }
  });
}

/**
 * When a combat ends, whisper the GMs the defeated enemies and their XP, with the system's award
 * button. Only the active GM posts it, and only for a combat that was actually started.
 * @param {Combat} combat
 */
async function postXPSummary(combat) {
  if ( !settings().xpSummary || !game.users.activeGM?.isSelf || !combat.started ) return;
  const adapter = adapterFor(game.system.id);
  if ( !adapter.xp ) return;
  // Enemies only: not events, the players' own creatures, or friendly NPCs who fell on their side.
  const defeated = combat.combatants
    .filter(c => c.isDefeated && c.actor && !c.flags?.[MODULE_ID]?.event && !c.actor.hasPlayerOwner
      && (c.token?.disposition !== DISPOSITIONS.FRIENDLY))
    .map(c => ({ name: c.name, xp: adapter.xp(c.actor) }));
  const { lines, total } = tallyDefeated(defeated);
  if ( !lines.length ) return;
  const esc = Handlebars.escapeExpression;
  const num = n => n.toLocaleString(game.i18n.lang);
  const items = lines.map(l => `<li>${t("xp.line", { count: l.count, name: `<strong>${esc(l.name)}</strong>` })}
    <span class="hint">(${t("xp.each", { xp: num(l.xp) })})</span></li>`);
  const award = (total > 0) && adapter.awardCommand ? `<p>${adapter.awardCommand(total)}</p>` : "";
  await ChatMessage.create({
    content: `<h3>${t("xp.heading")}</h3><ul>${items.join("")}</ul>
      <p><strong>${t("xp.total", { xp: num(total) })}</strong></p>${award}`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: { alias: t("title") }
  });
}

/**
 * combat-tracker-dock draws the same bar in the same place. The manifest declares the conflict,
 * but Foundry still lets a GM enable both, so check and stand down with one notice.
 */
function conflictActive() {
  if ( !game.modules.get("combat-tracker-dock")?.active ) return false;
  if ( game.user.isGM ) ui.notifications.warn(t("conflict.ctd"), { permanent: true });
  return true;
}
