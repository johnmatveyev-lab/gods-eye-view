/**
 * @module contactLabels
 * @description Display-only preference for ambient contact billboard text.
 *
 * Busy FIRs paint a callsign on every nearby contact. Density still owns how
 * many detections are collected; this flag only hides the text glyph (or the
 * existing Cesium `label.show` bit when a contact has one). Dots, models, and
 * trails stay. The selected/tracked ident card is not a billboard and stays
 * visible. Default on. Persisted at `meridian.contactLabels`. No /api.
 */

export const CONTACT_LABELS_KEY = 'meridian.contactLabels';
export const CONTACT_LABELS_CHANGED_EVENT = 'gev:contact-labels-changed';

/** Sources whose ambient label/track variants are contact billboards. */
export const CONTACT_LABEL_SOURCES = Object.freeze([
  'flights',
  'military',
  'ais-live-vessels',
  'satellites',
]);

let _enabled = true;
let _hydrated = false;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a stored preference. Missing/unknown values default ON.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function contactLabelsEnabledFromStoredValue(raw) {
  if (raw == null || raw === '') return true;
  const value = String(raw).trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'on') return true;
  return true;
}

/**
 * @param {Pick<Storage, 'getItem'>|null|undefined} storage
 * @returns {boolean}
 */
export function readContactLabelsEnabled(storage) {
  if (!storage?.getItem) return true;
  try {
    return contactLabelsEnabledFromStoredValue(storage.getItem(CONTACT_LABELS_KEY));
  } catch {
    return true;
  }
}

/**
 * @param {Pick<Storage, 'setItem'>|null|undefined} storage
 * @param {boolean} enabled
 * @returns {boolean} Whether the write succeeded.
 */
export function writeContactLabelsEnabled(storage, enabled) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(CONTACT_LABELS_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

function emitContactLabelsChanged(enabled) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(CONTACT_LABELS_CHANGED_EVENT, {
    detail: { enabled },
  }));
}

/**
 * @param {Pick<Storage, 'getItem'>|null|undefined} [storage]
 * @returns {boolean}
 */
export function getContactLabelsEnabled(storage = defaultStorage()) {
  if (!_hydrated) {
    _enabled = readContactLabelsEnabled(storage);
    _hydrated = true;
  }
  return _enabled;
}

/**
 * @param {boolean} enabled
 * @param {Pick<Storage, 'setItem'>|null|undefined} [storage]
 * @returns {boolean} The canonical enabled state.
 */
export function setContactLabelsEnabled(enabled, storage = defaultStorage()) {
  const next = enabled !== false;
  const changed = !_hydrated || next !== _enabled;
  _enabled = next;
  _hydrated = true;
  writeContactLabelsEnabled(storage, next);
  if (changed) emitContactLabelsChanged(next);
  return next;
}

/** Test-only: restore the default-on, unhydrated module state. */
export function resetContactLabelsForTest() {
  _enabled = true;
  _hydrated = false;
}

/**
 * Hide or show a Cesium-style `label.show` graphic when one exists.
 * @param {{label?: {show?: boolean}}|null|undefined} target
 * @param {boolean} visible
 * @returns {boolean} True when a label.show flag was written.
 */
export function applyContactLabelShow(target, visible) {
  const label = target?.label;
  if (!label || typeof label !== 'object') return false;
  label.show = visible === true;
  return true;
}

/**
 * @param {string|null|undefined} sourceId
 * @returns {boolean}
 */
export function isContactLabelSource(sourceId) {
  const source = String(sourceId || '');
  return CONTACT_LABEL_SOURCES.some((id) => (
    source === id || source.startsWith(`${id}-`) || source.startsWith(`${id}:`)
  ));
}

/**
 * Selected/tracked cards keep ident even when ambient labels are off.
 * @param {{selected?: boolean, tracked?: boolean, variant?: string}} [entry]
 * @returns {boolean}
 */
export function isProtectedIdentSurface(entry = {}) {
  return entry.selected === true
    || entry.tracked === true
    || entry.variant === 'selected'
    || entry.variant === 'tracked';
}

/**
 * Decide whether ambient contact billboard text should paint.
 *
 * Uses an existing `skipLabel` or `label.show` flag when present; otherwise
 * the persisted Labels preference hides only contact billboard text. Density
 * is not consulted. FIRMS/WX/cards are not contacts.
 *
 * @param {{
 *   skipLabel?: boolean,
 *   label?: {show?: boolean},
 *   source?: string,
 *   selected?: boolean,
 *   tracked?: boolean,
 *   variant?: string,
 * }} [entry]
 * @param {boolean} [labelsEnabled]
 * @returns {boolean}
 */
export function shouldPaintContactLabelText(entry = {}, labelsEnabled = getContactLabelsEnabled()) {
  if (isProtectedIdentSurface(entry)) return true;
  if (entry.skipLabel === true) return false;
  if (entry.label && typeof entry.label === 'object' && Object.hasOwn(entry.label, 'show')) {
    if (entry.label.show === false) return false;
  }
  if (labelsEnabled === false) {
    if (entry.source && !isContactLabelSource(entry.source)) return true;
    return false;
  }
  return true;
}
