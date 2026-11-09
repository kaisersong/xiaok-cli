import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const repo=resolve(import.meta.dirname,'../..');
const modules=['harness-optimization-store-worker.mjs','harness-dsh-budget-data.mjs','harness-dsh-budget-ledger.mjs','harness-dsh-work-escrow.mjs','harness-dsh-source-read-budget.mjs','harness-dsh-budget-conservative.mjs','harness-dsh-account-revision.mjs','harness-dsh-account-epoch.mjs','harness-dsh-draft-usage.mjs','harness-dsh-worker-initialize.mjs'];
function fixture(missing){
 const root=mkdtempSync(join(tmpdir(),'copy-harness-draft-usage-'));
 mkdirSync(join(root,'scripts'),{recursive:true});mkdirSync(join(root,'desktop/electron'),{recursive:true});
 copyFileSync(join(repo,'scripts/copy-harness-runtime.mjs'),join(root,'scripts/copy-harness-runtime.mjs'));
 mkdirSync(join(root,'native/protected-sqlite-facade'),{recursive:true});
 copyFileSync(join(repo,'native/protected-sqlite-facade/index.cjs'),join(root,'native/protected-sqlite-facade/index.cjs'));
 for(const name of modules)if(name!==missing)copyFileSync(join(repo,'desktop/electron',name),join(root,'desktop/electron',name));
 return {root,run:()=>spawnSync(process.execPath,[join(root,'scripts/copy-harness-runtime.mjs')],{cwd:root,encoding:'utf8',timeout:10000})};
}
test('production harness copy carries the actual worker and every draft-usage dependency byte for byte',()=>{
 const f=fixture();
 try{
  const destination=join(f.root,'desktop/dist/main/desktop/electron');mkdirSync(destination,{recursive:true});
  writeFileSync(join(destination,'root_resource_authority_main.node'),'stale native fixture');
  const result=f.run();assert.equal(result.status,0,result.stderr);
  for(const name of modules)assert.deepEqual(readFileSync(join(destination,name)),readFileSync(join(repo,'desktop/electron',name)));
  assert.equal(existsSync(join(destination,'root_resource_authority_main.node')),false);
 }finally{rmSync(f.root,{recursive:true,force:true,maxRetries:3});}
});
test('production harness copy fails rather than shipping a worker with the final-usage module absent',()=>{
 const f=fixture('harness-dsh-draft-usage.mjs');
 try{const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/harness-dsh-draft-usage\.mjs/);}
 finally{rmSync(f.root,{recursive:true,force:true,maxRetries:3});}
});

test('production copy rejects an absent account epoch implementation',()=>{
 const f=fixture('harness-dsh-account-epoch.mjs');
 try{const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/harness-dsh-account-epoch\.mjs/);}
 finally{rmSync(f.root,{recursive:true,force:true,maxRetries:3});}
});
