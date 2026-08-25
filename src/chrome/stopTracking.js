/**
 * Camera/target chrome: Stop tracking.
 *
 * Visible only while a contact is camera-tracked. The click path calls the
 * existing untrack/clear-target action and leaves the camera pose where it is.
 * It does not fly Home. No /api.
 */

export const STOP_TRACKING_BUTTON_ID = 'stop-tracking';
export const STOP_TRACKING_LABEL = 'Stop tracking';

/**
 * Whether camera chrome should show Stop tracking.
 * @param {{trackedEntity?: unknown, trackedInfo?: unknown}} [state]
 * @returns {boolean}
 */
export function hasTrackedTarget(state = {}) {
  return Boolean(state.trackedEntity || state.trackedInfo);
}

/**
 * Read the live follow-camera target without moving anything.
 * @param {object} [sources]
 * @param {{trackedEntity?: unknown}|null} [sources.viewer]
 * @param {unknown} [sources.cockpitTrackedEntity]
 * @param {() => unknown} [sources.getFlightInfo]
 * @param {() => unknown} [sources.getMilitaryInfo]
 * @param {() => unknown} [sources.getSatelliteInfo]
 * @returns {{trackedEntity: unknown, trackedInfo: unknown}}
 */
export function readTrackingState({
  viewer,
  cockpitTrackedEntity,
  getFlightInfo,
  getMilitaryInfo,
  getSatelliteInfo,
} = {}) {
  return {
    trackedEntity: viewer?.trackedEntity || cockpitTrackedEntity || null,
    trackedInfo: getFlightInfo?.() || getMilitaryInfo?.() || getSatelliteInfo?.() || null,
  };
}

/**
 * Show Stop tracking only while a target is locked.
 * @param {Pick<HTMLElement, 'hidden' | 'setAttribute'>|null|undefined} el Button.
 * @param {{trackedEntity?: unknown, trackedInfo?: unknown}} [state]
 * @returns {boolean} True when the button is shown.
 */
export function syncStopTrackingButton(el, state = {}) {
  if (!el) return false;
  const visible = hasTrackedTarget(state);
  el.hidden = !visible;
  el.setAttribute?.('aria-hidden', visible ? 'false' : 'true');
  return visible;
}

/**
 * Snapshot the free-camera pose used to prove Stop tracking does not fly Home.
 * @param {{positionCartographic?: {latitude?: number, longitude?: number, height?: number}, heading?: number, pitch?: number, roll?: number}|null|undefined} camera
 * @returns {{latitude: unknown, longitude: unknown, height: unknown, heading: unknown, pitch: unknown, roll: unknown}|null}
 */
export function snapshotCameraPose(camera) {
  if (!camera) return null;
  const carto = camera.positionCartographic || {};
  return Object.freeze({
    latitude: carto.latitude,
    longitude: carto.longitude,
    height: carto.height,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
  });
}

/**
 * @param {ReturnType<typeof snapshotCameraPose>} a
 * @param {ReturnType<typeof snapshotCameraPose>} b
 * @returns {boolean}
 */
export function posesEqual(a, b) {
  if (!a || !b) return a === b;
  return a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.height === b.height
    && a.heading === b.heading
    && a.pitch === b.pitch
    && a.roll === b.roll;
}

/**
 * Release the follow camera in place. Never flies Home.
 * @param {object} [options]
 * @param {() => unknown} [options.releaseFollow] Existing untrack/clear-target.
 * @param {{positionCartographic?: object, heading?: number, pitch?: number, roll?: number}|null} [options.camera]
 * @returns {{released: unknown, poseUnchanged: boolean, before: object|null, after: object|null}}
 */
export function stopTrackingInPlace({ releaseFollow, camera } = {}) {
  const before = snapshotCameraPose(camera);
  const released = typeof releaseFollow === 'function' ? releaseFollow() : false;
  const after = snapshotCameraPose(camera);
  return {
    released,
    poseUnchanged: posesEqual(before, after),
    before,
    after,
  };
}
