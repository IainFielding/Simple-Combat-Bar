// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_ICONS, effectIcons, plainText, remainingPct, showsDescriptions } from "../scripts/model/effects.mjs";
import { DEFAULTS } from "../scripts/config.mjs";
import { buildPortraitModel } from "../scripts/model/portrait-model.mjs";
import { PortraitView } from "../scripts/ui/portrait-view.mjs";
import { portraitStyle } from "../scripts/ui/portrait-styles.mjs";

const fx = (n, extra = {}) => ({ id: `e${n}`, uuid: `Actor.a.ActiveEffect.e${n}`, img: `e${n}.svg`, name: `Effect ${n}`,
  remaining: null, total: null, ...extra });

describe("remainingPct", () => {
  it("measures what's left of a duration", () => {
    expect(remainingPct(3, 10)).toBe(30);
    expect(remainingPct(10, 10)).toBe(100);
    expect(remainingPct(-1, 10)).toBe(0);
  });
  it("is null for effects without a measurable duration", () => {
    expect(remainingPct(Infinity, Infinity)).toBeNull();
    expect(remainingPct(null, 10)).toBeNull();
    expect(remainingPct(3, 0)).toBeNull();
  });
});

describe("effectIcons", () => {
  it(`draws up to ${MAX_ICONS} and counts the rest`, () => {
    const { icons, extra } = effectIcons([1, 2, 3, 4, 5, 6].map(n => fx(n)));
    expect(icons.map(i => i.img)).toEqual(["e1.svg", "e2.svg", "e3.svg", "e4.svg"]);
    expect(extra).toBe(2);
  });
  it("carries each icon's remaining duration", () => {
    expect(effectIcons([fx(1, { remaining: 1, total: 4 })]).icons[0].pct).toBe(25);
  });
  it("copes with none", () => {
    expect(effectIcons(null)).toEqual({ icons: [], extra: 0 });
  });
});

describe("plainText", () => {
  it("strips tags and entities, and never keeps markup", () => {
    expect(plainText("<p>You are <strong>poisoned</strong> &amp; weak.</p><script>x()</script>"))
      .toBe("You are poisoned & weak. x()");
  });
  it("shortens long text", () => {
    const text = plainText("word ".repeat(100), 20);
    expect(text.length).toBeLessThanOrEqual(20);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("showsDescriptions", () => {
  it.each([["none", true, false], ["owner", true, true], ["owner", false, false], ["all", false, true]])(
    "%s, trusted %s → %s", (mode, trusted, expected) => expect(showsDescriptions(mode, trusted)).toBe(expected));
});

describe("effects on a card", () => {
  const model = effects => buildPortraitModel({
    id: "c1", name: "Goblin", img: "g.webp", side: "enemy", isGM: true, isOwner: true, canObserve: true, isPC: false,
    hidden: false, defeated: false, initiative: 12, tokenDisplayName: 0, hp: { value: 5, max: 7 }, description: null,
    isEvent: false, eventRoundsLeft: null, effects
  }, { settings: DEFAULTS, current: false, acted: false, run: null });

  it("are on, with descriptions for owners, by default", () => {
    expect(DEFAULTS.showEffects).toBe(true);
    expect(DEFAULTS.effectDescriptions).toBe("owner");
  });

  it("keep the model primitive, so an unchanged set doesn't repaint", () => {
    const a = model([fx(1, { remaining: 2, total: 4 })]);
    const b = model([fx(1, { remaining: 2, total: 4 })]);
    expect(typeof a.effects).toBe("string");
    expect(a.effects).toBe(b.effects);
  });

  it("draw icons with their rings, and +N", () => {
    const view = new PortraitView("c1", portraitStyle("card"));
    view.patch(model([1, 2, 3, 4, 5].map(n => fx(n, { remaining: 1, total: 2 }))));
    const items = view.element.querySelectorAll(".scb-effect");
    expect(items).toHaveLength(4);
    expect(items[0].dataset.effectUuid).toBe("Actor.a.ActiveEffect.e1");
    expect(items[0].style.getPropertyValue("--scb-effect-pct")).toBe("50%");
    expect(view.element.querySelector(".scb-effects-more").textContent).toBe("+1");
  });

  it("clear when the effects go", () => {
    const view = new PortraitView("c1", portraitStyle("card"));
    view.patch(model([fx(1)]));
    view.patch(model([]));
    expect(view.element.querySelectorAll(".scb-effect")).toHaveLength(0);
    expect(view.element.querySelector(".scb-effects").classList.contains("is-empty")).toBe(true);
  });
});
