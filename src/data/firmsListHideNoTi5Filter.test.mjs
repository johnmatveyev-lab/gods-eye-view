// PLAN 304 — FIRMS list Hide no TI5 toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_TI5,
  FIRMS_LIST_HIDE_NO_TI5_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY,
  filterFiresByListHideNoTi5,
  fireHasListBrightnessTi5,
  fireMeetsListHideNoTi5,
  firmsListHideNoTi5ChipModel,
  getFirmsListHideNoTi5,
  hydrateFirmsListHideNoTi5,
  normalizeFirmsListHideNoTi5,
  readFirmsListHideNoTi5,
  resetFirmsListHideNoTi5ForTest,
  setFirmsListHideNoTi5,
  writeFirmsListHideNoTi5,
} from './firmsListHideNoTi5Filter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  getRowControls,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { encodeLayerStateParams, normalizeLayerState } from './layerState.js';
import { fireMeetsListHideNoConfidence } from './firmsListHideNoConfidenceFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.UTC(2026, 6, 17, 4, 0);
const ORIGIN = { lat: 30.27, lon: -97.74 };

resetFirmsListHideNoTi5ForTest();

function fire(overrides = {}) {
  return {
    id: 'f',
    lat: 30.27,
    lon: -97.74,
    frp: 120,
    confidence: 0.9,
    brightnessTi5: 310,
    satellite: 'N20',
    acqMs: NOW - 3600000,
    ...overrides,
  };
}

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
  };
}

test('off keeps missing TI5 and on keeps only brightnessTi5 > 0', () => {
  resetFirmsListHideNoTi5ForTest();
  const rows = [
    fire({ id: 'real', brightnessTi5: 305 }),
    fire({ id: 'zero', lat: 30.3, brightnessTi5: 0 }),
    fire({ id: 'missing', lat: 30.4, brightnessTi5: undefined }),
    fire({ id: 'nan', lat: 30.5, brightnessTi5: Number.NaN }),
  ];
  const off = listNearestFires(rows, ORIGIN, 50, 'all', 'all', null, 'all', NOW, false, false, false, false, false, false, false, false, false, false);
  assert.deepEqual(off.map((row) => row.id), ['real', 'zero', 'missing', 'nan']);
  const on = listNearestFires(rows, ORIGIN, 50, 'all', 'all', null, 'all', NOW, false, false, false, false, false, false, false, false, false, true);
  assert.deepEqual(on.map((row) => row.id), ['real']);
  assert.equal(fireHasListBrightnessTi5(fire({ brightnessTi5: 0 })), false);
  assert.equal(fireMeetsListHideNoTi5(fire({ brightnessTi5: 0 }), true), false);
  assert.equal(fireMeetsListHideNoTi5(fire({ id: 'zero', brightnessTi5: 0 }), true, { selectedId: 'zero' }), true);
});

test('selected no-TI5 stays and AND with hide-no-confidence', () => {
  const rows = [
    fire({ id: 'both', brightnessTi5: 300, confidence: 0.8 }),
    fire({ id: 'ti5-only', lat: 31, brightnessTi5: 300, confidence: null }),
    fire({ id: 'conf-only', lat: 32, brightnessTi5: 0, confidence: 0.8 }),
  ];
  const selected = listNearestFires(rows, ORIGIN, 50, 'all', 'all', 'conf-only', 'all', NOW, false, false, false, false, false, false, false, false, false, true);
  assert.ok(selected.some((row) => row.id === 'conf-only'));
  const andBoth = listNearestFires(rows, ORIGIN, 50, 'all', 'all', null, 'all', NOW, false, false, false, false, false, false, false, false, true, true);
  assert.deepEqual(andBoth.map((row) => row.id), ['both']);
  assert.equal(fireMeetsListHideNoConfidence(rows[1], true), false);
});

test('corrupt storage reads off and there is no share-URL write', () => {
  const storage = memoryStorage({ [FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY]: 'maybe' });
  assert.equal(readFirmsListHideNoTi5(storage), false);
  assert.equal(normalizeFirmsListHideNoTi5('nope'), null);
  assert.equal(writeFirmsListHideNoTi5(true, storage), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY), '1');
  resetFirmsListHideNoTi5ForTest();
  assert.equal(hydrateFirmsListHideNoTi5(storage), true);
  assert.equal(getFirmsListHideNoTi5(), true);
  setFirmsListHideNoTi5(false, { persist: false });
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoTi5|meridian\.firmsListHideNoTi5/);
  const chip = firmsListHideNoTi5ChipModel(false);
  assert.equal(chip.label, FIRMS_LIST_HIDE_NO_TI5_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { firmsListHideNoTi5: true });
  assert.equal(getRowControls().listHideNoTi5.label, 'Hide no TI5');
  const view = resolveFireListView({
    fires: [fire()],
    camera: ORIGIN,
    now: NOW,
    listHideNoTi5: false,
  });
  assert.match(view.acknowledgement, /NASA/);
  assert.equal(view.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  const copied = filterFiresByListHideNoTi5([fire({ brightnessTi5: 0 })], false);
  assert.equal(copied.length, 1);
  resetFirmsListHideNoTi5ForTest();
  assert.equal(getFirmsListHideNoTi5(), DEFAULT_FIRMS_LIST_HIDE_NO_TI5);
});

test('chip stays out of index.html, ui.js, style.css, and the globe TI5 filter', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const style = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const globe = readFileSync(path.join(ROOT, 'src/data/firmsHideNoTi5Filter.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.doesNotMatch(html, /firmsListHideNoTi5|data-firms-list-hide-no-ti5/);
  assert.doesNotMatch(ui, /firmsListHideNoTi5|setFirmsListHideNoTi5/);
  assert.doesNotMatch(style, /firmsListHideNoTi5|Hide no TI5/);
  assert.doesNotMatch(globe, /firmsListHideNoTi5|FIRMS_LIST_HIDE_NO_TI5/);
  assert.match(list, /fireMeetsListHideNoTi5|hydrateFirmsListHideNoTi5|listHideNoTi5/);
  assert.match(changelog, /meridian\.firmsListHideNoTi5/);
  assert.match(changelog, /Hide no TI5/);
});
