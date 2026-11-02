#!/usr/bin/env node
/**
 * Single source for CI: parse KIMI_CODING_PROFILES keys from
 * src/ai/providers/kimi-models.ts without compiling TypeScript.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = join(root, 'src/ai/providers/kimi-models.ts');

export function readKimiCodingModels(sourcePath = DEFAULT_SOURCE) {
  const text = readFileSync(sourcePath, 'utf8');
  const match = text.match(
    /export\s+const\s+KIMI_CODING_PROFILES\s*=\s*Object\.freeze\(\s*\{([\s\S]*?)\}\s*as\s+const\s*\)/,
  );
  if (!match) {
    throw new Error(`KIMI_CODING_PROFILES object not found in ${sourcePath}`);
  }
  const models = [];
  for (const line of match[1].split('\n')) {
    const key = line.match(/^\s*['"]([^'"]+)['"]\s*:/);
    if (key) models.push(key[1]);
  }
  if (models.length === 0) {
    throw new Error(`KIMI_CODING_PROFILES has no model keys in ${sourcePath}`);
  }
  return models;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const models = readKimiCodingModels(process.argv[2]);
  process.stdout.write(`${JSON.stringify(models)}\n`);
}
