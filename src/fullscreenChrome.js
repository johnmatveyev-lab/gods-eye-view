/**
 * Globe fullscreen chrome. Targets documentElement so #cesium-credits
 * (appended to body beside the globe canvas) stays on screen.
 */

export function fullscreenRoot(doc = globalThis.document) {
  return doc?.documentElement || null;
}

export function fullscreenElement(doc = globalThis.document) {
  return doc?.fullscreenElement || doc?.webkitFullscreenElement || null;
}

export function isDocumentFullscreen(doc = globalThis.document) {
  return fullscreenElement(doc) != null;
}

export function isFullscreenApiAvailable(doc = globalThis.document) {
  const root = fullscreenRoot(doc);
  const canEnter = Boolean(
    root
    && (
      typeof root.requestFullscreen === 'function'
      || typeof root.webkitRequestFullscreen === 'function'
    ),
  );
  const canExit = Boolean(
    doc
    && (
      typeof doc.exitFullscreen === 'function'
      || typeof doc.webkitExitFullscreen === 'function'
    ),
  );
  return canEnter && canExit;
}

export async function enterFullscreen(doc = globalThis.document) {
  if (!isFullscreenApiAvailable(doc)) return false;
  if (isDocumentFullscreen(doc)) return true;
  const root = fullscreenRoot(doc);
  try {
    if (typeof root.requestFullscreen === 'function') await root.requestFullscreen();
    else if (typeof root.webkitRequestFullscreen === 'function') await root.webkitRequestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(doc = globalThis.document) {
  if (!isDocumentFullscreen(doc)) return true;
  try {
    if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
    else if (typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function toggleFullscreen(doc = globalThis.document) {
  if (!isFullscreenApiAvailable(doc)) return false;
  return isDocumentFullscreen(doc) ? exitFullscreen(doc) : enterFullscreen(doc);
}

export function handleFullscreenEscape(event, doc = globalThis.document) {
  if (event?.key !== 'Escape') return false;
  if (!isDocumentFullscreen(doc)) return false;
  event.preventDefault?.();
  void exitFullscreen(doc);
  return true;
}

export function syncFullscreenButton(button, active) {
  if (!button) return;
  const on = Boolean(active);
  button.setAttribute?.('aria-pressed', String(on));
  button.setAttribute?.('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
  if ('title' in button) button.title = on ? 'Exit fullscreen (Esc)' : 'Enter fullscreen';
  else button.setAttribute?.('title', on ? 'Exit fullscreen (Esc)' : 'Enter fullscreen');
  const icon = button.querySelector?.('.material-symbols-outlined');
  if (icon) icon.textContent = on ? 'fullscreen_exit' : 'fullscreen';
}

export function hideFullscreenButtonIfUnsupported(button, doc = globalThis.document) {
  if (!button) return false;
  const ok = isFullscreenApiAvailable(doc);
  button.hidden = !ok;
  return ok;
}
