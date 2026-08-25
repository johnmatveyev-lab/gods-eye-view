import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PLANS } from './plans.js';
import { emptyUsage, normalizeUsage } from './usage.js';

export function createEmptyAccount(userId, nowMs = Date.now()) {
  return {
    userId,
    plan: PLANS.FREE,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    savedViews: [],
    usage: emptyUsage(nowMs),
    updatedAt: nowMs,
  };
}

export function createAccountStore({ persistPath = null, now = () => Date.now() } = {}) {
  const accounts = new Map();
  if (persistPath) loadFromDisk(accounts, persistPath);

  const persist = () => {
    if (!persistPath) return;
    try {
      mkdirSync(path.dirname(persistPath), { recursive: true });
      writeFileSync(persistPath, JSON.stringify({
        updatedAt: now(),
        accounts: [...accounts.values()],
      }, null, 2));
    } catch {
      // Serverless filesystems are read-only; Clerk metadata remains the host store.
    }
  };

  return {
    get(userId) {
      if (!userId) return null;
      return accounts.get(userId) || null;
    },
    getOrCreate(userId) {
      const existing = accounts.get(userId);
      if (existing) {
        existing.usage = normalizeUsage(existing.usage, now());
        return existing;
      }
      const created = createEmptyAccount(userId, now());
      accounts.set(userId, created);
      persist();
      return created;
    },
    findByCustomerId(customerId) {
      if (!customerId) return null;
      for (const account of accounts.values()) {
        if (account.stripeCustomerId === customerId) return account;
      }
      return null;
    },
    applyPatch(userId, patch) {
      const account = this.getOrCreate(userId);
      Object.assign(account, patch, { userId, updatedAt: now() });
      persist();
      return account;
    },
    snapshot() {
      return [...accounts.values()].map((account) => ({ ...account, usage: { ...account.usage } }));
    },
  };
}

function loadFromDisk(accounts, persistPath) {
  try {
    const raw = JSON.parse(readFileSync(persistPath, 'utf8'));
    const rows = Array.isArray(raw?.accounts) ? raw.accounts : [];
    for (const row of rows) {
      if (row?.userId) accounts.set(row.userId, row);
    }
  } catch {
    // Missing or corrupt store starts empty.
  }
}
