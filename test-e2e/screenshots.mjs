/**
 * Capture the bar for visual review (not pixel-diffed).
 *
 *   node screenshots.mjs                 # GM and player views into results/shots/ (not tracked)
 *   node screenshots.mjs --style=medallion
 *   node screenshots.mjs --group         # a BG3 group turn in progress
 *   node screenshots.mjs --docs          # the README's images, into docs/screenshots/ (tracked)
 *
 * Sets up a mid-fight combat (a few wounded combatants, round 2, a player's turn) and screenshots
 * the top of the screen at 2× for the GM and for the player.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, PLAYER_USER } from "./config.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = process.argv.includes("--docs");
const out = docs ? path.join(here, "..", "docs", "screenshots") : path.join(here, "results", "shots");
fs.mkdirSync(out, { recursive: true });
const style = process.argv.find(a => a.startsWith("--style="))?.split("=")[1] ?? null;
const group = process.argv.includes("--group");
/** File name for a shot: README-stable names under --docs, a prefix for the group-turn set. */
const shot = name => path.join(out, `${group ? "group-turn-" : ""}${name}.png`);
const viewport = { width: 1680, height: 960 };

/** Take core's notices off the screen before a shot: the "Canvas is disabled" one lands across the bar. */
const tidy = session => session.eval(() => ui.notifications.clear());

const server = await startFoundry("playwright-combat");
let gm;
let player;
try {
  gm = await Session.open({ viewport, deviceScaleFactor: 2 });
  // The sidebar sits open on Chat beside the bar: start from an empty log, not whatever the suites
  // last whispered. The world is the harness's own, and disposable.
  await gm.eval(() => ChatMessage.deleteDocuments([], { deleteAll: true }));
  if ( !group ) {
    // Before the fight: combatants added, a couple of heroes rolled, the rest still to roll.
    await gm.eval(async ({ id, style }) => {
      const f = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
      if ( game.paused ) game.togglePause(false, { broadcast: true });
      if ( style ) await game.settings.set(id, "portraitStyle", style);
      await game.settings.set(id, "groupTeams", "off");
      const combat = await f.freshCombat({ allies: 4, enemies: 5, enemyNames: ["Goblin", "Orc", "Adult Red Dragon"],
        initiative: false, start: false });
      const pcs = combat.combatants.filter(c => c.actor?.type === "character");
      await combat.updateEmbeddedDocuments("Combatant", [{ _id: pcs[0].id, initiative: 18 }, { _id: pcs[1].id, initiative: 11 }]);
      await f.settle(400);
    }, { id: MODULE_ID, style });
    await gm.page.waitForTimeout(800);
    await tidy(gm);
    await gm.page.screenshot({ path: shot("initiative"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });
  }
  await gm.eval(async ({ id, style, group }) => {
    const f = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
    if ( game.paused ) game.togglePause(false, { broadcast: true });
    if ( style ) await game.settings.set(id, "portraitStyle", style);
    await game.settings.set(id, "groupTeams", group ? "bg3" : "off");
    await game.settings.set(id, "secondaryResource", "resources.legact");
    const combat = await f.freshCombat({ allies: 4, enemies: 5, enemyNames: ["Goblin", "Orc", "Adult Red Dragon"] });
    const npcs = combat.combatants.filter(c => c.actor?.type === "npc");
    const pcs = combat.combatants.filter(c => c.actor?.type === "character");
    const hurt = async (c, pct) => {
      const hp = c.actor.system.attributes.hp;
      await c.actor.update({ "system.attributes.hp.value": Math.round(hp.max * pct) });
    };
    await hurt(npcs[0], 0.2);
    await hurt(npcs[1], 0.6);
    await hurt(pcs[1], 0.45);
    await hurt(npcs[2], 0);
    await game.modules.get(id).api.bar.addEvent({ name: "Collapsing Ceiling", img: "icons/svg/hazard.svg",
      initiative: 21.5, duration: 3, hidden: false });
    await combat.nextRound();
    await combat.update({ turn: combat.turns.findIndex(c => c.id === pcs[0].id) });
    // Effects: a timed one on the current hero (its ring drains), conditions on a goblin.
    for ( const e of pcs[0].actor.effects.filter(e => e.name === "Shot Blessing") ) await e.delete();
    const spell = pcs[0].actor.items.find(i => i.type === "spell" && i.system.description?.value?.length > 40)
      ?? pcs[0].actor.items.find(i => i.system.description?.value?.length > 40);
    await pcs[0].actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Shot Blessing", img: "icons/svg/aura.svg",
      duration: { value: 3, units: "rounds" },
      description: `<p>You are maintaining concentration on the effects of the '${spell.name}' Spell.</p><p>@Embed[${spell.uuid} inline]</p>` }]);
    await npcs[0].actor.toggleStatusEffect("poisoned", { active: true });
    await npcs[0].actor.toggleStatusEffect("prone", { active: true });
    // A spent Action on the current hero, and a spent Reaction on a goblin, to show both looks.
    await pcs[0].update({ [`flags.${id}.economy`]: { action: true, bonus: false, reaction: false } });
    await npcs[0].update({ [`flags.${id}.economy`]: { action: false, bonus: false, reaction: true } });
    await f.settle(400);
    if ( group ) {
      // Mid group turn: the second hero in the run acting, the third already done.
      const run = combat.turns.filter(c => c.actor?.hasPlayerOwner);
      await combat.update({ turn: combat.turns.indexOf(run[1]),
        [`flags.${id}.groupTurn`]: { round: combat.round, start: combat.turns.indexOf(run[0]), started: [], ended: [run[2].id] } });
      await f.settle(400);
    }
  }, { id: MODULE_ID, style, group });
  await gm.page.waitForTimeout(800);
  await tidy(gm);
  await gm.page.screenshot({ path: shot("gm"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });

  // The group-turn set is only the bar itself; the tooltip and windows look the same either way.
  if ( !group ) {
  // Hover tooltip on the first hero (the current combatant).
  await gm.page.hover("#scb-root .scb-portrait.is-current");
  await gm.page.waitForTimeout(900);
  await tidy(gm);
  await gm.page.screenshot({ path: shot("tooltip"), clip: { x: 300, y: 0, width: 1100, height: 520 } });
  await gm.page.mouse.move(5, 700);

  // Configure Trackers window.
  await gm.eval(async id => {
    const menu = game.settings.menus.get(`${id}.trackers`);
    await new menu.type().render({ force: true });
  }, MODULE_ID);
  const trackers = gm.page.locator("#scb-trackers-config");
  await trackers.waitFor();
  await gm.page.waitForTimeout(400);
  await trackers.screenshot({ path: shot("trackers") });
  await trackers.locator('.header-control[data-action="close"]').first().click().catch(() => {});

  await gm.page.click("#scb-root .scb-tab.addEvent");
  const dialog = gm.page.locator(".scb-event-dialog");
  await dialog.waitFor();
  await gm.page.waitForTimeout(400);
  await dialog.screenshot({ path: shot("event-dialog") });
  await dialog.locator('button[data-action="close"], .header-control[data-action="close"]').first().click().catch(() => {});

  // The settings list with its submenu buttons, then one of the submenus.
  await gm.eval(id => new foundry.applications.settings.SettingsConfig({ initialCategory: id }).render({ force: true }),
    MODULE_ID);
  const config = gm.page.locator("#settings-config");
  await config.waitFor();
  // Off the window, so no button is lit and no tooltip is up.
  await gm.page.mouse.move(5, 700);
  await gm.eval(() => game.tooltip.deactivate());
  await gm.page.waitForTimeout(600);
  await config.screenshot({ path: shot("settings") });
  await config.locator(`button[data-key="${MODULE_ID}.myTurn"]`).click();
  const myTurn = gm.page.locator("#scb-settings-myTurn");
  await myTurn.waitFor();
  await gm.page.waitForTimeout(400);
  await myTurn.screenshot({ path: shot("my-turn") });
  await gm.eval(() => {
    for ( const id of ["scb-settings-myTurn", "settings-config"] ) foundry.applications.instances.get(id)?.close();
  });
  }

  player = await Session.open({ viewport, deviceScaleFactor: 2, user: PLAYER_USER });
  await player.page.waitForTimeout(1200);
  await tidy(player);
  await player.page.screenshot({ path: shot("player"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });

  if ( !group ) {
    // The player's targets, and their turn banner. Targeting needs the map, so a session with the canvas on.
    await player.close({ shutDownWorld: false });
    player = await Session.open({ viewport, deviceScaleFactor: 2, user: PLAYER_USER, canvas: true });
    await player.page.waitForTimeout(2500);
    // The map has to be there for a token to be targeted, but not to be seen: the tokens crowd the
    // corner of the shot, and the other images have none.
    await player.eval(() => { document.getElementById("board").style.visibility = "hidden"; });
    const targeted = await player.eval(() => {
      const enemies = game.combat.turns.filter(c => !c.isOwner && !c.isDefeated && c.token?.object?.visible);
      for ( const c of enemies.slice(0, 2) ) c.token.object.setTarget(true, { releaseOthers: false });
      return game.user.targets.size;
    });
    if ( targeted < 2 ) console.warn(`Only ${targeted} target(s) set for the targeting shot.`);
    await player.page.mouse.move(5, 700);
    await player.page.waitForTimeout(600);
    await tidy(player);
    await player.page.screenshot({ path: shot("targeting"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });
    // The banner is on screen for a few seconds, and a software-rendered canvas can take that long
    // to capture: stop the clock that takes it down, and hold its animation where it's fully shown.
    await player.page.clock.install();
    await player.eval(id => {
      game.user.targets.forEach(t => t.setTarget(false));
      const bar = game.modules.get(id).api.bar;
      bar.announce("yourTurn", [bar.combat.combatant.name], "large");
      for ( const animation of bar.root.querySelector(".scb-notice-card").getAnimations() ) {
        animation.currentTime = 1000;
        animation.pause();
      }
    }, MODULE_ID);
    await tidy(player);
    await player.page.screenshot({ path: shot("your-turn"), clip: { x: 0, y: 0, width: viewport.width, height: 420 } });
  }
  console.log(`Saved to ${path.relative(process.cwd(), out)}`);
} finally {
  if ( player ) await player.close({ shutDownWorld: false });
  if ( gm ) {
    await gm.eval(async id => {
      const f = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
      for ( const a of game.actors ) for ( const e of a.effects.filter(e => e.name === "Shot Blessing") ) await e.delete();
      await f.cleanup();
      await game.settings.set(id, "portraitStyle", "card");
      await game.settings.set(id, "groupTeams", "off");
      await game.settings.set(id, "secondaryResource", "");
      await game.settings.set(id, "tooltipAttributes", game.settings.settings.get(`${id}.tooltipAttributes`).default);
    }, MODULE_ID).catch(() => {});
    await gm.close();
  }
  await server.stop();
}
