/**
 * @module annotationPersist
 * @description Operator-local reload persistence for the live whiteboard.
 *
 * On `engine.onChange`, write a compact snapshot of persistent marks to
 * localStorage (`meridian.annotations`). On init, restore once through the
 * same latitude/longitude `annotate()` path as Import (Plan 115) — no
 * geocode, Places, Overpass, or `/api`. TTL / expiring marks are skipped.
 * Clear empties the key. Not an alert service.
 */

import { MAX_LIVE_ANNOTATIONS } from './annotationEngine.js';

export const ANNOTATION_PERSIST_KEY = 'meridian.annotations';
export const ANNOTATION_PERSIST_VERSION = 1;

const POINT_TYPES = new Set(['pin', 'highlight', 'label', 'area']);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Finite {lon,lat}, or null. Height is dropped — restore is 2D. */
function lonLat(point) {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  return { lon: point.lon, lat: point.lat };
}

function compactRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out = [];
  for (const pair of ring) {
    if (!Array.isArray(pair) || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
    out.push([pair[0], pair[1]]);
  }
  return out;
}

function compactPath(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const out = [];
  for (const point of path) {
    const pair = lonLat(point);
    if (!pair) return null;
    out.push(pair);
  }
  return out;
}

/** Persistent = kept until Clear/Undo, not a TTL fade. */
export function isPersistentAnnotation(anno) {
  if (!anno || typeof anno !== 'object') return false;
  if (anno.expiring) return false;
  if (anno.ttlMs != null) return false;
  return Boolean(anno.type);
}

/**
 * Compact one live mark for storage. Returns null when there is no geometry
 * the Import-style annotate path can place.
 */
export function compactPersistentAnnotation(anno) {
  if (!isPersistentAnnotation(anno)) return null;
  const type = anno.type;
  const mark = {
    id: anno.id ?? null,
    type,
    label: anno.label ?? null,
    color: anno.color ?? null,
  };
  const anchor = lonLat(anno.anchor);
  const to = lonLat(anno.to);
  const ring = compactRing(anno.ring);
  const path = compactPath(anno.path);
  if (anchor) mark.anchor = anchor;
  if (to) mark.to = to;
  if (ring) mark.ring = ring;
  if (path) mark.path = path;
  if (type === 'route') return (path || (anchor && to)) ? mark : null;
  if (type === 'arrow') return anchor && to ? mark : null;
  if (POINT_TYPES.has(type)) return anchor ? mark : null;
  return null;
}

/**
 * Compact persistent marks from `engine.list()`. Honors the live cap.
 * @param {Array<object>} annotations
 * @returns {{v:number, marks: object[]}}
 */
export function snapshotPersistentAnnotations(annotations) {
  const marks = (Array.isArray(annotations) ? annotations : [])
    .map(compactPersistentAnnotation)
    .filter(Boolean)
    .slice(0, MAX_LIVE_ANNOTATIONS);
  return { v: ANNOTATION_PERSIST_VERSION, marks };
}

/**
 * Convert one stored mark to an Import-style annotate() spec (lat/lon only).
 * @param {object} mark
 * @returns {object|null}
 */
export function persistedMarkToAnnotateSpec(mark) {
  if (!mark || typeof mark !== 'object') return null;
  const type = typeof mark.type === 'string' ? mark.type : null;
  if (!type) return null;
  const label = mark.label ?? null;
  const color = mark.color ?? null;
  const anchor = lonLat(mark.anchor);
  const to = lonLat(mark.to);
  const ring = compactRing(mark.ring);
  const path = compactPath(mark.path);

  if (type === 'route') {
    const points = path || (anchor && to ? [anchor, to] : null);
    if (!points) return null;
    return {
      type,
      label,
      color,
      points: points.map((p) => ({ latitude: p.lat, longitude: p.lon })),
    };
  }

  if (type === 'arrow') {
    if (!anchor || !to) return null;
    return {
      type,
      label,
      color,
      latitude: anchor.lat,
      longitude: anchor.lon,
      toLatitude: to.lat,
      toLongitude: to.lon,
    };
  }

  if (!anchor) return null;
  if (type === 'area' && ring) {
    return {
      type: 'area',
      label,
      color,
      latitude: anchor.lat,
      longitude: anchor.lon,
      ring,
      footprint: false,
    };
  }
  if (!POINT_TYPES.has(type)) return null;
  return {
    type,
    label,
    color,
    latitude: anchor.lat,
    longitude: anchor.lon,
  };
}

/**
 * Convert a stored snapshot to annotate() specs. Garbage is skipped.
 * @param {object} snapshot
 * @returns {Array<object>}
 */
export function snapshotToAnnotateSpecs(snapshot) {
  if (!snapshot || snapshot.v !== ANNOTATION_PERSIST_VERSION || !Array.isArray(snapshot.marks)) {
    return [];
  }
  return snapshot.marks
    .map(persistedMarkToAnnotateSpec)
    .filter(Boolean)
    .slice(0, MAX_LIVE_ANNOTATIONS);
}

/**
 * Read `meridian.annotations`. Unreadable / malformed storage is empty.
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {{v:number, marks: object[]}}
 */
export function readAnnotationSnapshot(storage) {
  const empty = { v: ANNOTATION_PERSIST_VERSION, marks: [] };
  if (!storage?.getItem) return empty;
  try {
    const raw = storage.getItem(ANNOTATION_PERSIST_KEY);
    if (raw == null || raw === '') return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== ANNOTATION_PERSIST_VERSION || !Array.isArray(parsed.marks)) {
      return empty;
    }
    return { v: ANNOTATION_PERSIST_VERSION, marks: parsed.marks };
  } catch {
    return empty;
  }
}

/**
 * Write the compact snapshot. An empty mark list removes the key (Clear).
 * @param {{setItem?: Function, removeItem?: Function}|null|undefined} storage
 * @param {{marks?: object[]}|null|undefined} snapshot
 * @returns {boolean}
 */
export function writeAnnotationSnapshot(storage, snapshot) {
  if (!storage?.setItem) return false;
  try {
    const marks = Array.isArray(snapshot?.marks) ? snapshot.marks : [];
    if (!marks.length) {
      if (typeof storage.removeItem === 'function') storage.removeItem(ANNOTATION_PERSIST_KEY);
      else storage.setItem(ANNOTATION_PERSIST_KEY, JSON.stringify({ v: ANNOTATION_PERSIST_VERSION, marks: [] }));
      return true;
    }
    storage.setItem(
      ANNOTATION_PERSIST_KEY,
      JSON.stringify({ v: ANNOTATION_PERSIST_VERSION, marks: marks.slice(0, MAX_LIVE_ANNOTATIONS) }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore stored persistent marks through annotate(lat/lon). Same options as Import.
 * @param {{annotate: Function}} engine
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {Promise<{restored: number}>}
 */
export async function restoreAnnotationsFromStorage(engine, storage) {
  const specs = snapshotToAnnotateSpecs(readAnnotationSnapshot(storage));
  if (!specs.length || typeof engine?.annotate !== 'function') return { restored: 0 };
  const result = await engine.annotate(specs, {
    clearPrevious: false,
    persist: true,
    flyTo: false,
  });
  return { restored: result?.drawn ?? 0 };
}

/**
 * Subscribe to board changes and restore once on init.
 *
 * @param {{annotate: Function, list?: Function, onChange?: Function}} engine
 * @param {{storage?: {getItem?: Function, setItem?: Function, removeItem?: Function}|null}} [options]
 * @returns {{restorePromise: Promise<{restored: number}>, destroy: Function}|null}
 */
export function initAnnotationPersist(engine, { storage } = {}) {
  if (!engine || typeof engine.annotate !== 'function' || typeof engine.list !== 'function') {
    return null;
  }
  const store = storage !== undefined ? storage : defaultStorage();

  let restoring = false;
  const persistNow = () => {
    if (restoring) return;
    writeAnnotationSnapshot(store, snapshotPersistentAnnotations(engine.list()));
  };

  const unsubscribe = typeof engine.onChange === 'function'
    ? engine.onChange(persistNow)
    : null;

  restoring = true;
  const restorePromise = Promise.resolve()
    .then(() => restoreAnnotationsFromStorage(engine, store))
    .then((result) => {
      restoring = false;
      persistNow();
      return result;
    })
    .catch(() => {
      restoring = false;
      return { restored: 0 };
    });

  return {
    restorePromise,
    destroy() {
      unsubscribe?.();
    },
  };
}
