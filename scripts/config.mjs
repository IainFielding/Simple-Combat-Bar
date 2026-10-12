/**
 * Module identity, public hook names, setting defaults and the settings snapshot.
 *
 * Render code never calls `game.settings.get` (spec R9): it reads the frozen snapshot returned by
 * {@link settings}, which is rebuilt only when one of our settings changes. With 15 settings and a
 * dozen portraits, reading each where it's used would be ~180 settings reads per render; this makes
 * zero.
 */

export const MODULE_ID = "sogrom-simple-combat-bar";

/** CSS class prefix. Every rule in styles/ is scoped under `.scb-root`. */
export const CSS = "scb";

/**
 * Public hooks. Names are part of the API: renaming one is a breaking change for every module
 * that listens to it, so `test/house.test.mjs` asserts them literally.
 */
export const HOOKS = Object.freeze({
  init: "simpleCombatBar.init",
  ready: "simpleCombatBar.ready",
  bind: "simpleCombatBar.bind",
  unbind: "simpleCombatBar.unbind",
  renderPortrait: "simpleCombatBar.renderPortrait"
});

/**
 * Setting defaults, keyed by setting name. `scope` and `choices` live in settings.mjs; this is
 * the plain data, importable by unit tests without a Foundry page.
 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  portraitSize: 100,
  overflow: "scroll",
  compactControls: false,
  portraitStyle: "card",
  portraitImage: "actor",
  nameVisibility: "always",
  hpVisibility: "owner",
  damageFill: true,
  hpBar: false,
  secondaryResource: "",
  secondaryColor: "#5aa9e6",
  tooltipAttributes: [],
  hideEnemyInitiative: true,
  hideInitiative: false,
  initiativeDialog: "players",
  hideUnseenFirstRound: false,
  hideDefeated: false,
  groupTeams: "off",
  trackEconomy: true,
  autoSpendEconomy: true,
  legendaryBadges: true,
  showEffects: true,
  effectDescriptions: "owner",
  sidebarOnCombat: "chat",
  combatPlaylist: "",
  xpSummary: false,
  turnNotice: "subtle",
  upNextNotice: true,
  panOnMyTurn: false,
  targetsOnTurnEnd: "keep",
  autoSelectCurrent: false,
  debug: false
});

/**
 * The settings submenus, in the order their buttons are listed, and the settings each one holds.
 * A setting named here is edited in its group's window (ui/settings-group.mjs) instead of the
 * settings list; any other stays in the list. `requires` names the setting a row depends on: the
 * row is disabled while that one is off. `gmOnly` rows are left out of a player's window.
 */
export const SETTING_GROUPS = Object.freeze({
  look: {
    icon: "fa-solid fa-palette",
    restricted: true,
    keys: ["portraitStyle", "portraitImage", "damageFill", "hpBar", "showEffects", "legendaryBadges"]
  },
  players: {
    icon: "fa-solid fa-eye",
    restricted: true,
    keys: ["nameVisibility", "hpVisibility", "hideEnemyInitiative", "hideInitiative", "hideUnseenFirstRound",
      "hideDefeated", "effectDescriptions"]
  },
  turns: {
    icon: "fa-solid fa-dice-d20",
    restricted: true,
    keys: ["initiativeDialog", "groupTeams", "trackEconomy", "autoSpendEconomy"],
    requires: { autoSpendEconomy: "trackEconomy" }
  },
  combat: {
    icon: "fa-solid fa-flag-checkered",
    restricted: true,
    keys: ["sidebarOnCombat", "combatPlaylist", "xpSummary"]
  },
  // Each player's own: the one window that isn't the GM's alone.
  myTurn: {
    icon: "fa-solid fa-bell",
    restricted: false,
    keys: ["turnNotice", "upNextNotice", "panOnMyTurn", "targetsOnTurnEnd", "autoSelectCurrent"],
    gmOnly: ["autoSelectCurrent"]
  }
});

/**
 * The submenu a setting is edited in, or null if it sits in the settings list.
 * @param {string} key
 * @returns {string|null}
 */
export function settingGroupOf(key) {
  for ( const [id, group] of Object.entries(SETTING_GROUPS) ) if ( group.keys.includes(key) ) return id;
  return null;
}

let snapshot = null;

/**
 * The current settings, frozen. Cheap to call; rebuilt lazily after {@link invalidateSettings}.
 * Falls back to {@link DEFAULTS} for any setting not (yet) registered, so a unit test or an
 * early hook never throws on a missing key.
 * @returns {Readonly<typeof DEFAULTS>}
 */
export function settings() {
  if ( snapshot ) return snapshot;
  const values = {};
  for ( const [key, fallback] of Object.entries(DEFAULTS) ) {
    let value;
    try { value = game.settings.get(MODULE_ID, key); } catch { value = undefined; }
    values[key] = value ?? fallback;
  }
  return (snapshot = Object.freeze(values));
}

/** Drop the snapshot; the next {@link settings} call re-reads. Called from every onChange. */
export function invalidateSettings() {
  snapshot = null;
}

/** Localise a key under this module's namespace. */
export function t(key, data) {
  const full = `${MODULE_ID}.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Debug-only console output. Silent unless the `debug` setting is on. */
export function log(...args) {
  if ( settings().debug ) console.debug(`${MODULE_ID} |`, ...args);
}
