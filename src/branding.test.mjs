import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walkJsFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJsFiles(absolute, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

function userAgentLiterals(source) {
  return [
    ...source.matchAll(/'User-Agent'\s*:\s*'([^']+)'/g),
    ...source.matchAll(/[A-Z_]*USER_AGENT\s*=\s*'([^']+)'/g),
  ].map((match) => match[1]);
}

function productUserAgent(value) {
  return value.replace(/\+?https:\/\/github\.com\/\S+/g, '');
}

test('LICENSE keeps the required MIT copyright line', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});

test('UI title stays Meridian', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<title>Meridian<\/title>/);
});

test('window runtime handle is __meridian with a silent one-release alias', () => {
  const main = readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  assert.match(main, /window\.__meridian\s*=/);
  assert.match(main, /window\.__godsEyeView\s*=\s*window\.__meridian/);
});

test('proxy User-Agents identify as Meridian, not God\'s Eye View', () => {
  const files = walkJsFiles(path.join(ROOT, 'src'))
    .filter((file) => !file.endsWith('.test.mjs'));
  const agents = files.flatMap((file) => userAgentLiterals(readFileSync(file, 'utf8')));
  assert.ok(agents.length >= 6, `expected proxy User-Agents, found ${agents.length}`);
  for (const agent of agents) {
    const product = productUserAgent(agent);
    assert.match(product, /Meridian|meridian/);
    assert.doesNotMatch(product, /gods-eye-view/i);
    assert.doesNotMatch(product, /God's Eye View/);
    assert.doesNotMatch(product, /godsEyeView/);
  }
});

test('runtime sources do not write new godsEyeView.* keys', () => {
  const files = walkJsFiles(path.join(ROOT, 'src'))
    .filter((file) => !file.endsWith('.test.mjs') && !file.endsWith('prefStorage.js'));
  const writers = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (/setItem\([^)]*godsEyeView\./.test(source) || /writePrefKey\([^)]*godsEyeView\./.test(source)) {
      writers.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(writers, []);
});
