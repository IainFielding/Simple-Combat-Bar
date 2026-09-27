/**
 * The in-world halves of the suites. Each export runs inside the Foundry page and returns plain
 * JSON; `run.mjs` does whatever needs the DevTools protocol (heap, listener counts) around them.
 */

import { MODULE_ID, cleanup, damage, freshCombat, settle } from "./fixtures.mjs";
import { countCreated, domCount, hookCount, hookTable, portraitCount } from "./metrics.mjs";

const api = () => game.modules.get(MODULE_ID)?.api ?? null;

/** A snapshot of everything that should return to baseline after churn. */
export function snapshot(subject) {
  return {
    hooks: hookCount(),
    hookTable: hookTable(),
    dom: domCount(),
    portraits: portraitCount(subject),
    combats: game.combats.size,
    barCounts: subject === "scb" ? api()?.bar?.counts ?? null : null
  };
}

/**
 * The churn loop the lifecycle suite brackets with heap and listener measurements: a whole combat
 * from creation to deletion, `iterations` times, with turns, damage and a scene change in each.
 */
export async function churn({ iterations = 10, turns = 12 } = {}) {
  for ( let i = 0; i < iterations; i++ ) {
    const combat = await freshCombat({ allies: 3, enemies: 6 });
    for ( let t = 0; t < turns; t++ ) {
      await combat.nextTurn();
      await settle(20);
      if ( t % 4 === 0 ) {
        const target = combat.combatants.contents[t % combat.combatants.size]?.actor;
        if ( target ) await damage(target, 1);
      }
    }
    // Deactivate and reactivate: the path that made the reference module build a new dock each time.
    await combat.update({ active: false });
    await settle(20);
    await combat.update({ active: true });
    await settle(20);
    await combat.delete();
    await settle(40);
  }
  await cleanup();
  return { iterations, turns };
}

/**
 * Render budget: what one kind of change costs in DOM creation, for either subject.
 */
export async function budget(subject) {
  const results = {};
  const stats = () => (subject === "scb" ? { ...api().bar.stats } : null);
  const delta = (before, after) => (before && after
    ? Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]])) : null);

  const combat = await freshCombat({ allies: 4, enemies: 8, initiative: false, start: false });

  // Twelve initiative values arriving in one batch (what "Roll NPCs" does). Allies and enemies
  // alternate for the first eight turns, so turn changes below move the current portrait rather
  // than staying inside one BG3 team run.
  const rank = new Map();
  combat.combatants.contents.filter(c => c.actor?.type === "character").forEach((c, k) => rank.set(c.id, 30 - (2 * k)));
  combat.combatants.contents.filter(c => c.actor?.type !== "character").forEach((c, k) => rank.set(c.id, 29 - (2 * k)));
  let before = stats();
  results.rollBatch = await countCreated(async () => {
    await combat.updateEmbeddedDocuments("Combatant",
      combat.combatants.map(c => ({ _id: c.id, initiative: rank.get(c.id) })));
    await settle(250);
  });
  results.rollBatch.stats = delta(before, stats());

  // Twelve individual updates (twelve players rolling).
  before = stats();
  results.rollEach = await countCreated(async () => {
    await Promise.all(combat.combatants.map(c => c.update({ initiative: rank.get(c.id) + 0.5 })));
    await settle(250);
  });
  results.rollEach.stats = delta(before, stats());

  await combat.startCombat();
  await settle(250);

  // One actor takes damage.
  const victim = combat.combatants.find(c => c.actor?.type === "npc").actor;
  before = stats();
  results.damage = await countCreated(async () => {
    await damage(victim, 1);
    await settle(250);
  });
  results.damage.stats = delta(before, stats());

  // One turn advances.
  before = stats();
  results.nextTurn = await countCreated(async () => {
    await combat.nextTurn();
    await settle(250);
  });
  results.nextTurn.stats = delta(before, stats());

  // Ten turns in a row.
  before = stats();
  results.tenTurns = await countCreated(async () => {
    for ( let i = 0; i < 10; i++ ) {
      await combat.nextTurn();
      await settle(30);
    }
    await settle(250);
  });
  results.tenTurns.stats = delta(before, stats());

  await cleanup();
  return results;
}

/** The bar's DOM order after each turn, against what the model says it should be. */
export async function ordering() {
  const failures = [];
  const combat = await freshCombat({ allies: 3, enemies: 4 });
  const read = () => Array.from(document.querySelectorAll("#scb-root .scb-track > li"),
    li => (li.classList.contains("scb-divider") ? "|" : li.dataset.combatantId));

  for ( let step = 0; step < combat.turns.length + 2; step++ ) {
    const turns = combat.turns.map(c => c.id);
    const start = combat.turn;
    const expected = [...turns.slice(start), "|", ...turns.slice(0, start)];
    const expectedGrouped = expectedWithRuns(combat, expected);
    const actual = read();
    if ( JSON.stringify(actual) !== JSON.stringify(expectedGrouped) ) {
      failures.push({ step, turn: combat.turn, round: combat.round, expected: expectedGrouped, actual });
    }
    const current = document.querySelector(`#scb-root .scb-portrait[data-combatant-id="${combat.combatant.id}"]`);
    if ( !current?.classList.contains("is-current") ) failures.push({ step, error: "current portrait not marked" });
    const round = document.querySelector("#scb-root .scb-round-value")?.textContent;
    if ( round !== String(combat.round) ) failures.push({ step, error: `round shows ${round}, combat is ${combat.round}` });
    await combat.nextTurn();
    await settle(80);
  }
  await cleanup();
  return { failures };
}

/**
 * With BG3 grouping, the bar starts at the first member of the current run rather than at the
 * pointer. Derive that from the DOM's run markers rather than re-implementing the model here.
 */
function expectedWithRuns(combat, expected) {
  const first = document.querySelector("#scb-root .scb-portrait.is-current");
  if ( !first?.dataset.run ) return expected;
  const runIds = Array.from(document.querySelectorAll(`#scb-root .scb-portrait[data-run="${first.dataset.run}"]`),
    li => li.dataset.combatantId);
  const turns = combat.turns.map(c => c.id);
  const start = Math.min(...runIds.map(id => turns.indexOf(id)));
  return [...turns.slice(start), "|", ...turns.slice(0, start)];
}

/* -------------------------------------------- */
/*  Permissions (GM half and player half)       */
/* -------------------------------------------- */

/** GM: a combat with the player's party and goblins; returns ids the player half checks. */
export async function permissionsSetup() {
  const combat = await freshCombat({ allies: 2, enemies: 2, enemyNames: ["Goblin"] });
  const heroes = combat.combatants.filter(c => c.actor?.type === "character").map(c => c.id);
  const goblins = combat.combatants.filter(c => c.actor?.type === "npc").map(c => c.id);
  // Wound a goblin so its fill is visible, and to a value that isn't a band edge (2 of 7 HP left).
  const goblin = combat.combatants.get(goblins[0]).actor;
  await goblin.update({ "system.attributes.hp.value": 2 });
  await settle(100);
  return { combatId: combat.id, heroes, goblins };
}

/** GM: point the turn at a combatant. */
export async function setTurn(combatantId) {
  const combat = game.combat;
  await combat.update({ turn: combat.turns.findIndex(c => c.id === combatantId) });
  await settle(150);
  return combat.combatant.id;
}

/** Player: what this user sees on the bar. */
export async function playerView() {
  await settle(150);
  const root = document.getElementById("scb-root");
  const portraits = Array.from(root?.querySelectorAll(".scb-portrait") ?? [], li => ({
    id: li.dataset.combatantId,
    name: li.querySelector(".scb-name")?.textContent ?? null,
    hpState: li.dataset.hp ?? null,
    hpHidden: li.querySelector(".scb-hp")?.hidden ?? null,
    damage: li.querySelector(".scb-damage")?.style.getPropertyValue("--scb-damage-pct") ?? null,
    initiative: li.querySelector(".scb-init")?.textContent ?? null
  }));
  return {
    visible: !!root && !root.hidden,
    gmControls: root ? getComputedStyle(root.querySelector(".scb-tabs")).display !== "none" : null,
    endTurnShown: root ? !root.querySelector(".scb-endturn").hidden : null,
    unknownName: game.i18n.localize("COMBATANT.Unknown"),
    portraits
  };
}

/** Player: click End Turn. Returns the combat's turn afterwards. */
export async function playerEndTurn() {
  document.querySelector("#scb-root .scb-endturn").click();
  await settle(300);
  return { turn: game.combat.turn, current: game.combat.combatant?.id };
}
