/**
 * The "Your Turn" / "Up Next" banner that drops below the bar for a moment.
 *
 * The holder is a live region that stays in the page, empty: a screen reader announces the card
 * when it's put in. Sound is core's job (the Combat Theme in the Combat Tracker's settings).
 */

import { CSS, t } from "../config.mjs";

/** How long a banner stays, in ms, by the `turnNotice` setting. */
const SHOWN_MS = { subtle: 2600, large: 3600 };

export class TurnNotice {

  /** @type {HTMLElement} */
  element;
  #life;
  #timer = null;

  /**
   * @param {import("../core/lifecycle.mjs").Lifecycle} life  The bar's session lifecycle.
   */
  constructor(life) {
    this.#life = life;
    const element = this.element = document.createElement("div");
    element.className = `${CSS}-notice`;
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    life.add(() => element.remove());
  }

  /**
   * @param {"yourTurn"|"upNext"} kind
   * @param {string[]} names           The user's combatants it's about.
   * @param {"subtle"|"large"} size
   */
  show(kind, names, size) {
    this.clear();
    const duration = SHOWN_MS[size] ?? SHOWN_MS.subtle;
    const card = document.createElement("div");
    card.className = `${CSS}-notice-card`;
    card.dataset.kind = kind;
    card.dataset.size = size;
    const title = document.createElement("span");
    title.className = `${CSS}-notice-title`;
    title.textContent = kind === "yourTurn" ? t("notice.yourTurn") : t("notice.upNext");
    const who = document.createElement("span");
    who.className = `${CSS}-notice-names`;
    who.textContent = game.i18n.getListFormatter().format(names);
    card.append(title, who);
    this.element.replaceChildren(card);
    if ( !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ) {
      card.animate([
        { opacity: 0, transform: "translateY(-10px)" },
        { opacity: 1, transform: "none", offset: 0.1 },
        { opacity: 1, transform: "none", offset: 0.85 },
        { opacity: 0, transform: "none" }
      ], { duration, easing: "ease-out" });
    }
    this.#timer = this.#life.timeout(() => {
      this.#timer = null;
      this.element.replaceChildren();
    }, duration);
  }

  /** Take the banner down now. */
  clear() {
    if ( this.#timer !== null ) this.#life.clearTimeout(this.#timer);
    this.#timer = null;
    this.element.replaceChildren();
  }
}
