/**
 * Shortcuts overlay catalog (PLAN 42).
 *
 * Hosted chrome lists claimed keys here so new input (WASD / arrows) can
 * appear the moment it ships. This module is the overlay listing — it does
 * not steal `?`, `F`, or `H`.
 */

import { KEYBOARD_PAN_SHORTCUTS } from './keyboardPan.js';
import { LOOK_SHORTCUT_OVERLAY_ENTRIES } from './cameraLookKeys.js';

export const SHORTCUT_OVERLAY_ROWS = Object.freeze([
  { keys: '1–7', label: 'Visual styles' },
  { keys: 'H', label: 'Toggle HUD' },
  { keys: 'F', label: 'Data layers' },
  { keys: 'C', label: 'CCTV' },
  { keys: 'O', label: 'Orbit' },
  { keys: 'V', label: 'Clean view' },
  { keys: 'N', label: 'North-up heading' },
  { keys: 'Home', label: 'Home view' },
  { keys: 'Esc', label: 'Dismiss / exit' },
  { keys: '?', label: 'This shortcuts list' },
  ...KEYBOARD_PAN_SHORTCUTS,
  ...LOOK_SHORTCUT_OVERLAY_ENTRIES,
]);

/** Plain-text listing the overlay renders. */
export function listShortcutOverlayText(rows = SHORTCUT_OVERLAY_ROWS) {
  return rows.map((row) => `${row.keys} — ${row.label}`).join('\n');
}

export function shortcutOverlayLists(keys, rows = SHORTCUT_OVERLAY_ROWS) {
  const needle = String(keys || '').toLowerCase();
  return rows.some((row) => String(row.keys).toLowerCase().includes(needle));
}
