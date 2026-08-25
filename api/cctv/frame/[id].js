import handler, { config, ensureCctvResourceUrl } from '../../../src/server/cctvApi.js';

export { config };

/** Vercel Vite only matches one extra segment on `[...path]`; this file owns `/frame/:id`. */
export default function cctvFrameById(req, res) {
  req.url = ensureCctvResourceUrl(req.url, 'frame', req.query);
  return handler(req, res);
}
