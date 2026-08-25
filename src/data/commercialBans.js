/**
 * Hard-disabled commercial sources.
 *
 * OpenSky Network and Google News RSS are banned in this hosted fork.
 * Voice and UI must refuse them and must never fetch their hosts.
 * Civilian flights stay adsb.lol (ODbL). Cockpit headlines stay GDELT.
 */

export const OPENSKY_DISABLED_ERROR = 'OpenSky is disabled';
export const GOOGLE_NEWS_RSS_DISABLED_ERROR = 'Google News RSS is disabled';

const OPENSKY_PHRASES = new Set([
  'opensky',
  'open sky',
  'open-sky',
  'opensky network',
  'open sky network',
  'open-sky network',
]);

const GOOGLE_NEWS_PHRASES = new Set([
  'google news',
  'google news rss',
  'news rss',
  'news.google',
  'google-news',
  'google-news-rss',
]);

function normalizeVoiceNoun(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function compactVoiceNoun(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-./]+/g, '');
}

/**
 * Identify a banned OpenSky or Google News RSS voice/UI noun.
 * Radio "news" category is not a match — only Google News / news RSS phrasings.
 * @param {unknown} value Spoken or tool-argument noun.
 * @returns {{id:string,kind:string,error:string}|null}
 */
export function matchBannedCommercialSource(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const spaced = normalizeVoiceNoun(value);
  const compact = compactVoiceNoun(value);

  if (compact.includes('opensky') || OPENSKY_PHRASES.has(spaced)) {
    return {
      id: 'opensky',
      kind: 'opensky',
      error: OPENSKY_DISABLED_ERROR,
    };
  }

  if (
    compact.includes('googlenews')
    || compact.includes('newsgoogle')
    || GOOGLE_NEWS_PHRASES.has(spaced)
    || /\bgoogle\s+news\b/.test(spaced)
    || /\bnews\s+rss\b/.test(spaced)
  ) {
    return {
      id: 'google-news-rss',
      kind: 'google-news-rss',
      error: GOOGLE_NEWS_RSS_DISABLED_ERROR,
    };
  }

  return null;
}

/**
 * Voice/tool nouns that can name a banned commercial source.
 * Does not include Radio `category`/`filter` — "play news" stays Radio.
 * @param {object} [args]
 * @returns {string[]}
 */
export function collectBannedVoiceNouns(args = {}) {
  return [args.layerId, args.layer, args.target, args.source, args.newsSource, args.headlineSource]
    .filter((value) => value != null && String(value).trim() !== '')
    .map((value) => String(value));
}

/**
 * Build an ok=false refusal for a banned commercial source.
 * @param {string} action Voice action name.
 * @param {unknown} rawValue Spoken or tool-argument noun.
 * @returns {object|null}
 */
export function refuseBannedCommercialSource(action, rawValue) {
  const banned = matchBannedCommercialSource(rawValue);
  if (!banned) return null;
  return {
    ok: false,
    action,
    layerId: banned.id,
    source: banned.kind,
    error: banned.error,
    enabled: false,
    lifecycleState: 'disabled',
    lifecycleUncertain: false,
  };
}

/**
 * Refuse the first banned noun on a voice action, or null if none match.
 * @param {string} action
 * @param {object} [args]
 * @returns {object|null}
 */
export function refuseBannedCommercialVoiceArgs(action, args = {}) {
  for (const noun of collectBannedVoiceNouns(args)) {
    const refused = refuseBannedCommercialSource(action, noun);
    if (refused) return refused;
  }
  return null;
}
