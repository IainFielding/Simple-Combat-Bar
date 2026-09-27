/**
 * dnd5e 6.x adapter.
 */

/** Actor `system` keys that affect a portrait. An update touching none of these is ignored. */
const WATCHED = new Set(["attributes", "details", "resources"]);

/**
 * Format a challenge rating the way the stat block does: 0.125 → "1/8".
 * @param {number|null} cr
 * @returns {string|null}
 */
export function formatCR(cr) {
  if ( (cr === null) || (cr === undefined) || Number.isNaN(Number(cr)) ) return null;
  const n = Number(cr);
  if ( (n >= 1) || (n <= 0) ) return String(n);
  return `1/${Math.round(1 / n)}`;
}

/** @type {import("./adapter.mjs").SystemAdapter} */
export const dnd5eAdapter = {
  id: "dnd5e",

  describe(actor) {
    const system = actor?.system;
    if ( !system ) return null;
    if ( actor.type === "npc" ) {
      const typeKey = system.details?.type?.value;
      const typeLabel = CONFIG.DND5E?.creatureTypes?.[typeKey]?.label;
      const type = typeLabel ? game.i18n.localize(typeLabel) : (system.details?.type?.custom || "");
      const cr = formatCR(system.details?.cr);
      return [cr !== null ? `CR ${cr}` : null, type].filter(Boolean).join(" ") || null;
    }
    if ( actor.type === "character" ) {
      const classes = Object.values(actor.classes ?? {}).map(c => c.name).join(" / ");
      const species = system.details?.race?.name ?? null;
      const level = system.details?.level;
      const parts = [level ? game.i18n.format("DND5E.LevelNumber", { level }) : null, classes].filter(Boolean);
      return `${parts.join(" ")}${species ? ` (${species})` : ""}` || null;
    }
    return null;
  },

  hp(actor) {
    const hp = actor?.system?.attributes?.hp;
    if ( !hp || (typeof hp.value !== "number") ) return null;
    const max = hp.effectiveMax ?? hp.max;
    return { value: hp.value, max: typeof max === "number" ? max : null, temp: hp.temp || null };
  },

  /**
   * Health for a viewer who can't observe the actor. Foundry doesn't send an unlinked token's
   * system data to such users (its delta arrives with `system` emptied), so any HP they could read
   * is the *base* actor's, usually full. dnd5e's statuses do arrive, and it applies Bloodied itself.
   */
  healthState(actor) {
    const statuses = actor?.statuses;
    if ( !statuses ) return null;
    if ( statuses.has(CONFIG.specialStatusEffects?.DEFEATED ?? "dead") || statuses.has("dead") ) return "down";
    if ( statuses.has("bloodied") ) return "bloodied";
    return "healthy";
  },

  /**
   * dnd5e's own initiative dialog, as `Actor5e#rollInitiativeDialog` builds it. That method then
   * rolls through the actor's *canvas tokens*; the bar rolls through the combat instead, so it only
   * borrows the dialog half. dnd5e's `Combatant5e#getInitiativeRoll` asks the actor, which returns
   * the roll cached here (spec R12 exception: `Actor5e#_cachedInitiativeRoll`).
   */
  async configureInitiative(actor, event) {
    const rollConfig = actor.getInitiativeRollConfig?.({ event });
    if ( !rollConfig ) return false;
    if ( rollConfig.options?.fixed !== undefined ) return true;
    const config = { evaluate: false, event, hookNames: ["initiativeDialog", "abilityCheck", "d20Test"],
      rolls: [rollConfig], subject: actor };
    const rolls = await CONFIG.Dice.D20Roll.build(config,
      { options: { title: game.i18n.localize("DND5E.InitiativeRoll") } },
      { rollMode: CONFIG.Dice.BasicRoll.getMessageMode?.() });
    if ( !rolls?.length ) return false;
    actor._cachedInitiativeRoll = rolls[0];
    return true;
  },

  clearInitiative(actor) {
    delete actor._cachedInitiativeRoll;
  },

  /**
   * A readable name for an attribute path, from dnd5e's own helper (the one its token config uses).
   * A bar's parent path ("resources.legact") is tried as its ".value" too.
   */
  attributeLabel(path) {
    const helper = globalThis.dnd5e?.utils?.getHumanReadableAttributeLabel;
    if ( !helper || !path ) return null;
    const label = helper(path) ?? helper(`${path}.value`);
    return label ? game.i18n.localize(label) : null;
  },

  /** Tooltip values a new world starts with. Labels are dnd5e's own i18n keys. */
  defaultAttributes() {
    return [
      { attr: "attributes.ac.value", label: "DND5E.ArmorClass", icon: "fa-solid fa-shield-halved" },
      { attr: "attributes.movement.walk", label: "DND5E.Speed", icon: "fa-solid fa-person-running" },
      { attr: "attributes.spell.dc", label: "DND5E.SpellDC", icon: "fa-solid fa-wand-sparkles" },
      { attr: "skills.prc.passive", label: "DND5E.PassivePerception", icon: "fa-solid fa-eye" }
    ];
  },

  watchedPaths() {
    return WATCHED;
  }
};
