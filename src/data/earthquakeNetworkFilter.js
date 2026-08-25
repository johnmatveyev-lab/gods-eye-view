/**
 * Client-only earthquake contributing-network chips. Uses properties.net
 * already present on USGS all_day GeoJSON (us | ak | ci | nc | …).
 * Rare or unlabeled nets share Other so the chip row stays compact.
 * Does not change the product or fetch.
 */

export const EARTHQUAKE_NETWORKS = Object.freeze([
  'us',
  'ak',
  'ci',
  'nc',
  'other',
]);
export const EARTHQUAKE_NETWORK_CODES = Object.freeze({
  us: 'U',
  ak: 'A',
  ci: 'C',
  nc: 'N',
  other: 'O',
});
export const EARTHQUAKE_NETWORK_LABELS = Object.freeze({
  us: 'US',
  ak: 'AK',
  ci: 'CI',
  nc: 'NC',
  other: 'Other',
});
export const EARTHQUAKE_NETWORK_TITLES = Object.freeze({
  us: 'Show earthquakes from the US contributing network',
  ak: 'Show earthquakes from the AK contributing network',
  ci: 'Show earthquakes from the CI contributing network',
  nc: 'Show earthquakes from the NC contributing network',
  other: 'Show earthquakes from other or unlabeled contributing networks',
});
/** Canonical token when every network chip is on — current unfiltered network view. */
export const DEFAULT_EARTHQUAKE_NETWORKS = 'UACNO';

const CODE_TO_NETWORK = Object.freeze(
  Object.fromEntries(
    Object.entries(EARTHQUAKE_NETWORK_CODES).map(([network, code]) => [code, network]),
  ),
);

/**
 * Map USGS `properties.net` onto a chip. Missing/unknown/empty is Other.
 * Only the compact allowlist (us, ak, ci, nc) gets its own chip.
 * @param {unknown} value
 * @returns {'us'|'ak'|'ci'|'nc'|'other'}
 */
export function earthquakeNetwork(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (token === 'us' || token === 'ak' || token === 'ci' || token === 'nc') return token;
  return 'other';
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeEarthquakeNetworks(value) {
  if (value == null || value === '' || value === true || value === 'all') {
    return DEFAULT_EARTHQUAKE_NETWORKS;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_EARTHQUAKE_NETWORKS;
    if (trimmed === '0') return '0';
    if (trimmed === DEFAULT_EARTHQUAKE_NETWORKS || trimmed === 'ALL') {
      return DEFAULT_EARTHQUAKE_NETWORKS;
    }
    const seen = new Set();
    for (const character of trimmed) {
      const network = CODE_TO_NETWORK[character];
      if (!network) return null;
      seen.add(network);
    }
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_NETWORKS
      .filter((network) => seen.has(network))
      .map((network) => EARTHQUAKE_NETWORK_CODES[network])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_NETWORKS ? DEFAULT_EARTHQUAKE_NETWORKS : codes;
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      const network = String(raw || '').trim().toLowerCase();
      if (!EARTHQUAKE_NETWORKS.includes(/** @type {'us'|'ak'|'ci'|'nc'|'other'} */ (network))) {
        return null;
      }
      seen.add(network);
    }
    if (!seen.size) return '0';
    return normalizeEarthquakeNetworks(
      Object.fromEntries(EARTHQUAKE_NETWORKS.map((network) => [network, seen.has(network)])),
    );
  }
  if (typeof value === 'object') {
    const seen = new Set();
    let sawKnown = false;
    for (const network of EARTHQUAKE_NETWORKS) {
      if (!Object.hasOwn(value, network)) continue;
      sawKnown = true;
      if (value[network] === true) seen.add(network);
    }
    if (!sawKnown) return null;
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_NETWORKS
      .filter((network) => seen.has(network))
      .map((network) => EARTHQUAKE_NETWORK_CODES[network])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_NETWORKS ? DEFAULT_EARTHQUAKE_NETWORKS : codes;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Record<'us'|'ak'|'ci'|'nc'|'other', boolean>}
 */
export function earthquakeNetworkFlags(value) {
  const token = normalizeEarthquakeNetworks(value) ?? DEFAULT_EARTHQUAKE_NETWORKS;
  if (token === '0') {
    return Object.fromEntries(EARTHQUAKE_NETWORKS.map((network) => [network, false]));
  }
  return Object.fromEntries(
    EARTHQUAKE_NETWORKS.map((network) => [network, token.includes(EARTHQUAKE_NETWORK_CODES[network])]),
  );
}

/**
 * Flip one network chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} network
 * @returns {string}
 */
export function toggleEarthquakeNetwork(current, network) {
  const id = String(network || '').trim().toLowerCase();
  if (!EARTHQUAKE_NETWORKS.includes(/** @type {'us'|'ak'|'ci'|'nc'|'other'} */ (id))) {
    return normalizeEarthquakeNetworks(current) ?? DEFAULT_EARTHQUAKE_NETWORKS;
  }
  const token = normalizeEarthquakeNetworks(current) ?? DEFAULT_EARTHQUAKE_NETWORKS;
  const enabled = new Set(
    token === '0'
      ? []
      : [...token].map((code) => CODE_TO_NETWORK[code]).filter(Boolean),
  );
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  return normalizeEarthquakeNetworks(
    Object.fromEntries(EARTHQUAKE_NETWORKS.map((name) => [name, enabled.has(name)])),
  ) ?? DEFAULT_EARTHQUAKE_NETWORKS;
}

/**
 * Keep events whose network chip is on. Missing/unknown net is Other.
 * A selected event stays visible even when its chip is off.
 * All-on returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [networks=DEFAULT_EARTHQUAKE_NETWORKS]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByNetwork(
  features,
  networks = DEFAULT_EARTHQUAKE_NETWORKS,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const token = normalizeEarthquakeNetworks(networks) ?? DEFAULT_EARTHQUAKE_NETWORKS;
  if (token === DEFAULT_EARTHQUAKE_NETWORKS) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (token === '0') {
    return keepId
      ? features.filter((feature) => String(feature?.id) === keepId)
      : [];
  }
  const enabled = new Set([...token].map((code) => CODE_TO_NETWORK[code]));
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return enabled.has(earthquakeNetwork(feature?.properties?.net));
  });
}
