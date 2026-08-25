import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLING_CODES } from '../billing/entitlements.js';
import { createBillingRuntime } from '../billing/http.js';
import { PLANS } from '../billing/plans.js';
import { createAccountStore } from '../billing/store.js';
import {
  extractOpenAiResponseText,
  handleHudSummary,
  handleRealtimeToken,
  toFiveWordHudSummary,
} from './openaiApi.js';
import tokenHandler, { config as tokenConfig } from '../../api/realtime/token.js';
import hudHandler, { config as hudConfig } from '../../api/openai/hud-summary.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SERVER_KEY = 'sk-test-openai-server-secret-do-not-leak';
const EPHEMERAL = 'ek_test_ephemeral_client_secret';

function mockReq({ method = 'POST', url = '/api/realtime/token', headers = {}, body = '' } = {}) {
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

function hostedRuntime(overrides = {}) {
  const store = createAccountStore({ now: () => Date.parse('2026-08-25T12:00:00.000Z') });
  return createBillingRuntime({
    env: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_example',
      CLERK_SECRET_KEY: 'sk_test_example',
    },
    now: () => Date.parse('2026-08-25T12:00:00.000Z'),
    store,
    verifyToken: async () => ({ sub: 'user_abc', email: 'ops@example.com' }),
    getUserRecord: async () => ({ publicMetadata: { meridianPlan: PLANS.FREE } }),
    ...overrides,
  });
}

function mockOpenAiFetch({ tokenBody = { value: EPHEMERAL, session: { model: 'gpt-realtime-2' } } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const payload = String(url).includes('/realtime/client_secrets')
      ? tokenBody
      : {
        output_text: 'Austin skyline flights visible',
        output: [{ content: [{ text: 'Austin skyline flights visible' }] }],
      };
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };
  return { fetchImpl, calls };
}

async function dispatchToken(options = {}, deps = {}) {
  const req = mockReq({ url: '/api/realtime/token', ...options });
  const res = mockRes();
  await handleRealtimeToken(req, res, {
    env: { OPENAI_API_KEY: SERVER_KEY, ...deps.env },
    fetchImpl: deps.fetchImpl,
    runtime: deps.runtime,
  });
  return {
    status: res.statusCode,
    body: res.body,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
  };
}

async function dispatchHud(options = {}, deps = {}) {
  const req = mockReq({
    url: '/api/openai/hud-summary',
    body: { place: 'Austin', layers: ['flights'] },
    ...options,
  });
  const res = mockRes();
  await handleHudSummary(req, res, {
    env: { OPENAI_API_KEY: SERVER_KEY, ...deps.env },
    fetchImpl: deps.fetchImpl,
    runtime: deps.runtime,
  });
  return {
    status: res.statusCode,
    body: res.body,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

test('token mint posts the server key to OpenAI and returns only the ephemeral secret', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json, body, headers } = await dispatchToken({ method: 'POST' }, {
    runtime: createBillingRuntime({ env: {} }),
    fetchImpl,
  });
  assert.equal(status, 200);
  assert.equal(json.value, EPHEMERAL);
  assert.equal(headers['X-GEV-Voice-Tier'], 'standard');
  assert.equal(headers['X-GEV-Voice-Model'], 'gpt-realtime-2');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/realtime\/client_secrets$/);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVER_KEY}`);
  const posted = JSON.parse(calls[0].init.body);
  assert.equal(posted.session.type, 'realtime');
  assert.equal(posted.session.model, 'gpt-realtime-2');
  assert.ok(Array.isArray(posted.session.tools));
  assert.ok(posted.session.tools.length >= 20);
  assert.doesNotMatch(body, new RegExp(SERVER_KEY));
  assert.doesNotMatch(JSON.stringify(json), /sk-test-openai|OPENAI_API_KEY/);
});

test('token mint is 503 when OPENAI_API_KEY is missing and never calls OpenAI', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json } = await dispatchToken({ method: 'POST' }, {
    env: { OPENAI_API_KEY: '' },
    runtime: createBillingRuntime({ env: {} }),
    fetchImpl,
  });
  assert.equal(status, 503);
  assert.match(json.error, /OPENAI_API_KEY is not set/);
  assert.equal(calls.length, 0);
});

test('hosted Free is forbidden for voice token mint; Pro is allowed', async () => {
  const free = mockOpenAiFetch();
  const denied = await dispatchToken({
    headers: { authorization: 'Bearer sess_test' },
  }, {
    runtime: hostedRuntime(),
    fetchImpl: free.fetchImpl,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, BILLING_CODES.VOICE_REQUIRES_PRO);
  assert.equal(free.calls.length, 0);

  const pro = mockOpenAiFetch();
  const allowed = await dispatchToken({
    headers: { authorization: 'Bearer sess_test' },
  }, {
    runtime: hostedRuntime({
      getUserRecord: async () => ({ publicMetadata: { meridianPlan: PLANS.PRO } }),
    }),
    fetchImpl: pro.fetchImpl,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.value, EPHEMERAL);
  assert.equal(pro.calls.length, 1);
});

test('self-host without Clerk still mints a token when OPENAI_API_KEY is set', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json } = await dispatchToken({}, {
    runtime: createBillingRuntime({ env: {} }),
    fetchImpl,
  });
  assert.equal(status, 200);
  assert.equal(json.value, EPHEMERAL);
  assert.equal(calls.length, 1);
});

test('HUD summary uses the server key and returns five words without leaking it', async () => {
  const { fetchImpl, calls } = mockOpenAiFetch();
  const { status, json, body } = await dispatchHud({}, {
    runtime: createBillingRuntime({ env: {} }),
    fetchImpl,
  });
  assert.equal(status, 200);
  assert.equal(json.summary, 'Austin skyline flights visible');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/responses$/);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVER_KEY}`);
  assert.doesNotMatch(body, new RegExp(SERVER_KEY));
});

test('hosted Free is forbidden for HUD summary; Pro is allowed', async () => {
  const free = mockOpenAiFetch();
  const denied = await dispatchHud({
    headers: { authorization: 'Bearer sess_test' },
  }, {
    runtime: hostedRuntime(),
    fetchImpl: free.fetchImpl,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, BILLING_CODES.VOICE_REQUIRES_PRO);
  assert.equal(free.calls.length, 0);

  const pro = mockOpenAiFetch();
  const allowed = await dispatchHud({
    headers: { authorization: 'Bearer sess_test' },
  }, {
    runtime: hostedRuntime({
      getUserRecord: async () => ({ publicMetadata: { meridianPlan: PLANS.PRO } }),
    }),
    fetchImpl: pro.fetchImpl,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.summary, 'Austin skyline flights visible');
});

test('HUD helpers sanitize model output to five words', () => {
  assert.equal(
    extractOpenAiResponseText({ output_text: '  Hello there, world.  ' }),
    'Hello there, world.',
  );
  assert.equal(
    toFiveWordHudSummary('Austin, Texas — flights and fires visible now!!! extra'),
    'Austin Texas flights and fires',
  );
});

test('Vercel Node entrypoints exist for token and HUD summary', () => {
  for (const file of ['api/realtime/token.js', 'api/openai/hud-summary.js']) {
    const absolute = path.join(ROOT, file);
    assert.equal(existsSync(absolute), true, `missing ${file}`);
    const source = readFileSync(absolute, 'utf8');
    assert.match(source, /src\/voice\/(vercel|openaiApi)\.js/);
    assert.doesNotMatch(source, /OPENAI_API_KEY\s*=/);
    assert.doesNotMatch(source, /sk-live|sk-test-/);
  }
  assert.equal(typeof tokenHandler, 'function');
  assert.equal(typeof hudHandler, 'function');
  assert.equal(tokenConfig.api.bodyParser, false);
  assert.equal(hudConfig.api.bodyParser, false);
  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/realtime/token.js']);
  assert.ok(vercelJson.functions['api/openai/hud-summary.js']);
  assert.equal(vercelJson.framework, 'vite');
  assert.equal(Array.isArray(vercelJson.rewrites), false);
});

test('client sources never receive OPENAI_API_KEY', () => {
  const clientFiles = [
    'src/main.js',
    'src/hud.js',
    'src/voice/gevRealtime.js',
    'src/voice/gevActions.js',
    'src/billing/client.js',
    'vite.config.js',
  ];
  for (const file of clientFiles) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /import\.meta\.env\.OPENAI_API_KEY/);
    assert.doesNotMatch(source, /VITE_OPENAI_API_KEY/);
  }
  const define = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  const defineBlock = define.slice(define.lastIndexOf('define: {'));
  assert.doesNotMatch(defineBlock, /OPENAI_API_KEY/);
});
