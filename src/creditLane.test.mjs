import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MERIDIAN_TERMS } from './billing/plans.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');

const REM_PX = 16;
const LANE_WIDTHS = [1280, 800];
const MIN_GAP_PX = 8;

function readRootVar(name) {
  const block = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(block, ':root rule is missing');
  const match = block[1].match(new RegExp(`${name}:\\s*([\\d.]+)rem`));
  assert.ok(match, `reserved ${name} is missing from :root`);
  return Number(match[1]) * REM_PX;
}

function lastPlainDecl(selector, prop) {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  let value;
  for (const match of css.matchAll(pattern)) {
    const decl = match[1].match(new RegExp(`${prop}:\\s*([^;]+);`));
    if (decl) value = decl[1].trim();
  }
  return value;
}

function clamp(min, preferred, max) {
  return Math.min(max, Math.max(min, preferred));
}

function dockUnifiedWidth(viewportWidth) {
  const side = viewportWidth <= 620
    ? 3.25 * REM_PX
    : viewportWidth <= 900
      ? 4.25 * REM_PX
      : clamp(9.5 * REM_PX, viewportWidth * 0.12, 10.5 * REM_PX);
  const voice = lastPlainDecl('#command-dock', '--dock-voice-width');
  assert.match(String(voice), /^[\d.]+rem$/, 'command dock voice width must stay a rem token');
  return side * 2 + Number.parseFloat(voice) * REM_PX;
}

function reservedLane(viewportWidth) {
  const laneWidth = readRootVar('--credit-lane-width');
  const gap = readRootVar('--credit-lane-gap');
  const dockWidth = dockUnifiedWidth(viewportWidth);
  const reservedAnchor = laneWidth + gap + dockWidth / 2;
  const dockLeft = Math.max(viewportWidth / 2, reservedAnchor) - dockWidth / 2;
  return {
    laneWidth,
    gap,
    credits: { left: 0, right: laneWidth },
    terms: { left: 0, right: laneWidth },
    dock: { left: dockLeft, right: dockLeft + dockWidth, width: dockWidth },
  };
}

test('the MIT disclaimer stays the full independent-product sentence', () => {
  assert.match(html, /id="meridian-terms"/);
  assert.match(html, /Meridian is independent, based on the MIT-licensed God's Eye View project/);
  assert.equal(
    MERIDIAN_TERMS,
    'Meridian is independent, based on the MIT-licensed God\'s Eye View project. '
    + 'It is not affiliated with, endorsed by, or an official continuation of '
    + 'Bilawal Sidhu or the God\'s Eye View series.',
  );
  assert.match(ui, /pinRequiredCredits\(\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'responsibleUseNotice.js'), 'utf8'), /terms\.textContent = MERIDIAN_TERMS/);
  assert.match(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(html, /<title>Meridian<\/title>/);
});

test('credits sit above the LOCATION dock and stay clickable', () => {
  const creditZ = Number(lastPlainDecl('#cesium-credits', 'z-index'));
  const dockZ = Number(lastPlainDecl('#command-dock', 'z-index'));
  assert.ok(Number.isFinite(creditZ) && Number.isFinite(dockZ), 'credit and dock z-index must resolve');
  assert.ok(creditZ > dockZ, `credits z-index ${creditZ} must sit above the dock (${dockZ})`);
  assert.match(css, /#cesium-credits a,\s*\n\s*#cesium-credits \.cesium-credit-expand-link \{/);
  assert.doesNotMatch(
    css,
    /#cesium-credits \.cesium-credit-expand-link \{[^}]*(pointer-events\s*:\s*none|display\s*:\s*none)/,
    'Data attribution must remain a real click target',
  );
  assert.match(html, /id="command-dock"[\s\S]*class="location-inner"/);
});

test('LOCATION dock starts after the reserved credit lane', () => {
  assert.ok(
    /#command-dock \{[^}]*left:\s*max\(\s*50%\s*,\s*calc\(\s*var\(--credit-lane-width\)/.test(css),
    'the dock must start after --credit-lane-width instead of covering Data attribution',
  );
  assert.ok(
    /#meridian-terms \{[^}]*max-width:\s*var\(--credit-lane-width\)/.test(css),
    'the MIT line must wrap inside the reserved lane, not under LOCATION',
  );
  assert.ok(
    /max-width:\s*var\(--credit-lane-width\)/.test(css)
    && /#cesium-credits/.test(css),
    '#cesium-credits must live in the reserved lane',
  );
  const creditLaneRule = css.slice(css.indexOf('body:not(.ui-clean-view):not(.recording-mode) #cesium-credits,'));
  assert.ok(
    /max-width:\s*(var\(--credit-lane-width\)|calc\(\s*var\(--credit-lane-width\))/.test(creditLaneRule),
    'the on-globe credit line must use the reserved lane width',
  );
});

test('the credit lane stays clear of LOCATION at 1280 and 800', () => {
  const failures = [];
  for (const width of LANE_WIDTHS) {
    const boxes = reservedLane(width);
    if (boxes.dock.left + 0.01 < boxes.credits.right + MIN_GAP_PX) {
      failures.push(
        `${width}px credits end at ${boxes.credits.right.toFixed(1)} and dock starts at ${boxes.dock.left.toFixed(1)}`,
      );
    }
    if (boxes.dock.left + 0.01 < boxes.terms.right + MIN_GAP_PX) {
      failures.push(
        `${width}px MIT line ends at ${boxes.terms.right.toFixed(1)} and dock starts at ${boxes.dock.left.toFixed(1)}`,
      );
    }
    if (boxes.dock.right > width + 0.5) {
      failures.push(`${width}px dock overflows to ${boxes.dock.right.toFixed(1)}`);
    }
  }
  assert.deepEqual(failures, [], `LOCATION covers the reserved credit lane:\n  ${failures.join('\n  ')}\n`);
});

test('clean view still shows credits and does not invent a hide path', () => {
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
    /body\.ui-clean-view #cesium-credits[\s\S]{0,200}display\s*:\s*none/,
  );
  assert.doesNotMatch(ui, /getElementById\('cesium-credits'\)[\s\S]{0,120}(display\s*=\s*['"]none|hidden\s*=\s*true)/);
  assert.match(ui, /pinRequiredCredits\(\)/);
  const creditsJs = fs.readFileSync(path.join(ROOT, 'src', 'data', 'dataCredits.js'), 'utf8');
  assert.match(creditsJs, /style\.setProperty\('opacity', '1', 'important'\)/);
  assert.match(creditsJs, /style\.setProperty\('visibility', 'visible', 'important'\)/);
  assert.match(creditsJs, /style\.setProperty\('pointer-events', 'auto', 'important'\)/);
  assert.doesNotMatch(creditsJs, /display:\s*none|hidden\s*=\s*true/);
});
