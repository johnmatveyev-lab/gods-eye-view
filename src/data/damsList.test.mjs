import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DAMS_FLY_DURATION_S,
  DAMS_FLY_HEIGHT_M,
  DAMS_LAYER_ID,
  DAMS_LIST_CAP,
  bindDamsInViewList,
  damDistanceKm,
  damFlyDestination,
  listDamsInView,
  pointInViewBounds,
  renderDamsInViewList,
  viewFromCamera,
} from './damsList.js';
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

const MANSFIELD = Object.freeze({
  id: 'dam-mansfield',
  label: 'Mansfield Dam',
  latitude: 30.392,
  longitude: -97.907,
  visible: true,
});

const TOM_MILLER = Object.freeze({
  id: 'dam-miller',
  label: 'Tom Miller Dam',
  latitude: 30.294,
  longitude: -97.786,
  visible: true,
});

const HOOVER = Object.freeze({
  id: 'dam-hoover',
  label: 'Hoover Dam',
  latitude: 36.016,
  longitude: -114.737,
  visible: true,
});

const HIDDEN_AUSTIN = Object.freeze({
  id: 'dam-hidden',
  label: 'Behind globe',
  latitude: 30.28,
  longitude: -97.73,
  visible: false,
});

const DATACENTER = Object.freeze({
  id: 'dc-austin',
  label: 'Austin DC',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  layerId: 'local-datacenters',
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
      if (selector === '[data-dam-id]' && this.dataset.damId) return this;
      return this.parent?.closest?.(selector) || null;
    },
    click(id) {
      const target = id
        ? children.find((child) => child.dataset.damId === id)
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

test('list matches visible in-payload dams in the current view', () => {
  const listed = listDamsInView({
    enabled: true,
    records: [HOOVER, MANSFIELD, HIDDEN_AUSTIN, TOM_MILLER],
    view: AUSTIN_VIEW,
  });
  assert.deepEqual(listed.map((site) => site.id), ['dam-miller', 'dam-mansfield']);
  assert.equal(listed[0].latitude, TOM_MILLER.latitude);
  assert.equal(listed[0].longitude, TOM_MILLER.longitude);
  assert.equal(listed[0].label, 'Tom Miller Dam');
});

test('click fly destination matches the existing stem-click path', () => {
  const destination = damFlyDestination(MANSFIELD);
  assert.deepEqual(destination, {
    latitude: 30.392,
    longitude: -97.907,
    height: DAMS_FLY_HEIGHT_M,
    duration: DAMS_FLY_DURATION_S,
  });
  const localGeojson = src('src/data/localGeojson.js');
  assert.match(localGeojson, /export const LOCAL_FEATURE_FLY_HEIGHT_M = 5000;/);
  assert.match(localGeojson, /export const LOCAL_FEATURE_FLY_DURATION_S = 1\.5;/);

  const flights = [];
  const binder = bindDamsInViewList({
    root: fakeNode('div'),
    items: Object.assign(fakeNode('div'), { ownerDocument: fakeDocument() }),
    getEnabled: () => true,
    getRecords: () => [MANSFIELD],
    getView: () => AUSTIN_VIEW,
    flyTo(site) { flights.push(site); },
  });
  binder.refresh();
  const items = binder.sites();
  assert.equal(items[0].id, 'dam-mansfield');
  const host = fakeNode('div');
  host.ownerDocument = fakeDocument();
  renderDamsInViewList(host, null, items);
  host.click('dam-mansfield');
  // bind click is on the bound items node, not this render host — fly via binder
  const boundItems = fakeNode('div');
  boundItems.ownerDocument = fakeDocument();
  const flown = [];
  const live = bindDamsInViewList({
    root: fakeNode('div'),
    items: boundItems,
    getEnabled: () => true,
    getRecords: () => [MANSFIELD],
    getView: () => AUSTIN_VIEW,
    flyTo(site) { flown.push(damFlyDestination(site)); },
  });
  boundItems.click('dam-mansfield');
  assert.deepEqual(flown[0], destination);
  live.destroy();
  binder.destroy();
});

test('layer off or empty payload returns an empty list', () => {
  assert.deepEqual(listDamsInView({
    enabled: false,
    records: [MANSFIELD],
    view: AUSTIN_VIEW,
  }), []);
  assert.deepEqual(listDamsInView({
    enabled: true,
    records: [],
    view: AUSTIN_VIEW,
  }), []);
  assert.deepEqual(listDamsInView({
    enabled: true,
    records: [HOOVER],
    view: AUSTIN_VIEW,
  }), []);

  let enabled = false;
  const root = fakeNode('section');
  const items = fakeNode('div');
  items.ownerDocument = fakeDocument();
  const count = fakeNode('output');
  const binder = bindDamsInViewList({
    root,
    items,
    count,
    getEnabled: () => enabled,
    getRecords: () => [MANSFIELD],
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
  assert.equal(binder.sites()[0].id, 'dam-mansfield');

  enabled = false;
  binder.refresh();
  assert.equal(root.hidden, true);
  assert.deepEqual(binder.sites(), []);
  binder.destroy();
});

test('datacenter list stays independent of the dams roster', () => {
  const datacenterSites = [DATACENTER];
  const listed = listDamsInView({
    enabled: true,
    records: [MANSFIELD],
    view: AUSTIN_VIEW,
  });
  assert.equal(listed.some((site) => site.id === DATACENTER.id), false);
  assert.deepEqual(datacenterSites, [DATACENTER]);

  const moduleSrc = src('src/data/damsList.js');
  const uiSrc = src('src/ui.js');
  assert.doesNotMatch(moduleSrc, /local-datacenters|datacenterList|bindDatacenterInViewList/);
  assert.doesNotMatch(moduleSrc, /military-installations|militaryInstallations|local-firms/);
  assert.match(uiSrc, /DAMS_LAYER_ID/);
  assert.match(uiSrc, /getListPayload/);
  assert.match(uiSrc, /flyToRecord/);
  const init = uiSrc.match(/_initDamsInViewList\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(init, /DATACENTER_LAYER_ID|bindDatacenterInViewList|local-datacenters/);
  assert.match(init, /DAMS_LAYER_ID/);
});

test('list caps at 50 nearest in-view sites', () => {
  const records = Array.from({ length: 80 }, (_, index) => ({
    id: `dam-${String(index).padStart(2, '0')}`,
    label: `Dam ${index}`,
    latitude: 30.2 + index * 0.001,
    longitude: -97.74,
    visible: true,
  }));
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
  });
  assert.equal(listed.length, DAMS_LIST_CAP);
  assert.equal(DAMS_LIST_CAP, 50);
  assert.ok(listed.every((site) => site.distanceKm <= listed.at(-1).distanceKm));
});

test('dateline-wrapping views still include the in-payload site', () => {
  assert.equal(pointInViewBounds(0, 179.5, {
    west: 170, south: -10, east: -170, north: 10,
  }), true);
  assert.equal(pointInViewBounds(0, 0, {
    west: 170, south: -10, east: -170, north: 10,
  }), false);
  assert.ok(damDistanceKm(30.392, -97.907, 30.392, -97.907) < 0.01);
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
  renderDamsInViewList(items, count, []);
  assert.equal(count.textContent, '0');
  assert.equal(items.children[0].textContent, 'No dams in view');
});

test('legal: existing OSM dams + MIT credit; no extra route or person lookup', () => {
  const html = src('index.html');
  const moduleSrc = src('src/data/damsList.js');
  const uiSrc = src('src/ui.js');
  const license = src('LICENSE');
  const readme = src('README.md');
  const credits = src('src/data/dataCredits.js');
  const changelog = src('CHANGELOG.md');

  assert.equal(DAMS_LAYER_ID, 'local-dams');
  assert.match(html, /id="dams-in-view"/);
  assert.match(html, /DAMS IN VIEW/);
  assert.match(html, /id="datacenter-in-view"/);
  assert.match(html, /© OpenStreetMap contributors/);
  assert.match(changelog, /in-view OSM dams/i);

  const credit = DATA_CREDITS.find((entry) => entry.key === 'dams');
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
  assert.doesNotMatch(uiSrc, /\/api\/dams|\/api\/overpass/);
  assert.doesNotMatch(moduleSrc, /fetch\s*\(/);
});
