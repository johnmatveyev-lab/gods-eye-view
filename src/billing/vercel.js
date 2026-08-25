import { getBillingRuntime, handleBillingHttp } from './http.js';
import { publicBillingError } from './env.js';

/**
 * Web Request/Response adapter for Vercel Functions.
 * Vite preview still uses the Connect middleware in plugin.js; this is the
 * hosted path that actually deploys on Vercel.
 */
export async function handleVercelBilling(request, runtime = getBillingRuntime()) {
  const url = new URL(request.url);
  const rawBody = request.method === 'GET' || request.method === 'HEAD'
    ? ''
    : await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let statusCode = 200;
  const resHeaders = { 'Cache-Control': 'no-store' };
  let body = '';

  const req = {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    rawBody,
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) {
      resHeaders[name] = value;
    },
    end(chunk) {
      this.headersSent = true;
      statusCode = this.statusCode;
      body = chunk == null ? '' : String(chunk);
    },
  };

  try {
    await handleBillingHttp(req, res, runtime);
  } catch (error) {
    if (!res.headersSent) {
      statusCode = 500;
      resHeaders['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify({ error: publicBillingError(error, 'Billing request failed') });
    }
  }

  return new Response(body, { status: statusCode, headers: resHeaders });
}

export function GET(request) {
  return handleVercelBilling(request);
}

export function POST(request) {
  return handleVercelBilling(request);
}
