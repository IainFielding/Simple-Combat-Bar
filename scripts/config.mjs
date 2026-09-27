/**
 * Module identity, public hook names, setting defaults and the settings snapshot.
 *
 * Render code never calls `game.settings.get` (spec R9): it reads the frozen snapshot returned by
 * {@link settings}, which is rebuilt only when one of our settings changes. With 15 settings and a
 * dozen portraits, the reference module made ~180 settings reads per render; this makes zero.
 */

export const MODULE_ID = "sogrom-simple-combat-bar";

/** CSS class prefix. Every rule in styles/ is scoped under `.scb-root`. */
export const CSS = "scb";

/**
 * Public hooks. Names are part of the API: renaming one is a breaking change for every module
 * that listens to it, so `test/api.test.mjs` asserts them literally.
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
  portraitSize: 72,
  overflow: "autofit",
  portraitStyle: "card",
  portraitImage: "actor",
  nameVisibility: "token",
  hpVisibility: "owner",
  damageFill: true,
  hpBar: true,
  secondaryResource: "",
  secondaryColor: "#5aa9e6",
  tooltipAttributes: [],
  hideEnemyInitiative: false,
  initiativeDialog: "players",
  hideUnseenFirstRound: false,
  hideDefeated: false,
  groupTeams: "off",
  trackEconomy: true,
  autoSpendEconomy: true,
  legendaryBadges: true,
  showEffects: true,
  effectDescriptions: "owner",
  sidebarOnCombat: "collapse",
  xpSummary: false,
  debug: false
});

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
