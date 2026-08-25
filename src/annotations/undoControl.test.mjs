// Undo-last-annotation chrome — hosted users drop one wrong mark without
// wiping the board. Trails and tracking stay on a separate store.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAnnotationEngine } from './annotationEngine.js';
import { initAnnotationUndoControl } from './undoControl.js';
import { initAnnotationClearControl } from './clearControl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationEngine.js'), 'utf8');
const controlSrc = readFileSync(join(ROOT, 'src', 'annotations', 'undoControl.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'src', 'annotations', 'index.js'), 'utf8');
const voiceActionsSrc = readFileSync(join(ROOT, 'src', 'voice', 'gevActions.js'), 'utf8');
const voiceToolsSrc = readFileSync(join(ROOT, 'src', 'voice', 'realtimeTools.js'), 'utf8');

const FIXTURE_PIN = { lon: -122.4194, lat: 37.7749, height: 0, label: 'Fixture pin', source: 'fixture' };

function installAnimationFrameStubs(t) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });
}

function fakeRenderer() {
  const removed = [];
  return {
    removed,
    renderer: {
      add() {},
      update() {},
      remove(anno) { removed.push(anno.id); },
      sync() {},
    },
  };
}

function fakeButton() {
  const attrs = new Map();
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(name, value) { attrs.set(name, value); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    click() { listeners.get('click')?.({ preventDefault() {} }); },
  };
}

function fixtureEngine(viewer = { trackedEntity: { id: 'plane-1' } }) {
  const { renderer, removed } = fakeRenderer();
  let seq = 0;
  const engine = createAnnotationEngine({
    viewer,
    renderer,
    resolveTarget: async ({ target, latitude, longitude }) => ({
      lon: Number.isFinite(longitude) ? longitude : FIXTURE_PIN.lon + (seq += 0.01),
      lat: Number.isFinite(latitude) ? latitude : FIXTURE_PIN.lat + seq,
      height: 0,
      label: target || FIXTURE_PIN.label,
      source: 'fixture',
    }),
  });
  return { engine, viewer, removed };
}

test('zero marks: Undo last annotation control is disabled', (t) => {
  installAnimationFrameStubs(t);
  const { engine } = fixtureEngine();
  const button = fakeButton();
  initAnnotationUndoControl(engine, { button });

  assert.equal(engine.count(), 0);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
});

test('two fixture marks then Undo leaves the first', async (t) => {
  installAnimationFrameStubs(t);
  const { engine, removed } = fixtureEngine();
  const undo = fakeButton();
  initAnnotationUndoControl(engine, { button: undo });

  await engine.annotate([{ type: 'pin', target: 'First', label: 'First', latitude: 1, longitude: 1 }]);
  await engine.annotate([{ type: 'pin', target: 'Second', label: 'Second', latitude: 2, longitude: 2 }]);
  const [first, second] = engine.list();
  assert.equal(engine.count(), 2);
  assert.equal(undo.disabled, false);

  undo.click();

  assert.equal(engine.count(), 1);
  assert.equal(engine.list()[0].id, first.id);
  assert.deepEqual(removed, [second.id]);
  assert.equal(undo.disabled, false);

  undo.click();
  assert.equal(engine.count(), 0);
  assert.equal(undo.disabled, true);

  undo.click();
  assert.equal(engine.count(), 0);
  assert.equal(removed.length, 2);
});

test('Clear still empties all and disables Undo', async (t) => {
  installAnimationFrameStubs(t);
  const { engine } = fixtureEngine();
  const undo = fakeButton();
  const clear = fakeButton();
  initAnnotationUndoControl(engine, { button: undo });
  initAnnotationClearControl(engine, { button: clear });

  await engine.annotate([{ type: 'pin', target: 'First', label: 'First', latitude: 1, longitude: 1 }]);
  await engine.annotate([{ type: 'pin', target: 'Second', label: 'Second', latitude: 2, longitude: 2 }]);
  assert.equal(undo.disabled, false);
  assert.equal(clear.disabled, false);

  clear.click();

  assert.equal(engine.count(), 0);
  assert.equal(undo.disabled, true);
  assert.equal(clear.disabled, true);
});

test('the chrome button sits next to Clear annotations', () => {
  const nav = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'top-center globe actions are missing');
  assert.match(
    nav[0],
    /id="clear-annotations"[\s\S]*?id="undo-annotations"[^>]*type="button"[^>]*aria-label="Undo last annotation"[^>]*disabled/,
  );
  assert.equal((html.match(/id="undo-annotations"/g) || []).length, 1);
  assert.match(indexSrc, /initAnnotationUndoControl\(/);
});

test('the control stays on the annotation store — no new API, voice, or geo export', () => {
  assert.match(controlSrc, /annotations\.removeLast\(/);
  assert.match(engineSrc, /function removeLast\(/);
  assert.doesNotMatch(engineSrc, /generation \+= 1[\s\S]{0,200}removeLast|removeLast[\s\S]{0,200}generation \+= 1/);
  assert.doesNotMatch(engineSrc, /removeLast[\s\S]{0,200}abortPending\(/);
  assert.doesNotMatch(controlSrc, /\/api\/|trailRenderer|stopTracking|track_entity|opensky|teleGeography|google news|toGeoJSON|exportGeoJson/i);
  assert.doesNotMatch(engineSrc, /\/api\/annotations|person-search|opensky/i);
  assert.doesNotMatch(voiceActionsSrc, /removeLast|undo_annotation|undo_last/);
  assert.doesNotMatch(voiceToolsSrc, /undo_annotation|undo_last_annotation/);
  assert.match(css, /#undo-annotations:disabled/);
});
