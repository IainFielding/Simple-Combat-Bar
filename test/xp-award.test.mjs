import { describe, expect, it } from "vitest";
import { tallyDefeated } from "../scripts/model/xp-award.mjs";

describe("tallyDefeated", () => {
  it("groups the same creature and totals the XP", () => {
    expect(tallyDefeated([
      { name: "Goblin", xp: 50 },
      { name: "Bugbear", xp: 200 },
      { name: "Goblin", xp: 50 }
    ])).toEqual({
      lines: [
        { name: "Goblin", count: 2, xp: 50, subtotal: 100 },
        { name: "Bugbear", count: 1, xp: 200, subtotal: 200 }
      ],
      total: 300
    });
  });

  it("keeps a same-named creature with different XP on its own line", () => {
    const { lines, total } = tallyDefeated([{ name: "Goblin", xp: 50 }, { name: "Goblin", xp: 100 }]);
    expect(lines).toHaveLength(2);
    expect(total).toBe(150);
  });

  it("leaves out anything without an XP value, but keeps a zero", () => {
    expect(tallyDefeated([{ name: "Rat", xp: 0 }, { name: "Crate", xp: null }, { name: "Odd", xp: NaN }]))
      .toEqual({ lines: [{ name: "Rat", count: 1, xp: 0, subtotal: 0 }], total: 0 });
  });

  it("is empty for no one defeated", () => {
    expect(tallyDefeated([])).toEqual({ lines: [], total: 0 });
    expect(tallyDefeated(undefined)).toEqual({ lines: [], total: 0 });
  });
});
