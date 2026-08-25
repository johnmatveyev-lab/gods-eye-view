/**
 * Voice common-name map for registered data layers, plus the legal subset
 * used by the hosted layer-list filter.
 *
 * Banned commercial-fork sources (OpenSky, Google News RSS, TeleGeography
 * cables) stay out of the list map. Voice may still resolve cable aliases
 * to the registered no-op layer; the filter never offers that row.
 */

export const VOICE_LAYER_ALIASES = new Map([
  ['flights', 'flights'],
  ['planes', 'flights'],
  ['aircraft', 'flights'],
  ['opensky', 'opensky'],
  ['open sky', 'opensky'],
  ['open-sky', 'opensky'],
  ['military', 'military'],
  ['military flights', 'military'],
  ['earthquakes', 'earthquakes'],
  ['quakes', 'earthquakes'],
  ['satellites', 'satellites'],
  ['space mission', 'rocket-launches'],
  ['space missions', 'rocket-launches'],
  ['missions', 'rocket-launches'],
  ['traffic', 'traffic'],
  ['street traffic', 'traffic'],
  ['cctv', 'cctv'],
  ['cameras', 'cctv'],
  ['radio', 'radio'],
  ['internet radio', 'radio'],
  ['radio stations', 'radio'],
  ['bikeshare', 'bikeshare'],
  ['bikes', 'bikeshare'],
  ['ais', 'ais-live-vessels'],
  ['ships', 'ais-live-vessels'],
  ['vessels', 'ais-live-vessels'],
  ['live vessels', 'ais-live-vessels'],
  ['datacenters', 'local-datacenters'],
  ['data centers', 'local-datacenters'],
  ['data centres', 'local-datacenters'],
  ['dams', 'local-dams'],
  ['submarine cables', 'telegeography-submarine-cables'],
  ['submarine cable', 'telegeography-submarine-cables'],
  ['undersea cables', 'telegeography-submarine-cables'],
  ['undersea cable', 'telegeography-submarine-cables'],
  ['cables', 'telegeography-submarine-cables'],
  ['telegeography', 'telegeography-submarine-cables'],
  ['firms', 'local-firms'],
  ['fires', 'local-firms'],
  ['active fires', 'local-firms'],
]);

export const BANNED_LAYER_LIST_IDS = new Set([
  'telegeography-submarine-cables',
  'opensky',
  'google-news',
  'google-news-rss',
]);

export const BANNED_LAYER_LIST_ALIAS_RE = /opensky|google news|telegeography|\bcables?\b|submarine cable|undersea/i;

export const LAYER_LIST_ALIASES = new Map(
  [...VOICE_LAYER_ALIASES].filter(([alias, id]) => (
    !BANNED_LAYER_LIST_IDS.has(id) && !BANNED_LAYER_LIST_ALIAS_RE.test(alias)
  )),
);
