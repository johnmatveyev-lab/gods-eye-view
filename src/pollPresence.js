/**
 * Pause live data polls while the tab is hidden or the browser is offline.
 *
 * Existing setInterval handles stay armed — ticks no-op until the tab is
 * visible and online again, then one resume refresh runs. Hidden + offline
 * is a single "not allowed" state, so returning from both events cannot
 * start a second timer.
 *
 * Does not touch voice. No service worker. No /api routes.
 */

export const OFFLINE_CHIP_ID = 'meridian-offline-chip';
export const OFFLINE_CHIP_LABEL = 'OFFLINE';

export function isDocumentHidden(doc = globalThis.document) {
  return Boolean(doc && doc.hidden);
}

export function isBrowserOffline(nav = globalThis.navigator) {
  return nav != null && nav.onLine === false;
}

export function canPoll({
  document: doc = globalThis.document,
  navigator: nav = globalThis.navigator,
} = {}) {
  return !isDocumentHidden(doc) && !isBrowserOffline(nav);
}

export function createPollPresence(options = {}) {
  const listeners = new Set();
  let installed = false;
  let lastAllowed = null;
  let resumeQueued = false;
  let unbind = [];

  function env() {
    return {
      document: options.document ?? globalThis.document,
      window: options.window ?? globalThis.window,
      navigator: options.navigator ?? globalThis.navigator,
    };
  }

  function snapshot() {
    const { document: doc, navigator: nav } = env();
    const hidden = isDocumentHidden(doc);
    const offline = isBrowserOffline(nav);
    return { hidden, offline, allowed: !hidden && !offline };
  }

  function renderOfflineChip(offline = snapshot().offline) {
    const { document: doc } = env();
    if (!doc?.body || typeof doc.createElement !== 'function') return null;
    let chip = typeof doc.getElementById === 'function'
      ? doc.getElementById(OFFLINE_CHIP_ID)
      : null;
    if (!chip) {
      chip = doc.createElement('div');
      chip.id = OFFLINE_CHIP_ID;
      chip.className = 'meridian-offline-chip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      chip.textContent = OFFLINE_CHIP_LABEL;
      doc.body.appendChild(chip);
    }
    chip.hidden = !offline;
    if (chip.dataset) chip.dataset.offline = offline ? '1' : '0';
    return chip;
  }

  function notifyResume() {
    const state = snapshot();
    if (!state.allowed) return;
    for (const listener of [...listeners]) listener({ type: 'resume', ...state });
    options.onResume?.(state);
  }

  function queueResume() {
    if (resumeQueued) return;
    resumeQueued = true;
    queueMicrotask(() => {
      resumeQueued = false;
      notifyResume();
    });
  }

  function sync() {
    const state = snapshot();
    renderOfflineChip(state.offline);
    const wasAllowed = lastAllowed;
    lastAllowed = state.allowed;
    if (wasAllowed === false && state.allowed) queueResume();
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    for (const off of unbind) off();
    unbind = [];
    listeners.clear();
    lastAllowed = null;
    resumeQueued = false;
  }

  function install() {
    if (installed) return uninstall;
    installed = true;
    const { document: doc, window: win } = env();
    lastAllowed = snapshot().allowed;
    const onSync = () => { sync(); };
    doc?.addEventListener?.('visibilitychange', onSync);
    win?.addEventListener?.('online', onSync);
    win?.addEventListener?.('offline', onSync);
    unbind = [
      () => doc?.removeEventListener?.('visibilitychange', onSync),
      () => win?.removeEventListener?.('online', onSync),
      () => win?.removeEventListener?.('offline', onSync),
    ];
    sync();
    return uninstall;
  }

  return {
    canPoll: () => snapshot().allowed,
    snapshot,
    sync,
    subscribe,
    install,
    uninstall,
    renderOfflineChip,
  };
}

export function installPollPresence(options = {}) {
  const presence = createPollPresence(options);
  presence.install();
  return presence;
}
