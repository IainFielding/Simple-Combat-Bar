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
    const combat = await f.freshCombat({ allies: 4, enemies: 5, enemyNames: ["Goblin", "Orc", "Ogre"] });
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
    await combat.nextRound();
    await combat.update({ turn: combat.turns.findIndex(c => c.id === pcs[0].id) });
    await f.settle(400);
  }, { id: MODULE_ID, style });
  await gm.page.waitForTimeout(800);
  await gm.page.screenshot({ path: path.join(out, "gm.png"), clip: { x: 0, y: 0, width: viewport.width, height: 300 } });

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
    }, MODULE_ID).catch(() => {});
    await gm.close();
  }
  await server.stop();
}
