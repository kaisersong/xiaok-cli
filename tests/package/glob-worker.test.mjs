import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerEmittedGlobContract } from './support/glob-worker-contract.mjs';
import { globTool } from '../../dist/ai/tools/glob.js';

test('CLI built worker matches source bytes and executes with the built tool', async () => {
  assert.deepEqual(readFileSync(new URL('../../dist/ai/tools/glob-worker.mjs', import.meta.url)), readFileSync(new URL('../../src/ai/tools/glob-worker.mjs', import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-glob-package-'));
  try {
    writeFileSync(join(dir, 'expected.txt'), '');
    assert.equal(await globTool.execute({path:dir,pattern:'*.txt'}), join(dir, 'expected.txt').replace(/\\/g, '/'));
  } finally { rmSync(dir, {recursive:true,force:true,maxRetries:3}); }
});

registerEmittedGlobContract('CLI', new URL('../../dist/ai/tools/bounded-glob.js', import.meta.url));
