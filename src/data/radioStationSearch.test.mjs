import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRadioStationSearch,
  filterRadioStationsBySearch,
  normalizeRadioStationSearchQuery,
  renderRadioStationList,
  stationMatchesRadioSearch,
} from './radioStationSearch.js';
import { radioLayer } from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORY = Object.freeze([
  {
    id: 'bbc-radio-1',
    name: 'BBC Radio 1',
    country: 'United Kingdom',
    countryCode: 'GB',
    tags: ['pop', 'top 40'],
  },
  {
    id: 'kutx',
    name: 'KUTX 98.9',
    country: 'United States',
    countryCode: 'US',
    tags: ['indie', 'austin'],
  },
  {
    id: 'npr-news',
    name: 'NPR News',
    country: 'United States',
    countryCode: 'US',
    tags: ['news', 'talk'],
  },
  {
    id: 'radio-nacional',
    name: 'Radio Nacional',
    country: 'Mexico',
    countryCode: 'MX',
    tags: ['news'],
  },
]);

function makeListElement() {
  const element = {
    children: [],
    hidden: false,
    textContent: '',
    className: '',
    dataset: {},
    attributes: {},
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    querySelector(selector) {
      if (selector.startsWith('[data-station-id="')) {
        const id = selector.slice('[data-station-id="'.length, -2);
        return this.children.find((child) => child.dataset?.stationId === id) || null;
      }
      return null;
    },
  };
  return element;
}

test('typing a station name shrinks the current Radio Browser list', () => {
  const named = filterRadioStationsBySearch(DIRECTORY, 'kutx');
  assert.deepEqual(named.map((station) => station.id), ['kutx']);
  assert.equal(named.length < DIRECTORY.length, true);

  const country = filterRadioStationsBySearch(DIRECTORY, 'mexico');
  assert.deepEqual(country.map((station) => station.id), ['radio-nacional']);

  const tag = filterRadioStationsBySearch(DIRECTORY, 'indie');
  assert.deepEqual(tag.map((station) => station.id), ['kutx']);
});

test('clearing search restores the full current list', () => {
  const shrunk = filterRadioStationsBySearch(DIRECTORY, 'news');
  assert.deepEqual(shrunk.map((station) => station.id), ['npr-news', 'radio-nacional']);

  const cleared = filterRadioStationsBySearch(DIRECTORY, '');
  assert.deepEqual(cleared.map((station) => station.id), DIRECTORY.map((station) => station.id));
  assert.equal(cleared.length, DIRECTORY.length);

  assert.deepEqual(
    filterRadioStationsBySearch(DIRECTORY, '   ').map((station) => station.id),
    DIRECTORY.map((station) => station.id),
  );
});

test('search matches name, country, country code, and tags already in the payload', () => {
  assert.equal(normalizeRadioStationSearchQuery('  United-Kingdom  '), 'united kingdom');
  assert.equal(stationMatchesRadioSearch(DIRECTORY[0], 'bbc'), true);
  assert.equal(stationMatchesRadioSearch(DIRECTORY[0], 'GB'), true);
  assert.equal(stationMatchesRadioSearch(DIRECTORY[0], 'top 40'), true);
  assert.equal(stationMatchesRadioSearch(DIRECTORY[0], 'austin'), false);
  assert.equal(stationMatchesRadioSearch(DIRECTORY[1], 'united states'), true);
});

test('list rows hide unmatched stations and return when the query is cleared', () => {
  const list = makeListElement();
  renderRadioStationList(list, DIRECTORY);
  assert.deepEqual(list.children.map((row) => row.dataset.stationId), DIRECTORY.map((station) => station.id));

  applyRadioStationSearch(list, 'npr', DIRECTORY);
  assert.deepEqual(
    list.children.filter((row) => !row.hidden).map((row) => row.dataset.stationId),
    ['npr-news'],
  );

  applyRadioStationSearch(list, '', DIRECTORY);
  assert.equal(list.children.filter((row) => row.hidden).length, 0);
  assert.equal(list.children.length, DIRECTORY.length);
});

test('Radio panel markup searches the station list, not Data Layers', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<section id="radio-panel"[\s\S]*?<\/section>/);
  assert.ok(panel, 'radio-panel markup is missing');
  assert.match(panel[0], /id="radio-station-search"/);
  assert.match(panel[0], /id="radio-station-list"/);
  assert.ok(
    panel[0].indexOf('id="radio-station-search"') < panel[0].indexOf('id="radio-station-list"'),
    'search field must sit above the station list',
  );
  assert.doesNotMatch(panel[0], /id="data-layer-filter"/);
  assert.match(panel[0], /id="radio-play-btn"/);
  assert.match(panel[0], /id="radio-stop-btn"/);
  assert.match(panel[0], /id="radio-volume"/);
});

test('search shrinks the live directory without adding Radio Browser endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const originalAudio = globalThis.Audio;
  const clickUrls = [];
  const stationRows = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Primary station',
      lat: 30,
      lon: -97,
      streamUrl: 'https://radio.example.com/primary.mp3',
      homepage: null,
      tags: ['news'],
      languages: ['English'],
      state: 'Texas',
      country: 'United States',
      countryCode: 'US',
      metadataTrust: 'untrusted-community',
      codec: 'MP3',
      bitrate: 128,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Fallback station',
      lat: 31,
      lon: -98,
      streamUrl: 'https://radio.example.com/fallback.mp3',
      homepage: null,
      tags: ['jazz'],
      languages: ['English'],
      state: 'Texas',
      country: 'United States',
      countryCode: 'US',
      metadataTrust: 'untrusted-community',
      codec: 'MP3',
      bitrate: 128,
    },
  ];
  globalThis.Audio = class {
    constructor() {
      this.src = '';
      this.volume = 1;
      this.listeners = new Map();
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    pause() {}
    play() { return Promise.resolve(); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('/api/radio/click/')) {
      clickUrls.push({ url: String(url), method: options.method || 'GET' });
      return { ok: true };
    }
    return {
      ok: true,
      json: async () => ({
        stations: stationRows,
        updatedAt: new Date().toISOString(),
        stale: false,
        degraded: false,
        acceptedGeneration: 1,
        catalogInstance: 'qa-search',
      }),
    };
  };
  const viewer = {
    camera: { positionWC: { x: 7_000_000, y: 0, z: 0 } },
    scene: { canvas: { disableRootEvents: true, onwheel: null, addEventListener() {}, removeEventListener() {} } },
    dataSources: { add() {}, remove() {} },
    entities: { add(entity) { return entity; }, remove() {} },
  };

  radioLayer.destroy();
  try {
    radioLayer.init(viewer);
    radioLayer.enable();
    await radioLayer.update();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled',
      enabled: true,
      uncertain: false,
    });

    assert.equal(radioLayer.getUIState().filteredCount, 2);
    assert.equal(radioLayer.setStationSearch('fallback'), true);
    assert.equal(radioLayer.getUIState().filteredCount, 1);
    assert.equal(radioLayer.getUIState().stationSearch, 'fallback');
    assert.deepEqual(radioLayer.getTunerStations().map((station) => station.id), [stationRows[1].id]);

    assert.equal(radioLayer.setStationSearch(''), true);
    assert.equal(radioLayer.getUIState().filteredCount, 2);
    assert.equal(radioLayer.getUIState().stationSearch, '');

    assert.equal(radioLayer.selectStation(stationRows[0].id, { autoplay: false }), true);
    assert.equal(await radioLayer.togglePlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'playing');
    assert.deepEqual(clickUrls, [{
      url: `/api/radio/click/${stationRows[0].id}`,
      method: 'POST',
    }]);

    assert.equal(radioLayer.setVolume(0), true);
    assert.equal(radioLayer.getUIState().volume, 0);
    assert.equal(radioLayer.stopPlayback({ origin: 'user' }), true);
    assert.equal(radioLayer.getUIState().audioState, 'stopped');
  } finally {
    radioLayer.destroy();
    globalThis.fetch = originalFetch;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

test('search stays on existing Radio Browser routes and does not add an /api file', () => {
  const apiDir = path.join(ROOT, 'api');
  const radioApi = path.join(apiDir, 'radio', '[...path].js');
  assert.equal(existsSync(radioApi), true, 'existing hosted radio broker must stay');

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

  const helper = readFileSync(path.join(ROOT, 'src/data/radioStationSearch.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const joined = `${helper}\n${radio}\n${ui}`;
  assert.match(radio, /DIRECTORY_ENDPOINT = '\/api\/radio\/stations'/);
  assert.match(radio, /fetch\(`\/api\/radio\/click\/\$\{encodeURIComponent\(id\)\}`/);
  assert.doesNotMatch(joined, /\/api\/radio\/search/);
  assert.doesNotMatch(joined, /radio-browser\.info\/json/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/radioStationSearch.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
