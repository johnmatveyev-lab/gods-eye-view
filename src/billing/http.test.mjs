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
    getUserRecord: async () => null,
    updateUserMetadata: async () => {},
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
        constructEvent: (raw, signature) => {
          if (signature !== 'sig_test') throw new Error('Invalid Stripe webhook signature.');
          return JSON.parse(String(raw));
        },
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
  assert.deepEqual(json.missing, ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO']);
  assert.doesNotMatch(JSON.stringify(json), /sk_test|whsec_/);
});

test('checkout 503s with missing Clerk names when CLERK_* are unset', async () => {
  const runtime = createBillingRuntime({ env: {} });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
  });
  assert.equal(status, 503);
  assert.equal(json.code, BILLING_CODES.CLERK_NOT_CONFIGURED);
  assert.deepEqual(json.missing, ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY']);
  assert.doesNotMatch(JSON.stringify(json), /sk_|whsec_|BEGIN/);
});

test('checkout 503s when only one Clerk key is set instead of unlocking BYOK voice', async () => {
  const runtime = createBillingRuntime({
    env: { CLERK_PUBLISHABLE_KEY: 'pk_test_example' },
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { authorization: 'Bearer sess_test' },
  });
  assert.equal(status, 503);
  assert.equal(json.code, BILLING_CODES.CLERK_NOT_CONFIGURED);
  assert.deepEqual(json.missing, ['CLERK_SECRET_KEY']);

  const voice = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(voice.ok, false);
  assert.equal(voice.status, 503);
});

test('checkout 502 never echoes Stripe secret material', async () => {
  const runtime = hostedRuntime({
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async () => {
            throw new Error('Invalid API Key provided: sk_test_leakedsecret');
          },
        },
      },
    }),
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { authorization: 'Bearer sess_test' },
  });
  assert.equal(status, 502);
  assert.match(json.error, /Stripe Checkout failed/);
  assert.doesNotMatch(JSON.stringify(json), /sk_test_leakedsecret|leakedsecret/);
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

test('webhook 503s when STRIPE_WEBHOOK_SECRET is unset', async () => {
  const runtime = hostedRuntime({
    env: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
      STRIPE_SECRET_KEY: 'sk_test_stripe',
      STRIPE_PRICE_PRO: 'price_env_pro',
    },
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: { type: 'checkout.session.completed', data: { object: {} } },
  });
  assert.equal(status, 503);
  assert.equal(json.code, BILLING_CODES.STRIPE_WEBHOOK_NOT_CONFIGURED);
  assert.deepEqual(json.missing, ['STRIPE_WEBHOOK_SECRET']);
});

test('webhook 400s when the Stripe signature header is missing', async () => {
  const { status, json } = await dispatch(hostedRuntime(), {
    method: 'POST',
    url: '/api/billing/webhook',
    body: { type: 'checkout.session.completed', data: { object: {} } },
  });
  assert.equal(status, 400);
  assert.match(json.error, /Stripe-Signature/);
});

test('customer.subscription.updated keeps Pro while active and returns Free when canceled', async () => {
  const clerkWrites = [];
  const runtime = hostedRuntime({
    updateUserMetadata: async (userId, metadata) => {
      clerkWrites.push({ userId, metadata });
    },
  });
  runtime.accounts.applyPatch('user_abc', {
    plan: PLANS.PRO,
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
  });

  const updated = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'past_due',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.applied, true);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.PRO);

  const canceled = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(canceled.json.plan, PLANS.FREE);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.FREE);
  assert.equal(clerkWrites.at(-1).metadata.publicMetadata.meridianPlan, PLANS.FREE);
});

test('subscription.updated can look up the account by Stripe customer id', async () => {
  const runtime = hostedRuntime();
  runtime.accounts.applyPatch('user_abc', {
    plan: PLANS.PRO,
    stripeCustomerId: 'cus_lookup',
    stripeSubscriptionId: 'sub_lookup',
  });
  const { json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_lookup',
          customer: 'cus_lookup',
          status: 'canceled',
        },
      },
    },
  });
  assert.equal(json.applied, true);
  assert.equal(json.userId, 'user_abc');
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.FREE);
});

test('checkout.session.completed syncs Pro onto mocked Clerk metadata', async () => {
  const clerkWrites = [];
  const runtime = hostedRuntime({
    updateUserMetadata: async (userId, metadata) => {
      clerkWrites.push({ userId, metadata });
    },
  });
  const { json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_clerk',
          subscription: 'sub_clerk',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(json.applied, true);
  assert.equal(clerkWrites[0].userId, 'user_abc');
  assert.equal(clerkWrites[0].metadata.publicMetadata.meridianPlan, PLANS.PRO);
  assert.equal(clerkWrites[0].metadata.publicMetadata.stripeCustomerId, 'cus_clerk');
  assert.equal(clerkWrites[0].metadata.publicMetadata.stripeSubscriptionId, 'sub_clerk');
  assert.equal(clerkWrites[0].metadata.privateMetadata.stripeCustomerId, 'cus_clerk');
  assert.equal(clerkWrites[0].metadata.privateMetadata.stripeSubscriptionId, 'sub_clerk');
});

test('checkout.session.completed writes Pro and Stripe ids to Clerk', async () => {
  const clerkWrites = [];
  const runtime = hostedRuntime({
    updateUserMetadata: async (userId, metadata) => {
      clerkWrites.push({ userId, metadata });
    },
  });
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
  assert.equal(json.plan, PLANS.PRO);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.PRO);
  assert.equal(clerkWrites.length, 1);
  assert.equal(clerkWrites[0].userId, 'user_abc');
  assert.equal(clerkWrites[0].metadata.publicMetadata.meridianPlan, PLANS.PRO);
  assert.equal(clerkWrites[0].metadata.publicMetadata.stripeCustomerId, 'cus_123');
  assert.equal(clerkWrites[0].metadata.publicMetadata.stripeSubscriptionId, 'sub_123');
});

test('empty-store durability: /me stays Pro from Clerk publicMetadata across isolates', async () => {
  const getUserRecord = async () => ({
    publicMetadata: { meridianPlan: PLANS.PRO },
  });

  async function meOnEmptyStore() {
    const runtime = hostedRuntime({
      store: createAccountStore({ now: () => Date.parse('2026-08-25T12:00:00.000Z') }),
      getUserRecord,
    });
    return dispatch(runtime, {
      url: '/api/billing/me',
      headers: { authorization: 'Bearer sess_test' },
    });
  }

  const first = await meOnEmptyStore();
  assert.equal(first.status, 200);
  assert.equal(first.json.plan, PLANS.PRO);
  assert.equal(first.json.voice, true);

  const second = await meOnEmptyStore();
  assert.equal(second.status, 200);
  assert.equal(second.json.plan, PLANS.PRO);
  assert.equal(second.json.voice, true);
});

test('webhook is non-2xx when the Clerk metadata write throws', async () => {
  const runtime = hostedRuntime({
    updateUserMetadata: async () => {
      throw new Error('Clerk metadata write failed');
    },
  });
  const { status } = await dispatch(runtime, {
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
  assert.ok(status >= 400);
  assert.notEqual(status, 200);
});

test('empty store hydrates Stripe customer id so portal is not 409', async () => {
  const runtime = hostedRuntime({
    store: createAccountStore({ now: () => Date.parse('2026-08-25T12:00:00.000Z') }),
    getUserRecord: async () => ({
      publicMetadata: {
        meridianPlan: PLANS.PRO,
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      },
    }),
  });
  const { status, json } = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/portal',
    headers: { authorization: 'Bearer sess_test' },
  });
  assert.equal(status, 200);
  assert.equal(json.url, 'https://billing.stripe.com/session/test');
});

test('empty serverless store hydrates Pro from mocked Clerk so voice unlocks', async () => {
  const runtime = hostedRuntime({
    getUserRecord: async () => ({
      publicMetadata: { meridianPlan: PLANS.PRO },
      privateMetadata: { stripeCustomerId: 'cus_hydrated' },
    }),
  });
  const { json } = await dispatch(runtime, {
    url: '/api/billing/me',
    headers: { authorization: 'Bearer sess_test' },
  });
  assert.equal(json.plan, PLANS.PRO);
  assert.equal(json.voice, true);

  const voice = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(voice.ok, true);
});

test('money path: Free cannot use voice, Checkout + completed webhook unlocks Pro voice', async () => {
  const created = [];
  const clerkWrites = [];
  const runtime = hostedRuntime({
    updateUserMetadata: async (userId, metadata) => {
      clerkWrites.push({ userId, metadata });
    },
    createStripe: () => ({
      checkout: {
        sessions: {
          create: async (params) => {
            created.push(params);
            return { id: 'cs_money', url: 'https://checkout.stripe.com/c/pay/cs_money' };
          },
        },
      },
      webhooks: {
        constructEvent: (raw, signature) => {
          if (signature !== 'sig_test') throw new Error('Invalid Stripe webhook signature.');
          return JSON.parse(String(raw));
        },
      },
    }),
  });

  const before = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(before.ok, false);
  assert.equal(before.body.code, BILLING_CODES.VOICE_REQUIRES_PRO);

  const checkout = await dispatch(runtime, {
    method: 'POST',
    url: '/api/billing/checkout',
    headers: { authorization: 'Bearer sess_test', host: 'meridian.example' },
  });
  assert.equal(checkout.status, 200);
  assert.equal(created[0].line_items[0].price, 'price_env_pro');
  assert.equal(created[0].metadata.userId, 'user_abc');

  const webhook = await dispatch(runtime, {
    method: 'POST',
    url: '/api/stripe/webhook',
    headers: { 'stripe-signature': 'sig_test' },
    body: {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_money',
          subscription: 'sub_money',
          metadata: { userId: 'user_abc' },
        },
      },
    },
  });
  assert.equal(webhook.json.applied, true);
  assert.equal(runtime.accounts.get('user_abc').plan, PLANS.PRO);
  assert.equal(clerkWrites.at(-1).metadata.publicMetadata.meridianPlan, PLANS.PRO);

  const after = await authorizeVoiceRequest(
    mockReq({ headers: { authorization: 'Bearer sess_test' } }),
    runtime,
  );
  assert.equal(after.ok, true);
});

