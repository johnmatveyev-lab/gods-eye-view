import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EARTHQUAKE_LIST_LIMIT,
  EARTHQUAKE_LIST_SOURCE,
  EARTHQUAKE_LIST_UNAVAILABLE,
  earthquakeDistanceKm,
  earthquakeListFlyOptions,
  formatEarthquakeListRow,
  handleEarthquakeListClick,
  initEarthquakeListControl,
  presentEarthquakeList,
  renderEarthquakeList,
  selectEarthquakeListRows,
} from './earthquakeList.js';
import { createEarthquakesLayer } from './earthquakes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const ROOT_FILE = (name) => readFileSync(path.join(ROOT, name), 'utf8');

const ANCHORAGE = {
  id: 'us7000abcd',
  magnitude: 5.2,
  place: '42 km SW of Anchorage, Alaska',
  timeMs: 1_753_600_200_000,
  lat: 61.02,
  lon: -150.41,
};

const TOKYO = {
  id: 'us7000efgh',
  mag: 3.1,
  place: '12 km E of Yokohama, Japan',
  time: 1_753_600_100_000,
  lat: 35.44,
  lon: 139.64,
};

const RIDGECREST = {
  id: 'ci12345678',
  magnitude: 4.4,
  place: '10 km W of Ridgecrest, CA',
  timeMs: 1_753_600_000_000,
  lat: 35.62,
  lon: -117.67,
};

function makeNode(tagName = 'div') {
  const node = {
    tagName,
    type: '',
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeEventListener(type) { delete this.listeners[type]; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    click() { this.listeners.click?.({ preventDefault() {} }); },
  };
  return node;
}

test('list rows come from current USGS quake data: mag + place, cap 50 most recent', () => {
  const extra = Array.from({ length: 60 }, (_, index) => ({
    id: `us-extra-${String(index).padStart(2, '0')}`,
    magnitude: 2.6,
    place: `Event ${index}`,
    timeMs: 1_753_500_000_000 + index,
    lat: 10 + (index * 0.1),
    lon: -120,
  }));
  const rows = selectEarthquakeListRows([ANCHORAGE, TOKYO, ...extra, RIDGECREST]);
  assert.equal(rows.length, EARTHQUAKE_LIST_LIMIT);
  assert.equal(rows[0].id, 'us7000abcd');
  assert.equal(rows[0].magnitudeLabel, 'M5.2');
  assert.equal(rows[0].place, '42 km SW of Anchorage, Alaska');
  assert.equal(rows[1].id, 'us7000efgh');
  assert.equal(rows[1].magnitudeLabel, 'M3.1');
  assert.ok(rows.every((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon)));
  assert.equal(rows.some((row) => row.id === 'us-extra-00'), false, 'oldest extras fall off the cap');
});

test('nearest origin ranks closer events ahead of a more recent distant one', () => {
  const rows = selectEarthquakeListRows([ANCHORAGE, TOKYO, RIDGECREST], {
    origin: { lat: 34.05, lon: -118.24 },
  });
  assert.equal(rows[0].id, 'ci12345678');
  assert.ok(rows[0].distanceKm < rows[1].distanceKm);
  assert.ok(earthquakeDistanceKm(RIDGECREST, { lat: 34.05, lon: -118.24 }) < 250);
});

test('click flies to the event coordinates from the same row', () => {
  const row = formatEarthquakeListRow(ANCHORAGE);
  const flights = [];
  assert.equal(handleEarthquakeListClick({
    row,
    flyTo: (options) => { flights.push(options); },
  }), true);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].lat, 61.02);
  assert.equal(flights[0].lon, -150.41);
  assert.ok(flights[0].range >= 18000);
  assert.equal(flights[0].pitch, -45);
  assert.deepEqual(earthquakeListFlyOptions({ lat: NaN, lon: 0 }), null);
  assert.equal(handleEarthquakeListClick({ row: { place: 'nowhere' }, flyTo: () => {} }), false);
});

test('failed or empty feed presents UNAVAILABLE immediately — never a hang', () => {
  const started = Date.now();
  const failed = presentEarthquakeList({
    records: [ANCHORAGE],
    error: 'USGS HTTP 503',
  });
  const empty = presentEarthquakeList({ records: [] });
  const pending = presentEarthquakeList({});
  assert.ok(Date.now() - started < 25, 'presentation is synchronous');
  assert.equal(failed.status, 'unavailable');
  assert.deepEqual(failed.rows, []);
  assert.equal(failed.message, EARTHQUAKE_LIST_UNAVAILABLE);
  assert.equal(failed.source, EARTHQUAKE_LIST_SOURCE);
  assert.equal(empty.status, 'unavailable');
  assert.equal(pending.status, 'unavailable');
  assert.equal(presentEarthquakeList({ records: [{ place: 'no coords' }] }).status, 'unavailable');
});

test('layer getListRecords uses the USGS payload and goes empty on a failed feed', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'us-list-1',
            geometry: { coordinates: [-150.41, 61.02, 41.7] },
            properties: {
              mag: 5.2,
              place: '42 km SW of Anchorage, Alaska',
              time: 1_753_600_000_000,
            },
          },
          {
            id: 'us-micro',
            geometry: { coordinates: [-122.4, 37.8, 8] },
            properties: { mag: 1.8, place: 'skipped micro', time: 1_753_600_100_000 },
          },
        ],
      }),
    });
    assert.equal(await layer.update(viewer), true);
    const rows = layer.getListRecords();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'us-list-1');
    assert.equal(rows[0].magnitude, 5.2);
    assert.equal(rows[0].place, '42 km SW of Anchorage, Alaska');
    assert.equal(rows[0].lat, 61.02);
    assert.equal(rows[0].lon, -150.41);

    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'USGS HTTP 503');
    assert.deepEqual(layer.getListRecords(), [], 'failed feed must empty the list, not keep stale rows');
    assert.ok(dataSources[0].entities.values.length > 0, 'globe discs may retain last-good geometry');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('hosted chrome click flies there and a failed snapshot stays empty', () => {
  const button = makeNode('button');
  const panel = makeNode('aside');
  const list = makeNode('div');
  const count = makeNode('output');
  const flights = [];
  let records = [ANCHORAGE, TOKYO];
  let error = null;
  const control = initEarthquakeListControl({
    button,
    panel,
    list,
    count,
    getRecords: () => records,
    getError: () => error,
    flyTo: (options) => { flights.push(options); },
  });
  assert.equal(control.open, false);
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(control.open, true);
  assert.equal(panel.hidden, false);
  assert.equal(count.textContent, '2');
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children[0].textContent, 'M5.2');
  assert.equal(list.children[0].children[1].textContent, '42 km SW of Anchorage, Alaska');
  list.children[0].click();
  assert.equal(flights[0].lat, 61.02);
  assert.equal(flights[0].lon, -150.41);

  error = 'USGS network error';
  control.refresh();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, EARTHQUAKE_LIST_UNAVAILABLE);
  assert.equal(count.textContent, '—');
  control.destroy();
});

test('list click reports the selected event before flying', () => {
  const list = makeNode('div');
  const selected = [];
  const flights = [];
  const control = initEarthquakeListControl({
    button: makeNode('button'),
    panel: makeNode('aside'),
    list,
    count: makeNode('output'),
    getRecords: () => [ANCHORAGE],
    flyTo: (options) => { flights.push(options); },
    onSelect: (row) => selected.push(row.id),
  });
  control.setOpen(true);
  list.children[0].click();
  assert.deepEqual(selected, ['us7000abcd']);
  assert.equal(flights[0].lat, 61.02);
  control.destroy();
});

test('FIRMS list and launches stay independent of the quake list', () => {
  const quakeList = SRC('data/earthquakeList.js');
  const quakeLayer = SRC('data/earthquakes.js');
  const firmsLayer = SRC('data/firmsHeatmap.js');
  const firmsProxy = SRC('data/firms.js');
  const launches = SRC('data/rocketLaunches.js');
  const launchesPanel = SRC('data/launchesPanel.js');
  assert.doesNotMatch(quakeList, /local-firms|getStrongestFire|\/api\/firms|rocket-launches|news\.google|opensky-network|telegeography|quantum-earth/);
  assert.doesNotMatch(quakeLayer, /\/api\/earthquakes|news\.google|opensky-network/);
  assert.match(quakeLayer, /earthquake\.usgs\.gov/);
  assert.match(firmsLayer, /getStrongestFire/);
  assert.match(firmsLayer, /requestWorldFocus/);
  assert.match(firmsLayer, /\/api\/firms/);
  assert.doesNotMatch(firmsLayer, /earthquakeList|getListRecords|EARTHQUAKE_LIST/);
  assert.doesNotMatch(firmsProxy, /earthquakeList|getListRecords/);
  assert.doesNotMatch(launches, /earthquakeList|getListRecords/);
  assert.doesNotMatch(launchesPanel, /earthquakeList|getListRecords|EARTHQUAKE_LIST/);

  const firmsShaped = [{
    id: 'firms-1',
    frp: 900,
    lat: 30.5,
    lon: -98.2,
    satellite: 'N21',
  }];
  const mixed = presentEarthquakeList({ records: [...firmsShaped, ANCHORAGE] });
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.rows[0].id, 'us7000abcd');
  assert.equal(mixed.rows[0].place.includes('Anchorage'), true);
});

test('legal: USGS credit, Meridian title, MIT notice, no banned sources', () => {
  const html = ROOT_FILE('index.html');
  const license = ROOT_FILE('LICENSE');
  const credits = SRC('data/dataCredits.js');
  const quakeList = SRC('data/earthquakeList.js');
  const ui = SRC('ui.js');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(html, /id="earthquake-list-toggle"/);
  assert.match(html, /id="earthquake-list-panel"/);
  assert.match(html, /id="earthquake-depth-chips"/);
  assert.match(html, /data-earthquake-depth="shallow"/);
  assert.match(html, /id="earthquake-time-chips"/);
  assert.match(html, /data-earthquake-time="1"/);
  assert.match(html, /id="earthquake-tsunami-chips"/);
  assert.match(html, /data-earthquake-tsunami="only"/);
  assert.doesNotMatch(html, /quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(credits, /Data courtesy of the U\.S\. Geological Survey/);
  assert.match(quakeList, /USGS/);
  assert.doesNotMatch(quakeList, /news\.google|opensky-network|telegeography|quantum-earth/);
  assert.match(ui, /initEarthquakeListControl/);
  assert.match(ui, /flyToLandmark/);
  assert.doesNotMatch(ui, /news\.google\.com/);
});

test('renderEarthquakeList writes place as text, not HTML', () => {
  const container = makeNode('div');
  renderEarthquakeList(container, presentEarthquakeList({
    records: [{ ...ANCHORAGE, place: '<script>alert(1)</script> Alaska' }],
  }), { createElement: makeNode });
  assert.equal(container.children[0].children[1].textContent, '<script>alert(1)</script> Alaska');
  assert.equal(container.children[0].innerHTML, undefined);
});
