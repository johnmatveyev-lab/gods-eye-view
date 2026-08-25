/**
 * LOCATION dock tray hit-testing.
 *
 * The painted popover can stay `visibility: hidden` / `pointer-events: none`
 * (and 0×0) after open, so clicks fall through to the Cesium canvas. Open
 * forces those properties synchronously; close waits for transitionend
 * before hiding again.
 */

const HIDE_LISTENERS = new WeakMap();
const CLOSE_TRANSITION_FALLBACK_MS = 240;

function styleTarget(element) {
  return element?.style || null;
}

function setInteractive(element, interactive) {
  const style = styleTarget(element);
  if (!style?.setProperty) return;
  if (interactive) {
    style.setProperty('visibility', 'visible', 'important');
    style.setProperty('pointer-events', 'auto', 'important');
    return;
  }
  style.setProperty('visibility', 'hidden', 'important');
  style.setProperty('pointer-events', 'none', 'important');
}

function setCityRowDisplayed(panel, displayed) {
  const row = panel?.querySelector?.('.location-city-row');
  const style = styleTarget(row);
  if (!style?.setProperty) return;
  if (displayed) {
    style.setProperty('display', 'flex', 'important');
    return;
  }
  style.removeProperty?.('display');
}

function clearHideListener(popover) {
  const pending = HIDE_LISTENERS.get(popover);
  if (!pending) return;
  popover.removeEventListener?.('transitionend', pending.handler);
  if (pending.timer) clearTimeout(pending.timer);
  HIDE_LISTENERS.delete(popover);
}

function hideAfterTransition(popover, panel) {
  const hide = () => {
    clearHideListener(popover);
    setInteractive(popover, false);
    for (const control of locationTrayControls(panel)) setInteractive(control, false);
    setCityRowDisplayed(panel, false);
  };
  const handler = (event) => {
    if (event?.target && event.target !== popover) return;
    const property = event?.propertyName;
    if (property && property !== 'opacity' && property !== 'transform') return;
    hide();
  };
  popover.addEventListener?.('transitionend', handler);
  const timer = setTimeout(hide, CLOSE_TRANSITION_FALLBACK_MS);
  HIDE_LISTENERS.set(popover, { handler, timer });
}

function readBox(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return { width: 0, height: 0 };
  return rect;
}

function computeStyleFor(element, computeStyle) {
  if (typeof computeStyle === 'function') return computeStyle(element);
  if (typeof globalThis.getComputedStyle === 'function') {
    try { return globalThis.getComputedStyle(element); } catch { /* fall through */ }
  }
  return element?.style || {};
}

function readPointerEvents(style) {
  return style?.pointerEvents
    || style?.getPropertyValue?.('pointer-events')
    || '';
}

export function locationTrayControls(panel) {
  if (!panel?.querySelectorAll) return [];
  return [
    ...panel.querySelectorAll('button.location-pill'),
    panel.querySelector('#location-search'),
  ].filter(Boolean);
}

export function isLocationTrayInteractive(panel, { getComputedStyle: computeStyle } = {}) {
  const controls = locationTrayControls(panel);
  if (!controls.length) return false;
  return controls.every((element) => {
    const style = computeStyleFor(element, computeStyle);
    const visibility = style.visibility || style.getPropertyValue?.('visibility') || '';
    const pointerEvents = readPointerEvents(style);
    if (visibility === 'hidden' || pointerEvents === 'none') return false;
    const rect = readBox(element);
    return rect.width > 0 && rect.height > 0;
  });
}

export function focusLocationSearch(panel) {
  const search = panel?.querySelector?.('#location-search');
  if (!search) return false;
  search.classList?.add?.('expanded');
  search.focus?.({ preventScroll: true });
  return true;
}

export function syncLocationDockPopover(panel, {
  open,
  focusSearch = open,
  getComputedStyle: computeStyle,
} = {}) {
  const popover = panel?.querySelector?.('.dock-popover-content');
  if (!popover) return { open: false, interactive: false };

  clearHideListener(popover);

  if (open) {
    setCityRowDisplayed(panel, true);
    setInteractive(popover, true);
    for (const control of locationTrayControls(panel)) setInteractive(control, true);
    const interactive = isLocationTrayInteractive(panel, { getComputedStyle: computeStyle });
    if (focusSearch) focusLocationSearch(panel);
    return { open: interactive, interactive };
  }

  setInteractive(popover, true);
  popover.style?.setProperty?.('pointer-events', 'none', 'important');
  for (const control of locationTrayControls(panel)) {
    control.style?.setProperty?.('pointer-events', 'none', 'important');
  }
  hideAfterTransition(popover, panel);
  return { open: false, interactive: false };
}
