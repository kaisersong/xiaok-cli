import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDocsOnly, changedPaths, partitionCases, canonicalName, auditCases, auditReceipt, digest, groupShardCounts } from '../scripts/ci-plan.mjs';
test('only PR prose in explicit documentation locations may skip execution', () => {
  for (const files of [['README.md'], ['README.zh-CN.md','docs/design/plan.md']]) assert.equal(isDocsOnly(files,'pull_request'),true);
  for (const path of ['package-lock.json','desktop/package-lock.json','.github/workflows/governance.yml','.github/scripts/ci-plan.mjs','vitest.config.ts','desktop/vitest.config.ts','src/ai/prompts/README.md','skills/foo.md','docs','docs/tool.mjs','AGENTS.md','README.md\ncode.ts']) assert.equal(isDocsOnly(['README.md',path],'pull_request'),false,path);
  for (const event of ['push','merge_group','workflow_dispatch']) assert.equal(isDocsOnly(['README.md'],event),false);
  assert.equal(isDocsOnly([],'pull_request'),false);
});
test('real git diff sees both sides of rename, removal, and rejects missing revisions', () => {
 const root=mkdtempSync(join(tmpdir(),'xiaok-ci-plan-'));const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {git('init');git('config','user.name','CI fixture');git('config','user.email','ci@example.invalid');writeFileSync(join(root,'runtime.ts'),'x');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');renameSync(join(root,'runtime.ts'),join(root,'README.md'));git('add','.');git('commit','-m','rename');const head=git('rev-parse','HEAD');assert.deepEqual(new Set(changedPaths(base,head,root)),new Set(['README.md','runtime.ts']));assert.equal(isDocsOnly(changedPaths(base,head,root),'pull_request'),false);assert.throws(()=>changedPaths('bad',head,root));}
 finally {rmSync(root,{recursive:true,force:true});}
});
test('case shards are exhaustive, disjoint, deterministic and reject duplicate names', () => {
 const inventory=Array.from({length:80},(_,i)=>({parts:['suite',`test ${i}`],mode:'run'}));const parts=partitionCases(inventory,3);
 assert.ok(Math.max(...parts.map(p=>p.length))-Math.min(...parts.map(p=>p.length))<=1);
 assert.equal(parts.flat().length,80);assert.equal(new Set(parts.flat()).size,80);assert.deepEqual(parts,partitionCases(inventory,3));
 assert.equal(canonicalName({parts:['suite','test 0']}),'suite test 0');assert.throws(()=>partitionCases([],3));assert.throws(()=>partitionCases(inventory,0));assert.throws(()=>partitionCases([...inventory,inventory[0]],3));assert.throws(()=>partitionCases([{parts:['a b','c'],mode:'run'},{parts:['a','b c'],mode:'run'}],3));
});
test('report audit rejects missing, duplicate, or unexpectedly executed cases', () => {
 const report={testResults:[{assertionResults:[{fullName:'suite a',status:'passed'},{fullName:'suite b',status:'skipped'}]}]};
 auditCases(['suite a'],report);
 assert.throws(()=>auditCases(['suite a'],{testResults:[{assertionResults:[{fullName:'suite a',status:'passed'},{fullName:'suite b',status:'pending'}]}]}));
 assert.throws(()=>auditCases(['suite b'],{testResults:[{assertionResults:[{fullName:'suite b',status:'pending'}]}]},[{parts:['suite','b'],mode:'skip'}]));assert.throws(()=>auditCases(['suite missing'],report));assert.throws(()=>auditCases(['suite a'],{testResults:[{assertionResults:[{fullName:'suite a',status:'passed'},{fullName:'suite b',status:'passed'}]}]}));
});

test('complete results cannot hide missing, stale or abnormal process termination', () => {
 const manifest={head:'head',inventoryHash:'inventory',selected:['suite a']};
 const report={numFailedTests:0,numFailedTestSuites:0};
 const receipt={head:'head',inventoryHash:'inventory',selectedHash:digest(manifest.selected),exitCode:0,signal:null,error:null};
 auditReceipt(manifest,report,receipt);
 for(const invalid of [undefined,{...receipt,signal:'SIGTERM'},{...receipt,error:'spawn error'},{...receipt,head:'stale'},{...receipt,exitCode:1},{...receipt,exitCode:2}])assert.throws(()=>auditReceipt(manifest,report,invalid));
 auditReceipt(manifest,{...report,numFailedTests:1},{...receipt,exitCode:1});
});

test('per-platform shard counts reject invalid and duplicate groups', () => {
 assert.deepEqual(groupShardCounts(['linux:1','windows:3','mac:2'],3),[{group:'linux',total:1},{group:'windows',total:3},{group:'mac',total:2}]);
 for(const groups of [['linux:0'],['linux:NaN'],['linux:2','linux:1'],['linux:1.5'],[':1']])assert.throws(()=>groupShardCounts(groups,3));
});
