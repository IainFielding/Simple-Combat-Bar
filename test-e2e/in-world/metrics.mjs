/**
 * Measurements that mean the same thing for both subjects — this module ("scb") and
 * combat-tracker-dock ("ctd") — so the reports compare like with like.
 */

/** Total callbacks in Foundry's hook table. A leak shows up here first. */
export function hookCount() {
  return Object.values(Hooks.events).reduce((n, list) => n + list.length, 0);
}

/** Hook callbacks per event name, for diffing when the total moves. */
export function hookTable() {
  return Object.fromEntries(Object.entries(Hooks.events).map(([k, v]) => [k, v.length]).filter(([, n]) => n));
}

/** Elements in the document. */
export function domCount() {
  return document.getElementsByTagName("*").length;
}

/** The subject's portrait elements currently in the document. */
export function portraitCount(subject) {
  return document.querySelectorAll(subject === "scb" ? ".scb-portrait" : ".combatant-portrait").length;
}

/**
 * Count elements *created* under #ui-top while `fn` runs. Moving an existing node (which the
 * combat bar does on every turn) is not creation; replacing it with a new one (what a rebuild
 * does) is. MutationObserver reports both as additions, so nodes that existed before are
 * remembered and excluded.
 * @param {() => Promise<void>} fn
 * @returns {Promise<{created: number, removed: number}>}
 */
export async function countCreated(fn) {
  const host = document.getElementById("ui-top");
  const existing = new WeakSet(host.querySelectorAll("*"));
  let created = 0;
  let removed = 0;
  const tally = records => {
    for ( const r of records ) {
      for ( const node of r.addedNodes ) {
        if ( node.nodeType !== 1 ) continue;
        if ( !existing.has(node) ) created += 1;
        for ( const child of node.querySelectorAll("*") ) if ( !existing.has(child) ) created += 1;
        existing.add(node);
        for ( const child of node.querySelectorAll("*") ) existing.add(child);
      }
      removed += Array.from(r.removedNodes).filter(n => n.nodeType === 1).length;
    }
  };
  const observer = new MutationObserver(tally);
  observer.observe(host, { childList: true, subtree: true });
  try {
    await fn();
  } finally {
    tally(observer.takeRecords());
    observer.disconnect();
  }
  return { created, removed };
}
