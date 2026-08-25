import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_HIDE_OFFLINE,
  RADIO_HIDE_OFFLINE_STORAGE_KEY,
  filterRadioStationsByOffline,
  normalizeRadioHideOffline,
  normalizeRadioLastCheckOk,
  readRadioHideOffline,
  stationLastCheckOk,
  stationMatchesRadioOfflineFilter,
  writeRadioHideOffline,
} from './radioOfflineFilter.js';
import { normalizeRadioBrowserStation, radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'ok-true',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['English'],
    lastCheckOk: true,
  },
  {
    id: 'ok-false',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 96,
    codec: 'AAC',
    languages: ['Spanish'],
    lastCheckOk: false,
  },
  {
    id: 'ok-missing',
    name: 'Primary HE News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 192,
    codec: 'HE-AAC',
    languages: ['eng'],
  },
  {
    id: 'ok-unknown',
    name: 'Talk Plus',
    tags: ['talk'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 64,
    codec: 'AAC+',
    languages: ['French'],
    lastCheckOk: 'stale',
  },
  {
    id: 'ok-true-news',
    name: 'Mystery News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['en'],
    lastCheckOk: true,
  },
]);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

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

async function loadDirectory(stationRows, { fetchCalls, storage } = {}) {
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
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
        catalogInstance: 'qa-radio-offline',
      }),
    };
  };
  if (storage) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => storage,
    });
  }
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
      if (storage) {
        if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
        else delete globalThis.localStorage;
      }
    },
  };
}

test('hide-offline defaults off and matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_HIDE_OFFLINE, false);
  assert.equal(normalizeRadioHideOffline(null), false);
  assert.equal(normalizeRadioHideOffline(false), false);
  assert.equal(normalizeRadioHideOffline(true), true);
  assert.deepEqual(
    filterRadioStationsByOffline(DIRECTORY, false).map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
});

test('on hides lastCheckOk false and keeps missing or unknown', () => {
  assert.equal(stationLastCheckOk(DIRECTORY[0]), true);
  assert.equal(stationLastCheckOk(DIRECTORY[1]), false);
  assert.equal(stationLastCheckOk(DIRECTORY[2]), undefined);
  assert.equal(stationLastCheckOk(DIRECTORY[3]), undefined);
  assert.equal(normalizeRadioLastCheckOk(1), true);
  assert.equal(normalizeRadioLastCheckOk(true), true);
  assert.equal(normalizeRadioLastCheckOk(0), false);
  assert.equal(normalizeRadioLastCheckOk(false), false);
  assert.equal(normalizeRadioLastCheckOk(undefined), undefined);
  assert.deepEqual(
    filterRadioStationsByOffline(DIRECTORY, true).map((station) => station.id),
    ['ok-true', 'ok-missing', 'ok-unknown', 'ok-true-news'],
  );
  assert.equal(stationMatchesRadioOfflineFilter(DIRECTORY[1], true), false);
  assert.equal(stationMatchesRadioOfflineFilter(DIRECTORY[0], true), true);
  assert.equal(stationMatchesRadioOfflineFilter(DIRECTORY[2], true), true);
  assert.equal(stationMatchesRadioOfflineFilter(DIRECTORY[3], true), true);
  assert.equal(stationMatchesRadioOfflineFilter(DIRECTORY[1], false), true);
});

test('a playing or selected offline station stays visible when hide-offline is on but is not walkable', () => {
  const visible = filterRadioStationsByOffline(DIRECTORY, true, { keepStationId: 'ok-false' });
  assert.deepEqual(visible.map((station) => station.id), [
    'ok-true', 'ok-false', 'ok-missing', 'ok-unknown', 'ok-true-news',
  ]);
  const walkable = filterRadioStationsByOffline(DIRECTORY, true);
  assert.equal(walkable.some((station) => station.id === 'ok-false'), false);
});

test('Radio panel exposes a Hide offline chip next to English', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-hide-offline"/);
  assert.match(panel[0], />Hide offline</);
  assert.match(panel[0], /id="radio-english-only"/);
  assert.ok(
    panel[0].indexOf('id="radio-english-only"') < panel[0].indexOf('id="radio-hide-offline"'),
    'Hide offline sits next to English on the directory filter row',
  );
  assert.ok(
    panel[0].indexOf('id="radio-hide-offline"') < panel[0].indexOf('id="radio-station-search"'),
    'Hide offline stays with directory filters, not after search',
  );
  assert.match(ui, /setHideOffline\(!presentation\.hideOffline\)/);
  assert.match(ui, /_radioHideOfflineBtn\.hidden = !state\?\.enabled/);
});

test('lastCheckOk is kept through Radio Browser normalize', () => {
  const raw = {
    stationuuid: '12345678-1234-4234-8234-123456789abc',
    name: 'Test Radio',
    url_resolved: 'https://stream.example.org/live.mp3',
    homepage: 'https://station.example.org/',
    tags: 'news',
    language: 'English',
    country: 'United States',
    countrycode: 'US',
    state: 'Texas',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    geo_lat: 30.2672,
    geo_long: -97.7431,
    clickcount: 42,
  };
  const online = normalizeRadioBrowserStation(raw);
  assert.equal(online.lastCheckOk, true);
  assert.equal(normalizeRadioBrowserStation({ ...raw, lastcheckok: true }).lastCheckOk, true);
  assert.equal(normalizeRadioBrowserStation({ ...raw, lastcheckok: 0 }), null);
  assert.equal(normalizeRadioBrowserStation({ ...raw, lastcheckok: false }), null);
});

test('off matches the live directory; on hides lastCheckOk false from the list and globe', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().hideOffline, false);
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getDirectoryStations()[0].lastCheckOk, true);
    assert.equal(radioLayer.getDirectoryStations()[1].lastCheckOk, false);
    assert.equal('lastCheckOk' in radioLayer.getDirectoryStations()[2], false);

    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.getUIState().hideOffline, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id, rows[3].id, rows[4].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[2].id, rows[3].id, rows[4].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 4);

    assert.equal(radioLayer.setHideOffline(false), true);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
  } finally {
    session.restore();
  }
});

test('client normalize keeps lastcheckok 1/0 as lastCheckOk on the roster', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Raw Online',
      lastcheckok: 1,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000012',
      name: 'Raw Offline',
      lastcheckok: 0,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000013',
      name: 'Raw Unknown',
    }),
  ];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    const roster = radioLayer.getDirectoryStations();
    assert.equal(roster.find((station) => station.id === rows[0].id).lastCheckOk, true);
    assert.equal(roster.find((station) => station.id === rows[1].id).lastCheckOk, false);
    assert.equal('lastCheckOk' in roster.find((station) => station.id === rows[2].id), false);
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
  } finally {
    session.restore();
  }
});

test('prev/next only walks online or unknown stations when the chip is on', async () => {
  const rows = [DIRECTORY[0], DIRECTORY[1], DIRECTORY[2]].map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
    tags: ['news'],
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[2].id);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[0].id);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
  } finally {
    session.restore();
  }
});

test('playing an offline station then enabling hide-offline does not cut audio until next or stop', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000002${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[1].id);
    const srcBefore = session.audioInstances.at(-1).src;

    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[1].id);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.equal(session.audioInstances.at(-1).src, srcBefore);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[1].id),
      'playing station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[1].id),
      false,
      'prev/next must not keep walking the offline station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.notEqual(radioLayer.getUIState().selected?.lastCheckOk, false);
  } finally {
    session.restore();
  }
});

test('a selected offline station stays visible when hide-offline is on', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000007${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.getUIState().audioState, 'stopped');
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[1].id),
      'selected station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[1].id),
      false,
      'prev/next must not keep walking the selected offline station',
    );
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, English, country, and state still AND with hide-offline', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[2].id), true);
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.setCodecs({ mp3: false, aac: true }), true);
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(radioLayer.setCountry('CA'), true);
    assert.equal(radioLayer.setState('Texas'), true);
    assert.equal(radioLayer.setHideOffline(true), true);
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
    ...DIRECTORY[0],
    id: '00000000-0000-4000-8000-000000000051',
  })];
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    const afterLoad = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.ok(afterLoad >= 1);
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.setHideOffline(false), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('refresh keeps hide-offline on the already-fetched roster', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000005${index + 1}`,
    lat: 30 + index,
  }));
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    assert.equal(radioLayer.setHideOffline(true), true);
    const afterSet = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
    await radioLayer.update();
    assert.equal(radioLayer.getUIState().hideOffline, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
    assert.ok(fetchCalls.filter((url) => url.startsWith('/api/radio')).length > afterSet);
  } finally {
    session.restore();
  }
});

test('Radio layer off hides the toggle and refuses edits without clearing it', async () => {
  const rows = [makeStation({
    ...DIRECTORY[0],
    id: '00000000-0000-4000-8000-000000000061',
  })];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideOffline(true), true);
    radioLayer.disable();
    assert.equal(radioLayer.getUIState().enabled, false);
    assert.equal(radioLayer.getUIState().hideOffline, true);
    assert.equal(radioLayer.setHideOffline(false), false);
    assert.equal(radioLayer.getUIState().hideOffline, true);
    radioLayer.enable();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled',
      enabled: true,
      uncertain: false,
    });
    assert.equal(radioLayer.getUIState().hideOffline, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
  } finally {
    session.restore();
  }
});

test('hide-offline survives reload from meridian.radioHideOffline', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000006${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(JSON.parse(storage.snapshot()[RADIO_HIDE_OFFLINE_STORAGE_KEY]), true);
    session.restore();
    const reloaded = await loadDirectory(rows, { storage });
    try {
      assert.equal(radioLayer.getUIState().hideOffline, true);
      assert.deepEqual(
        radioLayer.getDirectoryStations().map((station) => station.id),
        [rows[0].id, rows[2].id, rows[3].id, rows[4].id],
      );
    } finally {
      reloaded.restore();
    }
  } finally {
    session.restore();
  }
});

test('hide-offline persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_HIDE_OFFLINE_STORAGE_KEY, 'meridian.radioHideOffline');
  const storage = memoryStorage();
  assert.equal(readRadioHideOffline(storage), false);
  assert.equal(writeRadioHideOffline(true, storage), true);
  assert.equal(readRadioHideOffline(storage), true);

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/offline.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioOfflineFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/offline/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /hideOffline|radioHideOffline/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioOfflineFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
