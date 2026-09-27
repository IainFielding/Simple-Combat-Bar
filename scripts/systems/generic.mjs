/**
 * Fallback adapter for systems without their own: reads HP from core's primary tracked
 * attribute (the token's bar1), which every system configures.
 */

import { resolveResource } from "../model/resources.mjs";

/** @type {import("./adapter.mjs").SystemAdapter} */
export const genericAdapter = {
  id: "generic",

  describe() {
    return null;
  },

  hp(actor) {
    const path = globalThis.CONFIG?.Actor?.trackableAttributes?.[actor?.type]?.bar?.[0]
      ?? globalThis.game?.system?.primaryTokenAttribute;
    if ( !path ) return null;
    const { value, max } = resolveResource(actor.system, path);
    return typeof value === "number" ? { value, max, temp: null } : null;
  },

  /** Without system knowledge, only "defeated" is reliable for a viewer who can't observe. */
  healthState(actor) {
    const defeated = globalThis.CONFIG?.specialStatusEffects?.DEFEATED ?? "dead";
    return actor?.statuses?.has(defeated) ? "down" : null;
  },

  defaultAttributes() {
    return [];
  },

  attributeLabel() {
    return null;
  },

  watchedPaths() {
    return null;
  }
};
