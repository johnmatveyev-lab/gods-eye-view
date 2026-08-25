/**
 * North-up compass — heading 0 without the Home / Reset Globe pose.
 *
 * Look-at mode keeps the current ground target, range, and tilt.
 * In-place mode keeps camera lat/lon/height/pitch when no target exists.
 */
import * as Cesium from 'cesium';

const MIN_LOOK_AT_RANGE_M = 1;
const MIN_EARTH_TARGET_M = Cesium.Ellipsoid.WGS84.minimumRadius * 0.95;

/**
 * CSS rotation for the compass needle so N tracks geographic north.
 * Heading 0 → 0deg (N up). Heading 90° (east) → −90deg (N points left).
 * @param {number} headingRad Camera heading in radians.
 * @returns {number} Degrees to rotate the needle.
 */
export function compassNeedleDeg(headingRad) {
  if (!Number.isFinite(headingRad)) return 0;
  const deg = -Cesium.Math.toDegrees(Cesium.Math.zeroToTwoPi(headingRad));
  return Object.is(deg, -0) ? 0 : deg;
}

/**
 * Plan a north-up pose. Does not mutate the camera.
 * @param {object} camera Cesium-like camera with pitch and a world position.
 * @param {Cesium.Cartesian3|null} [target] Screen-center ground target.
 * @returns {{heading: number, pitch: number, range: number|null, mode: 'lookAt'|'inPlace'}}
 */
export function northUpHeadingPitchRange(camera, target) {
  const pitch = Number.isFinite(camera?.pitch) ? camera.pitch : 0;
  const eye = camera?.positionWC || camera?.position;
  if (!target || !eye) {
    return { heading: 0, pitch, range: null, mode: 'inPlace' };
  }
  const range = Cesium.Cartesian3.distance(eye, target);
  if (!Number.isFinite(range) || range <= MIN_LOOK_AT_RANGE_M) {
    return { heading: 0, pitch, range: null, mode: 'inPlace' };
  }
  return { heading: 0, pitch, range, mode: 'lookAt' };
}

/**
 * Set heading 0. Look-at keeps target/range/tilt; in-place keeps lat/lon/height/pitch.
 * @param {object} camera Cesium camera.
 * @param {Cesium.Cartesian3|null} [target]
 * @returns {object|null} Applied plan, or null when the camera is missing.
 */
export function applyNorthUp(camera, target = null) {
  if (!camera) return null;
  const plan = northUpHeadingPitchRange(camera, target);
  if (plan.mode === 'lookAt' && typeof camera.lookAt === 'function') {
    camera.lookAt(target, new Cesium.HeadingPitchRange(plan.heading, plan.pitch, plan.range));
    camera.lookAtTransform?.(Cesium.Matrix4.IDENTITY);
    return { ...plan, target };
  }
  camera.setView?.({
    orientation: { heading: 0, pitch: plan.pitch, roll: 0 },
  });
  return plan;
}

/**
 * Ground point under the viewport center, or null when the view has no Earth target.
 * @param {object} viewer Cesium viewer.
 * @returns {Cesium.Cartesian3|null}
 */
export function resolveNorthUpTarget(viewer) {
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
