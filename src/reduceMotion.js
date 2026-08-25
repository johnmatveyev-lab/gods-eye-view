/**
 * Decorative-motion preference for Meridian.
 *
 * Effective reduce-motion is:
 *   - persist `meridian.reduceMotion` = `1` → on
 *   - persist `meridian.reduceMotion` = `0` → off (overrides the OS)
 *   - unset → follow `prefers-reduced-motion: reduce`
 *
 * This gates idle spin, pulsing chrome, and trail flourish only.
 * Functional camera moves (fly-to Home / landmarks) stay live.
 * Data polls and `/api` are out of scope.
 */

export const REDUCE_MOTION_STORAGE_KEY = 'meridian.reduceMotion';

const listeners = new Set();

function mediaQueryList() {
  try {
    const matchMedia = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      ? window.matchMedia.bind(window)
      : (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia.bind(globalThis) : null);
    return matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    return null;
  }
}

function storage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Privacy mode / missing Storage.
  }
  return null;
}

/** Whether the operating system asked for reduced motion. */
export function osPrefersReducedMotion() {
  return mediaQueryList()?.matches === true;
}

/**
 * Explicit persist override, or `null` when the OS should decide.
 * @returns {boolean|null}
 */
export function readReduceMotionOverride() {
  const raw = storage()?.getItem(REDUCE_MOTION_STORAGE_KEY);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/** Effective reduce-motion: persist override, otherwise the OS query. */
export function isReduceMotionEnabled() {
  const override = readReduceMotionOverride();
  return override === null ? osPrefersReducedMotion() : override;
}

/**
 * Alias used by camera verbs and other existing call sites.
 * Honors both the OS query and `meridian.reduceMotion`.
 */
export function prefersReducedMotion() {
  return isReduceMotionEnabled();
}

/**
 * Persist an explicit override and publish it to the document + listeners.
 * @param {boolean} enabled
 */
export function setReduceMotionOverride(enabled) {
  try {
    storage()?.setItem(REDUCE_MOTION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Best-effort persist.
  }
  applyReduceMotionDocument();
  notifyReduceMotionListeners();
}

/**
 * Stamp `data-reduce-motion` so CSS can honor persist independently of the OS.
 * @param {Document} [root]
 * @returns {boolean} Effective reduce-motion after applying.
 */
export function applyReduceMotionDocument(root = globalThis.document) {
  const enabled = isReduceMotionEnabled();
  const el = root?.documentElement;
  if (el?.dataset) el.dataset.reduceMotion = enabled ? 'true' : 'false';
  el?.classList?.toggle?.('reduce-motion', enabled);
  return enabled;
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function subscribeReduceMotion(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyReduceMotionListeners() {
  const enabled = isReduceMotionEnabled();
  for (const listener of listeners) {
    try { listener(enabled); } catch { /* keep other subscribers live */ }
  }
}

/**
 * Decorative annotation pulse. Flat 1 when reduce-motion is on.
 * @param {number} [nowMs]
 */
export function decorativePulseFactor(nowMs = (typeof performance !== 'undefined' ? performance.now() : 0)) {
  if (isReduceMotionEnabled()) return 1;
  return 0.8 + 0.2 * Math.sin(nowMs * 0.005);
}

/**
 * Route-trail flourish clock. Frozen at 0 when reduce-motion is on.
 * @param {number} [nowMs]
 */
export function decorativeFlowTimeSeconds(nowMs = (typeof performance !== 'undefined' ? performance.now() : 0)) {
  return isReduceMotionEnabled() ? 0 : nowMs / 1000;
}

/**
 * Apply the current preference and listen for OS / storage changes.
 * @param {Document} [root]
 * @returns {() => void} Cleanup.
 */
export function initReduceMotion(root = globalThis.document) {
  applyReduceMotionDocument(root);
  const media = mediaQueryList();
  const onChange = () => {
    applyReduceMotionDocument(root);
    notifyReduceMotionListeners();
  };
  media?.addEventListener?.('change', onChange);
  const onStorage = (event) => {
    if (event?.key && event.key !== REDUCE_MOTION_STORAGE_KEY) return;
    applyReduceMotionDocument(root);
    notifyReduceMotionListeners();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    media?.removeEventListener?.('change', onChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}
