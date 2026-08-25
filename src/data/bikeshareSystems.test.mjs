import test from 'node:test';
import assert from 'node:assert/strict';
import { GBFS_ALLOWED_HOSTS } from './gbfs.js';
import {
  BIKESHARE_PICKER_ALLOWED_HOSTS,
  BIKESHARE_SYSTEM_STORAGE_KEY,
  DEFAULT_BIKESHARE_SYSTEM_ID,
  bikeshareSystemPickerLabel,
  buildGbfsProxyUrl,
  isBikesharePickerHostAllowed,
  listPickerSystems,
  normalizeBikeshareSystemId,
  readPersistedBikeshareSystem,
  writePersistedBikeshareSystem,
} from './bikeshareSystems.js';
import { listBikeshareSystems } from './bikeshare.js';

test('picker allowlist stays locked to the existing GBFS proxy hosts', () => {
  assert.deepEqual([...BIKESHARE_PICKER_ALLOWED_HOSTS].sort(), [...GBFS_ALLOWED_HOSTS].sort());
  assert.equal(isBikesharePickerHostAllowed('evil.example.com'), false);
  assert.equal(isBikesharePickerHostAllowed('gbfs.lyft.com'), true);
});

test('disallowed hosts never appear in the picker catalog', () => {
  const systems = listBikeshareSystems();
  assert.ok(systems.length >= 2, 'existing city list should expose multiple systems');
  assert.ok(systems.every((system) => system.hosts.every(isBikesharePickerHostAllowed)));
  assert.equal(systems.some((system) => system.hosts.includes('evil.example.com')), false);

  const leaked = listPickerSystems([
    ...systems,
    {
      id: 'evil-bikes',
      city: 'Evil City',
      provider: 'Evil',
      hosts: ['evil.example.com'],
      stationInformationUrl: 'https://evil.example.com/station_information.json',
      stationStatusUrl: 'https://evil.example.com/station_status.json',
    },
  ]);
  assert.equal(leaked.some((system) => system.id === 'evil-bikes'), false);
  assert.equal(normalizeBikeshareSystemId('evil-bikes', systems), null);
});

test('proxy URL builder stays on /api/gbfs and persists only allowlisted ids', () => {
  const nyc = listBikeshareSystems().find((system) => system.id === 'nyc-citibike');
  assert.ok(nyc);
  assert.equal(
    buildGbfsProxyUrl(nyc.stationInformationUrl),
    `/api/gbfs/${encodeURIComponent(nyc.stationInformationUrl)}`,
  );

  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  const systems = listBikeshareSystems();
  assert.equal(writePersistedBikeshareSystem('evil-bikes', store, systems), null);
  assert.equal(storage.has(BIKESHARE_SYSTEM_STORAGE_KEY), false);
  assert.equal(writePersistedBikeshareSystem('chicago-divvy', store, systems), 'chicago-divvy');
  assert.equal(readPersistedBikeshareSystem(store, systems), 'chicago-divvy');
  assert.equal(DEFAULT_BIKESHARE_SYSTEM_ID, 'austin-capmetro');
  assert.equal(bikeshareSystemPickerLabel(nyc), 'New York, NY · Citi Bike');
});
