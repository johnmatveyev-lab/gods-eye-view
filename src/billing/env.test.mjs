import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMissingEnvError,
  missingClerkEnv,
  missingStripeCheckoutEnv,
  missingStripeWebhookEnv,
  publicBillingError,
  readBillingEnv,
} from './env.js';

test('fully unset env is self-host BYOK, not a half-configured host', () => {
  const config = readBillingEnv({});
  assert.equal(config.hosted, false);
  assert.equal(config.hostedIntent, false);
  assert.equal(config.clerkPartial, false);
  assert.equal(config.stripeConfigured, false);
  assert.ok(config.persistPath);
});

test('Vercel disables the on-disk account store so a read-only FS cannot 500 checkout', () => {
  const config = readBillingEnv({ VERCEL: '1' });
  assert.equal(config.vercel, true);
  assert.equal(config.persistPath, '');
});

test('partial Clerk keys are an explicit misconfiguration', () => {
  const publishableOnly = readBillingEnv({ CLERK_PUBLISHABLE_KEY: 'pk_test_example' });
  assert.equal(publishableOnly.hosted, false);
  assert.equal(publishableOnly.clerkPartial, true);
  assert.equal(publishableOnly.hostedIntent, true);
  assert.deepEqual(missingClerkEnv(publishableOnly), ['CLERK_SECRET_KEY']);

  const secretOnly = readBillingEnv({ CLERK_SECRET_KEY: 'sk_test_example' });
  assert.deepEqual(missingClerkEnv(secretOnly), ['CLERK_PUBLISHABLE_KEY']);
});

test('missing Stripe checkout env names the unset variables only', () => {
  const config = readBillingEnv({
    CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    CLERK_SECRET_KEY: 'sk_test_example',
    STRIPE_SECRET_KEY: 'sk_test_stripe',
  });
  assert.deepEqual(missingStripeCheckoutEnv(config), ['STRIPE_PRICE_PRO']);
  assert.deepEqual(missingStripeWebhookEnv(config), ['STRIPE_WEBHOOK_SECRET']);
  assert.match(formatMissingEnvError(['STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO']), /STRIPE_SECRET_KEY and STRIPE_PRICE_PRO/);
});

test('public billing errors never echo secrets or stacks', () => {
  assert.equal(
    publicBillingError(new Error('Invalid API Key provided: sk_test_123456'), 'Stripe Checkout failed.'),
    'Stripe Checkout failed.',
  );
  assert.equal(
    publicBillingError(new Error('verify failed\n    at constructEvent (stripe.js:10:3)'), 'Invalid Stripe webhook signature.'),
    'Invalid Stripe webhook signature.',
  );
  assert.equal(
    publicBillingError(new Error('No such price: price_env_pro'), 'Stripe Checkout failed.'),
    'No such price: price_env_pro',
  );
});
