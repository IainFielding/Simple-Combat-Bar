import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { portraitMenuOptions } from "../scripts/ui/portrait-menu.mjs";

const GM_ONLY = ["sogrom-simple-combat-bar.context.setCurrent", "COMBATANT.ACTIONS.Clear",
  "sogrom-simple-combat-bar.context.arrivesLater", "COMBATANT.Hide", "COMBATANT.MarkDefeated",
  "COMBATANT.ACTIONS.Update", "COMBATANT.ACTIONS.Remove"];

let bar;
let actions;
const li = { dataset: { combatantId: "ogre" } };
/** The labels of the entries this user would see on the ogre's portrait. */
const visibleLabels = () => portraitMenuOptions(bar, actions)
  .filter(o => (typeof o.visible === "function" ? o.visible(li) : true)).map(o => o.label);

beforeEach(() => {
  installFoundryShims();
  globalThis.canvas = { ready: false };
  const ogre = { id: "ogre", initiative: 12, hidden: false, isDefeated: false, isOwner: false, flags: {},
    update: vi.fn() };
  const goblin = { id: "goblin" };
  bar = { combat: { started: true, turns: [goblin, ogre], combatant: goblin, update: vi.fn(),
    combatants: new Map([["goblin", goblin], ["ogre", ogre]]) } };
  actions = { selectAndPan: vi.fn(), rollInitiative: vi.fn() };
});

describe("portraitMenuOptions", () => {
  it("offers the GM the GM's entries", () => {
    expect(visibleLabels()).toEqual(expect.arrayContaining(GM_ONLY));
  });

  it("offers a player none of the GM's entries, and no re-roll for someone else's combatant", () => {
    game.user = { isGM: false };
    expect(visibleLabels()).toEqual([]);
  });

  it("lets a player re-roll their own combatant, through the bar's roll", () => {
    game.user = { isGM: false };
    bar.combat.combatants.get("ogre").isOwner = true;
    expect(visibleLabels()).toEqual(["COMBATANT.ACTIONS.Reroll"]);
    const event = { shiftKey: true };
    portraitMenuOptions(bar, actions).find(o => o.label === "COMBATANT.ACTIONS.Reroll").onClick(event, li);
    expect(actions.rollInitiative).toHaveBeenCalledWith(bar.combat.combatants.get("ogre"), event);
  });

  it("makes the clicked combatant current in the combat the bar shows when clicked", () => {
    const options = portraitMenuOptions(bar, actions);
    const later = { ...bar.combat, update: vi.fn() };
    bar.combat = later;
    options.find(o => o.label === "sogrom-simple-combat-bar.context.setCurrent").onClick(null, li);
    expect(later.update).toHaveBeenCalledWith({ turn: 1 });
  });
});
