/**
 * One owner for everything that has to be undone (spec R2).
 *
 * The reference module leaked because each resource was registered ad hoc and released ad hoc:
 * a `resize` listener removed with a fresh `.bind()` that never matched, `Hooks.once` callbacks
 * that could outlive the dock, timers that fired into a closed app. Here every hook, DOM
 * listener, timer, animation frame and observer goes through a Lifecycle, and `dispose()`
 * releases all of them. A disposed Lifecycle refuses new registrations, so a late async callback
 * can't re-attach something after teardown.
 */
export class Lifecycle {

  /** @type {Array<[string, number]>} */
  #hooks = [];
  #controller = new AbortController();
  #timers = new Set();
  #frames = new Set();
  /** @type {Array<() => void>} */
  #disposers = [];
  #disposed = false;
  #env;

  /**
   * @param {object} [env]  Injectable globals, for tests.
   * @param {typeof Hooks} [env.hooks]
   */
  constructor({ hooks = globalThis.Hooks,
    // Wrapped, not referenced: the browser's timer functions throw "Illegal invocation" when called
    // with any `this` other than the window, and `this.#env.st(…)` would pass the env object.
    setTimeout: st = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: ct = id => globalThis.clearTimeout(id),
    requestAnimationFrame: raf = fn => globalThis.requestAnimationFrame(fn),
    cancelAnimationFrame: caf = id => globalThis.cancelAnimationFrame(id) } = {}) {
    this.#env = { hooks, st, ct, raf, caf };
  }

  /** Whether {@link dispose} has run. */
  get disposed() {
    return this.#disposed;
  }

  /** An AbortSignal that aborts on dispose. Pass it to `addEventListener` or `fetch`. */
  get signal() {
    return this.#controller.signal;
  }

  /** Number of live registrations, by kind. Used by tests and the debug overlay. */
  get counts() {
    return { hooks: this.#hooks.length, timers: this.#timers.size, frames: this.#frames.size,
      disposers: this.#disposers.length };
  }

  /**
   * Register a Foundry hook for the life of this owner.
   * @param {string} hook
   * @param {Function} fn
   * @returns {number|null}  The hook id, or null if already disposed.
   */
  hook(hook, fn) {
    if ( this.#disposed ) return null;
    const id = this.#env.hooks.on(hook, fn);
    this.#hooks.push([hook, id]);
    return id;
  }

  /**
   * Add a DOM listener that is removed on dispose.
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} fn
   * @param {AddEventListenerOptions} [options]
   */
  listen(target, type, fn, options = {}) {
    if ( this.#disposed ) return;
    target.addEventListener(type, fn, { ...options, signal: this.#controller.signal });
  }

  /** setTimeout that is cleared on dispose. */
  timeout(fn, ms) {
    if ( this.#disposed ) return null;
    const id = this.#env.st(() => {
      this.#timers.delete(id);
      fn();
    }, ms);
    this.#timers.add(id);
    return id;
  }

  /** Cancel one timer made by {@link timeout}. */
  clearTimeout(id) {
    if ( !this.#timers.delete(id) ) return;
    this.#env.ct(id);
  }

  /** requestAnimationFrame that is cancelled on dispose. */
  frame(fn) {
    if ( this.#disposed ) return null;
    const id = this.#env.raf(time => {
      this.#frames.delete(id);
      fn(time);
    });
    this.#frames.add(id);
    return id;
  }

  /** Cancel one frame made by {@link frame}. */
  cancelFrame(id) {
    if ( !this.#frames.delete(id) ) return;
    this.#env.caf(id);
  }

  /**
   * Register an arbitrary cleanup (an observer's `disconnect`, an animation's `cancel`).
   * Runs in reverse registration order on dispose.
   * @param {() => void} fn
   */
  add(fn) {
    if ( this.#disposed ) {
      fn();
      return;
    }
    this.#disposers.push(fn);
  }

  /** Release everything. Idempotent. */
  dispose() {
    if ( this.#disposed ) return;
    this.#disposed = true;
    for ( const [hook, id] of this.#hooks ) {
      try { this.#env.hooks.off(hook, id); } catch { /* already gone */ }
    }
    this.#hooks.length = 0;
    this.#controller.abort();
    for ( const id of this.#timers ) this.#env.ct(id);
    this.#timers.clear();
    for ( const id of this.#frames ) this.#env.caf(id);
    this.#frames.clear();
    for ( const fn of this.#disposers.reverse() ) {
      try { fn(); } catch ( err ) { console.error(err); }
    }
    this.#disposers.length = 0;
  }
}
