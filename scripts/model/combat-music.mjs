/**
 * The combat playlist: what to stop and start as a fight begins, and what to bring back as it
 * ends — pure.
 *
 * What was playing is written on the combat when its music starts:
 *   { playlist, resume: [{ playlist, sounds: [ids] }] }
 * so it survives a reload, and its presence is how the music is known to have been started.
 */

/**
 * @typedef {object} Playing
 * @property {string} playlist   Playlist id.
 * @property {string[]} sounds   Ids of its sounds that are playing.
 */

/**
 * As a combat starts.
 * @param {object} f
 * @param {string} f.playlist            The combat playlist's id; blank for none.
 * @param {Set<string>} f.existing       Ids of the playlists the world has.
 * @param {Playing[]} f.playing          What is playing now.
 * @returns {{stop: string[], play: string|null, flag: {playlist: string, resume: Playing[]}}|null}
 *          Null: no combat playlist, so the music is left alone.
 */
export function musicOnStart({ playlist, existing, playing }) {
  if ( !playlist || !existing.has(playlist) ) return null;
  const others = playing.filter(p => p.playlist !== playlist);
  return {
    stop: others.map(p => p.playlist),
    // Already playing (another fight got there first, or the GM did): leave it running.
    play: playing.some(p => p.playlist === playlist) ? null : playlist,
    flag: { playlist, resume: others.map(p => ({ playlist: p.playlist, sounds: [...p.sounds] })) }
  };
}

/**
 * As a combat ends.
 * @param {object} f
 * @param {{playlist: string, resume: Playing[]}|null|undefined} f.flag  What musicOnStart stored.
 * @param {Set<string>} f.existing       Ids of the playlists the world has now.
 * @param {string[]} [f.otherFights]     Combat playlists of the fights still going.
 * @returns {{stop: string|null, resume: Playing[]}|null}  Null: this combat never started any music.
 */
export function musicOnEnd({ flag, existing, otherFights = [] }) {
  if ( !flag?.playlist ) return null;
  // Another fight is still using the same playlist: it keeps playing, and theirs is the one to resume from.
  if ( otherFights.includes(flag.playlist) ) return { stop: null, resume: [] };
  return {
    stop: existing.has(flag.playlist) ? flag.playlist : null,
    resume: (flag.resume ?? []).filter(p => existing.has(p.playlist))
  };
}
