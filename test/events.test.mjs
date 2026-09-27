import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_IMG, RECENT_LIMIT, expiredEvents, normaliseEvent, rememberEvent, roundsLeft }
  from "../scripts/model/events.mjs";

describe("normaliseEvent", () => {
  it("accepts a complete event", () => {
    expect(normaliseEvent({ name: " Ceiling collapses ", img: "a.webp", initiative: "20", duration: "3", hidden: true }))
      .toEqual({ data: { name: "Ceiling collapses", img: "a.webp", initiative: 20, duration: 3, hidden: true }, error: null });
  });

  it("defaults the image and treats a blank or zero duration as until removed", () => {
    expect(normaliseEvent({ name: "Fog", initiative: 10, duration: "" }).data)
      .toMatchObject({ img: DEFAULT_EVENT_IMG, duration: null, hidden: false });
    expect(normaliseEvent({ name: "Fog", initiative: 10, duration: 0 }).data.duration).toBeNull();
  });

  it("accepts decimal initiative (to break ties)", () => {
    expect(normaliseEvent({ name: "Fog", initiative: "19.5" }).data.initiative).toBe(19.5);
  });

  it.each([
    [{ name: "", initiative: 10 }, "name"],
    [{ name: "Fog", initiative: "" }, "initiative"],
    [{ name: "Fog", initiative: "soon" }, "initiative"],
    [{ name: "Fog", initiative: 10, duration: -1 }, "duration"],
    [{ name: "Fog", initiative: 10, duration: 1.5 }, "duration"]
  ])("rejects %o with %s", (form, error) => {
    expect(normaliseEvent(form)).toEqual({ data: null, error });
  });
});

describe("roundsLeft / expiredEvents", () => {
  const event = (id, duration, roundCreated) => ({ id, flags: { event: true, duration, roundCreated } });

  it("counts down from the round it was created", () => {
    expect([2, 3, 4, 5].map(r => roundsLeft({ duration: 2, roundCreated: 2 }, r))).toEqual([2, 1, 0, 0]);
  });

  it("never expires an event without a duration", () => {
    expect(roundsLeft({ duration: null, roundCreated: 1 }, 99)).toBeNull();
    expect(expiredEvents([event("a", null, 1)], 99)).toEqual([]);
  });

  it("picks exactly the events whose time is up", () => {
    const events = [event("a", 1, 1), event("b", 3, 1), event("c", 2, 2)];
    expect(expiredEvents(events, 2)).toEqual(["a"]);
    expect(expiredEvents(events, 4)).toEqual(["a", "b", "c"]);
  });
});

describe("rememberEvent", () => {
  it("puts the newest first and keeps one per name, case-insensitively", () => {
    const list = rememberEvent([{ name: "Fog" }, { name: "Collapse" }], { name: "fog", initiative: 5 });
    expect(list.map(e => e.name)).toEqual(["fog", "Collapse"]);
  });

  it(`keeps at most ${RECENT_LIMIT}`, () => {
    let list = [];
    for ( let i = 0; i < 15; i++ ) list = rememberEvent(list, { name: `E${i}` });
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].name).toBe("E14");
  });
});
