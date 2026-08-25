import { publicBillingError } from './env.js';
import { getBillingRuntime, handleBillingHttp, rejectIfVoiceForbidden } from './http.js';

const BILLING_PATHS = [
  '/api/billing/config',
  '/api/billing/me',
  '/api/billing/usage',
  '/api/billing/checkout',
  '/api/billing/portal',
  '/api/billing/webhook',
  '/api/stripe/webhook',
];

export function meridianBillingPlugin(runtimeFactory = getBillingRuntime) {
  function install(middlewares) {
    middlewares.use(async (req, res, next) => {
      const path = String(req.url || '').split('?')[0];
      if (!BILLING_PATHS.includes(path)) {
        next();
        return;
      }
      try {
        await handleBillingHttp(req, res, runtimeFactory());
      } catch (error) {
        if (res.headersSent) return;
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: publicBillingError(error, 'Billing request failed') }));
      }
    });
  }

  return {
    name: 'meridian-billing',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { rejectIfVoiceForbidden };
