/**
 * In-world fixtures. Runs in the browser, inside the Foundry page, imported over HTTP through the
 * module junction — so it has every Foundry global and can import the module's own code.
 */

export const MODULE_ID = "sogrom-simple-combat-bar";
export const SCENE = "SCB Arena";
export const FOLDER = "SCB Fixtures";

/** Wait for the bar's rAF flush (and CTD's async renders) to land. */
export async function settle(ms = 60) {
  for ( let i = 0; i < 2; i++ ) await new Promise(r => requestAnimationFrame(() => r()));
  await new Promise(r => setTimeout(r, ms));
}

/** The fixture actors. */
export function party(count) {
  return fixtureActors(a => a.type === "character").slice(0, count);
}

export function monsters(count, names = null) {
  const pool = fixtureActors(a => (a.type === "npc") && (!names || names.includes(a.name)));
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}

function fixtureActors(predicate) {
  return game.actors.filter(a => (a.folder?.name === FOLDER) && predicate(a))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete every combat, and replace the arena scene if it has tokens on it.
 *
 * Tokens aren't deleted directly: with `core.noCanvas` on, Foundry 14.368's
 * `TokenDocument#_onDeleteOperation` reads `layer.clipboard` off a layer that doesn't exist and
 * throws. Deleting the whole scene doesn't go through that path.
 */
export async function cleanup() {
  const combats = game.combats.map(c => c.id);
  if ( combats.length ) await Combat.deleteDocuments(combats);
  const scene = game.scenes.getName(SCENE);
  if ( scene?.tokens.size ) {
    const data = scene.toObject();
    delete data._id;
    data.tokens = [];
    await scene.delete();
    const fresh = await Scene.create(data);
    await fresh.activate();
  }
  await settle();
}

/**
 * A fresh combat on the arena scene.
 * @param {object} [options]
 * @param {number} [options.allies=3]
 * @param {number} [options.enemies=5]
 * @param {string[]} [options.enemyNames]   Restrict the monster pool.
 * @param {boolean|number[]} [options.initiative=true]  true: descending values; array: explicit.
 * @param {boolean} [options.start=true]
 * @returns {Promise<Combat>}
 */
export async function freshCombat({ allies = 3, enemies = 5, enemyNames = null, initiative = true, start = true } = {}) {
  await cleanup();
  const scene = game.scenes.getName(SCENE);
  if ( !scene.active ) await scene.activate();

  const actors = [...party(allies), ...monsters(enemies, enemyNames)];
  const tokenData = [];
  for ( const [i, actor] of actors.entries() ) {
    const doc = await actor.getTokenDocument({ x: 100 + ((i % 10) * 100), y: 100 + (Math.floor(i / 10) * 100) });
    tokenData.push(doc.toObject());
  }
  const tokens = await scene.createEmbeddedDocuments("Token", tokenData);

  // Unlinked from the scene: with the canvas off there is no current scene, so core never treats a
  // scene-linked combat as the viewed one. Combatants still reference their tokens.
  const combat = await Combat.create({ scene: null, active: true });
  const combatants = await combat.createEmbeddedDocuments("Combatant",
    tokens.map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId })));

  if ( initiative ) {
    const values = Array.isArray(initiative) ? initiative : combatants.map((_, i) => 25 - i);
    await combat.updateEmbeddedDocuments("Combatant", combatants.map((c, i) => ({ _id: c.id, initiative: values[i] })));
  }
  if ( start ) await combat.startCombat();
  await settle(150);
  return combat;
}

/** Deal damage to an actor (synthetic token actors included). */
export async function damage(actor, amount) {
  const hp = actor.system.attributes.hp;
  await actor.update({ "system.attributes.hp.value": Math.max(0, hp.value - amount) });
}
