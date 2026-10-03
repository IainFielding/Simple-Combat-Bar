/**
 * Setting registration. Defaults live in config.mjs so tests can import them without Foundry.
 *
 * Every onChange drops the settings snapshot and asks the bar to re-derive; nothing here writes
 * to `document.documentElement.style` (spec R10).
 */

import { DEFAULTS, MODULE_ID, invalidateSettings } from "./config.mjs";
import { portraitStyleChoices } from "./ui/portrait-styles.mjs";
import { TrackersConfig } from "./ui/trackers-config.mjs";
import { adapterFor } from "./systems/adapter.mjs";

const k = key => `${MODULE_ID}.settings.${key}`;

/**
 * @param {() => import("./ui/combat-bar.mjs").CombatBar|null} getBar
 */
export function registerSettings(getBar) {
  const refresh = () => {
    invalidateSettings();
    getBar()?.refresh();
  };

  const register = (key, { scope = "world", type, choices, range, requiresReload = false, onChange = refresh } = {}) => {
    game.settings.register(MODULE_ID, key, {
      name: `${k(key)}.name`,
      hint: `${k(key)}.hint`,
      scope,
      config: true,
      type,
      choices,
      range,
      default: DEFAULTS[key],
      requiresReload,
      onChange
    });
  };

  const choices = (key, values) => Object.fromEntries(values.map(v => [v, `${k(key)}.choices.${v}`]));

  register("enabled", {
    scope: "user", type: Boolean,
    onChange: () => {
      invalidateSettings();
      getBar()?.sync();
    }
  });
  register("portraitStyle", { type: String, choices: portraitStyleChoices() });
  register("portraitSize", { scope: "user", type: Number, range: { min: 40, max: 128, step: 4 } });
  register("overflow", { scope: "user", type: String, choices: choices("overflow", ["autofit", "scroll"]) });
  register("portraitImage", { type: String, choices: choices("portraitImage", ["actor", "token"]) });
  register("nameVisibility", { type: String, choices: choices("nameVisibility", ["always", "token", "owner"]) });
  register("hpVisibility", { type: String, choices: choices("hpVisibility", ["all", "owner", "ownerOnly"]) });
  register("damageFill", { type: Boolean });
  register("hpBar", { type: Boolean });
  register("hideEnemyInitiative", { type: Boolean });
  register("initiativeDialog", { type: String, choices: choices("initiativeDialog", ["none", "npcs", "players", "all"]) });
  register("hideUnseenFirstRound", { type: Boolean });
  register("hideDefeated", { type: Boolean });
  register("trackEconomy", { type: Boolean });
  register("autoSpendEconomy", { type: Boolean });
  register("legendaryBadges", { type: Boolean });
  register("showEffects", { type: Boolean });
  register("effectDescriptions", { type: String, choices: choices("effectDescriptions", ["none", "owner", "all"]) });
  register("groupTeams", { type: String, choices: choices("groupTeams", ["off", "visual", "bg3"]) });
  register("sidebarOnCombat", { type: String, choices: choices("sidebarOnCombat", ["collapse", "leave"]) });
  register("xpSummary", { type: Boolean, onChange: invalidateSettings });
  register("debug", { scope: "user", type: Boolean });

  // Edited in the Configure Trackers window rather than the settings list.
  game.settings.registerMenu(MODULE_ID, "trackers", {
    name: `${k("trackers")}.name`,
    label: `${k("trackers")}.label`,
    hint: `${k("trackers")}.hint`,
    icon: "fa-solid fa-bars-progress",
    type: TrackersConfig,
    restricted: true
  });
  const hidden = (key, type, fallback) => game.settings.register(MODULE_ID, key, {
    scope: "world", config: false, type, default: fallback, onChange: refresh
  });
  hidden("secondaryResource", String, DEFAULTS.secondaryResource);
  hidden("secondaryColor", String, DEFAULTS.secondaryColor);

  // The Add Event dialog's recent events. Not shown in the settings window.
  game.settings.register(MODULE_ID, "recentEvents", { scope: "world", config: false, type: Array, default: [] });
}

/**
 * Settings whose default comes from the system adapter. Registered after `simpleCombatBar.init`,
 * where other modules register their adapters, so a system's own defaults are the ones used.
 * @param {() => import("./ui/combat-bar.mjs").CombatBar|null} getBar
 */
export function registerAdapterSettings(getBar) {
  game.settings.register(MODULE_ID, "tooltipAttributes", {
    scope: "world", config: false, type: Array,
    default: adapterFor(game.system.id).defaultAttributes?.() ?? [],
    onChange: () => {
      invalidateSettings();
      getBar()?.refresh();
    }
  });
}

/**
 * Keybindings. Registered at init, as core requires.
 * @param {() => import("./ui/combat-bar.mjs").CombatBar|null} getBar
 */
export function registerKeybindings(getBar) {
  const SHIFT = foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT;
  game.keybindings.register(MODULE_ID, "previousTurn", {
    name: `${MODULE_ID}.keybindings.previousTurn`,
    editable: [{ key: "KeyN", modifiers: [SHIFT] }],
    restricted: true,
    // Only claim the key when there's a turn to step back, so other modules' bindings still get it.
    onDown: () => {
      const combat = getBar()?.combat;
      if ( !combat?.started ) return false;
      combat.previousTurn();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "endTurn", {
    name: `${MODULE_ID}.keybindings.endTurn`,
    editable: [{ key: "KeyM", modifiers: [SHIFT] }],
    onDown: () => {
      const bar = getBar();
      if ( !bar?.canEndTurn ) return false;
      bar.endTurn();
      return true;
    }
  });
  // Flips the per-user "Show the Combat Bar" setting. Unbound by default, to stay clear of other modules.
  game.keybindings.register(MODULE_ID, "toggleBar", {
    name: `${MODULE_ID}.keybindings.toggleBar`,
    editable: [],
    onDown: () => {
      game.settings.set(MODULE_ID, "enabled", !game.settings.get(MODULE_ID, "enabled"));
      return true;
    }
  });
}
