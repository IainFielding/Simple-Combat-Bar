import { describe, expect, it } from "vitest";
import { DISPLAY_MODES, displayName, healthState, hpDetail, isShown, showsInitiative, sideOf }
  from "../scripts/model/visibility.mjs";

describe("sideOf", () => {
  it("treats anything with a player owner as an ally", () => {
    expect(sideOf(-1, true)).toBe("ally");
  });
  it("maps dispositions", () => {
    expect([1, -1, 0, -2].map(d => sideOf(d, false))).toEqual(["ally", "enemy", "neutral", "secret"]);
  });
});

describe("isShown", () => {
  const base = { isGM: false, hidden: false, canObserve: false, isFriendly: false, hasActed: false,
    hideUnseenFirstRound: false };

  it("GM sees everything", () => {
    expect(isShown({ ...base, isGM: true, hidden: true, hideUnseenFirstRound: true })).toBe(true);
  });
  it("players never see hidden combatants", () => {
    expect(isShown({ ...base, hidden: true, canObserve: true })).toBe(false);
  });
  it("hides an unseen enemy until it has acted, when the setting is on", () => {
    const f = { ...base, hideUnseenFirstRound: true };
    expect(isShown(f)).toBe(false);
    expect(isShown({ ...f, hasActed: true })).toBe(true);
    expect(isShown({ ...f, isFriendly: true })).toBe(true);
    expect(isShown({ ...f, canObserve: true })).toBe(true);
  });
  it("shows unacted enemies when the setting is off", () => {
    expect(isShown(base)).toBe(true);
  });
});

describe("displayName", () => {
  const f = { name: "Goblin Boss", isGM: false, isOwner: false, tokenDisplayName: DISPLAY_MODES.NONE };
  it("owners and the GM always see the name", () => {
    expect(displayName("owner", { ...f, isOwner: true })).toBe("Goblin Boss");
    expect(displayName("owner", { ...f, isGM: true })).toBe("Goblin Boss");
  });
  it("'always' shows it to everyone", () => {
    expect(displayName("always", f)).toBe("Goblin Boss");
  });
  it("'owner' hides it from everyone else", () => {
    expect(displayName("owner", f, "Unknown")).toBe("Unknown");
  });
  it("'token' follows the token's own name display mode", () => {
    expect(displayName("token", f, "?")).toBe("?");
    expect(displayName("token", { ...f, tokenDisplayName: DISPLAY_MODES.HOVER }, "?")).toBe("Goblin Boss");
    expect(displayName("token", { ...f, tokenDisplayName: DISPLAY_MODES.ALWAYS }, "?")).toBe("Goblin Boss");
    expect(displayName("token", { ...f, tokenDisplayName: DISPLAY_MODES.OWNER }, "?")).toBe("?");
  });
});

describe("hpDetail", () => {
  const cases = [
    ["all", false, false, "numbers"],
    ["owner", false, false, "state"],
    ["ownerOnly", false, false, "none"],
    ["ownerOnly", false, true, "numbers"],
    ["ownerOnly", true, false, "numbers"]
  ];
  it.each(cases)("%s (gm=%s, observer=%s) → %s", (mode, isGM, canObserve, expected) => {
    expect(hpDetail(mode, { isGM, canObserve })).toBe(expected);
  });
});

describe("healthState", () => {
  it.each([[null, "unknown"], [100, "healthy"], [51, "healthy"], [50, "bloodied"], [26, "bloodied"],
    [25, "critical"], [1, "critical"], [0, "down"]])("%s%% → %s", (pct, state) => {
    expect(healthState(pct)).toBe(state);
  });
});

describe("showsInitiative", () => {
  it("hides enemy initiative from players only when asked", () => {
    expect(showsInitiative(true, { isGM: false, isOwner: false })).toBe(false);
    expect(showsInitiative(true, { isGM: false, isOwner: true })).toBe(true);
    expect(showsInitiative(true, { isGM: true, isOwner: false })).toBe(true);
    expect(showsInitiative(false, { isGM: false, isOwner: false })).toBe(true);
  });
});
