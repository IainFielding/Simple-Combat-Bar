import { describe, expect, it } from "vitest";
import { normaliseAttributes, readAttributes, safeColor, secondaryBar } from "../scripts/model/trackers.mjs";
import { DEFAULTS } from "../scripts/config.mjs";
import { dnd5eAdapter } from "../scripts/systems/dnd5e.mjs";

const system = {
  attributes: { ac: { value: 17 }, movement: { walk: 30 }, spell: { dc: 15 }, hp: { value: 20, max: 40 } },
  resources: { legact: { value: 2, max: 3 } },
  skills: { prc: { passive: 14 } },
  spells: { spell1: { value: 0, max: 4 } }
};

describe("secondaryBar", () => {
  it("measures a bar attribute", () => {
    expect(secondaryBar(system, "resources.legact")).toEqual({ value: 2, max: 3, pct: 67 });
  });

  it("shows an empty resource as 0%, not as missing", () => {
    expect(secondaryBar(system, "spells.spell1")).toEqual({ value: 0, max: 4, pct: 0 });
  });

  it("is null for actors without the resource, values without a max, or no path", () => {
    expect(secondaryBar({ attributes: {} }, "resources.legact")).toBeNull();
    expect(secondaryBar(system, "attributes.ac.value")).toBeNull();
    expect(secondaryBar(system, "")).toBeNull();
  });
});

describe("readAttributes", () => {
  it("reads each configured attribute that has a value", () => {
    const rows = readAttributes(system, [
      { attr: "attributes.ac.value", label: "AC", icon: "fa-solid fa-shield" },
      { attr: "attributes.hp", label: "HP" },
      { attr: "attributes.missing", label: "Nope" },
      { attr: "", label: "Blank" }
    ]);
    expect(rows).toEqual([
      { label: "AC", icon: "fa-solid fa-shield", text: "17" },
      { label: "HP", icon: "fa-solid fa-circle-info", text: "20 / 40" }
    ]);
  });

  it("localises labels, then asks the system for a name, then falls back to the path", () => {
    const rows = readAttributes(system, [
      { attr: "skills.prc.passive" }, { attr: "attributes.spell.dc", label: "KEY" }, { attr: "attributes.ac.value" }
    ], {
      localize: k => (k === "KEY" ? "Spell DC" : k),
      labelFor: path => (path === "attributes.ac.value" ? "Armor Class" : null)
    });
    expect(rows.map(r => r.label)).toEqual(["skills.prc.passive", "Spell DC", "Armor Class"]);
  });

  it("copes with no actor", () => {
    expect(readAttributes(null, [{ attr: "a" }])).toEqual([]);
  });
});

describe("normaliseAttributes", () => {
  it("trims and drops rows without an attribute", () => {
    expect(normaliseAttributes([{ attr: " a.b ", label: " L ", icon: "" }, { attr: "  ", label: "x" }]))
      .toEqual([{ attr: "a.b", label: "L", icon: "" }]);
  });
});

describe("safeColor", () => {
  it("accepts hex colours only", () => {
    expect(safeColor("#abc", "#000")).toBe("#abc");
    expect(safeColor("#A1B2C3", "#000")).toBe("#A1B2C3");
    expect(safeColor("red; background: url(x)", "#000")).toBe("#000");
  });
});

describe("defaults", () => {
  it("shows the HP bar and no second bar by default", () => {
    expect(DEFAULTS.hpBar).toBe(true);
    expect(DEFAULTS.secondaryResource).toBe("");
  });

  it("dnd5e's default tooltip values all resolve against a real-shaped actor", () => {
    const rows = readAttributes(system, dnd5eAdapter.defaultAttributes());
    expect(rows.map(r => r.text)).toEqual(["17", "30", "15", "14"]);
  });
});
