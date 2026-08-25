import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RADIO_FAVORITES_CAP,
  RADIO_FAVORITES_STORAGE_KEY,
  addRadioFavorite,
  filterRadioStationsByFavorites,
  isRadioFavorite,
  normalizeRadioFavoriteId,
  readRadioFavoriteIds,
  sanitizeRadioFavoriteIds,
  stationMatchesRadioFavorites,
  toggleRadioFavoriteId,
  writeRadioFavoriteIds,
} from './radioFavorites.js';
import { radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'fav-news',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
  },
  {
    id: 'fav-jazz',
    name: 'Primary Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 192,
  },
  {
    id: 'skip-talk',
    name: 'Campus Talk',
    tags: ['talk'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 96,
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
        catalogInstance: 'qa-radio-favorites',
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

test('favorites persist as meridian.radioFavorites and cap at 20', () => {
  assert.equal(RADIO_FAVORITES_STORAGE_KEY, 'meridian.radioFavorites');
  assert.equal(RADIO_FAVORITES_CAP, 20);
  assert.equal(normalizeRadioFavoriteId('  abc  '), 'abc');
  assert.equal(normalizeRadioFavoriteId(''), '');
  assert.deepEqual(sanitizeRadioFavoriteIds(['a', 'a', 'b', '']), ['a', 'b']);

  const storage = memoryStorage();
  assert.deepEqual(readRadioFavoriteIds(storage), []);
  assert.deepEqual(writeRadioFavoriteIds(['fav-news', 'fav-jazz'], storage), ['fav-news', 'fav-jazz']);
  assert.deepEqual(JSON.parse(storage.snapshot()[RADIO_FAVORITES_STORAGE_KEY]), ['fav-news', 'fav-jazz']);
  assert.deepEqual(readRadioFavoriteIds(storage), ['fav-news', 'fav-jazz']);

  let list = [];
  for (let index = 0; index < RADIO_FAVORITES_CAP; index += 1) {
    const result = addRadioFavorite(list, `id-${index}`);
    assert.equal(result.ok, true);
    list = result.list;
  }
  const twentyFirst = addRadioFavorite(list, 'overflow');
  assert.equal(twentyFirst.ok, false);
  assert.equal(twentyFirst.reason, 'full');
  assert.equal(twentyFirst.list.length, 20);
  assert.equal(twentyFirst.list.includes('overflow'), false);
});

test('Favorites-only keeps starred stations; off matches the current list', () => {
  assert.deepEqual(
    filterRadioStationsByFavorites(DIRECTORY, ['fav-news', 'fav-jazz'], { favoritesOnly: true })
      .map((station) => station.id),
    ['fav-news', 'fav-jazz'],
  );
  assert.deepEqual(
    filterRadioStationsByFavorites(DIRECTORY, ['fav-news'], { favoritesOnly: false })
      .map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.equal(stationMatchesRadioFavorites(DIRECTORY[2], ['fav-news'], { favoritesOnly: true }), false);
  assert.equal(isRadioFavorite('fav-news', ['fav-news']), true);
  const unstarred = toggleRadioFavoriteId(['fav-news'], 'fav-news');
  assert.equal(unstarred.favorited, false);
  assert.deepEqual(unstarred.list, []);
});

test('genre and search still AND with Favorites-only', () => {
  const news = DIRECTORY.filter((station) => station.tags.includes('news'));
  const favored = filterRadioStationsByFavorites(news, ['fav-news', 'skip-talk'], { favoritesOnly: true });
  const searched = favored.filter((station) => station.name.toLowerCase().includes('primary'));
  assert.deepEqual(searched.map((station) => station.id), ['fav-news']);
});

test('Radio panel exposes a Favorite toggle and a Favorites-only chip on the filter row', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-favorites-only"/);
  assert.match(panel[0], /id="radio-favorite-btn"/);
  assert.match(panel[0], /id="radio-bitrate-floor"/);
  assert.match(panel[0], /id="radio-station-search"/);
  assert.ok(
    panel[0].indexOf('id="radio-bitrate-floor"') < panel[0].indexOf('id="radio-favorites-only"'),
    'Favorites chip sits on the directory filter row after bitrate',
  );
  assert.ok(
    panel[0].indexOf('id="radio-favorites-only"') < panel[0].indexOf('id="radio-station-search"'),
    'Favorites chip stays with directory filters, not after search',
  );
  assert.ok(
    panel[0].indexOf('id="radio-favorite-btn"') < panel[0].indexOf('id="radio-station-meta"'),
    'star toggle lives on the selected station card',
  );
  assert.match(ui, /setFavoritesOnly\(!presentation\.favoritesOnly\)/);
  assert.match(ui, /toggleFavorite\(presentation\.selected\?\.id\)/);
});

test('starring a station survives reload from meridian.radioFavorites', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.getUIState().selectedFavorite, true);
    assert.deepEqual(radioLayer.getUIState().favoriteIds, [rows[0].id]);
    assert.deepEqual(JSON.parse(storage.snapshot()[RADIO_FAVORITES_STORAGE_KEY]), [rows[0].id]);

    session.restore();
    const reloaded = await loadDirectory(rows, { storage });
    try {
      assert.deepEqual(radioLayer.getUIState().favoriteIds, [rows[0].id]);
      assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
      assert.equal(radioLayer.getUIState().selectedFavorite, true);
    } finally {
      reloaded.restore();
    }
  } finally {
    session.restore();
  }
});

test('Favorites-only prev/next only walks starred stations still in the cached directory', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[1].id), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[1].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[1].id],
    );
    assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[0].id);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[2].id);
  } finally {
    session.restore();
  }
});

test('unstarring removes the pin from the list and from storage', async () => {
  const rows = [makeStation({
    ...DIRECTORY[0],
    id: '00000000-0000-4000-8000-000000000021',
  })];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.getUIState().selectedFavorite, false);
    assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.getUIState().selectedFavorite, true);
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.getUIState().selectedFavorite, false);
    assert.deepEqual(radioLayer.getUIState().favoriteIds, []);
    assert.deepEqual(JSON.parse(storage.snapshot()[RADIO_FAVORITES_STORAGE_KEY] || '[]'), []);
  } finally {
    session.restore();
  }
});

test('empty favorites + chip on empties the list without cutting audio until next or stop', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.selectStation(rows[0].id, { autoplay: false, focus: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    const srcBefore = session.audioInstances.at(-1).src;

    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.getUIState().favoritesOnly, true);
    assert.deepEqual(radioLayer.getDirectoryStations(), []);
    assert.deepEqual(radioLayer.getTunerStations(), []);
    assert.equal(radioLayer.getUIState().filteredCount, 0);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[0].id);
    assert.equal(session.audioInstances.at(-1).src, srcBefore);

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), false);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.equal(radioLayer.getUIState().playingStationId, rows[0].id);
  } finally {
    session.restore();
  }
});

test('genre and search still AND with the live Favorites-only chip', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000004${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[1].id), true);
    assert.equal(radioLayer.setFilter('news'), true);
    assert.equal(radioLayer.setStationSearch('primary'), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing Favorites-only re-applies the in-memory directory without another /api/radio fetch', async () => {
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
    assert.equal(radioLayer.toggleFavorite(rows[0].id), true);
    assert.equal(radioLayer.setFavoritesOnly(true), true);
    assert.equal(radioLayer.setFavoritesOnly(false), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('favorites stay client-only: no share-option, no /api, no Radio Browser query', () => {
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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/favorites.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioFavorites.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/favorites/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /favoritesOnly|radioFavorites/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioFavorites.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
