/**
 * Daily usage budget. Session seconds and request units reset at UTC midnight.
 */

export function utcDayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function emptyUsage(nowMs) {
  return {
    day: utcDayKey(nowMs),
    sessionSeconds: 0,
    requestUnits: 0,
  };
}

export function normalizeUsage(usage, nowMs) {
  const day = utcDayKey(nowMs);
  if (!usage || usage.day !== day) return emptyUsage(nowMs);
  return {
    day,
    sessionSeconds: Math.max(0, Number(usage.sessionSeconds) || 0),
    requestUnits: Math.max(0, Number(usage.requestUnits) || 0),
  };
}

export function remainingBudget(limits, usage, nowMs) {
  if (!limits) {
    return { sessionSeconds: Number.POSITIVE_INFINITY, requestUnits: Number.POSITIVE_INFINITY };
  }
  const current = normalizeUsage(usage, nowMs);
  return {
    sessionSeconds: Math.max(0, limits.dailySessionSeconds - current.sessionSeconds),
    requestUnits: Math.max(0, limits.dailyRequestUnits - current.requestUnits),
  };
}

export function isBudgetExhausted(limits, usage, nowMs) {
  if (!limits) return false;
  const remaining = remainingBudget(limits, usage, nowMs);
  return remaining.sessionSeconds <= 0 || remaining.requestUnits <= 0;
}

/**
 * @param {'session'|'request'} kind
 * @param {number} amount
 */
export function consumeUsage(usage, kind, amount, nowMs) {
  const current = normalizeUsage(usage, nowMs);
  const delta = Math.max(0, Number(amount) || 0);
  switch (kind) {
    case 'session':
      current.sessionSeconds += delta;
      break;
    case 'request':
      current.requestUnits += delta;
      break;
    default: {
      const _exhaustive = kind;
      throw new Error(`Unhandled usage kind: ${_exhaustive}`);
    }
  }
  return current;
}

export function formatRemainingBudget(remaining) {
  if (!remaining || !Number.isFinite(remaining.sessionSeconds)) return 'Uncapped';
  const seconds = Math.max(0, Math.floor(remaining.sessionSeconds));
  if (seconds <= 0) return '0 min left today';
  if (seconds < 60) return `${seconds}s left today`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min left today`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours}h ${remMin}m left today` : `${hours}h left today`;
}
