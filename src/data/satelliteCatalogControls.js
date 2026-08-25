/**
 * DATA LAYERS chips for Satellites: Core | Dense.
 *
 * Core is the six CelesTrak groups (~840). Dense calls the existing
 * `setParams({ catalog: 'dense' })` path (chunked Starlink points-only extras).
 * This is not the Plan 65 core-group picker — that filter, if present, still
 * only names those six groups.
 */

/**
 * @param {{ catalog?: 'core'|'dense', denseStatus?: 'idle'|'loading'|'ready'|'failed', denseError?: string|null }} [input]
 * @returns {{ chips: Array<object> }}
 */
export function satelliteCatalogControls({
  catalog = 'core',
  denseStatus = 'idle',
  denseError = null,
} = {}) {
  const loading = denseStatus === 'loading';
  const failed = denseStatus === 'failed';
  const denseReady = catalog === 'dense' && denseStatus === 'ready';
  const coreActive = !loading && !denseReady;
  let denseTitle = 'Add the Starlink broadband shell as points-only extras';
  if (loading) denseTitle = 'Loading the Starlink shell…';
  else if (failed) denseTitle = `Starlink ${denseError || 'feed unavailable'} — click to retry`;
  else if (denseReady) denseTitle = 'Showing the Starlink shell — click Core for the ~840 catalog';
  return {
    chips: [
      {
        id: 'catalog-core',
        label: 'Core',
        title: 'Show the six-group core catalog (~840 satellites)',
        active: coreActive,
        busy: false,
        disabled: false,
        state: coreActive ? 'active' : 'idle',
        params: { catalog: 'core' },
      },
      {
        id: 'catalog-dense',
        label: loading ? 'Dense ···' : (failed ? 'Dense ✕' : 'Dense'),
        title: denseTitle,
        active: denseReady,
        busy: loading,
        disabled: loading,
        state: loading ? 'loading' : (failed ? 'error' : (denseReady ? 'active' : 'idle')),
        params: { catalog: 'dense' },
      },
    ],
  };
}
