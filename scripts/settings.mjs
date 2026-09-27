/**
 * Setting registration. Defaults live in config.mjs so tests can import them without Foundry.
 *
 * Every onChange drops the settings snapshot and asks the bar to re-derive; nothing here writes
 * to `document.documentElement.style` (spec R10).
 */

import { DEFAULTS, MODULE_ID, invalidateSettings } from "./config.mjs";
import { portraitStyleChoices } from "./ui/portrait-styles.mjs";

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
  register("hideEnemyInitiative", { type: Boolean });
  register("hideUnseenFirstRound", { type: Boolean });
  register("hideDefeated", { type: Boolean });
  register("groupTeams", { type: String, choices: choices("groupTeams", ["off", "visual", "bg3"]) });
  register("sidebarOnCombat", { type: String, choices: choices("sidebarOnCombat", ["collapse", "leave"]) });
  register("debug", { scope: "user", type: Boolean });
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
