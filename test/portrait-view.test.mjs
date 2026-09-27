// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../scripts/config.mjs";
import { buildPortraitModel } from "../scripts/model/portrait-model.mjs";
import { PortraitView } from "../scripts/ui/portrait-view.mjs";
import { portraitStyle } from "../scripts/ui/portrait-styles.mjs";
import { runPosition } from "../scripts/ui/combat-bar.mjs";

const model = (over = {}) => buildPortraitModel({
  id: "c1", name: "Lae'zel", img: "laezel.webp", side: "ally", isGM: false, isOwner: true, canObserve: true,
  isPC: true, hidden: false, defeated: false, initiative: 18, tokenDisplayName: 0,
  hp: { value: 10, max: 40, temp: null }, description: null, isEvent: false, eventRoundsLeft: null, ...over
}, { settings: DEFAULTS, current: true, acted: false, run: null });

describe("PortraitView", () => {
  it.each(["medallion", "card"])("builds the %s style with every required slot", id => {
    const view = new PortraitView("c1", portraitStyle(id));
    for ( const slot of ["img", "initiative", "hp", "name", "damage"] ) {
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

describe("runPosition", () => {
  const items = [{ run: "r1" }, { run: "r1" }, { run: "r1" }, { run: null }, { run: "r2" }];
  it("labels the ends and middle of a run", () => {
    expect(items.map((_, i) => runPosition(items, i))).toEqual(["first", "middle", "last", null, null]);
  });
});
