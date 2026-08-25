/**
 * Hosted sensor Look cycle.
 *
 * Existing styles only: CRT → NVG → FLIR → Noir → Snow → default.
 * IDs match StyleManager.setStyle / voice set_visual_style / the share URL
 * `style` key. Anime stays a Visual Presets entry, not a Look.
 */

export const SENSOR_LOOK_CYCLE = Object.freeze([
  'retro',
  'surveillance',
  'thermal',
  'noir',
  'snow',
  'normal',
]);

export const SENSOR_LOOK_LABELS = Object.freeze({
  retro: 'CRT',
  surveillance: 'NVG',
  thermal: 'FLIR',
  noir: 'NOIR',
  snow: 'SNOW',
  normal: 'NORMAL',
});

/** Next Look in the hosted cycle. Unknown styles, including Anime, start at CRT. */
export function nextSensorLook(current) {
  const index = SENSOR_LOOK_CYCLE.indexOf(current);
  if (index < 0) return SENSOR_LOOK_CYCLE[0];
  return SENSOR_LOOK_CYCLE[(index + 1) % SENSOR_LOOK_CYCLE.length];
}

export function sensorLookLabel(styleId) {
  return SENSOR_LOOK_LABELS[styleId] || String(styleId || 'normal').toUpperCase();
}

/** Apply a Look through the same setter the share URL and voice already use. */
export function applySensorLook(styleManager, styleId) {
  if (typeof styleManager?.setStyle === 'function') {
    styleManager.setStyle(styleId);
  }
  return styleId;
}

export function cycleSensorLook(styleManager) {
  return applySensorLook(styleManager, nextSensorLook(styleManager?.activeStyle));
}
