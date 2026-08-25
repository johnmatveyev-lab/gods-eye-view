/**
 * Netlify Functions v2 catch-all for hosted `/api/*`.
 *
 * Invokes the existing Vercel Node handlers. Do not put business logic here.
 */
export { default, config } from '../../src/server/netlifyLiveApi.js';
