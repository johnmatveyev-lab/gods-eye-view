/**
 * Submarine-cables layer — commercial no-op.
 *
 * The upstream project bundled TeleGeography Submarine Cable Map GeoJSON
 * (CC BY-NC-SA 3.0, NonCommercial). This commercial fork deletes that dataset
 * and never loads or renders it. The layer id stays registered so share-link
 * token `u` and voice enums do not break; enable/update are no-ops.
 */

/** Shared world-overlay source id (matches the historical layer id). */
export const CABLE_OVERLAY_SOURCE_ID = 'telegeography-submarine-cables';

/**
 * Historical overlay-cohort cap retained for allocation-probe bookkeeping.
 * The live layer never publishes cable labels.
 */
export const CABLE_REFERENCE_LABEL_WINNER_CAP = 160;

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
