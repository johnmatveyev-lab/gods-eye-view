import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  LAUNCHES_FEED_URL,
  LAUNCHES_PANEL_COUNT_ID,
  LAUNCHES_PANEL_DATE_UNAVAILABLE,
  LAUNCHES_PANEL_EMPTY,
  LAUNCHES_PANEL_ID,
  LAUNCHES_PANEL_LIST_ID,
  LAUNCHES_PANEL_LOADING,
  LAUNCHES_PANEL_TOGGLE_ID,
  LAUNCHES_PANEL_UNAVAILABLE,
  LAUNCH_PAD_FOCUS_RANGE_M,
  applyLaunchesPanelToggle,
  isLaunchesPayload,
  launchPadCoordinates,
  launchesPanelEmptyPresentation,
  launchesPanelLoadingPresentation,
  launchesPanelRowAction,
  launchesPanelRows,
  loadLaunchesPanelPayload,
  nextLaunchesPanelOpen,
  renderLaunchesPanelList,
} from './launchesPanel.js';
import { flyToExistingLaunchPad, normalizeRocketLaunches } from './rocketLaunches.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

const PADDED = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX' },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const NO_COORDS = {
  id: 'll2-secret-pad',
  name: 'Classified Flight',
  net: '2026-08-21T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'Unknown' },
  pad: { name: 'Undisclosed', location: {} },
};

test('panel rows come from the current Launch Library 2 payload', () => {
  const rows = launchesPanelRows({ results: [PADDED, NO_COORDS] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'll2-starlink');
  assert.equal(rows[0].lat, 28.608);
  assert.equal(rows[0].lon, -80.604);
  assert.equal(rows[0].provider, 'SpaceX');
  assert.equal(rows[0].source, 'Launch Library 2');
  assert.equal(rows[1].id, 'll2-secret-pad');
  assert.equal(rows[1].lat, null);
  assert.equal(rows[1].lon, null);
  assert.equal(LAUNCHES_FEED_URL, '/api/launches');
  assert.equal(isLaunchesPayload({ results: [] }), true);
  assert.equal(isLaunchesPayload({ error: LAUNCHES_PANEL_UNAVAILABLE }), false);
});

test('click with pad coords flies to the existing pad; otherwise only selects', () => {
  const fly = launchesPanelRowAction(launchesPanelRows({ results: [PADDED] })[0]);
  assert.equal(fly.kind, 'fly-to');
  assert.equal(fly.selectedId, 'll2-starlink');
  assert.deepEqual(fly.flyTo, { lat: 28.608, lon: -80.604, rangeM: LAUNCH_PAD_FOCUS_RANGE_M });
  assert.equal(LAUNCH_PAD_FOCUS_RANGE_M, 12000);

  const select = launchesPanelRowAction(launchesPanelRows({ results: [NO_COORDS] })[0]);
  assert.equal(select.kind, 'select');
  assert.equal(select.selectedId, 'll2-secret-pad');
  assert.equal(select.flyTo, null);

  assert.equal(nextLaunchesPanelOpen(false), true);
  assert.equal(nextLaunchesPanelOpen(true), false);

  const flights = [];
  const viewer = {
    camera: {
      cancelFlight() {},
      flyToBoundingSphere(_sphere, options) { flights.push(options); },
    },
  };
  assert.equal(flyToExistingLaunchPad(viewer, { lat: 28.608, lon: -80.604 }), true);
  assert.equal(flights.length, 1);
  assert.equal(flyToExistingLaunchPad(viewer, { lat: null, lon: null }), false);
  assert.equal(flyToExistingLaunchPad(null, { lat: 28.608, lon: -80.604 }), false);
  assert.equal(flights.length, 1);
});

test('failed payload is empty or unavailable, never a hang', async () => {
  const empty = launchesPanelEmptyPresentation({ available: true, items: [], payload: { results: [] } });
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.hang, false);
  assert.equal(empty.count, 0);
  assert.equal(empty.reason, LAUNCHES_PANEL_EMPTY);

  const unavailable = launchesPanelEmptyPresentation({ available: false, items: [] });
  assert.equal(unavailable.kind, 'unavailable');
  assert.equal(unavailable.hang, false);
  assert.equal(unavailable.count, null);
  assert.equal(unavailable.reason, LAUNCHES_PANEL_UNAVAILABLE);

  const malformed = launchesPanelEmptyPresentation({
    available: true,
    payload: { error: 'Launch Library 2 unavailable' },
  });
  assert.equal(malformed.kind, 'unavailable');
  assert.equal(malformed.hang, false);

  const loading = launchesPanelLoadingPresentation();
  assert.equal(loading.kind, 'loading');
  assert.equal(loading.hang, false);
  assert.equal(loading.reason, LAUNCHES_PANEL_LOADING);
  assert.match(renderLaunchesPanelList(loading), /LOADING 30-DAY MISSION INDEX/);
  assert.doesNotMatch(renderLaunchesPanelList(unavailable), />Retry<|>RETRY</);

  const failed = await loadLaunchesPanelPayload({
    fetchImpl: async () => { throw new Error('upstream down'); },
  });
  assert.equal(failed.kind, 'unavailable');
  assert.equal(failed.hang, false);
  assert.equal(failed.reason, LAUNCHES_PANEL_UNAVAILABLE);

  const stale = await loadLaunchesPanelPayload({
    cachedPayload: { results: [PADDED] },
    fetchImpl: async () => new Response('nope', { status: 502 }),
  });
  assert.equal(stale.kind, 'ready');
  assert.equal(stale.stale, true);
  assert.equal(stale.hang, false);
  assert.equal(stale.rows[0].id, 'll2-starlink');

  const ready = await loadLaunchesPanelPayload({
    fetchImpl: async () => new Response(JSON.stringify({ results: [PADDED, NO_COORDS] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.hang, false);
  assert.equal(ready.count, 2);
});

test('pad coordinates match the globe layer parser', () => {
  const now = new Date('2026-08-25T12:00:00Z');
  const fromFields = launchPadCoordinates({
    pad: { latitude: '34.632', longitude: '-120.611' },
  });
  assert.deepEqual(fromFields, { lat: 34.632, lon: -120.611 });

  const fromString = launchPadCoordinates({
    pad: { location: { coordinates: '12.5,45.5' } },
  });
  assert.deepEqual(fromString, { lat: 45.5, lon: 12.5 });

  const normalized = normalizeRocketLaunches({ results: [PADDED] }, now);
  assert.equal(normalized[0].lat, 28.608);
  assert.equal(normalized[0].lon, -80.604);
  assert.deepEqual(launchPadCoordinates(normalized[0]), { lat: 28.608, lon: -80.604 });

  const layer = read('src/data/rocketLaunches.js');
  assert.match(layer, /launchPadCoordinates\(/);
  assert.match(layer, /MISSION_FOCUS_RANGE_M = 12000/);
  assert.match(layer, /export function flyToExistingLaunchPad/);
  assert.match(layer, /API_URL = '\/api\/launches'/);
});

test('hosted Launches control opens the panel and does not add a new /api', () => {
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const panel = read('src/data/launchesPanel.js');
  const toggle = html.match(
    new RegExp(`<button[^>]*id="${LAUNCHES_PANEL_TOGGLE_ID}"[\\s\\S]*?<\\/button>`),
  );
  assert.ok(toggle, 'Launches panel toggle is missing');
  assert.match(toggle[0], /aria-pressed="false"/);
  assert.match(toggle[0], new RegExp(`aria-controls="${LAUNCHES_PANEL_ID}"`));
  assert.match(toggle[0], /LAUNCHES/);
  assert.match(toggle[0], /rocket_launch/);
  assert.doesNotMatch(toggle[0], /OpenSky|Google News|TeleGeography|quantum-earth|contacts|cockpit|copy ident/i);

  const topCenter = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(topCenter, 'top-center chrome is missing');
  assert.match(topCenter[0], new RegExp(`id="${LAUNCHES_PANEL_TOGGLE_ID}"`));
  assert.match(html, new RegExp(`id="${LAUNCHES_PANEL_ID}"`));
  assert.match(html, new RegExp(`id="${LAUNCHES_PANEL_LIST_ID}"`));
  assert.match(html, new RegExp(`id="${LAUNCHES_PANEL_COUNT_ID}"`));
  assert.match(html, /Launch Library 2/);
  assert.match(html, /LOADING 30-DAY MISSION INDEX/);

  assert.match(ui, /_initLaunchesPanel\(/);
  assert.match(ui, /applyLaunchesPanelToggle\(/);
  assert.match(ui, /loadLaunchesPanelPayload\(/);
  assert.match(ui, /launchesPanelRowAction\(/);
  assert.match(ui, /flyToExistingLaunchPad\(/);
  assert.match(ui, /getElementById\('launches-panel-toggle'\)/);
  assert.match(css, /#launches-panel-toggle/);
  assert.match(css, /#launches-panel/);

  const title = html.match(/<title>([^<]*)<\/title>/);
  assert.equal(title?.[1], 'Meridian');
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);
  assert.doesNotMatch(panel, /Retry|opensky|news\.google|telegeography|quantum-earth/i);
});

test('legal pins stay on Launch Library 2 and MIT credit', () => {
  const license = read('LICENSE');
  const readme = read('README.md');
  const credits = read('src/data/dataCredits.js');
  const panel = read('src/data/launchesPanel.js');
  const markup = renderLaunchesPanelList(
    launchesPanelEmptyPresentation({
      available: true,
      items: launchesPanelRows({ results: [PADDED] }),
      payload: { results: [PADDED] },
    }),
    'll2-starlink',
  );

  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.match(readme, /Launches panel/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.match(credits, /key:\s*'launch-library-2'/);
  assert.match(credits, /Launch Library 2 — The Space Devs/);
  assert.match(panel, /Launch Library 2/);
  assert.match(panel, /\/api\/launches/);
  assert.doesNotMatch(panel, /OpenSky|Google News|TeleGeography|quantum-earth/);
  assert.match(markup, /data-launch-id="ll2-starlink"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /FALCON 9/);
  assert.doesNotMatch(markup, /DATE UNAVAILABLE/);
  assert.equal(LAUNCHES_PANEL_DATE_UNAVAILABLE, 'DATE UNAVAILABLE');
});

test('applyLaunchesPanelToggle shows the dedicated list without Context mode', () => {
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
  const panel = { hidden: true };

  const shown = applyLaunchesPanelToggle({ open: true, toggle, panel });
  assert.equal(shown.open, true);
  assert.equal(shown.panelHidden, false);
  assert.equal(toggle.pressed, 'true');
  assert.equal(toggle.classes.has('active'), true);
  assert.equal(panel.hidden, false);

  applyLaunchesPanelToggle({ open: false, toggle, panel });
  assert.equal(toggle.pressed, 'false');
  assert.equal(panel.hidden, true);
});
