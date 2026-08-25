/**
 * Share-view QR — encode the current camera+layers share URL in-page.
 * Uses the same currentShareUrl() helper as Copy view link. No shortener,
 * no upload, no /api. Credits stay on the globe.
 */

import { encode } from 'uqr';

export const SHARE_VIEW_QR_BUTTON_ID = 'share-view-qr';
export const SHARE_VIEW_QR_POPOVER_ID = 'share-view-qr-popover';
export const SHARE_VIEW_QR_SVG_ID = 'share-view-qr-svg';
export const SHARE_VIEW_QR_WRAP_ID = 'share-view-qr-wrap';

const QR_ECC = 'M';
const QR_BORDER = 2;

let _button = null;
let _popover = null;
let _svg = null;
let _getShareUrl = null;
let _clickHandler = null;
let _open = false;

/**
 * Encode a share URL into a QR matrix. Payload is the URL itself.
 * @param {string} url
 * @returns {{payload: string, size: number, modules: boolean[][], version: number, fingerprint: string}}
 */
export function encodeShareViewQr(url) {
  const payload = String(url || '');
  const result = encode(payload, { ecc: QR_ECC, border: QR_BORDER, boostEcc: false });
  return {
    payload,
    size: result.size,
    modules: result.data,
    version: result.version,
    fingerprint: qrModuleFingerprint(result.data),
  };
}

/**
 * Stable row-major fingerprint of dark (1) and light (0) modules.
 * @param {boolean[][]} modules
 * @returns {string}
 */
export function qrModuleFingerprint(modules) {
  return (modules || [])
    .map((row) => (row || []).map((cell) => (cell ? '1' : '0')).join(''))
    .join('/');
}

/**
 * Paint an in-page SVG QR. Stores the encoded URL on the element.
 * @param {SVGElement|{dataset?: object, setAttribute?: Function, innerHTML?: string}|null} svg
 * @param {ReturnType<typeof encodeShareViewQr>} encoded
 * @returns {ReturnType<typeof encodeShareViewQr>}
 */
export function renderShareViewQrSvg(svg, encoded) {
  if (!svg || !encoded) return encoded;
  const { size, modules, payload, fingerprint } = encoded;
  const paths = [];
  for (let y = 0; y < size; y += 1) {
    const row = modules[y] || [];
    for (let x = 0; x < size; x += 1) {
      if (row[x]) paths.push(`M${x},${y}h1v1h-1z`);
    }
  }
  svg.setAttribute?.('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute?.('role', 'img');
  svg.setAttribute?.('aria-label', 'Share view QR code');
  if (svg.dataset) {
    svg.dataset.shareUrl = payload;
    svg.dataset.qrFingerprint = fingerprint;
  }
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#111" d="${paths.join('')}"/>`;
  return encoded;
}

/** @returns {boolean} */
export function isShareViewQrOpen() {
  return _open;
}

/** URL last painted into the popover SVG, or empty. */
export function currentShareViewQrUrl() {
  return _svg?.dataset?.shareUrl || '';
}

/** Fingerprint last painted into the popover SVG, or empty. */
export function currentShareViewQrFingerprint() {
  return _svg?.dataset?.qrFingerprint || '';
}

/**
 * Encode the live share URL and show the popover.
 * @returns {boolean}
 */
export function openShareViewQr() {
  const url = _getShareUrl?.();
  if (!url || !_popover || !_svg || !_button) return false;
  renderShareViewQrSvg(_svg, encodeShareViewQr(url));
  _popover.hidden = false;
  _button.setAttribute('aria-expanded', 'true');
  _open = true;
  return true;
}

/** Hide the popover. Does not copy. */
export function closeShareViewQr() {
  if (_popover) _popover.hidden = true;
  if (_button) _button.setAttribute('aria-expanded', 'false');
  _open = false;
  return true;
}

/**
 * Second click closes; first click opens with a fresh encode.
 * @returns {boolean} true when opened
 */
export function toggleShareViewQr() {
  if (_open) {
    closeShareViewQr();
    return false;
  }
  return openShareViewQr();
}

/**
 * Escape closes an open QR popover. Clean view / fullscreen stay separate.
 * @param {{key?: string, preventDefault?: Function}|null|undefined} event
 * @returns {boolean}
 */
export function handleShareViewQrEscape(event) {
  if (event?.key !== 'Escape') return false;
  if (!_open) return false;
  event.preventDefault?.();
  closeShareViewQr();
  return true;
}

function onButtonClick(event) {
  event?.preventDefault?.();
  toggleShareViewQr();
}

/**
 * @param {{button?: Element|null, popover?: Element|null, svg?: Element|null, getShareUrl?: Function}} [options]
 */
export function initShareViewQr({ button, popover, svg, getShareUrl } = {}) {
  destroyShareViewQr();
  _button = button || null;
  _popover = popover || null;
  _svg = svg || null;
  _getShareUrl = typeof getShareUrl === 'function' ? getShareUrl : null;
  if (_button) {
    _button.setAttribute('aria-expanded', 'false');
    _button.setAttribute('aria-controls', SHARE_VIEW_QR_POPOVER_ID);
    _clickHandler = onButtonClick;
    _button.addEventListener('click', _clickHandler);
  }
  closeShareViewQr();
  return { button: _button, popover: _popover, svg: _svg };
}

export function destroyShareViewQr() {
  if (_button && _clickHandler) {
    _button.removeEventListener('click', _clickHandler);
  }
  _clickHandler = null;
  closeShareViewQr();
  _button = null;
  _popover = null;
  _svg = null;
  _getShareUrl = null;
}
