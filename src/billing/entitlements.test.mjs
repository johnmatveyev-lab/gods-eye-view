import test from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_CODES, canUseVoice, resolveEntitlements, voiceDenial } from './entitlements.js';
import { PLANS, PRO_PRICE_USD } from './plans.js';
import { consumeUsage, formatRemainingBudget, remainingBudget, utcDayKey } from './usage.js';
import { applyStripeEvent, buildCheckoutSessionParams, planFromSubscriptionStatus } from './stripeEvents.js';
import { PLAN_LIMITS } from './plans.js';

const NOON = Date.parse('2026-08-25T12:00:00.000Z');

test('self-host without Clerk keeps voice and does not cap the globe', () => {
  const entitlement = resolveEntitlements({ hosted: false, signedIn: false, nowMs: NOON });
  assert.equal(entitlement.plan, PLANS.SELF_HOST);
  assert.equal(entitlement.voice, true);
  assert.equal(entitlement.capped, false);
  assert.equal(entitlement.exhausted, false);
  assert.equal(canUseVoice(entitlement), true);
  assert.equal(voiceDenial(entitlement), null);
});

test('unsigned hosted users get a working globe, no voice, and an upgrade path', () => {
  const entitlement = resolveEntitlements({
    hosted: true,
    signedIn: false,
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
  assert.equal(entitlement.plan, PLANS.ANONYMOUS);
  assert.equal(entitlement.voice, false);
  assert.equal(entitlement.exhausted, false);
  assert.deepEqual(voiceDenial(entitlement), {
    status: 401,
    code: BILLING_CODES.AUTH_REQUIRED,
    error: 'Sign in required for voice.',
  });
  assert.equal(entitlement.upgrade.available, true);
  assert.equal(entitlement.upgrade.priceUsd, PRO_PRICE_USD);
});

test('hosted Free vs Pro gates stay 15 min/day no voice versus $29/mo voice', () => {
  assert.equal(PLAN_LIMITS[PLANS.FREE].voice, false);
  assert.equal(PLAN_LIMITS[PLANS.FREE].dailySessionSeconds, 15 * 60);
  assert.equal(PLAN_LIMITS[PLANS.PRO].voice, true);
  assert.equal(PLAN_LIMITS[PLANS.PRO].priceUsd, PRO_PRICE_USD);
  assert.equal(PRO_PRICE_USD, 29);
  assert.equal(PLAN_LIMITS[PLANS.PRO].interval, 'month');

  const free = resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan: PLANS.FREE,
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
  assert.equal(free.voice, false);
  assert.equal(free.remaining.sessionSeconds, 15 * 60);
  assert.equal(free.upgrade.available, true);
  assert.equal(free.upgrade.priceUsd, 29);
  assert.equal(voiceDenial(free).code, BILLING_CODES.VOICE_REQUIRES_PRO);

  const pro = resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan: PLANS.PRO,
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
  assert.equal(pro.voice, true);
  assert.equal(canUseVoice(pro), true);
  assert.equal(voiceDenial(pro), null);
  assert.equal(pro.upgrade.available, false);
});

test('Free accounts cannot use voice even with remaining budget', () => {
  const entitlement = resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan: PLANS.FREE,
    usage: { day: utcDayKey(NOON), sessionSeconds: 60, requestUnits: 2 },
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
  assert.equal(entitlement.plan, PLANS.FREE);
  assert.equal(entitlement.voice, false);
  assert.equal(entitlement.remaining.sessionSeconds, 15 * 60 - 60);
  assert.equal(entitlement.upgrade.available, true);
  assert.equal(voiceDenial(entitlement).code, BILLING_CODES.VOICE_REQUIRES_PRO);
});

test('Pro accounts get voice until the daily cap is exhausted', () => {
  const entitlement = resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan: PLANS.PRO,
    usage: { day: utcDayKey(NOON), sessionSeconds: 120, requestUnits: 4 },
    stripeConfigured: true,
    clerkConfigured: true,
    nowMs: NOON,
  });
  assert.equal(entitlement.voice, true);
  assert.equal(entitlement.savedViews.available, true);
  assert.equal(entitlement.savedViews.placeholder, true);
  assert.equal(canUseVoice(entitlement), true);

  const exhausted = resolveEntitlements({
    hosted: true,
    signedIn: true,
    plan: PLANS.PRO,
    usage: { day: utcDayKey(NOON), sessionSeconds: 8 * 60 * 60, requestUnits: 0 },
    nowMs: NOON,
  });
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.voice, false);
  assert.equal(voiceDenial(exhausted).code, BILLING_CODES.BUDGET_EXHAUSTED);
});

test('usage resets at UTC midnight and never reports a negative remaining budget', () => {
  const limits = PLAN_LIMITS.free;
  const yesterday = consumeUsage(
    { day: '2026-08-24', sessionSeconds: 900, requestUnits: 120 },
    'session',
    30,
    NOON,
  );
  assert.equal(yesterday.day, '2026-08-25');
  assert.equal(yesterday.sessionSeconds, 30);
  const remaining = remainingBudget(limits, { day: utcDayKey(NOON), sessionSeconds: 50_000, requestUnits: 9_000 }, NOON);
  assert.equal(remaining.sessionSeconds, 0);
  assert.equal(remaining.requestUnits, 0);
  assert.equal(formatRemainingBudget({ sessionSeconds: 0 }), '0 min left today');
  assert.equal(formatRemainingBudget({ sessionSeconds: 125 }), '2 min left today');
  assert.equal(formatRemainingBudget({ sessionSeconds: 8 * 3600 }), '8h left today');
});

test('unknown usage kinds fail closed instead of silently no-oping', () => {
  assert.throws(
    () => consumeUsage(null, 'tiles', 1, NOON),
    /Unhandled usage kind/,
  );
});

test('Stripe subscription statuses map to Pro or Free without inventing products', () => {
  assert.equal(planFromSubscriptionStatus('active'), PLANS.PRO);
  assert.equal(planFromSubscriptionStatus('trialing'), PLANS.PRO);
  assert.equal(planFromSubscriptionStatus('past_due'), PLANS.PRO);
  assert.equal(planFromSubscriptionStatus('canceled'), PLANS.FREE);
  assert.equal(planFromSubscriptionStatus('unpaid'), PLANS.FREE);
  assert.equal(planFromSubscriptionStatus('mystery'), PLANS.FREE);
});

test('checkout.session.completed marks the Clerk user Pro from metadata', () => {
  const patch = applyStripeEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        mode: 'subscription',
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: 'user_abc',
        metadata: { userId: 'user_abc' },
      },
    },
  });
  assert.deepEqual(patch, {
    userId: 'user_abc',
    plan: PLANS.PRO,
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
  });
});

test('subscription.updated maps active and canceled statuses onto Pro or Free', () => {
  const active = applyStripeEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        metadata: { userId: 'user_abc' },
      },
    },
  });
  assert.equal(active.plan, PLANS.PRO);
  assert.equal(active.userId, 'user_abc');

  const canceled = applyStripeEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        metadata: { userId: 'user_abc' },
      },
    },
  });
  assert.equal(canceled.plan, PLANS.FREE);
});

test('subscription deletion returns the account to Free', () => {
  const patch = applyStripeEvent({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        metadata: { userId: 'user_abc' },
      },
    },
  });
  assert.equal(patch.plan, PLANS.FREE);
  assert.equal(patch.userId, 'user_abc');
});

test('new billing surfaces do not ship Sidhu promo GIFs', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const accountHtml = html.slice(html.indexOf('id="account-bar"'), html.indexOf('id="style-indicator"'));
  assert.doesNotMatch(client, /\.gif/i);
  assert.doesNotMatch(accountHtml, /\.gif/i);
  assert.doesNotMatch(html, /docs\/media\/.*\.gif/);
});

test('Checkout session params use the env price ID and omit payment_method_types', () => {
  const params = buildCheckoutSessionParams({
    priceId: 'price_env_pro',
    userId: 'user_abc',
    email: 'ops@example.com',
    origin: 'https://meridian.example',
    integrationSuffix: 'checkout',
  });
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items, [{ price: 'price_env_pro', quantity: 1 }]);
  assert.equal(params.success_url, 'https://meridian.example/?checkout=success');
  assert.equal(params.cancel_url, 'https://meridian.example/?checkout=canceled');
  assert.equal(params.customer_email, 'ops@example.com');
  assert.equal(params.metadata.userId, 'user_abc');
  assert.equal('payment_method_types' in params, false);
});
