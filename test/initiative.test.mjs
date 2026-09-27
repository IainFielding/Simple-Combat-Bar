import { describe, expect, it } from "vitest";
import { wantsInitiativeDialog } from "../scripts/model/initiative.mjs";
import { DEFAULTS } from "../scripts/config.mjs";

describe("wantsInitiativeDialog", () => {
  it.each([
    ["none", true, false], ["none", false, false],
    ["players", true, true], ["players", false, false],
    ["npcs", true, false], ["npcs", false, true],
    ["all", true, true], ["all", false, true]
  ])("%s, player character %s → %s", (mode, pc, expected) => {
    expect(wantsInitiativeDialog(mode, pc)).toBe(expected);
  });

  it("defaults to players only", () => {
    expect(DEFAULTS.initiativeDialog).toBe("players");
  });
});
