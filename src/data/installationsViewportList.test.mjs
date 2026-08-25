import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { humanizeInstallationClass } from './militaryInstallationData.js';
import {
  INSTALLATION_VIEWPORT_LIST_CAP,
  INSTALLATION_VIEWPORT_LIST_FLY_ACTION,
  INSTALLATION_VIEWPORT_LIST_PANEL_ID,
  INSTALLATION_VIEWPORT_LIST_TOGGLE_ID,
  INSTALLATION_VIEWPORT_MAX_DEGREES,
  applyInstallationViewportList,
  flyToInstallationFromList,
  installationListIndependentOfMeasure,
  listViewportInstallations,
  nextInstallationListOpen,
  renderInstallationViewportListRows,
} from './installationsViewportList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function record(overrides = {}) {
  return {
    id: 'osm:node:1',
    kind: 'installation',
    class: 'airfield',
    name: 'Bergstrom AFB',
    latitude: 30.1945,
    longitude: -97.67,
    ...overrides,
  };
}

test('open list rows come from the current payload; click flies there', () => {
  assert.equal(INSTALLATION_VIEWPORT_LIST_CAP, 50);
  assert.equal(INSTALLATION_VIEWPORT_LIST_FLY_ACTION, 'focusById');
  assert.equal(nextInstallationListOpen(false), true);
  assert.equal(nextInstallationListOpen(true), false);

  const payload = [
    record(),
    record({
      id: 'osm:way:2',
      class: 'naval_base',
      name: 'Naval Station',
      latitude: 30.2,
      longitude: -97.7,
    }),
  ];
  const rows = listViewportInstallations(payload);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: 'osm:node:1',
    name: 'Bergstrom AFB',
    type: humanizeInstallationClass('airfield'),
    latitude: 30.1945,
    longitude: -97.67,
  });
  assert.equal(rows[1].type, humanizeInstallationClass('naval_base'));

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: `osm:node:${index}`,
    name: `Site ${index}`,
  }));
  assert.equal(listViewportInstallations(overflow).length, 50);
  assert.equal(listViewportInstallations(overflow).at(-1).id, 'osm:node:49');

  let fetches = 0;
  const flights = [];
  const layer = {
    focusById(id) {
      flights.push(id);
      return id === 'osm:node:1';
    },
    fetch() {
      fetches += 1;
    },
  };
  assert.equal(flyToInstallationFromList(layer, rows[0].id), true);
  assert.deepEqual(flights, ['osm:node:1']);
  assert.equal(fetches, 0, 'click must not start a new query');
  assert.equal(flyToInstallationFromList(layer, 'missing'), false);
});

test('empty bbox yields an empty list', () => {
  assert.deepEqual(listViewportInstallations([]), []);
  assert.deepEqual(listViewportInstallations(null), []);
  assert.deepEqual(listViewportInstallations(undefined), []);
  assert.deepEqual(listViewportInstallations([
    record({ latitude: Number.NaN }),
    record({ id: '', name: 'No id' }),
  ]), []);

  const html = renderInstallationViewportListRows([]);
  assert.match(html, /NO MAPPED SITES IN VIEW/);
  assert.doesNotMatch(html, /data-installation-id=/);
});

test('measure mode stays independent of the installations list', () => {
  const opened = installationListIndependentOfMeasure({ listOpen: true, measureMode: false });
  assert.deepEqual(opened, { listOpen: true, measureMode: false });

  const measuring = installationListIndependentOfMeasure({ listOpen: false, measureMode: true });
  assert.deepEqual(measuring, { listOpen: false, measureMode: true });

  const both = installationListIndependentOfMeasure({ listOpen: true, measureMode: true });
  assert.deepEqual(both, { listOpen: true, measureMode: true });

  const module = read('src/data/installationsViewportList.js');
  const ui = read('src/ui.js');
  const toggle = ui.match(/_toggleInstallationsViewportList\([\s\S]*?\n  \}/)?.[0] || '';
  assert.match(toggle, /nextInstallationListOpen/);
  assert.doesNotMatch(toggle, /measure/i);
  assert.doesNotMatch(module, /from ['"].*measure/i);
  assert.doesNotMatch(module, /setMeasureMode|enterMeasure|measure-tool/i);
});

test('applyInstallationViewportList paints current rows onto the hosted panel', () => {
  const toggle = {
    pressed: 'false',
    classes: new Set(),
    setAttribute(name, value) {
      if (name === 'aria-pressed') this.pressed = value;
    },
    classList: {
      toggle: (name, on) => {
        if (on) toggle.classes.add(name);
        else toggle.classes.delete(name);
      },
    },
  };
  const panel = { hidden: true, innerHTML: '' };
  const rows = listViewportInstallations([record()]);

  applyInstallationViewportList({ open: true, toggle, panel, rows });
  assert.equal(toggle.pressed, 'true');
  assert.equal(toggle.classes.has('active'), true);
  assert.equal(panel.hidden, false);
  assert.match(panel.innerHTML, /data-installation-id="osm:node:1"/);
  assert.match(panel.innerHTML, /Bergstrom AFB/);
  assert.match(panel.innerHTML, /Military airfield/);

  applyInstallationViewportList({ open: false, toggle, panel, rows: [] });
  assert.equal(toggle.pressed, 'false');
  assert.equal(panel.hidden, true);
});

test('hosted Sites control lists the current bbox set and does not add an API', () => {
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const layer = read('src/data/militaryInstallations.js');
  const list = read('src/data/installationsViewportList.js');

  const toggle = html.match(
    new RegExp(`<button[^>]*id="${INSTALLATION_VIEWPORT_LIST_TOGGLE_ID}"[\\s\\S]*?<\\/button>`),
  );
  assert.ok(toggle, 'installations list toggle is missing');
  assert.match(toggle[0], /aria-pressed="false"/);
  assert.match(toggle[0], new RegExp(`aria-controls="${INSTALLATION_VIEWPORT_LIST_PANEL_ID}"`));
  assert.match(toggle[0], /aria-label="Sites — mapped installations in view"/);
  assert.match(toggle[0], />SITES</);
  assert.doesNotMatch(toggle[0], /person|OpenSky|Google News|TeleGeography|quantum-earth/i);

  const topCenter = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(topCenter, 'top-center chrome is missing');
  assert.match(topCenter[0], new RegExp(`id="${INSTALLATION_VIEWPORT_LIST_TOGGLE_ID}"`));
  assert.match(html, new RegExp(`id="${INSTALLATION_VIEWPORT_LIST_PANEL_ID}"`));
  assert.match(html, /data-installations-list/);

  assert.match(ui, /_toggleInstallationsViewportList\(/);
  assert.match(ui, /applyInstallationViewportList\(/);
  assert.match(ui, /listViewportInstallations\(/);
  assert.match(ui, /flyToInstallationFromList\(/);
  assert.match(ui, /getViewportRecords\(/);
  assert.match(
    ui,
    /this\._installationsListToggle\?\.addEventListener\('click', \(\) => \{\s*this\._toggleInstallationsViewportList\(\);/,
  );
  assert.match(ui, /getElementById\('installations-list-toggle'\)/);
  assert.match(css, /#installations-list-toggle/);
  assert.match(css, /#installations-viewport-list/);

  assert.match(layer, /MAX_VIEWPORT_DEGREES = 10/);
  assert.match(layer, /getViewportRecords\(/);
  assert.match(layer, /focusById\(/);
  assert.equal(INSTALLATION_VIEWPORT_MAX_DEGREES, 10);

  assert.doesNotMatch(list, /\/api\//);
  assert.doesNotMatch(list, /person-search|named person|passenger/i);
  assert.doesNotMatch(list, /OpenSky|Google News|TeleGeography|quantum-earth/);
  assert.doesNotMatch(list, /from ['"].*measure|setMeasureMode|measure-tool/i);

  const title = html.match(/<title>([^<]*)<\/title>/);
  assert.equal(title?.[1], 'Meridian');
});

test('legal pins stay on existing public installation features', () => {
  const license = read('LICENSE');
  const readme = read('README.md');
  const dataSources = read('DATA_SOURCES.md');
  const list = read('src/data/installationsViewportList.js');
  const layer = read('src/data/militaryInstallations.js');

  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.match(readme, /mapped installations in the current view/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.match(dataSources, /\/api\/military-installations/);
  assert.match(dataSources, /maximum 10°/);
  assert.doesNotMatch(list, /\/api\/person|opensky|google news|telegeography/i);
  assert.match(layer, /\/api\/military-installations\?/);
  assert.doesNotMatch(layer, /\/api\/intelligence-search|\/api\/people/);
});
