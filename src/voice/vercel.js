import { handleHudSummaryHttp } from '../hud/summary.js';
import { handleRealtimeToken } from './openaiApi.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export function createRealtimeTokenHandler(deps = {}) {
  return async function handler(req, res) {
    await handleRealtimeToken(req, res, deps);
  };
}

export function createHudSummaryHandler(deps = {}) {
  return async function handler(req, res) {
    await handleHudSummaryHttp(req, res, deps);
  };
}

/** Default Node entry used by api/realtime/token.js */
export default createRealtimeTokenHandler();
