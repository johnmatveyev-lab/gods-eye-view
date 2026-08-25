import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDistanceMeters, formatWeatherVisibility } from './units.js';

const SAME_VISIBILITY_M = 18_000;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const units = readFileSync(new URL('./units.js', import.meta.url), 'utf8');
const weatherEffects = readFileSync(new URL('./data/weatherEffects.js', import.meta.url), 'utf8');
const weatherChrome = readFileSync(new URL('./weatherChrome.js', import.meta.url), 'utf8');
const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');

test('same visibilityM prints km, nmi, and miles through the existing units helper', () => {
  assert.equal(formatWeatherVisibility(SAME_VISIBILITY_M, 'km'), '18 km');
  assert.equal(formatWeatherVisibility(SAME_VISIBILITY_M, 'nm'), '9.7 nmi');
  assert.equal(formatWeatherVisibility(SAME_VISIBILITY_M, 'mi'), '11 mi');
  assert.equal(
    formatWeatherVisibility(SAME_VISIBILITY_M, 'mi'),
    formatDistanceMeters(SAME_VISIBILITY_M, 'mi'),
  );
});

test('missing or non-finite visibility stays UNAVAILABLE and hidden', () => {
  assert.equal(formatWeatherVisibility(null), 'UNAVAILABLE');
  assert.equal(formatWeatherVisibility(Number.POSITIVE_INFINITY), 'UNAVAILABLE');
  assert.match(html, /id="cockpit-local-visibility-cell"[^>]*hidden/);
  assert.match(html, /id="cockpit-local-visibility"/);
  assert.match(ui, /localVisibilityCell\.hidden = text === 'UNAVAILABLE'/);
});

test('units toggle re-paints stored visibilityM and does not refetch weather', () => {
  assert.match(ui, /paintWeatherVisibility\(this\.regionalBrief\?\.weather\)/);
  assert.match(ui, /formatWeatherVisibility\(weather\?\.visibilityM\)/);
  assert.match(
    ui,
    /this\._unitsUnsubscribe = subscribeDistanceUnit\(\(\) => \{[\s\S]*?this\.cockpitView\?\.refreshDistanceUnits\?\.\(\);/,
  );
  assert.match(ui, /refreshDistanceUnits\(\) \{[\s\S]*?paintWeatherVisibility\(this\.regionalBrief\?\.weather\)/);
  const refreshDistanceUnits = ui.match(/refreshDistanceUnits\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const paintWeatherVisibility = ui.match(/paintWeatherVisibility\(weather\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const unitsSubscribe = ui.match(/this\._unitsUnsubscribe = subscribeDistanceUnit\(\(\) => \{[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(refreshDistanceUnits, /paintWeatherVisibility\(this\.regionalBrief\?\.weather\)/);
  assert.doesNotMatch(refreshDistanceUnits, /fetchRegionalBrief|weather-effects|\/api\//);
  assert.doesNotMatch(paintWeatherVisibility, /fetchRegionalBrief|weather-effects|\/api\//);
  assert.doesNotMatch(unitsSubscribe, /weather-effects|fetchRegionalBrief|\/api\//);
  assert.match(weatherEffects, /\/api\/weather-effects/);
});

test('temperature, wind, and WX stay independent of the distance toggle', () => {
  assert.match(ui, /\$\{Math\.round\(weather\.temperatureC\)\}°C/);
  assert.match(ui, /\$\{Math\.round\(weather\.windKph\)\} KM\/H/);
  assert.doesNotMatch(html, /data-temp-unit|data-wind-unit|units-celsius|units-fahrenheit/);
  assert.doesNotMatch(html, /id="visibility-km"|data-visibility-unit/);
  assert.match(html, /data-wx-mode="off"/);
  assert.match(html, /data-wx-mode="on"/);
  assert.match(weatherChrome, /WX_STORAGE_KEY/);
  assert.doesNotMatch(weatherChrome, /formatWeatherVisibility|visibilityM/);
});

test('no new weather endpoint, chips, or product rename', () => {
  assert.doesNotMatch(units, /\/api\/weather/);
  assert.doesNotMatch(html, /data-visibility-chip|visibility-unit-toggle/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(ui + html + units, /quantum-earth|Google News RSS|TeleGeography|OpenSky/);
});
