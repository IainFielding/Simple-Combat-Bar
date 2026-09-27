// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyOrder, diffKeys, stableIndices } from "../scripts/core/reconcile.mjs";

describe("diffKeys", () => {
  it("reports additions, removals and reordering", () => {
    expect(diffKeys(["a", "b", "c"], ["c", "a", "d"])).toEqual({
      added: ["d"], removed: ["b"], kept: ["c", "a"], reordered: true
    });
  });

  it("isn't fooled by removals into seeing a reorder", () => {
    expect(diffKeys(["a", "b", "c"], ["a", "c"]).reordered).toBe(false);
  });
});

describe("stableIndices", () => {
  it("finds a longest increasing subsequence", () => {
    const seq = [3, 0, 1, 2, 4];
    const keep = [...stableIndices(seq)].map(i => seq[i]).sort();
    expect(keep).toEqual([0, 1, 2, 4]);
  });

  it("handles empty input", () => {
    expect(stableIndices([]).size).toBe(0);
  });
});

describe("applyOrder (spec R4: move nodes, never rebuild them)", () => {
  const make = keys => {
    const ol = document.createElement("ol");
    const nodes = Object.fromEntries(keys.map(k => {
      const li = document.createElement("li");
      li.dataset.k = k;
      ol.append(li);
      return [k, li];
    }));
    return { ol, nodes };
  };
  const order = ol => Array.from(ol.children, c => c.dataset.k).join("");

  it("rotates a turn order with a single move, keeping node identity", () => {
    const { ol, nodes } = make(["a", "b", "c", "d", "e"]);
    const before = nodes.b;
    const moves = applyOrder(ol, ["b", "c", "d", "e", "a"].map(k => nodes[k]));
    expect(order(ol)).toBe("bcdea");
    expect(moves).toBe(1);
    expect(ol.children[0]).toBe(before);
  });

  it("does nothing when already in order", () => {
    const { ol, nodes } = make(["a", "b", "c"]);
    expect(applyOrder(ol, ["a", "b", "c"].map(k => nodes[k]))).toBe(0);
  });

  it("inserts new nodes in place", () => {
    const { ol, nodes } = make(["a", "c"]);
    const b = document.createElement("li");
    b.dataset.k = "b";
    applyOrder(ol, [nodes.a, b, nodes.c]);
    expect(order(ol)).toBe("abc");
  });

  it("reverses", () => {
    const { ol, nodes } = make(["a", "b", "c", "d"]);
    applyOrder(ol, ["d", "c", "b", "a"].map(k => nodes[k]));
    expect(order(ol)).toBe("dcba");
  });

  it("orders a shuffled list correctly for every permutation of 4", () => {
    const perms = xs => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
      perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])));
    for ( const perm of perms(["a", "b", "c", "d"]) ) {
      const { ol, nodes } = make(["a", "b", "c", "d"]);
      applyOrder(ol, perm.map(k => nodes[k]));
      expect(order(ol)).toBe(perm.join(""));
    }
  });
});
