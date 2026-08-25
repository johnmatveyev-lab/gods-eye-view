/**
 * Node TLS-pinned fetch for Radio Browser. Imported only by Vite and the
 * hosted `/api/radio` function — never by the Cesium client layer.
 *
 * @module radioNodeFetch
 */
import { Readable } from 'node:stream';
import https from 'node:https';
import { lookup as lookupDns } from 'node:dns/promises';
import { createRadioProxyMiddleware } from './radioDirectory.js';

export { lookupDns };

/** Pin a Radio Browser TLS connection to already-validated addresses. */
export function fetchPinnedRadioResponse(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = https.request(url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 500,
        statusText: response.statusMessage || '',
        headers,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Production Radio Browser middleware with DNS lookup and pinned TLS. */
export function createHostedRadioProxyMiddleware(options = {}) {
  return createRadioProxyMiddleware({
    lookupImpl: lookupDns,
    pinnedFetch: fetchPinnedRadioResponse,
    ...options,
  });
}
