/**
 * Client-only panel position persistence helpers.
 *
 * Leftover `godsEyeView.v6` / `v7` panelPos keys are read and clamped in
 * place. This cycle does not rename those keys to the current version.
 */

export const PANEL_POSITION_INSET_PX = 6;
export const LEGACY_PANEL_POSITION_STORAGE_VERSIONS = Object.freeze(['v6', 'v7']);
export const PANEL_COLLAPSE_STORAGE_VERSION = 'v6';
export const DEFAULT_PANEL_SIZE = Object.freeze({ width: 360, height: 240 });
export const DEFAULT_COLLAPSED_PANEL_SIZE = Object.freeze({ width: 176, height: 50 });

/**
 * Versioned localStorage key for a panel's saved top-left position.
 * @param {string} panelId
 * @param {string} version
 * @returns {string}
 */
export function panelPositionStorageKey(panelId, version) {
  return `godsEyeView.${version}.panelPos.${panelId}`;
}

/**
 * Versioned localStorage key for a panel's collapsed flag.
 * @param {string} panelId
 * @param {string} [version]
 * @returns {string}
 */
export function panelCollapsedStorageKey(panelId, version = PANEL_COLLAPSE_STORAGE_VERSION) {
  return `godsEyeView.${version}.panelCollapsed.${panelId}`;
}

/**
 * Read order for stored positions: current version first, then leftovers.
 * @param {string} currentVersion
 * @returns {string[]}
 */
export function panelPositionReadVersions(currentVersion) {
  const leftover = LEGACY_PANEL_POSITION_STORAGE_VERSIONS.filter((version) => version !== currentVersion);
  return [currentVersion, ...leftover];
}

/**
 * Parse a stored `{ left, top }` payload. Returns null when unusable.
 * @param {unknown} raw
 * @returns {{ left: number, top: number }|null}
 */
export function parseStoredPanelPosition(raw) {
  if (raw == null || raw === '') return null;
  try {
    const pos = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return null;
    if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
    return { left: pos.left, top: pos.top };
  } catch {
    return null;
  }
}

/**
 * Clamp a desired left/top so the panel stays fully on-screen.
 * Negative and huge coordinates land on the nearest inset.
 * @param {object} input
 * @param {number} input.left
 * @param {number} input.top
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {number} input.viewportWidth
 * @param {number} input.viewportHeight
 * @param {number} [input.inset]
 * @returns {{ left: number, top: number }|null}
 */
export function clampPanelPosition({
  left,
  top,
  width = 0,
  height = 0,
  viewportWidth,
  viewportHeight,
  inset = PANEL_POSITION_INSET_PX,
} = {}) {
  const safeInset = Math.max(0, Number(inset) || 0);
  const vw = Math.max(0, Number(viewportWidth) || 0);
  const vh = Math.max(0, Number(viewportHeight) || 0);
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const x = Number(left);
  const y = Number(top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const maxLeft = Math.max(safeInset, vw - w - safeInset);
  const maxTop = Math.max(safeInset, vh - h - safeInset);
  return {
    left: Math.max(safeInset, Math.min(maxLeft, Math.round(x))),
    top: Math.max(safeInset, Math.min(maxTop, Math.round(y))),
  };
}

/**
 * Locate a stored panel position without writing a newer version key.
 * @param {{ getItem: (key: string) => string|null }} storage
 * @param {string} panelId
 * @param {string} currentVersion
 * @returns {{ version: string, key: string, pos: { left: number, top: number }|null }|null}
 */
export function resolveStoredPanelPosition(storage, panelId, currentVersion) {
  if (!storage) return null;
  for (const version of panelPositionReadVersions(currentVersion)) {
    const key = panelPositionStorageKey(panelId, version);
    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      return null;
    }
    if (raw == null) continue;
    return { version, key, pos: parseStoredPanelPosition(raw) };
  }
  return null;
}

/**
 * Position a restore would apply after leftover-aware read + clamp.
 * @param {{ getItem: (key: string) => string|null }} storage
 * @param {string} panelId
 * @param {string} currentVersion
 * @param {object} box Viewport and panel size.
 * @returns {{ left: number, top: number }|null}
 */
export function restoredPanelPosition(storage, panelId, currentVersion, box) {
  const resolved = resolveStoredPanelPosition(storage, panelId, currentVersion);
  if (!resolved?.pos) return null;
  return clampPanelPosition({ ...resolved.pos, ...box });
}

/**
 * Remove one panel's leftover and current pos keys plus its collapsed flag.
 * Other `godsEyeView.*` keys are left untouched.
 * @param {{ removeItem: (key: string) => void }} storage
 * @param {string} panelId
 * @param {string} currentVersion
 * @returns {void}
 */
export function resetStoredPanelLayout(storage, panelId, currentVersion) {
  const versions = new Set([
    currentVersion,
    ...LEGACY_PANEL_POSITION_STORAGE_VERSIONS,
  ]);
  for (const version of versions) {
    try {
      storage.removeItem(panelPositionStorageKey(panelId, version));
    } catch {
      // storage unavailable
    }
  }
  try {
    storage.removeItem(panelCollapsedStorageKey(panelId));
  } catch {
    // storage unavailable
  }
}

/**
 * On boot, clamp or reset any restored panel whose stored position is
 * off-viewport. Writes stay on the same leftover/current key.
 * @param {object} input
 * @param {{ getItem: Function, setItem: Function, removeItem: Function }} input.storage
 * @param {string[]} input.panelIds
 * @param {number} input.viewportWidth
 * @param {number} input.viewportHeight
 * @param {string} input.currentVersion
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {number} [input.collapsedWidth]
 * @param {number} [input.collapsedHeight]
 * @param {number} [input.inset]
 * @returns {Array<{ panelId: string, action: 'clamp'|'keep'|'reset', position?: { left: number, top: number }, key?: string, reason?: string }>}
 */
export function sanitizeStoredPanelPositions({
  storage,
  panelIds,
  viewportWidth,
  viewportHeight,
  currentVersion,
  width = DEFAULT_PANEL_SIZE.width,
  height = DEFAULT_PANEL_SIZE.height,
  collapsedWidth = DEFAULT_COLLAPSED_PANEL_SIZE.width,
  collapsedHeight = DEFAULT_COLLAPSED_PANEL_SIZE.height,
  inset = PANEL_POSITION_INSET_PX,
} = {}) {
  if (!storage || !Array.isArray(panelIds)) return [];
  const results = [];
  for (const panelId of panelIds) {
    const resolved = resolveStoredPanelPosition(storage, panelId, currentVersion);
    if (!resolved) continue;
    if (!resolved.pos) {
      resetStoredPanelLayout(storage, panelId, currentVersion);
      results.push({ panelId, action: 'reset', reason: 'malformed' });
      continue;
    }

    let collapsed = false;
    try {
      collapsed = storage.getItem(panelCollapsedStorageKey(panelId)) === '1';
    } catch {
      collapsed = false;
    }
    const clamped = clampPanelPosition({
      left: resolved.pos.left,
      top: resolved.pos.top,
      width: collapsed ? collapsedWidth : width,
      height: collapsed ? collapsedHeight : height,
      viewportWidth,
      viewportHeight,
      inset,
    });
    if (!clamped) {
      resetStoredPanelLayout(storage, panelId, currentVersion);
      results.push({ panelId, action: 'reset', reason: 'invalid' });
      continue;
    }
    if (clamped.left === resolved.pos.left && clamped.top === resolved.pos.top) {
      results.push({ panelId, action: 'keep', position: clamped, key: resolved.key });
      continue;
    }
    try {
      storage.setItem(resolved.key, JSON.stringify(clamped));
    } catch {
      resetStoredPanelLayout(storage, panelId, currentVersion);
      results.push({ panelId, action: 'reset', reason: 'storage' });
      continue;
    }
    results.push({ panelId, action: 'clamp', position: clamped, key: resolved.key });
  }
  return results;
}

/**
 * True when a measured panel rect intersects the inset viewport.
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ viewportWidth: number, viewportHeight: number, inset?: number }} viewport
 * @returns {boolean}
 */
export function isPanelRectOnScreen(rect, {
  viewportWidth,
  viewportHeight,
  inset = PANEL_POSITION_INSET_PX,
} = {}) {
  if (!rect) return false;
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  if (width <= 0 || height <= 0) return false;
  const left = Number(rect.left);
  const top = Number(rect.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
  const vw = Number(viewportWidth) || 0;
  const vh = Number(viewportHeight) || 0;
  return left + width > inset
    && top + height > inset
    && left < vw - inset
    && top < vh - inset;
}
