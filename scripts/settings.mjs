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
  register("groupTeams", { type: String, choices: choices("groupTeams", ["off", "visual", "bg3"]) });
  register("sidebarOnCombat", { type: String, choices: choices("sidebarOnCombat", ["collapse", "leave"]) });
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
  hidden("tooltipAttributes", Array, adapterFor(game.system.id).defaultAttributes?.() ?? []);

  // The Add Event dialog's recent events. Not shown in the settings window.
  game.settings.register(MODULE_ID, "recentEvents", { scope: "world", config: false, type: Array, default: [] });
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
    onDown: () => {
      getBar()?.combat?.previousTurn();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "endTurn", {
    name: `${MODULE_ID}.keybindings.endTurn`,
    editable: [{ key: "KeyM", modifiers: [SHIFT] }],
    onDown: () => {
      getBar()?.endTurn();
      return true;
    }
  });
}
