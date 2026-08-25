import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  HUD_CYCLE,
  HUD_VARIANT_STORE_KEY,
  applyHudCycleState,
  describeHudCycleState,
  hudChromeAriaLabel,
  hudChromeLabel,
  nextHudCycleState,
  normalizeHudLayout,
  readStoredHudVariant,
  writeStoredHudVariant,
} from './hudCycle.js';

const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const hud = fs.readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
const voice = fs.readFileSync(new URL('./voice/gevActions.js', import.meta.url), 'utf8');
const liveApi = fs.readFileSync(new URL('./server/liveApiProxies.js', import.meta.url), 'utf8');
const hudSummary = fs.readFileSync(new URL('./hud/summary.js', import.meta.url), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (name) => (values.has(name) ? values.get(name) : null),
    setItem: (name, next) => { values.set(name, next); },
    removeItem: (name) => { values.delete(name); },
    snapshot: () => Object.fromEntries(values),
  };
}

function fakeStyleManager(initial = {}) {
  const state = {
    visible: initial.visible !== false,
    layout: normalizeHudLayout(initial.layout),
  };
  return {
    state,
    setHudLayout(layout) {
      const next = normalizeHudLayout(layout);
      if (!['operator', 'minimal', 'tactical'].includes(String(layout || '').toLowerCase())) {
        return { ok: false, error: `Unknown HUD layout: ${layout}` };
      }
      state.layout = next;
      return { ok: true, layout: state.layout, visible: state.visible };
    },
    setHudVisible(mode) {
      if (!['on', 'off', 'auto'].includes(mode)) {
        return { ok: false, error: `Unknown HUD visibility mode: ${mode}` };
      }
      if (mode === 'off') state.visible = false;
      if (mode === 'on') state.visible = true;
      return { ok: true, visible: state.visible, layout: state.layout };
    },
    getControlState() {
      return { hud: { visible: state.visible, layout: state.layout } };
    },
  };
}

function chromeFromManager(manager) {
  const hudState = manager.getControlState().hud;
  return {
    token: describeHudCycleState(hudState),
    label: hudChromeLabel(hudState),
    ariaLabel: hudChromeAriaLabel(hudState),
    pressed: hudState.visible,
    layout: hudState.layout,
  };
}

test('the existing HUD cycle is operator → minimal → tactical → off → operator', () => {
  assert.deepEqual(HUD_CYCLE, ['operator', 'minimal', 'tactical', 'off']);
  let state = { visible: true, layout: 'operator' };
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    seen.push(describeHudCycleState(state));
    const next = nextHudCycleState(state);
    state = next === 'off'
      ? { visible: false, layout: state.layout }
      : { visible: true, layout: next };
  }
  assert.deepEqual(seen, ['operator', 'minimal', 'tactical', 'off', 'operator']);
});

test('clicking the cycle applies each step through the same set_hud facades', () => {
  const manager = fakeStyleManager({ visible: true, layout: 'operator' });
  const tokens = [];
  for (let i = 0; i < 4; i += 1) {
    const next = nextHudCycleState(manager.state);
    const result = applyHudCycleState(next, manager);
    assert.equal(result.ok, true);
    tokens.push(describeHudCycleState(manager.getControlState().hud));
  }
  assert.deepEqual(tokens, ['minimal', 'tactical', 'off', 'operator']);
});

test('voice set_hud writes the same chrome state the cycle control reads', () => {
  const manager = fakeStyleManager({ visible: true, layout: 'tactical' });

  manager.setHudLayout('minimal');
  assert.deepEqual(chromeFromManager(manager), {
    token: 'minimal',
    label: 'MINIMAL',
    ariaLabel: 'HUD layout: minimal',
    pressed: true,
    layout: 'minimal',
  });

  manager.setHudVisible('off');
  assert.deepEqual(chromeFromManager(manager), {
    token: 'off',
    label: 'HUD',
    ariaLabel: 'HUD: off',
    pressed: false,
    layout: 'minimal',
  });

  manager.setHudLayout('operator');
  manager.setHudVisible('on');
  assert.deepEqual(chromeFromManager(manager), {
    token: 'operator',
    label: 'OPERATOR',
    ariaLabel: 'HUD layout: operator',
    pressed: true,
    layout: 'operator',
  });
});

test('an unknown layout falls back to the existing tactical variant', () => {
  assert.equal(normalizeHudLayout('nope'), 'tactical');
  assert.equal(describeHudCycleState({ visible: true, layout: 'full' }), 'tactical');
  assert.equal(nextHudCycleState({ visible: true, layout: 'full' }), 'off');
});

test('HUD variant persistence is session-only unless a store key already exists', () => {
  const storage = memoryStorage();
  const sessionStorageRef = memoryStorage();
  writeStoredHudVariant('operator', { storage, sessionStorageRef });
  assert.deepEqual(storage.snapshot(), {}, 'a missing durable key must not be created');
  assert.equal(sessionStorageRef.snapshot()[HUD_VARIANT_STORE_KEY], 'operator');
  assert.equal(readStoredHudVariant({ storage, sessionStorageRef }), 'operator');

  writeStoredHudVariant('minimal', { storage, sessionStorageRef });
  assert.equal(sessionStorageRef.snapshot()[HUD_VARIANT_STORE_KEY], 'minimal');
  assert.deepEqual(storage.snapshot(), {});
});

test('an already-present store key keeps the variant durable', () => {
  const storage = memoryStorage({ [HUD_VARIANT_STORE_KEY]: 'tactical' });
  const sessionStorageRef = memoryStorage();
  assert.equal(readStoredHudVariant({ storage, sessionStorageRef }), 'tactical');
  writeStoredHudVariant('operator', { storage, sessionStorageRef });
  assert.equal(storage.snapshot()[HUD_VARIANT_STORE_KEY], 'operator');
  assert.deepEqual(sessionStorageRef.snapshot(), {}, 'do not also write a session copy when durable storage already owns the key');
});

test('storage access is lazy and guarded, never a default parameter', () => {
  const source = fs.readFileSync(new URL('./hudCycle.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    code,
    /=\s*globalThis\.(local|session)Storage/,
    'storage must be resolved lazily inside a try, never as a default parameter',
  );
  assert.match(code, /function resolveStore\(/);
  assert.match(code, /try \{[\s\S]*globalThis\.sessionStorage[\s\S]*\} catch/);
});

test('the HUD button is the one cycle control and uses the set_hud facades', () => {
  assert.equal((html.match(/id="hud-toggle"/g) || []).length, 1);
  assert.match(html, /id="hud-toggle"[^>]*aria-pressed=/);
  assert.match(ui, /import \{[\s\S]*cycleHud[\s\S]*\} from '\.\/hudCycle\.js';/);
  assert.match(ui, /this\._hudBtn\.addEventListener\('click', \(\) => \{[\s\S]*this\.cycleHud\(\)/);
  const cycleHud = ui.slice(ui.indexOf('  cycleHud() {'), ui.indexOf('  setHudVisible(mode) {'));
  assert.match(cycleHud, /return cycleHud\(/);
  assert.match(cycleHud, /this\.setHudLayout/);
  assert.match(cycleHud, /this\.setHudVisible/);
  const setLayout = ui.slice(ui.indexOf('  setHudLayout(variantName) {'), ui.indexOf('  getDetectionState() {'));
  assert.match(setLayout, /this\._updateHudButtonState\(\)/, 'voice layout changes must refresh chrome');
  const chrome = ui.slice(ui.indexOf('  _updateHudButtonState() {'), ui.indexOf('  _updateDetectionButton(modeLabel) {'));
  assert.match(chrome, /hudChromeLabel\(/);
  assert.match(chrome, /hudChromeAriaLabel\(/);
});

test('voice set_hud still writes StyleManager HUD state, not a second store', () => {
  const setHud = voice.slice(voice.indexOf("if (name === 'set_hud') {"), voice.indexOf("if (name === 'set_detection') {"));
  assert.match(setHud, /styleManager\.setHudLayout\(args\.layout\)/);
  assert.match(setHud, /styleManager\.setHudVisible\(args\.visible\)/);
  assert.match(setHud, /styleManager\.getControlState\(\)\.hud/);
});

test('HUD summary API and the five-word model stay unchanged', () => {
  assert.match(hud, /const HUD_SUMMARY_URL = '\/api\/openai\/hud-summary';/);
  assert.match(hudSummary, /const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';/);
  assert.match(liveApi, /middlewares\.use\('\/api\/openai\/hud-summary'/);
});

test('clean view + HUD off still leaves #cesium-credits on', () => {
  const creditBlocks = [...css.matchAll(/#cesium-credits[^{]*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(creditBlocks.length > 0);
  for (const block of creditBlocks) {
    assert.doesNotMatch(block, /display\s*:\s*none/, 'the credit must never be display:none');
    assert.doesNotMatch(block, /visibility\s*:\s*hidden/, 'the credit must never be hidden');
    assert.doesNotMatch(block, /opacity\s*:\s*0(\D|$)/, 'the credit must never be faded out');
  }
  assert.match(
    css,
    /body\.ui-clean-view #cesium-credits,\s*\n\s*body\.recording-mode #cesium-credits \{[^}]*opacity:\s*1/,
  );
  assert.doesNotMatch(
    css,
    /#intel-hud:not\(\.active\)[\s\S]{0,120}#cesium-credits/,
    'hiding the HUD must not invent a credit-hiding selector',
  );
  assert.doesNotMatch(ui, /getElementById\('cesium-credits'\)[\s\S]{0,80}(display\s*=\s*['"]none|hidden\s*=\s*true)/);
});
