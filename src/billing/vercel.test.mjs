import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_CODES } from './entitlements.js';
import { createBillingRuntime } from './http.js';
import { PLANS } from './plans.js';
import { createAccountStore } from './store.js';
import { handleVercelBilling } from './vercel.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const VERCEL_BILLING_FILES = Object.freeze([
  'api/billing/config.js',
  'api/billing/me.js',
  'api/billing/usage.js',
  'api/billing/checkout.js',
  'api/billing/portal.js',
  'api/billing/webhook.js',
  'api/stripe/webhook.js',
]);

function hostedRuntime(overrides = {}) {
  const store = createAccountStore({ now: () => Date.parse('2026-08-25T12:00:00.000Z') });
  return createBillingRuntime({
    env: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      STRIPE_SECRET_KEY: 'sk_test_stripe',
      STRIPE_PRICE_PRO: 'price_env_pro',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      VERCEL: '1',
    },
    now: () => Date.parse('2026-08-25T12:00:00.000Z'),
    store,
    verifyToken: async () => ({ sub: 'user_abc', email: 'ops@example.com' }),
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async () => ({ id: 'cs_vercel', url: 'https://checkout.stripe.com/c/pay/cs_vercel' }),
        },
      },
      webhooks: {
        constructEvent: (raw) => JSON.parse(String(raw)),
      },
    }),
    ...overrides,
  });
}

async function dispatch(runtime, { method = 'GET', url, headers = {}, body } = {}) {
  const request = new Request(`https://meridian.example${url}`, {
    method,
    headers,
    body: body == null || method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const response = await handleVercelBilling(request, runtime);
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, text };
}

test('Vercel function entry files exist for every hosted money-path route', () => {
  for (const file of VERCEL_BILLING_FILES) {
    const absolute = path.join(ROOT, file);
    assert.equal(existsSync(absolute), true, `missing ${file}`);
    const source = readFileSync(absolute, 'utf8');
    assert.match(source, /export \{ GET, POST \}/);
    assert.doesNotMatch(source, /sk_live|sk_test_|whsec_/);
  }
  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/billing/**/*.js']);
  assert.ok(vercelJson.functions['api/stripe/**/*.js']);
});

test('Vercel adapter serves /api/billing/config instead of a platform 404', async () => {
  const { status, json } = await dispatch(hostedRuntime(), { url: '/api/billing/config' });
  assert.equal(status, 200);
  assert.equal(json.hosted, true);
  assert.equal(json.pro.priceUsd, 29);
  assert.doesNotMatch(JSON.stringify(json), /sk_test|whsec_|price_env_pro/);
});

test('Vercel adapter checkout is 503 with a reason when billing env is unset', async () => {
  const runtime = createBillingRuntime({ env: { VERCEL: '1' } });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
  });
  assert.notEqual(status, 404);
  assert.equal(status, 503);
  assert.equal(json.code, BILLING_CODES.CLERK_NOT_CONFIGURED);
  assert.ok(json.missing.includes('CLERK_SECRET_KEY'));
});

test('Vercel adapter checkout requires a session once Clerk is configured', async () => {
  const { status, json } = await dispatch(hostedRuntime(), {
    method: 'POST',
    url: '/api/billing/checkout',
  });
  assert.equal(status, 401);
  assert.equal(json.code, BILLING_CODES.AUTH_REQUIRED);
});

test('Vercel adapter applies checkout.session.completed on the webhook route', async () => {
  const runtime = hostedRuntime();
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_vercel',
          subscription: 'sub_vercel',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(status, 200);
  assert.equal(json.applied, true);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.PRO);
});
