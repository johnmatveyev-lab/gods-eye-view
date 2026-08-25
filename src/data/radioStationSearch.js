/**
 * Client-side Radio Browser directory search.
 *
 * Filters the stations the client already received by name, country, or tag.
 * Playback still uses the existing `/api/radio` broker; this module never
 * fetches Radio Browser or adds a search endpoint.
 */

/**
 * Normalize one search-field value. Whitespace-only is treated as empty.
 * @param {unknown} query
 * @returns {string}
 */
export function normalizeRadioStationSearchQuery(query) {
  return String(query ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function stationSearchValues(station) {
  const tags = Array.isArray(station?.tags)
    ? station.tags
    : String(station?.tags ?? '').split(',');
  return [
    station?.name,
    station?.country,
    station?.countryCode,
    station?.state,
    ...tags,
  ].map((value) => normalizeRadioStationSearchQuery(value)).filter(Boolean);
}

/**
 * Whether one directory station matches the current search field.
 * An empty query keeps every station already in the current list.
 * @param {object} station
 * @param {unknown} query
 * @returns {boolean}
 */
export function stationMatchesRadioSearch(station, query) {
  const needle = normalizeRadioStationSearchQuery(query);
  if (!needle) return true;
  return stationSearchValues(station).some((value) => value.includes(needle));
}

/**
 * Current-list stations matching name, country, or tag.
 * @param {Array<object>} stations
 * @param {unknown} query
 * @returns {Array<object>}
 */
export function filterRadioStationsBySearch(stations, query) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioSearch(station, query));
}

/**
 * Hide or show already-rendered directory rows. Rows are not removed.
 * @param {HTMLElement|null} container
 * @param {unknown} query
 * @param {Array<object>} stations
 */
export function applyRadioStationSearch(container, query, stations) {
  if (!container) return;
  for (const station of Array.isArray(stations) ? stations : []) {
    const row = container.querySelector?.(`[data-station-id="${station.id}"]`);
    if (!row) continue;
    row.hidden = !stationMatchesRadioSearch(station, query);
  }
}

/**
 * Render one compact row per current-list station.
 * @param {HTMLElement|null} container
 * @param {Array<object>} stations
 * @param {{selectedId?: string|null, onSelect?: Function}} [options]
 */
export function renderRadioStationList(container, stations, { selectedId = null, onSelect } = {}) {
  if (!container) return;
  const rows = (Array.isArray(stations) ? stations : []).map((station) => {
    const button = globalThis.document?.createElement?.('button') || {
      className: '',
      dataset: {},
      textContent: '',
      hidden: false,
      type: '',
      setAttribute() {},
      addEventListener() {},
    };
    const country = [station?.countryCode, station?.country].filter(Boolean).join(' · ');
    button.type = 'button';
    button.className = 'radio-station-row';
    button.dataset.stationId = String(station?.id || '');
    button.textContent = [station?.name || 'Untitled station', country].filter(Boolean).join(' — ');
    button.setAttribute('aria-pressed', String(station?.id === selectedId));
    if (typeof onSelect === 'function') {
      button.addEventListener('click', () => onSelect(station.id));
    }
    return button;
  });
  if (typeof container.replaceChildren === 'function') container.replaceChildren(...rows);
  else {
    container.children = rows;
  }
}
