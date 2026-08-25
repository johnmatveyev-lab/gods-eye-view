import * as Cesium from 'cesium';

/**
 * Settled first-load camera — the cinematic flyToAustin destination.
 * Home returns here. Distinct from CAMERA_PRESETS.austin and from GLOBE_VIEW.
 */
export const HOME_VIEW = Object.freeze({
  lon: -97.7431,
  lat: 30.2672,
  alt: 600,
  heading: 15,
  pitch: -30,
});

/** Immediate setView flash before the cinematic settle. Not the Home pose. */
export const HOME_VIEW_FIRST_PAINT = Object.freeze({
  lon: -97.7431,
  lat: 30.2672,
  alt: 25000,
  heading: 0,
  pitch: -90,
});

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Set camera to Austin on load with a cinematic fly-in.
 */
export function flyToAustin(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      HOME_VIEW_FIRST_PAINT.lon,
      HOME_VIEW_FIRST_PAINT.lat,
      HOME_VIEW_FIRST_PAINT.alt,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(HOME_VIEW_FIRST_PAINT.heading),
      pitch: Cesium.Math.toRadians(HOME_VIEW_FIRST_PAINT.pitch),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        HOME_VIEW.lon,
        HOME_VIEW.lat,
        HOME_VIEW.alt,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(HOME_VIEW.heading),
        pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}

/**
 * Fly to the settled first-load camera. Does not touch lastView storage;
 * the existing moveEnd persist overwrites the slot after the flight.
 */
export function flyToHomeView(viewer, options = {}) {
  if (!viewer?.camera) return null;
  viewer.camera.cancelFlight?.();
  const duration = Number.isFinite(options.duration) ? options.duration : 2.4;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      HOME_VIEW.lon,
      HOME_VIEW.lat,
      HOME_VIEW.alt,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(HOME_VIEW.heading),
      pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
      roll: 0.0,
    },
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: options.onComplete,
    cancel: options.onCancel,
  });
  return { ...HOME_VIEW };
}
