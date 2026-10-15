import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectDescriptions } from "../scripts/ui/effect-text.mjs";

const enrichHTML = vi.fn(async html => html);
const effect = n => ({ uuid: `Actor.a.ActiveEffect.${n}`, description: `<p>Effect ${n}</p>`, modified: 1 });

beforeEach(() => {
  enrichHTML.mockClear();
  globalThis.fromUuidSync = () => null;
  globalThis.foundry = { applications: { ux: { TextEditor: { implementation: { enrichHTML } } } } };
});

describe("effectDescriptions", () => {
  it("enriches a description once, then serves it from the cache", async () => {
    const e = effect("once");
    expect((await effectDescriptions([e])).get(e.uuid)).toBe("Effect once");
    await effectDescriptions([e]);
    expect(enrichHTML).toHaveBeenCalledTimes(1);
  });

  it("drops the least recently used description when full, not the oldest", async () => {
    const kept = effect("kept");
    await effectDescriptions([kept]);
    // Fill the cache past its limit, hovering `kept` again partway through.
    for ( let i = 0; i < 300; i++ ) {
      await effectDescriptions([effect(`filler-${i}`)]);
      if ( i === 150 ) await effectDescriptions([kept]);
    }
    enrichHTML.mockClear();
    await effectDescriptions([kept]);
    expect(enrichHTML).not.toHaveBeenCalled();
    await effectDescriptions([effect("filler-0")]);
    expect(enrichHTML).toHaveBeenCalledTimes(1);
  });
});
