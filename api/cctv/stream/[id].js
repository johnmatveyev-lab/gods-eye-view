import handler, { config, ensureCctvResourceUrl } from '../../../src/server/cctvApi.js';

export { config };

/** Vercel Vite only matches one extra segment on `[...path]`; this file owns `/stream/:id`. */
export default function cctvStreamById(req, res) {
  req.url = ensureCctvResourceUrl(req.url, 'stream', req.query);
  return handler(req, res);
}
