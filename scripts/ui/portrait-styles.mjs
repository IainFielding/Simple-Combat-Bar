/**
 * Portrait style registry (spec §5.2).
 *
 * A style decides markup and CSS only. The model is style-agnostic, and every style exposes the
 * same named slots, so {@link PortraitView} patches any of them the same way. A style's CSS
 * lives in `styles/portrait/<id>.css`, scoped under `.scb-root[data-style="<id>"]`.
 *
 * Slots a style must contain (each marked with `data-slot`):
 *   img, initiative, hp, name, damage (and, from the shared flags, rounds)
 * Buttons it may contain (each marked with `data-action`): rollInitiative.
 */

const SHARED_FLAGS = `
  <span class="scb-rounds" aria-hidden="true"><i class="fa-solid fa-hourglass-half"></i><span data-slot="rounds"></span></span>
  <span class="scb-flag scb-flag-hidden" aria-hidden="true"><i class="fa-solid fa-eye-slash"></i></span>
  <span class="scb-flag scb-flag-defeated" aria-hidden="true"><i class="fa-solid fa-skull"></i></span>`;

/** Red overlay rising from the top of the portrait as HP is lost (the `damageFill` setting). */
const DAMAGE_FILL = `<div class="scb-damage" data-slot="damage" aria-hidden="true"></div>`;

const ROLL_BUTTON = `
  <button type="button" class="scb-roll" data-action="rollInitiative" tabindex="-1">
    <i class="fa-solid fa-dice-d20"></i>
  </button>`;

/**
 * @typedef {object} PortraitStyle
 * @property {string} id
 * @property {string} label     i18n key.
 * @property {number} aspect    Height ÷ width, used by autofit.
 * @property {string} markup    Inner HTML of the portrait `<li>`.
 */

/** @type {Map<string, PortraitStyle>} */
const styles = new Map();

/**
 * Register a portrait style. Other modules call this through the API.
 * @param {PortraitStyle} style
 */
export function registerPortraitStyle(style) {
  if ( !style?.id || !style.markup ) throw new Error("A portrait style needs an id and markup.");
  styles.set(style.id, { aspect: 1, ...style, template: null });
}

/**
 * The style with this id, falling back to the card (the default).
 * @param {string} id
 * @returns {PortraitStyle & {template: HTMLTemplateElement}}
 */
export function portraitStyle(id) {
  const style = styles.get(id) ?? styles.get("card");
  // Parsed once per style per session; each portrait is a cheap clone of it.
  if ( !style.template && (typeof document !== "undefined") ) {
    style.template = document.createElement("template");
    style.template.innerHTML = style.markup.trim();
  }
  return style;
}

/** Every registered style, for the settings choices. */
export function portraitStyleChoices() {
  return Object.fromEntries(Array.from(styles.values(), s => [s.id, s.label]));
}

registerPortraitStyle({
  id: "medallion",
  label: "sogrom-simple-combat-bar.styles.medallion",
  aspect: 1,
  markup: `
    <div class="scb-frame">
      <img class="scb-img" data-slot="img" alt="" draggable="false">
      ${DAMAGE_FILL}
      ${SHARED_FLAGS}
    </div>
    <span class="scb-init" data-slot="initiative"></span>
    ${ROLL_BUTTON}
    <div class="scb-hp" data-slot="hp"><div class="scb-hp-fill"></div><div class="scb-hp-temp"></div></div>
    <span class="scb-name" data-slot="name"></span>`
});

registerPortraitStyle({
  id: "card",
  label: "sogrom-simple-combat-bar.styles.card",
  aspect: 1.5,
  markup: `
    <div class="scb-frame">
      <img class="scb-img" data-slot="img" alt="" draggable="false">
      ${DAMAGE_FILL}
      ${SHARED_FLAGS}
      <span class="scb-init" data-slot="initiative"></span>
      ${ROLL_BUTTON}
      <span class="scb-name" data-slot="name"></span>
    </div>
    <div class="scb-hp" data-slot="hp"><div class="scb-hp-fill"></div><div class="scb-hp-temp"></div></div>`
});
