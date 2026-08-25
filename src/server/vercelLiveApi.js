import { createLiveApiPlugins } from './liveApiProxies.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Restore /api/... when a Vercel catch-all hands us only the leftover path.
 * Do not invent a SPA rewrite.
 */
export function restoreLiveApiPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname.startsWith('/api/')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `/api${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

export function createConnectStack(plugins) {
  const layers = [];
  const middlewares = {
    use(pathOrFn, maybeFn) {
      if (typeof pathOrFn === 'function') {
        layers.push({ path: null, fn: pathOrFn });
        return;
      }
      layers.push({ path: String(pathOrFn || ''), fn: maybeFn });
    },
  };
  for (const plugin of plugins) {
    const configure = plugin?.configureServer || plugin?.configurePreviewServer;
    if (typeof configure === 'function') {
      configure({ middlewares });
    }
  }
  return layers;
}

export function createVercelLiveApiHandler(pluginsFactory = createLiveApiPlugins) {
  let layers = null;
  return async function handler(req, res) {
    ensureRawBody(req);
    req.url = restoreLiveApiPath(req.url);
    if (!layers) layers = createConnectStack(pluginsFactory());
    try {
      const handled = await dispatchConnect(layers, req, res);
      if (handled || res.headersSent || res.writableEnded) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: publicError(error) }));
    }
  };
}

/** Default Node entry used by api/[...path].js */
export default createVercelLiveApiHandler();

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function pathMatches(mount, pathname) {
  if (!mount) return true;
  return pathname === mount || pathname.startsWith(`${mount}/`);
}

function stripMount(url, mount) {
  if (!mount) return url;
  const parsed = parseUrl(url);
  let rest = parsed.pathname.slice(mount.length) || '/';
  if (!rest.startsWith('/')) rest = `/${rest}`;
  return `${rest}${parsed.search}`;
}

async function dispatchConnect(layers, req, res) {
  const originalUrl = req.url;
  req.originalUrl = originalUrl;
  const originalPath = parseUrl(originalUrl).pathname;

  for (const layer of layers) {
    if (!pathMatches(layer.path, originalPath) || typeof layer.fn !== 'function') continue;
    req.url = stripMount(originalUrl, layer.path);
    let nextCalled = false;
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      try {
        const maybePromise = layer.fn(req, res, (error) => {
          nextCalled = true;
          finish(error);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(() => {
            if (!nextCalled) resolve();
          }, reject);
          return;
        }
        if (!nextCalled) resolve();
      } catch (error) {
        reject(error);
      }
    });
    if (res.headersSent || res.writableEnded) return true;
    if (!nextCalled && !layer.path) continue;
    if (!nextCalled) return true;
  }
  return false;
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

function publicError(error) {
  const message = String(error?.message || '').trim();
  if (!message || message.length > 200 || message.includes('\n')) {
    return 'Live API request failed';
  }
  if (/sk_live|sk_test|rk_live|whsec_|OPENAI_API_KEY\s*=/i.test(message)) {
    return 'Live API request failed';
  }
  return message;
}
