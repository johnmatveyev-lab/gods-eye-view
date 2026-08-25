import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_FLY_DURATION_S,
  DATACENTER_FLY_HEIGHT_M,
  DATACENTER_LAYER_ID,
  DATACENTER_LIST_CAP,
  bindDatacenterInViewList,
  datacenterDistanceKm,
  datacenterFlyDestination,
  listDatacentersInView,
  pointInViewBounds,
  renderDatacenterInViewList,
  viewFromCamera,
} from './datacenterList.js';
import { DATA_CREDITS } from './dataCredits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const AUSTIN_VIEW = Object.freeze({
  west: -98.0,
  south: 30.1,
  east: -97.5,
  north: 30.5,
  centerLat: 30.2672,
  centerLon: -97.7431,
});

const AUSTIN_DC = Object.freeze({
  id: 'dc-austin',
  label: 'Austin DC',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
});

const LONDON_DC = Object.freeze({
  id: 'dc-london',
  label: 'London DC',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
});

const HIDDEN_AUSTIN = Object.freeze({
  id: 'dc-hidden',
  label: 'Behind globe',
  latitude: 30.28,
  longitude: -97.73,
  visible: false,
});

const INSTALLATION = Object.freeze({
  id: 'inst-1',
  label: 'Mapped site',
  latitude: 30.29,
  longitude: -97.75,
  visible: true,
  layerId: 'military-installations',
});

function fakeNode(tag = 'div') {
  const children = [];
  const listeners = new Map();
  const node = {
    tag,
    type: tag === 'button' ? 'button' : '',
    className: '',
    hidden: false,
    textContent: '',
    dataset: {},
    children,
    ownerDocument: null,
    appendChild(child) {
      children.push(child);
      child.parent = this;
      return child;
    },
    replaceChildren(...next) {
      children.length = 0;
      for (const child of next) this.appendChild(child);
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setAttribute(name, value) {
      if (name === 'role') this.role = value;
    },
    closest(selector) {
      if (selector === '[data-datacenter-id]' && this.dataset.datacenterId) return this;
      return this.parent?.closest?.(selector) || null;
    },
    click(id) {
      const target = id
        ? children.find((child) => child.dataset.datacenterId === id)
        : children[0];
      listeners.get('click')?.({ target });
    },
  };
  return node;
}

function fakeDocument() {
  const doc = {
    createElement(tag) {
      const node = fakeNode(tag);
      node.ownerDocument = doc;
      return node;
    },
  };
  return doc;
}

test('list matches visible in-payload sites in the current view', () => {
  const listed = listDatacentersInView({
    enabled: true,
    records: [AUSTIN_DC, LONDON_DC, HIDDEN_AUSTIN],
    view: AUSTIN_VIEW,
  });
  assert.deepEqual(listed.map((site) => site.id), ['dc-austin']);
  assert.equal(listed[0].latitude, AUSTIN_DC.latitude);
  assert.equal(listed[0].longitude, AUSTIN_DC.longitude);
  assert.equal(listed[0].label, 'Austin DC');
});

test('layer off or empty payload returns an empty list', () => {
  assert.deepEqual(listDatacentersInView({
    enabled: false,
    records: [AUSTIN_DC],
    view: AUSTIN_VIEW,
  }), []);
  assert.deepEqual(listDatacentersInView({
    enabled: true,
    records: [],
    view: AUSTIN_VIEW,
  }), []);
  assert.deepEqual(listDatacentersInView({
    enabled: true,
    records: [LONDON_DC],
    view: AUSTIN_VIEW,
  }), []);
});

test('list caps at 50 nearest in-view sites', () => {
  const records = Array.from({ length: 80 }, (_, index) => ({
    id: `dc-${String(index).padStart(2, '0')}`,
    label: `Site ${index}`,
    latitude: 30.2 + index * 0.001,
    longitude: -97.74,
    visible: true,
  }));
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
  });
  assert.equal(listed.length, DATACENTER_LIST_CAP);
  assert.equal(DATACENTER_LIST_CAP, 50);
  assert.equal(listed[0].id, 'dc-67');
  assert.ok(listed.every((site) => site.distanceKm <= listed.at(-1).distanceKm));
});

test('click fly destination matches the existing stem-click path', () => {
  const destination = datacenterFlyDestination(AUSTIN_DC);
  assert.deepEqual(destination, {
    latitude: 30.27,
    longitude: -97.74,
    height: DATACENTER_FLY_HEIGHT_M,
    duration: DATACENTER_FLY_DURATION_S,
  });
  const localGeojson = src('src/data/localGeojson.js');
  assert.match(localGeojson, /export const LOCAL_FEATURE_FLY_HEIGHT_M = 5000;/);
  assert.match(localGeojson, /export const LOCAL_FEATURE_FLY_DURATION_S = 1\.5;/);
  assert.equal(DATACENTER_FLY_HEIGHT_M, 5000);
  assert.equal(DATACENTER_FLY_DURATION_S, 1.5);
  assert.equal(datacenterFlyDestination({ latitude: NaN, longitude: -97 }), null);
});

test('hosted list click flies to the selected payload coords', () => {
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  const flights = [];
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [AUSTIN_DC, LONDON_DC],
    getView: () => AUSTIN_VIEW,
    flyTo: (site) => {
      flights.push(datacenterFlyDestination(site));
      return true;
    },
  });

  assert.equal(root.hidden, false);
  assert.equal(count.textContent, '1');
  assert.equal(items.children[0].dataset.datacenterId, 'dc-austin');
  items.click('dc-austin');
  assert.deepEqual(flights, [{
    latitude: 30.27,
    longitude: -97.74,
    height: 5000,
    duration: 1.5,
  }]);
  binder.destroy();
});

test('layer-off chrome stays hidden and empty', () => {
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  let enabled = false;
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => enabled,
    getRecords: () => [AUSTIN_DC],
    getView: () => AUSTIN_VIEW,
    flyTo() { throw new Error('must not fly while the layer is off'); },
  });
  assert.equal(root.hidden, true);
  assert.equal(count.textContent, '0');
  assert.equal(items.children[0].className, 'in-view-site-list-empty');
  assert.deepEqual(binder.sites(), []);

  enabled = true;
  binder.refresh();
  assert.equal(root.hidden, false);
  assert.equal(binder.sites()[0].id, 'dc-austin');

  enabled = false;
  binder.refresh();
  assert.equal(root.hidden, true);
  assert.deepEqual(binder.sites(), []);
  binder.destroy();
});

test('installations list stays independent of the datacenter payload', () => {
  const listed = listDatacentersInView({
    enabled: true,
    records: [AUSTIN_DC],
    view: AUSTIN_VIEW,
  });
  assert.equal(listed.some((site) => site.id === INSTALLATION.id), false);

  const mixed = listDatacentersInView({
    enabled: true,
    records: [AUSTIN_DC, INSTALLATION],
    view: AUSTIN_VIEW,
  });
  assert.deepEqual(mixed.map((site) => site.id), ['dc-austin', 'inst-1']);

  const moduleSrc = src('src/data/datacenterList.js');
  const uiSrc = src('src/ui.js');
  assert.doesNotMatch(moduleSrc, /military-installations|militaryInstallations|focusById|getNearby|local-firms|firmsHeatmap/);
  assert.doesNotMatch(moduleSrc, /overpass|\/api\//);
  assert.match(uiSrc, /DATACENTER_LAYER_ID/);
  assert.match(uiSrc, /getListPayload/);
  assert.match(uiSrc, /flyToRecord/);
  const init = uiSrc.match(/_initDatacenterInViewList\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(init, /militaryInstallationsLayer|military-installations|local-firms/);
  assert.match(init, /DATACENTER_LAYER_ID/);
});

test('dateline-wrapping views still include the in-payload site', () => {
  assert.equal(pointInViewBounds(0, 179.5, {
    west: 170, south: -10, east: -170, north: 10,
  }), true);
  assert.equal(pointInViewBounds(0, 0, {
    west: 170, south: -10, east: -170, north: 10,
  }), false);
  assert.ok(datacenterDistanceKm(30.27, -97.74, 30.27, -97.74) < 0.01);
});

test('viewFromCamera prefers the rectangle and falls back to the camera center', () => {
  const rectView = viewFromCamera({
    computeViewRectangle: () => ({
      west: -98 * Math.PI / 180,
      south: 30.1 * Math.PI / 180,
      east: -97.5 * Math.PI / 180,
      north: 30.5 * Math.PI / 180,
    }),
  });
  assert.ok(Math.abs(rectView.west + 98) < 1e-6);
  assert.ok(Math.abs(rectView.centerLat - 30.3) < 1e-6);

  const centerView = viewFromCamera({
    computeViewRectangle: () => null,
    positionCartographic: {
      latitude: 30.2672 * Math.PI / 180,
      longitude: -97.7431 * Math.PI / 180,
    },
  });
  assert.ok(Math.abs(centerView.centerLat - 30.2672) < 1e-6);
  assert.equal(centerView.west, undefined);
  assert.equal(viewFromCamera(null), null);
});

test('empty render writes the empty copy and the count', () => {
  const doc = fakeDocument();
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  renderDatacenterInViewList(items, count, []);
  assert.equal(count.textContent, '0');
  assert.equal(items.children[0].textContent, 'No datacenters in view');
});

test('legal: existing OSM datacenters + MIT credit; no extra /api or person-search', () => {
  const html = src('index.html');
  const moduleSrc = src('src/data/datacenterList.js');
  const uiSrc = src('src/ui.js');
  const license = src('LICENSE');
  const readme = src('README.md');
  const credits = src('src/data/dataCredits.js');

  assert.equal(DATACENTER_LAYER_ID, 'local-datacenters');
  assert.match(html, /id="datacenter-in-view"/);
  assert.match(html, /DATACENTERS IN VIEW/);
  assert.match(html, /© OpenStreetMap contributors/);
  assert.match(src('src/main.js'), /el\.id = 'cesium-credits'/);

  const credit = DATA_CREDITS.find((entry) => entry.key === 'datacenters');
  assert.ok(credit);
  assert.match(credit.html, /OpenStreetMap/);
  assert.match(credit.html, /ODbL 1\.0/);
  assert.match(credits, /© OpenStreetMap contributors/);

  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(readme, /Meridian/);
  assert.match(html, /MIT-licensed God's Eye View project/);
  assert.doesNotMatch(moduleSrc, /quantum-earth|OpenSky|news\.google|telegeography|submarinecablemap/i);
  assert.doesNotMatch(moduleSrc, /person-search|people search|facial/i);
  assert.doesNotMatch(uiSrc, /\/api\/datacenters|\/api\/overpass/);
  assert.doesNotMatch(src('src/data/localLayers.js'), /overpass/);
});
