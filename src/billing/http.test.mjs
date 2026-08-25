import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BILLING_CODES } from './entitlements.js';
import { createBillingRuntime, handleBillingHttp, authorizeVoiceRequest } from './http.js';
import { PLANS } from './plans.js';
import { createAccountStore } from './store.js';

function mockReq({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return req;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) { this.body = chunk || ''; },
    headersSent: false,
  };
  return res;
}

async function dispatch(runtime, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handleBillingHttp(req, res, runtime);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

function hostedRuntime(overrides = {}) {
  const store = createAccountStore({ now: () => Date.parse('2026-08-25T12:00:00.000Z') });
  return createBillingRuntime({
    env: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      STRIPE_SECRET_KEY: 'sk_test_stripe',
      STRIPE_PRICE_PRO: 'price_env_pro',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
    },
    now: () => Date.parse('2026-08-25T12:00:00.000Z'),
    store,
    verifyToken: async () => ({ sub: 'user_abc', email: 'ops@example.com' }),
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async (params) => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', params }),
        },
      },
      billingPortal: {
        sessions: {
          create: async () => ({ url: 'https://billing.stripe.com/session/test' }),
        },
      },
      webhooks: {
        constructEvent: (raw) => JSON.parse(String(raw)),
      },
    }),
    ...overrides,
  });
}

test('config never leaks Stripe or Clerk secrets', async () => {
  const { json } = await dispatch(hostedRuntime(), { url: '/api/billing/config' });
  const serialized = JSON.stringify(json);
  assert.equal(json.hosted, true);
  assert.equal(json.stripeConfigured, true);
  assert.equal(json.pro.priceUsd, 29);
  assert.doesNotMatch(serialized, /sk_test/);
  assert.doesNotMatch(serialized, /whsec_/);
  assert.doesNotMatch(serialized, /price_env_pro/);
});

test('unsigned hosted /me is anonymous with no voice', async () => {
  const { status, json } = await dispatch(hostedRuntime(), { url: '/api/billing/me' });
  assert.equal(status, 200);
  assert.equal(json.plan, PLANS.ANONYMOUS);
  assert.equal(json.signedIn, false);
  assert.equal(json.voice, false);
  assert.equal(json.exhausted, false);
});

test('signed-in Free account can start Checkout against the env price ID', async () => {
  const created = [];
  const runtime = hostedRuntime({
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async (params) => {
            created.push(params);
            return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
          },
        },
      },
    }),
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { authorization: 'Bearer sess_test', host: 'meridian.example' },
  });
  assert.equal(status, 200);
  assert.equal(json.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(created[0].line_items[0].price, 'price_env_pro');
  assert.equal(created[0].mode, 'subscription');
  assert.equal('payment_method_types' in created[0], false);
});

test('checkout degrades with a clear message when Stripe env is missing', async () => {
  const runtime = hostedRuntime({
    env: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
    },
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { authorization: 'Bearer sess_test' },
  });
  assert.equal(status, 503);
  assert.equal(json.code, BILLING_CODES.STRIPE_NOT_CONFIGURED);
  assert.match(json.error, /STRIPE_SECRET_KEY/);
});

test('webhook marks the account Pro without live Stripe keys', async () => {
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
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(status, 200);
  assert.equal(json.applied, true);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.PRO);

  const voice = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(voice.ok, true);
});

test('voice stays forbidden for Free after a failed upgrade path', async () => {
  const runtime = hostedRuntime();
  const voice = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(voice.ok, false);
  assert.equal(voice.body.code, BILLING_CODES.VOICE_REQUIRES_PRO);
});

test('usage heartbeats exhaust the Free daily session cap', async () => {
  const runtime = hostedRuntime();
  let json;
  for (let i = 0; i < 8; i += 1) {
    ({ json } = await dispatch(runtime, {
      method: 'POST',
      url: '/api/billing/usage',
      headers: { authorization: 'Bearer sess_test' },
      body: { kind: 'session', seconds: 120 },
    }));
  }
  assert.equal(json.plan, PLANS.FREE);
  assert.equal(json.exhausted, true);
  assert.equal(json.remaining.sessionSeconds, 0);
  assert.equal(json.voice, false);
});

test('LICENSE keeps the required MIT copyright line', async () => {
  const { readFileSync } = await import('node:fs');
  const license = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});

test('self-host without Clerk does not require a token for voice', async () => {
  const runtime = createBillingRuntime({ env: {} });
  const voice = await authorizeVoiceRequest(mockReq({ url: '/api/realtime/token' }), runtime);
  assert.equal(voice.ok, true);
  assert.equal(voice.hosted, false);
});
