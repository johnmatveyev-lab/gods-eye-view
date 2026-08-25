import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeShareViewUrl, encodeShareViewUrl, ShareLinkManager } from './sharelink.js';
import {
  LAST_VIEW_KEY,
  readLastView,
  resolveBootShareHash,
  writeLastView,
} from './lastView.js';

const SHARE_HASH = 'v=2&lat=30.2672&lon=-97.7431&alt=800&heading=12&pitch=-35&style=nvg';
const OTHER_HASH = 'v=2&lat=35.6762&lon=139.6503&alt=1200&heading=0&pitch=-40&style=normal';
const HREF = 'https://meridian.example/';

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function makeManager(hash = '', { storage, camera, lastViewThrottleMs = 0 } = {}) {
  globalThis.window = {
    location: { hash, href: `http://localhost/${hash}` },
    localStorage: storage || memoryStorage(),
  };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const moveEndListeners = [];
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      moveEnd: {
        addEventListener(listener) {
          moveEndListeners.push(listener);
          return () => {
            const index = moveEndListeners.indexOf(listener);
            if (index >= 0) moveEndListeners.splice(index, 1);
          };
        },
      },
      positionCartographic: { latitude: 0.528, longitude: -1.706, height: 800 },
      heading: 0.2,
      pitch: -0.6,
      roll: 0,
      ...camera,
    },
  };
  const manager = new ShareLinkManager(viewer, { storage, lastViewThrottleMs });
  manager._fireMoveEnd = () => {
    for (const listener of [...moveEndListeners]) listener();
  };
  return manager;
}

test('lastView encode/decode uses the same share-URL helper as saved views', () => {
  const encoded = encodeShareViewUrl(HREF, SHARE_HASH);
  assert.equal(encoded, `${HREF}#${SHARE_HASH}`);
  assert.equal(decodeShareViewUrl(encoded), SHARE_HASH);

  const storage = memoryStorage();
  writeLastView(storage, encoded);
  assert.equal(storage.keys().length, 1);
  assert.equal(storage.getItem(LAST_VIEW_KEY), encoded);
  assert.equal(readLastView(storage), encoded);
  assert.equal(decodeShareViewUrl(readLastView(storage)), SHARE_HASH);

  writeLastView(storage, encodeShareViewUrl(HREF, OTHER_HASH));
  assert.equal(storage.keys().length, 1, 'one slot only');
  assert.equal(decodeShareViewUrl(readLastView(storage)), OTHER_HASH);
});

test('a clean boot URL applies lastView; a share link still wins', () => {
  const lastView = encodeShareViewUrl(HREF, SHARE_HASH);
  assert.equal(resolveBootShareHash('', lastView), SHARE_HASH);
  assert.equal(resolveBootShareHash('#', lastView), SHARE_HASH);
  assert.equal(resolveBootShareHash(`#${OTHER_HASH}`, lastView), OTHER_HASH);
  assert.equal(resolveBootShareHash('', ''), '');
  assert.equal(resolveBootShareHash('#welcome=1', lastView), SHARE_HASH);
});

test('moveEnd persists lastView and a clean reload restores that pose', () => {
  const storage = memoryStorage();
  const first = makeManager('', { storage });
  first._fireMoveEnd();
  const persisted = readLastView(storage);
  assert.ok(persisted, 'moveEnd must write meridian.lastView');
  const persistedHash = decodeShareViewUrl(persisted);
  assert.match(persistedHash, /lat=/);
  assert.match(persistedHash, /lon=/);

  const reloaded = makeManager('', { storage });
  const restored = reloaded.parseInitialHash();
  assert.ok(restored, 'clean URL must apply lastView');
  assert.equal(restored.lat.toFixed(4), (0.528 * 180 / Math.PI).toFixed(4));
  assert.equal(restored.lon.toFixed(4), (-1.706 * 180 / Math.PI).toFixed(4));
  assert.equal(restored.alt, 800);
});

test('lastView that includes fires restores fires, not the first-visit flights default', () => {
  const firesHash = `${SHARE_HASH}&l=w`;
  const storage = memoryStorage();
  writeLastView(storage, encodeShareViewUrl(HREF, firesHash));
  const manager = makeManager('', { storage });
  const parsed = manager.parseInitialHash();
  assert.ok(parsed?.layerState, 'clean URL must apply lastView layers');
  assert.deepEqual(parsed.layerState.enabledLayerIds, ['local-firms']);
  assert.equal(parsed.layerState.enabledLayerIds.includes('flights'), false);
});

test('an incoming share link wins over lastView', () => {
  const storage = memoryStorage();
  writeLastView(storage, encodeShareViewUrl(HREF, SHARE_HASH));
  const manager = makeManager(`#${OTHER_HASH}`, { storage });
  const parsed = manager.parseInitialHash();
  assert.equal(parsed.lat, 35.6762);
  assert.equal(parsed.lon, 139.6503);
  assert.notEqual(parsed.lat, 30.2672);
});

test('lastView is a single localStorage slot with no Clerk or API', () => {
  const source = readFileSync(new URL('./lastView.js', import.meta.url), 'utf8');
  assert.match(source, /meridian\.lastView/);
  assert.doesNotMatch(source, /clerk/i);
  assert.doesNotMatch(source, /\/api\//);
  assert.match(source, /encodeShareViewUrl/);
  assert.match(source, /decodeShareViewUrl/);
});
