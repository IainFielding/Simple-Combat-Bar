import { describe, expect, it } from "vitest";
import { formatDistance, movementAction, movementState, movementUsed } from "../scripts/model/movement.mjs";

describe("movementUsed", () => {
  it("adds up each step's cost, difficult terrain included", () => {
    expect(movementUsed([{ cost: 0 }, { cost: 5 }, { cost: 10 }, { cost: 5 }])).toBe(20);
  });

  it("skips steps with no measurable cost, and an empty or missing history", () => {
    expect(movementUsed([{ cost: 5 }, { cost: Infinity }, {}, { cost: -5 }])).toBe(5);
    expect(movementUsed([])).toBe(0);
    expect(movementUsed(undefined)).toBe(0);
  });

  it("counts a step recorded without a canvas (costed at 0) at its measured cost", () => {
    expect(movementUsed([{ cost: 0 }, { cost: 0 }, { cost: 0 }], [null, 5, 5])).toBe(10);
  });

  it("keeps a recorded cost that's more than the plain measurement: difficult terrain", () => {
    expect(movementUsed([{ cost: 0 }, { cost: 10 }, { cost: 5 }], [null, 5, 5])).toBe(15);
  });

  it("counts nothing for teleports or core's displace step", () => {
    const history = [{ cost: 0 }, { cost: 0, action: "walk" }, { cost: 0, action: "displace" }, { cost: 0, action: "blink" }];
    expect(movementUsed(history, [null, 5, 50, 30], a => !["displace", "blink"].includes(a))).toBe(5);
  });

  it("keeps metric distances tidy", () => {
    expect(movementUsed([{ cost: 1.5 }, { cost: 1.5 }, { cost: 1.5 }])).toBe(4.5);
  });
});

describe("movementAction", () => {
  it("judges by the way the token last moved, else how it's set to move", () => {
    expect(movementAction([{ action: "walk" }, { action: "fly" }], "walk")).toBe("fly");
    expect(movementAction([], "swim")).toBe("swim");
    expect(movementAction([], null)).toBe("walk");
  });
});

describe("movementState", () => {
  it("is within speed, Dash up to twice it, then over, as dnd5e's ruler colours it", () => {
    expect(movementState(0, 30)).toBe("normal");
    expect(movementState(30, 30)).toBe("normal");
    expect(movementState(35, 30)).toBe("dash");
    expect(movementState(60, 30)).toBe("dash");
    expect(movementState(65, 30)).toBe("over");
  });

  it("calls any movement over for a creature that can't move", () => {
    expect(movementState(0, 0)).toBe("normal");
    expect(movementState(5, 0)).toBe("over");
  });
});

it("writes distances with only the decimals they have", () => {
  expect([30, 4.5, 1.333].map(formatDistance)).toEqual(["30", "4.5", "1.33"]);
});
