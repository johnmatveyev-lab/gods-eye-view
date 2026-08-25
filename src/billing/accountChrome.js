import { PLANS, PRO_PRICE_USD } from './plans.js';
import { formatRemainingBudget } from './usage.js';
import { shouldShowSavedViewsButton } from './savedViews.js';

export function planLabel(plan) {
  switch (plan) {
    case PLANS.PRO:
      return 'PRO';
    case PLANS.FREE:
      return 'FREE';
    case PLANS.SELF_HOST:
      return 'SELF-HOST';
    case PLANS.ANONYMOUS:
      return 'GUEST';
    default: {
      const _exhaustive = plan;
      return String(_exhaustive || 'GUEST').toUpperCase();
    }
  }
}

export function renderAccount(root, account) {
  const entitlement = account.entitlement;
  const plan = entitlement?.plan || PLANS.ANONYMOUS;
  root.plan.textContent = planLabel(plan);
  root.budget.textContent = plan === PLANS.ANONYMOUS
    ? 'Sign in for a 15-minute Free demo'
    : formatRemainingBudget(entitlement.remaining);

  const signedIn = Boolean(account.clerk?.user);
  root.signIn.hidden = signedIn;
  root.user.hidden = !signedIn;
  root.upgrade.hidden = !(entitlement?.upgrade?.available);
  root.manage.hidden = !(signedIn && plan === PLANS.PRO && entitlement?.stripeConfigured);
  root.saved.hidden = !shouldShowSavedViewsButton(entitlement);
  root.exhausted.hidden = !entitlement?.exhausted;

  if (signedIn && root.user.childElementCount === 0 && account.clerk) {
    const appearance = account.appearance;
    account.clerk.mountUserButton(root.user, appearance ? { appearance } : {});
  }

  if (entitlement?.exhausted) {
    root.exhausted.querySelector('[data-billing-exhausted-copy]').textContent =
      plan === PLANS.PRO
        ? 'Daily Pro budget used. The globe you already have stays up. Try again after UTC midnight.'
        : `Free demo used for today. Upgrade to Pro ($${PRO_PRICE_USD}/mo) for voice and a higher cap. The globe stays visible.`;
  }
}
