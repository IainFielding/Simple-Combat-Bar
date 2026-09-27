import { beforeEach, describe, expect, it, vi } from "vitest";
import { Lifecycle } from "../scripts/core/lifecycle.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * Spec R2: everything registered through a Lifecycle is released by one dispose(). These are the
 * exact failure modes of the reference module (L1–L5), each pinned.
 */
describe("Lifecycle", () => {
  beforeEach(() => {
    installFoundryShims();
    vi.useFakeTimers();
  });

  it("removes every hook it registered, and only those", () => {
    const outsider = Hooks.on("updateCombat", () => {});
    const life = new Lifecycle();
    life.hook("updateCombat", () => {});
    life.hook("updateActor", () => {});
    expect(Hooks.count()).toBe(3);
    life.dispose();
    expect(Hooks.count()).toBe(1);
    expect(Hooks.events.updateCombat[0].id).toBe(outsider);
  });

  it("detaches DOM listeners on dispose (L1: the resize listener that never came off)", () => {
    const target = new EventTarget();
    const fn = vi.fn();
    const life = new Lifecycle();
    life.listen(target, "resize", fn);
    target.dispatchEvent(new Event("resize"));
    life.dispose();
    target.dispatchEvent(new Event("resize"));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clears pending timers (L5: timeouts firing into a closed dock)", () => {
    const fn = vi.fn();
    const life = new Lifecycle();
    life.timeout(fn, 200);
    life.dispose();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("forgets a timer once it has fired", () => {
    const life = new Lifecycle();
    life.timeout(() => {}, 10);
    expect(life.counts.timers).toBe(1);
    vi.advanceTimersByTime(20);
    expect(life.counts.timers).toBe(0);
  });

  it("cancels animation frames", () => {
    const raf = vi.fn(() => 7);
    const caf = vi.fn();
    const life = new Lifecycle({ requestAnimationFrame: raf, cancelAnimationFrame: caf });
    life.frame(() => {});
    life.dispose();
    expect(caf).toHaveBeenCalledWith(7);
  });

  it("runs cleanups in reverse order, and survives one throwing", () => {
    const order = [];
    const life = new Lifecycle();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    life.add(() => order.push(1));
    life.add(() => { throw new Error("boom"); });
    life.add(() => order.push(3));
    life.dispose();
    expect(order).toEqual([3, 1]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("refuses registrations after dispose (a late async callback can't re-attach)", () => {
    const life = new Lifecycle();
    life.dispose();
    expect(life.hook("updateCombat", () => {})).toBeNull();
    expect(life.timeout(() => {}, 1)).toBeNull();
    expect(Hooks.count()).toBe(0);
    const late = vi.fn();
    life.add(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it("calls the platform timers with the right receiver (browsers throw 'Illegal invocation')", () => {
    const strict = function(fn) {
      if ( (this !== undefined) && (this !== globalThis) ) throw new TypeError("Illegal invocation");
      return fn;
    };
    const saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.requestAnimationFrame = strict;
    globalThis.cancelAnimationFrame = strict;
    try {
      const life = new Lifecycle();
      expect(() => life.frame(() => {})).not.toThrow();
      expect(() => life.dispose()).not.toThrow();
    } finally {
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
    }
  });

  it("is idempotent", () => {
    const life = new Lifecycle();
    life.hook("x", () => {});
    life.dispose();
    life.dispose();
    expect(life.disposed).toBe(true);
    expect(Hooks.count()).toBe(0);
  });
});
