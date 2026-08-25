import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CLEAN_VIEW_BODY_CLASS,
  CLEAN_VIEW_CHROME_ID,
  handleCleanViewEscape,
  isCleanView,
  setCleanViewEnabled,
  syncCleanViewButton,
  toggleCleanViewClass,
} from './cleanViewChrome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

function mockDoc({ clean = false } = {}) {
  const classes = new Set(clean ? [CLEAN_VIEW_BODY_CLASS] : []);
  return {
    body: {
      classList: {
        contains: (name) => classes.has(name),
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
          return force;
        },
      },
    },
  };
}

function makeButton() {
  const icon = { textContent: 'visibility_off' };
  return {
    attrs: {},
    className: '',
    classList: {
      toggle(name, force) {
        this._on = force;
        this._name = name;
      },
      _on: false,
    },
    querySelector(sel) { return sel === '.material-symbols-outlined' ? icon : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    icon,
  };
}

describe('Clean view chrome next to Fullscreen', () => {
  it('sits immediately after #fullscreen-view in the top-center camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, new RegExp(`id="${CLEAN_VIEW_CHROME_ID}"`));
    assert.match(block, /fullscreen-view[\s\S]*clean-view-chrome/);
    assert.match(block, /aria-label="Clean view"/);
    assert.match(block, /title="Clean view"/);
    assert.equal((html.match(/id="clean-view-chrome"/g) || []).length, 1);
    assert.match(html, /id="clean-view-toggle"/, 'Display Clean UI stays; this is not a replacement');
    assert.match(html, /id="clean-view-exit"/, 'EXIT CLEAN VIEW remains the on-globe restore click');
  });

  it('StyleManager wires the button and Escape restore through toggleCleanView', () => {
    const ui = src('ui.js');
    assert.match(ui, /getElementById\('clean-view-chrome'\)/);
    assert.match(ui, /from '\.\/cleanViewChrome\.js'/);
    assert.match(ui, /handleCleanViewEscape\(/);
    assert.match(ui, /syncCleanViewButton\(/);
    assert.match(ui, /this\._cleanViewChromeBtn\?\.addEventListener\('click', \(\) => this\.toggleCleanView\(\)\)/);
    assert.match(
      ui,
      /if \(e\.key === 'Escape'\)[\s\S]*?handleCleanViewEscape\(e\)[\s\S]*?this\.toggleCleanView\(false\)/,
    );
  });

  it('reuses ui-clean-view; does not invent a second hide class or /api', () => {
    const chrome = src('cleanViewChrome.js');
    assert.equal(CLEAN_VIEW_BODY_CLASS, 'ui-clean-view');
    assert.match(chrome, /ui-clean-view/);
    assert.doesNotMatch(chrome, /['"]ui-hide-chrome['"]|['"]clean-view-mode['"]|['"]hide-chrome['"]/);
    assert.doesNotMatch(chrome, /\/api\//);
    assert.doesNotMatch(chrome, /clerk/i);
    assert.doesNotMatch(chrome, /opensky|google news|telegeography|quantum-earth/i);
    assert.doesNotMatch(chrome, /God's Eye View|GEV\b/);
  });

  it('hides with the other camera chrome in cockpit; recording hides the group', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#clean-view-chrome/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
    assert.match(css, /body\.ui-clean-view #top-center-actions/);
  });
});

describe('toggle and Escape restore the existing hide-chrome path', () => {
  it('toggles the existing body class and a second call restores', () => {
    const doc = mockDoc();
    assert.equal(isCleanView(doc), false);
    assert.equal(toggleCleanViewClass(doc), true);
    assert.equal(isCleanView(doc), true);
    assert.equal(toggleCleanViewClass(doc), false);
    assert.equal(isCleanView(doc), false);
  });

  it('Escape restores chrome when clean view is on', () => {
    const doc = mockDoc({ clean: true });
    const event = { key: 'Escape', preventDefault() { this.prevented = true; } };
    assert.equal(handleCleanViewEscape(event, doc), true);
    assert.equal(isCleanView(doc), false);
    assert.equal(event.prevented, true);
  });

  it('Escape is a no-op when clean view is off', () => {
    const doc = mockDoc();
    const event = { key: 'Escape', preventDefault() { this.prevented = true; } };
    assert.equal(handleCleanViewEscape(event, doc), false);
    assert.equal(event.prevented, undefined);
    assert.equal(isCleanView(doc), false);
  });

  it('icon and pressed state track the existing class', () => {
    const button = makeButton();
    syncCleanViewButton(button, false);
    assert.equal(button.icon.textContent, 'visibility_off');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Clean view');

    syncCleanViewButton(button, true);
    assert.equal(button.icon.textContent, 'visibility');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.getAttribute('aria-label'), 'Exit clean view');
    assert.match(button.title || button.getAttribute('title') || '', /Esc/);
  });

  it('setCleanViewEnabled writes only ui-clean-view', () => {
    const doc = mockDoc();
    assert.equal(setCleanViewEnabled(true, doc), true);
    assert.equal(isCleanView(doc), true);
    assert.equal(setCleanViewEnabled(false, doc), false);
    assert.equal(isCleanView(doc), false);
  });
});

describe('credits stay on; fullscreen still works', () => {
  it('clean-view chrome never hides #cesium-credits', () => {
    const chrome = src('cleanViewChrome.js');
    assert.match(chrome, /#cesium-credits/);
    assert.doesNotMatch(chrome, /cesium-credits[\s\S]{0,80}(display|opacity|visibility)/);
    const ui = src('ui.js');
    const cleanView = ui.slice(
      ui.indexOf('toggleCleanView(forceEnabled)'),
      ui.indexOf('cycleHud()'),
    );
    assert.match(cleanView, /pinRequiredCredits\(\)/);
    assert.doesNotMatch(cleanView, /cesium-credits[\s\S]{0,80}(display\s*=\s*['"]none|opacity\s*=\s*['"]0)/);
  });

  it('existing fade list covers panels/HUD chrome and exempts the credit line', () => {
    const css = root('style.css');
    const start = css.indexOf('body.ui-clean-view #title-bar');
    assert.ok(start >= 0);
    const selectors = css.slice(start, css.indexOf('{', start));
    assert.match(selectors, /#pp-toggles/);
    assert.match(selectors, /#data-panel/);
    assert.match(selectors, /#command-dock|#top-center-actions/);
    assert.doesNotMatch(selectors, /#cesium-credits/);
    assert.match(
      css,
      /body\.ui-clean-view #cesium-credits,\s*\n\s*body\.recording-mode #cesium-credits \{[^}]*opacity:\s*1/,
    );
  });

  it('fullscreen and clean view stay independent; credits pinned in both', () => {
    const fullscreen = src('fullscreenChrome.js');
    const clean = src('cleanViewChrome.js');
    assert.doesNotMatch(fullscreen, /ui-clean-view/);
    assert.doesNotMatch(clean, /requestFullscreen|exitFullscreen|cesiumContainer/);
    const css = root('style.css');
    assert.match(css, /:fullscreen #cesium-credits/);
    const fsBlock = css.match(/:fullscreen #cesium-credits[\s\S]*?\{([^}]*)\}/)[1];
    assert.match(fsBlock, /opacity:\s*1/);
    assert.doesNotMatch(fsBlock, /display\s*:\s*none/);
  });
});
