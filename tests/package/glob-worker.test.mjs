import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globTool } from '../../dist/ai/tools/glob.js';
import { grepTool } from '../../dist/ai/tools/grep.js';
import { createSandboxPolicy } from '../../dist/platform/sandbox/policy.js';
import { createSandboxEnforcer } from '../../dist/platform/sandbox/enforcer.js';
import { applySandboxToTools } from '../../dist/platform/sandbox/tool-wrappers.js';

test('CLI built worker matches source bytes and executes with the built tool', async () => {
  assert.deepEqual(readFileSync(new URL('../../dist/ai/tools/glob-worker.mjs', import.meta.url)), readFileSync(new URL('../../src/ai/tools/glob-worker.mjs', import.meta.url)));
  assert.deepEqual(readFileSync(new URL('../../dist/ai/tools/search-scope.mjs', import.meta.url)), readFileSync(new URL('../../src/ai/tools/search-scope.mjs', import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-glob-package-'));
  try {
    writeFileSync(join(dir, 'expected.txt'), '');
    assert.equal(await globTool.execute({path:dir,pattern:'*.txt'}), join(dir, 'expected.txt').replace(/\\/g, '/'));
  } finally { rmSync(dir, {recursive:true,force:true,maxRetries:3}); }
});

test('built scoped grep uses the packaged worker and preserves positive and denied paths', async () => {
  const dir=mkdtempSync(join(tmpdir(),'xiaok-scoped-grep-package-'));
  try {
    const allowed=join(dir,'allowed'),denied=join(allowed,'denied');mkdirSync(denied,{recursive:true});
    writeFileSync(join(allowed,'public.txt'),'PUBLIC_MATCH');writeFileSync(join(denied,'private.txt'),'PRIVATE_MATCH');
    const [tool]=applySandboxToTools([grepTool],createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[allowed],pathDenylist:[denied],network:'deny'})));
    const result=await tool.execute({path:allowed,pattern:'MATCH'});
    assert.match(result,/PUBLIC_MATCH/);assert.doesNotMatch(result,/PRIVATE_MATCH/);
    assert.match(await tool.execute({path:dir,pattern:'MATCH'}),/denied/);
  } finally {rmSync(dir,{recursive:true,force:true,maxRetries:3});}
});
