function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function readBillingEnv(env = process.env) {
  const clerkPublishableKey = firstEnv(env, ['CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY']);
  const clerkSecretKey = firstEnv(env, ['CLERK_SECRET_KEY']);
  const clerkJwtKey = firstEnv(env, ['CLERK_JWT_KEY']);
  const stripeSecretKey = firstEnv(env, ['STRIPE_SECRET_KEY']);
  const stripeWebhookSecret = firstEnv(env, ['STRIPE_WEBHOOK_SECRET']);
  const stripePricePro = firstEnv(env, ['STRIPE_PRICE_PRO']);
  const persistPath = firstEnv(env, ['MERIDIAN_BILLING_STORE_PATH']) || '';

  return {
    clerkPublishableKey,
    clerkSecretKey,
    clerkJwtKey,
    stripeSecretKey,
    stripeWebhookSecret,
    stripePricePro,
    persistPath: persistPath || '.meridian-billing/accounts.json',
    clerkConfigured: Boolean(clerkPublishableKey && clerkSecretKey),
    stripeConfigured: Boolean(stripeSecretKey && stripePricePro),
    hosted: Boolean(clerkPublishableKey && clerkSecretKey),
  };
}
