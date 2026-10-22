import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecorder,LOADER_PREFIX} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-core.mjs';
import {TARGETS} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-loader.mjs';
import {verifyObservation} from './loop-read-error-diagnostic-verify.mjs';
const head='c'.repeat(40),moduleId='b'.repeat(64);
function protocolFixture(){
 const lines=TARGETS.map(t=>LOADER_PREFIX+JSON.stringify({schemaVersion:1,site:t.site,sourceSha256:t.sha256,transformedSha256:'d'.repeat(64),recorderModuleIdSha256:moduleId}));
 const recorder=createRecorder({pid:123,nonce:'a'.repeat(32),moduleIdSha256:moduleId,now:()=>12.5,writeLine:line=>lines.push(line)});
 for(const site of ['reader','consumer','output'])recorder.siteLoaded(site);
 for(const mode of ['terminal','lost-dispatch','publication-lost-ack','full-projection','desktop-service','timed-pending','timed-expired','output-consumer'])lines.push('[loop-controller-stage] '+JSON.stringify({mode,stage:'scenario-finally-complete',elapsedMs:12}));
 recorder.health();lines.push('Test Files  1 failed (1)','Tests  1 failed | 7 passed (8)');
 const job={id:123,head_sha:head,status:'completed',conclusion:'failure',run_attempt:1,steps:[{name:'Verify temporary Loop diagnostic guards',status:'completed',conclusion:'success'},{name:'Test complete signed Loop controller paths and cleanup with temporary diagnostic',status:'completed',conclusion:'failure'}]};
 return {raw:lines.join('\n')+'\n',job};
}
test('full protocol decoder keeps complete observation separate from original business failure',()=>{
 const f=protocolFixture(),value=verifyObservation(f.raw,f.job,head);
 assert.deepEqual(value.problems,[]);assert.equal(value.observationComplete,true);
 assert.equal(value.normalQualified,false);assert.equal(value.originalBusinessConclusion,'failure');
});
test('full protocol decoder rejects missing original finally, filtered population, hook timeout and wrong terminal binding',()=>{
 for(const change of [
  f=>{f.raw=f.raw.replace(/.*"mode":"terminal".*\n/,'');},
  f=>{f.raw=f.raw.replace('7 passed (8)','6 passed | 1 skipped (8)');},
  f=>{f.raw+='Hook timed out in 10000ms\n';},
  f=>{f.job.head_sha='e'.repeat(40);},
  f=>{f.job.status='in_progress';},
  f=>{f.job.id=0;},
  f=>{f.job.steps[1].conclusion='success';},
  f=>{f.raw=f.raw.replace('1 failed | 7 passed (8)','8 passed (8)').replace('Test Files  1 failed','Test Files  1 passed');},
  f=>{f.job.conclusion='success';},
  f=>{f.job.steps={};},
  f=>{f.raw=f.raw.replace(/XIAOK_LOOP_READ_DIAGNOSTIC_LOADER .*\n/,'XIAOK_LOOP_READ_DIAGNOSTIC_LOADER null\n');},
  f=>{f.job.steps[0].conclusion='failure';},
  f=>{f.raw=f.raw.replace('Test Files  1 failed (1)','Test Files  1 failed | 1 skipped (2)');},
  f=>{f.raw=f.raw.replace('"site":"consumer"','"site":"consumer","extra":true');},
 ]){const f=protocolFixture();change(f);assert.equal(verifyObservation(f.raw,f.job,head).observationComplete,false);}
});
