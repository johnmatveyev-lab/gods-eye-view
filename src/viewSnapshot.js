/**
 * Operator-local globe snapshot. Captures the Cesium canvas plus the on-screen
 * #cesium-credits strip (Google / Cesium / data attribution) into a PNG.
 * Clipboard image write first; same-tab download if that is denied.
 * No upload, no /api, no URL copy.
 */

export const VIEW_SNAPSHOT_BUTTON_ID = 'copy-view-snapshot';
export const VIEW_SNAPSHOT_FILENAME = 'meridian-view.png';
export const VIEW_SNAPSHOT_MIME = 'image/png';
export const CESIUM_CREDITS_ID = 'cesium-credits';

/**
 * Visible credit line from the live attribution strip.
 * @param {Element|null|undefined} creditsEl
 * @returns {string}
 */
export function creditStripText(creditsEl) {
  return String(creditsEl?.innerText || creditsEl?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function createSnapshotCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Draw the globe canvas and the on-screen credit strip onto one PNG-sized canvas.
 * @param {{globeCanvas: HTMLCanvasElement, creditsEl?: Element|null, createCanvas?: Function}} input
 * @returns {{canvas: HTMLCanvasElement|OffscreenCanvas, creditText: string}}
 */
export function compositeViewSnapshot({ globeCanvas, creditsEl = null, createCanvas = createSnapshotCanvas } = {}) {
  const width = Math.max(1, Math.round(globeCanvas?.width || 0));
  const height = Math.max(1, Math.round(globeCanvas?.height || 0));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, creditText: '' };

  ctx.drawImage(globeCanvas, 0, 0, width, height);

  const creditText = creditStripText(creditsEl);
  if (!creditText) return { canvas, creditText };

  const globeBox = typeof globeCanvas.getBoundingClientRect === 'function'
    ? globeCanvas.getBoundingClientRect()
    : { left: 0, top: 0, width, height };
  const creditBox = typeof creditsEl?.getBoundingClientRect === 'function'
    ? creditsEl.getBoundingClientRect()
    : { left: 8, top: height - 36, width: Math.min(width, 320), height: 28 };

  const cssWidth = globeBox.width || width;
  const cssHeight = globeBox.height || height;
  const scaleX = width / cssWidth;
  const scaleY = height / cssHeight;

  const stripHeight = Math.max(22 * scaleY, (creditBox.height || 28) * scaleY);
  let x = ((creditBox.left ?? 0) - (globeBox.left ?? 0)) * scaleX;
  let y = ((creditBox.top ?? 0) - (globeBox.top ?? 0)) * scaleY;
  let stripWidth = Math.max(120 * scaleX, (creditBox.width || 280) * scaleX);
  stripWidth = Math.min(stripWidth, width - 8);
  if (x < 4) x = 4;
  if (x + stripWidth > width - 4) x = Math.max(4, width - stripWidth - 4);
  if (y < 4 || y + stripHeight > height - 2) y = height - stripHeight - 6;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(x, y, stripWidth, stripHeight);
  ctx.fillStyle = 'rgba(232, 234, 237, 0.95)';
  ctx.font = `${Math.max(11, Math.round(11 * scaleY))}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(creditText, x + 8 * scaleX, y + stripHeight / 2);

  return { canvas, creditText };
}

/**
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {Promise<Blob>}
 */
export async function canvasToPngBlob(canvas) {
  if (typeof canvas?.toBlob === 'function') {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('toBlob failed'));
      }, VIEW_SNAPSHOT_MIME);
    });
    return blob;
  }
  if (typeof canvas?.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: VIEW_SNAPSHOT_MIME });
  }
  const dataUrl = canvas.toDataURL(VIEW_SNAPSHOT_MIME);
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: VIEW_SNAPSHOT_MIME });
}

/**
 * Same-tab download. Never navigates away and never uploads.
 * @param {Blob} blob
 * @param {string} [filename]
 * @param {{documentRef?: Document, createObjectURL?: Function, revokeObjectURL?: Function}} [options]
 */
export function downloadPngBlob(blob, filename = VIEW_SNAPSHOT_FILENAME, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const createObjectURL = options.createObjectURL
    || ((value) => URL.createObjectURL(value));
  const revokeObjectURL = options.revokeObjectURL
    || ((value) => URL.revokeObjectURL(value));
  const url = createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  revokeObjectURL(url);
}

/**
 * @param {{method?: string}|null|undefined} result
 * @returns {string}
 */
export function snapshotToast(result) {
  switch (result?.method) {
    case 'clipboard':
      return 'Snapshot copied';
    case 'download':
      return 'Snapshot downloaded';
    case 'failed':
      return 'Snapshot failed';
    default:
      return 'Snapshot failed';
  }
}

/**
 * Capture the current globe + credits and copy a PNG, or download if denied.
 * @param {object} options
 * @returns {Promise<{ok: boolean, method: 'clipboard'|'download'|'failed', blob?: Blob, creditText: string}>}
 */
export async function copyViewSnapshot({
  globeCanvas,
  creditsEl = null,
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItem: ClipboardItemCtor = globalThis.ClipboardItem,
  download = downloadPngBlob,
  createCanvas = createSnapshotCanvas,
} = {}) {
  if (!globeCanvas) {
    return { ok: false, method: 'failed', creditText: creditStripText(creditsEl) };
  }

  const { canvas, creditText } = compositeViewSnapshot({
    globeCanvas,
    creditsEl,
    createCanvas,
  });

  let blob;
  try {
    blob = await canvasToPngBlob(canvas);
  } catch {
    return { ok: false, method: 'failed', creditText };
  }

  try {
    const Item = ClipboardItemCtor;
    if (!clipboard?.write || typeof Item !== 'function') {
      throw new Error('clipboard image write unavailable');
    }
    await clipboard.write([new Item({ [VIEW_SNAPSHOT_MIME]: blob })]);
    return { ok: true, method: 'clipboard', blob, creditText };
  } catch {
    try {
      download(blob, VIEW_SNAPSHOT_FILENAME);
      return { ok: true, method: 'download', blob, creditText };
    } catch {
      return { ok: false, method: 'failed', blob, creditText };
    }
  }
}
