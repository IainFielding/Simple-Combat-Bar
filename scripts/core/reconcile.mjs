/**
 * Keyed list reconciliation (spec R4).
 *
 * The bar keeps one DOM node per combatant for as long as that combatant is on the bar. When the
 * order changes, nodes are *moved*, never rebuilt, so a turn change costs a handful of
 * `insertBefore` calls instead of re-rendering every portrait.
 */

/**
 * Compare two key sequences.
 * @param {string[]} prev
 * @param {string[]} next
 * @returns {{added: string[], removed: string[], kept: string[], reordered: boolean}}
 */
export function diffKeys(prev, next) {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter(k => !prevSet.has(k));
  const removed = prev.filter(k => !nextSet.has(k));
  const kept = next.filter(k => prevSet.has(k));
  const prevKept = prev.filter(k => nextSet.has(k));
  const reordered = kept.some((k, i) => prevKept[i] !== k);
  return { added, removed, kept, reordered };
}

/**
 * Longest increasing subsequence of indices: the nodes that can stay where they are while the
 * rest move around them. Standard O(n log n) patience sort.
 * @param {number[]} seq
 * @returns {Set<number>}  Positions in `seq` that belong to the subsequence.
 */
export function stableIndices(seq) {
  const tails = [];
  const tailIdx = [];
  const parent = new Array(seq.length).fill(-1);
  for ( let i = 0; i < seq.length; i++ ) {
    const v = seq[i];
    let lo = 0;
    let hi = tails.length;
    while ( lo < hi ) {
      const mid = (lo + hi) >> 1;
      if ( tails[mid] < v ) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    parent[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const keep = new Set();
  let k = tailIdx[tails.length - 1] ?? -1;
  while ( k >= 0 ) {
    keep.add(k);
    k = parent[k];
  }
  return keep;
}

/**
 * Put `container`'s children into the order of `nodes`, moving as few as possible. Nodes not
 * already in the container are inserted; children not in `nodes` are left in place (the caller
 * removes departed nodes first, usually after an exit animation).
 * @param {Element} container
 * @param {Element[]} nodes      Desired order.
 * @returns {number}             How many nodes were moved or inserted.
 */
export function applyOrder(container, nodes) {
  const current = Array.from(container.children);
  const position = new Map(current.map((n, i) => [n, i]));
  const seq = nodes.map(n => position.get(n) ?? -1);
  const present = seq.map((p, i) => [p, i]).filter(([p]) => p >= 0);
  const lis = stableIndices(present.map(([p]) => p));
  const stay = new Set([...lis].map(i => present[i][1]));

  let moves = 0;
  // Walk backwards so each node is inserted before its already-placed successor.
  let anchor = null;
  for ( let i = nodes.length - 1; i >= 0; i-- ) {
    const node = nodes[i];
    if ( !stay.has(i) ) {
      const target = anchor ?? findTailAnchor(container, nodes);
      container.insertBefore(node, target);
      moves++;
    }
    anchor = node;
  }
  return moves;
}

/** The first child after the last managed node, so unmanaged trailing children stay trailing. */
function findTailAnchor(container, nodes) {
  const managed = new Set(nodes);
  const children = Array.from(container.children);
  for ( let i = children.length - 1; i >= 0; i-- ) {
    if ( managed.has(children[i]) ) return children[i].nextSibling;
  }
  return container.firstChild;
}
