/**
 * Hosted Meridian plans. Price IDs are never invented here — Checkout uses
 * STRIPE_PRICE_PRO from the environment.
 */

export const PLANS = Object.freeze({
  SELF_HOST: 'self_host',
  ANONYMOUS: 'anonymous',
  FREE: 'free',
  PRO: 'pro',
});

export const PRO_PRICE_USD = 29;
export const PRO_PRICE_INTERVAL = 'month';

export const PLAN_LIMITS = Object.freeze({
  [PLANS.FREE]: Object.freeze({
    id: PLANS.FREE,
    label: 'Free',
    voice: false,
    savedViews: false,
    dailySessionSeconds: 15 * 60,
    dailyRequestUnits: 120,
  }),
  [PLANS.PRO]: Object.freeze({
    id: PLANS.PRO,
    label: 'Pro',
    voice: true,
    savedViews: true,
    dailySessionSeconds: 8 * 60 * 60,
    dailyRequestUnits: 4000,
    priceUsd: PRO_PRICE_USD,
    interval: PRO_PRICE_INTERVAL,
  }),
});

export const MERIDIAN_TERMS =
  'Meridian is independent, based on the MIT-licensed God\'s Eye View project. '
  + 'It is not affiliated with, endorsed by, or an official continuation of '
  + 'Bilawal Sidhu or the God\'s Eye View series.';

export function isKnownPlan(plan) {
  return plan === PLANS.FREE || plan === PLANS.PRO;
}

export function planLimits(plan) {
  switch (plan) {
    case PLANS.PRO:
      return PLAN_LIMITS[PLANS.PRO];
    case PLANS.FREE:
      return PLAN_LIMITS[PLANS.FREE];
    case PLANS.ANONYMOUS:
    case PLANS.SELF_HOST:
      return null;
    default: {
      const _exhaustive = plan;
      throw new Error(`Unhandled plan: ${_exhaustive}`);
    }
  }
}
