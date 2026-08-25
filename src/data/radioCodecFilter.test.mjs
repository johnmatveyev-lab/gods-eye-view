import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_CODEC_FILTER,
  RADIO_CODEC_STORAGE_KEY,
  filterRadioStationsByCodec,
  normalizeRadioCodecFilter,
  radioCodecFamily,
  readRadioCodecFilter,
  stationMatchesRadioCodecFilter,
  writeRadioCodecFilter,
} from './radioCodecFilter.js';
import { radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'mp3-news',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
  },
  {
    id: 'aac-jazz',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 96,
    codec: 'AAC',
  },
  {
    id: 'he-aac-news',
    name: 'Primary HE News',
    tags: ['news'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 192,
    codec: 'HE-AAC',
  },
  {
    id: 'aac-plus-talk',
    name: 'Talk Plus',
    tags: ['talk'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 64,
    codec: 'AAC+',
  },
  {
    id: 'unknown-null',
    name: 'Mystery News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 128,
    codec: null,
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
        catalogInstance: 'qa-radio-codec',
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

test('both codec chips default on and match the current directory', () => {
  assert.deepEqual(DEFAULT_RADIO_CODEC_FILTER, { mp3: true, aac: true });
  assert.deepEqual(normalizeRadioCodecFilter(null), { mp3: true, aac: true });
  assert.deepEqual(normalizeRadioCodecFilter('all'), { mp3: true, aac: true });
  assert.deepEqual(normalizeRadioCodecFilter({ mp3: false }), { mp3: false, aac: true });
  assert.deepEqual(normalizeRadioCodecFilter({ aac: false }), { mp3: true, aac: false });
  assert.deepEqual(
    filterRadioStationsByCodec(DIRECTORY, { mp3: true, aac: true }).map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
});

test('MP3-only hides AAC family; AAC-only hides MP3; unknown stays visible', () => {
  assert.equal(radioCodecFamily('MP3'), 'mp3');
  assert.equal(radioCodecFamily('AAC'), 'aac');
  assert.equal(radioCodecFamily('AAC+'), 'aac');
  assert.equal(radioCodecFamily('AAC-LC'), 'aac');
  assert.equal(radioCodecFamily('HE-AAC'), 'aac');
  assert.equal(radioCodecFamily(null), null);
  assert.deepEqual(
    filterRadioStationsByCodec(DIRECTORY, { mp3: true, aac: false }).map((station) => station.id),
    ['mp3-news', 'unknown-null'],
  );
  assert.deepEqual(
    filterRadioStationsByCodec(DIRECTORY, { mp3: false, aac: true }).map((station) => station.id),
    ['aac-jazz', 'he-aac-news', 'aac-plus-talk', 'unknown-null'],
  );
  assert.equal(stationMatchesRadioCodecFilter(DIRECTORY[0], { mp3: false, aac: true }), false);
  assert.equal(stationMatchesRadioCodecFilter(DIRECTORY[1], { mp3: false, aac: true }), true);
  assert.equal(stationMatchesRadioCodecFilter(DIRECTORY[4], { mp3: false, aac: false }), true);
});

test('a playing AAC station stays visible when AAC is unchecked but is not walkable', () => {
  const visible = filterRadioStationsByCodec(DIRECTORY, { mp3: true, aac: false }, {
    keepStationId: 'aac-jazz',
  });
  assert.deepEqual(visible.map((station) => station.id), ['mp3-news', 'aac-jazz', 'unknown-null']);
  const walkable = filterRadioStationsByCodec(DIRECTORY, { mp3: true, aac: false });
  assert.equal(walkable.some((station) => station.id === 'aac-jazz'), false);
});

test('Radio panel exposes MP3 | AAC chips next to bitrate', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-codec-filter"/);
  assert.match(panel[0], /data-radio-codec="mp3"[^>]*>MP3</);
  assert.match(panel[0], /data-radio-codec="aac"[^>]*>AAC</);
  assert.match(panel[0], /id="radio-bitrate-floor"/);
  assert.match(panel[0], /id="radio-favorites-only"/);
  assert.ok(
    panel[0].indexOf('id="radio-bitrate-floor"') < panel[0].indexOf('id="radio-codec-filter"'),
    'codec chips sit next to bitrate on the directory filter row',
  );
  assert.ok(
    panel[0].indexOf('id="radio-codec-filter"') < panel[0].indexOf('id="radio-favorites-only"'),
    'codec chips stay with bitrate and Favorites, not after search',
  );
  assert.ok(
    panel[0].indexOf('id="radio-codec-filter"') < panel[0].indexOf('id="radio-station-search"'),
    'codec chips stay with directory filters, not after search',
  );
  assert.match(ui, /data-radio-codec/);
  assert.match(ui, /setCodecs\(/);
});

test('MP3-only hides AAC stations from the list and globe; both on matches current', async () => {
  const rows = DIRECTORY.filter((station) => station.codec).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.deepEqual(radioLayer.getUIState().codecs, { mp3: true, aac: true });
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));

    assert.equal(radioLayer.setCodecs({ aac: false }), true);
    assert.deepEqual(radioLayer.getUIState().codecs, { mp3: true, aac: false });
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);

    assert.equal(radioLayer.setCodecs({ mp3: true, aac: true }), true);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
  } finally {
    session.restore();
  }
});

test('AAC-only hides MP3 stations from the list and globe', async () => {
  const rows = DIRECTORY.filter((station) => station.codec).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setCodecs({ mp3: false, aac: true }), true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[1].id, rows[2].id, rows[3].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[1].id, rows[2].id, rows[3].id],
    );
    assert.equal(radioLayer.getDirectoryStations().some((station) => station.codec === 'MP3'), false);
  } finally {
    session.restore();
  }
});

test('prev/next only walks the codec-filtered set', async () => {
  const rows = [DIRECTORY[0], DIRECTORY[1], DIRECTORY[2]].map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000002${index + 1}`,
    lat: 30 + index,
    tags: ['news'],
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setCodecs({ mp3: false, aac: true }), true);
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

test('playing AAC then unchecking AAC does not cut audio until next or stop', async () => {
  const rows = DIRECTORY.filter((station) => station.codec).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000003${index + 1}`,
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

    assert.equal(radioLayer.setCodecs({ aac: false }), true);
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
      'prev/next must not keep walking the hidden-codec station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    const walked = radioLayer.getUIState().selected;
    assert.ok(walked?.codec == null || radioCodecFamily(walked.codec) !== 'aac');
  } finally {
    session.restore();
  }
});

test('favorites, search, and min-bitrate still AND with codec chips', async () => {
  const rows = DIRECTORY.filter((station) => station.codec).map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000004${index + 1}`,
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
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('changing a codec chip re-applies the in-memory directory without another /api/radio fetch', async () => {
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
    assert.equal(radioLayer.setCodecs({ aac: false }), true);
    assert.equal(radioLayer.setCodecs({ mp3: true, aac: true }), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('codec chips persist locally and add no /api', () => {
  assert.equal(RADIO_CODEC_STORAGE_KEY, 'meridian.radioCodecs');
  const storage = memoryStorage();
  assert.deepEqual(readRadioCodecFilter(storage), { mp3: true, aac: true });
  assert.deepEqual(writeRadioCodecFilter({ aac: false }, storage), { mp3: true, aac: false });
  assert.deepEqual(readRadioCodecFilter(storage), { mp3: true, aac: false });

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/codec.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioCodecFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/codec/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /codecMp3|codecAac|radioCodecs|codecs:/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioCodecFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
