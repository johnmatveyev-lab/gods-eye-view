import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { isSceneClickCaptured } from './data/pickRegistry.js';
import { bindTrackingClickGesture } from './data/trackingClickGesture.js';
import {
  acceptMeasureClick,
  clearMeasure,
  destroyMeasure,
  formatMeasureLabel,
  geodesicLineDegrees,
  geodesicSurfaceDistanceM,
  getMeasureState,
  handleMeasureKeydown,
  initMeasure,
  isMeasureActive,
  pickTerrainPoint,
  resetMeasureForTests,
  setMeasureActive,
} from './measure.js';
import {
  formatDistanceMeters,
  resetDistanceUnitsForTests,
  setDistanceUnit,
} from './units.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const AUSTIN = { lon: -97.7431, lat: 30.2672 };
const HOUSTON = { lon: -95.3698, lat: 29.7604 };
const TYPES = {
  LEFT_DOWN: 'left-down',
  MOUSE_MOVE: 'mouse-move',
  LEFT_UP: 'left-up',
  LEFT_CLICK: 'left-click',
};

function memoryEntities() {
  const items = new Map();
  return {
    add(entity) {
      items.set(entity.id, entity);
      return entity;
    },
    removeAll() {
      items.clear();
    },
    getById(id) {
      return items.get(id) || null;
    },
    get size() {
      return items.size;
    },
  };
}

function mockViewer(picks = []) {
  const queue = [...picks];
  const entities = memoryEntities();
  return {
    camera: {
      getPickRay() {
        return null;
      },
      pickEllipsoid() {
        const next = queue.shift();
        return next
          ? Cesium.Cartesian3.fromDegrees(next.lon, next.lat, 0)
          : null;
      },
    },
    scene: {
      canvas: {},
      globe: { pick() { return null; } },
      pick() {
        throw new Error('scene.pick must not run during measure');
      },
    },
    dataSources: {
      add() {},
      remove() {},
    },
    _entities: entities,
  };
}

function installMeasure(picks) {
  const viewer = mockViewer(picks);
  initMeasure(viewer, {
    bindClicks: false,
    bindKeys: false,
    createDataSource: () => ({ entities: viewer._entities }),
  });
  setMeasureActive(true);
  return viewer;
}

afterEach(() => {
  resetMeasureForTests();
  resetDistanceUnitsForTests();
});

describe('geodesic helper', () => {
  it('uses EllipsoidGeodesic surface distance for Austin–Houston', () => {
    const meters = geodesicSurfaceDistanceM(AUSTIN.lon, AUSTIN.lat, HOUSTON.lon, HOUSTON.lat);
    const expected = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(AUSTIN.lon, AUSTIN.lat),
      Cesium.Cartographic.fromDegrees(HOUSTON.lon, HOUSTON.lat),
    ).surfaceDistance;
    assert.ok(Number.isFinite(meters));
    assert.ok(Math.abs(meters - expected) < 1e-6);
    assert.ok(meters > 230_000 && meters < 240_000);
    const line = geodesicLineDegrees(AUSTIN.lon, AUSTIN.lat, HOUSTON.lon, HOUSTON.lat);
    assert.ok(line.length >= 2);
    assert.ok(Math.abs(line[0][0] - AUSTIN.lon) < 1e-9);
    assert.ok(Math.abs(line[0][1] - AUSTIN.lat) < 1e-9);
    assert.ok(Math.abs(line.at(-1)[0] - HOUSTON.lon) < 1e-9);
    assert.ok(Math.abs(line.at(-1)[1] - HOUSTON.lat) < 1e-9);
  });
});

describe('two clicks draw a line and a unit-aware distance', () => {
  it('second click stores a geodesic line and km label', () => {
    installMeasure([AUSTIN, HOUSTON]);
    const first = acceptMeasureClick({ x: 10, y: 10 });
    assert.equal(first.points.length, 1);
    assert.equal(first.line, null);
    assert.equal(first.distanceM, null);

    const second = acceptMeasureClick({ x: 40, y: 20 });
    const meters = geodesicSurfaceDistanceM(AUSTIN.lon, AUSTIN.lat, HOUSTON.lon, HOUSTON.lat);
    assert.equal(second.points.length, 2);
    assert.ok(second.line?.length >= 2);
    assert.ok(Math.abs(second.distanceM - meters) < 1e-6);
    assert.equal(second.label, formatDistanceMeters(meters, 'km'));
    assert.equal(second.prompt, second.label);
  });

  it('units toggle rewrites the live label without a new pick', () => {
    const viewer = installMeasure([AUSTIN, HOUSTON]);
    acceptMeasureClick({ x: 1, y: 1 });
    acceptMeasureClick({ x: 2, y: 2 });
    const meters = getMeasureState().distanceM;
    assert.equal(getMeasureState().label, formatDistanceMeters(meters, 'km'));

    setDistanceUnit('nm', { persist: false });
    assert.equal(getMeasureState().label, formatDistanceMeters(meters, 'nm'));
    assert.match(getMeasureState().label, /nmi/);
    assert.equal(viewer._entities.getById('meridian-measure-label').label.text, getMeasureState().label);

    setDistanceUnit('mi', { persist: false });
    assert.equal(getMeasureState().label, formatDistanceMeters(meters, 'mi'));
    assert.match(getMeasureState().label, /mi/);
    assert.equal(formatMeasureLabel(meters, 'mi'), formatDistanceMeters(meters, 'mi'));
  });
});

describe('Esc and Clear exit measure', () => {
  it('Escape clears the line and leaves the mode', () => {
    installMeasure([AUSTIN, HOUSTON]);
    acceptMeasureClick({ x: 1, y: 1 });
    acceptMeasureClick({ x: 2, y: 2 });
    assert.equal(isMeasureActive(), true);
    assert.equal(getMeasureState().points.length, 2);

    const consumed = handleMeasureKeydown({
      key: 'Escape',
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    assert.equal(consumed, true);
    assert.equal(isMeasureActive(), false);
    assert.equal(getMeasureState().points.length, 0);
    assert.equal(getMeasureState().line, null);
    assert.equal(getMeasureState().label, null);
  });

  it('Clear exits the same way and ignores later clicks', () => {
    installMeasure([AUSTIN]);
    acceptMeasureClick({ x: 1, y: 1 });
    clearMeasure();
    assert.equal(isMeasureActive(), false);
    assert.equal(acceptMeasureClick({ x: 2, y: 2 }), null);
    assert.equal(getMeasureState().points.length, 0);
  });
});

describe('terrain points only — not a person-search', () => {
  it('picks globe/ellipsoid points and never scene.pick', () => {
    const viewer = mockViewer([AUSTIN]);
    const point = pickTerrainPoint(viewer, { x: 12, y: 18 });
    assert.ok(point);
    assert.ok(Math.abs(point.lon - AUSTIN.lon) < 1e-8);
    assert.ok(Math.abs(point.lat - AUSTIN.lat) < 1e-8);
    assert.equal(pickTerrainPoint(viewer, { x: 0, y: 0 }), null);

    const source = src('measure.js');
    assert.match(source, /pickEllipsoid/);
    assert.match(source, /globe\?\.pick|globe\.pick/);
    assert.doesNotMatch(source, /scene\.pick\(/);
    assert.doesNotMatch(source, /person-search|personSearch|people.search/i);
    assert.doesNotMatch(source, /\/api\/route/);
    assert.doesNotMatch(source, /opensky/i);
    assert.doesNotMatch(source, /telegeography/i);
    assert.doesNotMatch(source, /news\.google|google news/i);
    assert.doesNotMatch(source, /osrm/i);
  });

  it('an armed Measure captures scene clicks so contact handlers stand down', () => {
    installMeasure([AUSTIN]);
    assert.equal(isSceneClickCaptured(), true);
    let layerClicks = 0;
    const handler = {
      actions: new Map(),
      setInputAction(callback, type) { this.actions.set(type, callback); },
      fire(type, event) { this.actions.get(type)?.(event); },
    };
    bindTrackingClickGesture(handler, () => { layerClicks += 1; }, { eventTypes: TYPES });
    handler.fire(TYPES.LEFT_CLICK, { position: { x: 4, y: 4 } });
    assert.equal(layerClicks, 0);

    clearMeasure();
    assert.equal(isSceneClickCaptured(), false);
    handler.fire(TYPES.LEFT_CLICK, { position: { x: 4, y: 4 } });
    assert.equal(layerClicks, 1);
  });
});

describe('Measure chrome and legal bounds', () => {
  it('ships a Measure control and Clear readout next to the camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, /id="measure-toggle"/);
    assert.match(block, /aria-label="Measure distance"/);
    assert.match(html, /id="measure-readout"/);
    assert.match(html, /id="measure-clear"/);
    assert.match(html, /id="measure-readout-label"/);
    const ui = src('ui.js');
    assert.match(ui, /initMeasure\(/);
    assert.match(ui, /setMeasureActive\(/);
    assert.match(ui, /clearMeasure\(/);
    assert.match(root('LICENSE'), /Copyright \(c\) 2026 Bilawal Sidhu/);
    assert.doesNotMatch(src('measure.js'), /God's Eye View|GEV rebrand/i);
  });

  it('does not invent an extra /api or call OSRM from Measure', () => {
    const measure = src('measure.js');
    assert.doesNotMatch(measure, /fetch\(/);
    assert.doesNotMatch(measure, /\/api\//);
    assert.doesNotMatch(src('ui.js').match(/_initMeasureButton\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '', /\/api\//);
  });
});
