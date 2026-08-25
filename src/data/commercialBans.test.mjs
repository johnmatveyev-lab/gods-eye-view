import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_NEWS_RSS_DISABLED_ERROR,
  OPENSKY_DISABLED_ERROR,
  matchBannedCommercialSource,
  refuseBannedCommercialVoiceArgs,
} from './commercialBans.js';

test('OpenSky voice nouns are banned', () => {
  for (const noun of ['OpenSky', 'opensky', 'open sky', 'OpenSky Network', 'open-sky']) {
    const match = matchBannedCommercialSource(noun);
    assert.equal(match?.kind, 'opensky', noun);
    assert.equal(match?.error, OPENSKY_DISABLED_ERROR);
  }
});

test('Google News and news RSS voice nouns are banned', () => {
  for (const noun of ['Google News', 'google news', 'news RSS', 'news rss', 'Google News RSS']) {
    const match = matchBannedCommercialSource(noun);
    assert.equal(match?.kind, 'google-news-rss', noun);
    assert.equal(match?.error, GOOGLE_NEWS_RSS_DISABLED_ERROR);
  }
});

test('civilian flights, GDELT, and Radio news are not banned nouns', () => {
  for (const noun of ['flights', 'adsb.lol', 'GDELT', 'news']) {
    assert.equal(matchBannedCommercialSource(noun), null, noun);
  }
});

test('Radio category=news is not treated as Google News RSS', () => {
  assert.equal(
    refuseBannedCommercialVoiceArgs('control_radio', { category: 'news', filter: 'news' }),
    null,
  );
});
