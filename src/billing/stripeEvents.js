import { PLANS } from './plans.js';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Map a Stripe subscription status onto a Meridian plan.
 * Unknown statuses fail closed to Free.
 */
export function planFromSubscriptionStatus(status) {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return PLANS.PRO;
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return PLANS.FREE;
    default:
      return PLANS.FREE;
  }
}

export function extractUserIdFromStripeObject(object) {
  if (!object || typeof object !== 'object') return null;
  const metadataId = object.metadata?.userId || object.subscription_details?.metadata?.userId;
  const clientRef = object.client_reference_id;
  const value = metadataId || clientRef || null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Pure mapping from a Stripe webhook event to an account patch.
 * Returns null when the event is ignored.
 */
export function applyStripeEvent(event) {
  const type = event?.type;
  const object = event?.data?.object || {};
  switch (type) {
    case 'checkout.session.completed': {
      const userId = extractUserIdFromStripeObject(object);
      if (!userId) return null;
      if (object.mode && object.mode !== 'subscription') return null;
      return {
        userId,
        plan: PLANS.PRO,
        stripeCustomerId: object.customer || null,
        stripeSubscriptionId: object.subscription || null,
        subscriptionStatus: 'active',
      };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const userId = extractUserIdFromStripeObject(object);
      if (!userId) return { lookupByCustomerId: object.customer || null, patch: subscriptionPatch(object) };
      return { userId, ...subscriptionPatch(object) };
    }
    default:
      return null;
  }
}

function subscriptionPatch(object) {
  const status = object.status || 'canceled';
  return {
    plan: planFromSubscriptionStatus(status),
    stripeCustomerId: object.customer || null,
    stripeSubscriptionId: object.id || null,
    subscriptionStatus: status,
    active: ACTIVE_SUBSCRIPTION_STATUSES.has(status),
  };
}

/**
 * Hosted Checkout session params. Price IDs come from env, never from a
 * hardcoded fake catalog. Do not set payment_method_types — Stripe picks
 * eligible methods from the Dashboard.
 */
export function buildCheckoutSessionParams({
  priceId,
  userId,
  email,
  customerId,
  origin,
  integrationSuffix = 'meridian',
}) {
  const success = new URL(origin);
  success.searchParams.set('checkout', 'success');
  const cancel = new URL(origin);
  cancel.searchParams.set('checkout', 'canceled');

  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: success.toString(),
    cancel_url: cancel.toString(),
    client_reference_id: userId,
    metadata: { userId, product: 'meridian_pro' },
    subscription_data: {
      metadata: { userId, product: 'meridian_pro' },
    },
    allow_promotion_codes: true,
    integration_identifier: `meridian-pro-${String(integrationSuffix).slice(-8).padStart(8, 'x')}`,
  };

  if (customerId) {
    params.customer = customerId;
  } else if (email) {
    params.customer_email = email;
  }

  return params;
}
