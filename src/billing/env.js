function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export const CLERK_ENV_NAMES = Object.freeze(['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY']);
export const STRIPE_CHECKOUT_ENV_NAMES = Object.freeze(['STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO']);
export const STRIPE_WEBHOOK_ENV_NAMES = Object.freeze(['STRIPE_WEBHOOK_SECRET']);

export function readBillingEnv(env = process.env) {
  const clerkPublishableKey = firstEnv(env, ['CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY']);
  const clerkSecretKey = firstEnv(env, ['CLERK_SECRET_KEY']);
  const clerkJwtKey = firstEnv(env, ['CLERK_JWT_KEY']);
  const stripeSecretKey = firstEnv(env, ['STRIPE_SECRET_KEY']);
  const stripeWebhookSecret = firstEnv(env, ['STRIPE_WEBHOOK_SECRET']);
  const stripePricePro = firstEnv(env, ['STRIPE_PRICE_PRO']);
  const persistPath = firstEnv(env, ['MERIDIAN_BILLING_STORE_PATH']);
  const vercel = Boolean(firstEnv(env, ['VERCEL', 'VERCEL_ENV']));

  const clerkConfigured = Boolean(clerkPublishableKey && clerkSecretKey);
  const clerkPartial = Boolean(clerkPublishableKey || clerkSecretKey) && !clerkConfigured;
  const stripeConfigured = Boolean(stripeSecretKey && stripePricePro);

  return {
    clerkPublishableKey,
    clerkSecretKey,
    clerkJwtKey,
    stripeSecretKey,
    stripeWebhookSecret,
    stripePricePro,
    persistPath: persistPath || (vercel ? '' : '.meridian-billing/accounts.json'),
    clerkConfigured,
    clerkPartial,
    stripeConfigured,
    hosted: clerkConfigured,
    hostedIntent: clerkConfigured || clerkPartial,
    vercel,
  };
}

export function missingClerkEnv(config) {
  const missing = [];
  if (!config?.clerkPublishableKey) missing.push('CLERK_PUBLISHABLE_KEY');
  if (!config?.clerkSecretKey) missing.push('CLERK_SECRET_KEY');
  return missing;
}

export function missingStripeCheckoutEnv(config) {
  const missing = [];
  if (!config?.stripeSecretKey) missing.push('STRIPE_SECRET_KEY');
  if (!config?.stripePricePro) missing.push('STRIPE_PRICE_PRO');
  return missing;
}

export function missingStripeWebhookEnv(config) {
  return config?.stripeWebhookSecret ? [] : ['STRIPE_WEBHOOK_SECRET'];
}

export function formatMissingEnvError(missing) {
  if (!missing?.length) return '';
  if (missing.length === 1) return `${missing[0]} is not set.`;
  if (missing.length === 2) return `Set ${missing[0]} and ${missing[1]}.`;
  return `Set ${missing.slice(0, -1).join(', ')}, and ${missing[missing.length - 1]}.`;
}

const SECRET_LEAK = /sk_live|sk_test|rk_live|rk_test|whsec_|pk_test_|pk_live_|-----BEGIN|clerk_secret|CLERK_SECRET_KEY\s*=|STRIPE_SECRET_KEY\s*=|STRIPE_WEBHOOK_SECRET\s*=/i;

/**
 * Operator-safe error text: no stacks, no secret material, no env values.
 */
export function publicBillingError(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message) return fallback;
  if (SECRET_LEAK.test(message)) return fallback;
  if (message.includes('\n') || message.includes('\r')) return fallback;
  if (/\bat\s+\S+\s+\(/.test(message)) return fallback;
  if (message.length > 200) return fallback;
  return message;
}
