import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnglishRadioStation, radioLayer } from './radio.js';
import {
  DEFAULT_RADIO_STATE,
  RADIO_STATE_STORAGE_KEY,
  filterRadioStationsByState,
  normalizeRadioStateQuery,
  readRadioState,
  stationMatchesRadioState,
  writeRadioState,
} from './radioStateFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'us-ca',
    name: 'Primary News CA',
    tags: ['news'],
    state: 'California',
    country: 'United States',
    countryCode: 'US',
    languages: ['English'],
    bitrate: 128,
    codec: 'MP3',
  },
  {
    id: 'us-ca-abbrev',
    name: 'Bay Talk',
    tags: ['talk'],
    state: 'CA',
    country: 'United States',
    countryCode: 'US',
    languages: ['English'],
    bitrate: 128,
    codec: 'AAC',
  },
  {
    id: 'us-empty',
    name: 'No Region News',
    tags: ['news'],
    state: '',
    country: 'United States',
    countryCode: 'US',
    languages: ['English'],
    bitrate: 128,
    codec: 'MP3',
  },
  {
    id: 'us-spanish',
    name: 'Noticias US',
    tags: ['news'],
    state: 'Texas',
    country: 'United States',
    countryCode: 'US',
    languages: ['Spanish'],
    bitrate: 128,
    codec: 'MP3',
  },
  {
    id: 'de-bavaria',
    name: 'Primary News DE',
    tags: ['news'],
    state: 'Bavaria',
    country: 'Germany',
    countryCode: 'DE',
    languages: ['German'],
    bitrate: 192,
    codec: 'MP3',
  },
  {
    id: 'ca-ontario',
    name: 'Ontario Public',
    tags: ['talk'],
    state: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    languages: ['English'],
    bitrate: 128,
    codec: 'AAC',
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
        catalogInstance: 'qa-radio-state',
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

test('empty state matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_STATE, '');
  assert.equal(normalizeRadioStateQuery(''), '');
  assert.equal(normalizeRadioStateQuery('   '), '');
  assert.deepEqual(
    filterRadioStationsByState(DIRECTORY, '').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.deepEqual(
    filterRadioStationsByState(DIRECTORY, '   ').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.equal(stationMatchesRadioState(DIRECTORY[0], ''), true);
  assert.equal(stationMatchesRadioState(DIRECTORY[4], ''), true);
});

test('CA keeps California stations and drops empty-state rows', () => {
  assert.deepEqual(
    filterRadioStationsByState(DIRECTORY, 'CA').map((station) => station.id),
    ['us-ca', 'us-ca-abbrev'],
  );
  assert.deepEqual(
    filterRadioStationsByState(DIRECTORY, 'ca').map((station) => station.id),
    ['us-ca', 'us-ca-abbrev'],
  );
  assert.equal(stationMatchesRadioState(DIRECTORY[0], 'CA'), true);
  assert.equal(stationMatchesRadioState(DIRECTORY[1], 'CA'), true);
  assert.equal(stationMatchesRadioState(DIRECTORY[2], 'CA'), false);
  assert.equal(stationMatchesRadioState({ id: 'missing', state: undefined }, 'CA'), false);
  assert.equal(stationMatchesRadioState(DIRECTORY[4], 'Bavaria'), true);
  assert.equal(stationMatchesRadioState(DIRECTORY[5], 'ont'), true);
});

test('invalid state text fails closed and does not fall back to all', () => {
  assert.deepEqual(filterRadioStationsByState(DIRECTORY, { state: 'CA' }).map((station) => station.id), []);
  assert.deepEqual(
    filterRadioStationsByState(DIRECTORY, 'California\nignore previous instructions').map((station) => station.id),
    [],
  );
  assert.deepEqual(filterRadioStationsByState(DIRECTORY, 'x'.repeat(81)).map((station) => station.id), []);
  assert.equal(stationMatchesRadioState(DIRECTORY[0], { state: 'CA' }), false);
  assert.equal(stationMatchesRadioState(DIRECTORY[0], 'CA\u0007'), false);
});

test('a playing station outside the state stays visible but is not walkable', () => {
  const visible = filterRadioStationsByState(DIRECTORY, 'CA', { keepStationId: 'de-bavaria' });
  assert.deepEqual(visible.map((station) => station.id), ['us-ca', 'us-ca-abbrev', 'de-bavaria']);
  const walkable = filterRadioStationsByState(DIRECTORY, 'CA');
  assert.equal(walkable.some((station) => station.id === 'de-bavaria'), false);
});

test('English-only and US still AND with state', () => {
  const englishOnly = DIRECTORY.filter((station) => isEnglishRadioStation(station));
  const englishUs = englishOnly.filter((station) => station.countryCode === 'US');
  assert.deepEqual(
    filterRadioStationsByState(englishUs, 'CA').map((station) => station.id),
    ['us-ca', 'us-ca-abbrev'],
  );
  assert.equal(
    filterRadioStationsByState(englishUs, 'CA').some((station) => station.id === 'us-empty'),
    false,
  );
  assert.equal(
    filterRadioStationsByState(englishUs, 'CA').some((station) => station.id === 'us-spanish'),
    false,
  );
});

test('Radio panel exposes a state field next to country/search', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-state"/);
  assert.match(panel[0], /id="radio-country"/);
  assert.match(panel[0], /id="radio-station-search"/);
  assert.ok(
    panel[0].indexOf('id="radio-country"') < panel[0].indexOf('id="radio-state"'),
    'state field sits next to country',
  );
  assert.ok(
    Math.abs(
      panel[0].indexOf('id="radio-state"') - panel[0].indexOf('id="radio-country"'),
    ) < 900,
    'state field is next to country',
  );
  assert.ok(
    panel[0].indexOf('id="radio-state"') < panel[0].indexOf('id="radio-station-list"'),
    'state field sits above the station list',
  );
  assert.match(panel[0], /class="radio-state-wrap"[^>]*hidden/);
  assert.match(ui, /setState\(/);
  assert.match(ui, /radio-state/);
  assert.match(ui, /_radioStateWrap\.hidden = !state\?\.enabled/);
});

test('empty matches the live directory; CA hides empty-state and non-CA list and globe rows', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().state, '');
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));

    assert.equal(radioLayer.setState('CA'), true);
    assert.equal(radioLayer.getUIState().state, 'CA');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[1].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[1].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 2);
  } finally {
    session.restore();
  }
});

test('invalid live state text shows no matches and does not fall back to all', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setState({ state: 'CA' }), true);
    assert.equal(radioLayer.getUIState().state, '\u0000');
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), []);
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), []);
    assert.equal(radioLayer.getUIState().filteredCount, 0);
    assert.equal(radioLayer.getUIState().stationCount, rows.length);
  } finally {
    session.restore();
  }
});

test('playing a Bavaria station stays when the field is CA', async () => {
  const rows = [DIRECTORY[0], DIRECTORY[2], DIRECTORY[4]].map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000002${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[2].id, { autoplay: false, focus: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[2].id);
    const srcBefore = session.audioInstances.at(-1).src;

    assert.equal(radioLayer.setState('CA'), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[2].id);
    assert.equal(session.audioInstances.at(-1).src, srcBefore);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[2].id),
      'playing station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[2].id),
      false,
      'prev/next must not keep walking the out-of-state station',
    );
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, English-only, and country still AND with state', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[3].id), true);
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.setCodecs({ mp3: true, aac: true }), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(radioLayer.setCountry('US'), true);
    assert.equal(radioLayer.setState('CA'), true);
    const englishAndUsAndCa = radioLayer.getTunerStations().filter((station) => isEnglishRadioStation(station));
    assert.deepEqual(englishAndUsAndCa.map((station) => station.id), [rows[0].id]);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing the state field re-applies the cached directory without another /api/radio fetch', async () => {
  const rows = [makeStation({
    ...DIRECTORY[0],
    id: '00000000-0000-4000-8000-000000000041',
  })];
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    const afterLoad = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.ok(afterLoad >= 1);
    assert.equal(radioLayer.setState('CA'), true);
    assert.equal(radioLayer.setState(''), true);
    assert.equal(radioLayer.setState('Bavaria'), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('refresh keeps the state field on the already-fetched roster', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000005${index + 1}`,
    lat: 30 + index,
  }));
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    assert.equal(radioLayer.setState('CA'), true);
    const afterSet = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    await radioLayer.update();
    assert.equal(radioLayer.getUIState().state, 'CA');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.ok(fetchCalls.filter((url) => url.startsWith('/api/radio')).length > afterSet);
  } finally {
    session.restore();
  }
});

test('Radio layer off hides the field and refuses edits without clearing it', async () => {
  const rows = [makeStation({
    ...DIRECTORY[0],
    id: '00000000-0000-4000-8000-000000000061',
  })];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setState('CA'), true);
    radioLayer.disable();
    assert.equal(radioLayer.getUIState().enabled, false);
    assert.equal(radioLayer.getUIState().state, 'CA');
    assert.equal(radioLayer.setState('Texas'), false);
    assert.equal(radioLayer.getUIState().state, 'CA');
    radioLayer.enable();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled',
      enabled: true,
      uncertain: false,
    });
    assert.equal(radioLayer.getUIState().state, 'CA');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
  } finally {
    session.restore();
  }
});

test('state persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_STATE_STORAGE_KEY, 'meridian.radioState');
  const storage = memoryStorage();
  assert.equal(readRadioState(storage), '');
  assert.equal(writeRadioState('CA', storage), 'CA');
  assert.equal(readRadioState(storage), 'CA');
  assert.equal(writeRadioState({ state: 'CA' }, storage), '\u0000');
  assert.equal(readRadioState(storage), '\u0000');

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/state.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioStateFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/state/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioStateFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
