/**
 * Lock tilt / keep horizon — user rotate changes heading only.
 *
 * Persist `meridian.lockTilt` as `1` / `0`. Default off keeps today's free
 * tumble. Home and cockpit still set their own pitch. Wheel zoom is unchanged
 * (invert scroll stays wheel-only). No `/api`.
 */

export const LOCK_TILT_STORAGE_KEY = 'meridian.lockTilt';
/** Hosted default is the current free camera, not a locked horizon. */
export const LOCK_TILT_DEFAULT = false;

/** Cesium CameraEventType numeric values (stable across 1.124). */
export const CAMERA_EVENT = Object.freeze({
  LEFT_DRAG: 0,
  RIGHT_DRAG: 1,
  MIDDLE_DRAG: 2,
  WHEEL: 3,
  PINCH: 4,
});

/** Cesium KeyboardEventModifier numeric values. */
export const KEYBOARD_MODIFIER = Object.freeze({
  SHIFT: 0,
  CTRL: 1,
  ALT: 2,
});

/** Parse a stored lock-tilt flag. Missing or garbage values keep free tilt. */
export function lockTiltEnabledFromStoredValue(value) {
  return value === '1' || value === 'true';
}

/** Read `meridian.lockTilt` from storage. Unreadable storage fails open to off. */
export function readLockTiltPreference(storage) {
  try {
    return lockTiltEnabledFromStoredValue(storage?.getItem?.(LOCK_TILT_STORAGE_KEY));
  } catch {
    return LOCK_TILT_DEFAULT;
  }
}

/** Persist `meridian.lockTilt` as `'1'` / `'0'`. */
export function writeLockTiltPreference(storage, enabled) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(LOCK_TILT_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

function cloneEventType(value) {
  if (Array.isArray(value)) return value.map((item) => cloneEventType(item));
  if (value && typeof value === 'object') {
    return { eventType: value.eventType, modifier: value.modifier };
  }
  return value;
}

function asEventList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.map((item) => cloneEventType(item)) : [cloneEventType(value)];
}

function isWheelEvent(value) {
  if (value === CAMERA_EVENT.WHEEL) return true;
  return value?.eventType === CAMERA_EVENT.WHEEL;
}

function isRightDragEvent(value) {
  if (value === CAMERA_EVENT.RIGHT_DRAG) return true;
  return value?.eventType === CAMERA_EVENT.RIGHT_DRAG && value?.modifier == null;
}

/**
 * Snapshot the live Cesium controller so unlock can restore free tumble.
 * @param {object|null|undefined} controller
 */
export function captureControllerEvents(controller) {
  if (!controller) return null;
  return {
    enableTilt: controller.enableTilt,
    enableRotate: controller.enableRotate,
    enableZoom: controller.enableZoom,
    enableLook: controller.enableLook,
    tiltEventTypes: cloneEventType(controller.tiltEventTypes),
    rotateEventTypes: cloneEventType(controller.rotateEventTypes),
    zoomEventTypes: cloneEventType(controller.zoomEventTypes),
    lookEventTypes: cloneEventType(controller.lookEventTypes),
  };
}

/**
 * Apply lock-tilt to a Cesium ScreenSpaceCameraController.
 * Locked: tilt off; tumble pointers rotate heading only; wheel stays zoom.
 * Unlocked: restore the captured free-tilt bindings.
 *
 * @param {object|null|undefined} controller
 * @param {boolean} locked
 * @param {{snapshot?: object|null}} [options]
 */
export function applyLockTiltToController(controller, locked, options = {}) {
  if (!controller) return null;
  const snapshot = options.snapshot || captureControllerEvents(controller);
  if (locked) {
    const rotate = asEventList(snapshot.rotateEventTypes);
    const tilt = asEventList(snapshot.tiltEventTypes).filter((item) => !isWheelEvent(item));
    const look = asEventList(snapshot.lookEventTypes).filter((item) => !isWheelEvent(item));
    controller.enableTilt = false;
    controller.enableRotate = true;
    controller.enableZoom = snapshot.enableZoom !== false;
    controller.tiltEventTypes = [];
    controller.rotateEventTypes = [
      ...rotate,
      ...tilt,
      CAMERA_EVENT.RIGHT_DRAG,
      CAMERA_EVENT.MIDDLE_DRAG,
    ];
    if (look.length) {
      controller.lookEventTypes = [];
      controller.rotateEventTypes.push(...look);
    }
    const zoom = asEventList(snapshot.zoomEventTypes).filter((item) => !isRightDragEvent(item));
    if (!zoom.includes(CAMERA_EVENT.WHEEL)) zoom.push(CAMERA_EVENT.WHEEL);
    if (!zoom.includes(CAMERA_EVENT.PINCH)) zoom.push(CAMERA_EVENT.PINCH);
    controller.zoomEventTypes = zoom;
  } else {
    controller.enableTilt = snapshot.enableTilt !== false;
    controller.enableRotate = snapshot.enableRotate !== false;
    controller.enableZoom = snapshot.enableZoom !== false;
    if (snapshot.enableLook !== undefined) controller.enableLook = snapshot.enableLook;
    controller.tiltEventTypes = cloneEventType(snapshot.tiltEventTypes);
    controller.rotateEventTypes = cloneEventType(snapshot.rotateEventTypes);
    controller.zoomEventTypes = cloneEventType(snapshot.zoomEventTypes);
    if (snapshot.lookEventTypes !== undefined) {
      controller.lookEventTypes = cloneEventType(snapshot.lookEventTypes);
    }
  }
  return {
    locked: !!locked,
    enableTilt: controller.enableTilt,
    enableRotate: controller.enableRotate,
  };
}

/**
 * User rotate / tumble. Heading always applies; pitch only when unlocked.
 * @param {object|null|undefined} camera
 * @param {{headingDelta?: number, pitchDelta?: number, lockTilt?: boolean}} [delta]
 */
export function applyUserRotateDelta(camera, {
  headingDelta = 0,
  pitchDelta = 0,
  lockTilt = false,
} = {}) {
  if (!camera) return null;
  const heading = (Number(camera.heading) || 0) + headingDelta;
  const pitch = lockTilt ? camera.pitch : (Number(camera.pitch) || 0) + pitchDelta;
  const roll = lockTilt ? 0 : (camera.roll ?? 0);
  camera.setView?.({ orientation: { heading, pitch, roll } });
  camera.heading = heading;
  camera.pitch = pitch;
  camera.roll = roll;
  return { heading, pitch, roll };
}

/**
 * Heading-only north-up (compass contract). Keeps the current pitch.
 * @param {object|null|undefined} camera
 * @param {number} [heading]
 */
export function applyHeadingOnly(camera, heading = 0) {
  if (!camera) return null;
  const pitch = camera.pitch;
  const roll = 0;
  camera.setView?.({ orientation: { heading, pitch, roll } });
  camera.heading = heading;
  camera.pitch = pitch;
  camera.roll = roll;
  return { heading, pitch, roll };
}

/**
 * Hold pitch/roll during a user drag when lock is on.
 * Home / cockpit setView paths should not call this.
 * @param {object|null|undefined} camera
 * @param {number} lockedPitch
 */
export function holdLockedPitch(camera, lockedPitch) {
  if (!camera || !Number.isFinite(lockedPitch)) return camera?.pitch;
  if (camera.pitch === lockedPitch && (camera.roll ?? 0) === 0) return lockedPitch;
  camera.setView?.({
    orientation: { heading: camera.heading, pitch: lockedPitch, roll: 0 },
  });
  camera.pitch = lockedPitch;
  camera.roll = 0;
  return lockedPitch;
}

/**
 * Bind canvas pointer-drag pitch hold. Programmatic Home/cockpit moves are
 * skipped because they are not pointer-driven.
 * @param {object|null|undefined} viewer
 * @param {{getLocked?: Function}} [options]
 * @returns {() => void}
 */
export function bindLockTiltUserRotate(viewer, { getLocked } = {}) {
  const canvas = viewer?.scene?.canvas || viewer?.canvas;
  const camera = viewer?.camera;
  if (!canvas?.addEventListener || !camera) return () => {};

  let pointerDown = false;
  let lockedPitch = camera.pitch;
  const onDown = () => {
    pointerDown = true;
    lockedPitch = camera.pitch;
  };
  const onUp = () => {
    pointerDown = false;
  };
  const onChanged = () => {
    if (!pointerDown || !getLocked?.()) return;
    holdLockedPitch(camera, lockedPitch);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const removeChanged = camera.changed?.addEventListener?.(onChanged) || null;

  return () => {
    canvas.removeEventListener?.('pointerdown', onDown);
    canvas.removeEventListener?.('pointerup', onUp);
    canvas.removeEventListener?.('pointercancel', onUp);
    removeChanged?.();
  };
}
