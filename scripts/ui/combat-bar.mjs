/**
 * The combat bar controller (spec §4).
 *
 * Exactly one instance exists per session (R1). It owns a root element that is built once and
 * kept, and it *binds* to whichever combat is being viewed. Everything tied to a particular combat
 * (document hooks, pending renders) lives in a per-bind {@link Lifecycle} that `unbind()` disposes.
 * Everything tied to the bar itself (delegated DOM listeners, the context menu, the resize
 * observer) lives in the session Lifecycle and is released only by `destroy()`.
 */

import { CSS, HOOKS, MODULE_ID, log, settings, t } from "../config.mjs";
import { Lifecycle } from "../core/lifecycle.mjs";
import { RenderScheduler } from "../core/scheduler.mjs";
import { applyOrder } from "../core/reconcile.mjs";
import { buildOrder } from "../model/turn-order.mjs";
import { buildPortraitModel } from "../model/portrait-model.mjs";
import { isShown, sideOf } from "../model/visibility.mjs";
import { wantsInitiativeDialog } from "../model/initiative.mjs";
import { adapterFor } from "../systems/adapter.mjs";
import { combatantFacts } from "./facts.mjs";
import { PortraitView } from "./portrait-view.mjs";
import { portraitStyle } from "./portrait-styles.mjs";
import { buildTooltip } from "./tooltip.mjs";
import { openEventDialog } from "./event-dialog.mjs";
import { rememberEvent } from "../model/events.mjs";

/** Combatant fields whose change can move a combatant or change who is shown. */
const ORDER_FIELDS = ["initiative", "hidden", "defeated", "tokenId", "actorId", "group"];

/** Token fields that affect a portrait. */
const TOKEN_FIELDS = ["name", "texture", "disposition", "displayName", "hidden", "actorLink", "delta"];

/** Width of the next-round divider, in px. Sets `--scb-divider-width` for 02-layout.css. */
const DIVIDER_WIDTH = 36;

/** Side padding of the track, in px. Must match `--scb-track-pad` in 02-layout.css. */
const TRACK_PAD = 12;

/** Duration of the slide when portraits change places. */
const MOVE_MS = 260;

/** Hover delay before a portrait tooltip opens, matching core's TooltipManager. */
const TOOLTIP_DELAY = 500;

const GM_CONTROLS_START = [
  ["rollAll", "fa-solid fa-users", "COMBAT.RollAll"],
  ["rollNPC", "fa-solid fa-users-gear", "COMBAT.RollNPC"],
  ["resetAll", "fa-solid fa-arrow-rotate-left", "COMBAT.InitiativeReset"],
  ["previousRound", "fa-solid fa-angles-left", "COMBAT.RoundPrev"],
  ["previousTurn", "fa-solid fa-angle-left", "COMBAT.TurnPrev"]
];

const GM_CONTROLS_END = [
  ["nextTurn", "fa-solid fa-angle-right", "COMBAT.TurnNext"],
  ["nextRound", "fa-solid fa-angles-right", "COMBAT.RoundNext"],
  ["startCombat", "fa-solid fa-play", "COMBAT.Begin"],
  ["endCombat", "fa-solid fa-flag-checkered", "COMBAT.End"],
  ["addEvent", "fa-solid fa-hourglass-half", "sogrom-simple-combat-bar.events.title"],
  ["configure", "fa-solid fa-gear", "sogrom-simple-combat-bar.controls.configure"]
];

export class CombatBar {

  /** @type {HTMLElement} */
  root;
  /** @type {HTMLOListElement} */
  track;
  /** @type {Combat|null} */
  combat = null;
  /** Render counters, read by the e2e render-budget suite. */
  stats = { flushes: 0, patches: 0, creates: 0, removes: 0, moves: 0 };

  /** @type {Map<string, PortraitView>} */
  #portraits = new Map();
  #divider;
  #session = new Lifecycle();
  /** @type {Lifecycle|null} */
  #bound = null;
  #scheduler;
  #items = [];
  #styleId = null;
  #tooltipTimer = null;
  #contextMenu = null;

  constructor() {
    this.#scheduler = new RenderScheduler(batch => this.#flush(batch));
    this.#buildRoot();
    this.#listen();
  }

  /** Whether the bar is currently bound to a combat. */
  get bound() {
    return !!this.combat;
  }

  /** Live registrations, for leak tests. */
  get counts() {
    return { session: this.#session.counts, bound: this.#bound?.counts ?? null,
      portraits: this.#portraits.size };
  }

  /* -------------------------------------------- */
  /*  Binding                                     */
  /* -------------------------------------------- */

  /** Bind to whichever combat the user is viewing now. Safe to call from any hook. */
  sync() {
    const combat = ui.combat?.viewed ?? game.combat ?? null;
    const visible = combat && (game.user.isGM || combat.started);
    this.bind(visible ? combat : null);
  }

  /**
   * @param {Combat|null} combat
   */
  bind(combat) {
    if ( combat === this.combat ) {
      if ( combat ) this.#scheduler.markAll();
      return;
    }
    this.unbind();
    if ( !combat ) return;

    this.combat = combat;
    this.#mount();
    const life = this.#bound = new Lifecycle();
    life.hook("updateCombat", (doc, changes) => this.#onUpdateCombat(doc, changes));
    life.hook("createCombatant", doc => this.#ifOurs(doc) && this.#scheduler.markOrder());
    life.hook("deleteCombatant", doc => this.#ifOurs(doc) && this.#scheduler.markOrder());
    life.hook("updateCombatant", (doc, changes) => this.#onUpdateCombatant(doc, changes));
    life.hook("updateActor", (actor, changes) => this.#onUpdateActor(actor, changes));
    life.hook("updateToken", (token, changes) => this.#onUpdateToken(token, changes));
    life.hook("createActiveEffect", effect => this.#onEffect(effect));
    life.hook("deleteActiveEffect", effect => this.#onEffect(effect));
    life.hook("updateActiveEffect", effect => this.#onEffect(effect));
    life.hook("hoverToken", (token, hovered) => this.#toggleTokenClass(token, "is-hovered", hovered));
    life.hook("controlToken", (token, controlled) => this.#toggleTokenClass(token, "is-controlled", controlled));
    life.add(() => this.#scheduler.cancel());

    this.root.hidden = false;
    this.#scheduler.markAll();
    log("bound", combat.id);
    Hooks.callAll(HOOKS.bind, this, combat);
  }

  /** Release the current combat. The root stays in the DOM, hidden, ready for the next bind. */
  unbind() {
    if ( !this.combat ) return;
    const combat = this.combat;
    this.#bound?.dispose();
    this.#bound = null;
    this.#closeTooltip();
    for ( const view of this.#portraits.values() ) view.destroy();
    this.#portraits.clear();
    this.#divider.remove();
    this.#items = [];
    this.combat = null;
    this.root.hidden = true;
    log("unbound", combat.id);
    Hooks.callAll(HOOKS.unbind, this, combat);
  }

  /** Tear the bar down completely. Only the tests and a module disable need this. */
  destroy() {
    this.unbind();
    this.#contextMenu?.close?.();
    this.#session.dispose();
    this.root.remove();
  }

  /** Force a full re-derive (settings changes). */
  refresh() {
    if ( this.combat ) this.#scheduler.markAll();
  }

  /** Run any pending render synchronously. Used by tests. */
  flushNow() {
    this.#scheduler.flushNow();
  }

  /* -------------------------------------------- */
  /*  Document hooks                              */
  /* -------------------------------------------- */

  #ifOurs(combatant) {
    return combatant.parent === this.combat;
  }

  #onUpdateCombat(combat, changes) {
    if ( combat !== this.combat ) return;
    if ( ("turn" in changes) || ("round" in changes) || ("started" in changes) || ("active" in changes) ) {
      this.#scheduler.markOrder();
    }
  }

  #onUpdateCombatant(combatant, changes) {
    if ( !this.#ifOurs(combatant) ) return;
    if ( ORDER_FIELDS.some(f => f in changes) ) this.#scheduler.markOrder();
    else this.#scheduler.markDirty(combatant.id);
  }

  #onUpdateActor(actor, changes) {
    const ids = this.#combatantIdsFor(c => c.actor === actor);
    if ( !ids.length ) return;
    const watched = adapterFor(game.system.id).watchedPaths?.(actor);
    const relevant = ("name" in changes) || ("img" in changes) || ("ownership" in changes)
      || !watched || Object.keys(changes.system ?? {}).some(k => watched.has(k));
    if ( relevant ) for ( const id of ids ) this.#scheduler.markDirty(id);
  }

  #onUpdateToken(token, changes) {
    if ( !TOKEN_FIELDS.some(f => f in changes) ) return;
    const ids = this.#combatantIdsFor(c => c.token === token);
    if ( "disposition" in changes ) this.#scheduler.markOrder();
    for ( const id of ids ) this.#scheduler.markDirty(id);
  }

  #onEffect(effect) {
    const actor = effect.target ?? effect.parent;
    if ( !(actor instanceof Actor) ) return;
    for ( const id of this.#combatantIdsFor(c => c.actor === actor) ) this.#scheduler.markDirty(id);
  }

  #combatantIdsFor(predicate) {
    if ( !this.combat ) return [];
    const ids = [];
    for ( const c of this.combat.combatants ) if ( predicate(c) ) ids.push(c.id);
    return ids;
  }

  #toggleTokenClass(token, cls, on) {
    if ( !this.combat ) return;
    const combatant = this.combat.combatants.find(c => c.tokenId === token.document?.id);
    this.#portraits.get(combatant?.id)?.element.classList.toggle(cls, on);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * The one render path. Runs at most once per animation frame, with everything that changed.
   * @param {{ids: Set<string>, order: boolean, all: boolean}} batch
   */
  #flush({ ids, order, all }) {
    const combat = this.combat;
    if ( !combat ) return;
    this.stats.flushes++;
    const cfg = settings();
    const adapter = adapterFor(game.system.id);

    const style = portraitStyle(cfg.portraitStyle);
    if ( style.id !== this.#styleId ) {
      for ( const view of this.#portraits.values() ) view.destroy();
      this.#portraits.clear();
      this.#styleId = style.id;
      this.root.dataset.style = style.id;
      all = order = true;
    }

    if ( order || all ) this.#items = this.#computeOrder(combat, cfg);
    const everything = order || all;
    // Where everything is now, before any class change or move, for the slide afterwards.
    const before = everything ? this.#positions() : null;

    const decimals = combat.turns.some(c => (c.initiative !== null) && !Number.isInteger(c.initiative))
      ? (CONFIG.Combat.initiative.decimals ?? 0) : 0;
    const unknownName = t("unknown");

    const nodes = [];
    const seen = new Set();
    this.#items.forEach((item, index) => {
      if ( item.type === "divider" ) {
        this.#divider.querySelector(".scb-divider-round").textContent = item.round;
        nodes.push(this.#divider);
        return;
      }
      const combatant = combat.combatants.get(item.id);
      if ( !combatant ) return;
      seen.add(item.id);
      let view = this.#portraits.get(item.id);
      const fresh = !view;
      if ( fresh ) {
        view = new PortraitView(item.id, style);
        this.#portraits.set(item.id, view);
        this.stats.creates++;
      }
      if ( fresh || everything || ids.has(item.id) ) {
        const facts = combatantFacts(combatant, { adapter, settings: cfg });
        const model = buildPortraitModel(facts, { settings: cfg, current: item.current, acted: item.acted,
          run: item.run, decimals, unknownName });
        const changed = view.patch(model, { runPosition: runPosition(this.#items, index) });
        if ( changed.length ) {
          this.stats.patches++;
          Hooks.callAll(HOOKS.renderPortrait, model, view.element, changed);
        }
      }
      nodes.push(view.element);
    });

    for ( const [id, view] of this.#portraits ) {
      if ( seen.has(id) ) continue;
      view.destroy();
      this.#portraits.delete(id);
      this.stats.removes++;
    }
    if ( !this.#items.some(i => i.type === "divider") ) this.#divider.remove();
    if ( everything ) this.stats.moves += applyOrder(this.track, nodes);

    this.#updateControls(combat);
    this.#autosize(cfg, style);
    if ( before ) this.#slide(before);
  }

  /** Each track child's left edge, keyed by element. */
  #positions() {
    const positions = new Map();
    if ( !this.root.isConnected ) return positions;
    for ( const el of this.track.children ) positions.set(el, el.getBoundingClientRect().left);
    return positions;
  }

  /**
   * FLIP: every portrait that changed place is drawn back where it was and slid to where it is
   * now. One that wrapped from one end of the bar to the other (more than half the track away)
   * fades in instead of flying across; so does a new arrival.
   * @param {Map<Element, number>} before
   */
  #slide(before) {
    if ( !this.root.isConnected || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ) return;
    const half = this.track.clientWidth / 2;
    const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    for ( const el of this.track.children ) {
      const was = before.get(el);
      if ( was === undefined ) {
        el.animate(fade, { duration: MOVE_MS, easing });
        continue;
      }
      const dx = was - el.getBoundingClientRect().left;
      if ( Math.abs(dx) < 1 ) continue;
      if ( Math.abs(dx) > half ) el.animate(fade, { duration: MOVE_MS, easing });
      else el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: MOVE_MS, easing });
    }
  }

  /** Turn the combat's turn list into the bar's items. */
  #computeOrder(combat, cfg) {
    const user = game.user;
    const turn = combat.turn;
    const turns = combat.turns.map((c, index) => {
      const hasActed = combat.started && ((combat.round > 1) || ((turn !== null) && (index <= turn)));
      const canObserve = c.actor ? c.actor.testUserPermission(user, "OBSERVER") : c.isOwner;
      const disposition = c.token?.disposition ?? 0;
      return {
        id: c.id,
        side: c.flags?.[MODULE_ID]?.event ? "neutral" : sideOf(disposition, !!c.actor?.hasPlayerOwner),
        defeated: c.isDefeated,
        groupId: c.group?.id ?? null,
        shown: isShown({ isGM: user.isGM, hidden: c.hidden, canObserve, hasActed,
          isFriendly: disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
          hideUnseenFirstRound: cfg.hideUnseenFirstRound })
      };
    });
    return buildOrder({ turns, turn, round: combat.round, started: combat.started,
      grouping: cfg.groupTeams, hideDefeated: cfg.hideDefeated });
  }

  #updateControls(combat) {
    const root = this.root;
    root.classList.toggle("is-started", combat.started);
    root.classList.toggle("is-gm", game.user.isGM);
    const current = combat.combatant;
    const canEnd = combat.started && (game.user.isGM || !!current?.isOwner);
    root.querySelector(".scb-endturn").hidden = !canEnd;
    root.querySelector(".scb-round-value").textContent = combat.started ? combat.round : "–";
  }

  /** Shrink portraits to fit the bar's width (overflow "autofit"), else use the set size. */
  #autosize(cfg, style) {
    const max = Number(cfg.portraitSize) || 72;
    let size = max;
    if ( cfg.overflow === "autofit" ) {
      const count = Math.max(1, this.#portraits.size);
      // 0.1 gap per portrait, plus the current portrait's extra 0.18 width.
      const available = (this.root.parentElement?.clientWidth ?? window.innerWidth) * 0.8;
      size = Math.max(40, Math.min(max, Math.floor(available / ((count * 1.1) + 0.18))));
    }
    this.root.dataset.overflow = cfg.overflow;
    this.root.style.setProperty("--scb-size", `${size}px`);
    this.root.style.setProperty("--scb-aspect", String(style.aspect));
    this.root.style.setProperty("--scb-divider-width", `${DIVIDER_WIDTH}px`);
    this.track.style.width = `${trackWidth(this.#items, size)}px`;
  }

  /* -------------------------------------------- */
  /*  DOM                                         */
  /* -------------------------------------------- */

  #buildRoot() {
    const root = document.createElement("section");
    root.id = `${CSS}-root`;
    root.className = `${CSS}-root`;
    root.hidden = true;
    root.setAttribute("aria-label", t("title"));
    const button = direction => ([action, icon, label]) => `<button type="button" class="${CSS}-tab ${action}"`
      + ` data-action="${action}" data-tooltip="${label}" data-tooltip-direction="${direction}"`
      + ` aria-label="${game.i18n.localize(label)}"><i class="${icon}"></i></button>`;
    // The GM controls are side tabs sticking out of the bar's ends, drawn like the dnd5e sheet's
    // vertical tabs; the round and End Turn hang from the bar's bottom edge.
    const tabs = (side, list) => `<nav class="${CSS}-tabs ${CSS}-tabs-${side}">${
      list.map(button(side === "start" ? "LEFT" : "RIGHT")).join("")}</nav>`;
    root.innerHTML = `
      <div class="${CSS}-bar">
        ${tabs("start", GM_CONTROLS_START)}
        <ol class="${CSS}-track" aria-live="polite"></ol>
        ${tabs("end", GM_CONTROLS_END)}
      </div>
      <div class="${CSS}-hanger">
        <div class="${CSS}-round">
          <span class="${CSS}-round-label">${t("round")}</span>
          <span class="${CSS}-round-value">–</span>
        </div>
        <button type="button" class="${CSS}-endturn" data-action="endTurn" hidden>
          <i class="fa-solid fa-hourglass-end"></i> ${game.i18n.localize("COMBAT.TurnEnd")}
        </button>
      </div>`;
    this.root = root;
    this.track = root.querySelector(`.${CSS}-track`);

    const divider = document.createElement("li");
    divider.className = `${CSS}-divider`;
    divider.setAttribute("aria-hidden", "true");
    divider.innerHTML = `<span class="${CSS}-divider-label">${t("round")}</span>`
      + `<span class="${CSS}-divider-round"></span>`;
    this.#divider = divider;
  }

  #mount() {
    if ( this.root.isConnected ) return;
    const host = document.getElementById("ui-top");
    if ( host ) host.prepend(this.root);
    else document.body.append(this.root);
  }

  /** Delegated listeners on the root, registered once per session (R3). */
  #listen() {
    const life = this.#session;
    const root = this.root;
    life.listen(root, "click", event => this.#onClick(event));
    life.listen(root, "dblclick", event => this.#onDoubleClick(event));
    life.listen(root, "keydown", event => this.#onKeyDown(event));
    life.listen(root, "pointerover", event => this.#onPointer(event, true));
    life.listen(root, "pointerout", event => this.#onPointer(event, false));
    life.add(() => this.#closeTooltip());

    if ( typeof ResizeObserver !== "undefined" ) {
      const observer = new ResizeObserver(() => this.refreshSize());
      life.add(() => observer.disconnect());
      life.timeout(() => this.root.parentElement && observer.observe(this.root.parentElement), 0);
    }

    this.#contextMenu = new foundry.applications.ux.ContextMenu(root, `.${CSS}-portrait`, this.#contextOptions(),
      { jQuery: false, fixed: true });
  }

  /** Recompute sizes only (window or sidebar resized). */
  refreshSize() {
    if ( !this.combat ) return;
    this.#autosize(settings(), portraitStyle(settings().portraitStyle));
  }

  #portraitOf(event) {
    const li = event.target.closest?.(`.${CSS}-portrait`);
    return li ? this.combat?.combatants.get(li.dataset.combatantId) ?? null : null;
  }

  async #onClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if ( actionEl && this.root.contains(actionEl) ) {
      event.preventDefault();
      event.stopPropagation();
      return this.#runAction(actionEl.dataset.action, this.#portraitOf(event), event);
    }
    const combatant = this.#portraitOf(event);
    if ( combatant ) return this.#selectAndPan(combatant);
  }

  #onDoubleClick(event) {
    const combatant = this.#portraitOf(event);
    if ( !combatant?.actor?.testUserPermission(game.user, "OBSERVER") ) return;
    combatant.actor.sheet.render(true);
  }

  #onKeyDown(event) {
    if ( (event.key !== "Enter") && (event.key !== " ") ) return;
    const combatant = this.#portraitOf(event);
    if ( !combatant ) return;
    event.preventDefault();
    this.#selectAndPan(combatant);
  }

  /** Hover a portrait: hover its token and, after a beat, open the tooltip. */
  #onPointer(event, entering) {
    const li = event.target.closest?.(`.${CSS}-portrait`);
    if ( !li ) return;
    // pointerover/out bubble from children; only react when crossing the portrait's own edge.
    if ( event.relatedTarget && li.contains(event.relatedTarget) ) return;
    const combatant = this.combat?.combatants.get(li.dataset.combatantId);
    const token = combatant?.token?.object;
    if ( entering ) {
      if ( token?.visible && !token.controlled ) token._onHoverIn(event, { hoverOutOthers: true });
      this.#openTooltipSoon(li);
    } else {
      if ( token?.hover ) token._onHoverOut(event);
      this.#closeTooltip();
    }
  }

  #openTooltipSoon(li) {
    this.#closeTooltip();
    this.#tooltipTimer = this.#session.timeout(() => {
      this.#tooltipTimer = null;
      const view = this.#portraits.get(li.dataset.combatantId);
      if ( !view?.model || !li.isConnected ) return;
      game.tooltip.activate(li, { html: buildTooltip(view.model), direction: "DOWN", cssClass: `${CSS}-tooltip` });
    }, TOOLTIP_DELAY);
  }

  #closeTooltip() {
    if ( this.#tooltipTimer !== null ) this.#session.clearTimeout(this.#tooltipTimer);
    this.#tooltipTimer = null;
    if ( game.tooltip?.element && this.root.contains(game.tooltip.element) ) game.tooltip.deactivate();
  }

  async #selectAndPan(combatant) {
    const token = combatant.token?.object;
    if ( !token || !combatant.actor?.testUserPermission(game.user, "OBSERVER") ) return;
    if ( token.isOwner ) token.control({ releaseOthers: true });
    if ( canvas.ready ) await canvas.animatePan(token.center);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  async #runAction(action, combatant, event) {
    const combat = this.combat;
    if ( !combat ) return;
    switch ( action ) {
      case "rollInitiative": return combatant && this.#rollInitiative(combatant, event);
      case "endTurn": return this.endTurn();
      case "configure": return openSettings();
    }
    if ( !game.user.isGM ) return;
    switch ( action ) {
      case "rollAll": return combat.rollAll({ event });
      case "rollNPC": return combat.rollNPC({ event });
      case "resetAll": return combat.resetAll();
      case "previousRound": return combat.previousRound();
      case "previousTurn": return combat.previousTurn();
      case "nextTurn": return combat.nextTurn();
      case "nextRound": return combat.nextRound();
      case "startCombat": return combat.startCombat();
      case "endCombat": return combat.endCombat();
      case "addEvent": return openEventDialog(this);
    }
  }

  /**
   * Roll one combatant's initiative, through the system's roll dialog when the
   * `initiativeDialog` setting asks for it (so the roller can pick advantage or disadvantage).
   */
  async #rollInitiative(combatant, event) {
    const adapter = adapterFor(game.system.id);
    const actor = combatant.actor;
    const dialog = !!actor && !!adapter.configureInitiative
      && wantsInitiativeDialog(settings().initiativeDialog, !!actor.hasPlayerOwner);
    if ( dialog && !(await adapter.configureInitiative(actor, event)) ) return;
    try {
      await this.combat?.rollInitiative([combatant.id], { event });
    } finally {
      if ( dialog ) adapter.clearInitiative?.(actor);
    }
  }

  /**
   * Add a timed event to the bound combat, and remember it in the GM's recent events.
   * @param {import("../model/events.mjs").EventData} data  Already normalised.
   * @returns {Promise<Combatant|null>}
   */
  async addEvent(data) {
    const combat = this.combat;
    if ( !game.user.isGM || !combat ) return null;
    const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{
      name: data.name,
      img: data.img,
      initiative: data.initiative,
      hidden: !!data.hidden,
      // Before combat starts the round is 0; the countdown starts with round 1.
      flags: { [MODULE_ID]: { event: true, duration: data.duration ?? null, roundCreated: Math.max(combat.round, 1) } }
    }]);
    const recent = game.settings.get(MODULE_ID, "recentEvents") ?? [];
    await game.settings.set(MODULE_ID, "recentEvents", rememberEvent(recent, data));
    return combatant ?? null;
  }

  /** End the current turn, if this user may. */
  async endTurn() {
    const combat = this.combat;
    if ( !combat?.started ) return;
    if ( !game.user.isGM && !combat.combatant?.isOwner ) return;
    return combat.nextTurn();
  }

  #contextOptions() {
    const combatantOf = li => this.combat?.combatants.get(li.dataset.combatantId);
    const gm = () => game.user.isGM;
    return [
      {
        name: "sogrom-simple-combat-bar.context.setCurrent",
        icon: '<i class="fa-solid fa-hourglass-start"></i>',
        condition: li => gm() && this.combat?.started && (combatantOf(li) !== this.combat.combatant),
        callback: li => {
          const index = this.combat.turns.findIndex(c => c.id === li.dataset.combatantId);
          if ( index >= 0 ) this.combat.update({ turn: index });
        }
      },
      {
        name: "COMBATANT.PanTo",
        icon: '<i class="fa-solid fa-location-crosshairs"></i>',
        condition: li => !!combatantOf(li)?.token?.object,
        callback: li => this.#selectAndPan(combatantOf(li))
      },
      {
        name: "COMBATANT.Ping",
        icon: '<i class="fa-solid fa-bullseye-arrow"></i>',
        condition: li => canvas.ready && (combatantOf(li)?.sceneId === canvas.scene?.id)
          && game.user.hasPermission("PING_CANVAS"),
        callback: li => {
          const token = combatantOf(li)?.token?.object;
          if ( token?.visible ) canvas.ping(token.center);
        }
      },
      {
        name: "COMBATANT.ACTIONS.Reroll",
        icon: '<i class="fa-solid fa-dice-d20"></i>',
        condition: li => gm() || !!combatantOf(li)?.isOwner,
        callback: li => this.combat.rollInitiative([li.dataset.combatantId])
      },
      {
        name: "COMBATANT.ACTIONS.Clear",
        icon: '<i class="fa-solid fa-eraser"></i>',
        condition: li => gm() && (combatantOf(li)?.initiative !== null),
        callback: li => combatantOf(li)?.update({ initiative: null })
      },
      {
        name: "COMBATANT.Hide",
        icon: '<i class="fa-solid fa-eye-slash"></i>',
        condition: li => gm() && !combatantOf(li)?.hidden,
        callback: li => combatantOf(li)?.update({ hidden: true })
      },
      {
        name: "COMBATANT.Show",
        icon: '<i class="fa-solid fa-eye"></i>',
        condition: li => gm() && !!combatantOf(li)?.hidden,
        callback: li => combatantOf(li)?.update({ hidden: false })
      },
      {
        name: "COMBATANT.MarkDefeated",
        icon: '<i class="fa-solid fa-skull"></i>',
        condition: li => gm() && !combatantOf(li)?.isDefeated,
        callback: li => toggleDefeated(combatantOf(li))
      },
      {
        name: "COMBATANT.UnmarkDefeated",
        icon: '<i class="fa-solid fa-heart-pulse"></i>',
        condition: li => gm() && !!combatantOf(li)?.isDefeated,
        callback: li => toggleDefeated(combatantOf(li))
      },
      {
        name: "COMBATANT.ACTIONS.Update",
        icon: '<i class="fa-solid fa-pen-to-square"></i>',
        condition: gm,
        callback: li => combatantOf(li)?.sheet.render(true)
      },
      {
        name: "COMBATANT.ACTIONS.Remove",
        icon: '<i class="fa-solid fa-trash"></i>',
        condition: gm,
        callback: li => combatantOf(li)?.delete()
      }
    ];
  }
}

/**
 * The track's width for these items at this portrait size: every portrait, the current one's
 * extra width, the divider, the gaps and the side padding. It depends only on who is on the bar,
 * never on whose turn it is, so the bar stays still while the portraits move.
 * @param {Array<{type: string, current?: boolean}>} items
 * @param {number} size  Portrait width, px.
 * @returns {number}
 */
export function trackWidth(items, size) {
  const portraits = items.filter(i => i.type === "combatant");
  const current = portraits.filter(i => i.current).length;
  const dividers = items.length - portraits.length;
  const gap = size * 0.1;
  return Math.ceil((portraits.length * size) + (current * size * 0.18) + (dividers * DIVIDER_WIDTH)
    + (Math.max(0, items.length - 1) * gap) + (TRACK_PAD * 2));
}

/**
 * Whether an item sits at the start, middle or end of a team run, for the shared-frame CSS.
 * @returns {"first"|"middle"|"last"|null}
 */
export function runPosition(items, index) {
  const run = items[index]?.run;
  if ( !run ) return null;
  const prev = items[index - 1]?.run === run;
  const next = items[index + 1]?.run === run;
  if ( prev && next ) return "middle";
  if ( next ) return "first";
  if ( prev ) return "last";
  return null;
}

/** Core's own defeat toggle, re-implemented on public API (spec R12). */
async function toggleDefeated(combatant) {
  if ( !combatant ) return;
  const defeated = !combatant.isDefeated;
  await combatant.update({ defeated });
  await combatant.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: defeated });
}

/** Open core settings on this module's tab. */
function openSettings() {
  new foundry.applications.settings.SettingsConfig({ initialCategory: MODULE_ID }).render({ force: true });
}
