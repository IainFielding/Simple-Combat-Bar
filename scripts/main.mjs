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
import { registerAdapter } from "./systems/adapter.mjs";

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
  Hooks.on("updateCombat", (combat, changes) => {
    if ( ("active" in changes) || ("scene" in changes) || ("started" in changes) || ("round" in changes) ) sync();
  });
  Hooks.on("canvasReady", sync);
  Hooks.on("renderCombatTracker", () => {
    // The sidebar's viewed combat can change without any combat document changing (the encounter
    // arrows). Only re-sync when it actually differs; this hook fires on every tracker render.
    const viewed = ui.combat?.viewed ?? null;
    if ( viewed !== bar.combat ) sync();
  });
  Hooks.on("combatStart", () => {
    if ( settings().sidebarOnCombat === "collapse" ) ui.sidebar?.collapse();
  });

  sync();
  Hooks.callAll(HOOKS.ready, api);
});

/**
 * combat-tracker-dock draws the same bar in the same place. The manifest declares the conflict,
 * but Foundry still lets a GM enable both, so check and stand down with one notice.
 */
function conflictActive() {
  if ( !game.modules.get("combat-tracker-dock")?.active ) return false;
  if ( game.user.isGM ) ui.notifications.warn(t("conflict.ctd"), { permanent: true });
  return true;
}
