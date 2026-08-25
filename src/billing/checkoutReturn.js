import { PLANS } from './plans.js';

export const CHECKOUT_POLL_INTERVAL_MS = 2000;
export const CHECKOUT_POLL_TIMEOUT_MS = 30_000;

export const CHECKOUT_WAITING_COPY =
  'Pro checkout complete. Voice unlocks after the Stripe webhook marks this account.';
export const CHECKOUT_PRO_ACTIVE_COPY = 'Pro is active';
export const CHECKOUT_CANCELED_COPY = 'Checkout canceled. You are still on the Free demo.';

export function readAndClearCheckoutParam(location, history) {
  const params = new URLSearchParams(location.search);
  const checkout = params.get('checkout');
  if (!checkout) return null;
  params.delete('checkout');
  const next = `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash || ''}`;
  history.replaceState({}, '', next);
  return checkout;
}

export async function pollBillingMeUntilPro({
  fetchMe,
  intervalMs = CHECKOUT_POLL_INTERVAL_MS,
  maxMs = CHECKOUT_POLL_TIMEOUT_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  const startedAt = now();
  let entitlement = null;

  while (true) {
    try {
      entitlement = await fetchMe();
    } catch {
      entitlement = null;
    }
    if (entitlement?.plan === PLANS.PRO) {
      return { status: 'pro', entitlement };
    }
    const elapsed = now() - startedAt;
    if (elapsed >= maxMs) {
      return { status: 'waiting', entitlement };
    }
    await sleep(Math.min(intervalMs, Math.max(0, maxMs - elapsed)));
    if (now() - startedAt >= maxMs) {
      return { status: 'waiting', entitlement };
    }
  }
}

export async function handleCheckoutReturn({
  location,
  history,
  fetchMe,
  applyEntitlement,
  showToast,
  intervalMs = CHECKOUT_POLL_INTERVAL_MS,
  maxMs = CHECKOUT_POLL_TIMEOUT_MS,
  now,
  sleep,
} = {}) {
  const checkout = readAndClearCheckoutParam(location, history);
  if (!checkout) return { status: 'none' };
  if (checkout !== 'success') {
    showToast?.(CHECKOUT_CANCELED_COPY);
    return { status: 'canceled' };
  }

  showToast?.(CHECKOUT_WAITING_COPY);
  const result = await pollBillingMeUntilPro({ fetchMe, intervalMs, maxMs, now, sleep });
  if (result.entitlement) applyEntitlement?.(result.entitlement);
  showToast?.(result.status === 'pro' ? CHECKOUT_PRO_ACTIVE_COPY : CHECKOUT_WAITING_COPY);
  return result;
}
