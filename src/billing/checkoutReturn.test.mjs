import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAccount } from './accountChrome.js';
import {
  CHECKOUT_CANCELED_COPY,
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_TIMEOUT_MS,
  CHECKOUT_PRO_ACTIVE_COPY,
  CHECKOUT_WAITING_COPY,
  handleCheckoutReturn,
} from './checkoutReturn.js';
import { PLANS, PRO_PRICE_USD } from './plans.js';

const FREE_ME = Object.freeze({
  plan: PLANS.FREE,
  signedIn: true,
  voice: false,
  savedViews: { available: false, placeholder: true, items: [] },
  exhausted: false,
  remaining: { sessionSeconds: 15 * 60, requestUnits: 120 },
  upgrade: { available: true, priceUsd: PRO_PRICE_USD },
  stripeConfigured: true,
});

const PRO_ME = Object.freeze({
  plan: PLANS.PRO,
  signedIn: true,
  voice: true,
  savedViews: { available: true, placeholder: true, items: [] },
  exhausted: false,
  remaining: { sessionSeconds: 8 * 60 * 60, requestUnits: 4000 },
  upgrade: { available: false, priceUsd: PRO_PRICE_USD },
  stripeConfigured: true,
});

function createClock() {
  let nowMs = 0;
  let sleeps = 0;
  return {
    now: () => nowMs,
    async sleep(ms) {
      sleeps += 1;
      if (sleeps > 20) throw new Error('checkout return poll looped forever');
      nowMs += ms;
    },
    get sleeps() { return sleeps; },
    get nowMs() { return nowMs; },
  };
}

function createRoot(planText = 'FREE') {
  return {
    plan: { textContent: planText },
    budget: { textContent: '15 min left today' },
    signIn: { hidden: true },
    user: { hidden: false, childElementCount: 1 },
    upgrade: { hidden: false },
    manage: { hidden: true },
    saved: { hidden: true },
    exhausted: { hidden: true, querySelector() { return { textContent: '' }; } },
  };
}

function createSession({ search, meQueue, clock = createClock() }) {
  const requests = [];
  const toasts = [];
  const href = { current: `https://meridian.example/${search}` };
  const root = createRoot();
  const account = {
    clerk: { user: { id: 'user_abc' } },
    entitlement: { ...FREE_ME },
    config: { stripeConfigured: true },
  };
  renderAccount(root, account);

  const location = {
    get pathname() { return '/'; },
    get search() {
      const url = new URL(href.current);
      return url.search;
    },
    get hash() {
      const url = new URL(href.current);
      return url.hash;
    },
  };
  const history = {
    replaceState(_state, _title, next) {
      href.current = new URL(next, 'https://meridian.example').href;
    },
  };

  const queue = [...meQueue];
  const fetchMe = async () => {
    requests.push({ method: 'GET', url: '/api/billing/me' });
    if (!queue.length) return { ...FREE_ME };
    return queue.shift();
  };

  return {
    root,
    account,
    requests,
    toasts,
    href,
    clock,
    run: () => handleCheckoutReturn({
      location,
      history,
      fetchMe,
      applyEntitlement: (entitlement) => {
        account.entitlement = entitlement;
        renderAccount(root, account);
      },
      showToast: (message) => { toasts.push(message); },
      startCheckout: () => {
        requests.push({ method: 'POST', url: '/api/billing/checkout' });
      },
      now: clock.now,
      sleep: clock.sleep,
    }),
  };
}

test('checkout success polls /me from Free to Pro, flips the chip, and never starts a second checkout', async () => {
  const session = createSession({
    search: '?checkout=success',
    meQueue: [{ ...FREE_ME }, { ...PRO_ME }],
  });

  const result = await session.run();

  assert.equal(result.status, 'pro');
  assert.equal(session.root.plan.textContent, 'PRO');
  assert.equal(session.root.saved.hidden, false);
  assert.equal(session.root.manage.hidden, false);
  assert.equal(session.account.entitlement.voice, true);
  assert.equal(session.toasts.at(-1), CHECKOUT_PRO_ACTIVE_COPY);
  assert.equal(session.requests.filter((req) => req.url === '/api/billing/checkout').length, 0);
  assert.deepEqual(session.requests, [
    { method: 'GET', url: '/api/billing/me' },
    { method: 'GET', url: '/api/billing/me' },
  ]);
  assert.equal(new URL(session.href.current).searchParams.get('checkout'), null);
});

test('checkout success that stays Free for 30s keeps waiting copy and does not poll forever', async () => {
  const session = createSession({
    search: '?checkout=success',
    meQueue: [],
  });

  const result = await session.run();

  assert.equal(result.status, 'waiting');
  assert.equal(session.root.plan.textContent, 'FREE');
  assert.equal(session.root.saved.hidden, true);
  assert.equal(session.toasts.at(-1), CHECKOUT_WAITING_COPY);
  assert.match(CHECKOUT_WAITING_COPY, /webhook/i);
  assert.ok(session.clock.nowMs >= CHECKOUT_POLL_TIMEOUT_MS);
  assert.ok(session.clock.sleeps <= Math.ceil(CHECKOUT_POLL_TIMEOUT_MS / CHECKOUT_POLL_INTERVAL_MS));
  assert.ok(session.requests.length >= 1);
  assert.ok(session.requests.length <= 1 + Math.ceil(CHECKOUT_POLL_TIMEOUT_MS / CHECKOUT_POLL_INTERVAL_MS));
  assert.equal(session.requests.every((req) => req.method === 'GET' && req.url === '/api/billing/me'), true);
  assert.equal(session.requests.filter((req) => req.url === '/api/billing/checkout').length, 0);
});

test('failed checkout param keeps the canceled toast and does not poll /me', async () => {
  const session = createSession({
    search: '?checkout=canceled',
    meQueue: [{ ...PRO_ME }],
  });

  const result = await session.run();

  assert.equal(result.status, 'canceled');
  assert.equal(session.toasts.at(-1), CHECKOUT_CANCELED_COPY);
  assert.equal(session.root.plan.textContent, 'FREE');
  assert.equal(session.account.entitlement.voice, false);
  assert.deepEqual(session.requests, []);
  assert.equal(new URL(session.href.current).searchParams.get('checkout'), null);
});
