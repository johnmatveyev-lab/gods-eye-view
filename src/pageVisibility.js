/**
 * Client page-visibility scheduler.
 *
 * Hidden tabs must not keep spending live poll budget. This module only
 * answers "is the tab hidden?" and "is a voice session mid-call?" so existing
 * poll handles can stop and restart. It adds no data sources.
 */

/**
 * @returns {boolean} True when the document is in the hidden visibility state.
 */
export function isDocumentHidden() {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden' || document.hidden === true;
}

/**
 * @returns {boolean} True while Meridian voice is mid-call. Hidden-tab poll
 *   pause must not hang up that session.
 */
export function isVoiceSessionActive() {
  if (typeof window === 'undefined') return false;
  try {
    return window.__godsEyeView?.voiceCommands?.isActive?.() === true;
  } catch {
    return false;
  }
}

/**
 * Scheduled OpenAI / Google Places work must not start while the tab is
 * hidden. An active voice session may still resolve Places mid-call.
 * @returns {boolean}
 */
export function shouldDeferBackgroundNetwork() {
  return isDocumentHidden() && !isVoiceSessionActive();
}

/**
 * Subscribe to document visibility changes. Safe in Node tests that have no
 * document, or a stub without addEventListener.
 * @param {(hidden: boolean) => void} onChange
 * @returns {() => void} Unsubscribe.
 */
export function subscribePageVisibility(onChange) {
  if (typeof onChange !== 'function') return () => {};
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return () => {};
  }
  const handler = () => {
    onChange(isDocumentHidden());
  };
  document.addEventListener('visibilitychange', handler);
  return () => {
    document.removeEventListener?.('visibilitychange', handler);
  };
}
