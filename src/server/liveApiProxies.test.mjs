import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleRealtimeDebugLogHttp,
  hostedWritableDir,
} from './liveApiProxies.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HOSTED_LOG_DIR = '/tmp/meridian-gev-logs';
const HOSTED_LOG_FILE = path.join(HOSTED_LOG_DIR, 'realtime-conversations.jsonl');

function mockReq({ method = 'POST', url = '/api/realtime/debug-log', body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  req.rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      if (chunk !== undefined) this.body = chunk;
    },
  };
}

test('hostedWritableDir uses /tmp on NETLIFY/VERCEL and repoRoot locally', () => {
  assert.equal(hostedWritableDir({ NETLIFY: 'true' }), HOSTED_LOG_DIR);
  assert.equal(hostedWritableDir({ VERCEL: '1' }), HOSTED_LOG_DIR);
  assert.equal(hostedWritableDir({ AWS_LAMBDA_FUNCTION_NAME: 'api' }), HOSTED_LOG_DIR);
  assert.equal(hostedWritableDir({}), path.join(ROOT, '.gev-logs'));

  const source = readFileSync(new URL('./liveApiProxies.js', import.meta.url), 'utf8');
  assert.match(source, /await handleRealtimeDebugLogHttp\(req, res\)/);
  assert.doesNotMatch(source, /REALTIME_DEBUG_LOG_DIR = path\.join\(repoRoot/);
});

test('POST {event:"qa"} is 204 and appends one jsonl line under /tmp', async () => {
  const before = existsSync(HOSTED_LOG_FILE) ? readFileSync(HOSTED_LOG_FILE, 'utf8') : '';
  const req = mockReq({ body: { event: 'qa' } });
  const res = mockRes();
  await handleRealtimeDebugLogHttp(req, res, { env: { NETLIFY: '1' } });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, undefined);
  assert.doesNotMatch(String(res.body ?? ''), /ENOENT|\/var\/task/);
  assert.equal(existsSync(HOSTED_LOG_FILE), true);

  const added = readFileSync(HOSTED_LOG_FILE, 'utf8').slice(before.length);
  const line = added.trim().split('\n').at(-1);
  const record = JSON.parse(line);
  assert.equal(record.event, 'qa');
  assert.equal(typeof record.loggedAt, 'string');
});

test('read-only repoRoot mock still 204, never ENOENT /var/task', async () => {
  const warnings = [];
  const req = mockReq({ body: { event: 'qa' } });
  const res = mockRes();
  await handleRealtimeDebugLogHttp(req, res, {
    env: {},
    root: '/var/task',
    fsImpl: {
      mkdirSync() {
        throw Object.assign(
          new Error("ENOENT: no such file or directory, mkdir '/var/task/.gev-logs'"),
          { code: 'ENOENT' },
        );
      },
      appendFileSync() {
        throw new Error('append should not run after mkdir failure');
      },
    },
    warn(...args) {
      warnings.push(args.map(String).join(' '));
    },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, undefined);
  assert.doesNotMatch(String(res.body ?? ''), /ENOENT|\/var\/task/);
  assert.doesNotMatch(JSON.stringify(res.headers), /ENOENT|\/var\/task/);
  assert.match(warnings.join('\n'), /write failed/);
  assert.notEqual(res.statusCode, 400);
});
