/**
 * One-time (idempotent) setup of the test worlds.
 *
 *   node provision.mjs                      # every world in config.mjs
 *   node provision.mjs playwright-combat    # one world
 *   node provision.mjs --reset              # delete world databases first, rebuild from scratch
 *
 * For each world: write the manifest, activate it (Foundry creates the database and a passwordless
 * "Gamemaster"), enable exactly the configured modules, reload, verify they came up, then build the
 * fixtures every suite relies on: a player user, the party and monsters from the dnd5e SRD
 * compendia, and an empty scene to fight on.
 */

import { PLAYER_USER, WORLDS } from "./config.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld, resetWorldData, worldInitialised } from "./lib/worlds.mjs";

/**
 * SRD actors imported as fixtures, by name as they appear in the dnd5e 6 compendia. `"*"` takes the
 * whole pack: the SRD heroes are a small party, and their names have changed between releases.
 */
export const FIXTURE_ACTORS = {
  heroes: "*",
  monsters: ["Goblin", "Wolf", "Bandit", "Orc", "Ogre", "Skeleton", "Zombie", "Giant Rat", "Adult Red Dragon"]
};

const argv = process.argv.slice(2);
const reset = argv.includes("--reset");
const force = argv.includes("--force");
const targets = argv.filter(a => !a.startsWith("--"));
const worlds = targets.length ? targets : Object.keys(WORLDS);

for ( const id of worlds ) {
  if ( !WORLDS[id] ) {
    console.error(`Unknown world "${id}". Known: ${Object.keys(WORLDS).join(", ")}`);
    process.exit(1);
  }
}

for ( const worldId of worlds ) await provision(worldId);

/* -------------------------------------------- */

/** @param {string} worldId */
async function provision(worldId) {
  const spec = WORLDS[worldId];
  console.log(`\n=== Provisioning "${spec.title}" (${worldId}) ===`);

  if ( reset ) {
    resetWorldData(worldId);
    console.log("  database reset");
  }
  const { created } = ensureWorld(worldId, { force });
  console.log(`  manifest ${created ? "created" : "already present"}`
    + `; database ${worldInitialised(worldId) ? "exists" : "will be created on first launch"}`);

  const server = await startFoundry(worldId);
  let session;
  try {
    session = await Session.open();
    console.log("  joined as Gamemaster");

    const result = await enableModules(session, spec.modules);
    if ( result.changed ) {
      console.log(`  module configuration written (${result.enabled.length} enabled), reloading…`);
      await session.reload();
    } else {
      console.log("  module configuration already correct");
    }

    const status = await session.eval(wanted => wanted.map(id => {
      const mod = game.modules.get(id);
      return { id, installed: !!mod, active: !!mod?.active };
    }), spec.modules);
    for ( const m of status ) {
      console.log(`    [${(m.active ? "ok" : (m.installed ? "INACTIVE" : "NOT INSTALLED")).padEnd(13)}] ${m.id}`);
    }
    const bad = status.filter(m => !m.active);
    if ( bad.length ) throw new Error(`These modules did not activate: ${bad.map(m => m.id).join(", ")}.`);

    for ( const line of await buildFixtures(session) ) console.log(`  ${line}`);
    console.log(`  "${spec.title}" ready`);
  } catch ( err ) {
    if ( session ) console.error(`\n--- world console tail ---\n${session.tail()}\n---`);
    throw err;
  } finally {
    if ( session ) await session.close();
    await server.stop();
  }
}

/* -------------------------------------------- */

/** Write `core.moduleConfiguration` so exactly `wanted` are on. `changed: false` skips the reload. */
function enableModules(session, wanted) {
  return session.eval(async wanted => {
    const want = new Set(wanted);
    const current = game.settings.get("core", "moduleConfiguration") ?? {};
    const next = {};
    let changed = false;
    for ( const id of game.modules.keys() ) {
      next[id] = want.has(id);
      if ( (current[id] ?? false) !== next[id] ) changed = true;
    }
    for ( const id of want ) if ( !(id in next) ) { next[id] = true; changed = true; }
    if ( changed ) await game.settings.set("core", "moduleConfiguration", next);
    return { changed, enabled: Object.entries(next).filter(([, on]) => on).map(([id]) => id) };
  }, wanted);
}

/**
 * The player user, the fixture actors (in a folder, the heroes owned by the player) and the arena
 * scene. Each piece is skipped if it already exists, so re-provisioning is cheap.
 */
function buildFixtures(session) {
  return session.eval(async ({ playerName, fixtures }) => {
    const lines = [];

    let player = game.users.getName(playerName);
    if ( !player ) {
      player = await User.create({ name: playerName, role: CONST.USER_ROLES.PLAYER, password: "" });
      lines.push(`created user "${playerName}"`);
    }

    let folder = game.folders.find(f => (f.type === "Actor") && (f.name === "SCB Fixtures"));
    folder ??= await Folder.create({ name: "SCB Fixtures", type: "Actor" });

    for ( const [packName, names] of Object.entries(fixtures) ) {
      const pack = game.packs.get(`dnd5e.${packName}`);
      const index = await pack.getIndex();
      const wanted = names === "*" ? index.map(e => e.name) : names;
      for ( const name of wanted ) {
        if ( game.actors.find(a => (a.name === name) && (a.folder === folder)) ) continue;
        const entry = index.find(e => e.name === name) ?? index.find(e => e.name.startsWith(name));
        if ( !entry ) {
          lines.push(`WARNING: "${name}" not found in dnd5e.${packName}`);
          continue;
        }
        const data = game.actors.fromCompendium(await pack.getDocument(entry._id));
        data.folder = folder.id;
        data.name = name;
        if ( packName === "heroes" ) {
          data.ownership = { default: 0, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
          data.prototypeToken = { ...data.prototypeToken, actorLink: true, disposition: 1 };
        } else {
          data.prototypeToken = { ...data.prototypeToken, actorLink: false, disposition: -1, displayName: 0 };
        }
        await Actor.create(data);
        lines.push(`imported ${name} from dnd5e.${packName}`);
      }
    }
    if ( !player.character ) {
      const pc = game.actors.find(a => (a.type === "character") && (a.folder === folder));
      if ( pc ) await player.update({ character: pc.id });
    }

    let scene = game.scenes.getName("SCB Arena");
    if ( !scene ) {
      scene = await Scene.create({ name: "SCB Arena", width: 3000, height: 2000, padding: 0,
        grid: { size: 100 }, tokenVision: false, fog: { exploration: false } });
      lines.push("created scene SCB Arena");
    }
    if ( !scene.active ) await scene.activate();

    lines.push(`fixtures: ${game.actors.filter(a => a.folder === folder).length} actors, `
      + `player "${player.name}", scene "${scene.name}"`);
    return lines;
  }, { playerName: PLAYER_USER, fixtures: FIXTURE_ACTORS });
}
