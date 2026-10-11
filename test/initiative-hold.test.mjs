import { beforeEach, describe, expect, it, vi } from "vitest";
import { Lifecycle } from "../scripts/core/lifecycle.mjs";
import { InitiativeHold, MESSAGE_WAIT_MS, diceHoldInitiative } from "../scripts/ui/initiative-hold.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

describe("InitiativeHold", () => {
  let life;
  let onChange;
  let hold;

  beforeEach(() => {
    installFoundryShims();
    vi.useFakeTimers();
    life = new Lifecycle();
    onChange = vi.fn();
    hold = new InitiativeHold(life, onChange);
  });

  it("holds a roll until its message's dice have stopped", () => {
    hold.expect("c1");
    expect(hold.has("c1")).toBe(true);
    hold.arrived("c1", "m1");
    vi.advanceTimersByTime(MESSAGE_WAIT_MS * 2);
    expect(hold.has("c1")).toBe(true);
    hold.finished("m1");
    expect(hold.has("c1")).toBe(false);
    expect(hold.active).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("lets go when no message follows (a roll whispered to someone else)", () => {
    hold.expect("c1");
    vi.advanceTimersByTime(MESSAGE_WAIT_MS - 1);
    expect(hold.has("c1")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hold.has("c1")).toBe(false);
  });

  it("holds each combatant of a batch until its own dice stop", () => {
    for ( const id of ["c1", "c2"] ) hold.expect(id);
    hold.arrived("c1", "m1");
    hold.arrived("c2", "m2");
    hold.finished("m1");
    expect([hold.has("c1"), hold.has("c2"), hold.active]).toEqual([false, true, true]);
    hold.finished("m2");
    expect(hold.active).toBe(false);
  });

  it("holds a message it wasn't expecting, and ignores one it doesn't know", () => {
    hold.arrived("c1", "m1");
    expect(hold.has("c1")).toBe(true);
    hold.finished("other");
    expect(hold.has("c1")).toBe(true);
  });

  it("leaves no timer behind", () => {
    hold.expect("c1");
    hold.arrived("c1", "m1");
    expect(life.counts.timers).toBe(0);
  });
});

describe("diceHoldInitiative", () => {
  const withDice = (values, active = true) => {
    installFoundryShims();
    game.modules = { get: id => (id === "dice-so-nice" ? { active } : null) };
    game.dice3d = {};
    game.settings = { get: (_module, key) => values[key] };
  };

  it("follows Dice So Nice's own settings", () => {
    withDice({ immediatelyDisplayChatMessages: false, disabledForInitiative: false });
    expect(diceHoldInitiative()).toBe(true);
    withDice({ immediatelyDisplayChatMessages: true, disabledForInitiative: false });
    expect(diceHoldInitiative()).toBe(false);
    withDice({ immediatelyDisplayChatMessages: false, disabledForInitiative: true });
    expect(diceHoldInitiative()).toBe(false);
  });

  it("is off without Dice So Nice", () => {
    withDice({ immediatelyDisplayChatMessages: false, disabledForInitiative: false }, false);
    expect(diceHoldInitiative()).toBe(false);
    installFoundryShims();
    expect(diceHoldInitiative()).toBe(false);
  });
});
