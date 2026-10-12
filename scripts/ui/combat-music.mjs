/**
 * The combat playlist in a live world: start it as a fight begins, and bring back what was playing
 * as the fight ends.
 *
 * The decisions are pure (model/combat-music.mjs). Playlists are world documents, so one client
 * does this for everyone: the active GM.
 */

import { MODULE_ID, settings } from "../config.mjs";
import { musicOnEnd, musicOnStart } from "../model/combat-music.mjs";

const existing = () => new Set(game.playlists.map(p => p.id));

/**
 * A combat has changed: if it has started and its music hasn't, start it.
 * @param {Combat} combat
 */
export async function startCombatMusic(combat) {
  if ( !game.users.activeGM?.isSelf || !combat.started || combat.getFlag(MODULE_ID, "music") ) return;
  const plan = musicOnStart({
    playlist: settings().combatPlaylist,
    existing: existing(),
    playing: game.playlists.playing.map(p => ({ playlist: p.id, sounds: p.sounds.filter(s => s.playing).map(s => s.id) }))
  });
  if ( !plan ) return;
  // The flag first: it's what stops a second turn change starting the music again.
  await combat.setFlag(MODULE_ID, "music", plan.flag);
  for ( const id of plan.stop ) await game.playlists.get(id)?.stopAll();
  if ( plan.play ) await game.playlists.get(plan.play)?.playAll();
}

/**
 * A combat is gone: stop its music and bring back what it interrupted.
 * @param {Combat} combat
 */
export async function endCombatMusic(combat) {
  if ( !game.users.activeGM?.isSelf ) return;
  const plan = musicOnEnd({
    flag: combat.getFlag(MODULE_ID, "music"),
    existing: existing(),
    otherFights: game.combats.filter(c => c !== combat).map(c => c.getFlag(MODULE_ID, "music")?.playlist).filter(Boolean)
  });
  if ( !plan ) return;
  if ( plan.stop ) await game.playlists.get(plan.stop)?.stopAll();
  for ( const { playlist, sounds } of plan.resume ) {
    const doc = game.playlists.get(playlist);
    for ( const id of sounds ) {
      const sound = doc.sounds.get(id);
      if ( sound ) await doc.playSound(sound);
    }
  }
}
