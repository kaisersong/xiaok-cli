import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('original native lock and successful lifecycle prepare alone brand the budget Worker birth; copies and restored mutations remain rejected',{skip:process.platform!=='darwin'},async()=>{
 const root=mkdtempSync(join(tmpdir(),'budget-birth-'));mkdirSync(join(root,'config'),{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const sources=['desktop/electron/harness-optimization-lifecycle.ts','desktop/electron/harness-optimization-owner-lock.ts','native/harness-optimization-owner-lock/owner_lock.c'];
 const hash=p=>createHash('sha256').update(readFileSync(join(repo,p))).digest('hex');const before=Object.fromEntries(sources.map(p=>[p,hash(p)]));
 const headers=process.env.XIAOK_NATIVE_NODE_HEADERS||resolve(dirname(process.execPath),'../include/node');
 const built=spawnSync('/usr/bin/cc',['-std=c11','-Werror','-bundle','-undefined','dynamic_lookup','-I',headers,join(repo,sources[2]),'-o',join(root,'harness_owner_lock.node')],{encoding:'utf8'});
 writeFileSync(join(root,'build.json'),JSON.stringify({pid:built.pid,code:built.status,signal:built.signal,stderr:built.stderr},null,2));assert.equal(built.status,0,built.stderr);
 const file=join(root,'source.mjs');await build({stdin:{contents:`export * from ${JSON.stringify(join(repo,sources[0]))}; export * from ${JSON.stringify(join(repo,sources[1]))};`,resolveDir:repo,sourcefile:'fixed-budget-birth.ts',loader:'ts'},bundle:true,format:'esm',platform:'node',target:'node22',outfile:file,logLevel:'silent'});
 assert.deepEqual(Object.fromEntries(sources.map(p=>[p,hash(p)])),before);writeFileSync(join(root,'source-hashes.json'),JSON.stringify(before,null,2));
 const actual=await import(pathToFileURL(file).href);assert.equal(typeof actual.readOriginalHarnessBudgetWorkerBirth,'function');assert.equal(typeof actual.readOriginalHarnessOwnerLock,'function');
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw undefined;},ownKeys(){traps++;throw undefined;},getPrototypeOf(){traps++;throw undefined;}});
 assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth(proxy),/original_budget_worker_birth_required/);assert.throws(()=>actual.readOriginalHarnessOwnerLock(proxy),/original_owner_lock_required/);assert.equal(traps,0);
 const lock=actual.acquireHarnessOwnerLock(join(root,'owner'));let returned;
 try{
  const lifecycle=new actual.HarnessOptimizationLifecycle(lock);const prepared=await lifecycle.prepare();returned=actual.readOriginalHarnessBudgetWorkerBirth(prepared);assert.equal(returned.ownerId,prepared.witness.ownerId);assert.equal(returned.root,lock.root);assert.equal(returned.initializing,true);returned.assertLocal();
  assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth({...prepared}),/original_budget_worker_birth_required/);
  const original=prepared.witness.ownerId;Object.defineProperty(prepared.witness,'ownerId',{get(){traps++;throw undefined;},configurable:true});assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth(prepared),/original_budget_worker_birth_changed/);assert.equal(traps,0);
  Object.defineProperty(prepared.witness,'ownerId',{value:original,configurable:true,writable:true,enumerable:true});assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth(prepared),/original_budget_worker_birth_changed/);
  const fresh=await lifecycle.prepare();actual.readOriginalHarnessBudgetWorkerBirth(fresh).assertLocal();lock.release();assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth(fresh),/owner_lock_lost/);
 }finally{lock.release();}
 const changedLock=actual.acquireHarnessOwnerLock(join(root,'changed-owner'));const originalRoot=changedLock.root,releaseChanged=changedLock.release;
 try{
  Object.defineProperty(changedLock,'root',{get(){traps++;throw undefined;},configurable:true});
  assert.throws(()=>actual.readOriginalHarnessOwnerLock(changedLock),/original_owner_lock_changed/);
  assert.throws(()=>new actual.HarnessOptimizationLifecycle(changedLock),/original_owner_lock_changed/);assert.equal(traps,0);
  Object.defineProperty(changedLock,'root',{value:originalRoot,writable:true,configurable:true,enumerable:true});
  assert.throws(()=>actual.readOriginalHarnessOwnerLock(changedLock),/original_owner_lock_changed/);
 }finally{releaseChanged();}
 const iteratorLock=actual.acquireHarnessOwnerLock(join(root,'iterator-owner'));
 try{
  const lifecycle=new actual.HarnessOptimizationLifecycle(iteratorLock);const prepared=await lifecycle.prepare();
  const originalIterator=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator);let iteratorTraps=0,rawFailure;
  Object.defineProperty(Array.prototype,Symbol.iterator,{get(){iteratorTraps++;throw undefined;},configurable:true});
  try{actual.readOriginalHarnessOwnerLock(iteratorLock);actual.readOriginalHarnessBudgetWorkerBirth(prepared);}catch(raw){rawFailure={raw};}
  finally{Object.defineProperty(Array.prototype,Symbol.iterator,originalIterator);}
  assert.equal(iteratorTraps,0);assert.equal(rawFailure,undefined);
 }finally{iteratorLock.release();}
 const fakeRoot=join(root,'fake');mkdirSync(fakeRoot,{mode:0o700});const fake={root:fakeRoot,identity:'fake:inode',held:()=>true,release(){}};const fakeLifecycle=new actual.HarnessOptimizationLifecycle(fake);const fakePrepared=await fakeLifecycle.prepare();assert.throws(()=>actual.readOriginalHarnessBudgetWorkerBirth(fakePrepared),/original_budget_worker_birth_required/);
 const facts={kind:'original-budget-worker-birth',root,proxyTraps:traps,copiedDenied:true,restoredMutationDenied:true,actualNativeLockClosed:true,gui:0,productionQualified:false};writeFileSync(join(root,'facts.json'),JSON.stringify(facts,null,2));console.log(JSON.stringify(facts));
});
