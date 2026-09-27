/**
 * Configuration for the end-to-end harness — **copy this to `config.mjs` and edit the paths**.
 *
 * The harness drives a real Foundry install, so these paths are specific to one machine.
 * `config.mjs` is gitignored for that reason; this file is the tracked template.
 */

/** Where Foundry Virtual Tabletop itself is installed (the dir holding `main.mjs`). */
export const FOUNDRY_ROOT = "C:/foundryvtt";

/** Foundry's user data root (the dir holding `Data/`, `Config/`, `Logs/`). */
export const DATA_PATH = "C:/Users/<you>/AppData/Local/FoundryVTT";

/** Foundry's `Data/` dir, where worlds/modules/systems live. */
export const DATA_DIR = `${DATA_PATH}/Data`;

/** Port for the harness's own Foundry. Not 30000, so a Foundry the user already runs is left alone. */
export const PORT = 30098;

export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** The module under test, junction-linked into `Data/modules` by `npm run link-module`. */
export const MODULE_ID = "sogrom-simple-combat-bar";

/** The repo root, i.e. the junction target. */
export const MODULE_SOURCE = "C:/path/to/Simple-Combat-Bar";

/** The system the test worlds run, and the versions this harness was written against. */
export const SYSTEM = "dnd5e";
export const SYSTEM_VERSION = "6.0.5";
export const CORE_VERSION = "14.368";

/**
 * The test worlds. `id` doubles as the directory name under `Data/worlds`. Both use only the
 * dnd5e system's own SRD compendia, so they need no content modules.
 *
 * `playwright-combat`  the primary world: this module on, everything else off.
 * `playwright-ctd`     combat-tracker-dock on and this module off. The lifecycle and render-budget
 *                      suites run the same scenario here, so every report says how we compare.
 */
export const WORLDS = {
  "playwright-combat": {
    id: "playwright-combat",
    title: "Playwright-Combat",
    description: "<p>Automated harness for the Simple Combat Bar. Content is disposable.</p>",
    modules: [MODULE_ID],
    subject: "scb"
  },
  "playwright-ctd": {
    id: "playwright-ctd",
    title: "Playwright-CTD",
    description: "<p>Baseline world: combat-tracker-dock, for comparison with the Simple Combat Bar.</p>",
    modules: ["combat-tracker-dock"],
    subject: "ctd"
  }
};

/** The GM the harness plays as. Foundry auto-creates this on a world with no GM. */
export const GM_USER = "Gamemaster";

/** A player user the provisioner creates, owning the party. Used by the permissions suite. */
export const PLAYER_USER = "Player";

/** Set true to watch the browser drive Foundry. `HEADED=1 npm test` also flips it. */
export const HEADED = process.env.HEADED === "1";

/** How long to wait for the Foundry server to accept connections, and for `game.ready`. */
export const SERVER_TIMEOUT_MS = 120_000;
export const WORLD_READY_TIMEOUT_MS = 90_000;
