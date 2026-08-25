import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MERIDIAN_TERMS } from './billing/plans.js';
import {
  RESPONSIBLE_USE_NOTICE_COPY,
  RESPONSIBLE_USE_NOTICE_KEY,
  RESPONSIBLE_USE_NOTICE_TITLE,
  dismissResponsibleUseNotice,
  initResponsibleUseNotice,
  openDataAttribution,
  shouldShowResponsibleUseNotice,
} from './responsibleUseNotice.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (name) => (values.has(name) ? values.get(name) : null),
    setItem: (name, next) => { values.set(name, next); },
    removeItem: (name) => { values.delete(name); },
    read: (name = RESPONSIBLE_USE_NOTICE_KEY) => values.get(name) ?? null,
  };
}

function makeButton() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    click() {
      for (const listener of listeners) {
        if (listener.type === 'click') listener.fn({ preventDefault() {} });
      }
    },
  };
}

function makeDocument() {
  const title = { textContent: '' };
  const copy = { textContent: '' };
  const terms = { textContent: '' };
  const dismiss = makeButton();
  const attribution = makeButton();
  const expand = { clicks: 0, click() { this.clicks += 1; } };
  const credits = {
    querySelector(sel) {
      return sel.includes('cesium-credit-expand-link') ? expand : null;
    },
  };
  const root = {
    hidden: true,
    dataset: {},
    removed: false,
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      contains(name) { return this.names.has(name); },
    },
    querySelector(sel) {
      if (sel === '#responsible-use-title' || sel === '[data-responsible-use-title]') return title;
      if (sel === '#responsible-use-copy' || sel === '[data-responsible-use-copy]') return copy;
      if (sel === '[data-responsible-use-terms]') return terms;
      if (sel === '[data-responsible-use-dismiss]') return dismiss;
      if (sel === '[data-responsible-use-attribution]') return attribution;
      return null;
    },
    remove() { this.removed = true; },
  };
  const nodes = {
    'responsible-use-notice': root,
    'cesium-credits': credits,
    'meridian-terms': { id: 'meridian-terms', textContent: MERIDIAN_TERMS },
  };
  return {
    title,
    copy,
    terms,
    dismiss,
    attribution,
    expand,
    root,
    getElementById(id) { return nodes[id] || null; },
    querySelector(sel) {
      if (sel === '#cesium-credits .cesium-credit-expand-link') return expand;
      if (sel === '#meridian-terms') return nodes['meridian-terms'];
      return null;
    },
  };
}

test('default copy is a short Meridian notice, not a God\'s Eye View rebrand', () => {
  assert.equal(RESPONSIBLE_USE_NOTICE_TITLE, 'Meridian');
  assert.match(RESPONSIBLE_USE_NOTICE_COPY, /not for navigation/i);
  assert.match(RESPONSIBLE_USE_NOTICE_COPY, /public|third-party/i);
  assert.match(RESPONSIBLE_USE_NOTICE_COPY, /delayed|wrong/i);
  assert.match(RESPONSIBLE_USE_NOTICE_COPY, /emergenc/i);
  assert.doesNotMatch(RESPONSIBLE_USE_NOTICE_TITLE, /God'?s Eye View/i);
  assert.doesNotMatch(RESPONSIBLE_USE_NOTICE_COPY, /God'?s Eye View/i);
  assert.doesNotMatch(RESPONSIBLE_USE_NOTICE_COPY, /person[- ]search|face recognition|named-person/i);
});

test('first visit shows the notice once; dismiss survives reload via meridian.notice.responsibleUse', () => {
  assert.equal(RESPONSIBLE_USE_NOTICE_KEY, 'meridian.notice.responsibleUse');
  const storage = memoryStorage();
  const sessionStorageRef = memoryStorage();

  assert.equal(shouldShowResponsibleUseNotice({ storage, sessionStorageRef }), true);
  dismissResponsibleUseNotice({ storage, sessionStorageRef });
  assert.equal(storage.read(), 'dismissed');
  assert.equal(sessionStorageRef.read(), 'dismissed');

  // Same-tab reload keeps sessionStorage and localStorage.
  assert.equal(shouldShowResponsibleUseNotice({ storage, sessionStorageRef }), false);
  // A later visit still sees the durable key.
  assert.equal(shouldShowResponsibleUseNotice({
    storage,
    sessionStorageRef: memoryStorage(),
  }), false);
});

test('session-only dismissal also hides the notice on reload', () => {
  const sessionStorageRef = memoryStorage({ [RESPONSIBLE_USE_NOTICE_KEY]: 'dismissed' });
  assert.equal(shouldShowResponsibleUseNotice({
    storage: memoryStorage(),
    sessionStorageRef,
  }), false);
});

test('privacy-restricted storage fails open and writes stay best-effort', () => {
  const blocked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.equal(shouldShowResponsibleUseNotice({ storage: blocked, sessionStorageRef: blocked }), true);
  assert.doesNotThrow(() => dismissResponsibleUseNotice({ storage: blocked, sessionStorageRef: blocked }));
});

test('a throwing storage getter still fails open', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const savedSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const hostile = {
    configurable: true,
    get() { throw new Error('SecurityError: The operation is insecure.'); },
  };
  Object.defineProperty(globalThis, 'localStorage', hostile);
  Object.defineProperty(globalThis, 'sessionStorage', hostile);
  try {
    assert.doesNotThrow(() => shouldShowResponsibleUseNotice());
    assert.equal(shouldShowResponsibleUseNotice(), true);
    assert.doesNotThrow(() => dismissResponsibleUseNotice());
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
    if (savedSession) Object.defineProperty(globalThis, 'sessionStorage', savedSession);
    else delete globalThis.sessionStorage;
  }
});

test('init paints existing terms, reveals once, and stays gone after dismiss + re-init', () => {
  const storage = memoryStorage();
  const sessionStorageRef = memoryStorage();
  const first = makeDocument();
  const shown = initResponsibleUseNotice({
    documentRef: first,
    storage,
    sessionStorageRef,
  });
  assert.ok(shown);
  assert.equal(first.root.hidden, false);
  assert.equal(first.root.classList.contains('visible'), true);
  assert.equal(first.title.textContent, 'Meridian');
  assert.match(first.copy.textContent, /not for navigation/i);
  assert.equal(first.terms.textContent, MERIDIAN_TERMS);

  first.dismiss.click();
  assert.equal(storage.read(), 'dismissed');
  assert.equal(first.root.hidden, true);
  assert.equal(first.root.classList.contains('visible'), false);

  const reload = makeDocument();
  const again = initResponsibleUseNotice({
    documentRef: reload,
    storage,
    sessionStorageRef,
  });
  assert.equal(again, null);
  assert.equal(reload.root.removed, true);
});

test('Data attribution opens the existing Cesium credit expand link', () => {
  const documentRef = makeDocument();
  assert.equal(openDataAttribution(documentRef), true);
  assert.equal(documentRef.expand.clicks, 1);

  const storage = memoryStorage();
  initResponsibleUseNotice({
    documentRef,
    storage,
    sessionStorageRef: memoryStorage(),
  });
  documentRef.attribution.click();
  assert.equal(documentRef.expand.clicks, 2);
});

test('markup, startup, and clean-view credits stay pinned', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const module = fs.readFileSync(new URL('./responsibleUseNotice.js', import.meta.url), 'utf8');

  assert.match(html, /<title>Meridian<\/title>/);
  assert.doesNotMatch(html, /<title>[^<]*God'?s Eye View/i);
  assert.match(
    html,
    /id="responsible-use-notice"[^>]*role="region"[^>]*aria-labelledby="responsible-use-title"[^>]*hidden/,
  );
  assert.match(html, /href="#meridian-terms"/);
  assert.match(html, /data-responsible-use-attribution/);
  assert.match(html, /data-responsible-use-dismiss/);
  assert.doesNotMatch(html, /person[- ]search|face recognition|named-person/i);

  const noticeHtml = html.slice(html.indexOf('id="responsible-use-notice"'));
  assert.match(noticeHtml, /not for navigation/i);
  assert.doesNotMatch(noticeHtml.slice(0, noticeHtml.indexOf('</aside>')), /God'?s Eye View/i);

  const startup = main.slice(main.indexOf('void Promise.all(['), main.indexOf('// Expose for debugging'));
  assert.match(startup, /initResponsibleUseNotice\(/);
  assert.ok(
    startup.indexOf('initResponsibleUseNotice') < startup.indexOf('initFirstRunExperience'),
    'the notice must reveal with the globe, before the mission launcher',
  );

  const noticeCss = css.slice(css.indexOf('#responsible-use-notice {'));
  assert.ok(noticeCss.length > 0, 'notice styles are missing');
  const base = noticeCss.slice(0, noticeCss.indexOf('#responsible-use-notice.visible'));
  assert.doesNotMatch(base, /\binset:\s*0\b/);
  assert.doesNotMatch(base, /background:\s*rgba\(6,\s*8,\s*12/);
  assert.match(base, /pointer-events:\s*none/);
  assert.match(css, /#responsible-use-notice\.visible \{[\s\S]*?pointer-events:\s*auto/);
  assert.match(css, /body\.ui-clean-view #responsible-use-notice/);
  assert.match(css, /body\.recording-mode #responsible-use-notice/);

  const cleanCredits = css.slice(
    css.indexOf('body.ui-clean-view #cesium-credits'),
    css.indexOf('body.ui-clean-view #cesium-credits') + 180,
  );
  assert.doesNotMatch(cleanCredits, /display:\s*none/);
  assert.match(css, /body\.ui-clean-view #cesium-credits[\s\S]{0,80}bottom:\s*36px/);

  assert.doesNotMatch(module, /\/api\//);
  assert.doesNotMatch(module, /opensky|news\.google|telegeography|quantum-earth/i);
  assert.match(module, /MERIDIAN_TERMS/);
});
