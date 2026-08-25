import { PLAN_LIMITS, PLANS, PRO_PRICE_USD, isKnownPlan, planLimits } from './plans.js';
import { isBudgetExhausted, remainingBudget } from './usage.js';

export const BILLING_CODES = Object.freeze({
  AUTH_REQUIRED: 'auth_required',
  VOICE_REQUIRES_PRO: 'voice_requires_pro',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  STRIPE_NOT_CONFIGURED: 'stripe_not_configured',
  STRIPE_WEBHOOK_NOT_CONFIGURED: 'stripe_webhook_not_configured',
  CLERK_NOT_CONFIGURED: 'clerk_not_configured',
  ALREADY_PRO: 'already_pro',
});

/**
 * @param {{
 *   hosted: boolean,
 *   signedIn: boolean,
 *   plan?: string,
 *   usage?: object,
 *   nowMs?: number,
 *   stripeConfigured?: boolean,
 *   clerkConfigured?: boolean,
 * }} input
 */
export function resolveEntitlements(input) {
  const nowMs = Number.isFinite(input?.nowMs) ? input.nowMs : Date.now();
  const hosted = Boolean(input?.hosted);
  const signedIn = Boolean(input?.signedIn);
  const stripeConfigured = Boolean(input?.stripeConfigured);
  const clerkConfigured = Boolean(input?.clerkConfigured);

  if (!hosted) {
    return {
      plan: PLANS.SELF_HOST,
      signedIn: false,
      voice: true,
      savedViews: { available: false, placeholder: true, items: [] },
      capped: false,
      exhausted: false,
      remaining: { sessionSeconds: Number.POSITIVE_INFINITY, requestUnits: Number.POSITIVE_INFINITY },
      upgrade: { available: false, priceUsd: PRO_PRICE_USD },
      stripeConfigured,
      clerkConfigured,
    };
  }

  if (!signedIn) {
    return {
      plan: PLANS.ANONYMOUS,
      signedIn: false,
      voice: false,
      savedViews: { available: false, placeholder: true, items: [] },
      capped: true,
      exhausted: false,
      remaining: remainingBudget(PLAN_LIMITS[PLANS.FREE], null, nowMs),
      upgrade: { available: stripeConfigured, priceUsd: PRO_PRICE_USD },
      stripeConfigured,
      clerkConfigured,
    };
  }

  const plan = isKnownPlan(input.plan) && input.plan === PLANS.PRO ? PLANS.PRO : PLANS.FREE;
  const limits = planLimits(plan);
  const remaining = remainingBudget(limits, input.usage, nowMs);
  const exhausted = isBudgetExhausted(limits, input.usage, nowMs);

  return {
    plan,
    signedIn: true,
    voice: Boolean(limits.voice) && !exhausted,
    savedViews: {
      available: Boolean(limits.savedViews),
      placeholder: !Boolean(limits.savedViews),
      items: Array.isArray(input.savedViews) ? input.savedViews : [],
    },
    capped: true,
    exhausted,
    remaining,
    upgrade: {
      available: plan !== PLANS.PRO && stripeConfigured,
      priceUsd: PRO_PRICE_USD,
    },
    stripeConfigured,
    clerkConfigured,
  };
}

export function canUseVoice(entitlement) {
  return Boolean(entitlement?.voice) && !entitlement?.exhausted;
}

export function voiceDenial(entitlement) {
  if (!entitlement) {
    return { status: 401, code: BILLING_CODES.AUTH_REQUIRED, error: 'Sign in required.' };
  }
  if (entitlement.plan === PLANS.SELF_HOST) return null;
  if (!entitlement.signedIn) {
    return { status: 401, code: BILLING_CODES.AUTH_REQUIRED, error: 'Sign in required for voice.' };
  }
  if (entitlement.plan !== PLANS.PRO) {
    return {
      status: 403,
      code: BILLING_CODES.VOICE_REQUIRES_PRO,
      error: 'Voice is a Pro feature. Upgrade to unlock OpenAI Realtime on this host.',
    };
  }
  if (entitlement.exhausted) {
    return {
      status: 403,
      code: BILLING_CODES.BUDGET_EXHAUSTED,
      error: 'Daily Pro budget used. Try again after UTC midnight or manage your plan.',
    };
  }
  return null;
}

export function publicAccountView(entitlement, extras = {}) {
  return {
    plan: entitlement.plan,
    signedIn: entitlement.signedIn,
    voice: canUseVoice(entitlement),
    savedViews: entitlement.savedViews,
    capped: entitlement.capped,
    exhausted: entitlement.exhausted,
    remaining: {
      sessionSeconds: entitlement.remaining.sessionSeconds,
      requestUnits: entitlement.remaining.requestUnits,
    },
    upgrade: entitlement.upgrade,
    stripeConfigured: entitlement.stripeConfigured,
    clerkConfigured: entitlement.clerkConfigured,
    ...extras,
  };
}
