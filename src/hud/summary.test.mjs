import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_CODES } from '../billing/entitlements.js';
import {
  buildHudSummaryInput,
  extractOpenAiResponseText,
  handleHudSummaryHttp,
  toFiveWordHudSummary,
} from './summary.js';
import hudHandler, { config as hudConfig } from '../../api/openai/hud-summary.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SERVER_KEY = 'sk-test-openai-server-secret-do-not-leak';

function mockReq({ method = 'POST', url = '/api/openai/hud-summary', headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

function assertNotVoiceAuthRequired(json) {
  assert.notEqual(json?.code, BILLING_CODES.AUTH_REQUIRED);
  assert.notEqual(json?.error, 'Sign in required for voice.');
}

function mockOpenAiFetch() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const payload = {
      output_text: 'Austin skyline flights visible',
      output: [{ content: [{ text: 'Austin skyline flights visible' }] }],
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };
  return { fetchImpl, calls };
}

async function dispatchHud(options = {}, deps = {}) {
  const req = mockReq({
    url: '/api/openai/hud-summary',
    body: { place: 'Austin', layers: ['flights'] },
    ...options,
  });
  const res = mockRes();
  await handleHudSummaryHttp(req, res, {
    env: { OPENAI_API_KEY: SERVER_KEY, ...deps.env },
    fetchImpl: deps.fetchImpl,
  });
  return {
    status: res.statusCode,
    body: res.body,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

test('GET /api/openai/hud-summary is 405 JSON, never NOT_FOUND', async () => {
  const { status, json, body } = await dispatchHud({ method: 'GET' }, {
    fetchImpl: mockOpenAiFetch().fetchImpl,
  });
  assert.equal(status, 405);
  assert.equal(json.error, 'Method not allowed');
  assert.doesNotMatch(body, /NOT_FOUND/);
});

test('POST {} without key is 503 OPENAI_API_KEY is not set', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json } = await dispatchHud({ body: {} }, {
    env: { OPENAI_API_KEY: '' },
    fetchImpl,
  });
  assert.equal(status, 503);
  assert.match(json.error, /OPENAI_API_KEY is not set/);
  assertNotVoiceAuthRequired(json);
  assert.equal(calls.length, 0);
});

test('POST without Clerk or session never returns voice auth_required', async () => {
  const missingKey = mockOpenAiFetch();
  const denied = await dispatchHud({ body: {} }, {
    env: { OPENAI_API_KEY: '' },
    fetchImpl: missingKey.fetchImpl,
  });
  assert.equal(denied.status, 503);
  assert.match(denied.json.error, /OPENAI_API_KEY is not set/);
  assertNotVoiceAuthRequired(denied.json);
  assert.equal(missingKey.calls.length, 0);

  const withKey = mockOpenAiFetch();
  const allowed = await dispatchHud({ body: {} }, {
    fetchImpl: withKey.fetchImpl,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.summary, 'Austin skyline flights visible');
  assertNotVoiceAuthRequired(allowed.json);
  assert.equal(withKey.calls.length, 1);
});

test('HUD summary uses the server key and does not leak it', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json, body } = await dispatchHud({}, { fetchImpl });
  assert.equal(status, 200);
  assert.equal(json.summary, 'Austin skyline flights visible');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/responses$/);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVER_KEY}`);
  assert.doesNotMatch(body, new RegExp(SERVER_KEY));
});

test('toFiveWordHudSummary clamps punctuation to five words', () => {
  assert.equal(
    toFiveWordHudSummary('Alpha, bravo; charlie delta echo foxtrot!'),
    'Alpha bravo charlie delta echo',
  );
  assert.equal(
    extractOpenAiResponseText({ output_text: '  Hello there, world.  ' }),
    'Hello there, world.',
  );
});

test('invented-coord-only context does not add a place name in the prompt path', async () => {
  const labels = buildHudSummaryInput({
    lat: 30.2672,
    lon: -97.7431,
    placeName: 'Austin',
    inventedPlace: 'Austin',
  });
  assert.equal(labels.place, undefined);
  assert.equal(labels.placeLabels, undefined);
  assert.doesNotMatch(JSON.stringify(labels), /Austin|30\.2672|-97\.7431/);

  const { fetchImpl, calls } = mockOpenAiFetch();
  await dispatchHud({
    body: { lat: 30.2672, lon: -97.7431, placeName: 'Austin' },
  }, { fetchImpl });
  assert.equal(calls.length, 1);
  const posted = JSON.parse(calls[0].init.body);
  assert.doesNotMatch(posted.input, /Austin|30\.2672|-97\.7431|placeName/);
  assert.match(posted.instructions, /Do not infer from coordinates or invent a place/);
});

test('Clerk unset does not apply the voice spend gate to HUD summary', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json } = await dispatchHud({ body: {} }, { fetchImpl });
  assert.equal(status, 200);
  assert.equal(json.summary, 'Austin skyline flights visible');
  assertNotVoiceAuthRequired(json);
  assert.equal(calls.length, 1);
});

test('Vercel HUD wrapper exists and does not embed the server key', () => {
  const absolute = path.join(ROOT, 'api/openai/hud-summary.js');
  assert.equal(existsSync(absolute), true);
  const source = readFileSync(absolute, 'utf8');
  assert.match(source, /src\/voice\/vercel\.js|src\/hud\/summary\.js/);
  assert.doesNotMatch(source, /OPENAI_API_KEY\s*=/);
  assert.equal(typeof hudHandler, 'function');
  assert.equal(hudConfig.api.bodyParser, false);
});
