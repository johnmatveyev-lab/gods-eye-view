import assert from 'node:assert/strict';
import test from 'node:test';
import { attachVoiceGate } from './client.js';
import { PLANS } from './plans.js';

function createModal() {
  const fields = {
    '[data-billing-title]': { textContent: '' },
    '[data-billing-body]': { textContent: '' },
    '[data-billing-primary]': { textContent: '', hidden: false },
    '[data-clerk-sign-in]': { hidden: true, replaceChildren() {} },
    '[data-saved-views]': { hidden: true },
  };
  return {
    hidden: true,
    dataset: {},
    querySelector(selector) {
      return fields[selector] || { textContent: '', hidden: true, replaceChildren() {} };
    },
  };
}

function createButton() {
  const listeners = [];
  return {
    listeners,
    attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, fn, options) {
      listeners.push({ type, fn, options });
    },
  };
}

function clickLockedMic(account) {
  const button = createButton();
  const modal = createModal();
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const fetches = [];
  globalThis.document = {
    getElementById(id) {
      return id === 'billing-modal' ? modal : null;
    },
  };
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    attachVoiceGate({ ui: { button, root: { dataset: {} } } }, account);
    const click = button.listeners.find((listener) => listener.type === 'click');
    assert.ok(click, 'locked MIC must bind a capture click');
    assert.equal(click.options, true);
    const event = {
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    click.fn(event);
    return { event, modal, fetches, button };
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
}

test('hosted Free MIC click opens upgrade and never requests a token', () => {
  const entitlement = { plan: PLANS.FREE, signedIn: true, voice: false };
  const { event, modal, fetches, button } = clickLockedMic({
    config: { hosted: true },
    clerk: {},
    entitlement,
  });
  assert.equal(button.attributes['aria-disabled'], 'true');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(modal.hidden, false);
  assert.equal(modal.dataset.primaryAction, 'upgrade');
  assert.match(modal.querySelector('[data-billing-primary]').textContent, /Upgrade to Pro/);
  assert.deepEqual(fetches, []);
});

test('anonymous MIC click opens sign-in and never requests a token', () => {
  const entitlement = { plan: PLANS.ANONYMOUS, signedIn: false, voice: false };
  const { event, modal, fetches } = clickLockedMic({
    config: { hosted: true },
    clerk: {},
    entitlement,
  });
  assert.equal(event.prevented, true);
  assert.equal(modal.dataset.primaryAction, 'signin');
  assert.equal(modal.querySelector('[data-billing-primary]').textContent, 'Sign in');
  assert.deepEqual(fetches, []);
});

test('self-host MIC click does not open the billing modal', () => {
  const entitlement = { plan: PLANS.SELF_HOST, signedIn: false, voice: true };
  const { event, modal, fetches, button } = clickLockedMic({
    config: { hosted: false },
    entitlement,
  });
  assert.equal(button.attributes['aria-disabled'], 'false');
  assert.equal(event.prevented, false);
  assert.equal(modal.hidden, true);
  assert.deepEqual(fetches, []);
});
