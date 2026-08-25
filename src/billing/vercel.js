import { getBillingRuntime, handleBillingHttp } from './http.js';
import { publicBillingError } from './env.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Restore /api/billing/... or /api/stripe/webhook when a Vercel catch-all
 * hands us only the leftover path. Do not invent a SPA rewrite.
 */
export function restoreApiPath(url, prefix) {
  const parsed = parseUrl(url);
  if (parsed.pathname.startsWith('/api/billing') || parsed.pathname.startsWith('/api/stripe')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  if (prefix === '/api/stripe/webhook') {
    return `${prefix}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${prefix}${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

export function createVercelBillingHandler(prefix, runtimeFactory = getBillingRuntime) {
  return async function handler(req, res) {
    ensureRawBody(req);
    req.url = restoreApiPath(req.url, prefix);
    try {
      await handleBillingHttp(req, res, runtimeFactory());
    } catch (error) {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: publicBillingError(error, 'Billing request failed') }));
    }
  };
}

/** Default Node entry used by api/billing/[...path].js */
export default createVercelBillingHandler('/api/billing');

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function ensureRawBody(req) {
  if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    req.rawBody = String(req.body);
    return;
  }
  if (req.body && typeof req.body === 'object') {
    req.rawBody = JSON.stringify(req.body);
  }
}
