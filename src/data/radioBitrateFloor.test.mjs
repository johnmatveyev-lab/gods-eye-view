import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_BITRATE_FLOOR,
  RADIO_BITRATE_FLOORS,
  filterRadioStationsByBitrateFloor,
  normalizeRadioBitrateFloor,
  stationMatchesRadioBitrateFloor,
} from './radioBitrateFloor.js';
import { radioLayer } from './radio.js';
import { decodeLayerStateParams, encodeLayerStateParams, normalizeLayerState } from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'junk-32',
    name: 'Scratchy AM',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 32,
  },
  {
    id: 'mid-96',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 96,
  },
  {
    id: 'ok-128',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
  },
  {
    id: 'hi-192',
    name: 'Primary Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 192,
  },
  {
    id: 'unknown-null',
    name: 'Mystery News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: null,
  },
]);

function makeStation(overrides) {
  return {
    homepage: null,
    languages: ['English'],
    state: 'Texas',
    country: 'United States',
    countryCode: 'US',
    metadataTrust: 'untrusted-community',
    codec: 'MP3',
    lat: 30,
    lon: -97,
    streamUrl: `https://radio.example.com/${overrides.id}.mp3`,
    ...overrides,
  };
}

function viewerStub() {
  return {
    camera: { positionWC: { x: 7_000_000, y: 0, z: 0 } },
    scene: {
      canvas: { disableRootEvents: true, onwheel: null, addEventListener() {}, removeEventListener() {} },
      requestRender() {},
    },
    dataSources: { add() {}, remove() {} },
    entities: { add(entity) { return entity; }, remove() {} },
  };
}

async function loadDirectory(stationRows, { fetchCalls } = {}) {
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;
  const audioInstances = [];
  globalThis.Audio = class {
    constructor() {
      this.src = '';
      this.volume = 0.8;
      this.currentSrc = '';
      this.listeners = new Map();
      audioInstances.push(this);
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    pause() {}
    play() {
      this.currentSrc = this.src;
      return Promise.resolve();
    }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  globalThis.fetch = async (url) => {
    fetchCalls?.push(String(url));
    if (String(url).startsWith('/api/radio/click/')) return { ok: true };
    return {
      ok: true,
      json: async () => ({
        stations: stationRows,
        updatedAt: new Date().toISOString(),
        stale: false,
        degraded: false,
        acceptedGeneration: 1,
        catalogInstance: 'qa-bitrate-floor',
      }),
    };
  };
  radioLayer.destroy();
  radioLayer.init(viewerStub());
  radioLayer.enable();
  await radioLayer.update();
  radioLayer.setLifecyclePresentation({
    lifecycleState: 'enabled',
    enabled: true,
    uncertain: false,
  });
  return {
    audioInstances,
    restore() {
      radioLayer.destroy();
      globalThis.fetch = originalFetch;
      if (originalAudio === undefined) delete globalThis.Audio;
      else globalThis.Audio = originalAudio;
    },
  };
}

test('All is the default bitrate floor and matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_BITRATE_FLOOR, 'all');
  assert.deepEqual(RADIO_BITRATE_FLOORS.map((floor) => floor.id), ['all', '64', '128', '192']);
  assert.deepEqual(
    filterRadioStationsByBitrateFloor(DIRECTORY, 'all').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.equal(normalizeRadioBitrateFloor('128'), '128');
  assert.equal(normalizeRadioBitrateFloor('nope'), null);
});

test('128+ hides sub-128 stations and keeps null bitrate visible', () => {
  assert.deepEqual(
    filterRadioStationsByBitrateFloor(DIRECTORY, '128').map((station) => station.id),
    ['ok-128', 'hi-192', 'unknown-null'],
  );
  assert.equal(stationMatchesRadioBitrateFloor(DIRECTORY[0], '128'), false);
  assert.equal(stationMatchesRadioBitrateFloor(DIRECTORY[2], '128'), true);
  assert.equal(stationMatchesRadioBitrateFloor(DIRECTORY[4], '128'), true);
  assert.equal(stationMatchesRadioBitrateFloor(DIRECTORY[1], '64'), true);
  assert.equal(stationMatchesRadioBitrateFloor(DIRECTORY[1], '192'), false);
});

test('a playing station below the floor stays visible but is not walkable', () => {
  const visible = filterRadioStationsByBitrateFloor(DIRECTORY, '128', { keepStationId: 'mid-96' });
  assert.deepEqual(visible.map((station) => station.id), ['mid-96', 'ok-128', 'hi-192', 'unknown-null']);
  const walkable = filterRadioStationsByBitrateFloor(DIRECTORY, '128');
  assert.equal(walkable.some((station) => station.id === 'mid-96'), false);
});

test('genre and search still AND with the bitrate floor', () => {
  const news = DIRECTORY.filter((station) => station.tags.includes('news'));
  const floored = filterRadioStationsByBitrateFloor(news, '128');
  const searched = floored.filter((station) => station.name.toLowerCase().includes('primary'));
  assert.deepEqual(searched.map((station) => station.id), ['ok-128']);
});

test('Radio panel exposes All | 64+ | 128+ | 192+ chips above the station list', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-bitrate-floor"/);
  assert.match(panel[0], /data-radio-bitrate="all"[^>]*>All</);
  assert.match(panel[0], /data-radio-bitrate="64"[^>]*>64\+</);
  assert.match(panel[0], /data-radio-bitrate="128"[^>]*>128\+</);
  assert.match(panel[0], /data-radio-bitrate="192"[^>]*>192\+</);
  assert.ok(
    panel[0].indexOf('id="radio-bitrate-floor"') < panel[0].indexOf('id="radio-station-search"'),
    'bitrate chips sit with the directory filters, not after search',
  );
  assert.match(panel[0], /id="radio-station-search"/);
  assert.match(panel[0], /id="radio-filter"/);
  assert.match(ui, /setLayerParams\('radio', \{[\s\S]*?minBitrate:/);
  assert.match(ui, /data-radio-bitrate/);
});

test('All matches the live directory; 128+ hides sub-128 from the list and globe', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const session = await loadDirectory(rows);
  try {
    assert.equal(radioLayer.getUIState().minBitrate, 'all');
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));

    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.getUIState().minBitrate, '128');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[2].id, rows[3].id, rows[4].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id, rows[3].id, rows[4].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 3);
  } finally {
    session.restore();
  }
});

test('prev/next only walks stations at or above the floor', async () => {
  const rows = DIRECTORY.slice(0, 4).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
    tags: ['news'],
  }));
  const session = await loadDirectory(rows);
  try {
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.selectStation(rows[2].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[3].id);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[2].id);
    assert.equal(
      [rows[0].id, rows[1].id].includes(radioLayer.getUIState().selected?.id),
      false,
    );
  } finally {
    session.restore();
  }
});

test('playing a 96 kbps station then setting 128+ does not cut audio until stop or next', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000002${index + 1}`,
    lat: 30 + index,
  }));
  const session = await loadDirectory(rows);
  try {
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[1].id);
    const srcBefore = session.audioInstances.at(-1).src;

    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[1].id);
    assert.equal(session.audioInstances.at(-1).src, srcBefore);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[1].id),
      'playing station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[1].id),
      false,
      'prev/next must not keep walking the below-floor station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.ok(Number(radioLayer.getUIState().selected?.bitrate) >= 128
      || radioLayer.getUIState().selected?.bitrate == null);
  } finally {
    session.restore();
  }
});

test('genre and search still AND with the live bitrate floor', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const session = await loadDirectory(rows);
  try {
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing the chip re-applies the in-memory directory without another /api/radio fetch', async () => {
  const rows = [makeStation({
    ...DIRECTORY[2],
    id: '00000000-0000-4000-8000-000000000041',
  })];
  const fetchCalls = [];
  const session = await loadDirectory(rows, { fetchCalls });
  try {
    const afterLoad = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.ok(afterLoad >= 1);
    assert.equal(radioLayer.setBitrateFloor('192'), true);
    assert.equal(radioLayer.setBitrateFloor('all'), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('bitrate floor persists on the existing radio options enum and adds no /api', () => {
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['radio'],
    options: { radio: { filter: 'news', volume: 0.5, minBitrate: '128' } },
  }));
  assert.match(String(encoded), /r\.b\.1/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options.radio.minBitrate, '128');

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=r&lo=r.f.n_r.v.50'));
  assert.equal(omitted.options.radio.minBitrate, 'all');

  const apiDir = path.join(ROOT, 'api');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.ok(files.includes('radio/[...path].js'));
  assert.equal(files.filter((file) => file.toLowerCase().includes('radio')).length, 1);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioBitrateFloor.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioBitrateFloor.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
