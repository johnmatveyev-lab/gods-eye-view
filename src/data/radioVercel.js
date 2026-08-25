/**
 * Vercel Node entry for `/api/radio/*`.
 *
 * Restores the original path when the catch-all drops the `/api/radio` prefix.
 * Dispatches only the existing Radio Browser route table. This is not an
 * open proxy and does not attach other live feeds.
 *
 * @module radioVercel
 */
import { createRadioProxyMiddleware } from './radioDirectory.js';
import { createHostedRadioProxyMiddleware } from './radioNodeFetch.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Restore a leftover Vercel path to the Connect mount shape (`/stations`).
 * Do not invent a SPA rewrite.
 */
export function restoreRadioApiPath(url) {
  const parsed = parseUrl(url);
  let pathname = parsed.pathname;
  if (pathname === '/api/radio' || pathname.startsWith('/api/radio/')) {
    pathname = pathname.slice('/api/radio'.length) || '/';
  } else if (pathname === '/radio' || pathname.startsWith('/radio/')) {
    pathname = pathname.slice('/radio'.length) || '/';
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return `${pathname}${parsed.search}`;
}

export function createVercelRadioHandler(middlewareFactory = createHostedRadioProxyMiddleware) {
  let middleware = null;
  return async function handler(req, res) {
    req.url = restoreRadioApiPath(req.url);
    if (!middleware) middleware = middlewareFactory();
    try {
      await middleware(req, res);
    } catch (error) {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: publicRadioError(error) }));
    }
  };
}

/** Default Node entry used by api/radio/[...path].js */
export default createVercelRadioHandler();

export { createRadioProxyMiddleware };

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function publicRadioError(error) {
  const message = String(error?.message || '').trim();
  if (!message || message.length > 200 || message.includes('\n')) {
    return 'Radio directory is temporarily unavailable';
  }
  return message;
}
