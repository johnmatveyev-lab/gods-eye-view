import { PLANS, isKnownPlan } from './plans.js';

export function planFromClerkUser(record) {
  const plan = record?.publicMetadata?.meridianPlan
    || record?.privateMetadata?.meridianPlan
    || record?.plan
    || null;
  return isKnownPlan(plan) ? plan : null;
}

export function stripeIdsFromClerkUser(record) {
  const privateMeta = record?.privateMetadata || {};
  return {
    stripeCustomerId: privateMeta.stripeCustomerId || record?.stripeCustomerId || null,
    stripeSubscriptionId: privateMeta.stripeSubscriptionId || record?.stripeSubscriptionId || null,
    subscriptionStatus: privateMeta.subscriptionStatus || record?.subscriptionStatus || null,
  };
}

export function clerkMetadataFromAccount(account) {
  return {
    publicMetadata: { meridianPlan: account?.plan || PLANS.FREE },
    privateMetadata: {
      stripeCustomerId: account?.stripeCustomerId || null,
      stripeSubscriptionId: account?.stripeSubscriptionId || null,
      subscriptionStatus: account?.subscriptionStatus || null,
    },
  };
}

/**
 * Copy Clerk-backed plan/customer ids into the process store so Pro survives
 * a serverless cold start. In-memory Pro from a just-applied webhook wins
 * over a stale Clerk FREE.
 */
export async function hydrateAccountFromClerk(user, runtime) {
  if (!user?.id) return user;
  const existing = runtime.accounts.get(user.id);
  if (existing?.plan === PLANS.PRO) {
    return { ...user, plan: PLANS.PRO };
  }

  let record = null;
  if (runtime.getUserRecord) {
    try {
      record = await runtime.getUserRecord(user.id);
    } catch {
      record = null;
    }
  } else if (user.publicMetadata || user.privateMetadata || user.plan) {
    record = user;
  }

  const clerkPlan = planFromClerkUser(record);
  const ids = stripeIdsFromClerkUser(record);
  const plan = clerkPlan === PLANS.PRO || existing?.plan === PLANS.PRO
    ? PLANS.PRO
    : (clerkPlan || existing?.plan || PLANS.FREE);
  const patch = { plan };
  if (ids.stripeCustomerId && !existing?.stripeCustomerId) patch.stripeCustomerId = ids.stripeCustomerId;
  if (ids.stripeSubscriptionId && !existing?.stripeSubscriptionId) {
    patch.stripeSubscriptionId = ids.stripeSubscriptionId;
  }
  if (ids.subscriptionStatus && !existing?.subscriptionStatus) {
    patch.subscriptionStatus = ids.subscriptionStatus;
  }
  runtime.accounts.applyPatch(user.id, patch);
  return { ...user, plan };
}
