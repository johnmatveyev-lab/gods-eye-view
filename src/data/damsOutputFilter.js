/**
 * Client-only dam output-floor chips for the in-view list / fly-to surface.
 *
 * Re-filters the already-bundled OSM / ODbL `local-dams` snapshot by
 * `properties.output` (also accepted on the list record as `output`).
 * Never fetches, adds no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damOutput`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The floor
 * is not a share-URL field.
 *
 * Distinct from Plan 193 datacenter operator-missing hide.
 */

import { getContextStore } from './contextStore.js';

/** Operator output-floor chips. `all` is the current unfiltered in-view list. */
export const DAM_OUTPUT_FLOOR_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    floorMw: 0,
    label: 'All',
    title: 'Show every dam regardless of plant output',
  }),
  Object.freeze({
    id: '10',
    floorMw: 10,
    label: '10+ MW',
    title: 'Hide dams below 10 MW',
  }),
  Object.freeze({
    id: '100',
    floorMw: 100,
    label: '100+ MW',
    title: 'Hide dams below 100 MW',
  }),
]);

export const DAM_OUTPUT_STORAGE_KEY = 'meridian.damOutput';

export const DEFAULT_DAM_OUTPUT_FLOOR = 'all';

/** @typedef {'all'|'10'|'100'} DamOutputFloor */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / persist value to an output-floor id. Unknown values stay
 * All so a stale preference cannot invent a new query.
 * @param {*} value
 * @returns {DamOutputFloor}
 */
export function normalizeDamOutputFloor(value) {
  if (value === 10 || value === '10') return '10';
  if (value === 100 || value === '100') return '100';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_DAM_OUTPUT_FLOOR;
}

/** Numeric MW threshold for a floor id. All is 0. */
export function damOutputFloorMw(floor) {
  const id = normalizeDamOutputFloor(floor);
  switch (id) {
    case 'all':
      return 0;
    case '10':
      return 10;
    case '100':
      return 100;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Parse an OSM plant-output string to megawatts.
 * KW is divided by 1000; MW is used as-is. Missing / unparseable is null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseDamOutputMw(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kW|MW)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2].toUpperCase();
  switch (unit) {
    case 'KW':
      return amount / 1000;
    case 'MW':
      return amount;
    default: {
      const _exhaustive = /** @type {never} */ (unit);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Raw output string already on a list record, its properties, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {unknown}
 */
export function damOutputRaw(record) {
  if (record == null) return null;
  if (record.output != null && record.output !== '') return record.output;
  const props = record.properties;
  if (props?.output != null && props.output !== '') return props.output;
  const tagged = props?.tags?.['plant:output:electricity'];
  if (tagged != null && tagged !== '') return tagged;
  return contextDamOutput(record);
}

function contextDamOutput(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const output = ctx?.properties?.output ?? ctx?.properties?.tags?.['plant:output:electricity'];
    if (output != null && output !== '') return output;
  } catch {
    // Node tests and missing window fail open to "no output on the record".
  }
  return null;
}

/**
 * Whether one dam clears the output floor. Missing / unparseable output
 * stays visible so an untagged run-of-river site is never dropped.
 * @param {Object|null|undefined} record
 * @param {DamOutputFloor|number} floor
 * @returns {boolean}
 */
export function damMeetsOutputFloor(record, floor) {
  const min = damOutputFloorMw(floor);
  if (min <= 0) return true;
  const parsed = parseDamOutputMw(damOutputRaw(record));
  if (parsed == null) return true;
  return parsed >= min;
}

/**
 * Keep dams at or above the output floor. All returns a shallow copy.
 * @param {Array<Object>|null|undefined} records
 * @param {DamOutputFloor|number} floor
 * @returns {Array<Object>}
 */
export function filterDamsByOutputFloor(records, floor) {
  if (!Array.isArray(records)) return [];
  if (damOutputFloorMw(floor) <= 0) return records.slice();
  return records.filter((record) => damMeetsOutputFloor(record, floor));
}

/**
 * Exclusive-chip models for the dams in-view list row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function damsOutputChipModels(current = DEFAULT_DAM_OUTPUT_FLOOR) {
  const floor = normalizeDamOutputFloor(current);
  return DAM_OUTPUT_FLOOR_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case '10':
      case '100':
        return {
          id: `output-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'Output',
          params: { damOutput: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `output-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Output',
          params: { damOutput: floor },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {DamOutputFloor}
 */
export function readDamOutputFloor(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DAM_OUTPUT_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_OUTPUT_FLOOR;
    return normalizeDamOutputFloor(raw);
  } catch {
    return DEFAULT_DAM_OUTPUT_FLOOR;
  }
}

/**
 * @param {unknown} floor
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {DamOutputFloor}
 */
export function writeDamOutputFloor(floor, storage) {
  const normalized = normalizeDamOutputFloor(floor);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(DAM_OUTPUT_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen floor.
  }
  return normalized;
}
