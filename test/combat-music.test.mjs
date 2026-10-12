import { describe, expect, it } from "vitest";
import { musicOnEnd, musicOnStart } from "../scripts/model/combat-music.mjs";

const existing = new Set(["battle", "tavern", "rain"]);
const tavern = { playlist: "tavern", sounds: ["t1"] };
const rain = { playlist: "rain", sounds: ["r1", "r2"] };

describe("musicOnStart", () => {
  it("leaves the music alone with no combat playlist", () => {
    expect(musicOnStart({ playlist: "", existing, playing: [tavern] })).toBeNull();
  });

  it("leaves the music alone when the combat playlist has been deleted", () => {
    expect(musicOnStart({ playlist: "gone", existing, playing: [tavern] })).toBeNull();
  });

  it("stops what is playing, remembers it, and starts the combat playlist", () => {
    expect(musicOnStart({ playlist: "battle", existing, playing: [tavern, rain] })).toEqual({
      stop: ["tavern", "rain"],
      play: "battle",
      flag: { playlist: "battle", resume: [tavern, rain] }
    });
  });

  it("starts the combat playlist from silence", () => {
    expect(musicOnStart({ playlist: "battle", existing, playing: [] }))
      .toEqual({ stop: [], play: "battle", flag: { playlist: "battle", resume: [] } });
  });

  it("doesn't restart a combat playlist that is already playing", () => {
    const out = musicOnStart({ playlist: "battle", existing, playing: [{ playlist: "battle", sounds: ["b1"] }, tavern] });
    expect(out.play).toBeNull();
    expect(out.stop).toEqual(["tavern"]);
    expect(out.flag.resume).toEqual([tavern]);
  });
});

describe("musicOnEnd", () => {
  const flag = { playlist: "battle", resume: [tavern, rain] };

  it("does nothing for a combat that never started any music", () => {
    expect(musicOnEnd({ flag: null, existing })).toBeNull();
    expect(musicOnEnd({ flag: undefined, existing })).toBeNull();
  });

  it("stops the combat playlist and brings back what was playing", () => {
    expect(musicOnEnd({ flag, existing })).toEqual({ stop: "battle", resume: [tavern, rain] });
  });

  it("skips playlists deleted during the fight", () => {
    expect(musicOnEnd({ flag, existing: new Set(["rain"]) })).toEqual({ stop: null, resume: [rain] });
  });

  it("keeps the music going while another fight is using it", () => {
    expect(musicOnEnd({ flag, existing, otherFights: ["battle"] })).toEqual({ stop: null, resume: [] });
  });
});
