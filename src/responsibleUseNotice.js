import { MERIDIAN_TERMS } from './billing/plans.js';

/** Durable / session dismissal key. Written by the visitor's dismiss control. */
export const RESPONSIBLE_USE_NOTICE_KEY = 'meridian.notice.responsibleUse';

export const RESPONSIBLE_USE_NOTICE_TITLE = 'Meridian';

export const RESPONSIBLE_USE_NOTICE_COPY =
  'This view uses public and third-party data. It can be delayed or wrong, and it is not for navigation or emergencies.';

/**
 * Resolve a Web Storage area without letting a hostile getter escape.
 * @param {'local'|'session'} kind
 * @param {object|null|undefined} injected Explicit store; `undefined` means "use the global".
 * @returns {{getItem?: Function, setItem?: Function}|null}
 */
function resolveStore(kind, injected) {
  if (injected !== undefined) return injected;
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStored(kind, injected) {
  try {
    return resolveStore(kind, injected)?.getItem?.(RESPONSIBLE_USE_NOTICE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(kind, injected, value) {
  try {
    const store = resolveStore(kind, injected);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(RESPONSIBLE_USE_NOTICE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * First-visit notice: hide only after a recorded dismissal.
 * Session or localStorage `meridian.notice.responsibleUse` both count.
 * @param {object} [input]
 * @param {{getItem?: Function}|null} [input.storage]
 * @param {{getItem?: Function}|null} [input.sessionStorageRef]
 * @returns {boolean}
 */
export function shouldShowResponsibleUseNotice({
  storage,
  sessionStorageRef,
} = {}) {
  if (readStored('local', storage) === 'dismissed') return false;
  if (readStored('session', sessionStorageRef) === 'dismissed') return false;
  return true;
}

/**
 * Remember dismissal in sessionStorage and localStorage (same key).
 * @param {object} [input]
 * @param {{setItem?: Function}|null} [input.storage]
 * @param {{setItem?: Function}|null} [input.sessionStorageRef]
 */
export function dismissResponsibleUseNotice({
  storage,
  sessionStorageRef,
} = {}) {
  writeStored('local', storage, 'dismissed');
  writeStored('session', sessionStorageRef, 'dismissed');
}

/**
 * Activate the existing Cesium "Data attribution" expand control.
 * @param {Document} [documentRef]
 * @returns {boolean}
 */
export function openDataAttribution(documentRef = globalThis.document) {
  const link = documentRef?.querySelector?.('#cesium-credits .cesium-credit-expand-link');
  if (typeof link?.click !== 'function') return false;
  link.click();
  return true;
}

/**
 * Wire the dismissible first-visit notice. Not a modal wall: the globe stays usable.
 * @param {object} [input]
 * @param {Document} [input.documentRef]
 * @param {Storage} [input.storage]
 * @param {Storage} [input.sessionStorageRef]
 * @returns {null|{dismiss: Function}}
 */
export function initResponsibleUseNotice({
  documentRef = globalThis.document,
  storage,
  sessionStorageRef,
} = {}) {
  const root = documentRef?.getElementById?.('responsible-use-notice');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';

  if (!shouldShowResponsibleUseNotice({ storage, sessionStorageRef })) {
    root.remove();
    return null;
  }

  const title = root.querySelector('#responsible-use-title')
    || root.querySelector('[data-responsible-use-title]');
  const copy = root.querySelector('#responsible-use-copy')
    || root.querySelector('[data-responsible-use-copy]');
  const terms = root.querySelector('[data-responsible-use-terms]');
  const dismissButton = root.querySelector('[data-responsible-use-dismiss]');
  const attributionButton = root.querySelector('[data-responsible-use-attribution]');

  if (title) title.textContent = RESPONSIBLE_USE_NOTICE_TITLE;
  if (copy) copy.textContent = RESPONSIBLE_USE_NOTICE_COPY;
  if (terms) terms.textContent = MERIDIAN_TERMS;

  const dismiss = () => {
    dismissResponsibleUseNotice({ storage, sessionStorageRef });
    root.classList.remove('visible');
    root.hidden = true;
  };

  dismissButton?.addEventListener('click', (event) => {
    event?.preventDefault?.();
    dismiss();
  });
  attributionButton?.addEventListener('click', (event) => {
    event?.preventDefault?.();
    openDataAttribution(documentRef);
  });

  root.hidden = false;
  root.classList.add('visible');
  return { dismiss };
}
