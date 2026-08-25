/**
 * Keyboard pan — WASD and arrows translate the camera over the globe.
 *
 * Uses the shared `translateCamera` helper (same moveLeft/Right/Up/Down path
 * as voice `move_camera` pan) so keep-above still lifts after a drive into
 * terrain. Shift uses the existing `PAN_VIEW_FRACTION_S.fast` rate.
 *
 * Does not claim `?`, `F`, or `H`. Text fields (layer filter, radio search)
 * keep their keys.
 */

import { interruptCameraMotion, PAN_VIEW_FRACTION_S, translateCamera } from './cameraVerbs.js';
import { governorRequestRender } from './renderGovernor.js';

const DEFAULT_DT_S = 1 / 60;
const TYPING_TARGET = 'input, textarea, select, [contenteditable], [role="textbox"]';

/** Overlay (42) rows for this feature. Shift is the existing faster rate. */
export const KEYBOARD_PAN_SHORTCUTS = Object.freeze([
  { keys: 'W A S D', label: 'Pan camera' },
  { keys: 'Arrow keys', label: 'Pan camera' },
  { keys: 'Shift + WASD / arrows', label: 'Pan faster' },
]);

const PAN_DIRECTIONS = Object.freeze({
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  arrowup: 'up',
  arrowleft: 'left',
  arrowdown: 'down',
  arrowright: 'right',
});

/** Keys already claimed by other chrome — never consume these for pan. */
const CLAIMED_NON_PAN_KEYS = Object.freeze(new Set(['?', 'f', 'h']));

/**
 * True when the event target is a text field or other typing control.
 * Covers `#data-layer-filter`, `#radio-station-search`, and `#radio-country`.
 */
export function isTypingTarget(target) {
  if (!target) return false;
  if (typeof target.closest === 'function') {
    return Boolean(target.closest(TYPING_TARGET));
  }
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select'
    || target.isContentEditable === true;
}

export function isClaimedNonPanKey(key) {
  const normalized = String(key || '');
  if (normalized === '?') return true;
  return CLAIMED_NON_PAN_KEYS.has(normalized.toLowerCase());
}

/** Map a keydown to a globe-pan direction, or null. */
export function panDirectionFromKey(key) {
  if (isClaimedNonPanKey(key)) return null;
  const normalized = String(key || '').toLowerCase();
  return PAN_DIRECTIONS[normalized] || null;
}

/** Metres to translate for one key event. Shift uses the existing fast rate. */
export function keyboardPanDistanceM(camera, { shiftKey = false, dt = DEFAULT_DT_S } = {}) {
  const heightM = Math.max(50, Number(camera?.positionCartographic?.height) || 50);
  const rate = shiftKey ? PAN_VIEW_FRACTION_S.fast : PAN_VIEW_FRACTION_S.normal;
  const stepS = Number.isFinite(dt) && dt > 0 ? dt : DEFAULT_DT_S;
  return heightM * rate * stepS;
}

function viewerAllowsKeyboardPan(viewer) {
  if (!viewer?.camera) return false;
  if (viewer.trackedEntity) return false;
  const body = globalThis.document?.body;
  if (body?.classList?.contains('cockpit-mode')) return false;
  return true;
}

/**
 * Apply one WASD / arrow pan step.
 * @returns {{direction: string, distanceM: number}|null}
 */
export function applyKeyboardPan(event, camera, options = {}) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  const direction = panDirectionFromKey(event.key);
  if (!direction) return null;
  const distanceM = keyboardPanDistanceM(camera, {
    shiftKey: !!event.shiftKey,
    dt: options.dt,
  });
  if (!translateCamera(camera, direction, distanceM)) return null;
  options.afterMove?.(camera, { direction, distanceM });
  return { direction, distanceM };
}

/**
 * Global keydown hook. Consumes WASD / arrows so they do not also fire
 * other letter hotkeys (D = detection) while panning.
 */
export function handleKeyboardPanKeyDown(event, viewer, options = {}) {
  if (!viewerAllowsKeyboardPan(viewer)) return false;
  const result = applyKeyboardPan(event, viewer.camera, options);
  if (!result) return false;
  interruptCameraMotion('manual-input');
  governorRequestRender('keyboard-pan');
  event.preventDefault?.();
  return true;
}
