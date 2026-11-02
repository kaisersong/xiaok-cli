import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('real Vitest preserves structural names, regex/newline/parameter cases and natural skips across shards', {timeout:120000}, () => {
 const dir=mkdtempSync(join(tmpdir(),'xiaok-real-shards-'));
 const invoke=(...args)=>execFileSync(process.execPath,['.github/scripts/ci-plan.mjs',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try {
  assert.throws(()=>invoke('collect','.github/ci/fixture.config.mjs','.github/ci/fixtures/collision.fixture.mjs',join(dir,'collision'),'collision','1','2'));
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  for(let i=1;i<=2;i++){const path=join(dir,String(i));invoke('collect','.github/ci/fixture.config.mjs','.github/ci/fixtures/cases.fixture.mjs',path,'fixture',String(i),'2');invoke('run',path);invoke('audit',path);}
  const m=JSON.parse(readFileSync(join(dir,'1/manifest.json'),'utf8'));
  assert.equal(m.inventory.length,4);assert.equal(m.inventory.filter(x=>x.mode==='skip').length,1);assert.ok(m.inventory.some(x=>x.parts.includes('outer > label')));assert.ok(m.inventory.some(x=>x.parts.some(p=>p.includes('\n'))));
  invoke('aggregate',dir,head,'fixture','2');
  rmSync(join(dir,'2/audit.json'));assert.throws(()=>invoke('aggregate',dir,head,'fixture','2'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
