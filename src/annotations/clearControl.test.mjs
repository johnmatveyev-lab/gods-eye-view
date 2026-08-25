// Clear-annotations chrome — hosted users erase the voice whiteboard without a
// voice command. Trails and tracking stay on a separate store.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAnnotationEngine } from './annotationEngine.js';
import { initAnnotationClearControl } from './clearControl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationEngine.js'), 'utf8');
const controlSrc = readFileSync(join(ROOT, 'src', 'annotations', 'clearControl.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'src', 'annotations', 'index.js'), 'utf8');

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
  const engine = createAnnotationEngine({
    viewer,
    renderer,
    resolveTarget: async () => ({ ...FIXTURE_PIN }),
  });
  return { engine, viewer, removed };
}

test('zero marks: Clear annotations control is disabled', (t) => {
  installAnimationFrameStubs(t);
  const { engine } = fixtureEngine();
  const button = fakeButton();
  initAnnotationClearControl(engine, { button });

  assert.equal(engine.count(), 0);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
});

test('a fixture mark then Clear leaves the globe with none', async (t) => {
  installAnimationFrameStubs(t);
  const { engine, removed } = fixtureEngine();
  const button = fakeButton();
  initAnnotationClearControl(engine, { button });

  const drawn = await engine.annotate([{
    type: 'pin',
    target: 'Fixture pin',
    label: 'Fixture pin',
    latitude: FIXTURE_PIN.lat,
    longitude: FIXTURE_PIN.lon,
  }]);
  assert.equal(drawn.drawn, 1);
  assert.equal(engine.count(), 1);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-disabled'), 'false');

  button.click();

  assert.equal(engine.count(), 0);
  assert.equal(engine.list().length, 0);
  assert.equal(removed.length, 1);
  assert.equal(button.disabled, true);
});

test('Clear annotations does not touch trails or tracking', async (t) => {
  installAnimationFrameStubs(t);
  const trail = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const track = { stopCalls: 0, stopTracking() { this.stopCalls += 1; } };
  const viewer = { trackedEntity: { id: 'plane-1' }, trail, track };
  const { engine } = fixtureEngine(viewer);
  const button = fakeButton();
  initAnnotationClearControl(engine, { button });

  await engine.annotate([{ type: 'pin', target: 'Fixture pin', label: 'Fixture pin' }]);
  button.click();

  assert.equal(engine.count(), 0);
  assert.equal(trail.clearCalls, 0, 'aircraft trails stay on their own store');
  assert.equal(track.stopCalls, 0, 'tracking is not stopped by clearing marks');
  assert.equal(viewer.trackedEntity?.id, 'plane-1');
});

test('the chrome button is a single Clear annotations control, not a draw tool', () => {
  const nav = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'top-center globe actions are missing');
  assert.match(
    nav[0],
    /id="clear-annotations"[^>]*type="button"[^>]*aria-label="Clear annotations"[^>]*disabled/,
  );
  assert.equal((html.match(/id="clear-annotations"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="draw-annotations"|annotation-draw|whiteboard-draw/);
  assert.match(indexSrc, /initAnnotationClearControl\(/);
});

test('the control and store stay on the annotation action — no new API or geo data', () => {
  assert.match(controlSrc, /annotations\.clear\(/);
  assert.doesNotMatch(controlSrc, /\/api\/|trailRenderer|stopTracking|track_entity|opensky|teleGeography|google news/i);
  assert.doesNotMatch(engineSrc, /\/api\/annotations|person-search|opensky/i);
  assert.match(css, /#clear-annotations:disabled/);
});
