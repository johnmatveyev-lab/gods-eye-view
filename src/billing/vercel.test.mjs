import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_CODES } from './entitlements.js';
import { createBillingRuntime } from './http.js';
import { PLANS } from './plans.js';
import { createAccountStore } from './store.js';
import billingHandler, { createVercelBillingHandler, restoreApiPath } from './vercel.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const VERCEL_BILLING_FILES = Object.freeze([
  'api/billing/[...path].js',
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
        constructEvent: (raw, signature) => {
          if (signature !== 'sig_test') throw new Error('Invalid Stripe webhook signature.');
          return JSON.parse(String(raw));
        },
      },
    }),
    ...overrides,
  });
}

function mockReq({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

async function dispatch(runtime, options) {
  const handler = createVercelBillingHandler('/api/billing', () => runtime);
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
  };
}

test('Vercel Node entrypoints forward to handleBillingHttp', () => {
  for (const file of VERCEL_BILLING_FILES) {
    const absolute = path.join(ROOT, file);
    assert.equal(existsSync(absolute), true, `missing ${file}`);
    const source = readFileSync(absolute, 'utf8');
    assert.match(source, /createVercelBillingHandler|from '\.\.\/\.\.\/src\/billing\/vercel\.js'/);
    assert.doesNotMatch(source, /export \{ GET, POST \}/);
    assert.doesNotMatch(source, /sk_live|sk_test_|whsec_/);
  }
  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/billing/[...path].js']);
  assert.ok(vercelJson.functions['api/stripe/webhook.js']);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
    assert.doesNotMatch(rule.destination, /index\.html|ais-live|opensky/i);
  }
});

test('GET /api/billing/config → 200 JSON, pro.priceUsd=29, no secrets', async () => {
  const { status, json } = await dispatch(hostedRuntime(), { url: '/api/billing/config' });
  assert.equal(status, 200);
  assert.equal(json.pro.priceUsd, 29);
  const serialized = JSON.stringify(json);
  assert.doesNotMatch(serialized, /sk_test|whsec_|price_env_pro|x-vercel-error|NOT_FOUND/);
});

test('GET /api/billing/me → 200 plan=anonymous', async () => {
  const { status, json } = await dispatch(hostedRuntime(), { url: '/api/billing/me' });
  assert.equal(status, 200);
  assert.equal(json.plan, PLANS.ANONYMOUS);
  assert.equal(json.voice, false);
});

test('POST /api/billing/checkout {} → 401 auth_required or 503 clerk_not_configured', async () => {
  const hosted = await dispatch(hostedRuntime(), {
    method: 'POST',
    url: '/api/billing/checkout',
    body: {},
  });
  assert.notEqual(hosted.status, 404);
  assert.ok(hosted.status === 401 || hosted.status === 503);
  assert.ok(
    hosted.json.code === BILLING_CODES.AUTH_REQUIRED
    || hosted.json.code === BILLING_CODES.CLERK_NOT_CONFIGURED,
  );

  const unset = await dispatch(createBillingRuntime({ env: { VERCEL: '1' } }), {
    method: 'POST',
    url: '/api/billing/checkout',
    body: {},
  });
  assert.equal(unset.status, 503);
  assert.equal(unset.json.code, BILLING_CODES.CLERK_NOT_CONFIGURED);
});

test('POST /api/stripe/webhook with stripe-signature: test → 400 invalid signature', async () => {
  const handler = createVercelBillingHandler('/api/stripe/webhook', () => hostedRuntime());
  const req = mockReq({
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'test' },
    body: {},
  });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.match(json.error, /invalid stripe webhook signature/i);
  assert.doesNotMatch(res.body, /x-vercel-error|NOT_FOUND|whsec_/);
});

test('GET /api/billing/create-checkout-session still 404 from handleBillingHttp', async () => {
  const { status, json } = await dispatch(hostedRuntime(), {
    url: '/api/billing/create-checkout-session',
  });
  assert.equal(status, 404);
  assert.equal(json.error, 'Not found');
  assert.equal(json.error?.code, undefined);
});

test('catch-all leftover /config still reaches handleBillingHttp', async () => {
  const req = mockReq({ method: 'GET', url: '/config' });
  const res = mockRes();
  await billingHandler(req, res);
  assert.equal(req.url, '/api/billing/config');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).pro.priceUsd, 29);
});

test('restoreApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreApiPath('/config', '/api/billing'), '/api/billing/config');
  assert.equal(restoreApiPath('/api/billing/me', '/api/billing'), '/api/billing/me');
  assert.equal(restoreApiPath('/', '/api/stripe/webhook'), '/api/stripe/webhook');
});
