import { decodeShareViewUrl, encodeShareViewUrl } from './shareViewUrl.js';

export const LAST_VIEW_KEY = 'meridian.lastView';
export const LAST_VIEW_THROTTLE_MS = 400;

export function hasShareParams(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  return Number.isFinite(lat) && Number.isFinite(lon);
}

export function writeLastView(storage, url) {
  if (!storage) return false;
  const encoded = String(url || '').trim();
  if (!hasShareParams(decodeShareViewUrl(encoded))) return false;
  storage.setItem(LAST_VIEW_KEY, encoded);
  return true;
}

export function readLastView(storage) {
  if (!storage) return '';
  try {
    const raw = storage.getItem(LAST_VIEW_KEY);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

export function persistLastViewHash(storage, href, hash) {
  return writeLastView(storage, encodeShareViewUrl(href, hash));
}

export function resolveBootShareHash(urlHash, lastView) {
  const incoming = String(urlHash || '').replace(/^#/, '');
  if (hasShareParams(incoming)) return incoming;
  const storedHash = decodeShareViewUrl(lastView);
  if (hasShareParams(storedHash)) return storedHash;
  return '';
}
