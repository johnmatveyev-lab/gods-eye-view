import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cockpitEntryAllowed } from '../contextModePolicy.js';
import { AWARENESS_RADIUS_M } from './militaryAwarenessEngine.js';
import {
  CONTACTS_ROSTER_PANEL_ID,
  CONTACTS_ROSTER_RADIUS_M,
  CONTACTS_ROSTER_TOGGLE_ID,
  CONTACTS_ROSTER_TRACK_ACTION,
  CONTACTS_ROSTER_VIEW_ID,
  applyContactsRosterToggle,
  cockpitEntryAllowedFromRoster,
  contactsRosterEmptyPresentation,
  contactsRosterVisibility,
  nextContactsRosterOpen,
} from './contactsRosterToggle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

test('toggle opens the existing 250 km roster and reuses the current track action', () => {
  assert.equal(CONTACTS_ROSTER_RADIUS_M, AWARENESS_RADIUS_M);
  assert.equal(CONTACTS_ROSTER_RADIUS_M, 250000);
  assert.equal(CONTACTS_ROSTER_TRACK_ACTION, 'requestFocus');
  assert.equal(nextContactsRosterOpen(false), true);
  assert.equal(nextContactsRosterOpen(true), false);

  const opened = contactsRosterVisibility({ open: true });
  assert.equal(opened.panelHidden, false);
  assert.equal(opened.contextMode, 'flights');
  assert.equal(opened.expandContext, true);
  assert.equal(opened.trackAction, 'requestFocus');

  const closed = contactsRosterVisibility({ open: false });
  assert.equal(closed.panelHidden, true);
  assert.equal(closed.contextMode, null);
  assert.equal(closed.expandContext, false);

  const awareness = read('src/data/militaryAwareness.js');
  assert.match(
    awareness,
    /requestFocus\(target\.dataset\.awarenessLayer, target\.dataset\.awarenessId/,
  );
  assert.match(
    awareness,
    /return flightsLayer\.refocusTrackedById\?\.\(id, \{ origin \}\) \|\| flightsLayer\.trackById\(id, \{ origin \}\);/,
  );
  assert.match(awareness, /id:\s*'military-awareness'/);
  assert.match(awareness, /AWARENESS_RADIUS_M/);
  assert.doesNotMatch(awareness, /person-search|named.person|passenger name/i);
});

test('empty sky is empty or unavailable, never a hang', () => {
  const empty = contactsRosterEmptyPresentation({ available: true, items: [] });
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.hang, false);
  assert.equal(empty.count, 0);
  assert.match(empty.reason, /no observed or mapped objects/i);

  const unavailable = contactsRosterEmptyPresentation({ available: false, items: [] });
  assert.equal(unavailable.kind, 'unavailable');
  assert.equal(unavailable.hang, false);
  assert.equal(unavailable.count, null);
  assert.match(unavailable.reason, /unavailable/i);

  const stale = contactsRosterEmptyPresentation({ available: true, stale: true, items: [] });
  assert.equal(stale.kind, 'unavailable');
  assert.equal(stale.hang, false);

  const ready = contactsRosterEmptyPresentation({
    available: true,
    items: [{ callsign: 'N123AB', distanceM: 12000, icao24: 'abc123' }],
  });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.hang, false);
  assert.equal(ready.count, 1);
});

test('cockpit enter still only on a selected aircraft', () => {
  const contactsReady = {
    contextMode: 'flights',
    contextModeChanging: false,
    flightsEnabled: true,
    militaryEnabled: true,
  };
  assert.equal(cockpitEntryAllowed(contactsReady), true);
  assert.equal(cockpitEntryAllowedFromRoster({ ...contactsReady, selectedAircraft: false }), false);
  assert.equal(cockpitEntryAllowedFromRoster({ ...contactsReady, selectedAircraft: true }), true);
  assert.equal(cockpitEntryAllowedFromRoster({
    ...contactsReady,
    contextMode: null,
    selectedAircraft: true,
  }), false);
});

test('applyContactsRosterToggle shows the existing view and expands Context', () => {
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
  const view = { hidden: true };
  const collapses = [];

  const shown = applyContactsRosterToggle({
    open: true,
    toggle,
    view,
    setPanelCollapsed: (id, collapsed, opts) => collapses.push({ id, collapsed, opts }),
  });
  assert.equal(shown.panelHidden, false);
  assert.equal(toggle.pressed, 'true');
  assert.equal(toggle.classes.has('active'), true);
  assert.equal(view.hidden, false);
  assert.deepEqual(collapses, [{
    id: 'global-context-panel',
    collapsed: false,
    opts: { explicit: true },
  }]);

  applyContactsRosterToggle({ open: false, toggle, view, setPanelCollapsed: () => {
    throw new Error('closing must not force-expand Context');
  } });
  assert.equal(toggle.pressed, 'false');
  assert.equal(view.hidden, true);
});

test('hosted Contacts control opens the existing roster and does not copy ident there', () => {
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const toggle = html.match(
    new RegExp(`<button[^>]*id="${CONTACTS_ROSTER_TOGGLE_ID}"[\\s\\S]*?<\\/button>`),
  );
  assert.ok(toggle, 'Contacts roster toggle is missing');
  assert.match(toggle[0], /aria-pressed="false"/);
  assert.match(toggle[0], new RegExp(`aria-controls="${CONTACTS_ROSTER_PANEL_ID}"`));
  assert.match(toggle[0], /aria-label="Contacts — nearby aircraft roster"/);
  assert.match(toggle[0], />CONTACTS</);
  assert.match(toggle[0], />radar</);
  assert.doesNotMatch(toggle[0], /copy ident|clipboard|person/i);
  assert.match(html, /id="selected-contact-ident-copy"[^>]*aria-label="Copy ident"/);

  const topCenter = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(topCenter, 'top-center chrome is missing');
  assert.match(topCenter[0], new RegExp(`id="${CONTACTS_ROSTER_TOGGLE_ID}"`));
  assert.match(html, new RegExp(`id="${CONTACTS_ROSTER_PANEL_ID}"`));
  assert.match(html, new RegExp(`id="${CONTACTS_ROSTER_VIEW_ID}"`));

  assert.match(ui, /_toggleContactsRoster\(/);
  assert.match(ui, /applyContactsRosterToggle\(/);
  assert.match(
    ui,
    /this\._contactsRosterToggle\?\.addEventListener\('click', \(\) => \{\s*this\._toggleContactsRoster\(\);/,
  );
  assert.match(ui, /this\._globalContextFlightsBtn\?\.addEventListener\('click', \(\) => \{\s*this\._toggleContactsRoster\(\);/);
  assert.match(ui, /getElementById\('contacts-roster-toggle'\)/);
  assert.match(css, /#contacts-roster-toggle/);

  const title = html.match(/<title>([^<]*)<\/title>/);
  assert.equal(title?.[1], 'Meridian');
  assert.doesNotMatch(toggle[0], /OpenSky|Google News|TeleGeography|quantum-earth|person/i);
});

test('legal pins stay on the existing public aircraft roster', () => {
  const license = read('LICENSE');
  const readme = read('README.md');
  const flights = read('src/data/flights.js');
  const toggle = read('src/data/contactsRosterToggle.js');

  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.match(readme, /250 km roster/);
  assert.match(readme, /Contacts control/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.match(flights, /adsb\.lol/);
  assert.doesNotMatch(toggle, /\/api\//);
  assert.doesNotMatch(toggle, /\/api\/person|named person|passenger/i);
  assert.doesNotMatch(toggle, /OpenSky|Google News|TeleGeography|quantum-earth/);
  assert.match(toggle, /AWARENESS_RADIUS_M/);
  assert.match(toggle, /summarizeAwarenessCohort/);
});
