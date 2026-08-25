export const SAVED_VIEWS_CAP = 10;
export const SAVED_VIEWS_KEY_PREFIX = 'meridian.savedViews.';

export function savedViewsStorageKey(userId) {
  return `${SAVED_VIEWS_KEY_PREFIX}${userId}`;
}

export function canUseSavedViews(entitlement) {
  return Boolean(entitlement?.savedViews?.available);
}

export function shouldShowSavedViewsButton(entitlement) {
  return canUseSavedViews(entitlement);
}

export function loadSavedViews(storage, userId) {
  if (!storage || !userId) return [];
  try {
    const raw = storage.getItem(savedViewsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSavedView)
      .filter(Boolean)
      .slice(0, SAVED_VIEWS_CAP);
  } catch {
    return [];
  }
}

export function saveCurrentView({
  storage,
  userId,
  entitlement,
  name,
  url,
  nowMs = Date.now(),
  id,
} = {}) {
  if (!canUseSavedViews(entitlement) || !userId || !storage) {
    return { ok: false, reason: 'unavailable', items: [] };
  }
  const items = loadSavedViews(storage, userId);
  if (items.length >= SAVED_VIEWS_CAP) {
    return { ok: false, reason: 'cap', items };
  }
  const item = normalizeSavedView({
    id: id || `sv_${nowMs}`,
    name,
    createdAt: new Date(nowMs).toISOString(),
    url,
  });
  if (!item) {
    return { ok: false, reason: 'invalid', items };
  }
  const next = [item, ...items];
  writeSavedViews(storage, userId, next);
  return { ok: true, item, items: next };
}

export function deleteSavedView({ storage, userId, entitlement, id } = {}) {
  if (!canUseSavedViews(entitlement) || !userId || !storage) {
    return { ok: false, reason: 'unavailable', items: [] };
  }
  const items = loadSavedViews(storage, userId).filter((item) => item.id !== id);
  writeSavedViews(storage, userId, items);
  return { ok: true, items };
}

export function restoreSavedView({
  entitlement,
  url,
  assignLocation = (href) => { window.location.assign(href); },
} = {}) {
  if (!canUseSavedViews(entitlement)) {
    return { ok: false, reason: 'unavailable' };
  }
  const href = String(url || '').trim();
  if (!href) return { ok: false, reason: 'invalid' };
  assignLocation(href);
  return { ok: true, url: href };
}

function writeSavedViews(storage, userId, items) {
  storage.setItem(savedViewsStorageKey(userId), JSON.stringify(items));
}

function normalizeSavedView(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim();
  const url = String(value.url || '').trim();
  const createdAt = String(value.createdAt || '').trim();
  if (!id || !name || !url || !createdAt) return null;
  return { id, name, createdAt, url };
}
