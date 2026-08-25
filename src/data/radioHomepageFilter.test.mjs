import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_HIDE_NO_HOMEPAGE,
  RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY,
  filterRadioStationsByHomepage,
  normalizeRadioHideNoHomepage,
  readRadioHideNoHomepage,
  stationHasRadioHomepage,
  stationMatchesRadioHomepageFilter,
  writeRadioHideNoHomepage,
} from './radioHomepageFilter.js';
import { normalizeRadioBrowserStation, radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'home-https',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['English'],
    homepage: 'https://news.example.org/',
    lastCheckOk: true,
    votes: 12,
  },
  {
    id: 'home-null',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 96,
    codec: 'AAC',
    languages: ['Spanish'],
    homepage: null,
    lastCheckOk: true,
    votes: 8,
  },
  {
    id: 'home-empty',
    name: 'Talk Empty',
    tags: ['talk'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 64,
    codec: 'AAC+',
    languages: ['French'],
    homepage: '',
  },
  {
    id: 'home-ws',
    name: 'Whitespace AM',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 192,
    codec: 'HE-AAC',
    languages: ['eng'],
    homepage: '   ',
    lastCheckOk: true,
    votes: 250,
  },
  {
    id: 'home-missing',
    name: 'Mystery News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 128,
    codec: 'MP3',
    languages: ['en'],
    lastCheckOk: true,
    votes: 100,
  },
  {
    id: 'home-https-news',
    name: 'Primary HE News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 192,
    codec: 'HE-AAC',
    languages: ['eng'],
    homepage: 'https://he-news.example.org/',
    lastCheckOk: true,
    votes: 250,
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
    tags: ['news'],
    state: 'Texas',
    country: 'United States',
    countryCode: 'US',
    metadataTrust: 'untrusted-community',
    codec: 'MP3',
    bitrate: 128,
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
        catalogInstance: 'qa-radio-homepage',
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

test('hide-no-homepage defaults off and matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_HIDE_NO_HOMEPAGE, false);
  assert.equal(normalizeRadioHideNoHomepage(null), false);
  assert.equal(normalizeRadioHideNoHomepage(false), false);
  assert.equal(normalizeRadioHideNoHomepage(true), true);
  assert.deepEqual(
    filterRadioStationsByHomepage(DIRECTORY, false).map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
});

test('on hides missing, empty, and whitespace-only homepage stations', () => {
  assert.equal(stationHasRadioHomepage(DIRECTORY[0]), true);
  assert.equal(stationHasRadioHomepage(DIRECTORY[1]), false);
  assert.equal(stationHasRadioHomepage(DIRECTORY[2]), false);
  assert.equal(stationHasRadioHomepage(DIRECTORY[3]), false);
  assert.equal(stationHasRadioHomepage(DIRECTORY[4]), false);
  assert.equal(stationHasRadioHomepage(DIRECTORY[5]), true);
  assert.deepEqual(
    filterRadioStationsByHomepage(DIRECTORY, true).map((station) => station.id),
    ['home-https', 'home-https-news'],
  );
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[1], true), false);
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[2], true), false);
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[3], true), false);
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[4], true), false);
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[0], true), true);
  assert.equal(stationMatchesRadioHomepageFilter(DIRECTORY[1], false), true);
});

test('a playing or selected no-homepage station stays visible when the chip is on but is not walkable', () => {
  const visible = filterRadioStationsByHomepage(DIRECTORY, true, { keepStationId: 'home-null' });
  assert.deepEqual(visible.map((station) => station.id), [
    'home-https', 'home-null', 'home-https-news',
  ]);
  const walkable = filterRadioStationsByHomepage(DIRECTORY, true);
  assert.equal(walkable.some((station) => station.id === 'home-null'), false);
});

test('Radio panel exposes a Hide no homepage chip next to Hide offline', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-hide-no-homepage"/);
  assert.match(panel[0], />Hide no homepage</);
  assert.match(panel[0], /id="radio-hide-offline"/);
  assert.ok(
    panel[0].indexOf('id="radio-hide-offline"') < panel[0].indexOf('id="radio-hide-no-homepage"'),
    'Hide no homepage sits next to Hide offline on the directory filter row',
  );
  assert.ok(
    panel[0].indexOf('id="radio-hide-no-homepage"') < panel[0].indexOf('id="radio-station-search"'),
    'Hide no homepage stays with directory filters, not after search',
  );
  assert.match(ui, /setHideNoHomepage\(!presentation\.hideNoHomepage\)/);
  assert.match(ui, /_radioHideNoHomepageBtn\.hidden = !state\?\.enabled/);
});

test('homepage is kept through Radio Browser normalize', () => {
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
    votes: 17,
  };
  const withHome = normalizeRadioBrowserStation(raw);
  assert.equal(withHome.homepage, 'https://station.example.org/');
  assert.equal(normalizeRadioBrowserStation({ ...raw, homepage: '' }).homepage, null);
  assert.equal(normalizeRadioBrowserStation({ ...raw, homepage: '   ' }).homepage, null);
  assert.equal(normalizeRadioBrowserStation({ ...raw, homepage: null }).homepage, null);
  assert.equal(normalizeRadioBrowserStation({ ...raw, homepage: undefined }).homepage, null);
});

test('off matches the live directory; on hides empty-homepage stations from the list and globe', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
      lastCheckOk: true,
      votes: 12,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Campus Jazz',
      homepage: null,
      codec: 'AAC',
      languages: ['Spanish'],
      lastCheckOk: true,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
      country: 'Canada',
      countryCode: 'CA',
      bitrate: 192,
      codec: 'HE-AAC',
      languages: ['eng'],
      lastCheckOk: true,
      votes: 250,
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().hideNoHomepage, false);
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getDirectoryStations()[0].homepage, 'https://news.example.org/');
    assert.equal(radioLayer.getDirectoryStations()[1].homepage, null);
    assert.equal(radioLayer.getDirectoryStations()[2].homepage, 'https://he-news.example.org/');

    assert.equal(radioLayer.setHideNoHomepage(true), true);
    assert.equal(radioLayer.getUIState().hideNoHomepage, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 2);

    assert.equal(radioLayer.setHideNoHomepage(false), true);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
  } finally {
    session.restore();
  }
});

test('prev/next only walks stations with a homepage when the chip is on', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
      tags: ['news'],
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000012',
      name: 'Campus Jazz',
      homepage: null,
      tags: ['news'],
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000013',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
      tags: ['news'],
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideNoHomepage(true), true);
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

test('playing a no-homepage station then enabling the chip does not cut audio until next or stop', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000021',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000022',
      name: 'Campus Jazz',
      homepage: null,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000023',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[1].id);
    const srcBefore = session.audioInstances.at(-1).src;

    assert.equal(radioLayer.setHideNoHomepage(true), true);
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
      'prev/next must not keep walking the no-homepage station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.ok(stationHasRadioHomepage(radioLayer.getUIState().selected));
  } finally {
    session.restore();
  }
});

test('a selected no-homepage station stays visible when the chip is on', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000071',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000072',
      name: 'Campus Jazz',
      homepage: null,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000073',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.getUIState().audioState, 'stopped');
    assert.equal(radioLayer.setHideNoHomepage(true), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[1].id),
      'selected station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[1].id),
      false,
      'prev/next must not keep walking the selected no-homepage station',
    );
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, English, country, state, hide-offline, and votes still AND', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000031',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
      tags: ['news'],
      lastCheckOk: true,
      votes: 12,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000032',
      name: 'Campus Jazz',
      homepage: null,
      tags: ['jazz'],
      codec: 'AAC',
      languages: ['Spanish'],
      lastCheckOk: true,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000033',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
      tags: ['news'],
      country: 'Canada',
      countryCode: 'CA',
      bitrate: 192,
      codec: 'HE-AAC',
      languages: ['eng'],
      lastCheckOk: true,
      votes: 250,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000034',
      name: 'Primary HE No Home',
      homepage: null,
      tags: ['news'],
      country: 'Canada',
      countryCode: 'CA',
      bitrate: 192,
      codec: 'HE-AAC',
      languages: ['eng'],
      lastCheckOk: true,
      votes: 250,
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[2].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[3].id), true);
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setBitrateFloor('128'), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.setCodecs({ mp3: false, aac: true }), true);
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(radioLayer.setCountry('CA'), true);
    assert.equal(radioLayer.setState('Texas'), true);
    assert.equal(radioLayer.setHideOffline(true), true);
    assert.equal(radioLayer.setVotesFloor('100'), true);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id, rows[3].id],
    );
    assert.equal(radioLayer.setHideNoHomepage(true), true);
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
    id: '00000000-0000-4000-8000-000000000051',
    name: 'Primary News',
    homepage: 'https://news.example.org/',
  })];
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    const afterLoad = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.ok(afterLoad >= 1);
    assert.equal(radioLayer.setHideNoHomepage(true), true);
    assert.equal(radioLayer.setHideNoHomepage(false), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('refresh keeps hide-no-homepage on the already-fetched roster', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000051',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000052',
      name: 'Campus Jazz',
      homepage: null,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000053',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    assert.equal(radioLayer.setHideNoHomepage(true), true);
    const afterSet = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id],
    );
    await radioLayer.update();
    assert.equal(radioLayer.getUIState().hideNoHomepage, true);
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
    id: '00000000-0000-4000-8000-000000000061',
    name: 'Primary News',
    homepage: 'https://news.example.org/',
  })];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideNoHomepage(true), true);
    radioLayer.disable();
    assert.equal(radioLayer.getUIState().enabled, false);
    assert.equal(radioLayer.getUIState().hideNoHomepage, true);
    assert.equal(radioLayer.setHideNoHomepage(false), false);
    assert.equal(radioLayer.getUIState().hideNoHomepage, true);
    radioLayer.enable();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled',
      enabled: true,
      uncertain: false,
    });
    assert.equal(radioLayer.getUIState().hideNoHomepage, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
  } finally {
    session.restore();
  }
});

test('hide-no-homepage survives reload from meridian.radioHideNoHomepage', async () => {
  const rows = [
    makeStation({
      id: '00000000-0000-4000-8000-000000000061',
      name: 'Primary News',
      homepage: 'https://news.example.org/',
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000062',
      name: 'Campus Jazz',
      homepage: null,
    }),
    makeStation({
      id: '00000000-0000-4000-8000-000000000063',
      name: 'Primary HE News',
      homepage: 'https://he-news.example.org/',
    }),
  ].map((station, index) => ({ ...station, lat: 30 + index }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setHideNoHomepage(true), true);
    assert.equal(JSON.parse(storage.snapshot()[RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY]), true);
    session.restore();
    const reloaded = await loadDirectory(rows, { storage });
    try {
      assert.equal(radioLayer.getUIState().hideNoHomepage, true);
      assert.deepEqual(
        radioLayer.getDirectoryStations().map((station) => station.id),
        [rows[0].id, rows[2].id],
      );
    } finally {
      reloaded.restore();
    }
  } finally {
    session.restore();
  }
});

test('hide-no-homepage persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY, 'meridian.radioHideNoHomepage');
  const storage = memoryStorage();
  assert.equal(readRadioHideNoHomepage(storage), false);
  assert.equal(writeRadioHideNoHomepage(true, storage), true);
  assert.equal(readRadioHideNoHomepage(storage), true);

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/homepage.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioHomepageFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/homepage/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /hideNoHomepage|radioHideNoHomepage/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioHomepageFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|TeleGeography/i);
});
