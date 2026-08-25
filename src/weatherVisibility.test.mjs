import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatVisibilityM } from './data/weatherVisibilityUnits.js';

const SAME_VISIBILITY_M = 8_000;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const helper = readFileSync(new URL('./data/weatherVisibilityUnits.js', import.meta.url), 'utf8');
const weatherEffects = readFileSync(new URL('./data/weatherEffects.js', import.meta.url), 'utf8');
const weatherChrome = readFileSync(new URL('./weatherChrome.js', import.meta.url), 'utf8');
const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');

test('same visibilityM prints km and miles through the dedicated helper', () => {
  assert.equal(formatVisibilityM(SAME_VISIBILITY_M, 'km'), '8 km');
  assert.equal(formatVisibilityM(SAME_VISIBILITY_M, 'mi'), '5 mi');
});

test('missing or non-finite visibility stays UNAVAILABLE and hidden', () => {
  assert.equal(formatVisibilityM(null), 'UNAVAILABLE');
  assert.equal(formatVisibilityM(Number.POSITIVE_INFINITY), 'UNAVAILABLE');
  assert.match(html, /id="cockpit-local-visibility-cell"[^>]*hidden/);
  assert.match(html, /id="cockpit-local-visibility"/);
  assert.match(ui, /localVisibilityCell\.hidden = text === 'UNAVAILABLE'/);
});

test('visibility chips re-paint stored visibilityM and do not refetch weather', () => {
  assert.match(ui, /paintWeatherVisibility\(this\.regionalBrief\?\.weather\)/);
  assert.match(ui, /formatVisibilityM\(weather\?\.visibilityM\)/);
  assert.match(ui, /bindWeatherVisibilityUnitToggle/);
  const paintWeatherVisibility = ui.match(/paintWeatherVisibility\(weather\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const refreshDistanceUnits = ui.match(/refreshDistanceUnits\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(paintWeatherVisibility, /fetchRegionalBrief|weather-effects|\/api\//);
  assert.doesNotMatch(refreshDistanceUnits, /paintWeatherVisibility|formatVisibilityM/);
  assert.match(weatherEffects, /\/api\/weather-effects/);
});

test('temperature, wind, precip, feels, and WX stay independent of visibility chips', () => {
  assert.match(ui, /formatTemperatureC\(weather\?\.temperatureC\)|formatWeatherHudTemperature\(/);
  assert.match(ui, /formatWindSpeed\(weather\?\.windKph\)/);
  assert.match(ui, /formatPrecipitationMm\(weather\?\.precipitationMm\)/);
  assert.match(html, /data-weather-units="C"/);
  assert.match(html, /data-wind-unit="kmh"/);
  assert.match(html, /data-weather-precip-units="mm"/);
  assert.match(html, /data-weather-feels="actual"/);
  assert.match(html, /data-wx-mode="off"/);
  assert.match(html, /data-wx-mode="on"/);
  assert.match(weatherChrome, /WX_STORAGE_KEY/);
  assert.doesNotMatch(weatherChrome, /formatVisibilityM|visibilityM|weatherVisibility/);
});

test('no new weather endpoint or product rename', () => {
  assert.doesNotMatch(helper, /\/api\/weather-visibility|\/api\/visibility/);
  assert.match(html, /data-weather-visibility="km"/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(ui + html + helper, /quantum-earth|Google News RSS|TeleGeography/);
});
