import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CCTV_UNHEALTHY_STATUS_TOKENS,
  filterVisibleCctvSources,
  isKnownUnhealthyCctvStatus,
  sourceMatchesHealthFilter,
} from './cctvHealthFilter.js';

const CATALOG = Object.freeze([
  { id: 'ok-1', cityId: 'austin', city: 'Austin', feedType: 'mp4', feedConfigured: true, sourceStatus: 'ok' },
  { id: 'err-1', cityId: 'austin', city: 'Austin', feedType: 'image', feedConfigured: true, sourceStatus: 'error' },
  { id: 'unk-1', cityId: 'austin', city: 'Austin', feedType: 'hls', feedConfigured: true, sourceStatus: 'unknown' },
  { id: 'miss-1', cityId: 'austin', city: 'Austin', feedType: 'mp4', feedConfigured: true },
  { id: 'deg-1', cityId: 'austin', city: 'Austin', feedType: 'image', feedConfigured: true, sourceStatus: 'degraded' },
  { id: 'stale-1', cityId: 'london', city: 'London', feedType: 'webm', feedConfigured: true, sourceStatus: 'stale' },
]);

test('known-unhealthy tokens hide; ok / unknown / missing / degraded stay', () => {
  for (const token of CCTV_UNHEALTHY_STATUS_TOKENS) {
    assert.equal(isKnownUnhealthyCctvStatus(token), true, token);
    assert.equal(isKnownUnhealthyCctvStatus(token.toUpperCase()), true, token);
  }
  assert.equal(isKnownUnhealthyCctvStatus('UPSTREAM UNAVAILABLE'), true);
  assert.equal(isKnownUnhealthyCctvStatus('ok'), false);
  assert.equal(isKnownUnhealthyCctvStatus('unknown'), false);
  assert.equal(isKnownUnhealthyCctvStatus('degraded'), false);
  assert.equal(isKnownUnhealthyCctvStatus(''), false);
  assert.equal(isKnownUnhealthyCctvStatus(null), false);

  const hidden = filterVisibleCctvSources(CATALOG, { hideUnhealthy: true });
  assert.deepEqual(hidden.map((source) => source.id), ['ok-1', 'unk-1', 'miss-1', 'deg-1']);
});

test('health map lookup wins over a stale sourceStatus copy', () => {
  const healthById = new Map([
    ['ok-1', { status: 'failed' }],
    ['err-1', { status: 'ok' }],
  ]);
  assert.equal(sourceMatchesHealthFilter(CATALOG[0], true, null, healthById), false);
  assert.equal(sourceMatchesHealthFilter(CATALOG[1], true, null, healthById), true);
});
