/**
 * Coalesces render requests into one flush per animation frame (spec R5).
 *
 * Every trigger — a combatant update, an actor's HP change, a new effect, a turn change — only
 * marks what went stale. The flush then sees the whole batch at once, so rolling initiative for
 * twelve NPCs (twelve `updateCombatant` hooks in one tick) costs one render, not twelve full
 * rebuilds as it did in the reference module.
 */
export class RenderScheduler {

  #flush;
  #request;
  #cancel;
  #pending = null;
  #dirty = new Set();
  #order = false;
  #all = false;

  /**
   * @param {(batch: {ids: Set<string>, order: boolean, all: boolean}) => void} flush
   * @param {object} [options]
   * @param {(fn: Function) => any} [options.request]  Schedules the flush (default rAF).
   * @param {(handle: any) => void} [options.cancel]
   */
  constructor(flush, { request = fn => requestAnimationFrame(fn),
    cancel = handle => cancelAnimationFrame(handle) } = {}) {
    this.#flush = flush;
    this.#request = request;
    this.#cancel = cancel;
  }

  /** Whether a flush is scheduled. */
  get pending() {
    return this.#pending !== null;
  }

  /** One combatant's portrait needs re-deriving. */
  markDirty(id) {
    this.#dirty.add(id);
    this.#schedule();
  }

  /** The order, membership or turn pointer changed. */
  markOrder() {
    this.#order = true;
    this.#schedule();
  }

  /** Everything is stale (settings change, style switch, bind). */
  markAll() {
    this.#all = true;
    this.#order = true;
    this.#schedule();
  }

  /** Run a scheduled flush now, synchronously. No-op if nothing is pending. */
  flushNow() {
    if ( this.#pending === null ) return;
    this.#cancel(this.#pending);
    this.#run();
  }

  /** Drop anything pending without flushing. */
  cancel() {
    if ( this.#pending !== null ) this.#cancel(this.#pending);
    this.#pending = null;
    this.#dirty.clear();
    this.#order = this.#all = false;
  }

  #schedule() {
    if ( this.#pending !== null ) return;
    this.#pending = this.#request(() => this.#run());
  }

  #run() {
    const batch = { ids: this.#dirty, order: this.#order, all: this.#all };
    this.#pending = null;
    this.#dirty = new Set();
    this.#order = this.#all = false;
    this.#flush(batch);
  }
}
