/**
 * Regression: Vite's browser build must not see Node fs from the globe
 * client graph. satGroup used to import CELESTRAK_GROUP_RE from
 * celestrak.js, which statically imports fs/promises and broke
 * `vite build` on Netlify (`promises` is not exported by
 * __vite-browser-external). naturalEarthRegions is also client-imported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const NODE_FS_SPECIFIERS = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
]);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function staticSpecifiers(source) {
  const text = stripComments(source);
  return [
    ...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...text.matchAll(/^import\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]);
}

function walkClientImportGraph(entryRelative) {
  const visited = new Set();
  const fsImporters = [];
  const queue = [path.normalize(entryRelative)];

  while (queue.length) {
    const relative = queue.pop();
    if (visited.has(relative)) continue;
    visited.add(relative);

    const absolute = path.join(ROOT, relative);
    const source = readFileSync(absolute, 'utf8');
    const dynamicFs = [...source.matchAll(
      /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/g,
    )].map((match) => match[1]).filter((specifier) => NODE_FS_SPECIFIERS.has(specifier));
    for (const specifier of dynamicFs) {
      fsImporters.push({ file: relative, specifier });
    }
    for (const specifier of staticSpecifiers(source)) {
      if (NODE_FS_SPECIFIERS.has(specifier)) {
        fsImporters.push({ file: relative, specifier });
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(relative), specifier));
      if (!resolved.endsWith('.js')) continue;
      if (resolved.split(path.sep).includes('node_modules')) continue;
      queue.push(resolved);
    }
  }

  return { visited, fsImporters };
}

test('client import graph of celestrak / naturalEarthRegions does not require fs/promises', () => {
  const main = walkClientImportGraph('src/main.js');
  const satGroup = walkClientImportGraph('src/data/satGroup.js');
  const regions = walkClientImportGraph('src/data/naturalEarthRegions.js');

  assert.equal(main.visited.has(path.normalize('src/data/satGroup.js')), true);
  assert.equal(main.visited.has(path.normalize('src/data/naturalEarthRegions.js')), true);

  const named = new Set([
    path.normalize('src/data/celestrak.js'),
    path.normalize('src/data/naturalEarthRegions.js'),
  ]);
  const offenders = [
    ...satGroup.fsImporters,
    ...regions.fsImporters,
    ...main.fsImporters.filter((entry) => named.has(entry.file)),
  ];
  assert.deepEqual(
    offenders,
    [],
    `client graph of celestrak / naturalEarthRegions must not import Node fs: ${JSON.stringify(offenders)}`,
  );
});
