import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_VOTES_FLOOR,
  RADIO_VOTES_FLOORS,
  RADIO_VOTES_FLOOR_STORAGE_KEY,
  filterRadioStationsByVotesFloor,
  normalizeRadioVotes,
  normalizeRadioVotesFloor,
  radioVotesFloorMin,
  readRadioVotesFloor,
  stationMatchesRadioVotesFloor,
  stationVotes,
  writeRadioVotesFloor,
} from './radioVotesFilter.js';
import { normalizeRadioBrowserStation, radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'zero',
    name: 'Scratchy AM',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 32,
    codec: 'MP3',
    languages: ['English'],
    votes: 0,
  },
  {
    id: 'low-5',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 96,
    codec: 'AAC',
    languages: ['Spanish'],
    votes: 5,
  },
  {
    id: 'mid-10',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['English'],
    votes: 10,
  },
  {
    id: 'hi-100',
    name: 'Primary Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 192,
    codec: 'AAC',
    languages: ['Spanish'],
    votes: 100,
  },
  {
    id: 'hi-250',
    name: 'Primary HE News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 192,
    codec: 'HE-AAC',
    languages: ['eng'],
    votes: 250,
    lastCheckOk: true,
  },
  {
    id: 'unknown-missing',
    name: 'Mystery News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 128,
    codec: 'MP3',
    languages: ['en'],
    lastCheckOk: true,
  },
  {
    id: 'unknown-nan',
    name: 'Talk Plus',
    tags: ['talk'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 64,
    codec: 'AAC+',
    languages: ['French'],
    votes: Number.NaN,
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
        catalogInstance: 'qa-radio-votes-floor',
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

test('All is the default votes floor and matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_VOTES_FLOOR, 'all');
  assert.deepEqual(RADIO_VOTES_FLOORS.map((floor) => floor.id), ['all', '10', '100']);
  assert.deepEqual(
    filterRadioStationsByVotesFloor(DIRECTORY, 'all').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
  assert.equal(normalizeRadioVotesFloor('10'), '10');
  assert.equal(normalizeRadioVotesFloor('100'), '100');
  assert.equal(normalizeRadioVotesFloor('nope'), null);
  assert.equal(radioVotesFloorMin('all'), 0);
  assert.equal(radioVotesFloorMin('10'), 10);
  assert.equal(radioVotesFloorMin('100'), 100);
});

test('10+ hides finite votes below 10 and keeps missing or non-finite', () => {
  assert.equal(stationVotes(DIRECTORY[0]), 0);
  assert.equal(stationVotes(DIRECTORY[1]), 5);
  assert.equal(stationVotes(DIRECTORY[2]), 10);
  assert.equal(stationVotes(DIRECTORY[5]), null);
  assert.equal(stationVotes(DIRECTORY[6]), null);
  assert.equal(normalizeRadioVotes(0), 0);
  assert.equal(normalizeRadioVotes(12.9), 12);
  assert.equal(normalizeRadioVotes(-3), null);
  assert.equal(normalizeRadioVotes(Number.NaN), null);
  assert.deepEqual(
    filterRadioStationsByVotesFloor(DIRECTORY, '10').map((station) => station.id),
    ['mid-10', 'hi-100', 'hi-250', 'unknown-missing', 'unknown-nan'],
  );
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[0], '10'), false);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[1], '10'), false);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[2], '10'), true);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[5], '10'), true);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[6], '10'), true);
});

test('100+ is stricter than 10+', () => {
  assert.deepEqual(
    filterRadioStationsByVotesFloor(DIRECTORY, '100').map((station) => station.id),
    ['hi-100', 'hi-250', 'unknown-missing', 'unknown-nan'],
  );
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[2], '10'), true);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[2], '100'), false);
  assert.equal(stationMatchesRadioVotesFloor(DIRECTORY[3], '100'), true);
});

test('a playing or selected low-vote station stays visible but is not walkable', () => {
  const visible = filterRadioStationsByVotesFloor(DIRECTORY, '10', { keepStationId: 'low-5' });
  assert.deepEqual(visible.map((station) => station.id), [
    'low-5', 'mid-10', 'hi-100', 'hi-250', 'unknown-missing', 'unknown-nan',
  ]);
  const walkable = filterRadioStationsByVotesFloor(DIRECTORY, '10');
  assert.equal(walkable.some((station) => station.id === 'low-5'), false);
});

test('Radio panel exposes All | 10+ | 100+ chips on the directory filter row', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-votes-floor"/);
  assert.match(panel[0], /data-radio-votes="all"[^>]*>All</);
  assert.match(panel[0], /data-radio-votes="10"[^>]*>10\+</);
  assert.match(panel[0], /data-radio-votes="100"[^>]*>100\+</);
  assert.ok(
    panel[0].indexOf('id="radio-votes-floor"') < panel[0].indexOf('id="radio-station-search"'),
    'votes chips sit with the directory filters, not after search',
  );
  assert.match(panel[0], /id="radio-bitrate-floor"/);
  assert.match(panel[0], /id="radio-hide-offline"/);
  assert.match(ui, /setVotesFloor\(button\.dataset\.radioVotes\)/);
  assert.match(ui, /_radioVotesRow\.hidden = !state\?\.enabled/);
});

test('votes is kept through Radio Browser normalize', () => {
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
  const popular = normalizeRadioBrowserStation(raw);
  assert.equal(popular.votes, 17);
  assert.equal(normalizeRadioBrowserStation({ ...raw, votes: 0 }).votes, 0);
  assert.equal('votes' in normalizeRadioBrowserStation({ ...raw, votes: undefined }), false);
  assert.equal('votes' in normalizeRadioBrowserStation({ ...raw, votes: 'nope' }), false);
  assert.equal('votes' in normalizeRadioBrowserStation({ ...raw, votes: -4 }), false);
});

test('All matches the live directory; 10+ hides low-vote stations from the list and globe', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().minVotes, 'all');
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getDirectoryStations()[0].votes, 0);
    assert.equal(radioLayer.getDirectoryStations()[2].votes, 10);
    assert.equal('votes' in radioLayer.getDirectoryStations()[5], false);

    assert.equal(radioLayer.setVotesFloor('10'), true);
    assert.equal(radioLayer.getUIState().minVotes, '10');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[2].id, rows[3].id, rows[4].id, rows[5].id, rows[6].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id, rows[3].id, rows[4].id, rows[5].id, rows[6].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 5);

    assert.equal(radioLayer.setVotesFloor('100'), true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[3].id, rows[4].id, rows[5].id, rows[6].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 4);
  } finally {
    session.restore();
  }
});

test('prev/next only walks stations at or above the votes floor', async () => {
  const rows = [DIRECTORY[1], DIRECTORY[2], DIRECTORY[4]].map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
    tags: ['news'],
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setVotesFloor('10'), true);
    assert.equal(radioLayer.selectStation(rows[1].id, { autoplay: false, focus: false }), true);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[2].id);
    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[0].id);
  } finally {
    session.restore();
  }
});

test('playing a 5-vote station then setting 10+ does not cut audio until next or stop', async () => {
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

    assert.equal(radioLayer.setVotesFloor('10'), true);
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
      'prev/next must not keep walking the below-floor station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    const selectedVotes = radioLayer.getUIState().selected?.votes;
    assert.ok(selectedVotes == null || Number(selectedVotes) >= 10);
  } finally {
    session.restore();
  }
});

test('a selected low-vote station stays visible when 10+ is on', async () => {
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
    assert.equal(radioLayer.setVotesFloor('10'), true);
    assert.equal(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.ok(
      radioLayer.getDirectoryStations().some((station) => station.id === rows[1].id),
      'selected station stays on the list and globe',
    );
    assert.equal(
      radioLayer.getTunerStations().some((station) => station.id === rows[1].id),
      false,
      'prev/next must not keep walking the selected below-floor station',
    );
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, English, country, state, and hide-offline still AND', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.toggleFavorite(rows[2].id), true);
    assert.equal(radioLayer.toggleFavorite(rows[4].id), true);
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
      [rows[4].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing the chip re-applies the in-memory directory without another /api/radio fetch', async () => {
  const rows = [makeStation({
    ...DIRECTORY[2],
    id: '00000000-0000-4000-8000-000000000051',
  })];
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    const afterLoad = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.ok(afterLoad >= 1);
    assert.equal(radioLayer.setVotesFloor('100'), true);
    assert.equal(radioLayer.setVotesFloor('all'), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('refresh keeps the votes floor on the already-fetched roster', async () => {
  const rows = DIRECTORY.slice(0, 3).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000005${index + 1}`,
    lat: 30 + index,
  }));
  const fetchCalls = [];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { fetchCalls, storage });
  try {
    assert.equal(radioLayer.setVotesFloor('10'), true);
    const afterSet = fetchCalls.filter((url) => url.startsWith('/api/radio')).length;
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[2].id],
    );
    await radioLayer.update();
    assert.equal(radioLayer.getUIState().minVotes, '10');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[2].id],
    );
    assert.ok(fetchCalls.filter((url) => url.startsWith('/api/radio')).length > afterSet);
  } finally {
    session.restore();
  }
});

test('Radio layer off hides the chips and refuses edits without clearing the floor', async () => {
  const rows = [makeStation({
    ...DIRECTORY[2],
    id: '00000000-0000-4000-8000-000000000061',
  })];
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setVotesFloor('10'), true);
    radioLayer.disable();
    assert.equal(radioLayer.getUIState().enabled, false);
    assert.equal(radioLayer.getUIState().minVotes, '10');
    assert.equal(radioLayer.setVotesFloor('all'), false);
    assert.equal(radioLayer.getUIState().minVotes, '10');
    radioLayer.enable();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled',
      enabled: true,
      uncertain: false,
    });
    assert.equal(radioLayer.getUIState().minVotes, '10');
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
  } finally {
    session.restore();
  }
});

test('votes floor survives reload from meridian.radioVotesFloor', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000006${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setVotesFloor('100'), true);
    assert.equal(JSON.parse(storage.snapshot()[RADIO_VOTES_FLOOR_STORAGE_KEY]), '100');
    session.restore();
    const reloaded = await loadDirectory(rows, { storage });
    try {
      assert.equal(radioLayer.getUIState().minVotes, '100');
      assert.deepEqual(
        radioLayer.getDirectoryStations().map((station) => station.id),
        [rows[3].id, rows[4].id, rows[5].id, rows[6].id],
      );
    } finally {
      reloaded.restore();
    }
  } finally {
    session.restore();
  }
});

test('votes floor persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_VOTES_FLOOR_STORAGE_KEY, 'meridian.radioVotesFloor');
  const storage = memoryStorage();
  assert.equal(readRadioVotesFloor(storage), 'all');
  assert.equal(writeRadioVotesFloor('10', storage), '10');
  assert.equal(readRadioVotesFloor(storage), '10');
  assert.equal(writeRadioVotesFloor('nope', storage), 'all');

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/votes.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioVotesFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/votes/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /minVotes|radioVotesFloor/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioVotesFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
