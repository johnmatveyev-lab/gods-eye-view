/**
 * Keyboard shortcuts overlay (`?`).
 *
 * Documents the hosted keys that are actually wired. Pitch is R / PageUp /
 * PageDown — F remains the data-panel shortcut.
 */

import { SHORTCUT_OVERLAY_ROWS } from './shortcutsOverlay.js';

/** Overlay rows — the shared PLAN 42 catalog, including look keys. */
export const KEYBOARD_SHORTCUT_ENTRIES = SHORTCUT_OVERLAY_ROWS;

const OVERLAY_ID = 'keyboard-shortcuts-overlay';
const LIST_ID = 'keyboard-shortcuts-list';
const TOGGLE_ID = 'keyboard-shortcuts-toggle';

/**
 * Whether this event should toggle the shortcuts overlay.
 * @param {KeyboardEvent|object|null} event
 * @returns {boolean}
 */
export function isShortcutsOverlayToggle(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const key = String(event.key || '');
  if (key === '?') return true;
  return key === '/' && event.shiftKey === true;
}

/**
 * Fill `#keyboard-shortcuts-list` from {@link KEYBOARD_SHORTCUT_ENTRIES}.
 * @param {Document|null} [doc]
 * @returns {number} Rows written.
 */
export function renderKeyboardShortcutsOverlay(doc = globalThis.document) {
  const list = doc?.getElementById?.(LIST_ID);
  if (!list) return 0;
  list.replaceChildren();
  for (const entry of KEYBOARD_SHORTCUT_ENTRIES) {
    const row = doc.createElement('div');
    row.className = 'keyboard-shortcut-row';
    const dt = doc.createElement('dt');
    dt.textContent = entry.keys;
    const dd = doc.createElement('dd');
    dd.textContent = entry.label || entry.action;
    row.append(dt, dd);
    list.append(row);
  }
  return KEYBOARD_SHORTCUT_ENTRIES.length;
}

/**
 * @param {Document|null} [doc]
 * @returns {boolean}
 */
export function isKeyboardShortcutsOverlayOpen(doc = globalThis.document) {
  const overlay = doc?.getElementById?.(OVERLAY_ID);
  return Boolean(overlay) && !overlay.hidden;
}

/**
 * @param {boolean} open
 * @param {Document|null} [doc]
 * @returns {boolean}
 */
export function setKeyboardShortcutsOverlayOpen(open, doc = globalThis.document) {
  const overlay = doc?.getElementById?.(OVERLAY_ID);
  if (!overlay) return false;
  if (open) renderKeyboardShortcutsOverlay(doc);
  overlay.hidden = !open;
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  doc?.getElementById?.(TOGGLE_ID)?.setAttribute?.('aria-expanded', open ? 'true' : 'false');
  return true;
}

/**
 * Wire the chrome `?` button. The `?` key is handled in the global keydown.
 * @param {Document|null} [doc]
 * @returns {() => void}
 */
export function bindKeyboardShortcutsToggle(doc = globalThis.document) {
  const button = doc?.getElementById?.(TOGGLE_ID);
  if (!button?.addEventListener) return () => {};
  const onClick = (event) => {
    event.preventDefault();
    toggleKeyboardShortcutsOverlay(doc);
  };
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}

/**
 * @param {Document|null} [doc]
 * @returns {boolean} True when the overlay is now open.
 */
export function toggleKeyboardShortcutsOverlay(doc = globalThis.document) {
  const next = !isKeyboardShortcutsOverlayOpen(doc);
  setKeyboardShortcutsOverlayOpen(next, doc);
  return next;
}

/**
 * Handle `?` / Shift+/. Returns true when the event was consumed.
 * @param {KeyboardEvent|object} event
 * @param {Document|null} [doc]
 * @returns {boolean}
 */
export function handleShortcutsOverlayKeyDown(event, doc = globalThis.document) {
  if (!isShortcutsOverlayToggle(event)) return false;
  toggleKeyboardShortcutsOverlay(doc);
  event.preventDefault?.();
  return true;
}
