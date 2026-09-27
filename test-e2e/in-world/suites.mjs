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

  const barBox = () => {
    const r = document.querySelector("#scb-root .scb-bar").getBoundingClientRect();
    return { left: Math.round(r.left * 10) / 10, width: Math.round(r.width * 10) / 10 };
  };
  const firstBox = barBox();

  for ( let step = 0; step < combat.turns.length + 2; step++ ) {
    const box = barBox();
    if ( (box.left !== firstBox.left) || (box.width !== firstBox.width) ) {
      failures.push({ step, error: `the bar moved: ${JSON.stringify(firstBox)} -> ${JSON.stringify(box)}` });
    }
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
    hpBarHidden: li.querySelector(".scb-hp")?.classList.contains("is-empty") ?? null,
    damage: li.querySelector(".scb-damage")?.style.getPropertyValue("--scb-damage-pct") ?? null,
    initiative: li.querySelector(".scb-init")?.textContent ?? null
  }));
  return {
    visible: !!root && !root.hidden,
    gmControls: root ? getComputedStyle(root.querySelector(".scb-tabs")).display !== "none" : null,
    endTurnShown: root ? !root.querySelector(".scb-endturn").hidden : null,
    unknownName: game.i18n.localize(`${MODULE_ID}.unknown`),
    portraits
  };
}

/** Player: click End Turn. Returns the combat's turn afterwards. */
export async function playerEndTurn() {
  document.querySelector("#scb-root .scb-endturn").click();
  await settle(300);
  return { turn: game.combat.turn, current: game.combat.combatant?.id };
}

/* -------------------------------------------- */
/*  Events                                      */
/* -------------------------------------------- */

/** GM: a started combat to add events to. Clears the chat so expiry messages can be counted. */
export async function eventsSetup() {
  const ids = game.messages.map(m => m.id);
  if ( ids.length ) await ChatMessage.deleteDocuments(ids);
  await freshCombat({ allies: 2, enemies: 2 });
  return { round: game.combat.round };
}

/** The event portraits on the bar, and the event combatants in the combat. */
export async function eventsState() {
  await settle(150);
  const combat = game.combat;
  return {
    round: combat.round,
    combatants: combat.combatants.filter(c => c.flags?.[MODULE_ID]?.event)
      .map(c => ({ id: c.id, name: c.name, initiative: c.initiative, flags: c.flags[MODULE_ID] })),
    portraits: Array.from(document.querySelectorAll("#scb-root .scb-portrait.is-event"), li => ({
      id: li.dataset.combatantId,
      name: li.querySelector(".scb-name")?.textContent,
      rounds: li.querySelector(".scb-rounds")?.textContent ?? null
    })),
    expiryMessages: game.messages.filter(m => m.content?.includes("Collapsing Ceiling")).length,
    recent: game.settings.get(MODULE_ID, "recentEvents").map(e => e.name)
  };
}

/** GM: next round. */
export async function nextRound() {
  await game.combat.nextRound();
  await settle(300);
}

/* -------------------------------------------- */
/*  Trackers                                    */
/* -------------------------------------------- */

/** GM: a combat with the dragon (legendary actions) and the party; the bar choices on offer. */
export async function trackersSetup() {
  await game.settings.set(MODULE_ID, "tooltipAttributes", []);
  await game.settings.set(MODULE_ID, "secondaryResource", "");
  await game.settings.set(MODULE_ID, "hpBar", true);
  const combat = await freshCombat({ allies: 2, enemies: 1, enemyNames: ["Adult Red Dragon"] });
  const tracked = TokenDocument.implementation.getTrackedAttributes();
  return {
    dragon: combat.combatants.find(c => c.actor?.type === "npc").id,
    hero: combat.combatants.find(c => c.actor?.type === "character").id,
    bars: tracked.bar.map(p => p.join("."))
  };
}

/** Open the Configure Trackers window the way the settings button does. */
export async function openTrackers() {
  const menu = game.settings.menus.get(`${MODULE_ID}.trackers`);
  await new menu.type().render({ force: true });
  await settle(200);
}

/** The second bar, HP bar and settings as they stand. */
export async function trackersState(ids) {
  await settle(200);
  const bar = id => document.querySelector(`#scb-root .scb-portrait[data-combatant-id="${id}"]`);
  const read = id => {
    const li = bar(id);
    return {
      bar2Empty: li?.querySelector(".scb-bar2")?.classList.contains("is-empty") ?? null,
      bar2Pct: li?.querySelector(".scb-bar2")?.style.getPropertyValue("--scb-bar2-pct") ?? null,
      bar2Shown: li ? getComputedStyle(li.querySelector(".scb-bar2")).display !== "none" : null,
      hpEmpty: li?.querySelector(".scb-hp")?.classList.contains("is-empty") ?? null
    };
  };
  return {
    dragon: read(ids.dragon),
    hero: read(ids.hero),
    settings: {
      secondaryResource: game.settings.get(MODULE_ID, "secondaryResource"),
      tooltipAttributes: game.settings.get(MODULE_ID, "tooltipAttributes")
    }
  };
}

/** Put the trackers back as a fresh world has them (tooltip values at the system's defaults). */
export async function resetTrackers() {
  const defaults = game.settings.settings.get(`${MODULE_ID}.tooltipAttributes`).default;
  await setTrackerSettings({ hpBar: true, secondaryResource: "", tooltipAttributes: defaults });
}

export async function setTrackerSettings(values) {
  for ( const [k, v] of Object.entries(values) ) await game.settings.set(MODULE_ID, k, v);
  await settle(200);
}

/* -------------------------------------------- */
/*  Settings window and the dnd5e calendar      */
/* -------------------------------------------- */

/** Turn dnd5e's calendar HUD on, so there is something to hide. */
export async function calendarSetup() {
  const config = game.settings.get("dnd5e", "calendarConfig");
  await game.settings.set("dnd5e", "calendarConfig", { ...config, enabled: true });
  const prefs = game.settings.get("dnd5e", "calendarPreferences");
  await game.settings.set("dnd5e", "calendarPreferences", { ...prefs, visible: true });
  await dnd5e.ui.calendar?.render({ force: true });
  await settle(300);
}

/** Whether the calendar HUD is in the page and visible. */
export function calendarVisible() {
  const el = document.getElementById("calendar-hud");
  return { present: !!el, visible: !!el && (getComputedStyle(el).display !== "none") };
}

export async function startTestCombat() {
  await freshCombat({ allies: 2, enemies: 2 });
  return calendarVisible();
}

export async function endTestCombat() {
  await cleanup();
  await settle(200);
  return calendarVisible();
}

/* -------------------------------------------- */
/*  Before the start, and resizing              */
/* -------------------------------------------- */

/** GM: a combat that hasn't started and has no initiative rolled yet. */
export async function unstartedCombat() {
  await freshCombat({ allies: 2, enemies: 2, initiative: false, start: false });
  return game.combat.id;
}

/** Player: whether the bar shows, and which portraits offer this user a d20. */
export async function playerRollView() {
  await settle(300);
  const root = document.getElementById("scb-root");
  return {
    visible: !!root && !root.hidden,
    canRoll: Array.from(document.querySelectorAll("#scb-root .scb-portrait.can-roll"), li => li.dataset.combatantId)
  };
}

/** The bar's measurements, for the resize check. */
export async function barMetrics() {
  await settle(400);
  const root = document.getElementById("scb-root");
  const track = root.querySelector(".scb-track");
  const host = root.parentElement.getBoundingClientRect();
  const bar = root.querySelector(".scb-bar").getBoundingClientRect();
  return {
    size: parseFloat(root.style.getPropertyValue("--scb-size")),
    overflow: root.dataset.overflow,
    scrollable: getComputedStyle(track).overflowX === "auto",
    trackWidth: track.clientWidth,
    trackContent: track.scrollWidth,
    barLeft: bar.left, barRight: bar.right, hostLeft: host.left, hostRight: host.right,
    // The GM tabs stick out of the bar's ends; they have to fit too.
    tabsLeft: root.querySelector(".scb-tabs-start")?.getBoundingClientRect().left ?? bar.left,
    tabsRight: root.querySelector(".scb-tabs-end")?.getBoundingClientRect().right ?? bar.right,
    sceneNavRight: document.getElementById("scene-navigation")?.getBoundingClientRect().right ?? 0,
    sidebarLeft: document.getElementById("sidebar")?.getBoundingClientRect().left ?? innerWidth
  };
}

/**
 * GM: the reported case. "Scroll sideways" with large portraits and a crowded fight: the page's
 * interface layer must stay the window's width, and the sidebar on screen.
 */
export async function scrollModeCheck() {
  const id = MODULE_ID;
  const before = { overflow: game.settings.get(id, "overflow"), size: game.settings.get(id, "portraitSize") };
  await game.settings.set(id, "overflow", "scroll");
  await game.settings.set(id, "portraitSize", 100);
  await freshCombat({ allies: 4, enemies: 8 });
  const m = await barMetrics();
  const iface = document.getElementById("interface").getBoundingClientRect();
  const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
  await game.settings.set(id, "overflow", before.overflow);
  await game.settings.set(id, "portraitSize", before.size);
  return { ...m, window: innerWidth, interfaceWidth: Math.round(iface.width), sidebarRight: Math.round(sidebar?.right ?? 0) };
}

/** GM: a combat of `n` combatants, then the bar's measurements. */
export async function metricsAt(n) {
  await freshCombat({ allies: 4, enemies: Math.max(0, n - 4) });
  return { n, ...(await barMetrics()) };
}

/* -------------------------------------------- */
/*  Action economy                              */
/* -------------------------------------------- */

/** GM: a combat with the party first; the current hero's action-costing activity. */
export async function economySetup() {
  const combat = await freshCombat({ allies: 2, enemies: 2 });
  const hero = combat.combatant;
  const activity = hero.actor.items.contents.flatMap(i => i.system.activities?.contents ?? [])
    .find(a => a.activation?.type === "action");
  return { hero: hero.id, other: combat.turns[1].id, activity: activity?.uuid ?? null, turns: combat.turns.length };
}

/**
 * Use an activity without dialogs or chat, as a player clicking it would.
 * @param {string} uuid
 * @param {boolean} [consume=true]  Spend its uses, slots or ammunition. The world persists between
 *   runs, so a test that only needs the use itself passes false: otherwise the hero runs out of
 *   spell slots or arrows after a few runs and dnd5e refuses the activity.
 */
export async function useActivity(uuid, consume = true) {
  const activity = await fromUuid(uuid);
  await activity.use(consume ? {} : { consume: false }, { configure: false }, { create: false });
  await settle(300);
}

/** Each portrait's pips, as drawn. */
export async function pipView(ids) {
  await settle(200);
  const read = id => Object.fromEntries(Array.from(
    document.querySelectorAll(`#scb-root .scb-portrait[data-combatant-id="${id}"] .scb-pip`),
    pip => [pip.dataset.pip, pip.dataset.state ?? null]));
  return Object.fromEntries(ids.map(id => [id, read(id)]));
}

/** GM: advance a number of turns. */
export async function advance(turns) {
  for ( let i = 0; i < turns; i++ ) {
    await game.combat.nextTurn();
    await settle(60);
  }
  await settle(300);
}

/* -------------------------------------------- */
/*  Legendary badges                            */
/* -------------------------------------------- */

/** GM: the party and the dragon; the dragon's legendary-costing activity. */
export async function legendarySetup() {
  const combat = await freshCombat({ allies: 2, enemies: 1, enemyNames: ["Adult Red Dragon"] });
  const dragon = combat.combatants.find(c => c.actor?.type === "npc");
  await dragon.actor.update({ "system.resources.legact.spent": 0, "system.resources.legres.spent": 0 });
  const activity = dragon.actor.items.contents.flatMap(i => i.system.activities?.contents ?? [])
    .find(a => a.activation?.type === "legendary");
  await settle(200);
  return { dragon: dragon.id, activity: activity?.uuid ?? null };
}

/** The legendary badges on one card, as drawn. */
export async function legendaryView(id) {
  await settle(250);
  const read = kind => {
    const b = document.querySelector(`#scb-root .scb-portrait[data-combatant-id="${id}"] .scb-leg-${kind}`);
    return b && !b.hidden ? b.querySelector("span").textContent : null;
  };
  return { actions: read("actions"), resistances: read("resistances") };
}

/* -------------------------------------------- */
/*  BG3 group turns                             */
/* -------------------------------------------- */

/** GM: group turns on; three heroes acting as one team, then two goblins. */
export async function groupSetup() {
  await game.settings.set(MODULE_ID, "groupTeams", "bg3");
  const combat = await freshCombat({ allies: 3, enemies: 2, enemyNames: ["Goblin"], initiative: false, start: false });
  // Initiative by who is who, not by list position (the server's order isn't the creation order):
  // the heroes first, then the goblins.
  const heroes = combat.combatants.filter(c => c.actor?.type === "character");
  const goblins = combat.combatants.filter(c => c.actor?.type === "npc");
  await combat.updateEmbeddedDocuments("Combatant", [
    ...heroes.map((c, i) => ({ _id: c.id, initiative: 30 - i })),
    ...goblins.map((c, i) => ({ _id: c.id, initiative: 10 - i }))
  ]);
  await combat.startCombat();
  await settle(200);
  const ids = combat.turns.map(c => c.id);
  // The first hero spends their Action before anyone switches.
  await combat.turns[0].update({ [`flags.${MODULE_ID}.economy`]: { action: true, bonus: false, reaction: false } });
  await settle(200);
  return { heroes: ids.slice(0, 3), goblins: ids.slice(3) };
}

export async function groupTeardown() {
  await game.settings.set(MODULE_ID, "groupTeams", "off");
  await cleanup();
}

/** Anyone: the state of the group turn as the bar draws it. */
export async function groupView() {
  await settle(300);
  const combat = game.combat;
  const cls = id => {
    const li = document.querySelector(`#scb-root .scb-portrait[data-combatant-id="${id}"]`);
    return li ? ["is-current", "in-active-run", "is-ended", "can-take-turn"].filter(c => li.classList.contains(c)) : null;
  };
  return {
    current: combat.combatant?.id ?? null,
    classes: Object.fromEntries(combat.turns.map(c => [c.id, cls(c.id)])),
    economy: Object.fromEntries(combat.turns.map(c => [c.id, c.flags?.[MODULE_ID]?.economy ?? null]))
  };
}

/** Player: click a portrait (to take its turn). */
export async function clickPortrait(id) {
  document.querySelector(`#scb-root .scb-portrait[data-combatant-id="${id}"]`).click();
  await settle(600);
}

/** Player: press End Turn. */
export async function pressEndTurn() {
  document.querySelector("#scb-root .scb-endturn").click();
  await settle(600);
}

/** Player: ask the GM straight out to send in someone they don't own. */
export async function sneakyActivate(combatantId) {
  return game.users.activeGM.query(`${MODULE_ID}.groupTurn`, { action: "activate", combatId: game.combat.id, combatantId });
}

/** GM: end the current member's turn through the bar. */
export async function gmEndTurn() {
  await game.modules.get(MODULE_ID).api.bar.endTurn();
  await settle(600);
}

/* -------------------------------------------- */
/*  Status effects                              */
/* -------------------------------------------- */

/** GM: a hero with a 3-round effect, a goblin with the Poisoned condition. */
export async function effectsSetup() {
  const combat = await freshCombat({ allies: 1, enemies: 1, enemyNames: ["Goblin"] });
  const hero = combat.combatants.find(c => c.actor?.type === "character");
  const goblin = combat.combatants.find(c => c.actor?.type === "npc");
  for ( const e of hero.actor.effects.filter(e => e.name === "Test Blessing") ) await e.delete();
  // Described like dnd5e's Concentrating effect: a link, and an inline embed of one of the hero's items.
  const item = hero.actor.items.find(i => i.system.description?.value?.length > 40);
  await hero.actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Test Blessing", img: "icons/svg/aura.svg", duration: { value: 3, units: "rounds" },
    description: `<p>See @UUID[${hero.actor.uuid}]{the Blessed One}.</p><p>@Embed[${item.uuid} inline]</p>`
  }]);
  await goblin.actor.toggleStatusEffect("poisoned", { active: true });
  await settle(300);
  const embedded = item.system.description.value.replace(/<[^>]*>/g, " ").replace(/@\w+\[[^\]]*\](\{[^}]*\})?/g, " ")
    .replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  return { hero: hero.id, goblin: goblin.id, embedded };
}

/** The effect icons on one card, as drawn. */
export async function effectView(id) {
  await settle(250);
  return Array.from(document.querySelectorAll(`#scb-root .scb-portrait[data-combatant-id="${id}"] .scb-effect`),
    li => ({ label: li.getAttribute("aria-label"), ring: li.classList.contains("has-duration"),
      pct: li.style.getPropertyValue("--scb-effect-pct") || null }));
}

export async function effectsTeardown(heroId) {
  const hero = game.combat?.combatants.get(heroId)?.actor;
  for ( const e of hero?.effects.filter(e => e.name === "Test Blessing") ?? [] ) await e.delete();
  await cleanup();
}
