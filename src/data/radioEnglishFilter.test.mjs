import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_ENGLISH_ONLY,
  RADIO_ENGLISH_ONLY_STORAGE_KEY,
  filterRadioStationsByEnglish,
  isEnglishRadioStation,
  normalizeRadioEnglishOnly,
  readRadioEnglishOnly,
  stationMatchesRadioEnglishFilter,
  writeRadioEnglishOnly,
} from './radioEnglishFilter.js';
import { radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'en-news',
    name: 'Primary News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['English'],
  },
  {
    id: 'es-jazz',
    name: 'Campus Jazz',
    tags: ['jazz'],
    country: 'Mexico',
    countryCode: 'MX',
    bitrate: 96,
    codec: 'AAC',
    languages: ['Spanish'],
  },
  {
    id: 'eng-news',
    name: 'Primary HE News',
    tags: ['news'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 192,
    codec: 'HE-AAC',
    languages: ['eng'],
  },
  {
    id: 'fr-talk',
    name: 'Talk Plus',
    tags: ['talk'],
    country: 'Canada',
    countryCode: 'CA',
    bitrate: 64,
    codec: 'AAC+',
    languages: ['French'],
  },
  {
    id: 'en-code',
    name: 'Mystery News',
    tags: ['news'],
    country: 'United States',
    countryCode: 'US',
    bitrate: 128,
    codec: 'MP3',
    languages: ['en'],
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
        catalogInstance: 'qa-radio-english',
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

test('English-only defaults off and matches the current directory', () => {
  assert.equal(DEFAULT_RADIO_ENGLISH_ONLY, false);
  assert.equal(normalizeRadioEnglishOnly(null), false);
  assert.equal(normalizeRadioEnglishOnly(false), false);
  assert.equal(normalizeRadioEnglishOnly(true), true);
  assert.deepEqual(
    filterRadioStationsByEnglish(DIRECTORY, false).map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
});

test('English-only keeps en/eng/english and hides other languages', () => {
  assert.equal(isEnglishRadioStation(DIRECTORY[0]), true);
  assert.equal(isEnglishRadioStation(DIRECTORY[1]), false);
  assert.equal(isEnglishRadioStation(DIRECTORY[2]), true);
  assert.equal(isEnglishRadioStation(DIRECTORY[3]), false);
  assert.equal(isEnglishRadioStation(DIRECTORY[4]), true);
  assert.equal(isEnglishRadioStation({ languages: ['english (us)'] }), true);
  assert.equal(isEnglishRadioStation({ languages: ['american english'] }), true);
  assert.equal(isEnglishRadioStation({ languages: ['british english'] }), true);
  assert.equal(isEnglishRadioStation({ languages: ['canadian english'] }), true);
  assert.equal(isEnglishRadioStation({ languages: ['spanish'] }), false);
  assert.equal(isEnglishRadioStation({ languages: ['german'] }), false);
  assert.equal(isEnglishRadioStation({ languages: [''] }), false);
  assert.equal(isEnglishRadioStation({ languages: [] }), false);
  assert.deepEqual(
    filterRadioStationsByEnglish(DIRECTORY, true).map((station) => station.id),
    ['en-news', 'eng-news', 'en-code'],
  );
  assert.equal(stationMatchesRadioEnglishFilter(DIRECTORY[1], true), false);
  assert.equal(stationMatchesRadioEnglishFilter(DIRECTORY[0], true), true);
  assert.equal(stationMatchesRadioEnglishFilter(DIRECTORY[1], false), true);
});

const DIALECT_DIRECTORY = Object.freeze([
  {
    id: '87e3c4fa-7037-48a8-b083-3d81e1cea592',
    name: 'KLVZ Legends 810AM/95.3 FM - Denver, CO',
    languages: ['american english'],
  },
  {
    id: 'f4896119-5e73-42be-8c07-bc1e7e79e815',
    name: 'HPR1: Traditional Classic Country',
    languages: ['american english'],
  },
  {
    id: 'es-hide',
    name: 'Spanish Talk',
    languages: ['spanish'],
  },
]);

test('English-only keeps Radio Browser dialect tags such as american english', () => {
  assert.equal(isEnglishRadioStation(DIALECT_DIRECTORY[0]), true);
  assert.equal(isEnglishRadioStation(DIALECT_DIRECTORY[1]), true);
  assert.equal(isEnglishRadioStation(DIALECT_DIRECTORY[2]), false);
  assert.deepEqual(
    filterRadioStationsByEnglish(DIALECT_DIRECTORY, true).map((station) => station.id),
    [
      '87e3c4fa-7037-48a8-b083-3d81e1cea592',
      'f4896119-5e73-42be-8c07-bc1e7e79e815',
    ],
  );
  assert.deepEqual(
    filterRadioStationsByEnglish(DIALECT_DIRECTORY, false).map((station) => station.id),
    DIALECT_DIRECTORY.map((station) => station.id),
  );
});

test('a playing non-English station stays visible when English-only is on but is not walkable', () => {
  const visible = filterRadioStationsByEnglish(DIRECTORY, true, { keepStationId: 'es-jazz' });
  assert.deepEqual(visible.map((station) => station.id), ['en-news', 'es-jazz', 'eng-news', 'en-code']);
  const walkable = filterRadioStationsByEnglish(DIRECTORY, true);
  assert.equal(walkable.some((station) => station.id === 'es-jazz'), false);
});

test('Radio panel exposes an English-only chip next to Favorites', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-english-only"/);
  assert.match(panel[0], /id="radio-favorites-only"/);
  assert.match(panel[0], /id="radio-codec-filter"/);
  assert.ok(
    panel[0].indexOf('id="radio-favorites-only"') < panel[0].indexOf('id="radio-english-only"'),
    'English-only sits next to Favorites on the directory filter row',
  );
  assert.ok(
    panel[0].indexOf('id="radio-english-only"') < panel[0].indexOf('id="radio-station-search"'),
    'English-only stays with directory filters, not after search',
  );
  assert.match(ui, /setEnglishOnly\(!presentation\.englishOnly\)/);
});

test('off matches the live directory; on hides non-English from the list and globe', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.getUIState().englishOnly, false);
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), rows.map((row) => row.id));

    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(radioLayer.getUIState().englishOnly, true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[2].id, rows[4].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[2].id, rows[4].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 3);

    assert.equal(radioLayer.setEnglishOnly(false), true);
    assert.deepEqual(radioLayer.getDirectoryStations().map((station) => station.id), rows.map((row) => row.id));
    assert.equal(radioLayer.getUIState().filteredCount, rows.length);
  } finally {
    session.restore();
  }
});

test('prev/next only walks English stations when the chip is on', async () => {
  const rows = [DIRECTORY[0], DIRECTORY[1], DIRECTORY[2]].map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000001${index + 1}`,
    lat: 30 + index,
    tags: ['news'],
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setEnglishOnly(true), true);
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

test('playing a non-English station then enabling English-only does not cut audio until next or stop', async () => {
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

    assert.equal(radioLayer.setEnglishOnly(true), true);
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
      'prev/next must not keep walking the non-English station',
    );

    assert.equal(radioLayer.cycleStation(1, { autoplay: false, rotate: false }), true);
    assert.notEqual(radioLayer.getUIState().selected?.id, rows[1].id);
    assert.equal(isEnglishRadioStation(radioLayer.getUIState().selected), true);
  } finally {
    session.restore();
  }
});

test('category, search, bitrate, codec, favorites, and state still AND with English-only', async () => {
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
    assert.equal(radioLayer.setState('Texas'), true);
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[2].id],
    );
    assert.equal(radioLayer.getUIState().filteredCount, 1);
  } finally {
    session.restore();
  }
});

test('MP3-only plus English-only still AND', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000004${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setCodecs({ mp3: true, aac: false }), true);
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.deepEqual(
      radioLayer.getDirectoryStations().map((station) => station.id),
      [rows[0].id, rows[4].id],
    );
    assert.deepEqual(
      radioLayer.getTunerStations().map((station) => station.id),
      [rows[0].id, rows[4].id],
    );
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
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(radioLayer.setEnglishOnly(false), true);
    assert.equal(
      fetchCalls.filter((url) => url.startsWith('/api/radio')).length,
      afterLoad,
    );
  } finally {
    session.restore();
  }
});

test('English-only survives reload from meridian.radioEnglishOnly', async () => {
  const rows = DIRECTORY.map((station, index) => makeStation({
    ...station,
    id: `00000000-0000-4000-8000-00000000006${index + 1}`,
    lat: 30 + index,
  }));
  const storage = memoryStorage();
  const session = await loadDirectory(rows, { storage });
  try {
    assert.equal(radioLayer.setEnglishOnly(true), true);
    assert.equal(JSON.parse(storage.snapshot()[RADIO_ENGLISH_ONLY_STORAGE_KEY]), true);
    session.restore();
    const reloaded = await loadDirectory(rows, { storage });
    try {
      assert.equal(radioLayer.getUIState().englishOnly, true);
      assert.deepEqual(
        radioLayer.getDirectoryStations().map((station) => station.id),
        [rows[0].id, rows[2].id, rows[4].id],
      );
    } finally {
      reloaded.restore();
    }
  } finally {
    session.restore();
  }
});

test('English-only persists with existing radio prefs and adds no /api', () => {
  assert.equal(RADIO_ENGLISH_ONLY_STORAGE_KEY, 'meridian.radioEnglishOnly');
  const storage = memoryStorage();
  assert.equal(readRadioEnglishOnly(storage), false);
  assert.equal(writeRadioEnglishOnly(true, storage), true);
  assert.equal(readRadioEnglishOnly(storage), true);

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
  assert.equal(existsSync(path.join(ROOT, 'api/radio/english.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/radio/search.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/radioEnglishFilter.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.doesNotMatch(joined, /\/api\/radio\/english/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
  assert.doesNotMatch(layerState, /englishOnly|radioEnglishOnly/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioEnglishFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
