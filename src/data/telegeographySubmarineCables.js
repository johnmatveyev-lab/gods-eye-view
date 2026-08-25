/**
 * Submarine-cables layer — commercial no-op.
 *
 * The upstream project bundled TeleGeography Submarine Cable Map GeoJSON
 * (CC BY-NC-SA 3.0, NonCommercial). This commercial fork deletes that dataset
 * and never loads or renders it. The layer id stays registered so share-link
 * token `u` and voice enums do not break. The layer is unselectable: hidden
 * from the Data Layers panel, enable is a no-op, and voice refuses it.
 */

/** Shared world-overlay source id (matches the historical layer id). */
export const CABLE_OVERLAY_SOURCE_ID = 'telegeography-submarine-cables';

/**
 * Historical overlay-cohort cap retained for allocation-probe bookkeeping.
 * The live layer never publishes cable labels.
 */
export const CABLE_REFERENCE_LABEL_WINNER_CAP = 160;

/** Shared ambient-label paint budget, matching the infrastructure sources. */
export const CABLE_OVERLAY_COLLISION_CAPACITY = 96;

const BASE_CABLE_COLOR = '#39d5ff';
const BASE_LANDING_COLOR = '#8fffd2';
const CABLE_REFERENCE_LABEL_MAX_DISTANCE_M = 9000000;

/**
 * Distance-derived arbiter priority. Kept for allocation-probe entry shape
 * only — the live layer never publishes cable labels.
 * @param {number} distanceM
 * @returns {number}
 */
export function cableReferencePriority(distanceM) {
  const distance = Number.isFinite(distanceM)
    ? Math.max(0, distanceM)
    : CABLE_REFERENCE_LABEL_MAX_DISTANCE_M;
  return 1000 - Math.round(distance / 50000);
}

/**
 * Build one shared-host ambient label for an allocation-probe record.
 * Production never calls this: the cables layer is a no-op and ships no
 * TeleGeography geometry.
 * @param {object} record Reference record ({ id, kind, label, tip }).
 * @returns {object}
 */
export function createCableOverlayEntry(record) {
  const kind = record?.kind === 'landing-point' ? 'landing-point' : 'cable';
  return {
    id: String(record?.id || ''),
    position: record?.tip,
    variant: 'label',
    title: String(record?.label || ''),
    accent: kind === 'cable' ? BASE_CABLE_COLOR : BASE_LANDING_COLOR,
    priority: cableReferencePriority(record?.distanceM),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    minDistance: 0,
    maxDistance: CABLE_REFERENCE_LABEL_MAX_DISTANCE_M,
    distanceFadeStartRatio: 0.7,
    distanceScale: {
      near: 250000,
      nearValue: 1,
      far: 9000000,
      farValue: 0.62,
    },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

const REMOVED_ERROR = 'Submarine cables removed from this commercial build';

/**
 * Create the registered no-op cables layer.
 * @returns {object} Layer descriptor conforming to the manager interface.
 */
export function createTeleGeographySubmarineCableLayer() {
  return {
    id: CABLE_OVERLAY_SOURCE_ID,
    name: 'Submarine Cables',
    icon: '≋',
    source: 'Unavailable',
    updateInterval: 0,
    statsRefreshInterval: 500,
    showInTogglePanel: false,
    selectable: false,

    init() {},
    enable() {},
    disable() {},
    update() {},
    destroy() {},

    getStats() {
      return {
        count: 0,
        lastUpdate: null,
        loading: false,
        loadingLabel: '',
        error: REMOVED_ERROR,
        unavailable: true,
        referenceLabelCount: 0,
      };
    },
  };
}

export default createTeleGeographySubmarineCableLayer();
