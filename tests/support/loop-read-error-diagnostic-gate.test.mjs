import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {runOwnedChild} from './loop-read-error-diagnostic-child.mjs';
import {
  TARGETS,
  createDiagnosticPlugin,
  instrumentSource,
  restoreSource,
} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-loader.mjs';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));

test('reader settlement wraps the exact original disposer statement and preserves its error priority',()=>{
 const target=TARGETS.find(value=>value.site==='reader');
 const original=readFileSync(resolve(repo,target.path),'utf8');
 const client='/fixed/loop-read-error-diagnostic-client.mjs';
 const changed=instrumentSource(target.path,original,client);
 const disposal='let __loopReadDiagnosticCleanupFailed=true;\n  try{try{publisher?.dispose();}finally{application?.dispose();}__loopReadDiagnosticCleanupFailed=false;}finally{__loopReadDiagnostic.readerSettled(__loopReadDiagnosticReader,__loopReadDiagnosticCleanupFailed);}';
 assert.equal(changed.split(disposal).length,2);
 assert.equal(restoreSource(target.path,changed,client),original);
 const execute=Function('__loopReadDiagnostic','__loopReadDiagnosticReader','publisher','application',disposal);
 function outcome(publisherError,applicationError){
  const calls=[];
  const publisher={dispose(){calls.push('publisher');if(publisherError)throw Error('publisher');}};
  const application={dispose(){calls.push('application');if(applicationError)throw Error('application');}};
  const recorder={readerSettled(_token,cleanupFailed){calls.push(`settled:${cleanupFailed}`);}};
  let error=null;try{execute(recorder,{},publisher,application);}catch(reason){error=reason.message;}
  return {calls,error};
 }
 assert.deepEqual(outcome(false,false),{calls:['publisher','application','settled:false'],error:null});
 assert.deepEqual(outcome(true,false),{calls:['publisher','application','settled:true'],error:'publisher'});
 assert.deepEqual(outcome(true,true),{calls:['publisher','application','settled:true'],error:'application'});
});

test('loader receipt failure is assembly failure and does not mark the site loaded',()=>{
 let calls=0,receipt;
 const plugin=createDiagnosticPlugin({repoRoot:repo,mode:'1',onLoaderReceipt(value){calls++;receipt=value;if(calls===1)throw Error('controlled');}});
 const target=TARGETS[0];
 const id=resolve(repo,target.path);
 assert.throws(()=>plugin.load(id),/loop_read_error_diagnostic_assembly/);
 assert.ok(plugin.load(id));
 assert.equal(calls,2);
 assert.deepEqual(Object.keys(receipt).sort(),['recorderModuleIdSha256','schemaVersion','site','sourceSha256','transformedSha256']);
 assert.equal(receipt.schemaVersion,1);
 assert.equal(receipt.site,target.site);
 assert.equal(receipt.sourceSha256,target.sha256);
 for(const key of ['recorderModuleIdSha256','sourceSha256','transformedSha256'])assert.match(receipt[key],/^[a-f0-9]{64}$/);
});

test('attempt gate accepts only first-attempt GitHub push and pull request events',async()=>{
 const attempt=resolve(repo,'tests/support/loop-read-error-diagnostic-attempt.mjs');
 const evidence=resolve(repo,'.xiaok/evals/pi-durable/remediation-20261022');mkdirSync(evidence,{recursive:true});
 const base={...process.env,XIAOK_LOOP_READ_ERROR_DIAGNOSTIC:'1',GITHUB_ACTIONS:'true',GITHUB_RUN_ATTEMPT:'1'};
 async function status(label,overrides){
  const root=realpathSync(mkdtempSync(join(evidence,`loop-read-gate-${label}-`)));
  const row=await runOwnedChild({argv:[process.execPath,attempt],cwd:repo,env:{...base,...overrides},logPath:join(root,'child.log'),metadataPath:join(root,'child.json'),budgetMs:5000});
  assert.equal(row.reaped,true);assert.equal(row.signal,null);assert.deepEqual(row.groupResidual,[]);assert.deepEqual(row.errors,[]);
  return row.code;
 }
 assert.equal(await status('push',{GITHUB_EVENT_NAME:'push'}),0);
 assert.equal(await status('pull-request',{GITHUB_EVENT_NAME:'pull_request'}),0);
 for(const [label,rejected] of [
  ['manual',{GITHUB_EVENT_NAME:'workflow_dispatch'}],
  ['schedule',{GITHUB_EVENT_NAME:'schedule'}],
  ['retry',{GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'2'}],
  ['not-actions',{GITHUB_EVENT_NAME:'push',GITHUB_ACTIONS:'false'}],
  ['bad-mode',{GITHUB_EVENT_NAME:'push',XIAOK_LOOP_READ_ERROR_DIAGNOSTIC:'0'}],
 ])assert.equal(await status(label,rejected),1);
});

test('workflow enables the diagnostic only for natural events and keeps manual tests off',()=>{
 const workflow=readFileSync(resolve(repo,'.github/workflows/desktop-cross-platform.yml'),'utf8');
 const instrumented=workflow.match(/- name: Test complete signed Loop controller paths and cleanup with temporary diagnostic[\s\S]*?(?=\n\s{6}- name:)/)?.[0]??'';
 assert.match(instrumented,/if: github\.event_name == 'push' \|\| github\.event_name == 'pull_request'/);
 assert.match(instrumented,/XIAOK_LOOP_READ_ERROR_DIAGNOSTIC: '1'/);
 assert.match(instrumented,/loop-read-error-diagnostic-attempt\.mjs/);
 const manual=workflow.match(/- name: Test complete signed Loop controller paths and cleanup with diagnostic off[\s\S]*?(?=\n\s{2}\S|$)/)?.[0]??'';
 assert.match(manual,/if: github\.event_name == 'workflow_dispatch'/);
 assert.ok(!manual.includes('XIAOK_LOOP_READ_ERROR_DIAGNOSTIC'));
 assert.ok(!manual.includes('loop-read-error-diagnostic-attempt.mjs'));
 assert.match(manual,/npm test -- --maxWorkers=1 tests\/main\/loop-verification-execution-controller\.test\.ts/);
});
