/**
 * Hosted Clean view chrome. Toggles the existing `ui-clean-view` panel-fade
 * path (Plan 27 / recording). Does not invent a second hide system.
 * #cesium-credits stays painted — Google Maps + Data attribution remain.
 */

export const CLEAN_VIEW_BODY_CLASS = 'ui-clean-view';
export const CLEAN_VIEW_CHROME_ID = 'clean-view-chrome';

/**
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isCleanView(doc = globalThis.document) {
  return Boolean(doc?.body?.classList?.contains(CLEAN_VIEW_BODY_CLASS));
}

/**
 * Write the existing clean-view body class. No other hide class.
 * @param {boolean} enabled
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function setCleanViewEnabled(enabled, doc = globalThis.document) {
  const on = Boolean(enabled);
  doc?.body?.classList?.toggle(CLEAN_VIEW_BODY_CLASS, on);
  return on;
}

/**
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function toggleCleanViewClass(doc = globalThis.document) {
  return setCleanViewEnabled(!isCleanView(doc), doc);
}

/**
 * Escape restores chrome when clean view is on. Fullscreen Esc is separate.
 * @param {{key?: string, preventDefault?: Function}|null|undefined} event
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function handleCleanViewEscape(event, doc = globalThis.document) {
  if (event?.key !== 'Escape') return false;
  if (!isCleanView(doc)) return false;
  event.preventDefault?.();
  setCleanViewEnabled(false, doc);
  return true;
}

/**
 * @param {HTMLElement|null|undefined} button
 * @param {boolean} active
 */
export function syncCleanViewButton(button, active) {
  if (!button) return;
  const on = Boolean(active);
  button.classList?.toggle?.('active', on);
  button.setAttribute?.('aria-pressed', String(on));
  button.setAttribute?.('aria-label', on ? 'Exit clean view' : 'Clean view');
  const title = on ? 'Exit clean view (Esc)' : 'Clean view';
  if ('title' in button) button.title = title;
  else button.setAttribute?.('title', title);
  const icon = button.querySelector?.('.material-symbols-outlined');
  if (icon) icon.textContent = on ? 'visibility' : 'visibility_off';
}
