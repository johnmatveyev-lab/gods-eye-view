/**
 * Flight ident watchlist.
 *
 * Operators pin up to 10 public aircraft idents (callsign or hex already on
 * the selected contact). When a watched ident is in the current flights
 * payload it uses the existing track highlight style. Clicking a row tracks
 * that contact if present, otherwise reports "not in view" without inventing
 * a position. Persistence is local only (`meridian.watchlist`). No /api.
 */

export const WATCHLIST_STORAGE_KEY = 'meridian.watchlist';
export const WATCHLIST_CAP = 10;
export const WATCHLIST_NOT_IN_VIEW = 'not in view';
export const WATCHLIST_TOGGLE_ID = 'watchlist-toggle';
export const WATCHLIST_PANEL_ID = 'watchlist-panel';
export const WATCHLIST_ITEMS_ID = 'watchlist-items';
export const SELECTED_CONTACT_WATCH_ID = 'selected-contact-ident-watch';

let currentIdents = [];
const listeners = new Set();

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize a public aircraft ident. Callsigns and hexes compare
 * case-insensitively; empty/whitespace is rejected.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWatchIdent(value) {
  return String(value ?? '').trim().toUpperCase();
}

function contactHex(contact) {
  return normalizeWatchIdent(contact?.icao24 || contact?.hex);
}

function contactCallsign(contact) {
  return normalizeWatchIdent(contact?.callsign);
}

/**
 * Watch ident from a selected aircraft contact. Callsign if present, else hex.
 * Vessels, satellites, and person names never qualify.
 * @param {object} [contact]
 * @returns {string}
 */
export function watchIdentFromContact(contact = {}) {
  if (contact.kind && contact.kind !== 'aircraft') return '';
  if (contact.kind == null && !contact.callsign && !contact.icao24 && !contact.hex) {
    return '';
  }
  return contactCallsign(contact) || contactHex(contact);
}

function contactMatchesWatchIdent(ident, contact) {
  const needle = normalizeWatchIdent(ident);
  if (!needle) return false;
  const hex = contactHex(contact);
  const callsign = contactCallsign(contact);
  return (hex && hex === needle) || (callsign && callsign === needle);
}

/**
 * @param {string} ident
 * @param {Array<object>|null|undefined} flights
 * @returns {object|null}
 */
export function matchWatchIdentInPayload(ident, flights) {
  const needle = normalizeWatchIdent(ident);
  if (!needle || !Array.isArray(flights)) return null;
  let callsignHit = null;
  for (const flight of flights) {
    if (contactHex(flight) === needle) return flight;
    if (!callsignHit && contactCallsign(flight) === needle) callsignHit = flight;
  }
  return callsignHit;
}

/**
 * Whether this ident currently exists in the flights payload.
 * @param {string} ident
 * @param {Array<object>|null|undefined} flights
 * @returns {boolean}
 */
export function shouldHighlightWatchIdent(ident, flights) {
  return matchWatchIdentInPayload(ident, flights) != null;
}

/**
 * Watched idents that are present in the current flights payload.
 * @param {Iterable<string>|null|undefined} list
 * @param {Array<object>|null|undefined} flights
 * @returns {string[]}
 */
export function highlightedWatchIdents(list, flights) {
  return sanitizeWatchlist(list).filter((ident) => shouldHighlightWatchIdent(ident, flights));
}

/**
 * Whether a rendered contact should use the existing track highlight style.
 * @param {{icao24?: string, hex?: string, callsign?: string}|null|undefined} contact
 * @param {Iterable<string>|null|undefined} [list]
 * @returns {boolean}
 */
export function isWatchHighlighted(contact, list = currentIdents) {
  if (!contact) return false;
  return sanitizeWatchlist(list).some((ident) => contactMatchesWatchIdent(ident, contact));
}

function payloadPosition(flight) {
  if (!flight) return null;
  const latitude = Number(flight.latitude ?? flight.lat);
  const longitude = Number(flight.longitude ?? flight.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/**
 * Click a watch row: track the payload contact, or report not in view.
 * Missing rows never invent coordinates.
 * @param {string} ident
 * @param {Array<object>|null|undefined} flights
 * @returns {{action: 'track'|'not-in-view', ident: string, message?: string, icao24: string|null, position: {latitude: number, longitude: number}|null}}
 */
export function resolveWatchRowClick(ident, flights) {
  const normalized = normalizeWatchIdent(ident);
  const flight = matchWatchIdentInPayload(normalized, flights);
  if (!normalized || !flight) {
    return {
      action: 'not-in-view',
      ident: normalized,
      message: WATCHLIST_NOT_IN_VIEW,
      icao24: null,
      position: null,
    };
  }
  return {
    action: 'track',
    ident: normalized,
    icao24: String(flight.icao24 || flight.hex || '').trim() || null,
    position: payloadPosition(flight),
  };
}

function sanitizeWatchlist(list) {
  const seen = new Set();
  const idents = [];
  for (const value of Array.isArray(list) ? list : []) {
    const ident = normalizeWatchIdent(value);
    if (!ident || seen.has(ident)) continue;
    seen.add(ident);
    idents.push(ident);
    if (idents.length >= WATCHLIST_CAP) break;
  }
  return idents;
}

/**
 * @param {Iterable<string>|null|undefined} list
 * @param {unknown} ident
 * @returns {{ok: boolean, list: string[], added: boolean, reason: string|null}}
 */
export function addWatchIdent(list, ident) {
  const current = sanitizeWatchlist(list);
  const normalized = normalizeWatchIdent(ident);
  if (!normalized) return { ok: false, list: current, added: false, reason: 'empty' };
  if (current.includes(normalized)) {
    return { ok: true, list: current, added: false, reason: 'already' };
  }
  if (current.length >= WATCHLIST_CAP) {
    return { ok: false, list: current, added: false, reason: 'full' };
  }
  return { ok: true, list: [...current, normalized], added: true, reason: null };
}

/**
 * @param {Iterable<string>|null|undefined} list
 * @param {unknown} ident
 * @returns {{ok: boolean, list: string[], removed: boolean}}
 */
export function removeWatchIdent(list, ident) {
  const current = sanitizeWatchlist(list);
  const normalized = normalizeWatchIdent(ident);
  const next = current.filter((value) => value !== normalized);
  return { ok: true, list: next, removed: next.length !== current.length };
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {string[]}
 */
export function readWatchlist(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(WATCHLIST_STORAGE_KEY);
    if (raw == null || raw === '') return [];
    return sanitizeWatchlist(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * @param {Iterable<string>|null|undefined} list
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {string[]}
 */
export function writeWatchlist(list, storage) {
  const idents = sanitizeWatchlist(list);
  try {
    const store = resolveStorage(storage);
    store?.setItem?.(WATCHLIST_STORAGE_KEY, JSON.stringify(idents));
  } catch {
    // Fail open: the session can still hold the list in memory.
  }
  return idents;
}

/** Live in-memory watchlist. */
export function getWatchlist() {
  return currentIdents.slice();
}

/**
 * @param {Iterable<string>|null|undefined} list
 * @param {{persist?: boolean, storage?: object}} [options]
 * @returns {string[]}
 */
export function setWatchlist(list, { persist = true, storage } = {}) {
  currentIdents = persist ? writeWatchlist(list, storage) : sanitizeWatchlist(list);
  for (const listener of listeners) listener(currentIdents.slice());
  return currentIdents.slice();
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string[]}
 */
export function hydrateWatchlist(storage) {
  return setWatchlist(readWatchlist(storage), { persist: false, storage });
}

/**
 * @param {(idents: string[]) => void} listener
 * @returns {() => void}
 */
export function subscribeWatchlist(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore an empty watchlist without clearing subscribers. */
export function resetWatchlistForTest() {
  currentIdents = [];
  for (const listener of listeners) listener(currentIdents.slice());
}

/**
 * Paint the watch list. Empty/not-in-view rows never include coordinates.
 * @param {HTMLElement|null} items
 * @param {Iterable<string>|null|undefined} list
 * @param {Array<object>|null|undefined} flights
 */
export function renderWatchlist(items, list, flights) {
  if (!items) return;
  const idents = sanitizeWatchlist(list);
  items.replaceChildren();
  if (idents.length === 0) {
    const empty = items.ownerDocument?.createElement?.('div')
      || globalThis.document?.createElement?.('div');
    if (!empty) return;
    empty.className = 'watchlist-empty';
    empty.textContent = 'No watched aircraft';
    items.appendChild(empty);
    return;
  }
  for (const ident of idents) {
    const row = items.ownerDocument?.createElement?.('div')
      || globalThis.document?.createElement?.('div');
    if (!row) return;
    row.className = 'watchlist-item';
    row.dataset.watchIdent = ident;
    row.setAttribute('role', 'listitem');
    const inView = shouldHighlightWatchIdent(ident, flights);

    const select = items.ownerDocument?.createElement?.('button')
      || globalThis.document?.createElement?.('button');
    select.type = 'button';
    select.className = 'watchlist-item-select';
    select.dataset.watchIdent = ident;
    select.textContent = inView ? ident : `${ident} · ${WATCHLIST_NOT_IN_VIEW}`;

    const remove = items.ownerDocument?.createElement?.('button')
      || globalThis.document?.createElement?.('button');
    remove.type = 'button';
    remove.className = 'watchlist-item-remove';
    remove.dataset.watchRemove = ident;
    remove.setAttribute('aria-label', `Remove ${ident}`);
    remove.textContent = '×';

    row.appendChild(select);
    row.appendChild(remove);
    items.appendChild(row);
  }
}

/**
 * Bind hosted Watch chrome. Add comes from the selected aircraft card.
 * Row click tracks when the ident is in the current flights payload.
 *
 * @param {object} [options]
 * @returns {{refresh: Function, destroy: Function, idents: Function}|null}
 */
export function bindWatchlist({
  toggle = null,
  panel = null,
  items = null,
  addButton = null,
  getFlights = () => [],
  getSelectedContact = () => null,
  trackById = null,
  showToast = null,
  flyTo = null,
  storage,
  windowTarget = globalThis.window,
} = {}) {
  if (!items && !addButton && !toggle) return null;

  let open = false;
  const windowListeners = [];

  const refresh = () => {
    const idents = getWatchlist();
    const flights = typeof getFlights === 'function' ? getFlights() || [] : [];
    if (items) renderWatchlist(items, idents, flights);
    if (toggle) {
      toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      toggle.classList?.toggle?.('active', open);
    }
    if (panel) {
      panel.hidden = !open;
      if (open) panel.removeAttribute?.('hidden');
      else panel.setAttribute?.('hidden', '');
    }
    const contact = typeof getSelectedContact === 'function' ? getSelectedContact() : null;
    const ident = watchIdentFromContact(contact || {});
    if (addButton) {
      const watching = ident && getWatchlist().includes(ident);
      addButton.hidden = !ident;
      addButton.disabled = !ident;
      addButton.setAttribute('aria-pressed', watching ? 'true' : 'false');
      addButton.setAttribute('aria-label', ident ? `Watch ${ident}` : 'Watch ident');
      addButton.title = ident ? `Watch ${ident}` : 'Watch ident';
    }
    return idents;
  };

  const persist = (list) => {
    setWatchlist(list, { storage });
    refresh();
  };

  const onAdd = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const contact = typeof getSelectedContact === 'function' ? getSelectedContact() : null;
    const ident = watchIdentFromContact(contact || {});
    const result = addWatchIdent(getWatchlist(), ident);
    if (!result.ok && result.reason === 'full') {
      showToast?.('Watch list is full');
      return;
    }
    persist(result.list);
    if (result.added) {
      open = true;
      refresh();
    }
  };

  const onToggle = (event) => {
    event?.preventDefault?.();
    open = !open;
    refresh();
  };

  const onItemsClick = (event) => {
    const remove = event?.target?.closest?.('[data-watch-remove]');
    if (remove) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      persist(removeWatchIdent(getWatchlist(), remove.dataset.watchRemove).list);
      return;
    }
    const row = event?.target?.closest?.('[data-watch-ident]');
    if (!row) return;
    event?.preventDefault?.();
    const outcome = resolveWatchRowClick(row.dataset.watchIdent, getFlights?.() || []);
    if (outcome.action === 'track' && outcome.icao24 && typeof trackById === 'function') {
      trackById(outcome.icao24);
      return;
    }
    showToast?.(WATCHLIST_NOT_IN_VIEW);
  };

  addButton?.addEventListener?.('click', onAdd);
  toggle?.addEventListener?.('click', onToggle);
  items?.addEventListener?.('click', onItemsClick);
  if (windowTarget?.addEventListener) {
    for (const name of [
      'gev:entity-selected',
      'gev:entity-selection-cleared',
      'gev:awareness-subject-selected',
      'gev:awareness-subject-cleared',
    ]) {
      windowTarget.addEventListener(name, refresh);
      windowListeners.push({ name, handler: refresh });
    }
  }
  const unsubscribe = subscribeWatchlist(() => refresh());
  refresh();

  return {
    refresh,
    idents: () => getWatchlist(),
    destroy() {
      addButton?.removeEventListener?.('click', onAdd);
      toggle?.removeEventListener?.('click', onToggle);
      items?.removeEventListener?.('click', onItemsClick);
      for (const { name, handler } of windowListeners) {
        windowTarget?.removeEventListener?.(name, handler);
      }
      unsubscribe();
    },
  };
}
