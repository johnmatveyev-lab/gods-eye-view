// PLAN 174 — Network chips. Client-only filter of USGS all_day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EARTHQUAKE_NETWORKS,
  EARTHQUAKE_NETWORKS,
  EARTHQUAKE_NETWORK_LABELS,
  EARTHQUAKE_NETWORK_TITLES,
  earthquakeNetwork,
  earthquakeNetworkFlags,
  filterEarthquakeFeaturesByNetwork,
  normalizeEarthquakeNetworks,
  toggleEarthquakeNetwork,
} from './earthquakeNetworkFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function netFeature(id, net) {
  const properties = { mag: 3.2, place: String(id), time: 1_753_600_000_000 };
  if (net !== undefined) properties.net = net;
  return { id, geometry: { coordinates: [-122.4, 37.79, 8.2] }, properties };
}

const MIXED = Object.freeze([
  netFeature('us-lower', 'us'),
  netFeature('us-upper', 'US'),
  netFeature('ak-lower', 'ak'),
  netFeature('ak-mixed', 'Ak'),
  netFeature('ci-lower', 'ci'),
  netFeature('nc-lower', 'nc'),
  netFeature('tx-rare', 'tx'),
  netFeature('hv-rare', 'hv'),
  netFeature('missing'),
  netFeature('empty', ''),
  netFeature('nullish', null),
  netFeature('blank', '  '),
]);

test('network chips default all on and match the unfiltered set', () => {
  assert.equal(DEFAULT_EARTHQUAKE_NETWORKS, 'UACNO');
  assert.deepEqual([...EARTHQUAKE_NETWORKS], ['us', 'ak', 'ci', 'nc', 'other']);
  assert.equal(EARTHQUAKE_NETWORK_LABELS.us, 'US');
  assert.equal(EARTHQUAKE_NETWORK_LABELS.ak, 'AK');
  assert.equal(EARTHQUAKE_NETWORK_LABELS.ci, 'CI');
  assert.equal(EARTHQUAKE_NETWORK_LABELS.nc, 'NC');
  assert.equal(EARTHQUAKE_NETWORK_LABELS.other, 'Other');
  assert.equal(EARTHQUAKE_NETWORK_TITLES.us, 'Show earthquakes from the US contributing network');
  assert.equal(normalizeEarthquakeNetworks(undefined), 'UACNO');
  assert.equal(normalizeEarthquakeNetworks(null), 'UACNO');
  assert.equal(normalizeEarthquakeNetworks(''), 'UACNO');
  assert.equal(normalizeEarthquakeNetworks('all'), 'UACNO');
  assert.equal(normalizeEarthquakeNetworks('U'), 'U');
  assert.equal(normalizeEarthquakeNetworks('uacno'), 'UACNO');
  assert.equal(normalizeEarthquakeNetworks(['us', 'other']), 'UO');
  assert.equal(normalizeEarthquakeNetworks({
    us: true, ak: false, ci: true, nc: false, other: false,
  }), 'UC');
  assert.equal(normalizeEarthquakeNetworks('0'), '0');
  assert.equal(normalizeEarthquakeNetworks('bogus'), null);
  assert.equal(normalizeEarthquakeNetworks('UX'), null);
  assert.deepEqual(
    filterEarthquakeFeaturesByNetwork(MIXED, DEFAULT_EARTHQUAKE_NETWORKS).map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  assert.deepEqual(filterEarthquakeFeaturesByNetwork(null), []);
  assert.deepEqual(filterEarthquakeFeaturesByNetwork(undefined), []);
});

test('maps USGS properties.net onto US | AK | CI | NC | Other', () => {
  assert.equal(earthquakeNetwork('us'), 'us');
  assert.equal(earthquakeNetwork('US'), 'us');
  assert.equal(earthquakeNetwork('ak'), 'ak');
  assert.equal(earthquakeNetwork('Ak'), 'ak');
  assert.equal(earthquakeNetwork('ci'), 'ci');
  assert.equal(earthquakeNetwork('nc'), 'nc');
  assert.equal(earthquakeNetwork('tx'), 'other');
  assert.equal(earthquakeNetwork('hv'), 'other');
  assert.equal(earthquakeNetwork('uw'), 'other');
  assert.equal(earthquakeNetwork(null), 'other');
  assert.equal(earthquakeNetwork(''), 'other');
  assert.equal(earthquakeNetwork(undefined), 'other');
  assert.equal(earthquakeNetwork('  '), 'other');
});

test('US off hides US-net events; Other off hides unlabeled and rare nets', () => {
  const noUs = filterEarthquakeFeaturesByNetwork(MIXED, 'ACNO').map((feature) => feature.id);
  assert.ok(noUs.includes('ak-lower'));
  assert.ok(noUs.includes('ci-lower'));
  assert.ok(noUs.includes('tx-rare'));
  assert.ok(noUs.includes('missing'));
  assert.ok(!noUs.includes('us-lower'));
  assert.ok(!noUs.includes('us-upper'));

  const noOther = filterEarthquakeFeaturesByNetwork(MIXED, 'UACN').map((feature) => feature.id);
  assert.ok(noOther.includes('us-lower'));
  assert.ok(noOther.includes('ak-lower'));
  assert.ok(noOther.includes('ci-lower'));
  assert.ok(noOther.includes('nc-lower'));
  assert.ok(!noOther.includes('tx-rare'));
  assert.ok(!noOther.includes('hv-rare'));
  assert.ok(!noOther.includes('missing'));
  assert.ok(!noOther.includes('empty'));
  assert.ok(!noOther.includes('nullish'));
  assert.ok(!noOther.includes('blank'));

  const usOnly = filterEarthquakeFeaturesByNetwork(MIXED, 'U').map((feature) => feature.id);
  assert.deepEqual(usOnly, ['us-lower', 'us-upper']);
});

test('selected event stays visible when its network chip is off', () => {
  assert.deepEqual(
    filterEarthquakeFeaturesByNetwork(MIXED, 'U', { selectedId: 'tx-rare' })
      .map((feature) => feature.id),
    ['us-lower', 'us-upper', 'tx-rare'],
  );
  assert.deepEqual(
    filterEarthquakeFeaturesByNetwork(MIXED, 'ACNO', { selectedId: 'us-lower' })
      .map((feature) => feature.id)
      .filter((id) => id.startsWith('us-')),
    ['us-lower'],
  );
});

test('last-off empties the set except a selected event', () => {
  assert.equal(toggleEarthquakeNetwork('UACNO', 'us'), 'ACNO');
  assert.equal(toggleEarthquakeNetwork('U', 'us'), '0');
  assert.equal(toggleEarthquakeNetwork('0', 'us'), 'U');
  assert.deepEqual(earthquakeNetworkFlags('0'), {
    us: false,
    ak: false,
    ci: false,
    nc: false,
    other: false,
  });
  assert.deepEqual(filterEarthquakeFeaturesByNetwork(MIXED, '0').map((feature) => feature.id), []);
  assert.deepEqual(
    filterEarthquakeFeaturesByNetwork(MIXED, '0', { selectedId: 'missing' }).map((feature) => feature.id),
    ['missing'],
  );
});

test('helper reads USGS properties.net and the chips sit next to quake filters', () => {
  const helper = readFileSync(new URL('./earthquakeNetworkFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/earthquakes.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(helper, /properties\.net/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /networks/);
  assert.match(source, /filterEarthquakeFeaturesByNetwork/);
  assert.match(html, /id="earthquake-network-chips"/);
  assert.match(html, /data-earthquake-network="us"/);
  assert.match(html, /data-earthquake-network="ak"/);
  assert.match(html, /data-earthquake-network="ci"/);
  assert.match(html, /data-earthquake-network="nc"/);
  assert.match(html, /data-earthquake-network="other"/);
  assert.match(html, /id="earthquake-type-chips"/);
  assert.match(html, /id="earthquake-felt-chips"/);
  assert.match(ui, /earthquake-network-chips|data-earthquake-network/);
  assert.match(ui, /_earthquakeNetworkChips\.hidden = !enabled/);
  assert.match(css, /earthquake-network-chip/);
});
