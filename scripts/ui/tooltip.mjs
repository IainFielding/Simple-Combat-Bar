/**
 * Portrait tooltip, built on demand (spec R7).
 *
 * The reference module rendered a full tooltip template into a `data-tooltip` attribute on every
 * portrait render, whether or not anyone ever hovered. Here the tooltip is built from the
 * portrait's current model at the moment it opens, and thrown away when it closes.
 */

import { t } from "../config.mjs";

/**
 * @param {object} model   A portrait model (model/portrait-model.mjs).
 * @param {Array<{label: string, icon: string, text: string}>} [attributes]  Tooltip values, read at
 *   hover time (model/trackers.mjs#readAttributes); empty for viewers who don't receive the data.
 * @returns {HTMLElement}
 */
export function buildTooltip(model, attributes = []) {
  const root = el("div", "scb-tooltip-body");

  const header = el("header", "scb-tt-header");
  header.append(el("h3", "scb-tt-name", model.name));
  if ( model.initiative !== null ) {
    const init = el("span", "scb-tt-init");
    init.append(el("i", "fa-solid fa-dice-d20"), document.createTextNode(` ${model.initiative}`));
    header.append(init);
  }
  root.append(header);

  if ( model.description ) root.append(el("p", "scb-tt-desc", model.description));

  if ( model.hpValue !== null ) {
    const temp = model.hpTemp ? ` (+${model.hpTemp})` : "";
    root.append(row("fa-solid fa-heart", `${model.hpValue} / ${model.hpMax}${temp}`, t("tooltip.hp")));
  } else if ( model.hpShown && (model.hpState !== "unknown") ) {
    root.append(row("fa-solid fa-heart-pulse", t(`health.${model.hpState}`)));
  }

  if ( model.secPct !== null ) {
    root.append(row("fa-solid fa-bars-progress", `${model.secValue} / ${model.secMax}`, t("tooltip.secondary")));
  }

  if ( model.legActValue !== null ) {
    root.append(row("fa-solid fa-bolt", `${model.legActValue} / ${model.legActMax}`, t("legendary.actions")));
  }
  if ( model.legResValue !== null ) {
    root.append(row("fa-solid fa-shield-halved", `${model.legResValue} / ${model.legResMax}`, t("legendary.resistances")));
  }

  if ( attributes.length ) {
    const list = el("div", "scb-tt-attributes");
    for ( const a of attributes ) list.append(row(a.icon, a.text, a.label));
    root.append(list);
  }

  if ( model.isEvent && (model.eventRoundsLeft !== null) ) {
    root.append(row("fa-solid fa-hourglass-half", t("tooltip.roundsLeft", { rounds: model.eventRoundsLeft })));
  }
  if ( model.canTakeTurn ) root.append(row("fa-solid fa-hand-pointer", t("groupTurns.takeTurn")));
  else if ( model.ended ) root.append(row("fa-solid fa-check", t("groupTurns.ended")));
  if ( model.defeated ) root.append(row("fa-solid fa-skull", game.i18n.localize("COMBATANT.FIELDS.defeated.label")));
  return root;
}

function row(icon, text, label) {
  const li = el("div", "scb-tt-row");
  li.append(el("i", icon));
  if ( label ) li.append(el("span", "scb-tt-label", label));
  li.append(el("span", "scb-tt-value", text));
  return li;
}

/** Create an element; text goes through textContent, so names can't inject markup. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if ( className ) node.className = className;
  if ( text !== undefined ) node.textContent = text;
  return node;
}
