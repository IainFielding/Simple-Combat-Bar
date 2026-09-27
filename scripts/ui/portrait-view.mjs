/**
 * One portrait's DOM. Created once per combatant per style, then patched.
 *
 * No listeners are attached here (spec R3): the bar delegates every event from its root. A patch
 * touches only the fields that changed since the last model, and never re-parses HTML.
 */

import { changedFields } from "../model/portrait-model.mjs";

/** Model fields that map straight onto a CSS class on the portrait. */
const CLASS_FIELDS = Object.freeze({
  current: "is-current",
  acted: "is-acted",
  hidden: "is-hidden",
  defeated: "is-defeated",
  pc: "is-pc",
  owner: "is-owner",
  isEvent: "is-event",
  canRoll: "can-roll"
});

export class PortraitView {

  /** @type {HTMLLIElement} */
  element;
  /** The last model applied. */
  model = null;
  /** @type {Record<string, HTMLElement>} */
  #slots = {};

  /**
   * @param {string} id                                   Combatant id.
   * @param {{template: HTMLTemplateElement}} style
   */
  constructor(id, style) {
    const li = document.createElement("li");
    li.className = "scb-portrait";
    li.dataset.combatantId = id;
    li.tabIndex = 0;
    li.append(style.template.content.cloneNode(true));
    this.element = li;
    for ( const el of li.querySelectorAll("[data-slot]") ) this.#slots[el.dataset.slot] = el;
  }

  /**
   * Apply a model. Returns the list of fields that changed (empty if nothing did).
   * @param {object} model
   * @param {{runPosition?: "first"|"middle"|"last"|null}} [layout]
   * @returns {string[]}
   */
  patch(model, { runPosition = null } = {}) {
    const changed = changedFields(this.model, model);
    const el = this.element;
    if ( el.dataset.runPosition !== (runPosition ?? "") ) {
      if ( runPosition ) el.dataset.runPosition = runPosition;
      else delete el.dataset.runPosition;
    }
    if ( !changed.length ) return changed;

    for ( const field of changed ) {
      if ( field in CLASS_FIELDS ) {
        el.classList.toggle(CLASS_FIELDS[field], !!model[field]);
        continue;
      }
      switch ( field ) {
        case "img":
          if ( this.#slots.img ) this.#slots.img.src = model.img || "icons/svg/mystery-man.svg";
          break;
        case "name":
          if ( this.#slots.name ) this.#slots.name.textContent = model.name;
          el.setAttribute("aria-label", model.name);
          break;
        case "side":
          el.dataset.side = model.side;
          break;
        case "run":
          if ( model.run ) el.dataset.run = model.run;
          else delete el.dataset.run;
          break;
        case "initiative":
          if ( this.#slots.initiative ) this.#slots.initiative.textContent = model.initiative ?? "";
          el.classList.toggle("has-initiative", model.initiative !== null);
          break;
        case "eventRoundsLeft":
          if ( this.#slots.rounds ) this.#slots.rounds.textContent = model.eventRoundsLeft ?? "";
          el.classList.toggle("has-rounds", model.eventRoundsLeft !== null);
          break;
        case "hpState":
          el.dataset.hp = model.hpState;
          break;
      }
    }
    if ( changed.some(f => f.startsWith("hp") || (f === "damagePct")) ) this.#patchHP(model);
    this.model = model;
    return changed;
  }

  #patchHP(model) {
    const damage = this.#slots.damage;
    if ( damage ) {
      damage.hidden = model.damagePct === null;
      damage.style.setProperty("--scb-damage-pct", `${model.damagePct ?? 0}%`);
    }
    const bar = this.#slots.hp;
    if ( !bar ) return;
    // A class, not `hidden`: core's `[hidden] { display: none !important }` would collapse the
    // bar's space and drop the card out of line with its neighbours.
    bar.classList.toggle("is-empty", !model.hpBar);
    bar.style.setProperty("--scb-hp-pct", `${model.hpPct ?? 0}%`);
    const tempPct = model.hpTemp && model.hpMax ? Math.min(100, Math.round((model.hpTemp / model.hpMax) * 100)) : 0;
    bar.style.setProperty("--scb-hp-temp-pct", `${tempPct}%`);
  }

  /** Remove from the DOM. The bar drops its reference, so this is all the cleanup there is. */
  destroy() {
    this.element.remove();
  }
}
