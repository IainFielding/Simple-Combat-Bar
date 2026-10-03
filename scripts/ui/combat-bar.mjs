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
import { isShown } from "../model/visibility.mjs";
import { wantsInitiativeDialog } from "../model/initiative.mjs";
import { adapterFor } from "../systems/adapter.mjs";
import { combatantFacts, readEffects, runSideOf } from "./facts.mjs";
import { showsDescriptions } from "../model/effects.mjs";
import { effectDescriptions } from "./effect-text.mjs";
import { groupContext, requestGroupTurn } from "./group-service.mjs";
import { arrive, isWaiting, openArrivalDialog } from "./arrival-service.mjs";
import { PortraitView } from "./portrait-view.mjs";
import { portraitStyle } from "./portrait-styles.mjs";
import { buildTooltip } from "./tooltip.mjs";
import { openEventDialog } from "./event-dialog.mjs";
import { rememberEvent } from "../model/events.mjs";
import { readAttributes, safeColor } from "../model/trackers.mjs";
import { toggleSlot } from "../systems/economy.mjs";

/** Combatant fields whose change can move a combatant or change who is shown. */
const ORDER_FIELDS = ["initiative", "hidden", "defeated", "tokenId", "actorId", "group"];

/** Token fields that affect a portrait. */
const TOKEN_FIELDS = ["name", "texture", "disposition", "displayName", "hidden", "actorLink", "delta"];

/** Width of the next-round divider, in px. Sets `--scb-divider-width` for 02-layout.css. */
const DIVIDER_WIDTH = 36;

/** Side padding of the track, in px. Must match `--scb-track-pad` in 02-layout.css. */
const TRACK_PAD = 12;

/** The smallest a portrait gets when fitting the bar to the window; past this the track scrolls. */
const MIN_SIZE = 32;

/** Portrait size below which the bar goes compact (see 03-portrait.css). */
const COMPACT_BELOW = 48;

/** Space kept clear between the bar (or its tabs) and the scene pill or sidebar, in screen px. */
const CLEARANCE = 12;

/**
 * The bar's own width around the track: its side padding (10px each, 02-layout.css) and borders.
 * Must match the CSS, like TRACK_PAD and DIVIDER_WIDTH.
 */
const BAR_CHROME = (10 * 2) + 2;

/** Width of each GM tab sticking out of the bar's ends (04-controls.css). */
const TAB_WIDTH = 38;

/** Duration of the slide when portraits change places. */
const MOVE_MS = 260;

/** Body class that hides the dnd5e calendar HUD while the bar shows a combat. */
const HIDE_CALENDAR = `${CSS}-hide-calendar`;

/** Hover delay before a portrait tooltip opens, matching core's TooltipManager. */
const TOOLTIP_DELAY = 500;

const GM_CONTROLS_START = [
  ["rollAll", "fa-solid fa-users", "COMBAT.RollAll"],
  ["rollNPC", "fa-solid fa-users-gear", "COMBAT.RollNPC"],
  ["resetAll", "fa-solid fa-arrow-rotate-left", "COMBAT.InitiativeReset"],
  ["previousRound", "fa-solid fa-angles-left", "COMBAT.RoundPrev"],
  ["previousTurn", "fa-solid fa-angle-left", "COMBAT.TurnPrev"]
];

/**
 * Top to bottom. The tabs stack from the bottom, so Next Turn mirrors Previous Turn in the opposite
 * corner; Start Combat takes End Combat's place until the combat has started.
 */
const GM_CONTROLS_END = [
  ["configure", "fa-solid fa-gear", "sogrom-simple-combat-bar.controls.configure"],
  ["addEvent", "fa-solid fa-hourglass-half", "sogrom-simple-combat-bar.events.title"],
  ["startCombat", "fa-solid fa-play", "COMBAT.Begin"],
  ["endCombat", "fa-solid fa-flag-checkered", "COMBAT.End"],
  ["nextRound", "fa-solid fa-angles-right", "COMBAT.RoundNext"],
  ["nextTurn", "fa-solid fa-angle-right", "COMBAT.TurnNext"]
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
  /** Bumped whenever the tooltip closes, so a tooltip still being prepared knows it's stale. */
  #tooltipGeneration = 0;
  #contextMenu = null;
  /** @type {ResizeObserver|null} */
  #resizeObserver = null;

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
    // Everyone sees a combat as soon as it exists: players need the bar before it starts, to roll
    // their initiative.
    this.bind(combat);
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
    // The dnd5e calendar shares #ui-top with the bar; step it aside from the initiative roll on.
    document.body.classList.add(HIDE_CALENDAR);
    life.add(() => document.body.classList.remove(HIDE_CALENDAR));

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
    // An arrival changes the combatant's side for team runs (facts.mjs#runSideOf), even when its
    // hidden state stays the same.
    const ours = changes.flags?.[MODULE_ID] ?? {};
    const arrival = ("arrival" in ours) || ("-=arrival" in ours);
    if ( arrival || ORDER_FIELDS.some(f => f in changes) ) this.#scheduler.markOrder();
    else this.#scheduler.markDirty(combatant.id);
  }

  #onUpdateActor(actor, changes) {
    const ids = this.#combatantIdsFor(c => c.actor === actor);
    if ( !ids.length ) return;
    const watched = adapterFor(game.system.id).watchedPaths?.(actor);
    // "flags": midi-qol keeps its action economy in actor flags.
    const relevant = ("name" in changes) || ("img" in changes) || ("ownership" in changes) || ("flags" in changes)
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
        const canTakeTurn = (cfg.groupTeams === "bg3") && item.activeRun && !item.ended && !item.current
          && !combatant.isDefeated && (combatant.isOwner || game.user.isGM);
        const model = buildPortraitModel(facts, { settings: cfg, current: item.current, acted: item.acted,
          run: item.run, activeRun: item.activeRun, ended: item.ended, canTakeTurn, decimals, unknownName });
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
        side: runSideOf(c),
        defeated: c.isDefeated,
        groupId: c.group?.id ?? null,
        shown: isShown({ isGM: user.isGM, hidden: c.hidden, canObserve, hasActed,
          isFriendly: disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
          hideUnseenFirstRound: cfg.hideUnseenFirstRound })
      };
    });
    const ended = new Set(groupContext(combat)?.state.ended ?? []);
    return buildOrder({ turns, turn, round: combat.round, started: combat.started,
      grouping: cfg.groupTeams, hideDefeated: cfg.hideDefeated, ended });
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
    let overflow = cfg.overflow;
    // The bar's widest: clear of the scene pill and the sidebar, with room for the GM tabs. A
    // scrolling bar stops here too, rather than growing to the whole middle column.
    const available = this.#availableWidth() - (game.user.isGM ? TAB_WIDTH * 2 : 0);
    this.root.style.setProperty("--scb-bar-max", `${Math.max(0, available)}px`);
    if ( cfg.overflow === "autofit" ) {
      // Exactly the size at which the bar fits that space.
      const fit = fitSize(this.#items, available);
      size = Math.max(MIN_SIZE, Math.min(max, fit));
      // Fit to width until the portraits are as small as they go, then scroll rather than clip.
      if ( fit < MIN_SIZE ) overflow = "scroll";
    }
    this.root.dataset.overflow = overflow;
    this.root.classList.toggle("has-bar2", !!cfg.secondaryResource);
    this.root.style.setProperty("--scb-bar2", safeColor(cfg.secondaryColor, "#5aa9e6"));
    this.root.style.setProperty("--scb-size", `${size}px`);
    // Below this, cards other than the current one drop their name, effects and legendary badges.
    this.root.classList.toggle("is-compact", size < COMPACT_BELOW);
    this.root.style.setProperty("--scb-aspect", String(style.aspect));
    this.root.style.setProperty("--scb-divider-width", `${DIVIDER_WIDTH}px`);
    this.track.style.width = `${trackWidth(this.#items, size)}px`;
  }

  /**
   * The width the bar may take, centred as it is: core's middle column, narrowed so it stays clear
   * of the scene-name pill at the top left and the sidebar at the right. Those are measured on
   * screen, and #ui-middle is scaled by the UI scale setting, so screen px are converted back.
   * @returns {number}  In the bar's own (unscaled) px.
   */
  #availableWidth() {
    const host = this.root.parentElement;
    if ( !host ) return window.innerWidth;
    const box = host.getBoundingClientRect();
    const scale = host.clientWidth ? (box.width / host.clientWidth) : 1;
    const centre = box.left + (box.width / 2);
    let half = box.width / 2;
    const pill = document.getElementById("scene-navigation")?.getBoundingClientRect();
    if ( pill?.width && (pill.right < centre) ) half = Math.min(half, centre - pill.right - CLEARANCE);
    const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
    if ( sidebar?.width && (sidebar.left > centre) ) half = Math.min(half, sidebar.left - centre - CLEARANCE);
    return Math.max(0, Math.floor((half * 2) / (scale || 1)));
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
    // Watch what bounds the bar: its container, and the scene pill and sidebar it keeps clear of
    // (opening or closing the sidebar changes the space without resizing the window).
    for ( const el of [this.root.parentElement, document.getElementById("scene-navigation"),
      document.getElementById("sidebar")] ) {
      if ( el ) this.#resizeObserver?.observe(el);
    }
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
    // Capture phase, so right-clicking an effect icon never reaches the portrait's context menu.
    life.listen(root, "contextmenu", event => this.#onEffectContext(event), { capture: true });
    life.add(() => this.#closeTooltip());

    // Attached to the bar's container in #mount: at this point the root isn't in the page yet.
    if ( typeof ResizeObserver !== "undefined" ) {
      const observer = this.#resizeObserver = new ResizeObserver(() => this.refreshSize());
      life.add(() => observer.disconnect());
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
    if ( !combatant ) return;
    // In a BG3 group turn, clicking a waiting member of the run (yours, or any as GM) has them act.
    if ( this.#portraits.get(combatant.id)?.model?.canTakeTurn ) requestGroupTurn("activate", combatant);
    return this.#selectAndPan(combatant);
  }

  #onDoubleClick(event) {
    const combatant = this.#portraitOf(event);
    if ( !combatant?.actor?.testUserPermission(game.user, "OBSERVER") ) return;
    combatant.actor.sheet.render(true);
  }

  #onKeyDown(event) {
    if ( (event.key !== "Enter") && (event.key !== " ") ) return;
    // Only the portrait itself: Enter on a button inside it must still press the button.
    if ( !event.target.matches?.(`.${CSS}-portrait`) ) return;
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

  /** Right-click an effect icon: the owner or GM may remove it, after confirming. */
  async #onEffectContext(event) {
    const icon = event.target.closest?.(".scb-effect");
    if ( !icon ) return;
    event.preventDefault();
    event.stopPropagation();
    const effect = await fromUuid(icon.dataset.effectUuid);
    if ( !effect?.isOwner ) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("effects.removeTitle") },
      content: `<p>${t("effects.removeContent", { name: Handlebars.escapeExpression(effect.name) })}</p>`,
      rejectClose: false
    });
    if ( confirmed ) await effect.delete();
  }

  #openTooltipSoon(li) {
    this.#closeTooltip();
    const generation = this.#tooltipGeneration;
    this.#tooltipTimer = this.#session.timeout(async () => {
      this.#tooltipTimer = null;
      const view = this.#portraits.get(li.dataset.combatantId);
      if ( !view?.model || !li.isConnected ) return;
      // Tooltip values are read now, on hover, and only for viewers who receive the actor's data.
      const actor = this.combat?.combatants.get(li.dataset.combatantId)?.actor;
      const adapter = adapterFor(game.system.id);
      const attributes = view.model.trusted
        ? readAttributes(actor?.system, settings().tooltipAttributes, {
          localize: key => game.i18n.localize(key),
          labelFor: path => adapter.attributeLabel?.(path) ?? null
        }) : [];
      const cfg = settings();
      const effects = cfg.showEffects && actor ? readEffects(actor) : [];
      const descriptions = showsDescriptions(cfg.effectDescriptions, view.model.trusted);
      // Enriched only now, for this combatant's effects, and cached until an effect changes.
      const texts = descriptions && effects.length ? await effectDescriptions(effects) : new Map();
      if ( (generation !== this.#tooltipGeneration) || !li.isConnected ) return;
      game.tooltip.activate(li, { html: buildTooltip(view.model, attributes, { effects, descriptions, texts }),
        direction: "DOWN", cssClass: `${CSS}-tooltip` });
    }, TOOLTIP_DELAY);
  }

  #closeTooltip() {
    this.#tooltipGeneration++;
    if ( this.#tooltipTimer !== null ) this.#session.clearTimeout(this.#tooltipTimer);
    this.#tooltipTimer = null;
    if ( game.tooltip?.element && this.root.contains(game.tooltip.element) ) game.tooltip.deactivate();
  }

  async #selectAndPan(combatant) {
    if ( !canPanTo(combatant) ) return;
    const token = combatant.token.object;
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
      case "legendary": {
        const kind = event.target.closest("[data-kind]")?.dataset.kind;
        const adapter = adapterFor(game.system.id);
        if ( !combatant?.actor || !kind || !adapter.adjustLegendary ) return;
        if ( !combatant.isOwner && !game.user.isGM ) return;
        return adapter.adjustLegendary(combatant.actor, kind, event.shiftKey ? -1 : 1);
      }
      case "togglePip": {
        const slot = event.target.closest("[data-pip]")?.dataset.pip;
        if ( combatant && slot && (combatant.isOwner || game.user.isGM) ) return toggleSlot(combatant, slot);
        return;
      }
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
      case "nextTurn": return this.endTurn();
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
  async #rollInitiative(combatant, event = null) {
    const adapter = adapterFor(game.system.id);
    const actor = combatant.actor;
    const dialog = !!actor && !!adapter.configureInitiative
      && wantsInitiativeDialog(settings().initiativeDialog, !!actor.hasPlayerOwner);
    // An adapter may resolve plain `true` (the API before roll modes were passed on).
    const configured = dialog ? await adapter.configureInitiative(actor, event) : {};
    if ( !configured ) return;
    try {
      await this.combat?.rollInitiative([combatant.id], typeof configured === "object" ? configured : {});
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
    const arrives = data.arrivesRound ?? null;
    const [combatant] = await combat.createEmbeddedDocuments("Combatant", [{
      name: data.name,
      img: data.img,
      initiative: data.initiative,
      // A late event is hidden until it arrives (arrival-service.mjs), then goes back to the GM's choice.
      hidden: !!data.hidden || (arrives !== null),
      // Before combat starts the round is 0; the countdown starts with round 1, or when it arrives.
      flags: { [MODULE_ID]: { event: true, duration: data.duration ?? null,
        roundCreated: Math.max(combat.round, 1, arrives ?? 0),
        arrival: arrives === null ? null : { round: arrives, hidden: !!data.hidden } } }
    }]);
    // The arrival round belongs to this fight, not to the preset.
    const recent = game.settings.get(MODULE_ID, "recentEvents") ?? [];
    await game.settings.set(MODULE_ID, "recentEvents", rememberEvent(recent, { ...data, arrivesRound: null }));
    return combatant ?? null;
  }

  /** End the current turn, if this user may. */
  async endTurn() {
    const combat = this.combat;
    if ( !combat?.started ) return;
    if ( !game.user.isGM && !combat.combatant?.isOwner ) return;
    // In a group turn, ending hands the turn to the next waiting member, or leaves the run.
    if ( groupContext(combat) ) return requestGroupTurn("end", combat.combatant);
    return combat.nextTurn();
  }

  #contextOptions() {
    const combatantOf = li => this.combat?.combatants.get(li.dataset.combatantId);
    const gm = () => game.user.isGM;
    return [
      {
        label: "sogrom-simple-combat-bar.context.setCurrent",
        icon: '<i class="fa-solid fa-hourglass-start"></i>',
        // One that hasn't arrived would only be stepped straight past: bring it in first.
        visible: li => gm() && this.combat?.started && (combatantOf(li) !== this.combat.combatant)
          && !isWaiting(combatantOf(li)),
        onClick: (_event, li) => {
          const index = this.combat.turns.findIndex(c => c.id === li.dataset.combatantId);
          if ( index >= 0 ) this.combat.update({ turn: index });
        }
      },
      {
        label: "COMBATANT.PanTo",
        icon: '<i class="fa-solid fa-location-crosshairs"></i>',
        visible: li => canPanTo(combatantOf(li)),
        onClick: (_event, li) => this.#selectAndPan(combatantOf(li))
      },
      {
        label: "COMBATANT.Ping",
        icon: '<i class="fa-solid fa-bullseye-arrow"></i>',
        visible: li => canvas.ready && (combatantOf(li)?.sceneId === canvas.scene?.id)
          && game.user.hasPermission("PING_CANVAS"),
        onClick: (_event, li) => {
          const token = combatantOf(li)?.token?.object;
          if ( token?.visible ) canvas.ping(token.center);
        }
      },
      {
        label: "COMBATANT.ACTIONS.Reroll",
        icon: '<i class="fa-solid fa-dice-d20"></i>',
        visible: li => gm() || !!combatantOf(li)?.isOwner,
        onClick: (_event, li) => combatantOf(li) && this.#rollInitiative(combatantOf(li))
      },
      {
        label: "COMBATANT.ACTIONS.Clear",
        icon: '<i class="fa-solid fa-eraser"></i>',
        visible: li => gm() && (combatantOf(li)?.initiative !== null),
        onClick: (_event, li) => combatantOf(li)?.update({ initiative: null })
      },
      {
        label: "sogrom-simple-combat-bar.context.arrivesLater",
        icon: '<i class="fa-solid fa-door-open"></i>',
        visible: li => gm() && !!combatantOf(li) && (combatantOf(li) !== this.combat?.combatant),
        onClick: (_event, li) => openArrivalDialog(combatantOf(li))
      },
      {
        label: "sogrom-simple-combat-bar.context.arriveNow",
        icon: '<i class="fa-solid fa-person-walking-arrow-right"></i>',
        visible: li => gm() && isWaiting(combatantOf(li)),
        onClick: (_event, li) => arrive(combatantOf(li))
      },
      {
        label: "COMBATANT.Hide",
        icon: '<i class="fa-solid fa-eye-slash"></i>',
        visible: li => gm() && !combatantOf(li)?.hidden,
        onClick: (_event, li) => combatantOf(li)?.update({ hidden: true })
      },
      {
        label: "COMBATANT.Show",
        icon: '<i class="fa-solid fa-eye"></i>',
        visible: li => gm() && !!combatantOf(li)?.hidden,
        onClick: (_event, li) => combatantOf(li)?.update({ hidden: false })
      },
      {
        label: "COMBATANT.MarkDefeated",
        icon: '<i class="fa-solid fa-skull"></i>',
        visible: li => gm() && !combatantOf(li)?.isDefeated,
        onClick: (_event, li) => toggleDefeated(combatantOf(li))
      },
      {
        label: "COMBATANT.UnmarkDefeated",
        icon: '<i class="fa-solid fa-heart-pulse"></i>',
        visible: li => gm() && !!combatantOf(li)?.isDefeated,
        onClick: (_event, li) => toggleDefeated(combatantOf(li))
      },
      {
        label: "COMBATANT.ACTIONS.Update",
        icon: '<i class="fa-solid fa-pen-to-square"></i>',
        visible: gm,
        onClick: (_event, li) => combatantOf(li)?.sheet.render(true)
      },
      {
        label: "COMBATANT.ACTIONS.Remove",
        icon: '<i class="fa-solid fa-trash"></i>',
        visible: gm,
        onClick: (_event, li) => combatantOf(li)?.delete()
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
 * The largest portrait size at which the bar fits in `width` px: {@link trackWidth} solved for size,
 * plus the bar's own padding and border. Uses the same measurements as trackWidth, so the two can't
 * disagree about whether the cards fit.
 * @param {Array<{type: string, current?: boolean}>} items
 * @param {number} width  Space for the bar, px.
 * @returns {number}  Whole px; may be below the minimum, meaning "too many to fit".
 */
export function fitSize(items, width) {
  const portraits = items.filter(i => i.type === "combatant");
  const current = portraits.filter(i => i.current).length;
  const dividers = items.length - portraits.length;
  const perPx = portraits.length + (current * 0.18) + (Math.max(0, items.length - 1) * 0.1);
  const fixed = (dividers * DIVIDER_WIDTH) + (TRACK_PAD * 2) + BAR_CHROME;
  if ( perPx <= 0 ) return Number.POSITIVE_INFINITY;
  // -1 for trackWidth's rounding up.
  return Math.floor((width - fixed - 1) / perPx);
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

/** Whether this user may select and pan to a combatant's token: it's on the canvas, and they observe it. */
function canPanTo(combatant) {
  return !!combatant?.token?.object && !!combatant.actor?.testUserPermission(game.user, "OBSERVER");
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
