/**
 * Run the end-to-end suites.
 *
 *   node run.mjs                                     # playwright-combat, every suite
 *   node run.mjs playwright-combat playwright-ctd    # both worlds; prints a comparison
 *   node run.mjs playwright-combat --suites=lifecycle,budget
 *   node run.mjs --iterations=20                      # longer churn for the lifecycle suite
 *
 * Suites: lifecycle, budget, ordering, permissions, events, arrivals, trackers, settingsUi, responsive,
 * economy, legendary, groupTurns, effects. The CTD world runs lifecycle and budget only — the others
 * test behaviour that is ours.
 *
 * The canvas stays off (`core.noCanvas`, set by lib/session.mjs): the bar lives in #ui-top and
 * none of these suites look at the board, and a software-rendered canvas is what made the
 * Character Creator's runs slow.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, PLAYER_USER, WORLDS } from "./config.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const worlds = argv.filter(a => !a.startsWith("--"));
if ( !worlds.length ) worlds.push("playwright-combat");
const wanted = option("suites", "lifecycle,budget,ordering,permissions,events,arrivals,trackers,settingsUi,responsive,economy,legendary,groupTurns,effects").split(",");
const iterations = Number(option("iterations", 10));

/** Suites that only make sense for this module. */
const SCB_ONLY = new Set(["ordering", "permissions", "events", "arrivals", "trackers", "settingsUi", "responsive", "economy", "legendary", "groupTurns", "effects"]);

/**
 * Budgets the lifecycle suite enforces for this module. The CTD world is measured, not judged.
 * Heap is reported but not judged: it moves with world data (dnd5e posts a chat card per turn), and
 * live-instance counts measure what the bar itself retains exactly.
 */
const LEAK_LIMITS = { hooks: 0, windowListeners: 0, documentListeners: 0, uiTopListeners: 0, portraits: 0,
  barInstances: 1, portraitInstances: 0 };

/** Where each subject's own classes live, for live-instance counts after GC. */
const CLASSES = {
  scb: {
    barInstances: `import("/modules/${MODULE_ID}/scripts/ui/combat-bar.mjs").then(m => m.CombatBar.prototype)`,
    portraitInstances: `import("/modules/${MODULE_ID}/scripts/ui/portrait-view.mjs").then(m => m.PortraitView.prototype)`
  },
  ctd: {
    barInstances: "CONFIG.combatTrackerDock.CombatDock.prototype",
    portraitInstances: "CONFIG.combatTrackerDock.CombatantPortrait.prototype"
  }
};

/** Live instances of the subject's classes, after a forced GC. */
async function instances(session, subject) {
  await session.heapAfterGC();
  const out = {};
  for ( const [key, expression] of Object.entries(CLASSES[subject]) ) out[key] = await session.countInstances(expression);
  return out;
}

/* -------------------------------------------- */

/** Import the in-world modules through the module junction, onto `window.__scb`. */
async function loadSuites(session) {
  await session.eval(async id => {
    globalThis.__scb = await import(`/modules/${id}/test-e2e/in-world/suites.mjs?t=${Date.now()}`);
    globalThis.__scbFixtures = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
  }, MODULE_ID);
}

/** Listener counts that the page itself can't see. */
async function listeners(session) {
  return {
    windowListeners: await session.listenerCount("window"),
    documentListeners: await session.listenerCount("document"),
    // #ui-top's whole subtree: that's where both bars live.
    uiTopListeners: await session.listenerCount("document.getElementById('ui-top')", -1)
  };
}

const SUITES = {

  /** Churn whole combats; everything must come back to where it started. */
  async lifecycle(session, subject) {
    // One warm-up cycle: first-use caches (templates, fonts, compendium indexes) aren't leaks.
    await session.eval(() => __scb.churn({ iterations: 1, turns: 4 }));
    const before = { ...await session.eval(s => __scb.snapshot(s), subject), ...await listeners(session),
      heap: await session.heapAfterGC() };
    await session.eval(n => __scb.churn({ iterations: n, turns: 12 }), iterations);
    const after = { ...await session.eval(s => __scb.snapshot(s), subject), ...await listeners(session),
      heap: await session.heapAfterGC(), ...await instances(session, subject) };

    const delta = {
      hooks: after.hooks - before.hooks,
      windowListeners: after.windowListeners - before.windowListeners,
      documentListeners: after.documentListeners - before.documentListeners,
      uiTopListeners: after.uiTopListeners - before.uiTopListeners,
      portraits: after.portraits - before.portraits,
      dom: after.dom - before.dom,
      heapBytes: after.heap - before.heap,
      // Absolute, not deltas: after the churn and cleanup, no combat exists.
      barInstances: after.barInstances,
      portraitInstances: after.portraitInstances
    };
    const hookDiff = Object.fromEntries(Object.keys({ ...before.hookTable, ...after.hookTable })
      .map(k => [k, (after.hookTable[k] ?? 0) - (before.hookTable[k] ?? 0)]).filter(([, n]) => n));

    const breaches = subject === "scb"
      ? Object.entries(LEAK_LIMITS).filter(([k, limit]) => delta[k] > limit).map(([k]) => k)
      : [];
    return {
      pass: !breaches.length,
      before, after, delta, hookDiff, iterations,
      lines: [
        `${iterations} combats: hooks ${sign(delta.hooks)}, window listeners ${sign(delta.windowListeners)}, `
          + `document listeners ${sign(delta.documentListeners)}, #ui-top listeners ${sign(delta.uiTopListeners)}`,
        `portraits ${sign(delta.portraits)}, DOM elements ${sign(delta.dom)}, heap ${mb(delta.heapBytes)}`,
        `live after GC: ${delta.barInstances} bar instance(s), ${delta.portraitInstances} portrait instance(s)`,
        ...(Object.keys(hookDiff).length ? [`hook table change: ${JSON.stringify(hookDiff)}`] : []),
        ...(breaches.length ? [`over budget: ${breaches.join(", ")}`] : [])
      ]
    };
  },

  /** What one change costs in DOM creation. */
  async budget(session, subject) {
    const r = await session.eval(s => __scb.budget(s), subject);
    const checks = subject === "scb" ? [
      ["one batch of 12 initiative values renders once", r.rollBatch.stats.flushes <= 1],
      ["a batch of initiative values creates no elements", r.rollBatch.created === 0],
      ["damage to one actor patches one portrait", r.damage.stats.patches === 1],
      ["damage creates no elements", r.damage.created === 0],
      ["a turn change creates no elements", r.nextTurn.created === 0],
      ["ten turn changes create no elements", r.tenTurns.created === 0]
    ] : [];
    const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
    return {
      pass: !failures.length,
      ...r,
      lines: [
        ...["rollBatch", "rollEach", "damage", "nextTurn", "tenTurns"].map(k =>
          `${k.padEnd(9)} created ${String(r[k].created).padStart(4)}  removed ${String(r[k].removed).padStart(4)}`
          + (r[k].stats ? `  flushes ${r[k].stats.flushes} patches ${r[k].stats.patches} moves ${r[k].stats.moves}` : "")),
        ...failures.map(f => `FAILED: ${f}`)
      ]
    };
  },

  async ordering(session) {
    const { failures } = await session.eval(() => __scb.ordering());
    return { pass: !failures.length, failures,
      lines: failures.slice(0, 5).map(f => JSON.stringify(f)) };
  },

  /** Status effect icons: drawn like the token's, rings drain, tooltip lists them, right-click removes. */
  async effects(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const ids = await gm.eval(() => __scb.effectsSetup());
    const page = gm.page;
    try {
      let hero = await gm.eval(id => __scb.effectView(id), ids.hero);
      let goblin = await gm.eval(id => __scb.effectView(id), ids.goblin);
      const blessing = hero.find(e => e.label === "Test Blessing");
      check(blessing?.ring && blessing.pct === "100%", `the 3-round effect should have a full ring: ${JSON.stringify(hero)}`);
      check(goblin.length === 1 && !goblin[0].ring, `the goblin should show Poisoned, without a ring: ${JSON.stringify(goblin)}`);

      await gm.eval(() => __scb.nextRound());
      hero = await gm.eval(id => __scb.effectView(id), ids.hero);
      const after = hero.find(e => e.label === "Test Blessing");
      check(after?.pct === "67%", `a round later the ring should be at two thirds: ${after?.pct}`);

      // Tooltip lists it.
      await page.hover(`#scb-root .scb-portrait[data-combatant-id="${ids.hero}"]`);
      await page.waitForTimeout(900);
      const tipBox = page.locator("#tooltip.scb-tooltip");
      const tip = await tipBox.innerText().catch(() => "");
      check(/Test Blessing/.test(tip), `the tooltip doesn't list the effect: ${JSON.stringify(tip)}`);
      check(tip.includes("the Blessed One"), "a @UUID link in the description didn't read as its label");
      check(!/@(UUID|Embed)\[/.test(tip), `raw enricher syntax reached the tooltip: ${JSON.stringify(tip)}`);
      check(tip.includes(ids.embedded), `the embedded item's text isn't in the tooltip (expected "${ids.embedded}")`);
      const overflow = await tipBox.evaluate(el => el.scrollWidth - el.clientWidth).catch(() => 0);
      check(overflow <= 1, `the tooltip scrolls sideways by ${overflow}px`);
      await page.mouse.move(5, 700);

      // A player sees the goblin's condition too: it's on the token for everyone.
      const player = await Session.open({ user: PLAYER_USER });
      try {
        await loadSuites(player);
        const seen = await player.eval(id => __scb.effectView(id), ids.goblin);
        check(seen.length === 1, `a player should see the goblin's condition: ${JSON.stringify(seen)}`);
      } finally {
        await player.close({ shutDownWorld: false });
      }

      // Right-click, confirm: gone.
      await page.click(`#scb-root .scb-portrait[data-combatant-id="${ids.goblin}"] .scb-effect`, { button: "right" });
      const yes = page.locator('.application.dialog button[data-action="yes"]');
      await yes.waitFor({ timeout: 5000 });
      await yes.click();
      goblin = await gm.eval(id => __scb.effectView(id), ids.goblin);
      check(goblin.length === 0, "right-click and confirm didn't remove the condition");
      const menu = await page.locator("#context-menu").count();
      check(menu === 0, "right-clicking an effect also opened the portrait's context menu");
    } finally {
      await gm.eval(id => __scb.effectsTeardown(id), ids.hero);
    }
    return { pass: !failures.length, failures, lines: failures };
  },

  /** A BG3 group turn played by a real player: out of order, handed on, then left behind. */
  async groupTurns(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const { heroes: [h0, h1, h2], goblins: [g0] } = await gm.eval(() => __scb.groupSetup());
    const player = await Session.open({ user: PLAYER_USER });
    try {
      await loadSuites(player);
      let v = await player.eval(() => __scb.groupView());
      check(v.current === h0, "the group turn should start with the first hero");
      check(v.classes[h2]?.includes("can-take-turn"), `the player should be able to send in the third hero: ${v.classes[h2]}`);
      check(!v.classes[g0]?.includes("in-active-run"), "a goblin is marked as part of the heroes' turn");

      // Out of order: the player sends in the third hero.
      await player.eval(id => __scb.clickPortrait(id), h2);
      v = await player.eval(() => __scb.groupView());
      check(v.current === h2, `clicking the third hero didn't make them act (current ${v.current})`);
      check(v.classes[h0]?.includes("in-active-run") && !v.classes[h0]?.includes("is-current"),
        "the first hero should wait in the run, not be current");

      // The player ends the third hero's turn: it wraps back to the first hero, who waited.
      await player.eval(() => __scb.pressEndTurn());
      v = await player.eval(() => __scb.groupView());
      check(v.current === h0, `ending the third hero should hand the turn to the first (current ${v.current})`);
      check(v.classes[h2]?.includes("is-ended"), "the third hero isn't marked as ended");
      check(v.economy[h0]?.action === true, "the first hero got their Action back by stepping away and back");

      // The player can't send in a goblin by asking the GM directly.
      const sneaky = await player.eval(id => __scb.sneakyActivate(id), g0);
      check(sneaky === false, "the GM let a player send in a goblin");

      // The GM ends the first hero, then the second: the turn leaves the run for the goblins.
      await gm.eval(() => __scb.gmEndTurn());
      v = await gm.eval(() => __scb.groupView());
      check(v.current === h1, `after the first hero, the second should act (current ${v.current})`);
      await gm.eval(() => __scb.gmEndTurn());
      v = await gm.eval(() => __scb.groupView());
      check(v.current === g0, `once all three are done the turn should move to the goblins (current ${v.current})`);
    } finally {
      await player.close({ shutDownWorld: false });
      await gm.eval(() => __scb.groupTeardown());
    }
    return { pass: !failures.length, failures, lines: failures };
  },

  /** Legendary badges: shown to the GM, clickable, follow dnd5e's own spending, hidden from players. */
  async legendary(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const ids = await gm.eval(() => __scb.legendarySetup());
    const view = () => gm.eval(id => __scb.legendaryView(id), ids.dragon);
    const badge = kind => `#scb-root .scb-portrait[data-combatant-id="${ids.dragon}"] .scb-leg-${kind}`;

    let v = await view();
    check(v.actions === "3" && v.resistances === "3", `dragon should show 3 and 3: ${JSON.stringify(v)}`);
    await gm.page.click(badge("actions"));
    v = await view();
    check(v.actions === "2", `click didn't spend a legendary action: ${v.actions}`);
    await gm.page.click(badge("actions"), { modifiers: ["Shift"] });
    v = await view();
    check(v.actions === "3", `Shift-click didn't give it back: ${v.actions}`);
    await gm.page.click(badge("resistances"));
    v = await view();
    check(v.resistances === "2", `click didn't spend a legendary resistance: ${v.resistances}`);

    if ( ids.activity ) {
      await gm.eval(uuid => __scb.useActivity(uuid), ids.activity);
      v = await view();
      check(v.actions === "2", `using a legendary ability didn't show on the badge: ${v.actions}`);
    } else failures.push("the dragon has no legendary-costing activity to test with");

    const player = await Session.open({ user: PLAYER_USER });
    try {
      await loadSuites(player);
      const pv = await player.eval(id => __scb.legendaryView(id), ids.dragon);
      check(pv.actions === null && pv.resistances === null, `a player can see the dragon's badges: ${JSON.stringify(pv)}`);
    } finally {
      await player.close({ shutDownWorld: false });
    }
    await gm.eval(() => __scbFixtures.cleanup());
    return { pass: !failures.length, failures, lines: failures };
  },

  /** Pips spend on use, flip on click, show the reaction everywhere, and reset on the turn. */
  async economy(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const ids = await gm.eval(() => __scb.economySetup());
    const pips = () => gm.eval(list => __scb.pipView(list), [ids.hero, ids.other]);

    let view = await pips();
    check(JSON.stringify(view[ids.hero]) === JSON.stringify({ action: "available", bonus: "available", reaction: "available" }),
      `current card should show three available pips: ${JSON.stringify(view[ids.hero])}`);
    check(view[ids.other].action === null && view[ids.other].bonus === null && view[ids.other].reaction === "available",
      `other cards should show only the reaction: ${JSON.stringify(view[ids.other])}`);

    if ( ids.activity ) {
      await gm.eval(uuid => __scb.useActivity(uuid, false), ids.activity);
      view = await pips();
      check(view[ids.hero].action === "spent", `using an action didn't spend the Action pip: ${JSON.stringify(view[ids.hero])}`);
      check(view[ids.hero].bonus === "available", "using an action touched the Bonus Action pip");
    } else failures.push("no action-costing activity on the first hero to test auto-spend with");

    await gm.page.click(`#scb-root .scb-portrait[data-combatant-id="${ids.hero}"] .scb-pip-bonus`);
    view = await pips();
    check(view[ids.hero].bonus === "spent", "clicking the Bonus Action pip didn't spend it");

    // A full round later it's the hero's turn again: everything is back.
    await gm.eval(n => __scb.advance(n), ids.turns);
    view = await pips();
    check(Object.values(view[ids.hero]).every(s => s === "available"),
      `pips didn't reset at the start of the hero's next turn: ${JSON.stringify(view[ids.hero])}`);

    await gm.eval(() => __scbFixtures.cleanup());
    return { pass: !failures.length, failures, lines: failures };
  },

  /** Shrinking the window shrinks the portraits; the bar never overflows its space. */
  async responsive(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const page = gm.page;
    const original = page.viewportSize();
    // Fit to width is what's under test; the default is now Scroll sideways.
    const before = await gm.eval(() => game.settings.get("sogrom-simple-combat-bar", "overflow"));
    await gm.eval(() => __scb.setTrackerSettings({ overflow: "autofit" }));
    await gm.eval(() => __scbFixtures.freshCombat({ allies: 4, enemies: 10 }));
    const wide = await gm.eval(() => __scb.barMetrics());
    await page.setViewportSize({ width: 1100, height: original.height });
    const narrow = await gm.eval(() => __scb.barMetrics());
    await page.setViewportSize(original);
    const back = await gm.eval(() => __scb.barMetrics());

    // The reported bug: at around ten combatants the portraits stopped shrinking and the bar ran off.
    // Add combatants at a full-HD window; the bar and its tabs must always fit, or scroll, never clip.
    await page.setViewportSize({ width: 1920, height: original.height });
    const sizes = [];
    for ( const n of [6, 8, 9, 10, 11, 12, 14, 16] ) {
      const m = await gm.eval(k => __scb.metricsAt(k), n);
      sizes.push(`${n}:${m.size}`);
      const inside = (m.tabsLeft >= m.hostLeft - 1) && (m.tabsRight <= m.hostRight + 1)
        && (m.tabsLeft >= m.sceneNavRight) && (m.tabsRight <= m.sidebarLeft);
      check(inside, `${n} combatants: the bar and tabs run outside their space (${Math.round(m.tabsLeft)}..${
        Math.round(m.tabsRight)}; scene pill ends ${Math.round(m.sceneNavRight)}, sidebar starts ${Math.round(m.sidebarLeft)})`);
      check((m.trackContent <= m.trackWidth + 1) || m.scrollable, `${n} combatants: cards clipped without scrolling`);
    }

    // The reported case: "Scroll sideways", 100px portraits, 12 combatants, an 1180px window. The
    // track's px width stretched #interface to 1860px and pushed the sidebar off screen.
    await page.setViewportSize({ width: 1180, height: original.height });
    const sc = await gm.eval(() => __scb.scrollModeCheck());
    check(sc.interfaceWidth <= sc.window + 1, `scroll mode stretched the interface to ${sc.interfaceWidth}px in a ${sc.window}px window`);
    check(sc.sidebarRight <= sc.window + 1, `scroll mode pushed the sidebar off screen (right edge ${sc.sidebarRight})`);
    check(sc.scrollable, "scroll mode isn't scrolling");
    check((sc.tabsLeft >= sc.sceneNavRight) && (sc.tabsRight <= sc.sidebarLeft),
      "scroll mode: the bar runs over the scene pill or the sidebar");
    await page.setViewportSize(original);

    check(narrow.size < wide.size, `portraits didn't shrink with the window (${wide.size}px -> ${narrow.size}px)`);
    // Either everything fits, or (at the smallest portrait size) the track scrolls: never clipped.
    const fits = narrow.trackContent <= narrow.trackWidth + 1;
    check(fits || narrow.scrollable, `cards are clipped when narrow (${narrow.trackContent} > ${narrow.trackWidth}, not scrollable)`);
    check(back.overflow === "autofit", `still scrolling after the window grew back (${back.overflow})`);
    check((narrow.barLeft >= narrow.hostLeft - 1) && (narrow.barRight <= narrow.hostRight + 1), "the bar spills out of its space when narrow");
    check(narrow.tabsLeft >= narrow.sceneNavRight, `when narrow the GM tabs cover the scene pill (${Math.round(narrow.tabsLeft)} < ${Math.round(narrow.sceneNavRight)})`);
    check(back.size === wide.size, `portraits didn't grow back (${back.size}px, was ${wide.size}px)`);
    await gm.eval(() => __scbFixtures.cleanup());
    await gm.eval(v => __scb.setTrackerSettings({ overflow: v }), before);
    return { pass: !failures.length, failures,
      lines: [`portrait size ${wide.size} -> ${narrow.size} -> ${back.size}px; narrow mode ${narrow.overflow}`,
        `at 1920px, combatants:size ${sizes.join(" ")}`, ...failures] };
  },

  /** Configure the trackers through their real window, then check the bars and the tooltip. */
  async trackers(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const ids = await gm.eval(() => __scb.trackersSetup());
    const page = gm.page;
    const lines = [`bar attributes offered: ${ids.bars.join(", ")}`];

    // Real window: pick the second bar, add a tooltip row, save.
    await gm.eval(() => __scb.openTrackers());
    const form = page.locator("#scb-trackers-config");
    await form.waitFor({ timeout: 10_000 });
    const choice = ids.bars.includes("resources.legact") ? "resources.legact" : null;
    if ( choice ) await form.locator('select[name="secondaryResource"]').selectOption(choice);
    await form.locator('button[data-action="addRow"]').click();
    await form.locator('[name="rows.0.attr"]').fill("attributes.ac.value");
    await form.locator('[name="rows.0.label"]').fill("Armour");
    await form.locator('button[type="submit"]').click();
    await form.waitFor({ state: "detached", timeout: 10_000 });

    let s = await gm.eval(i => __scb.trackersState(i), ids);
    check(s.settings.tooltipAttributes[0]?.attr === "attributes.ac.value", "tooltip row not saved from the window");
    if ( !choice ) {
      failures.push("resources.legact is not offered as a bar attribute; set directly for the rest of the suite");
      await gm.eval(() => __scb.setTrackerSettings({ secondaryResource: "resources.legact" }));
      s = await gm.eval(i => __scb.trackersState(i), ids);
    }
    check(s.settings.secondaryResource === "resources.legact", `second bar is "${s.settings.secondaryResource}"`);
    check(s.dragon.bar2Shown && (s.dragon.bar2Empty === false), "dragon's legendary-action bar isn't showing");
    check(s.dragon.bar2Pct === "100%", `dragon's legendary actions at ${s.dragon.bar2Pct}, expected 100%`);
    check(s.hero.bar2Shown && (s.hero.bar2Empty === true), "a hero without legendary actions should keep an empty slot");

    // Hover tooltip carries the configured value.
    await page.hover(`#scb-root .scb-portrait[data-combatant-id="${ids.hero}"]`);
    await page.waitForTimeout(900);
    const tip = await page.locator("#tooltip.scb-tooltip").innerText().catch(() => "");
    check(/Armour/.test(tip), `tooltip doesn't show the configured value: ${JSON.stringify(tip)}`);
    const labelled = await gm.eval(() => dnd5e.utils.getHumanReadableAttributeLabel("resources.legact.value"));
    lines.push(`dnd5e names resources.legact "${await gm.eval(k => game.i18n.localize(k), labelled)}"`);
    await page.mouse.move(5, 500);

    // HP bar switch.
    await gm.eval(() => __scb.setTrackerSettings({ hpBar: false }));
    s = await gm.eval(i => __scb.trackersState(i), ids);
    check(s.hero.hpEmpty === true, "HP bar still showing with the switch off");
    await gm.eval(() => __scb.resetTrackers());
    await gm.eval(() => __scbFixtures.cleanup());
    return { pass: !failures.length, failures, lines: [...lines, ...failures] };
  },

  /** Saving our settings in core's window never asks for a reload; the dnd5e calendar steps aside. */
  async settingsUi(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const page = gm.page;

    // One save first, and dismiss whatever it asks. Core prompts for a reload on the first save
    // in a fresh browser because `core.performanceMode` has never been stored, so any value
    // looks like a change to it. That's core's, and it's why the second save below is the test.
    const open = () => gm.eval(id => new foundry.applications.settings.SettingsConfig({ initialCategory: id })
      .render({ force: true }), MODULE_ID);
    const form = page.locator("#settings-config");
    await open();
    await form.waitFor({ timeout: 10_000 });
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(1000);
    await page.locator('#reload-world-confirm button[data-action="no"]').click().catch(() => {});
    await page.waitForTimeout(400);

    // Now change the portrait style and save: that must not ask for a reload.
    await open();
    await form.waitFor({ timeout: 10_000 });
    const select = form.locator(`select[name="${MODULE_ID}.portraitStyle"]`);
    const current = await select.inputValue();
    await select.selectOption(current === "card" ? "medallion" : "card");
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(1200);
    const prompt = await page.locator("#reload-world-confirm").count();
    check(prompt === 0, "saving the portrait style asked for a reload");
    if ( prompt ) await page.locator('#reload-world-confirm button[data-action="no"]').click().catch(() => {});
    const saved = await gm.eval(id => game.settings.get(id, "portraitStyle"), MODULE_ID);
    check(saved !== current, "the portrait style didn't save");
    await gm.eval(([id, v]) => game.settings.set(id, "portraitStyle", v), [MODULE_ID, current]);

    // The calendar hides from the initiative roll on, and comes back after the combat.
    await gm.eval(() => __scb.calendarSetup());
    let cal = await gm.eval(() => __scb.calendarVisible());
    check(cal.present && cal.visible, `calendar not showing before combat: ${JSON.stringify(cal)}`);
    cal = await gm.eval(() => __scb.startTestCombat(false));
    check(!cal.visible, "calendar still showing while initiative is rolled");
    await gm.eval(() => __scb.endTestCombat());
    cal = await gm.eval(() => __scb.startTestCombat());
    check(!cal.visible, "calendar still showing during combat");
    cal = await gm.eval(() => __scb.endTestCombat());
    check(cal.visible, "calendar didn't come back after combat");
    return { pass: !failures.length, failures, lines: failures };
  },

  /** Add an event through the real dialog, then watch it count down and expire. */
  async events(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    await gm.eval(() => __scb.eventsSetup());
    const page = gm.page;

    await page.click("#scb-root .scb-tab.addEvent");
    const dialog = page.locator(".scb-event-dialog");
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.locator('[name="name"]').fill("Collapsing Ceiling");
    await dialog.locator('[name="initiative"]').fill("30");
    await dialog.locator('[name="duration"]').fill("2");
    await dialog.locator('button[data-action="ok"]').click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });

    let s = await gm.eval(() => __scb.eventsState());
    const event = s.combatants[0];
    check(s.combatants.length === 1, `expected 1 event combatant, found ${s.combatants.length}`);
    check(event?.initiative === 30, `event initiative ${event?.initiative}`);
    check(event?.flags.duration === 2, `event duration ${event?.flags.duration}`);
    check(s.portraits[0]?.name === "Collapsing Ceiling", `event portrait name "${s.portraits[0]?.name}"`);
    check(s.portraits[0]?.rounds === "2", `rounds badge shows "${s.portraits[0]?.rounds}", expected 2`);
    check(s.recent[0] === "Collapsing Ceiling", "event not remembered in recent events");

    await gm.eval(() => __scb.nextRound());
    s = await gm.eval(() => __scb.eventsState());
    check(s.portraits[0]?.rounds === "1", `after one round the badge shows "${s.portraits[0]?.rounds}", expected 1`);
    check(s.expiryMessages === 0, "expiry message posted too early");

    await gm.eval(() => __scb.nextRound());
    s = await gm.eval(() => __scb.eventsState());
    check(s.combatants.length === 0, "event not removed after its duration");
    check(s.portraits.length === 0, "event portrait still on the bar");
    check(s.expiryMessages === 1, `expected exactly 1 expiry message, found ${s.expiryMessages}`);

    await gm.eval(() => __scbFixtures.cleanup());
    return { pass: !failures.length, failures, lines: failures };
  },

  /**
   * A Death Tyrant erupting on count 0 of round 2: scheduled from the portrait's menu, skipped in
   * round 1 (forwards and back), unseen by the player, then revealed as its turn comes in round 2.
   */
  async arrivals(gm) {
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    const { tyrant } = await gm.eval(() => __scb.arrivalsSetup());
    const page = gm.page;
    const state = () => gm.eval(id => __scb.arrivalsState(id), tyrant);
    let player = null;
    try {
      // Schedule it through the real menu and dialog.
      await page.click(`#scb-root .scb-portrait[data-combatant-id="${tyrant}"]`, { button: "right" });
      await page.locator("#context-menu .context-item", { hasText: "Arrives in Round" }).click();
      const dialog = page.locator('.application.dialog:has([name="round"])');
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.locator('[name="round"]').fill("2");
      await dialog.locator('button[data-action="ok"]').click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 });

      let s = await state();
      check(s.arrival?.round === 2, `arrival not stored: ${JSON.stringify(s.arrival)}`);
      check(s.hidden === true, "scheduled combatant isn't hidden from players");
      check(s.tokenHidden === true, "scheduled combatant's token still shows on the map");
      check(s.waiting === true, "GM's card isn't marked as waiting");
      check(s.badge === "R2", `badge reads "${s.badge}", expected R2`);

      await gm.eval(() => __scb.startCombat());
      player = await Session.open({ user: PLAYER_USER });
      await loadSuites(player);
      let view = await player.eval(() => __scb.playerView());
      check(!view.portraits.some(p => p.id === tyrant), "player sees the tyrant before it arrives");

      // Round 1: four turns take the pointer past the last combatant here, and on into round 2.
      await gm.eval(n => __scb.advance(n), 4);
      s = await state();
      check((s.round === 2) && (s.turn === 0), `round 1's tyrant turn wasn't skipped: round ${s.round}, turn ${s.turn}`);
      check(s.hidden === true, "tyrant revealed before its turn in round 2");

      // Stepping back from the top of round 2 skips it too.
      await gm.eval(() => __scb.previousTurn());
      s = await state();
      check((s.round === 1) && (s.turn === 3), `previous turn landed on round ${s.round}, turn ${s.turn}`);
      await gm.eval(n => __scb.advance(n), 1);

      // Round 2, count 0: it arrives.
      await gm.eval(n => __scb.advance(n), 4);
      s = await state();
      check(s.current === tyrant, `round 2's last turn isn't the tyrant's: ${s.current}`);
      check(s.hidden === false, "tyrant still hidden on its turn in round 2");
      check(s.tokenHidden === false, "tyrant's token still hidden on the map");
      check(s.arrival === null, `arrival flag not cleared: ${JSON.stringify(s.arrival)}`);
      check(s.waiting === false, "GM's card still marked as waiting");
      check(s.whispers === 1, `expected 1 arrival whisper, found ${s.whispers}`);
      view = await player.eval(() => __scb.playerView());
      check(view.portraits.some(p => p.id === tyrant), "player doesn't see the tyrant once it has arrived");
    } finally {
      if ( player ) await player.close({ shutDownWorld: false });
      await gm.eval(() => __scbFixtures.cleanup());
    }
    return { pass: !failures.length, failures, lines: failures };
  },

  /** The GM builds the combat; a second browser, logged in as the player, checks what it sees. */
  async permissions(gm) {
    // Before the combat starts: the player must see the bar, with a d20 on their own characters.
    await gm.eval(() => __scb.unstartedCombat());
    const player = await Session.open({ user: PLAYER_USER });
    const failures = [];
    const check = (ok, message) => ok || failures.push(message);
    try {
      await loadSuites(player);
      const before = await player.eval(() => __scb.playerRollView());
      check(before.visible, "player doesn't see the bar before the combat starts");
      check(before.canRoll.length === 2, `player should get a d20 on their 2 heroes, got ${before.canRoll.length}`);

      const setup = await gm.eval(() => __scb.permissionsSetup());
      await gm.eval(id => __scb.setTurn(id), setup.goblins[0]);
      let view = await player.eval(() => __scb.playerView());
      check(view.visible, "player doesn't see the bar");
      check(view.gmControls === false, "player sees GM controls");
      check(view.endTurnShown === false, "player sees End Turn on a goblin's turn");
      const goblin = view.portraits.find(p => p.id === setup.goblins[0]);
      check(goblin?.name === view.unknownName, `goblin name shown to player: "${goblin?.name}"`);
      // Players never receive an unlinked token's HP; the state comes from dnd5e's Bloodied status,
      // so a 2/7 goblin reads "bloodied" with a half fill rather than an exact 71%.
      check(goblin?.damage === "50%", `goblin damage fill should be the bloodied band: ${goblin?.damage}`);
      check(goblin?.hpState === "bloodied", `goblin health state: ${goblin?.hpState}`);
      check(goblin?.hpBarHidden === true, "player sees an HP bar for a goblin they only know the state of");
      const hero = view.portraits.find(p => p.id === setup.heroes[0]);
      check(hero && (hero.name !== view.unknownName), "player can't see their own hero's name");

      await gm.eval(id => __scb.setTurn(id), setup.heroes[0]);
      view = await player.eval(() => __scb.playerView());
      check(view.endTurnShown === true, "player doesn't see End Turn on their own turn");
      const after = await player.eval(() => __scb.playerEndTurn());
      check(after.current !== setup.heroes[0], "player's End Turn didn't advance the turn");
      return { pass: !failures.length, failures, lines: failures };
    } finally {
      await player.close({ shutDownWorld: false });
      await gm.eval(() => __scbFixtures.cleanup());
    }
  }
};

/** Side-by-side lifecycle and budget numbers for the two subjects. */
function compare(scb, ctd) {
  console.log("\n=== Simple Combat Bar vs combat-tracker-dock ===");
  const row = (label, a, b, fmt = sign) => console.log(`  ${label.padEnd(34)} ${fmt(a).padStart(12)} ${fmt(b).padStart(12)}`);
  console.log(`  ${"".padEnd(34)} ${"ours".padStart(12)} ${"CTD".padStart(12)}`);
  if ( scb.lifecycle?.delta && ctd.lifecycle?.delta ) {
    const [a, b] = [scb.lifecycle.delta, ctd.lifecycle.delta];
    row("retained hooks", a.hooks, b.hooks);
    row("retained window listeners", a.windowListeners, b.windowListeners);
    row("retained document listeners", a.documentListeners, b.documentListeners);
    row("retained #ui-top listeners", a.uiTopListeners, b.uiTopListeners);
    row("retained DOM elements", a.dom, b.dom);
    row("live bar instances after GC", a.barInstances, b.barInstances, String);
    row("live portrait instances after GC", a.portraitInstances, b.portraitInstances, String);
    row("heap change (incl. world data)", a.heapBytes, b.heapBytes, mb);
  }
  if ( scb.budget && ctd.budget ) {
    for ( const k of ["rollBatch", "rollEach", "damage", "nextTurn", "tenTurns"] ) {
      row(`elements created: ${k}`, scb.budget[k].created, ctd.budget[k].created, String);
    }
  }
}

function sign(n) {
  return n > 0 ? `+${n}` : String(n);
}

function mb(bytes) {
  return `${bytes >= 0 ? "+" : ""}${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* -------------------------------------------- */

const results = {};
let failed = false;


for ( const worldId of worlds ) {
  const spec = WORLDS[worldId];
  if ( !spec ) throw new Error(`Unknown world "${worldId}"`);
  console.log(`\n=== ${spec.title} (${spec.subject}) ===`);
  const server = await startFoundry(worldId);
  let gm;
  try {
    gm = await Session.open();
    await loadSuites(gm);
    const report = results[worldId] = { subject: spec.subject };
    for ( const suite of wanted ) {
      if ( SCB_ONLY.has(suite) && (spec.subject !== "scb") ) continue;
      const started = Date.now();
      try {
        const outcome = await SUITES[suite](gm, spec.subject);
        report[suite] = outcome;
        const ok = outcome.pass !== false;
        if ( !ok ) failed = true;
        console.log(`  ${ok ? "PASS" : "FAIL"}  ${suite}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
        for ( const line of outcome.lines ?? [] ) console.log(`        ${line}`);
      } catch ( err ) {
        failed = true;
        report[suite] = { pass: false, error: err.message };
        console.log(`  FAIL  ${suite}: ${err.message}\n${gm.tail(30)}`);
      }
    }
    const pageErrors = gm.consoleLog.filter(l => /\[pageerror\]|\[unhandledrejection\]/.test(l)
      && l.includes(MODULE_ID));
    if ( pageErrors.length ) {
      failed = true;
      console.log(`  FAIL  module errors in the console:\n${pageErrors.join("\n")}`);
    }
  } finally {
    if ( gm ) await gm.close();
    await server.stop();
  }
}

if ( results["playwright-combat"] && results["playwright-ctd"] ) compare(results["playwright-combat"], results["playwright-ctd"]);

fs.mkdirSync(path.join(here, "results"), { recursive: true });
const out = path.join(here, "results", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nResults: ${path.relative(process.cwd(), out)}`);
process.exit(failed ? 1 : 0);
