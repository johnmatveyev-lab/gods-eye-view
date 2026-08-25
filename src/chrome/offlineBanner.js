/**
 * Offline chip for Meridian. Chrome online/offline only — no service worker.
 */

export const OFFLINE_CHIP_TEXT = 'Offline — showing last data';
export const OFFLINE_CHIP_ID = 'offline-chip';

/**
 * Show or hide the offline chip from chrome state.
 * @param {Pick<HTMLElement, 'hidden' | 'textContent' | 'setAttribute' | 'removeAttribute'>|null|undefined} el Chip node.
 * @param {{offline?: boolean}} state Chrome flags.
 * @returns {boolean} True when the chip is shown.
 */
export function syncOfflineBanner(el, state = {}) {
  if (!el) return false;
  const offline = state.offline === true;
  el.hidden = !offline;
  if (offline) {
    if (!String(el.textContent || '').trim()) el.textContent = OFFLINE_CHIP_TEXT;
    el.setAttribute?.('aria-hidden', 'false');
  } else {
    el.setAttribute?.('aria-hidden', 'true');
  }
  return offline;
}

/**
 * Bind the chip to a live-poll scheduler.
 * @param {{subscribe?: Function}} scheduler Chrome scheduler.
 * @param {ParentNode|{getElementById?: Function}|null} [root=globalThis.document]
 * @returns {() => void} Disposer.
 */
export function installOfflineBanner(scheduler, root = globalThis.document) {
  const el = typeof root?.getElementById === 'function'
    ? root.getElementById(OFFLINE_CHIP_ID)
    : null;
  if (!el || typeof scheduler?.subscribe !== 'function') return () => {};
  return scheduler.subscribe((state) => {
    syncOfflineBanner(el, state);
  });
}
