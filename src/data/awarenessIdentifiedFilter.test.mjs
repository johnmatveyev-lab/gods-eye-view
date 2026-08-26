// PLAN 213 — Context Identified only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_IDENTIFIED_CHIP_ID,
  AWARENESS_IDENTIFIED_CHIP_LABEL,
  AWARENESS_IDENTIFIED_DEFAULT,
  AWARENESS_IDENTIFIED_STORAGE_KEY,
  awarenessIdentifiedChipModel,
  contactHasHumanLabel,
  filterAwarenessIdentifiedContacts,
  getAwarenessIdentifiedEnabled,
  hydrateAwarenessIdentifiedEnabled,
  identityFieldText,
  normalizeAwarenessIdentified,
  passesAwarenessIdentifiedFilter,
  readAwarenessIdentifiedEnabled,
  resetAwarenessIdentifiedForTest,
  setAwarenessIdentifiedEnabled,
  writeAwarenessIdentifiedEnabled,
} from './awarenessIdentifiedFilter.js';
import {
  createDefaultLayerState,
  encodeLayerStateParams,
} from './layerState.js';
import militaryAwarenessLayer, {
  findCompatibleHistoryIndex,
} from './militaryAwareness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const data = (name) => readFileSync(path.join(ROOT, 'src/data', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

const GLOBE_LAYER_FILES = [
  'flights.js',
  'militaryFlights.js',
  'aisLiveVessels.js',
  'militaryInstallations.js',
];

function memoryStorage(initial = {}) {
  const dataMap = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(dataMap, key) ? dataMap[key] : null;
    },
    setItem(key, value) {
      dataMap[key] = String(value);
    },
    snapshot() {
      return { ...dataMap };
    },
  };
}

const HEX_ONLY = Object.freeze({ icao24: 'abc123', callsign: '', registration: null, id: 'abc123' });
const CALLSIGN = Object.freeze({ icao24: 'dal001', callsign: 'DAL123', registration: '', id: 'DAL123' });
const REGISTRATION = Object.freeze({ icao24: 'ga0001', callsign: '', registration: 'N172SP', id: 'N172SP' });
const CIVIL_REG_LABEL = Object.freeze({ icao24: 'a1b2c3', callsign: null, id: 'N172SP' });
const UNNAMED_AIS = Object.freeze({ mmsi: '366123456', name: '' });
const GENERIC_AIS = Object.freeze({ mmsi: '366123456', name: 'VESSEL' });
const MMSI_AIS = Object.freeze({ mmsi: '366123456', name: 'MMSI 366123456' });
const NAMED_AIS = Object.freeze({ mmsi: '366999000', name: 'EVER GIVEN' });
const UNNAMED_SITE = Object.freeze({ id: 'osm:way:1', name: 'Military airfield', hasName: false });
const NAMED_SITE = Object.freeze({ id: 'osm:way:2', name: 'Fort Hood', hasName: true });

test('Identified-only defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(AWARENESS_IDENTIFIED_DEFAULT, false);
  assert.equal(AWARENESS_IDENTIFIED_STORAGE_KEY, 'meridian.awarenessIdentified');
  assert.equal(normalizeAwarenessIdentified(undefined), false);
  assert.equal(normalizeAwarenessIdentified(null), false);
  assert.equal(normalizeAwarenessIdentified('nope'), false);
  assert.equal(normalizeAwarenessIdentified(false), false);
  assert.equal(normalizeAwarenessIdentified(true), true);
  assert.equal(normalizeAwarenessIdentified('1'), true);

  assert.equal(identityFieldText(undefined), '');
  assert.equal(identityFieldText(null), '');
  assert.equal(identityFieldText(''), '');
  assert.equal(identityFieldText('   '), '');
  assert.equal(identityFieldText('DAL123'), 'DAL123');
});

test('Off keeps hex-only / unnamed rows', () => {
  for (const contact of [HEX_ONLY, UNNAMED_AIS, GENERIC_AIS, MMSI_AIS, UNNAMED_SITE]) {
    assert.equal(passesAwarenessIdentifiedFilter(contact, { identifiedOnly: false }), true);
  }
  const kept = filterAwarenessIdentifiedContacts(
    [HEX_ONLY, UNNAMED_AIS, UNNAMED_SITE, CALLSIGN],
    { identifiedOnly: false },
  );
  assert.equal(kept.length, 4);
});

test('On drops hex-only / unnamed AIS / hasName:false sites', () => {
  assert.equal(contactHasHumanLabel(HEX_ONLY), false);
  assert.equal(contactHasHumanLabel(UNNAMED_AIS), false);
  assert.equal(contactHasHumanLabel(GENERIC_AIS), false);
  assert.equal(contactHasHumanLabel(MMSI_AIS), false);
  assert.equal(contactHasHumanLabel(UNNAMED_SITE), false);

  assert.equal(passesAwarenessIdentifiedFilter(HEX_ONLY, { identifiedOnly: true }), false);
  assert.equal(passesAwarenessIdentifiedFilter(UNNAMED_AIS, { identifiedOnly: true }), false);
  assert.equal(passesAwarenessIdentifiedFilter(GENERIC_AIS, { identifiedOnly: true }), false);
  assert.equal(passesAwarenessIdentifiedFilter(UNNAMED_SITE, { identifiedOnly: true }), false);

  const kept = filterAwarenessIdentifiedContacts(
    [HEX_ONLY, UNNAMED_AIS, UNNAMED_SITE, CALLSIGN, NAMED_AIS, NAMED_SITE],
    { identifiedOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.mmsi || row.id), [
    'dal001',
    '366999000',
    'osm:way:2',
  ]);
});

test('On keeps callsign, registration, named vessel, named site', () => {
  assert.equal(passesAwarenessIdentifiedFilter(CALLSIGN, { identifiedOnly: true }), true);
  assert.equal(passesAwarenessIdentifiedFilter(REGISTRATION, { identifiedOnly: true }), true);
  assert.equal(passesAwarenessIdentifiedFilter(CIVIL_REG_LABEL, { identifiedOnly: true }), true);
  assert.equal(passesAwarenessIdentifiedFilter(NAMED_AIS, { identifiedOnly: true }), true);
  assert.equal(passesAwarenessIdentifiedFilter(NAMED_SITE, { identifiedOnly: true }), true);
});

test('Subject id always kept', () => {
  assert.equal(passesAwarenessIdentifiedFilter(HEX_ONLY, {
    identifiedOnly: true,
    subjectId: 'abc123',
  }), true);
  assert.equal(passesAwarenessIdentifiedFilter(HEX_ONLY, {
    identifiedOnly: true,
    subjectId: 'flights:abc123',
  }), true);
  assert.equal(passesAwarenessIdentifiedFilter(UNNAMED_AIS, {
    identifiedOnly: true,
    subjectId: '366123456',
  }), true);
  assert.equal(passesAwarenessIdentifiedFilter(UNNAMED_SITE, {
    identifiedOnly: true,
    subjectId: 'osm:way:1',
  }), true);
  assert.equal(passesAwarenessIdentifiedFilter(HEX_ONLY, {
    identifiedOnly: true,
    subjectId: 'other',
  }), false);
});

test('Invalid storage reads as off', () => {
  assert.equal(readAwarenessIdentifiedEnabled(memoryStorage()), false);
  assert.equal(readAwarenessIdentifiedEnabled(memoryStorage({
    [AWARENESS_IDENTIFIED_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessIdentifiedEnabled(memoryStorage({
    [AWARENESS_IDENTIFIED_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessIdentifiedEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessIdentifiedForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessIdentifiedEnabled(storage), false);
  assert.equal(setAwarenessIdentifiedEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_IDENTIFIED_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessIdentifiedEnabled(storage), true);

  resetAwarenessIdentifiedForTest();
  assert.equal(getAwarenessIdentifiedEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessIdentifiedEnabled(storage), true);
  assert.equal(getAwarenessIdentifiedEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_IDENTIFIED_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessIdentifiedEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_IDENTIFIED_STORAGE_KEY], '0');
  resetAwarenessIdentifiedForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessIdentified/);
  assert.doesNotMatch(encoded, /meridian\.awarenessIdentified/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessIdentified|AWARENESS_IDENTIFIED/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessIdentified|meridian\.awarenessIdentified/);
});

test('AND with aircraft-class / aircraft-only still consults Identified-only', () => {
  resetAwarenessIdentifiedForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /aircraftOnly/);
  assert.match(awareness, /aircraftClassMatchesFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '' },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner' },
    { layerId: 'ais-live-vessels', id: '366999000', name: 'EVER GIVEN' },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    resolveItem: (subject) => subject,
  }), 0, 'off keeps a hex-only aircraft in history');

  setAwarenessIdentifiedEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    resolveItem: (subject) => subject,
  }), 1, 'on skips hex-only and keeps a callsign aircraft');
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    aircraftClass: 'airliner',
    resolveItem: (subject) => subject,
  }), 1, 'AND: class filter still applies after Identified-only');
  resetAwarenessIdentifiedForTest();
});

test('militaryAwareness setParams flips Identified-only without a share token', () => {
  resetAwarenessIdentifiedForTest();
  assert.equal(militaryAwarenessLayer.getParams().identifiedOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ identifiedOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().identifiedOnly, true);
  assert.equal(getAwarenessIdentifiedEnabled(), true);
  militaryAwarenessLayer.setParams({ identifiedOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().identifiedOnly, false);
  resetAwarenessIdentifiedForTest();
});

test('Context panel chip is wired; globe layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessIdentifiedFilter.js');

  assert.match(awareness, /data-awareness-action="identified-only"/);
  assert.match(awareness, /AWARENESS_IDENTIFIED_CHIP_LABEL|Identified only/);
  assert.match(awareness, /setAwarenessIdentifiedEnabled|identifiedOnly/);
  assert.doesNotMatch(ui, /awarenessIdentified|_initAwarenessIdentified/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessIdentified/);

  for (const file of GLOBE_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessIdentified|meridian\.awarenessIdentified/);
    assert.doesNotMatch(source, /AWARENESS_IDENTIFIED/);
  }

  const panelStart = html.indexOf('id="military-awareness-panel"');
  assert.ok(panelStart >= 0);
  const panelHtml = html.slice(panelStart);
  assert.match(panelHtml, /data-awareness-action="identified-only"/);
  assert.match(panelHtml, /Identified only/);
  const chip = awarenessIdentifiedChipModel(false);
  assert.equal(chip.id, AWARENESS_IDENTIFIED_CHIP_ID);
  assert.equal(chip.label, AWARENESS_IDENTIFIED_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { identifiedOnly: true });
  assert.deepEqual(awarenessIdentifiedChipModel(true).params, { identifiedOnly: false });
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessIdentifiedFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /google\.com\/news|telegeography|quantum-earth/i);
});
