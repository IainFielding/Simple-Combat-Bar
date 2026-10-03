// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../scripts/config.mjs";
import { buildPortraitModel } from "../scripts/model/portrait-model.mjs";
import { PortraitView } from "../scripts/ui/portrait-view.mjs";
import { portraitStyle, portraitStyleChoices, registerPortraitStyle } from "../scripts/ui/portrait-styles.mjs";
import { fitSize, runPosition, trackWidth } from "../scripts/ui/combat-bar.mjs";

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

describe("fitSize", () => {
  /** A started combat of n combatants: one current, a divider part-way. */
  const items = n => {
    const list = Array.from({ length: n }, (_, i) => ({ type: "combatant", current: i === 0 }));
    if ( n > 1 ) list.splice(Math.ceil(n / 2), 0, { type: "divider" });
    return list;
  };
  const BAR_CHROME = 22;

  it("always fits: the bar at the fitted size is never wider than the space, for 1 to 40 combatants", () => {
    for ( const width of [700, 960, 1152, 1500] ) {
      for ( let n = 1; n <= 40; n++ ) {
        const size = fitSize(items(n), width);
        if ( size < 1 ) continue;
        expect(trackWidth(items(n), size) + BAR_CHROME, `${n} combatants in ${width}px`).toBeLessThanOrEqual(width);
      }
    }
  });

  it("is as large as possible: one pixel bigger no longer fits", () => {
    for ( const n of [4, 9, 10, 16] ) {
      const size = fitSize(items(n), 1152);
      expect(trackWidth(items(n), size + 2) + BAR_CHROME).toBeGreaterThan(1152 - 1);
    }
  });

  it("shrinks as combatants join, with no step at ten (the reported bug)", () => {
    const sizes = [8, 9, 10, 11, 12].map(n => fitSize(items(n), 1152));
    for ( let i = 1; i < sizes.length; i++ ) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });
});

describe("runPosition", () => {
  const items = [{ run: "r1" }, { run: "r1" }, { run: "r1" }, { run: null }, { run: "r2" }];
  it("labels the ends and middle of a run", () => {
    expect(items.map((_, i) => runPosition(items, i))).toEqual(["first", "middle", "last", null, null]);
  });
});

describe("portrait style choices", () => {
  it("is one live object, so a style registered after the setting still shows up in it", () => {
    const choices = portraitStyleChoices();
    expect(choices).toMatchObject({ card: "sogrom-simple-combat-bar.styles.card" });
    registerPortraitStyle({ id: "test-shield", label: "TEST.Shield", markup: "<img data-slot=\"img\">" });
    expect(portraitStyleChoices()).toBe(choices);
    expect(choices["test-shield"]).toBe("TEST.Shield");
  });
});

describe("PortraitView accessibility", () => {
  it("names its icon-only buttons, and marks a spent pip as pressed", () => {
    const view = new PortraitView("c1", portraitStyle("card"));
    expect(view.element.querySelector(".scb-roll").getAttribute("aria-label")).toBe("COMBAT.InitiativeRoll");
    view.patch(model({ economy: { action: true, bonus: false, reaction: false }, trusted: true }));
    const pip = slot => view.element.querySelector(`.scb-pip[data-pip="${slot}"]`);
    expect(pip("action").getAttribute("aria-label")).toBe("sogrom-simple-combat-bar.economy.action");
    expect(pip("action").getAttribute("aria-pressed")).toBe("true");
    expect(pip("bonus").getAttribute("aria-pressed")).toBe("false");
  });
});
