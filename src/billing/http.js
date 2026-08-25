import { authenticateRequest, readBearerToken } from './auth.js';
import { BILLING_CODES, publicAccountView, resolveEntitlements, voiceDenial } from './entitlements.js';
import { readBillingEnv } from './env.js';
import { MERIDIAN_TERMS, PLANS, PRO_PRICE_USD } from './plans.js';
import { applyStripeEvent, buildCheckoutSessionParams } from './stripeEvents.js';
import { createAccountStore } from './store.js';
import { consumeUsage } from './usage.js';

export function createBillingRuntime({
  env = process.env,
  now = () => Date.now(),
  store,
  verifyToken,
  createStripe,
  getUserEmail,
  readBody,
} = {}) {
  const config = readBillingEnv(env);
  const accounts = store || createAccountStore({
    persistPath: config.persistPath || null,
    now,
  });

  const readJson = readBody || defaultReadBody;

  return {
    config,
    accounts,
    now,
    verifyToken,
    createStripe,
    getUserEmail,
    readJson,

    entitlementsFor(user, extras = {}) {
      const account = user ? accounts.getOrCreate(user.id) : null;
      return resolveEntitlements({
        hosted: config.hosted,
        signedIn: Boolean(user),
        plan: account?.plan,
        usage: account?.usage,
        savedViews: account?.savedViews,
        nowMs: now(),
        stripeConfigured: config.stripeConfigured,
        clerkConfigured: config.clerkConfigured,
        ...extras,
      });
    },

    async authorize(req) {
      return authenticateRequest(req, { env, verifyToken });
    },
  };
}

let defaultRuntime = null;

export function getBillingRuntime(overrides) {
  if (overrides) return createBillingRuntime(overrides);
  if (!defaultRuntime) defaultRuntime = createBillingRuntime();
  return defaultRuntime;
}

export function resetBillingRuntime() {
  defaultRuntime = null;
}

export async function authorizeVoiceRequest(req, runtime = getBillingRuntime()) {
  const auth = await runtime.authorize(req);
  if (!auth.hosted) return { ok: true, hosted: false };
  if (!auth.ok) {
    return { ok: false, status: auth.status, body: { error: auth.error, code: auth.code } };
  }
  const entitlement = runtime.entitlementsFor(auth.user);
  const denial = voiceDenial(entitlement);
  if (denial) {
    return { ok: false, status: denial.status, body: { error: denial.error, code: denial.code } };
  }
  runtime.accounts.applyPatch(auth.user.id, {
    usage: consumeUsage(runtime.accounts.get(auth.user.id)?.usage, 'request', 1, runtime.now()),
  });
  return { ok: true, hosted: true, user: auth.user, entitlement };
}

export async function rejectIfVoiceForbidden(req, res, runtime = getBillingRuntime()) {
  const decision = await authorizeVoiceRequest(req, runtime);
  if (decision.ok) return false;
  writeJson(res, decision.status, decision.body);
  return true;
}

export async function handleBillingHttp(req, res, runtime = getBillingRuntime()) {
  const url = new URL(req.url || '/', originFromRequest(req));
  const path = url.pathname;
  const method = req.method || 'GET';

  if (path === '/api/billing/config' && method === 'GET') {
    return writeJson(res, 200, publicConfig(runtime.config));
  }

  if (path === '/api/billing/me' && method === 'GET') {
    const auth = await runtime.authorize(req);
    if (auth.hosted && !auth.ok && readBearerToken(req)) {
      return writeJson(res, auth.status, { error: auth.error, code: auth.code });
    }
    return writeJson(res, 200, publicAccountView(runtime.entitlementsFor(auth.ok ? auth.user : null), {
      terms: MERIDIAN_TERMS,
    }));
  }

  if (path === '/api/billing/usage' && method === 'POST') {
    const auth = await runtime.authorize(req);
    if (!auth.hosted) {
      return writeJson(res, 200, publicAccountView(runtime.entitlementsFor(null)));
    }
    if (!auth.ok) return writeJson(res, auth.status, { error: auth.error, code: auth.code });
    const body = await parseJson(req, runtime);
    const kind = body.kind === 'request' ? 'request' : 'session';
    const amount = kind === 'session'
      ? Math.min(120, Math.max(0, Number(body.seconds) || 0))
      : Math.min(20, Math.max(0, Number(body.units) || 1));
    const account = runtime.accounts.getOrCreate(auth.user.id);
    runtime.accounts.applyPatch(auth.user.id, {
      usage: consumeUsage(account.usage, kind, amount, runtime.now()),
    });
    return writeJson(res, 200, publicAccountView(runtime.entitlementsFor(auth.user)));
  }

  if (path === '/api/billing/checkout' && method === 'POST') {
    return handleCheckout(req, res, runtime);
  }

  if (path === '/api/billing/portal' && method === 'POST') {
    return handlePortal(req, res, runtime);
  }

  if ((path === '/api/stripe/webhook' || path === '/api/billing/webhook') && method === 'POST') {
    return handleWebhook(req, res, runtime);
  }

  return writeJson(res, 404, { error: 'Not found' });
}

async function handleCheckout(req, res, runtime) {
  const auth = await runtime.authorize(req);
  if (!auth.hosted) {
    return writeJson(res, 503, {
      error: 'Hosted billing is not configured. Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.',
      code: BILLING_CODES.CLERK_NOT_CONFIGURED,
    });
  }
  if (!auth.ok) return writeJson(res, auth.status, { error: auth.error, code: auth.code });
  if (!runtime.config.stripeConfigured) {
    return writeJson(res, 503, {
      error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO.',
      code: BILLING_CODES.STRIPE_NOT_CONFIGURED,
    });
  }

  const entitlement = runtime.entitlementsFor(auth.user);
  if (entitlement.plan === PLANS.PRO) {
    return writeJson(res, 409, {
      error: 'This account is already Pro.',
      code: BILLING_CODES.ALREADY_PRO,
    });
  }

  const account = runtime.accounts.getOrCreate(auth.user.id);
  const email = await resolveUserEmail(auth.user, runtime);
  const origin = originFromRequest(req);
  const params = buildCheckoutSessionParams({
    priceId: runtime.config.stripePricePro,
    userId: auth.user.id,
    email,
    customerId: account.stripeCustomerId,
    origin,
  });

  try {
    const stripe = await stripeClient(runtime);
    const session = await createCheckoutSession(stripe, params).catch(async (error) => {
      if (!String(error?.message || '').includes('integration_identifier')) throw error;
      const { integration_identifier: _ignored, ...legacy } = params;
      return createCheckoutSession(stripe, legacy);
    });
    if (!session?.url) {
      return writeJson(res, 502, { error: 'Stripe Checkout did not return a session URL.' });
    }
    return writeJson(res, 200, { url: session.url, id: session.id || null });
  } catch (error) {
    return writeJson(res, 502, {
      error: error?.message || 'Failed to create Stripe Checkout session.',
    });
  }
}

async function handlePortal(req, res, runtime) {
  const auth = await runtime.authorize(req);
  if (!auth.hosted || !auth.ok) {
    return writeJson(res, auth.hosted ? auth.status : 503, {
      error: auth.error || 'Sign in required.',
      code: auth.code || BILLING_CODES.AUTH_REQUIRED,
    });
  }
  if (!runtime.config.stripeConfigured) {
    return writeJson(res, 503, {
      error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO.',
      code: BILLING_CODES.STRIPE_NOT_CONFIGURED,
    });
  }
  const account = runtime.accounts.get(auth.user.id);
  if (!account?.stripeCustomerId) {
    return writeJson(res, 409, { error: 'No Stripe customer is on file for this account yet.' });
  }
  try {
    const stripe = await stripeClient(runtime);
    const portal = await createPortalSession(stripe, {
      customer: account.stripeCustomerId,
      return_url: originFromRequest(req),
    });
    return writeJson(res, 200, { url: portal.url });
  } catch (error) {
    return writeJson(res, 502, { error: error?.message || 'Failed to open the Stripe customer portal.' });
  }
}

async function handleWebhook(req, res, runtime) {
  const raw = await runtime.readJson(req, { raw: true });
  const signature = header(req, 'stripe-signature');
  let event;
  try {
    event = await constructWebhookEvent(runtime, raw, signature);
  } catch (error) {
    return writeJson(res, 400, { error: error?.message || 'Invalid Stripe webhook signature.' });
  }

  const mapped = applyStripeEvent(event);
  if (!mapped) {
    return writeJson(res, 200, { received: true, applied: false });
  }

  let userId = mapped.userId;
  if (!userId && mapped.lookupByCustomerId) {
    userId = runtime.accounts.findByCustomerId(mapped.lookupByCustomerId)?.userId || null;
  }
  if (!userId) {
    return writeJson(res, 200, { received: true, applied: false });
  }

  const { lookupByCustomerId, patch, ...fields } = mapped;
  const next = patch || fields;
  runtime.accounts.applyPatch(userId, next);
  void syncClerkPlan(userId, next.plan, runtime);
  return writeJson(res, 200, { received: true, applied: true, userId, plan: next.plan });
}

function publicConfig(config) {
  return {
    hosted: config.hosted,
    clerkConfigured: config.clerkConfigured,
    stripeConfigured: config.stripeConfigured,
    clerkPublishableKey: config.clerkPublishableKey || null,
    pro: {
      priceUsd: PRO_PRICE_USD,
      interval: 'month',
      priceConfigured: Boolean(config.stripePricePro),
    },
    free: {
      dailySessionSeconds: 15 * 60,
      voice: false,
    },
    terms: MERIDIAN_TERMS,
  };
}

export function originFromRequest(req) {
  const proto = header(req, 'x-forwarded-proto') || 'http';
  const host = header(req, 'x-forwarded-host') || header(req, 'host') || 'localhost:4173';
  const origin = header(req, 'origin');
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  return `${proto}://${host}`;
}

function header(req, name) {
  const value = req?.headers?.[name] || req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : (value || '');
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}

async function parseJson(req, runtime) {
  const raw = await runtime.readJson(req, { raw: true });
  if (!raw) return {};
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function defaultReadBody(req, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) {
      resolve(raw ? String(req.rawBody) : req.rawBody);
      return;
    }
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 1024 * 1024) {
        reject(new Error('Request body exceeds 1MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function stripeClient(runtime) {
  if (runtime.createStripe) return runtime.createStripe(runtime.config.stripeSecretKey);
  const Stripe = (await import('stripe')).default;
  return new Stripe(runtime.config.stripeSecretKey);
}

async function createCheckoutSession(stripe, params) {
  if (stripe?.v1?.checkout?.sessions?.create) {
    return stripe.v1.checkout.sessions.create(params);
  }
  return stripe.checkout.sessions.create(params);
}

async function createPortalSession(stripe, params) {
  if (stripe?.v1?.billingPortal?.sessions?.create) {
    return stripe.v1.billingPortal.sessions.create(params);
  }
  return stripe.billingPortal.sessions.create(params);
}

async function constructWebhookEvent(runtime, raw, signature) {
  if (!runtime.config.stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  }
  const stripe = await stripeClient(runtime);
  if (stripe?.webhooks?.constructEvent) {
    return stripe.webhooks.constructEvent(raw, signature, runtime.config.stripeWebhookSecret);
  }
  if (typeof stripe.constructEvent === 'function') {
    return stripe.constructEvent(raw, signature, runtime.config.stripeWebhookSecret);
  }
  throw new Error('Stripe webhook verification is unavailable.');
}

async function syncClerkPlan(userId, plan, runtime) {
  if (!userId || !plan || !runtime.config.clerkSecretKey) return;
  if (runtime.updateUserMetadata) {
    try {
      await runtime.updateUserMetadata(userId, plan);
    } catch {
      /* store remains authoritative */
    }
    return;
  }
  try {
    const { createClerkClient } = await import('@clerk/backend');
    const clerk = createClerkClient({ secretKey: runtime.config.clerkSecretKey });
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: { meridianPlan: plan },
    });
  } catch {
    /* store remains authoritative */
  }
}

async function resolveUserEmail(user, runtime) {
  if (user?.email) return user.email;
  if (!runtime.getUserEmail) {
    try {
      const { createClerkClient } = await import('@clerk/backend');
      const clerk = createClerkClient({ secretKey: runtime.config.clerkSecretKey });
      const record = await clerk.users.getUser(user.id);
      return record.emailAddresses?.find((row) => row.id === record.primaryEmailAddressId)?.emailAddress
        || record.emailAddresses?.[0]?.emailAddress
        || null;
    } catch {
      return null;
    }
  }
  try {
    return await runtime.getUserEmail(user.id);
  } catch {
    return null;
  }
}

export { readBearerToken };
