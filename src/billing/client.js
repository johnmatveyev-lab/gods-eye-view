import { planLabel } from './accountChrome.js';
import { handleCheckoutReturn as pollCheckoutReturn } from './checkoutReturn.js';
import { MERIDIAN_TERMS, PLANS, PRO_PRICE_USD } from './plans.js';
import { formatRemainingBudget } from './usage.js';
import { decodeShareViewUrl, encodeShareViewUrl } from '../sharelink.js';
import {
  canUseSavedViews,
  deleteSavedView,
  loadSavedViews,
  restoreSavedView,
  saveCurrentView,
  shouldShowSavedViewsButton,
} from './savedViews.js';

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_SECONDS = 30;

const CLERK_APPEARANCE = Object.freeze({
  variables: {
    colorPrimary: '#00d4ff',
    colorBackground: '#0c0c14',
    colorText: '#e8eaed',
    colorTextSecondary: 'rgba(232, 234, 237, 0.65)',
    borderRadius: '10px',
  },
});

export async function initMeridianAccount() {
  const root = ensureAccountChrome();
  const publishableKey = String(import.meta.env.CLERK_PUBLISHABLE_KEY || '').trim();
  const account = {
    clerk: null,
    config: null,
    entitlement: null,
    getAccessToken: async () => null,
  };
  window.__meridianAccount = account;

  root.terms.textContent = MERIDIAN_TERMS;
  bindChrome(root, account);

  try {
    account.config = await fetchJson('/api/billing/config');
  } catch {
    account.config = { hosted: Boolean(publishableKey), stripeConfigured: false, clerkConfigured: Boolean(publishableKey), terms: MERIDIAN_TERMS };
  }
  if (account.config?.terms) root.terms.textContent = account.config.terms;

  if (!publishableKey || !account.config?.hosted) {
    renderSelfHost(root, account);
    return account;
  }

  try {
    const { Clerk } = await import('@clerk/clerk-js');
    const clerk = new Clerk(publishableKey);
    await clerk.load();
    account.clerk = clerk;
    account.getAccessToken = async () => {
      try {
        return await clerk.session?.getToken() || null;
      } catch {
        return null;
      }
    };
    clerk.addListener(() => {
      void refreshAccount(root, account);
    });
    await refreshAccount(root, account);
    void beginCheckoutReturnPoll(root, account);
  } catch (error) {
    renderNotice(root, 'Could not load Clerk sign-in. Check CLERK_PUBLISHABLE_KEY.', account);
    console.warn('[Meridian billing]', error);
  }

  startHeartbeat(account);
  return account;
}

export function attachVoiceGate(voiceController, account = window.__meridianAccount) {
  if (!voiceController?.ui?.button || !account) return;
  const button = voiceController.ui.button;
  button.addEventListener('click', (event) => {
    const entitlement = account.entitlement;
    if (!entitlement || entitlement.plan === PLANS.SELF_HOST) return;
    if (entitlement.voice) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openModal(document.getElementById('billing-modal'), {
      title: 'Voice is a Pro feature',
      body: entitlement.signedIn
        ? `Upgrade to Pro ($${PRO_PRICE_USD}/mo) for hands-free voice on this host. The globe stays available on Free.`
        : 'Sign in for a capped Free demo, then upgrade to Pro for voice.',
      primary: entitlement.signedIn ? 'Upgrade to Pro' : 'Sign in',
    }, account, { primaryAction: entitlement.signedIn ? 'upgrade' : 'signin' });
  }, true);
}

async function refreshAccount(root, account) {
  try {
    account.entitlement = await fetchBillingMe(account);
  } catch {
    account.entitlement = {
      plan: account.clerk?.user ? PLANS.FREE : PLANS.ANONYMOUS,
      signedIn: Boolean(account.clerk?.user),
      voice: false,
      exhausted: false,
      remaining: { sessionSeconds: 15 * 60, requestUnits: 120 },
      upgrade: { available: Boolean(account.config?.stripeConfigured), priceUsd: PRO_PRICE_USD },
      stripeConfigured: Boolean(account.config?.stripeConfigured),
    };
  }
  renderAccount(root, account);
}

function renderSelfHost(root, account) {
  account.entitlement = {
    plan: PLANS.SELF_HOST,
    signedIn: false,
    voice: true,
    exhausted: false,
    remaining: { sessionSeconds: Number.POSITIVE_INFINITY },
    upgrade: { available: false, priceUsd: PRO_PRICE_USD },
  };
  root.plan.textContent = 'SELF-HOST';
  root.budget.textContent = 'Billing off — BYOK';
  root.signIn.hidden = true;
  root.upgrade.hidden = true;
  root.manage.hidden = true;
  root.user.hidden = true;
  root.saved.hidden = true;
  root.exhausted.hidden = true;
  root.modal.hidden = true;
}

function renderNotice(root, message, account) {
  root.plan.textContent = 'BILLING';
  root.budget.textContent = message;
  root.signIn.hidden = true;
  root.upgrade.hidden = true;
  account.entitlement = { plan: PLANS.ANONYMOUS, signedIn: false, voice: false };
}

function renderAccount(root, account) {
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
    account.clerk.mountUserButton(root.user, { appearance: CLERK_APPEARANCE });
  }

  if (entitlement?.exhausted) {
    root.exhausted.querySelector('[data-billing-exhausted-copy]').textContent =
      plan === PLANS.PRO
        ? 'Daily Pro budget used. The globe you already have stays up. Try again after UTC midnight.'
        : `Free demo used for today. Upgrade to Pro ($${PRO_PRICE_USD}/mo) for voice and a higher cap. The globe stays visible.`;
  }
}

function bindChrome(root, account) {
  root.signIn.addEventListener('click', () => openSignIn(root, account));
  root.upgrade.addEventListener('click', () => startCheckout(account, root));
  root.manage.addEventListener('click', () => startPortal(account, root));
  root.saved.addEventListener('click', () => {
    openSavedViews(root, account);
  });
  root.exhausted.querySelector('[data-billing-upgrade]')?.addEventListener('click', () => startCheckout(account, root));
  root.modal.querySelector('[data-billing-close]')?.addEventListener('click', () => closeModal(root.modal));
  root.modal.querySelector('[data-billing-primary]')?.addEventListener('click', () => {
    const action = root.modal.dataset.primaryAction || 'upgrade';
    if (action === 'signin') openSignIn(root, account);
    else if (action === 'upgrade') void startCheckout(account, root);
    else if (action === 'save-view') saveViewFromModal(root, account);
    else closeModal(root.modal);
  });
  root.modal.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-saved-view-action]');
    if (!button) return;
    handleSavedViewAction(root, account, button);
  });
}

function openSignIn(root, account) {
  if (!account.clerk) {
    openModal(root.modal, {
      title: 'Sign-in unavailable',
      body: 'Clerk is not configured. Set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.',
      primary: 'Close',
    }, account, { primaryAction: 'close' });
    return;
  }
  root.modal.hidden = false;
  root.modal.querySelector('[data-billing-title]').textContent = 'Sign in';
  root.modal.querySelector('[data-billing-body]').textContent =
    'Free includes a 15-minute daily globe demo. Voice and a higher cap are Pro.';
  root.modal.querySelector('[data-billing-primary]').hidden = true;
  const saved = root.modal.querySelector('[data-saved-views]');
  if (saved) saved.hidden = true;
  const mount = root.modal.querySelector('[data-clerk-sign-in]');
  mount.hidden = false;
  mount.replaceChildren();
  account.clerk.mountSignIn(mount, { appearance: CLERK_APPEARANCE });
}

function openModal(modal, { title, body, primary }, account, { primaryAction = 'upgrade' } = {}) {
  modal.hidden = false;
  modal.dataset.primaryAction = primaryAction;
  modal.querySelector('[data-billing-title]').textContent = title;
  modal.querySelector('[data-billing-body]').textContent = body;
  const button = modal.querySelector('[data-billing-primary]');
  button.hidden = primaryAction === 'close';
  button.textContent = primary;
  modal.querySelector('[data-clerk-sign-in]').hidden = true;
  const saved = modal.querySelector('[data-saved-views]');
  if (saved) saved.hidden = primaryAction !== 'save-view';
}

function closeModal(modal) {
  modal.hidden = true;
  modal.querySelector('[data-clerk-sign-in]')?.replaceChildren();
  const saved = modal.querySelector('[data-saved-views]');
  if (saved) saved.hidden = true;
}

function openSavedViews(root, account) {
  const entitlement = account.entitlement;
  if (!shouldShowSavedViewsButton(entitlement)) return;
  const userId = account.clerk?.user?.id;
  const items = userId ? loadSavedViews(window.localStorage, userId) : [];
  const atCap = items.length >= 10;
  openModal(root.modal, {
    title: 'Saved views',
    body: atCap
      ? 'This browser holds 10 saved views. Delete one to save another.'
      : 'Save this camera, style, and layer setup. Views stay on this device for your Pro account.',
    primary: 'Save current view',
  }, account, { primaryAction: 'save-view' });
  const nameInput = root.modal.querySelector('[data-saved-view-name]');
  if (nameInput) {
    nameInput.value = defaultSavedViewName(items.length);
    nameInput.hidden = atCap;
  }
  const saveButton = root.modal.querySelector('[data-billing-primary]');
  if (saveButton) saveButton.hidden = atCap;
  renderSavedViewsList(root.modal, items);
}

function saveViewFromModal(root, account) {
  const entitlement = account.entitlement;
  if (!canUseSavedViews(entitlement)) return;
  const userId = account.clerk?.user?.id;
  if (!userId) return;
  const nameInput = root.modal.querySelector('[data-saved-view-name]');
  const name = String(nameInput?.value || '').trim() || defaultSavedViewName(0);
  const result = saveCurrentView({
    storage: window.localStorage,
    userId,
    entitlement,
    name,
    url: captureCurrentShareUrl(),
    nowMs: Date.now(),
    id: `sv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });
  if (!result.ok && result.reason === 'cap') {
    root.modal.querySelector('[data-billing-body]').textContent =
      'This browser holds 10 saved views. Delete one to save another.';
  }
  openSavedViews(root, account);
}

function handleSavedViewAction(root, account, button) {
  const entitlement = account.entitlement;
  if (!canUseSavedViews(entitlement)) return;
  const userId = account.clerk?.user?.id;
  const id = button.getAttribute('data-saved-view-id');
  const action = button.getAttribute('data-saved-view-action');
  const items = userId ? loadSavedViews(window.localStorage, userId) : [];
  const item = items.find((row) => row.id === id);
  switch (action) {
    case 'restore':
      if (!item) return;
      restoreSavedView({
        entitlement,
        url: item.url,
        assignLocation: applySavedViewUrl,
      });
      closeModal(root.modal);
      return;
    case 'delete':
      if (!id) return;
      deleteSavedView({
        storage: window.localStorage,
        userId,
        entitlement,
        id,
      });
      openSavedViews(root, account);
      return;
    default: {
      const _exhaustive = action;
      return _exhaustive;
    }
  }
}

function renderSavedViewsList(modal, items) {
  const list = modal.querySelector('[data-saved-views-list]');
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'saved-views-empty';
    empty.textContent = 'No saved views yet.';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'saved-view-row';
    const meta = document.createElement('div');
    meta.className = 'saved-view-meta';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const when = document.createElement('span');
    when.textContent = formatSavedViewWhen(item.createdAt);
    meta.append(name, when);
    const actions = document.createElement('div');
    actions.className = 'saved-view-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore';
    restore.setAttribute('data-saved-view-action', 'restore');
    restore.setAttribute('data-saved-view-id', item.id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.setAttribute('data-saved-view-action', 'delete');
    remove.setAttribute('data-saved-view-id', item.id);
    actions.append(restore, remove);
    row.append(meta, actions);
    list.appendChild(row);
  }
}

function defaultSavedViewName(count) {
  return `View ${count + 1}`;
}

function formatSavedViewWhen(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function captureCurrentShareUrl() {
  const manager = window.__godsEyeView?.styleManager?.shareLinkManager;
  const captured = manager?.currentShareUrl?.();
  if (captured) return captured;
  return encodeShareViewUrl(window.location.href, window.location.hash);
}

function applySavedViewUrl(url) {
  const manager = window.__godsEyeView?.styleManager?.shareLinkManager;
  const hash = decodeShareViewUrl(url);
  if (manager && hash) {
    window.location.hash = hash;
    const state = manager.parseInitialHash();
    if (state) {
      void manager.applyState(state).then(() => manager.completeInitialRestore());
    }
    return;
  }
  window.location.assign(url);
}

async function startCheckout(account, root) {
  if (!account.clerk?.user) {
    openSignIn(root, account);
    return;
  }
  if (!account.config?.stripeConfigured && !account.entitlement?.stripeConfigured) {
    openModal(root.modal, {
      title: 'Upgrade unavailable',
      body: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO on the host.',
      primary: 'Close',
    }, account, { primaryAction: 'close' });
    return;
  }
  const token = await account.getAccessToken();
  try {
    const result = await fetchJson('/api/billing/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    throw new Error(result.error || 'Checkout did not return a URL.');
  } catch (error) {
    openModal(root.modal, {
      title: 'Upgrade unavailable',
      body: error?.message || 'Could not start Stripe Checkout.',
      primary: 'Close',
    }, account, { primaryAction: 'close' });
  }
}

async function startPortal(account, root) {
  const token = await account.getAccessToken();
  try {
    const result = await fetchJson('/api/billing/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (result.url) window.location.assign(result.url);
    else throw new Error(result.error || 'Portal did not return a URL.');
  } catch (error) {
    openModal(root.modal, {
      title: 'Manage plan',
      body: error?.message || 'Could not open the Stripe customer portal.',
      primary: 'Close',
    }, account, { primaryAction: 'close' });
  }
}

function startHeartbeat(account) {
  const tick = async () => {
    if (document.hidden) return;
    if (!account.clerk?.user) return;
    const token = await account.getAccessToken();
    if (!token) return;
    try {
      account.entitlement = await fetchJson('/api/billing/usage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'session', seconds: HEARTBEAT_SECONDS }),
      });
      const root = document.getElementById('account-bar')?.__meridianRoot;
      if (root) renderAccount(root, account);
    } catch {
      /* keep last known entitlement */
    }
  };
  window.setInterval(tick, HEARTBEAT_MS);
}

function beginCheckoutReturnPoll(root, account) {
  return pollCheckoutReturn({
    location: window.location,
    history: window.history,
    fetchMe: () => fetchBillingMe(account),
    applyEntitlement: (entitlement) => {
      account.entitlement = entitlement;
      renderAccount(root, account);
    },
    showToast: showBillingToast,
  });
}

async function fetchBillingMe(account) {
  const token = await account.getAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return fetchJson('/api/billing/me', { headers });
}

function showBillingToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 6000);
}

function ensureAccountChrome() {
  let bar = document.getElementById('account-bar');
  if (!bar) {
    bar = document.createElement('aside');
    bar.id = 'account-bar';
    document.body.appendChild(bar);
  }
  if (!bar.dataset.ready) {
    bar.innerHTML = `
      <div class="account-kicker">ACCOUNT</div>
      <div id="account-plan">GUEST</div>
      <div id="account-budget">Loading plan…</div>
      <div class="account-actions">
        <button type="button" id="account-sign-in">Sign in</button>
        <button type="button" id="account-upgrade">Upgrade to Pro</button>
        <button type="button" id="account-manage" hidden>Manage plan</button>
        <button type="button" id="account-saved-views" hidden>Saved views</button>
        <div id="account-user" hidden></div>
      </div>
    `;
    bar.dataset.ready = '1';
  }

  let terms = document.getElementById('meridian-terms');
  if (!terms) {
    terms = document.createElement('p');
    terms.id = 'meridian-terms';
    document.body.appendChild(terms);
  }

  let modal = document.getElementById('billing-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'billing-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="billing-modal-card" role="dialog" aria-modal="true" aria-labelledby="billing-modal-title">
        <button type="button" class="billing-modal-close" data-billing-close aria-label="Close">×</button>
        <h2 id="billing-modal-title" data-billing-title>Account</h2>
        <p data-billing-body></p>
        <div data-saved-views hidden>
          <label class="saved-view-name-label">
            <span>Name</span>
            <input type="text" data-saved-view-name maxlength="80" autocomplete="off" />
          </label>
          <div data-saved-views-list></div>
        </div>
        <div data-clerk-sign-in hidden></div>
        <button type="button" class="billing-modal-primary" data-billing-primary>Continue</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  let exhausted = document.getElementById('billing-exhausted');
  if (!exhausted) {
    exhausted = document.createElement('div');
    exhausted.id = 'billing-exhausted';
    exhausted.hidden = true;
    exhausted.innerHTML = `
      <div class="billing-exhausted-card">
        <strong>Daily demo used</strong>
        <p data-billing-exhausted-copy></p>
        <button type="button" data-billing-upgrade>Upgrade to Pro</button>
      </div>
    `;
    document.body.appendChild(exhausted);
  }

  const root = {
    bar,
    plan: document.getElementById('account-plan'),
    budget: document.getElementById('account-budget'),
    signIn: document.getElementById('account-sign-in'),
    upgrade: document.getElementById('account-upgrade'),
    manage: document.getElementById('account-manage'),
    saved: document.getElementById('account-saved-views'),
    user: document.getElementById('account-user'),
    terms,
    modal,
    exhausted,
  };
  bar.__meridianRoot = root;
  return root;
}

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: HTTP ${response.status}`);
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
