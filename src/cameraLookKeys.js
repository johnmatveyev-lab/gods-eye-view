/**
 * Keyboard look — Q/E yaw heading, R / PageUp / PageDown pitch.
 *
 * WASD (and arrows, when present) stay pan. F stays the data-panel shortcut;
 * fullscreen is the chrome button + Escape. C is cockpit (selected aircraft)
 * or CCTV, so it is not a pitch key.
 *
 * Pitch keys no-op while tilt is locked (PLAN 82 / `meridian.lockTilt` /
 * Cesium `enableTilt === false`). Typing in inputs is ignored.
 */

import * as Cesium from 'cesium';

/** Degrees per key tap (and per repeat). */
export const LOOK_STEP_DEG = 5;
export const LOOK_STEP_RAD = Cesium.Math.toRadians(LOOK_STEP_DEG);

/** Same horizon/nadir clamps as `cameraVerbs` tilt. */
export const LOOK_PITCH_MIN_RAD = Cesium.Math.toRadians(-89);
export const LOOK_PITCH_MAX_RAD = Cesium.Math.toRadians(-5);

/** PLAN 82 persistence key. Missing key means tilt is free. */
export const LOCK_TILT_STORAGE_KEY = 'meridian.lockTilt';

const MIN_LOOK_AT_RANGE_M = 1;
const MIN_EARTH_TARGET_M = Cesium.Ellipsoid.WGS84.minimumRadius * 0.95;

const EDITING_SELECTOR = 'input, textarea, select, option, [contenteditable], [contenteditable="true"], [role="textbox"], [role="slider"], [role="spinbutton"]';

/**
 * Overlay rows this feature owns. Pitch keys are R / PageUp / PageDown — not F.
 * @type {ReadonlyArray<{keys: string, action: string}>}
 */
export const LOOK_SHORTCUT_OVERLAY_ENTRIES = Object.freeze([
  Object.freeze({ keys: 'Q / E', label: 'Yaw heading left / right' }),
  Object.freeze({ keys: 'R / Page Up', label: 'Pitch up (tilt toward horizon)' }),
  Object.freeze({ keys: 'Page Down', label: 'Pitch down (tilt toward ground)' }),
]);

/**
 * Whether a keydown target is text entry or a focused control that owns
 * PageUp/PageDown (radio tuner, sliders).
 * @param {EventTarget|null|undefined} target
 * @returns {boolean}
 */
export function isLookKeyIgnoredTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (typeof target.matches === 'function' && target.matches(EDITING_SELECTOR)) return true;
  return Boolean(target.closest?.(EDITING_SELECTOR));
}

/**
 * Lock-tilt gate used by pitch keys. PLAN 82 can flip any of: an explicit
 * flag, Cesium `enableTilt`, or `meridian.lockTilt`.
 * @param {{tiltLocked?: boolean, enableTilt?: boolean, storage?: {getItem?: Function}} } [options]
 * @returns {boolean}
 */
export function isTiltLocked(options = {}) {
  if (options.tiltLocked === true) return true;
  if (options.enableTilt === false) return true;
  try {
    const stored = options.storage?.getItem?.(LOCK_TILT_STORAGE_KEY);
    if (stored === '1' || stored === 'true') return true;
  } catch {
    // Unreadable storage fails open (pitch keys still work).
  }
  return false;
}

/**
 * Read tilt lock from a Cesium-like viewer plus optional storage.
 * @param {object|null} viewer
 * @param {{storage?: {getItem?: Function}, tiltLocked?: boolean}} [options]
 * @returns {boolean}
 */
export function isViewerTiltLocked(viewer, options = {}) {
  return isTiltLocked({
    tiltLocked: options.tiltLocked,
    enableTilt: viewer?.scene?.screenSpaceCameraController?.enableTilt,
    storage: options.storage,
  });
}

/**
 * Resolve a look action from a keyboard event. Returns null when this module
 * does not own the key (WASD, F, C, H, … stay with their existing handlers).
 * @param {KeyboardEvent|object} event
 * @param {{tiltLocked?: boolean, enableTilt?: boolean, storage?: {getItem?: Function}}} [options]
 * @returns {{kind: 'heading'|'pitch'|'blocked', direction?: 'left'|'right'|'up'|'down', deltaRad?: number}|null}
 */
export function resolveLookAction(event, options = {}) {
  if (!event || event.defaultPrevented) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isLookKeyIgnoredTarget(event.target)) return null;

  const key = String(event.key || '');
  const lower = key.toLowerCase();

  if (lower === 'q') {
    return { kind: 'heading', direction: 'left', deltaRad: -LOOK_STEP_RAD };
  }
  if (lower === 'e') {
    return { kind: 'heading', direction: 'right', deltaRad: LOOK_STEP_RAD };
  }

  const pitchUp = lower === 'r' || key === 'PageUp';
  const pitchDown = key === 'PageDown';
  if (!pitchUp && !pitchDown) return null;

  if (isTiltLocked(options)) {
    return { kind: 'blocked', direction: pitchUp ? 'up' : 'down' };
  }
  return {
    kind: 'pitch',
    direction: pitchUp ? 'up' : 'down',
    deltaRad: pitchUp ? LOOK_STEP_RAD : -LOOK_STEP_RAD,
  };
}

/**
 * Clamp pitch to the map look band (never through the ground, never at the sky).
 * @param {number} pitchRad
 * @returns {number}
 */
export function clampLookPitch(pitchRad) {
  if (!Number.isFinite(pitchRad)) return LOOK_PITCH_MAX_RAD;
  return Math.min(LOOK_PITCH_MAX_RAD, Math.max(LOOK_PITCH_MIN_RAD, pitchRad));
}

/**
 * Apply a resolved look action. Look-at keeps the ground target and range;
 * in-place keeps lat/lon/height when there is no target.
 * @param {object} camera
 * @param {{kind: string, deltaRad?: number}} action
 * @param {object|null} [target]
 * @returns {{mode: 'lookAt'|'inPlace', heading: number, pitch: number, range?: number}|null}
 */
export function applyCameraLook(camera, action, target = null) {
  if (!camera || !action || action.kind === 'blocked') return null;
  if (action.kind !== 'heading' && action.kind !== 'pitch') return null;

  const headingDelta = action.kind === 'heading' ? Number(action.deltaRad) || 0 : 0;
  const pitchDelta = action.kind === 'pitch' ? Number(action.deltaRad) || 0 : 0;
  const nextHeading = (Number.isFinite(camera.heading) ? camera.heading : 0) + headingDelta;
  const nextPitch = clampLookPitch(
    (Number.isFinite(camera.pitch) ? camera.pitch : LOOK_PITCH_MAX_RAD) + pitchDelta,
  );
  const roll = Number.isFinite(camera.roll) ? camera.roll : 0;

  const eye = camera.positionWC || camera.position;
  if (target && eye && typeof camera.lookAt === 'function') {
    const range = Cesium.Cartesian3.distance(eye, target);
    if (Number.isFinite(range) && range > MIN_LOOK_AT_RANGE_M) {
      camera.lookAt(target, new Cesium.HeadingPitchRange(nextHeading, nextPitch, range));
      camera.lookAtTransform?.(Cesium.Matrix4.IDENTITY);
      return { mode: 'lookAt', heading: nextHeading, pitch: nextPitch, range };
    }
  }

  if (typeof camera.setView === 'function') {
    camera.setView({ orientation: { heading: nextHeading, pitch: nextPitch, roll } });
  } else {
    camera.heading = nextHeading;
    camera.pitch = nextPitch;
  }
  return { mode: 'inPlace', heading: nextHeading, pitch: nextPitch };
}

/**
 * Ground point under the viewport center, or null when the view has no Earth target.
 * @param {object} viewer
 * @returns {object|null}
 */
export function resolveLookTarget(viewer) {
  const camera = viewer?.camera;
  const canvas = viewer?.scene?.canvas;
  if (!camera || !canvas || typeof camera.pickEllipsoid !== 'function') return null;
  const width = canvas.clientWidth || canvas.width || 0;
  const height = canvas.clientHeight || canvas.height || 0;
  if (!(width > 0) || !(height > 0)) return null;
  try {
    const ellipsoid = viewer.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    const position = camera.pickEllipsoid(
      new Cesium.Cartesian2(width / 2, height / 2),
      ellipsoid,
    );
    if (!position) return null;
    const magnitude = Cesium.Cartesian3.magnitude(position);
    if (!Number.isFinite(magnitude) || magnitude < MIN_EARTH_TARGET_M) return null;
    return position;
  } catch {
    return null;
  }
}

/**
 * Handle a keydown for look. Returns the applied result, `{ kind: 'blocked' }`
 * when lock-tilt ate a pitch key, or null when the event is not ours.
 * @param {KeyboardEvent|object} event
 * @param {object} viewer
 * @param {{tiltLocked?: boolean, storage?: {getItem?: Function}, cockpitActive?: boolean}} [options]
 * @returns {object|null}
 */
export function handleLookKeyDown(event, viewer, options = {}) {
  if (options.cockpitActive) return null;
  if (viewer?.trackedEntity) return null;

  const action = resolveLookAction(event, {
    tiltLocked: options.tiltLocked,
    enableTilt: viewer?.scene?.screenSpaceCameraController?.enableTilt,
    storage: options.storage,
  });
  if (!action) return null;
  if (action.kind === 'blocked') return action;

  const target = resolveLookTarget(viewer);
  const applied = applyCameraLook(viewer?.camera, action, target);
  if (!applied) return action;
  return { ...action, ...applied };
}
