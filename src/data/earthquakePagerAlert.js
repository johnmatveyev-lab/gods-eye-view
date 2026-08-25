/**
 * Client-only earthquake PAGER-alert chips. Uses properties.alert
 * already present on USGS all_day GeoJSON (green | yellow | orange | red | null).
 * Does not change the product or fetch.
 */

export const EARTHQUAKE_PAGER_ALERTS = Object.freeze([
  'green',
  'yellow',
  'orange',
  'red',
  'none',
]);
export const EARTHQUAKE_PAGER_ALERT_CODES = Object.freeze({
  green: 'G',
  yellow: 'Y',
  orange: 'O',
  red: 'R',
  none: 'N',
});
export const EARTHQUAKE_PAGER_ALERT_LABELS = Object.freeze({
  green: 'Green',
  yellow: 'Yellow',
  orange: 'Orange',
  red: 'Red',
  none: 'None',
});
export const EARTHQUAKE_PAGER_ALERT_TITLES = Object.freeze({
  green: 'Show earthquakes with a green PAGER alert',
  yellow: 'Show earthquakes with a yellow PAGER alert',
  orange: 'Show earthquakes with an orange PAGER alert',
  red: 'Show earthquakes with a red PAGER alert',
  none: 'Show earthquakes with no PAGER alert',
});
/** Canonical token when every PAGER chip is on — current unfiltered alert view. */
export const DEFAULT_EARTHQUAKE_PAGER_ALERTS = 'GYORN';

const CODE_TO_ALERT = Object.freeze(
  Object.fromEntries(
    Object.entries(EARTHQUAKE_PAGER_ALERT_CODES).map(([alert, code]) => [code, alert]),
  ),
);

/**
 * Map USGS `properties.alert` onto a chip. Missing/null/unknown is None.
 * @param {unknown} value
 * @returns {'green'|'yellow'|'orange'|'red'|'none'}
 */
export function earthquakePagerAlert(value) {
  if (value == null || value === '') return 'none';
  const token = String(value).trim().toLowerCase();
  if (EARTHQUAKE_PAGER_ALERTS.includes(/** @type {'green'|'yellow'|'orange'|'red'|'none'} */ (token))
    && token !== 'none') {
    return token;
  }
  return 'none';
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeEarthquakePagerAlerts(value) {
  if (value == null || value === '' || value === true || value === 'all') {
    return DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_EARTHQUAKE_PAGER_ALERTS;
    if (trimmed === '0') return '0';
    if (trimmed === DEFAULT_EARTHQUAKE_PAGER_ALERTS || trimmed === 'ALL') {
      return DEFAULT_EARTHQUAKE_PAGER_ALERTS;
    }
    const seen = new Set();
    for (const character of trimmed) {
      const alert = CODE_TO_ALERT[character];
      if (!alert) return null;
      seen.add(alert);
    }
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_PAGER_ALERTS
      .filter((alert) => seen.has(alert))
      .map((alert) => EARTHQUAKE_PAGER_ALERT_CODES[alert])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_PAGER_ALERTS ? DEFAULT_EARTHQUAKE_PAGER_ALERTS : codes;
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      const alert = String(raw || '').trim().toLowerCase();
      if (!EARTHQUAKE_PAGER_ALERTS.includes(/** @type {'green'|'yellow'|'orange'|'red'|'none'} */ (alert))) {
        return null;
      }
      seen.add(alert);
    }
    if (!seen.size) return '0';
    return normalizeEarthquakePagerAlerts(
      Object.fromEntries(EARTHQUAKE_PAGER_ALERTS.map((alert) => [alert, seen.has(alert)])),
    );
  }
  if (typeof value === 'object') {
    const seen = new Set();
    let sawKnown = false;
    for (const alert of EARTHQUAKE_PAGER_ALERTS) {
      if (!Object.hasOwn(value, alert)) continue;
      sawKnown = true;
      if (value[alert] === true) seen.add(alert);
    }
    if (!sawKnown) return null;
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_PAGER_ALERTS
      .filter((alert) => seen.has(alert))
      .map((alert) => EARTHQUAKE_PAGER_ALERT_CODES[alert])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_PAGER_ALERTS ? DEFAULT_EARTHQUAKE_PAGER_ALERTS : codes;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Record<'green'|'yellow'|'orange'|'red'|'none', boolean>}
 */
export function earthquakePagerAlertFlags(value) {
  const token = normalizeEarthquakePagerAlerts(value) ?? DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  if (token === '0') {
    return Object.fromEntries(EARTHQUAKE_PAGER_ALERTS.map((alert) => [alert, false]));
  }
  return Object.fromEntries(
    EARTHQUAKE_PAGER_ALERTS.map((alert) => [alert, token.includes(EARTHQUAKE_PAGER_ALERT_CODES[alert])]),
  );
}

/**
 * Flip one PAGER chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} alert
 * @returns {string}
 */
export function toggleEarthquakePagerAlert(current, alert) {
  const id = String(alert || '').trim().toLowerCase();
  if (!EARTHQUAKE_PAGER_ALERTS.includes(/** @type {'green'|'yellow'|'orange'|'red'|'none'} */ (id))) {
    return normalizeEarthquakePagerAlerts(current) ?? DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  }
  const token = normalizeEarthquakePagerAlerts(current) ?? DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  const enabled = new Set(
    token === '0'
      ? []
      : [...token].map((code) => CODE_TO_ALERT[code]).filter(Boolean),
  );
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  return normalizeEarthquakePagerAlerts(
    Object.fromEntries(EARTHQUAKE_PAGER_ALERTS.map((name) => [name, enabled.has(name)])),
  ) ?? DEFAULT_EARTHQUAKE_PAGER_ALERTS;
}

/**
 * Keep events whose PAGER chip is on. Missing/null alert is None.
 * A selected event stays visible even when its chip is off.
 * All-on returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [alerts=DEFAULT_EARTHQUAKE_PAGER_ALERTS]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByPagerAlert(
  features,
  alerts = DEFAULT_EARTHQUAKE_PAGER_ALERTS,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const token = normalizeEarthquakePagerAlerts(alerts) ?? DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  if (token === DEFAULT_EARTHQUAKE_PAGER_ALERTS) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (token === '0') {
    return keepId
      ? features.filter((feature) => String(feature?.id) === keepId)
      : [];
  }
  const enabled = new Set([...token].map((code) => CODE_TO_ALERT[code]));
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return enabled.has(earthquakePagerAlert(feature?.properties?.alert));
  });
}
