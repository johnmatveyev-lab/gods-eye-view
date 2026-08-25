/**
 * Chrome live-poll scheduler for Meridian.
 *
 * Uses document.visibilityState and window online/offline only. Hidden or
 * offline pauses registered poll handles; visible and online runs one refresh
 * and then restarts intervals. Recovering from hidden+offline cannot
 * double-start timers because both conditions share one suspended flag.
 *
 * Voice sessions and AIS streams are not registered here.
 */

/**
 * @typedef {object} LivePollState
 * @property {boolean} hidden Tab is not visible.
 * @property {boolean} offline Window reports offline.
 * @property {boolean} suspended Hidden or offline — polls must not run.
 */

/**
 * @typedef {object} LivePollHandle
 * @property {() => void} start Arm the interval. Must be idempotent.
 * @property {() => void} stop Clear the interval. Must be idempotent.
 * @property {() => void} [refresh] One immediate tick used on resume.
 * @property {boolean} [running] True when the handle is already armed.
 */

/**
 * Whether chrome state should pause live polls.
 * @param {Pick<LivePollState, 'hidden' | 'offline'>} state Chrome flags.
 * @returns {boolean} True when polls must stay stopped.
 */
export function isLivePollSuspended(state = {}) {
  return state.hidden === true || state.offline === true;
}

/**
 * Read Page Visibility from a document-like host.
 * @param {Document|{visibilityState?: string, hidden?: boolean}|null|undefined} doc Host.
 * @returns {boolean} True when the tab is hidden.
 */
export function readDocumentHidden(doc) {
  if (!doc) return false;
  if (typeof doc.visibilityState === 'string') return doc.visibilityState === 'hidden';
  return doc.hidden === true;
}

/**
 * Read navigator.onLine from a window-like host.
 * @param {Window|{navigator?: {onLine?: boolean}}|null|undefined} win Host.
 * @returns {boolean} True when the window reports offline.
 */
export function readWindowOffline(win) {
  if (!win || !win.navigator) return false;
  return win.navigator.onLine === false;
}

/**
 * Create a chrome-only live-poll scheduler.
 * @param {object} [env] Injectable document/window for tests.
 * @param {Document|EventTarget} [env.document]
 * @param {Window|EventTarget} [env.window]
 * @returns {{getState: Function, subscribe: Function, register: Function, handleIds: Function, isHandleRunning: Function, attach: Function, detach: Function, apply: Function}}
 */
export function createLivePollScheduler({
  document: doc = globalThis.document,
  window: win = globalThis.window,
} = {}) {
  /** @type {Map<string, {start: Function, stop: Function, refresh?: Function, running: boolean}>} */
  const handles = new Map();
  const listeners = new Set();
  let hidden = readDocumentHidden(doc);
  let offline = readWindowOffline(win);
  let attached = false;

  /**
   * @returns {LivePollState}
   */
  function getState() {
    return Object.freeze({
      hidden,
      offline,
      suspended: isLivePollSuspended({ hidden, offline }),
    });
  }

  function emit() {
    const state = getState();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.warn('[live-poll] subscriber error:', error);
      }
    }
  }

  function pauseHandles() {
    for (const handle of handles.values()) {
      if (!handle.running) continue;
      handle.stop();
      handle.running = false;
    }
  }

  function resumeHandles() {
    for (const handle of handles.values()) {
      try {
        handle.refresh?.();
      } catch (error) {
        console.warn('[live-poll] refresh error:', error);
      }
      if (handle.running) continue;
      handle.start();
      handle.running = true;
    }
  }

  function applyEnvironment() {
    const nextHidden = readDocumentHidden(doc);
    const nextOffline = readWindowOffline(win);
    const wasSuspended = isLivePollSuspended({ hidden, offline });
    const nextSuspended = isLivePollSuspended({ hidden: nextHidden, offline: nextOffline });
    hidden = nextHidden;
    offline = nextOffline;
    if (!wasSuspended && nextSuspended) pauseHandles();
    else if (wasSuspended && !nextSuspended) resumeHandles();
    emit();
  }

  return {
    getState,

    /**
     * Subscribe to chrome poll state. Fires immediately with the current state.
     * @param {(state: LivePollState) => void} listener
     * @returns {() => void} Disposer.
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(getState());
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * Register one named poll handle. Start/stop are the only timer owners
     * the scheduler will call; AIS and voice are not registered.
     * @param {string} id Handle id.
     * @param {LivePollHandle} spec Handle callbacks.
     * @returns {() => void} Unregister and stop if running.
     */
    register(id, spec) {
      const key = String(id || '').trim();
      if (!key) throw new Error('live-poll handle id is required');
      if (handles.has(key)) throw new Error(`Duplicate live-poll handle: ${key}`);
      if (typeof spec?.start !== 'function' || typeof spec?.stop !== 'function') {
        throw new Error(`live-poll handle ${key} needs start and stop`);
      }
      const handle = {
        start: spec.start,
        stop: spec.stop,
        refresh: typeof spec.refresh === 'function' ? spec.refresh : undefined,
        running: spec.running === true,
      };
      handles.set(key, handle);
      if (isLivePollSuspended({ hidden, offline })) {
        if (handle.running) {
          handle.stop();
          handle.running = false;
        }
      } else if (!handle.running) {
        handle.start();
        handle.running = true;
      }
      return () => {
        const current = handles.get(key);
        if (!current) return;
        if (current.running) current.stop();
        handles.delete(key);
      };
    },

    /** @returns {string[]} Registered handle ids. */
    handleIds() {
      return [...handles.keys()];
    },

    /** @returns {boolean} True when the named handle is currently armed. */
    isHandleRunning(id) {
      return handles.get(String(id))?.running === true;
    },

    attach() {
      if (attached) return;
      attached = true;
      doc?.addEventListener?.('visibilitychange', applyEnvironment);
      win?.addEventListener?.('offline', applyEnvironment);
      win?.addEventListener?.('online', applyEnvironment);
      applyEnvironment();
    },

    detach() {
      if (!attached) return;
      attached = false;
      doc?.removeEventListener?.('visibilitychange', applyEnvironment);
      win?.removeEventListener?.('offline', applyEnvironment);
      win?.removeEventListener?.('online', applyEnvironment);
    },

    /**
     * Test/QA seam: apply a synthetic chrome snapshot.
     * @param {{hidden?: boolean, offline?: boolean}} next
     */
    apply(next = {}) {
      if (typeof next.hidden === 'boolean' && doc) {
        doc.visibilityState = next.hidden ? 'hidden' : 'visible';
        doc.hidden = next.hidden;
      }
      if (typeof next.offline === 'boolean' && win) {
        if (!win.navigator) win.navigator = {};
        win.navigator.onLine = !next.offline;
      }
      applyEnvironment();
    },
  };
}
