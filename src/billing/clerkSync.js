import { createClerkClient } from '@clerk/backend';
import { PLANS, isKnownPlan } from './plans.js';

export function planFromClerkUser(record) {
  const plan = record?.publicMetadata?.meridianPlan
    || record?.privateMetadata?.meridianPlan
    || record?.plan
    || null;
  return isKnownPlan(plan) ? plan : null;
}

export function stripeIdsFromClerkUser(record) {
  const publicMeta = record?.publicMetadata || {};
  const privateMeta = record?.privateMetadata || {};
  return {
    stripeCustomerId: publicMeta.stripeCustomerId || privateMeta.stripeCustomerId || record?.stripeCustomerId || null,
    stripeSubscriptionId: publicMeta.stripeSubscriptionId || privateMeta.stripeSubscriptionId || record?.stripeSubscriptionId || null,
    subscriptionStatus: privateMeta.subscriptionStatus || publicMeta.subscriptionStatus || record?.subscriptionStatus || null,
  };
}

export function clerkMetadataFromAccount(account) {
  const stripeCustomerId = account?.stripeCustomerId || null;
  const stripeSubscriptionId = account?.stripeSubscriptionId || null;
  const subscriptionStatus = account?.subscriptionStatus || null;
  return {
    publicMetadata: {
      meridianPlan: account?.plan || PLANS.FREE,
      stripeCustomerId,
      stripeSubscriptionId,
    },
    privateMetadata: {
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus,
    },
  };
}

export async function fetchClerkUser(userId, runtime) {
  if (typeof runtime.getUserRecord === 'function') {
    return runtime.getUserRecord(userId);
  }
  if (!userId || !runtime.config.clerkSecretKey) return null;
  const clerk = createClerkClient({ secretKey: runtime.config.clerkSecretKey });
  return clerk.users.getUser(userId);
}

/**
 * Copy Clerk-backed plan/customer ids into the process store so Pro survives
 * a serverless cold start. In-memory Pro from a just-applied webhook wins
 * over a stale Clerk FREE.
 */
export async function hydrateAccountFromClerk(user, runtime) {
  if (!user?.id) return user;
  const existing = runtime.accounts.get(user.id);
  if (existing?.plan === PLANS.PRO && existing.stripeCustomerId) {
    return { ...user, plan: PLANS.PRO };
  }

  let record;
  try {
    record = await fetchClerkUser(user.id, runtime);
  } catch {
    return existing ? { ...user, plan: existing.plan } : user;
  }
  if (!record) {
    return existing ? { ...user, plan: existing.plan } : user;
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
