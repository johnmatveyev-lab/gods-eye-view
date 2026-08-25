import { handleHudSummary, handleRealtimeToken } from './openaiApi.js';

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
    await handleHudSummary(req, res, deps);
  };
}

/** Default Node entry used by api/realtime/token.js */
export default createRealtimeTokenHandler();
