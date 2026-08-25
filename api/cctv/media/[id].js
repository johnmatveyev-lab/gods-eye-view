import handler, { config, ensureCctvResourceUrl } from '../../../src/server/cctvApi.js';

export { config };

/** Vercel Vite only matches one extra segment on `[...path]`; this file owns `/media/:id`. */
export default function cctvMediaById(req, res) {
  req.url = ensureCctvResourceUrl(req.url, 'media', req.query);
  return handler(req, res);
}
