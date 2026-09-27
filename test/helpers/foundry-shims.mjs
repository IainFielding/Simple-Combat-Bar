/**
 * Minimal Foundry globals for running the module's logic under Node / jsdom.
 *
 * The model layer is pure and needs none of this; the shims exist so that importing a module
 * which *mentions* `game` or `Hooks` at call time doesn't throw, and so the tests that exercise
 * settings, i18n or hooks have something small and inspectable to work against.
 *
 * Tests override pieces as needed and call {@link installFoundryShims} in `beforeEach` to reset.
 */

import { DEFAULTS } from "../../scripts/config.mjs";

/** A tiny, faithful-enough Hooks: ids, on/off/callAll, and the `events` table leak tests read. */
export function createHooks() {
  const events = {};
  const ids = new Map();
  let next = 1;
  return {
    events,
    on(hook, fn) {
      const id = next++;
      (events[hook] ??= []).push({ hook, id, fn });
      ids.set(id, hook);
      return id;
    },
    off(hook, idOrFn) {
      const list = events[hook];
      if ( !list ) return;
      const index = list.findIndex(e => (e.id === idOrFn) || (e.fn === idOrFn));
      if ( index >= 0 ) {
        ids.delete(list[index].id);
        list.splice(index, 1);
      }
    },
    callAll(hook, ...args) {
      for ( const entry of [...(events[hook] ?? [])] ) entry.fn(...args);
      return true;
    },
    /** Total registered callbacks across all hooks. */
    count() {
      return Object.values(events).reduce((n, list) => n + list.length, 0);
    }
  };
}

/** Reset every shimmed global to a clean baseline. */
export function installFoundryShims() {
  globalThis.Hooks = createHooks();
  globalThis.game = {
    settings: {
      _values: { ...DEFAULTS },
      get(_module, key) {
        if ( !(key in this._values) ) throw new Error(`Setting ${key} is not registered`);
        return this._values[key];
      },
      set(_module, key, value) { this._values[key] = value; }
    },
    i18n: {
      lang: "en",
      localize: key => key,
      format: (key, data) => `${key}:${JSON.stringify(data ?? {})}`,
      has: () => true
    },
    user: { isGM: true },
    system: { id: "dnd5e" },
    modules: { get: () => null }
  };
  globalThis.CONFIG = {
    DND5E: {
      creatureTypes: {
        fiend: { label: "Fiend" },
        humanoid: { label: "Humanoid" }
      }
    },
    Combat: { initiative: { decimals: 2 } },
    Actor: { trackableAttributes: {} }
  };
  globalThis.CONST = { TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 } };
}

installFoundryShims();
