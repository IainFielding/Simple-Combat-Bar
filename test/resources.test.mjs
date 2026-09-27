import { describe, expect, it } from "vitest";
import { displayValue, getPath, resolveResource } from "../scripts/model/resources.mjs";

const system = {
  attributes: { hp: { value: 12, max: 30, temp: 5 }, ac: { value: 15 }, movement: { walk: 30 } },
  details: { cr: 0.25, alignment: "" },
  traits: { languages: new Set(["common", "goblin"]) },
  flags: { inspired: true }
};

describe("getPath", () => {
  it("walks dotted paths and stops at missing steps", () => {
    expect(getPath(system, "attributes.ac.value")).toBe(15);
    expect(getPath(system, "attributes.nope.value")).toBeUndefined();
    expect(getPath(system, "")).toBeUndefined();
  });
});

describe("resolveResource", () => {
  it("reads a bar given its parent path", () => {
    expect(resolveResource(system, "attributes.hp")).toEqual({ value: 12, max: 30, pct: 40 });
  });
  it("reads a bar given its .value path", () => {
    expect(resolveResource(system, "attributes.hp.value")).toEqual({ value: 12, max: 30, pct: 40 });
  });
  it("reads a plain number without a max", () => {
    expect(resolveResource(system, "attributes.movement.walk")).toEqual({ value: 30, max: null, pct: null });
  });
  it("clamps overheal to 100%", () => {
    expect(resolveResource({ hp: { value: 40, max: 30 } }, "hp").pct).toBe(100);
  });
  it("treats a zero max as no max", () => {
    expect(resolveResource({ hp: { value: 0, max: 0 } }, "hp")).toEqual({ value: 0, max: null, pct: null });
  });
  it("returns empty for missing actors or paths", () => {
    expect(resolveResource(null, "attributes.hp")).toEqual({ value: null, max: null, pct: null });
    expect(resolveResource(system, "attributes.nope")).toEqual({ value: null, max: null, pct: null });
  });
});

describe("displayValue", () => {
  it("normalises the odd shapes system data comes in", () => {
    expect(displayValue(true)).toBe("✓");
    expect(displayValue(false)).toBe("✗");
    expect(displayValue(system.traits.languages)).toBe("common, goblin");
    expect(displayValue([])).toBeNull();
    expect(displayValue("")).toBeNull();
    expect(displayValue(Number.NaN)).toBeNull();
    expect(displayValue({ a: 1 })).toBeNull();
    expect(displayValue("text")).toBe("text");
  });
});
