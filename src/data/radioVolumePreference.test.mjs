import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RADIO_VOLUME_PCT,
  RADIO_VOLUME_STORAGE_KEY,
  clampRadioVolumePct,
  radioMuteToggle,
  radioVolumePctToUnit,
  radioVolumeUnitToPct,
  readRadioVolumePct,
  rememberRadioVolumePrior,
  writeRadioVolumePct,
} from './radioVolumePreference.js';
import {
  getRadioUIState,
  radioLayer,
  setRadioVolume,
  toggleRadioMute,
} from './radio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

function enableRadioForVolume() {
  radioLayer.destroy();
  radioLayer.enable();
  radioLayer.setLifecyclePresentation({
    lifecycleState: 'enabled', enabled: true, uncertain: false,
  });
}

test('slider values are integers 0–100 and persist as meridian.radioVolume', () => {
  assert.equal(RADIO_VOLUME_STORAGE_KEY, 'meridian.radioVolume');
  assert.equal(DEFAULT_RADIO_VOLUME_PCT, 80);
  assert.equal(clampRadioVolumePct(35.4), 35);
  assert.equal(clampRadioVolumePct(-4), 0);
  assert.equal(clampRadioVolumePct(140), 100);
  assert.equal(clampRadioVolumePct('nope'), 80);
  assert.equal(radioVolumePctToUnit(35), 0.35);
  assert.equal(radioVolumeUnitToPct(0.42), 42);

  const storage = memoryStorage();
  assert.equal(readRadioVolumePct(storage), 80, 'absent key is the default 80');
  assert.equal(writeRadioVolumePct(35, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.radioVolume': '35' });
  assert.equal(readRadioVolumePct(storage), 35, 'a later session reads the stored loudness');
});

test('reload keeps the persisted meridian.radioVolume loudness', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = memoryStorage({ 'meridian.radioVolume': '35' });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    enableRadioForVolume();
    radioLayer.init({
      camera: { positionWC: { x: 7_000_000, y: 0, z: 0 } },
      scene: { canvas: { disableRootEvents: true, onwheel: null, addEventListener() {}, removeEventListener() {} } },
      dataSources: { add() {}, remove() {} },
      entities: { add(entity) { return entity; }, remove() {} },
    });
    radioLayer.enable();
    radioLayer.setLifecyclePresentation({
      lifecycleState: 'enabled', enabled: true, uncertain: false,
    });
    assert.equal(getRadioUIState().volume, 0.35);

    assert.equal(setRadioVolume(0.2), true);
    assert.equal(storage.snapshot()['meridian.radioVolume'], '20');
    assert.equal(getRadioUIState().volume, 0.2);

    radioLayer.destroy();
    radioLayer.init({
      camera: { positionWC: { x: 7_000_000, y: 0, z: 0 } },
      scene: { canvas: { disableRootEvents: true, onwheel: null, addEventListener() {}, removeEventListener() {} } },
      dataSources: { add() {}, remove() {} },
      entities: { add(entity) { return entity; }, remove() {} },
    });
    assert.equal(getRadioUIState().volume, 0.2, 're-init hydrates the stored slider level');
  } finally {
    radioLayer.destroy();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});

test('mute sets 0 and unmute restores the prior level', () => {
  assert.deepEqual(radioMuteToggle({ volumePct: 42 }), {
    volumePct: 0, priorPct: 42, muted: true,
  });
  assert.deepEqual(radioMuteToggle({ volumePct: 0, priorPct: 42 }), {
    volumePct: 42, priorPct: 42, muted: false,
  });
  assert.equal(rememberRadioVolumePrior(0, 15), 15);
  assert.equal(rememberRadioVolumePrior(0, 0), 80);

  enableRadioForVolume();
  try {
    assert.equal(setRadioVolume(0.42), true);
    assert.equal(toggleRadioMute(), true);
    let state = getRadioUIState();
    assert.equal(state.volume, 0);
    assert.equal(state.muted, true);
    assert.equal(state.unmutedVolume, 0.42);

    assert.equal(toggleRadioMute(), true);
    state = getRadioUIState();
    assert.equal(state.volume, 0.42);
    assert.equal(state.muted, false);
    assert.equal(state.unmutedVolume, 0.42);
  } finally {
    radioLayer.destroy();
  }
});

test('layer off still stops the existing audio element after a volume mute', async () => {
  const originalAudio = globalThis.Audio;
  const originalFetch = globalThis.fetch;
  const audioInstances = [];
  globalThis.Audio = class FakeAudio {
    constructor() {
      this.volume = 0.8;
      this.muted = false;
      this.src = '';
      this.paused = true;
      this.listeners = new Map();
      audioInstances.push(this);
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  const station = {
    id: '00000000-0000-4000-8000-000000000088',
    name: 'Volume Station',
    lat: 30.2672,
    lon: -97.7431,
    streamUrl: 'https://radio.example.com/volume.mp3',
    homepage: null,
    tags: ['news'],
    languages: ['English'],
    state: 'Texas',
    country: 'United States',
    countryCode: 'US',
    metadataTrust: 'untrusted-community',
    codec: 'MP3',
    bitrate: 128,
  };
  globalThis.fetch = async (url) => String(url).startsWith('/api/radio/click/')
    ? { ok: true }
    : {
      ok: true,
      json: async () => ({
        stations: [station],
        updatedAt: new Date().toISOString(),
        stale: false,
        degraded: false,
        acceptedGeneration: 1,
        catalogInstance: 'qa-volume',
      }),
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
      lifecycleState: 'enabled', enabled: true, uncertain: false,
    });
    assert.equal(radioLayer.selectStation(station.id, { autoplay: false }), true);
    assert.equal(await radioLayer.play({ origin: 'user' }), true);
    const playingAudio = audioInstances.at(-1);
    assert.equal(playingAudio.paused, false);

    assert.equal(radioLayer.toggleMute(), true);
    assert.equal(getRadioUIState().volume, 0);
    assert.equal(playingAudio.paused, false, 'mute changes loudness without tearing down the stream');
    assert.equal(playingAudio.src, station.streamUrl);

    radioLayer.disable();
    assert.equal(getRadioUIState().audioState, 'stopped');
    assert.equal(playingAudio.paused, true);
    assert.equal(playingAudio.muted, true);
    assert.equal(playingAudio.src, '', 'layer off still stops the existing audio element');
  } finally {
    radioLayer.destroy();
    globalThis.fetch = originalFetch;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

test('hosted volume chrome stays on the existing player, search, and F key', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const radio = readFileSync(path.join(ROOT, 'src/data/radio.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const apiDir = path.join(ROOT, 'api');

  assert.match(html, /id="radio-volume"[^>]*type="range"[^>]*min="0"[^>]*max="100"/);
  assert.match(ui, /toggleMute\(\{ origin: 'user' \}\)/);
  assert.match(ui, /e\.key\.toLowerCase\(\) === 'f'[\s\S]*data-panel/);
  assert.doesNotMatch(ui, /e\.key\.toLowerCase\(\) === 'f'[\s\S]*radio-station-search/);
  assert.match(radio, /writeRadioVolumePct\(/);
  assert.match(radio, /toggleRadioMute/);
  assert.doesNotMatch(radio, /setRadioVoiceDucking\(true\).*toggleRadioMute/s);

  assert.match(html, /id="radio-station-search"/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);

  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.equal(files.filter((file) => file.toLowerCase().includes('radio')).length, 1);
  assert.equal(existsSync(path.join(apiDir, 'radio', '[...path].js')), true);
});
