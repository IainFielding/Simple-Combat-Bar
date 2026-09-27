// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../scripts/config.mjs";
import { buildPortraitModel } from "../scripts/model/portrait-model.mjs";
import { PortraitView } from "../scripts/ui/portrait-view.mjs";
import { portraitStyle } from "../scripts/ui/portrait-styles.mjs";
import { runPosition, trackWidth } from "../scripts/ui/combat-bar.mjs";

const model = (over = {}) => buildPortraitModel({
  id: "c1", name: "Lae'zel", img: "laezel.webp", side: "ally", isGM: false, isOwner: true, canObserve: true,
  isPC: true, hidden: false, defeated: false, initiative: 18, tokenDisplayName: 0,
  hp: { value: 10, max: 40, temp: null }, description: null, isEvent: false, eventRoundsLeft: null, ...over
}, { settings: DEFAULTS, current: true, acted: false, run: null });

describe("PortraitView", () => {
  it.each(["medallion", "card"])("builds the %s style with every required slot", id => {
    const view = new PortraitView("c1", portraitStyle(id));
    for ( const slot of ["img", "initiative", "hp", "bar2", "name", "damage", "rounds"] ) {
      expect(view.element.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull();
    }
  });

  it("applies a model: classes, text, side, damage fill", () => {
    const view = new PortraitView("c1", portraitStyle("medallion"));
    view.patch(model());
    const el = view.element;
    expect(el.classList.contains("is-current")).toBe(true);
    expect(el.classList.contains("is-pc")).toBe(true);
    expect(el.dataset.side).toBe("ally");
    expect(el.querySelector(".scb-name").textContent).toBe("Lae'zel");
    expect(el.querySelector(".scb-init").textContent).toBe("18");
    expect(el.querySelector(".scb-damage").style.getPropertyValue("--scb-damage-pct")).toBe("75%");
    expect(el.querySelector(".scb-hp").classList.contains("is-empty")).toBe(false);
  });

  it("does nothing when the model hasn't changed", () => {
    const view = new PortraitView("c1", portraitStyle("medallion"));
    view.patch(model());
    expect(view.patch(model())).toEqual([]);
  });

  it("touches only what changed", () => {
    const view = new PortraitView("c1", portraitStyle("medallion"));
    view.patch(model());
    const img = view.element.querySelector("img");
    img.dataset.marker = "kept";
    expect(view.patch(model({ defeated: true }))).toEqual(["defeated"]);
    expect(view.element.classList.contains("is-defeated")).toBe(true);
    expect(view.element.querySelector("img")).toBe(img);
  });

  it("never interprets names as markup", () => {
    const view = new PortraitView("c1", portraitStyle("card"));
    view.patch(model({ name: "<img src=x onerror=alert(1)>" }));
    expect(view.element.querySelector(".scb-name").children).toHaveLength(0);
  });
});

describe("trackWidth", () => {
  const items = current => [
    { type: "combatant", current: current === 0 }, { type: "combatant", current: current === 1 },
    { type: "divider" }, { type: "combatant", current: current === 2 }
  ];

  it("is the same whoever's turn it is, so the bar never moves on a turn change", () => {
    expect(trackWidth(items(0), 72)).toBe(trackWidth(items(1), 72));
    expect(trackWidth(items(1), 72)).toBe(trackWidth(items(2), 72));
  });

  it("adds up portraits, the current one's extra width, the divider, gaps and padding", () => {
    // 3 x 72 + 0.18 x 72 + 36 + 3 gaps x 7.2 + 2 x 12
    expect(trackWidth(items(0), 72)).toBe(Math.ceil(216 + 12.96 + 36 + 21.6 + 24));
  });

  it("grows when someone joins", () => {
    expect(trackWidth([...items(0), { type: "combatant" }], 72)).toBeGreaterThan(trackWidth(items(0), 72));
  });
});

describe("runPosition", () => {
  const items = [{ run: "r1" }, { run: "r1" }, { run: "r1" }, { run: null }, { run: "r2" }];
  it("labels the ends and middle of a run", () => {
    expect(items.map((_, i) => runPosition(items, i))).toEqual(["first", "middle", "last", null, null]);
  });
});
