import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tasks, plan, score } from '../../scripts/evals/sol-pi/baseline-core.mjs';
import { createPairedPlan, summarizePaired, assertSameModel, assertFrozenContract, verifyPairedManifest, hashMap } from '../../scripts/evals/sol-pi/paired-core.mjs';

test('paired plan retains 42 runs per arm, original cases, balanced AB/BA and isolated directories', () => {
  const schedule=createPairedPlan(); assert.equal(schedule.length,84);
  for(const arm of ['legacy','candidate'])assert.deepEqual(schedule.filter(e=>e.arm===arm).map(e=>e.caseKey).sort(),plan.map(e=>e.key).sort());
  assert.equal(new Set(schedule.map(e=>e.key)).size,84);assert.equal(new Set(schedule.map(e=>e.relativeDirectory)).size,84);
  let firstLegacy=0;for(let i=0;i<84;i+=2){assert.equal(schedule[i].caseKey,schedule[i+1].caseKey);assert.notEqual(schedule[i].arm,schedule[i+1].arm);firstLegacy+=Number(schedule[i].arm==='legacy');}
  assert.equal(firstLegacy,21);assert.deepEqual(createPairedPlan(),schedule);
  for(const entry of schedule)assert.equal(entry.mechanismAvailability,entry.arm==='legacy'?'baseline':['cli','desktop'].includes(entry.surface)?'eligible':'not-ready');
});
test('missing and error results remain failures in original 42-denominator and every bucket',()=>{
  const schedule=createPairedPlan();const one=schedule.find(e=>e.arm==='candidate');
  const summary=summarizePaired([{...one,passed:true,status:'passed'}]);
  assert.equal(summary.legacy.planned,42);assert.equal(summary.candidate.planned,42);assert.equal(summary.candidate.passed,1);assert.equal(summary.legacy.passed,0);
  assert.equal(summary.candidate.cells.length,14);assert.equal(summary.legacy.cells.length,14);
  assert.equal(summary.candidate.records.length,42);assert.equal(summary.candidate.records.filter(r=>r.passed!==true).length,41);
  assert.throws(()=>summarizePaired([{...one,passed:true},{...one,passed:true}]),/duplicate/);
});
test('task, scorer and verifier contract changes reject preparation',()=>{
  const original={'baseline-core.mjs':'core-hash','baseline-sandbox.mjs':'sandbox-hash','baseline-sandbox.cjs':'verifier-hash'};
  assert.doesNotThrow(()=>assertFrozenContract(original,{...original}));
  for(const key of Object.keys(original))assert.throws(()=>assertFrozenContract(original,{...original,[key]:'changed'}),/contract/);
  assert.throws(()=>assertFrozenContract(original,{'baseline-core.mjs':'core-hash'}),/contract/);
  // The task/score functions under test remain the original production evaluator exports.
  assert.equal(tasks.length,4);assert.equal(score('qa',{execution:'resolved',unchanged:true,readFiles:['orders.json','rules.txt','context.txt'],reply:'{}'}).passed,false);
});
test('model identity comparison rejects mismatching current arms',()=>{
  const original={name:'frozen-model',harness:'generic-openai'};
  assert.doesNotThrow(()=>assertSameModel(original,{...original},{...original}));
  assert.throws(()=>assertSameModel(original,{...original,name:'changed'},original),/model/);
  assert.throws(()=>assertSameModel(original,original,{...original,harness:'changed'}),/model/);
  assert.throws(()=>assertSameModel({}, {}, {}),/model/);
});
test('manifest independently binds source trees and common harness rather than substituting runner for source',()=>{
  const files={legacy:{'src/runtime.ts':'a','bin/node':'node','node_modules/a':'deps'},candidate:{'src/runtime.ts':'b','bin/node':'node','node_modules/a':'deps'},harness:{'paired-core.mjs':'runner','baseline-core.mjs':'score'}};
  const manifest={schemaVersion:9,schedule:createPairedPlan(),sourceHashes:{legacy:hashMap(files.legacy),candidate:hashMap(files.candidate)},harnessHash:hashMap(files.harness),taskSpecHash:createHash('sha256').update(JSON.stringify(tasks)).digest('hex')};
  assert.equal(verifyPairedManifest(manifest,files),true);
  assert.equal(verifyPairedManifest({...manifest,schemaVersion:7},files),false);
  assert.equal(verifyPairedManifest(manifest,{...files,candidate:files.legacy}),false);
  assert.equal(verifyPairedManifest(manifest,{...files,harness:{...files.harness,'paired-core.mjs':'altered'}}),false);
  assert.equal(verifyPairedManifest({...manifest,schedule:createPairedPlan().slice(1)},files),false);
  assert.equal(verifyPairedManifest({...manifest,taskSpecHash:'changed'},files),false);
});

test('unqualified observations cannot be promoted by result metadata',()=>{
 const entry=createPairedPlan().find(e=>e.arm==='candidate');
 const result=summarizePaired([{...entry,surface:'fake',mechanismAvailability:'qualified-experiment',passed:false}]);
 assert.equal(result.candidate.wiringQualified,0);assert.equal(result.candidate.records[0].surface,entry.surface);
});

test('prepare checker rejects altered manifest before loading any source or credentials',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {checkPrepared}=await import('../../scripts/evals/sol-pi/paired-run.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'solpi-paired-'));
 try{await fs.writeFile(path.join(dir,'manifest.json'),'{}');await fs.writeFile(path.join(dir,'manifest.sha256'),'changed');await assert.rejects(checkPrepared(dir),/prepared-manifest-drift/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('prepare-stage worker refuses execution before importing production or calling models',async()=>{
 const {spawnSync}=await import('node:child_process');
 const run=spawnSync(process.execPath,['scripts/evals/sol-pi/paired-worker.mjs'],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/SOLPI_PAIRED_HOST_LAUNCH_REQUIRED/);
});
test('worker result validation binds exact paired identity and rejects clean-looking result on timeout',async()=>{
 const {validatePairedResult}=await import('../../scripts/evals/sol-pi/paired-core.mjs');const entry=createPairedPlan()[0];
 const raw=JSON.stringify({...entry,passed:true,status:'passed'});
 assert.equal(validatePairedResult(entry,raw,'completed').passed,true);
 assert.equal(validatePairedResult(entry,raw,'timeout').passed,false);
 assert.throws(()=>validatePairedResult(entry,JSON.stringify({...entry,arm:'tampered',passed:true}),'completed'),/identity/);
 assert.throws(()=>validatePairedResult(entry,'{}','completed'),/identity/);
});
test('paired entry writer preserves original verifier exact serialization',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {writePairedFixture}=await import('../../scripts/evals/sol-pi/paired-run.mjs');const {verifyInitialTaskDirectory}=await import('../../scripts/evals/sol-pi/baseline-core.mjs');const entry=createPairedPlan()[0],task=tasks.find(t=>t.id===entry.taskId),dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'solpi-fixture-')));
 try{await writePairedFixture(dir,entry,task);assert.equal(await verifyInitialTaskDirectory(dir,entry,task),true);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('live environment requires system sleep assertion and rejects sleep during measured interval',async()=>{
 const {assessSleepEnvironment}=await import('../../scripts/evals/sol-pi/paired-core.mjs');
 const start=Date.parse('2026-09-18T10:00:00+08:00'),end=start+60000;
 assert.equal(assessSleepEnvironment('PreventSystemSleep 1','',start,end).valid,true);
 assert.equal(assessSleepEnvironment('PreventUserIdleSystemSleep 1','',start,end).valid,false);
 assert.equal(assessSleepEnvironment('PreventSystemSleep 1','2026-09-18 10:00:20 +0800 Sleep Entering Sleep state',start,end).valid,false);
 assert.equal(assessSleepEnvironment('PreventSystemSleep 1','2026-09-18 09:00:20 +0800 Sleep Entering Sleep state',start,end).valid,true);
});
