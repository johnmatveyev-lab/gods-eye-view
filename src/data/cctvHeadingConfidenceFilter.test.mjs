import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CCTV_HEADING_CONFIDENCE_STORAGE_KEY,
  DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER,
  cctvHeadingConfidenceLevel,
  filterCctvSourcesByHeadingConfidence,
  normalizeCctvHeadingConfidenceFilter,
  readCctvHeadingConfidenceFilter,
  sourceMatchesHeadingConfidence,
  writeCctvHeadingConfidenceFilter,
} from './cctvHeadingConfidenceFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CATALOG = Object.freeze([
  {
    id: 'high-1',
    name: 'Congress @ 11th',
    city: 'Austin',
    cityId: 'austin',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
  },
  {
    id: 'medium-1',
    name: 'Lamar @ 5th',
    city: 'Austin',
    cityId: 'austin',
    headingConfidence: 'medium',
    feedType: 'image',
    feedConfigured: true,
  },
  {
    id: 'low-1',
    name: 'I-580 West',
    city: 'Oakland',
    cityId: 'ca-d4',
    headingConfidence: 'low',
    feedType: 'mp4',
    feedConfigured: true,
  },
  {
    id: 'unknown-1',
    name: 'Oxford Circus',
    city: 'London',
    cityId: 'london',
    headingConfidence: null,
    feedType: 'image',
    feedConfigured: true,
  },
]);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test('all heading-confidence chips default on and match the current catalog', () => {
  assert.deepEqual(DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER, {
    high: true,
    medium: true,
    low: true,
  });
  assert.deepEqual(normalizeCctvHeadingConfidenceFilter(null), {
    high: true,
    medium: true,
    low: true,
  });
  assert.deepEqual(normalizeCctvHeadingConfidenceFilter('all'), {
    high: true,
    medium: true,
    low: true,
  });
  assert.deepEqual(normalizeCctvHeadingConfidenceFilter({ low: false }), {
    high: true,
    medium: true,
    low: false,
  });
  assert.deepEqual(
    filterCctvSourcesByHeadingConfidence(CATALOG, { high: true, medium: true, low: true })
      .map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
});

test('Low off hides low-confidence headings and keeps high/medium plus unknown', () => {
  assert.equal(cctvHeadingConfidenceLevel('high'), 'high');
  assert.equal(cctvHeadingConfidenceLevel('MEDIUM'), 'medium');
  assert.equal(cctvHeadingConfidenceLevel('low'), 'low');
  assert.equal(cctvHeadingConfidenceLevel(null), null);
  assert.equal(cctvHeadingConfidenceLevel('guess'), null);
  assert.deepEqual(
    filterCctvSourcesByHeadingConfidence(CATALOG, { high: true, medium: true, low: false })
      .map((source) => source.id),
    ['high-1', 'medium-1', 'unknown-1'],
  );
  assert.equal(sourceMatchesHeadingConfidence(CATALOG[2], { low: false }), false);
  assert.equal(sourceMatchesHeadingConfidence(CATALOG[0], { low: false }), true);
  assert.equal(sourceMatchesHeadingConfidence(CATALOG[3], { high: false, medium: false, low: false }), true);
});

test('selected low-confidence camera stays when Low is unchecked', () => {
  const visible = filterCctvSourcesByHeadingConfidence(
    CATALOG,
    { high: true, medium: true, low: false },
    { selectedId: 'low-1' },
  );
  assert.deepEqual(visible.map((source) => source.id), ['high-1', 'medium-1', 'low-1', 'unknown-1']);
  assert.equal(
    sourceMatchesHeadingConfidence(CATALOG[2], { low: false }, { selectedId: 'low-1' }),
    true,
  );
});

test('heading-confidence chips persist with existing CCTV prefs and default all on', () => {
  assert.equal(CCTV_HEADING_CONFIDENCE_STORAGE_KEY, 'meridian.cctvHeadingConfidence');
  const storage = memoryStorage();
  assert.deepEqual(readCctvHeadingConfidenceFilter(storage), {
    high: true,
    medium: true,
    low: true,
  });
  assert.deepEqual(
    writeCctvHeadingConfidenceFilter(storage, { low: false }),
    { high: true, medium: true, low: false },
  );
  assert.equal(
    storage.getItem(CCTV_HEADING_CONFIDENCE_STORAGE_KEY),
    JSON.stringify({ high: true, medium: true, low: false }),
  );
  assert.deepEqual(readCctvHeadingConfidenceFilter(storage), {
    high: true,
    medium: true,
    low: false,
  });
});

test('heading-confidence filter adds no /api and stays off banned sources', () => {
  const apiDir = path.join(ROOT, 'api');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.ok(files.some((file) => file.startsWith('cctv/')));
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/heading.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/filter.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/cctvHeadingConfidenceFilter.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
  assert.doesNotMatch(helper, /\/api\/cctv\/heading|\/api\/cctv\/filter/);
});
