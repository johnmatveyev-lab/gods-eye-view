/**
 * Google Places Nearby Search for HUD / scene labels.
 *
 * Shared by the Vite / live-API `/api/google/nearby-places` plugin and the
 * Vercel `api/google/nearby-places.js` wrapper so hosted and local stay on
 * one contract. The Google key stays server-side and is stripped from JSON.
 *
 * Place / premises labels only — no person-search, phone-match, or
 * face/identity fields.
 */

const PLACES_SEARCH_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
const RATE_LIMITER_MAX_KEYS = 2000;
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
].join(',');

/** @type {((key: string) => boolean) | null | undefined} */
let defaultGoogleRateLimiter;

/**
 * Opt-in per-IP limiter from `GEV_RATELIMIT_GOOGLE_PER_MIN`.
 * Unset / 0 / garbage → unlimited (null). Built lazily so `.env` loaded
 * after import is still seen; cached so the window persists.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {((key: string) => boolean) | null}
 */
export function googlePlacesRateLimiter(env = process.env) {
  if (defaultGoogleRateLimiter === undefined) {
    defaultGoogleRateLimiter = makeOptInRateLimiter(env.GEV_RATELIMIT_GOOGLE_PER_MIN);
  }
  return defaultGoogleRateLimiter;
}

/** Test hook — do not use in production. */
export function resetGooglePlacesRateLimiter() {
  defaultGoogleRateLimiter = undefined;
}

/**
 * @param {string|undefined} envValue
 * @returns {((key: string) => boolean) | null}
 */
export function makeOptInRateLimiter(envValue) {
  const max = Number(envValue);
  if (!Number.isFinite(max) || max <= 0) return null;
  return makeRateLimiter({ windowMs: 60_000, max: Math.floor(max), globalMax: Math.floor(max) * 20 });
}

function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map();
  let globalTimes = [];
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false;
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}

export function nearbyPlacesClientKey(req) {
  return String(req?.socket?.remoteAddress || 'local');
}

export function placeContextPriority(types) {
  const typeSet = new Set(types);
  if (typeSet.has('historical_landmark') || typeSet.has('monument')) return 100;
  if (typeSet.has('tourist_attraction') || typeSet.has('museum')) return 90;
  if (typeSet.has('premise') || typeSet.has('street_address')) return 75;
  if (typeSet.has('point_of_interest')) return 60;
  if (typeSet.has('public_bathroom')) return 10;
  return 40;
}

export function approximateDistanceM(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER;
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((latA * Math.PI) / 180);
  return Math.round(Math.hypot(
    (latB - latA) * latitudeScale,
    (lonB - lonA) * longitudeScale,
  ));
}

/**
 * @param {string | undefined} url
 * @returns {{ latitude: number, longitude: number, radiusM: number, valid: boolean }}
 */
export function parseNearbyPlacesQuery(url) {
  const requestUrl = parseRequestUrl(url);
  const latRaw = requestUrl.searchParams.get('lat');
  const lonRaw = requestUrl.searchParams.get('lon');
  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);
  const radiusM = Math.max(25, Math.min(5000, Number(requestUrl.searchParams.get('radiusM')) || 250));
  return {
    latitude,
    longitude,
    radiusM,
    valid: presentCoordinate(latRaw) && presentCoordinate(lonRaw)
      && Number.isFinite(latitude) && Number.isFinite(longitude),
  };
}

function presentCoordinate(value) {
  return value != null && String(value).trim() !== '';
}

/**
 * Map a Places Nearby Search payload to the HUD `places: []` contract.
 * Drops unnamed / duplicate rows and never copies the API key.
 *
 * @param {unknown} data
 * @param {number} latitude
 * @param {number} longitude
 */
export function mapNearbyPlaces(data, latitude, longitude) {
  const seenPlaces = new Set();
  const rows = Array.isArray(data?.places) ? data.places : [];
  return rows
    .map((place) => {
      const placeLatitude = place.location?.latitude ?? null;
      const placeLongitude = place.location?.longitude ?? null;
      const types = Array.isArray(place.types) ? place.types.slice(0, 8) : [];
      return {
        id: place.id || null,
        name: place.displayName?.text || null,
        address: place.shortFormattedAddress || place.formattedAddress || null,
        latitude: placeLatitude,
        longitude: placeLongitude,
        distanceM: approximateDistanceM(latitude, longitude, placeLatitude, placeLongitude),
        primaryType: place.primaryTypeDisplayName?.text || place.primaryType || null,
        types,
        contextPriority: placeContextPriority(types),
      };
    })
    .filter((place) => {
      const key = `${place.name}:${place.address || ''}`.toLowerCase();
      if (!place.name || seenPlaces.has(key)) return false;
      seenPlaces.add(key);
      return true;
    })
    .sort((a, b) => b.contextPriority - a.contextPriority || a.distanceM - b.distanceM)
    .map(({ contextPriority, ...place }) => place)
    .slice(0, 20);
}

/**
 * Shared GET handler. Vite middleware and the Vercel wrapper both call this.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   rateLimiter?: ((key: string) => boolean) | null,
 *   clientKey?: (req: import('http').IncomingMessage) => string,
 * }} [options]
 */
export async function handleNearbyPlacesHttp(req, res, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = env.GOOGLE_MAPS_API_KEY || '';

  if (req.method !== 'GET') {
    writePlacesJson(res, 405, { error: 'Method not allowed', places: [] }, apiKey);
    return;
  }

  const limiter = options.rateLimiter !== undefined
    ? options.rateLimiter
    : googlePlacesRateLimiter(env);
  const keyFn = options.clientKey || nearbyPlacesClientKey;
  if (limiter && !limiter(keyFn(req))) {
    res.setHeader('Retry-After', '5');
    writePlacesJson(res, 429, { error: 'Rate limit exceeded', places: [] }, apiKey);
    return;
  }

  if (!apiKey) {
    writePlacesJson(res, 503, { error: 'GOOGLE_MAPS_API_KEY is not set', places: [] }, apiKey);
    return;
  }

  const query = parseNearbyPlacesQuery(req.url);
  if (!query.valid) {
    writePlacesJson(res, 400, { error: 'Valid lat and lon are required', places: [] }, apiKey);
    return;
  }

  const { latitude, longitude, radiusM } = query;

  try {
    const response = await fetchImpl(PLACES_SEARCH_NEARBY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radiusM,
          },
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    const places = mapNearbyPlaces(data, latitude, longitude);
    res.setHeader('Cache-Control', 'private, max-age=300');
    writePlacesJson(res, response.ok ? 200 : response.status, {
      places,
      error: response.ok ? null : data.error?.message || 'Google Places request failed',
    }, apiKey, { charset: true });
  } catch (error) {
    writePlacesJson(res, 502, {
      error: error?.message || 'Google Places request failed',
      places: [],
    }, apiKey, { charset: true });
  }
}

/** Vercel Node entry used by api/google/nearby-places.js */
export default async function nearbyPlacesHandler(req, res) {
  await handleNearbyPlacesHttp(req, res);
}

function parseRequestUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/**
 * Write the `{ places, error }` contract. The API key is stripped from the
 * serialized body even if an upstream message echoed it.
 */
function writePlacesJson(res, status, body, apiKey, { charset = false } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', charset ? 'application/json; charset=utf-8' : 'application/json');
  res.end(serializePlacesBody(body, apiKey));
}

export function serializePlacesBody(body, apiKey) {
  let payload = JSON.stringify(body);
  if (apiKey) payload = payload.split(apiKey).join('[redacted]');
  return payload;
}
