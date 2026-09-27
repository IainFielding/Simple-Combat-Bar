/**
 * Capture the bar for visual review (not pixel-diffed).
 *
 *   node screenshots.mjs                 # GM and player views into results/shots/
 *   node screenshots.mjs --style=medallion
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
const out = path.join(here, "results", "shots");
fs.mkdirSync(out, { recursive: true });
const style = process.argv.find(a => a.startsWith("--style="))?.split("=")[1] ?? null;
const viewport = { width: 1680, height: 960 };

const server = await startFoundry("playwright-combat");
let gm;
let player;
try {
  gm = await Session.open({ viewport, deviceScaleFactor: 2 });
  await gm.eval(async ({ id, style }) => {
    const f = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
    if ( style ) await game.settings.set(id, "portraitStyle", style);
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
    // A spent Action on the current hero, and a spent Reaction on a goblin, to show both looks.
    await pcs[0].update({ [`flags.${id}.economy`]: { action: true, bonus: false, reaction: false } });
    await npcs[0].update({ [`flags.${id}.economy`]: { action: false, bonus: false, reaction: true } });
    await f.settle(400);
  }, { id: MODULE_ID, style });
  await gm.page.waitForTimeout(800);
  await gm.page.screenshot({ path: path.join(out, "gm.png"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });

  // Hover tooltip on the first hero (the current combatant).
  await gm.page.hover("#scb-root .scb-portrait.is-current");
  await gm.page.waitForTimeout(900);
  await gm.page.screenshot({ path: path.join(out, "tooltip.png"), clip: { x: 300, y: 0, width: 1100, height: 520 } });
  await gm.page.mouse.move(5, 700);

  // Configure Trackers window.
  await gm.eval(async id => {
    const menu = game.settings.menus.get(`${id}.trackers`);
    await new menu.type().render({ force: true });
  }, MODULE_ID);
  const trackers = gm.page.locator("#scb-trackers-config");
  await trackers.waitFor();
  await gm.page.waitForTimeout(400);
  await trackers.screenshot({ path: path.join(out, "trackers.png") });
  await trackers.locator('.header-control[data-action="close"]').first().click().catch(() => {});

  await gm.page.click("#scb-root .scb-tab.addEvent");
  const dialog = gm.page.locator(".scb-event-dialog");
  await dialog.waitFor();
  await gm.page.waitForTimeout(400);
  await dialog.screenshot({ path: path.join(out, "event-dialog.png") });
  await dialog.locator('button[data-action="close"], .header-control[data-action="close"]').first().click().catch(() => {});

  player = await Session.open({ viewport, deviceScaleFactor: 2, user: PLAYER_USER });
  await player.page.waitForTimeout(1200);
  await player.page.screenshot({ path: path.join(out, "player.png"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });
  console.log(`Saved to ${path.relative(process.cwd(), out)}`);
} finally {
  if ( player ) await player.close({ shutDownWorld: false });
  if ( gm ) {
    await gm.eval(async id => {
      const f = await import(`/modules/${id}/test-e2e/in-world/fixtures.mjs`);
      await f.cleanup();
      await game.settings.set(id, "portraitStyle", "card");
      await game.settings.set(id, "secondaryResource", "");
      await game.settings.set(id, "tooltipAttributes", game.settings.settings.get(`${id}.tooltipAttributes`).default);
    }, MODULE_ID).catch(() => {});
    await gm.close();
  }
  await server.stop();
}
