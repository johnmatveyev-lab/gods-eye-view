import { getSelectedEntityContext } from './data/contextStore.js';

/** Tracked-card host source id. Duplicated as a literal so this module never
 *  imports the Cesium-backed overlay host just to copy an ident. */
const TRACKED_OVERLAY_SOURCE_ID = 'tracked';
/** Selected-vessel host source id. Same reason as above. */
const VESSEL_OVERLAY_SOURCE_ID = 'ais-live-vessels';

/**
 * @module selectedContactIdent
 * @description Copy control for the selected-contact card's visible asset
 * ident — aircraft callsign/hex, vessel name/MMSI, or satellite name/NORAD.
 * Public asset ids already on the card. No named-person search. No server route.
 */

export const SELECTED_CONTACT_IDENT_ROOT_ID = 'selected-contact-ident';
export const SELECTED_CONTACT_IDENT_VALUE_ID = 'selected-contact-ident-value';
export const SELECTED_CONTACT_IDENT_COPY_ID = 'selected-contact-ident-copy';

const COPYABLE_LAYER_IDS = Object.freeze({
  flights: 'aircraft',
  military: 'aircraft',
  'ais-live-vessels': 'vessel',
  satellites: 'satellite',
});

const TRACKED_KIND_PREFIXES = Object.freeze([
  ['flights:', 'aircraft'],
  ['military:', 'aircraft'],
  ['satellites:', 'satellite'],
]);

const TITLE_ROW_RATIO = 0.38;
const TITLE_ROW_MIN_PX = 22;
const TITLE_ROW_MAX_PX = 28;
const COPY_BUTTON_SIZE_PX = 22;

let _viewer = null;
let _showToast = null;
let _root = null;
let _valueButton = null;
let _copyButton = null;
let _getPaintRect = null;
let _getActiveTrackedId = null;
let _getSelectedContext = getSelectedEntityContext;
let _clipboard = null;
let _active = null;
let _trackedEntityChangedRemove = null;
let _postRenderRemove = null;
let _windowListeners = [];

/**
 * Map a context/layer id to a copyable contact kind.
 * @param {string} layerId Layer id from the shared context slot.
 * @returns {'aircraft'|'vessel'|'satellite'|null}
 */
export function contactKindFromLayerId(layerId) {
  return COPYABLE_LAYER_IDS[String(layerId || '')] || null;
}

/**
 * Map a tracked-card identity (`flights:abc123`) to a copyable kind.
 * Installations and other tracked cards return null.
 * @param {string} trackedId gevTrackedId published on the tracked entity.
 * @returns {'aircraft'|'vessel'|'satellite'|null}
 */
export function contactKindFromTrackedId(trackedId) {
  const id = String(trackedId || '');
  for (const [prefix, kind] of TRACKED_KIND_PREFIXES) {
    if (id.startsWith(prefix)) return kind;
  }
  return null;
}

/**
 * Whether a kind may receive the copy control.
 * @param {string|null} kind Candidate kind.
 * @returns {boolean}
 */
export function isCopyableContactKind(kind) {
  return kind === 'aircraft' || kind === 'vessel' || kind === 'satellite';
}

/**
 * Strip the tracked-card stale cue so operators copy the ident, not the status.
 * @param {string} text Card title or label.
 * @returns {string}
 */
export function stripStaleSuffix(text) {
  return String(text || '').replace(/(?:\s*·\s*)?STALE\s*$/i, '').trim();
}

/**
 * Visible primary ident on the selected-contact card.
 * Aircraft: callsign, else registration/hex already shown. Vessel: name or
 * MMSI. Satellite: name or SAT-{norad}. Never a named person.
 * @param {object} [input]
 * @param {'aircraft'|'vessel'|'satellite'|null} [input.kind]
 * @param {string} [input.title] Card title already shown.
 * @param {string} [input.label] Context/display label.
 * @param {string} [input.callsign]
 * @param {string} [input.registration]
 * @param {string} [input.icao24]
 * @param {string} [input.name]
 * @param {string} [input.mmsi]
 * @param {string|number} [input.norad]
 * @returns {string} Ident to copy, or ''.
 */
export function visibleContactIdent(input = {}) {
  const kind = input.kind;
  const label = cleanIdent(input.label);
  const titleIdent = primaryIdentFromTitle(stripStaleSuffix(input.title));
  if (!isCopyableContactKind(kind)) return '';
  if (kind === 'aircraft') {
    return label || titleIdent
      || cleanIdent(input.callsign)
      || cleanIdent(input.registration)
      || cleanIdent(input.icao24);
  }
  if (kind === 'vessel') {
    return label || titleIdent || vesselDisplayIdent(input.name, input.mmsi);
  }
  return label || titleIdent || cleanIdent(input.name) || satelliteFallbackIdent(input.norad);
}

/**
 * Toast copy for a successful ident copy.
 * @param {string} ident Visible ident that was copied.
 * @returns {string}
 */
export function copiedIdentToast(ident) {
  return `Copied ${ident}`;
}

/**
 * Resolve the current copyable selection from context, tracked entity, or
 * injected readers. Installations, fires, and cameras never qualify.
 * @param {object} [input]
 * @returns {{kind:'aircraft'|'vessel'|'satellite',ident:string,sourceId:string,entryId:string}|null}
 */
export function resolveCopyableSelection(input = {}) {
  const getContext = input.getSelectedContext || _getSelectedContext;
  const getTrackedId = input.getActiveTrackedId || _getActiveTrackedId;
  const viewer = input.viewer === undefined ? _viewer : input.viewer;
  const context = typeof getContext === 'function' ? getContext() : null;
  const contextKind = contactKindFromLayerId(context?.layerId);
  if (contextKind) {
    const ident = visibleContactIdent({
      kind: contextKind,
      label: context.label,
      title: context.entity?.gevLabelModel?.title,
      callsign: context.properties?.callsign,
      registration: context.properties?.registration,
      icao24: context.properties?.icao24 || context.id,
      name: context.properties?.name || context.label,
      mmsi: context.properties?.mmsi,
      norad: context.properties?.noradId || context.id,
    });
    if (ident) return selectionTarget(contextKind, ident, context, getTrackedId);
  }

  const entity = viewer?.trackedEntity || null;
  const trackedKind = contactKindFromTrackedId(entity?.gevTrackedId);
  if (trackedKind) {
    const ident = visibleContactIdent({
      kind: trackedKind,
      title: entity.gevLabelModel?.title,
    });
    if (ident) {
      return {
        kind: trackedKind,
        ident,
        sourceId: TRACKED_OVERLAY_SOURCE_ID,
        entryId: (typeof getTrackedId === 'function' && getTrackedId()) || entity.gevTrackedId,
      };
    }
  }
  return null;
}

/**
 * Copy the ident and toast `Copied UAL123`.
 * @param {string} ident Visible ident.
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function copySelectedContactIdent(ident, options = {}) {
  const value = cleanIdent(ident);
  if (!value) return false;
  const toast = options.showToast || _showToast;
  const ok = await writeClipboardText(value, options.clipboard || _clipboard);
  if (typeof toast === 'function') toast(ok ? copiedIdentToast(value) : 'Copy failed');
  return ok;
}

/**
 * Wire the selected-contact copy control. Hidden until a copyable contact is
 * selected. Clicking the ident or the copy button copies the visible id.
 * @param {object} [options]
 * @returns {void}
 */
export function initSelectedContactIdent(options = {}) {
  if (_root && !options.force) return;
  if (_root) destroySelectedContactIdent();

  _viewer = options.viewer || null;
  _showToast = typeof options.showToast === 'function' ? options.showToast : null;
  _getPaintRect = typeof options.getPaintRect === 'function' ? options.getPaintRect : null;
  _getActiveTrackedId = typeof options.getActiveTrackedId === 'function'
    ? options.getActiveTrackedId
    : null;
  _getSelectedContext = typeof options.getSelectedContext === 'function'
    ? options.getSelectedContext
    : getSelectedEntityContext;
  _clipboard = options.clipboard || globalThis.navigator?.clipboard || null;
  _root = options.root || globalThis.document?.getElementById(SELECTED_CONTACT_IDENT_ROOT_ID);
  _valueButton = options.identButton || globalThis.document?.getElementById(SELECTED_CONTACT_IDENT_VALUE_ID);
  _copyButton = options.copyButton || globalThis.document?.getElementById(SELECTED_CONTACT_IDENT_COPY_ID);
  if (!_root || !_valueButton || !_copyButton) return;

  _valueButton.addEventListener('click', onCopyClick);
  _copyButton.addEventListener('click', onCopyClick);

  const host = options.windowTarget || globalThis.window;
  bindWindow(host, 'gev:entity-selected', syncSelectedContactIdent);
  bindWindow(host, 'gev:entity-selection-cleared', syncSelectedContactIdent);
  bindWindow(host, 'gev:awareness-subject-selected', syncSelectedContactIdent);
  bindWindow(host, 'gev:awareness-subject-cleared', syncSelectedContactIdent);

  _trackedEntityChangedRemove = _viewer?.trackedEntityChanged?.addEventListener?.(
    () => syncSelectedContactIdent(),
  ) || null;

  syncSelectedContactIdent();
}

/** Tear down listeners and hide the control. */
export function destroySelectedContactIdent() {
  _valueButton?.removeEventListener?.('click', onCopyClick);
  _copyButton?.removeEventListener?.('click', onCopyClick);
  _trackedEntityChangedRemove?.();
  _trackedEntityChangedRemove = null;
  stopPositionUpdates();
  for (const { target, name, handler } of _windowListeners) {
    target.removeEventListener?.(name, handler);
  }
  _windowListeners = [];
  hideControl();
  _viewer = null;
  _showToast = null;
  _root = null;
  _valueButton = null;
  _copyButton = null;
  _clipboard = null;
  _active = null;
  _getPaintRect = null;
  _getActiveTrackedId = null;
  _getSelectedContext = getSelectedEntityContext;
}

/** Re-read the current selection and show/hide the control. */
export function syncSelectedContactIdent() {
  if (!_root || !_valueButton || !_copyButton) return;
  const selection = resolveCopyableSelection();
  if (!selection) {
    hideControl();
    return;
  }
  if (_viewer && !cardPaintRect(selection)) {
    hideControl();
    _active = selection;
    startPositionUpdates();
    return;
  }
  _active = selection;
  _root.hidden = false;
  _root.removeAttribute?.('hidden');
  _root.dataset.kind = selection.kind;
  _root.dataset.ident = selection.ident;
  _valueButton.textContent = selection.ident;
  _valueButton.setAttribute('aria-label', `Copy ${selection.ident}`);
  _copyButton.setAttribute('aria-label', `Copy ${selection.ident}`);
  _copyButton.title = `Copy ${selection.ident}`;
  positionControl(selection);
  startPositionUpdates();
}

/** Current copyable ident shown on the control, or null when hidden. */
export function getSelectedContactIdentForTest() {
  return _active ? { ..._active } : null;
}

function selectionTarget(kind, ident, context, getTrackedId) {
  if (kind === 'vessel') {
    const mmsi = String(context.properties?.mmsi || '').trim();
    return {
      kind,
      ident,
      sourceId: VESSEL_OVERLAY_SOURCE_ID,
      entryId: mmsi ? `vessel:${mmsi}` : '',
    };
  }
  const trackedId = (typeof getTrackedId === 'function' && getTrackedId())
    || (kind === 'satellite'
      ? `satellites:${context.id}`
      : `${context.layerId}:${context.id}`);
  return {
    kind,
    ident,
    sourceId: TRACKED_OVERLAY_SOURCE_ID,
    entryId: trackedId,
  };
}

function onCopyClick(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const ident = _active?.ident || cleanIdent(_valueButton?.textContent);
  return copySelectedContactIdent(ident);
}

function hideControl() {
  _active = null;
  stopPositionUpdates();
  if (!_root) return;
  _root.hidden = true;
  _root.setAttribute?.('hidden', '');
  delete _root.dataset?.kind;
  delete _root.dataset?.ident;
  if (_valueButton) _valueButton.textContent = '';
}

function cardPaintRect(selection) {
  if (typeof _getPaintRect !== 'function' || !selection?.sourceId || !selection?.entryId) {
    return null;
  }
  const rect = _getPaintRect(selection.sourceId, selection.entryId);
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) {
    return null;
  }
  return rect;
}

function positionControl(selection) {
  if (!_root) return;
  const rect = cardPaintRect(selection);
  if (!rect) return;
  const titleH = Math.max(
    TITLE_ROW_MIN_PX,
    Math.min(TITLE_ROW_MAX_PX, Math.round(rect.h * TITLE_ROW_RATIO)),
  );
  _root.style.left = `${Math.round(rect.x)}px`;
  _root.style.top = `${Math.round(rect.y)}px`;
  _root.style.width = `${Math.round(rect.w + COPY_BUTTON_SIZE_PX + 4)}px`;
  _root.style.height = `${titleH}px`;
  if (_valueButton) {
    _valueButton.style.width = `${Math.max(8, Math.round(rect.w - 8))}px`;
    _valueButton.style.height = `${titleH}px`;
  }
}

function startPositionUpdates() {
  if (_postRenderRemove || !_viewer?.scene?.postRender?.addEventListener) return;
  _postRenderRemove = _viewer.scene.postRender.addEventListener(() => {
    if (!_active) return;
    if (_root?.hidden && cardPaintRect(_active)) syncSelectedContactIdent();
    else positionControl(_active);
  });
}

function stopPositionUpdates() {
  _postRenderRemove?.();
  _postRenderRemove = null;
}

function bindWindow(target, name, handler) {
  if (!target?.addEventListener) return;
  target.addEventListener(name, handler);
  _windowListeners.push({ target, name, handler });
}

function primaryIdentFromTitle(title) {
  const text = String(title || '').trim();
  if (!text) return '';
  return text.split(' · ')[0].trim();
}

function vesselDisplayIdent(name, mmsi) {
  const text = cleanIdent(name);
  const id = cleanIdent(mmsi);
  if (text && text !== 'VESSEL' && text !== id && !/^MMSI\s*\d+$/i.test(text)) return text;
  return id ? `MMSI ${id}` : '';
}

function satelliteFallbackIdent(norad) {
  const id = cleanIdent(norad);
  return id ? `SAT-${id}` : '';
}

function cleanIdent(value) {
  return String(value ?? '').trim();
}

async function writeClipboardText(text, clipboard) {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  const documentRef = globalThis.document;
  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;
  const field = documentRef.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  documentRef.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = documentRef.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}
