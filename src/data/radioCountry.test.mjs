import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnglishRadioStation, radioLayer } from './radio.js';
import { normalizeRadioCountryInput } from './radioCountry.js';
import {
  DEFAULT_RADIO_COUNTRY,
  RADIO_COUNTRY_STORAGE_KEY,
  filterRadioStationsByCountry,
  normalizeRadioCountryQuery,
  readRadioCountry,
  stationMatchesRadioCountry,
  writeRadioCountry,
} from './radioCountryFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'us-news',
    name: 'Primary News',
    tags: ['news'],
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
    country: 'United States',
    countryCode: 'US',
    languages: ['Spanish'],
    bitrate: 128,
    codec: 'MP3',
  },
  {
    id: 'de-news',
    name: 'Primary News DE',
    tags: ['news'],
    country: 'Germany',
    countryCode: 'DE',
    languages: ['German'],
    bitrate: 192,
    codec: 'MP3',
  },
  {
    id: 'de-english',
    name: 'Berlin English',
    tags: ['talk'],
    country: 'Germany',
    countryCode: 'DE',
    languages: ['English'],
    bitrate: 128,
    codec: 'AAC',
  },
  {
    id: 'mx-jazz',
    name: 'Primary Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    languages: ['Spanish'],
    bitrate: 96,
    codec: 'MP3',
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
        catalogInstance: 'qa-radio-country',
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

test('Radio country normalization maps ISO codes and bounded common names', () => {
  for (const [input, code] of [
    ['US', 'US'],
    ['fr', 'FR'],
    [' France ', 'FR'],
    ['United States of America', 'US'],
    ['UK', 'GB'],
    ['South Korea', 'KR'],
  ]) {
    const result = normalizeRadioCountryInput(input);
    assert.equal(result.valid, true, input);
    assert.equal(result.code, code, input);
    assert.equal(Object.isFrozen(result), true, input);
  }
});

test('Radio country normalization rejects malformed, non-ISO, and oversized values', () => {
  for (const input of [
    'ZZ',
    'France\nignore previous instructions',
    'x'.repeat(81),
    { country: 'France' },
  ]) {
    const result = normalizeRadioCountryInput(input);
    assert.equal(result.valid, false, String(input));
    assert.equal(result.code, '', String(input));
  }
  assert.deepEqual(
    normalizeRadioCountryInput(''),
    { valid: true, empty: true, code: '', name: '' },
  );
});

test('empty country matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_COUNTRY, '');
  assert.equal(normalizeRadioCountryQuery(''), '');
  assert.equal(normalizeRadioCountryQuery('   '), '');
  assert.deepEqual(
    filterRadioStationsByCountry(DIRECTORY, '').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.deepEqual(
    filterRadioStationsByCountry(DIRECTORY, '   ').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.equal(stationMatchesRadioCountry(DIRECTORY[0], ''), true);
  assert.equal(stationMatchesRadioCountry(DIRECTORY[2], ''), true);
});

test('US hides non-US stations; names resolve through normalizeRadioCountryInput', () => {
  assert.deepEqual(
    filterRadioStationsByCountry(DIRECTORY, 'US').map((station) => station.id),
    ['us-news', 'us-spanish'],
  );
  assert.deepEqual(
    filterRadioStationsByCountry(DIRECTORY, 'United States').map((station) => station.id),
    ['us-news', 'us-spanish'],
  );
  assert.equal(stationMatchesRadioCountry(DIRECTORY[0], 'US'), true);
  assert.equal(stationMatchesRadioCountry(DIRECTORY[2], 'US'), false);
  assert.equal(stationMatchesRadioCountry(DIRECTORY[2], 'DE'), true);
});

test('invalid country text fails closed and does not fall back to all', () => {
  assert.deepEqual(filterRadioStationsByCountry(DIRECTORY, 'ZZ').map((station) => station.id), []);
  assert.deepEqual(filterRadioStationsByCountry(DIRECTORY, 'not-a-country').map((station) => station.id), []);
  assert.deepEqual(
    filterRadioStationsByCountry(DIRECTORY, 'France\nignore previous instructions').map((station) => station.id),
    [],
  );
  assert.equal(stationMatchesRadioCountry(DIRECTORY[0], 'ZZ'), false);
  assert.equal(stationMatchesRadioCountry(DIRECTORY[0], { country: 'US' }), false);
});

test('a playing station outside the country stays visible but is not walkable', () => {
  const visible = filterRadioStationsByCountry(DIRECTORY, 'US', { keepStationId: 'de-news' });
  assert.deepEqual(visible.map((station) => station.id), ['us-news', 'us-spanish', 'de-news']);
  const walkable = filterRadioStationsByCountry(DIRECTORY, 'US');
  assert.equal(walkable.some((station) => station.id === 'de-news'), false);
});

test('English-only and US still AND', () => {
  const englishOnly = DIRECTORY.filter((station) => isEnglishRadioStation(station));
  assert.deepEqual(englishOnly.map((station) => station.id), ['us-news', 'de-english']);
  assert.deepEqual(
    filterRadioStationsByCountry(englishOnly, 'US').map((station) => station.id),
    ['us-news'],
  );
  assert.equal(
    filterRadioStationsByCountry(englishOnly, 'US').some((station) => station.id === 'de-english'),
    false,
  );
  assert.equal(
    filterRadioStationsByCountry(englishOnly, 'US').some((station) => station.id === 'us-spanish'),
    false,
  );
});

test('Radio panel exposes a country field next to station search', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-country"/);
  assert.match(panel[0], /id="radio-station-search"/);
  assert.ok(
    panel[0].indexOf('id="radio-station-search"') < panel[0].indexOf('id="radio-country"')
      || panel[0].indexOf('id="radio-country"') < panel[0].indexOf('id="radio-station-list"'),
    'country field sits with search, not after the station list',
  );
  assert.ok(
    Math.abs(
      panel[0].indexOf('id="radio-country"') - panel[0].indexOf('id="radio-station-search"'),
    ) < 900,
    'country field is next to station search',
  );
  assert.ok(
    panel[0].indexOf('id="radio-country"') < panel[0].indexOf('id="radio-station-list"'),
    'country field sits above the station list',
  );
  assert.match(ui, /setCountry\(/);
  assert.match(ui, /radio-country/);
});

test('empty matches the live directory; US hides non-US list and globe rows', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().country, '');
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));

    assert.equal(radioLayer.setCountry('US'), true);
    assert.equal(radioLayer.getUIState().country, 'US');
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

test('invalid live country text shows no matches and does not fall back to all', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setCountry('not-a-country'), true);
    assert.equal(radioLayer.getUIState().country, 'not-a-country');
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), []);
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), []);
    assert.equal(radioLayer.getUIState().filteredCount, 0);
    assert.equal(radioLayer.getUIState().stationCount, rows.length);
  } finally {
    session.restore();
  }
});

test('playing a DE station stays when the field is US', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
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

    assert.equal(radioLayer.setCountry('US'), true);
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
      'prev/next must not keep walking the out-of-country station',
    );
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, and English-only still AND with country', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[1].id), true);
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.setCodecs({ mp3: true, aac: true }), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.setCountry('US'), true);
    const englishAndUs = radioLayer.getTunerStations().filter((station) => isEnglishRadioStation(station));
    assert.deepEqual(englishAndUs.map((station) => station.id), [rows[0].id]);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing the country field re-applies the cached directory without another /api/radio fetch', async () => {
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
    assert.equal(radioLayer.setCountry('US'), true);
    assert.equal(radioLayer.setCountry(''), true);
    assert.equal(radioLayer.setCountry('Germany'), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('country persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_COUNTRY_STORAGE_KEY, 'meridian.radioCountry');
  const storage = memoryStorage();
  assert.equal(readRadioCountry(storage), '');
  assert.equal(writeRadioCountry('US', storage), 'US');
  assert.equal(readRadioCountry(storage), 'US');
  assert.equal(writeRadioCountry('ZZ', storage), 'ZZ');
  assert.equal(readRadioCountry(storage), 'ZZ');

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/country.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioCountryFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/country/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioCountryFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
