import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntitlements } from './entitlements.js';
import { PLANS } from './plans.js';
import {
  SAVED_VIEWS_CAP,
  canUseSavedViews,
  deleteSavedView,
  loadSavedViews,
  restoreSavedView,
  saveCurrentView,
  savedViewsStorageKey,
  shouldShowSavedViewsButton,
} from './savedViews.js';

const NOON = Date.parse('2026-08-25T12:00:00.000Z');
const PRO_USER = 'user_pro_1';
const SHARE_HREF = 'https://meridian.example/';
const SHARE_HASH = 'v=2&lat=30.2672&lon=-97.7431&alt=800&heading=12&pitch=-35&style=nvg';
const SHARE_URL = `${SHARE_HREF}#${SHARE_HASH}`;

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function entitlementFor(plan) {
  if (plan === PLANS.ANONYMOUS) {
    return resolveEntitlements({
      hosted: true,
      signedIn: false,
      stripeConfigured: true,
      clerkConfigured: true,
      nowMs: NOON,
    });
  }
  return resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan,
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
}

test('Free and anonymous hide Saved views and cannot write localStorage', () => {
  const storage = memoryStorage();
  for (const plan of [PLANS.FREE, PLANS.ANONYMOUS]) {
    const entitlement = entitlementFor(plan);
    assert.equal(canUseSavedViews(entitlement), false);
    assert.equal(shouldShowSavedViewsButton(entitlement), false);

    const result = saveCurrentView({
      storage,
      userId: plan === PLANS.ANONYMOUS ? null : 'user_free_1',
      entitlement,
      name: 'Austin',
      url: SHARE_URL,
      nowMs: NOON,
      id: 'sv_forbidden',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unavailable');
    assert.deepEqual(storage.keys(), []);
    assert.deepEqual(loadSavedViews(storage, 'user_free_1'), []);
  }
});

test('Free cannot save even when a Clerk user id is present', () => {
  const storage = memoryStorage();
  const result = saveCurrentView({
    storage,
    userId: PRO_USER,
    entitlement: entitlementFor(PLANS.FREE),
    name: 'Should not persist',
    url: SHARE_URL,
    nowMs: NOON,
    id: 'sv_free',
  });
  assert.equal(result.ok, false);
  assert.equal(storage.getItem(savedViewsStorageKey(PRO_USER)), null);
});

test('Pro save, restore, delete, and reload stay inside a 10-view cap', () => {
  const storage = memoryStorage();
  const entitlement = entitlementFor(PLANS.PRO);
  assert.equal(canUseSavedViews(entitlement), true);
  assert.equal(shouldShowSavedViewsButton(entitlement), true);
  assert.equal(entitlement.savedViews.placeholder, false);
  assert.equal(savedViewsStorageKey(PRO_USER), `meridian.savedViews.${PRO_USER}`);

  const first = saveCurrentView({
    storage,
    userId: PRO_USER,
    entitlement,
    name: 'Austin dusk',
    url: SHARE_URL,
    nowMs: NOON,
    id: 'sv_1',
  });
  assert.equal(first.ok, true);
  assert.equal(first.item.id, 'sv_1');
  assert.equal(first.item.name, 'Austin dusk');
  assert.equal(first.item.createdAt, new Date(NOON).toISOString());
  assert.equal(first.item.url, SHARE_URL);
  assert.equal(first.items.length, 1);

  const reloaded = loadSavedViews(storage, PRO_USER);
  assert.equal(reloaded.length, 1);
  assert.deepEqual(reloaded[0], first.item);

  const assigned = [];
  const restored = restoreSavedView({
    entitlement,
    url: reloaded[0].url,
    assignLocation: (href) => assigned.push(href),
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(assigned, [SHARE_URL]);

  const removed = deleteSavedView({
    storage,
    userId: PRO_USER,
    entitlement,
    id: 'sv_1',
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(loadSavedViews(storage, PRO_USER), []);

  for (let index = 0; index < SAVED_VIEWS_CAP; index += 1) {
    const saved = saveCurrentView({
      storage,
      userId: PRO_USER,
      entitlement,
      name: `View ${index + 1}`,
      url: `${SHARE_HREF}#v=2&lat=${index}&lon=0&style=normal`,
      nowMs: NOON + index,
      id: `sv_cap_${index}`,
    });
    assert.equal(saved.ok, true);
  }
  const overflow = saveCurrentView({
    storage,
    userId: PRO_USER,
    entitlement,
    name: 'View 11',
    url: `${SHARE_HREF}#v=2&lat=99&lon=0&style=normal`,
    nowMs: NOON + 99,
    id: 'sv_cap_overflow',
  });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, 'cap');
  assert.equal(loadSavedViews(storage, PRO_USER).length, SAVED_VIEWS_CAP);
  assert.equal(loadSavedViews(storage, PRO_USER).some((item) => item.id === 'sv_cap_overflow'), false);
});
