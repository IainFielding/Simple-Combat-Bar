/**
 * Run the end-to-end suites.
 *
 *   node run.mjs                                     # playwright-combat, every suite
 *   node run.mjs playwright-combat playwright-ctd    # both worlds; prints a comparison
 *   node run.mjs playwright-combat --suites=lifecycle,budget
 *   node run.mjs --iterations=20                      # longer churn for the lifecycle suite
 *
 * Suites: lifecycle, budget, ordering, permissions. The CTD world runs lifecycle and budget only —
 * the others test behaviour that is ours.
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
const wanted = option("suites", "lifecycle,budget,ordering,permissions").split(",");
const iterations = Number(option("iterations", 10));

/** Suites that only make sense for this module. */
const SCB_ONLY = new Set(["ordering", "permissions"]);

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

  /** The GM builds the combat; a second browser, logged in as the player, checks what it sees. */
  async permissions(gm) {
    const setup = await gm.eval(() => __scb.permissionsSetup());
    const player = await Session.open({ user: PLAYER_USER });
    const failures = [];
    try {
      await loadSuites(player);
      const check = (ok, message) => ok || failures.push(message);

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
