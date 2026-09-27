import { describe, expect, it, vi } from "vitest";
import { RenderScheduler } from "../scripts/core/scheduler.mjs";

/** A manual frame clock: `tick()` runs whatever was requested. */
function manualFrames() {
  let queued = null;
  return {
    request: fn => (queued = fn, 1),
    cancel: () => (queued = null),
    tick() {
      const fn = queued;
      queued = null;
      fn?.();
    }
  };
}

describe("RenderScheduler (spec R5)", () => {
  it("coalesces many marks in one frame into one flush (P1: twelve initiative rolls)", () => {
    const clock = manualFrames();
    const flush = vi.fn();
    const scheduler = new RenderScheduler(flush, clock);
    for ( let i = 0; i < 12; i++ ) scheduler.markDirty(`npc${i}`);
    scheduler.markOrder();
    clock.tick();
    expect(flush).toHaveBeenCalledOnce();
    const batch = flush.mock.calls[0][0];
    expect(batch.ids.size).toBe(12);
    expect(batch.order).toBe(true);
    expect(batch.all).toBe(false);
  });

  it("starts a fresh batch after flushing", () => {
    const clock = manualFrames();
    const flush = vi.fn();
    const scheduler = new RenderScheduler(flush, clock);
    scheduler.markDirty("a");
    clock.tick();
    scheduler.markDirty("b");
    clock.tick();
    expect(flush).toHaveBeenCalledTimes(2);
    expect([...flush.mock.calls[1][0].ids]).toEqual(["b"]);
  });

  it("markAll implies order", () => {
    const clock = manualFrames();
    const flush = vi.fn();
    new RenderScheduler(flush, clock).markAll();
    clock.tick();
    expect(flush.mock.calls[0][0]).toMatchObject({ all: true, order: true });
  });

  it("cancel drops pending work", () => {
    const clock = manualFrames();
    const flush = vi.fn();
    const scheduler = new RenderScheduler(flush, clock);
    scheduler.markDirty("a");
    scheduler.cancel();
    clock.tick();
    expect(flush).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(false);
  });

  it("flushNow runs synchronously", () => {
    const clock = manualFrames();
    const flush = vi.fn();
    const scheduler = new RenderScheduler(flush, clock);
    scheduler.markDirty("a");
    scheduler.flushNow();
    expect(flush).toHaveBeenCalledOnce();
    clock.tick();
    expect(flush).toHaveBeenCalledOnce();
  });
});
