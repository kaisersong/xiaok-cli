import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,lstatSync,realpathSync} from 'node:fs';
import {runOwnedChild} from './loop-read-error-diagnostic-child.mjs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createRecorder,EVENT_PREFIX,HEALTH_PREFIX,verifyTranscript} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-core.mjs';
import {parseDiagnosticMode,instrumentSource,restoreSource,TARGETS,applyExactTransforms} from '../../desktop/tests/fixtures/loop-read-error-diagnostic-loader.mjs';

const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const HOOK_PENDING_TOKEN='HOOK_AFTER_ALL_PENDING';
const HOOK_PENDING_MARKER=`${HOOK_PENDING_TOKEN} true`;
const ANSI_NUMERIC_SGR=/\x1b\[[0-9;]+m/g;
function hasUniqueHookPendingMarker(output){
 let count=0;
 for(const line of output.split('\n')){
  const normalized=line.replace(ANSI_NUMERIC_SGR,'');
  if(normalized===HOOK_PENDING_MARKER){count++;continue;}
  if(normalized===HOOK_PENDING_TOKEN||normalized.includes(`${HOOK_PENDING_TOKEN} `))return false;
 }
 return count===1;
}
function fixture(write){
 const lines=[];
 const recorder=createRecorder({pid:123,nonce:'a'.repeat(32),moduleIdSha256:'b'.repeat(64),now:()=>12.5,writeLine:write??(line=>lines.push(line))});
 for(const site of ['reader','consumer','output'])recorder.siteLoaded(site);
 return {recorder,lines,health:()=>JSON.parse(lines.find(l=>l.startsWith(HEALTH_PREFIX)).slice(HEALTH_PREFIX.length))};
}
test('diagnostic mode is exact, off by absence, and rejects every other defined value',()=>{
 assert.equal(parseDiagnosticMode(undefined),false);
 assert.equal(parseDiagnosticMode('1'),true);
 for(const value of ['', '0','true','false',' 1','1 ',null,1])assert.throws(()=>parseDiagnosticMode(value),/diagnostic_configuration/);
});
test('all three actual production sources are hash-bound and exactly reversible',()=>{
 for(const target of TARGETS){
  const original=readFileSync(resolve(repo,target.path),'utf8');
  const changed=instrumentSource(target.path,original,'/fixed/recorder-client.mjs');
  assert.notEqual(changed,original);
  assert.equal(restoreSource(target.path,changed,'/fixed/recorder-client.mjs'),original);
  assert.throws(()=>instrumentSource(target.path,original+'\n','/fixed/recorder-client.mjs'),/diagnostic_assembly/);
 }
 assert.throws(()=>applyExactTransforms('xx',[{from:'x',to:'y'}]),/diagnostic_assembly/);
 assert.throws(()=>applyExactTransforms('z',[{from:'x',to:'y'}]),/diagnostic_assembly/);
});
test('same original error has one opaque identity across reader and both actual hook sites',()=>{
 const f=fixture(),error=Error('loop_publication_read_timeout');
 const reader=f.recorder.readerBegin();
 f.recorder.waitBegin(reader,'inspect-before');f.recorder.timerFired(reader);
 f.recorder.readerFailure(reader,error);f.recorder.readerSettled(reader);
 f.recorder.consumerCatch(error);f.recorder.outputRejection('open',error);f.recorder.health();
 const events=f.lines.filter(l=>l.startsWith(EVENT_PREFIX)).map(l=>JSON.parse(l.slice(EVENT_PREFIX.length)));
 assert.equal(new Set(events.map(e=>e.errorId)).size,1);
 assert.ok(events.every(e=>e.errors[0].code==='loop_publication_read_timeout'));
 assert.equal(f.health().readerFailed,1);assert.equal(f.health().activeReaderCount,0);
 assert.equal(verifyTranscript(f.lines.join('\n')+'\n').complete,true);
});
test('getters, proxy traps and prototype toJSON are never executed or disclosed',()=>{
 let invoked=0;
 const error=Object.create(null);
 Object.defineProperty(error,'message',{get(){invoked++;throw Error('secret getter');}});
 const proxy=new Proxy({}, {get(){invoked++;throw Error('secret proxy');},ownKeys(){invoked++;throw Error('secret proxy');},getOwnPropertyDescriptor(){invoked++;throw Error('secret proxy');}});
 const old=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
 const f=fixture();
 try{
  Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){invoked++;throw Error('secret prototype');}});
  f.recorder.consumerCatch(error);f.recorder.outputRejection('open',proxy);f.recorder.consumerCatch(Error('private-user-path-or-payload'));
  f.recorder.health();
 }finally{if(old)Object.defineProperty(Object.prototype,'toJSON',old);else delete Object.prototype.toJSON;}
 assert.equal(invoked,0);
 assert.ok(!f.lines.join('').includes('private-user-path-or-payload'));
 assert.ok(!f.lines.join('').includes('secret'));
 assert.equal(f.health().incomplete,true);
 assert.equal(verifyTranscript(f.lines.join('\n')+'\n').complete,false);
});
test('output failure cannot throw into the original path and is visible in final health',()=>{
 const lines=[];let broken=true;
 const f=fixture(line=>{if(broken)throw Error('controlled output fault');lines.push(line);});
 const original=Error('loop_output_changed');
 assert.doesNotThrow(()=>f.recorder.outputRejection('open',original));broken=false;
 assert.doesNotThrow(()=>f.recorder.health());
 const receipt=JSON.parse(lines[0].slice(HEALTH_PREFIX.length));
 assert.ok(receipt.observerErrors>0);assert.equal(verifyTranscript(lines.join('\n')+'\n').complete,false);
});
test('afterAll-like health with unfinished reader is unknown, and later settlement is a veto',()=>{
 const f=fixture(),reader=f.recorder.readerBegin();f.recorder.health();
 assert.equal(f.health().activeReaderCount,1);
 assert.equal(verifyTranscript(f.lines.join('\n')+'\n').complete,false);
 f.recorder.readerSettled(reader);
 assert.equal(JSON.parse(f.lines.at(-1).slice(EVENT_PREFIX.length)).kind,'late-event');
 assert.equal(verifyTranscript(f.lines.join('\n')+'\n').complete,false);
});
test('receipt cannot hide missing lines, changed bytes, or capacity overflow',()=>{
 const f=fixture();f.recorder.consumerCatch(Error('loop_output_changed'));f.recorder.health();
 const good=f.lines.join('\n')+'\n';assert.equal(verifyTranscript(good).complete,true);
 assert.equal(verifyTranscript(f.lines.filter(l=>!l.startsWith(EVENT_PREFIX)).join('\n')+'\n').complete,false);
 assert.equal(verifyTranscript(good.replace('loop_output_changed','loop_output_closed')).complete,false);
 const health=f.health();
 assert.equal(health.eventsSha256,createHash('sha256').update(f.lines.filter(l=>l.startsWith(EVENT_PREFIX)).map(l=>l+'\n').join('')).digest('hex'));
 const over=fixture();for(let i=0;i<300;i++)over.recorder.consumerCatch(Error('loop_output_changed'));over.recorder.health();
 assert.ok(over.health().dropped>0);assert.equal(verifyTranscript(over.lines.join('\n')+'\n').complete,false);
});
test('hook pending marker accepts one whole line with only numeric SGR decoration',()=>{
 assert.equal(hasUniqueHookPendingMarker(`${HOOK_PENDING_MARKER}\n`),true);
 assert.equal(hasUniqueHookPendingMarker(`\x1b[22m\x1b[39mHOOK_AFTER_ALL_PENDING \x1b[33mtrue\x1b[39m\n`),true);
 assert.equal(hasUniqueHookPendingMarker(`\x1b[1;33m${HOOK_PENDING_MARKER}\x1b[0;39m\n`),true);
 for(const output of [
  'HOOK_AFTER_ALL_PENDING false\n',
  `${HOOK_PENDING_MARKER}\n${HOOK_PENDING_MARKER}\n`,
  `${HOOK_PENDING_MARKER}\nHOOK_AFTER_ALL_PENDING false\n`,
  `HOOK_AFTER_ALL_PENDING\n${HOOK_PENDING_MARKER}\n`,
  `prefix HOOK_AFTER_ALL_PENDING false\n${HOOK_PENDING_MARKER}\n`,
  `HOOK_AFTER_ALL_PENDING true suffix\n${HOOK_PENDING_MARKER}\n`,
  `prefix ${HOOK_PENDING_MARKER}\n`,
  `${HOOK_PENDING_MARKER} suffix\n`,
  `\x1b[2J${HOOK_PENDING_MARKER}\n`,
  `\x1b]0;title\x07${HOOK_PENDING_MARKER}\n`,
  `\x1b[m${HOOK_PENDING_MARKER}\n`,
  `\x1b[38:5:1m${HOOK_PENDING_MARKER}\n`,
 ])assert.equal(hasUniqueHookPendingMarker(output),false);
});
test('actual Vitest finished-hook timeout reaches afterAll with original promise still pending',async(t)=>{
 const base=join(repo,'.xiaok/evals/pi-durable/remediation-20261022');mkdirSync(base,{recursive:true});
 const root=realpathSync(mkdtempSync(join(base,'loop-read-hook-fixture-'))),s=lstatSync(root);
 const identity={root,pid:process.pid,parentPid:process.ppid,dev:s.dev,ino:s.ino,uid:s.uid,birthtimeMs:s.birthtimeMs};
 writeFileSync(join(root,'identity.json'),JSON.stringify(identity,null,2));
 const client=resolve(repo,'desktop/tests/fixtures/loop-read-error-diagnostic-client.mjs').replace(/\\/g,'/');
 writeFileSync(join(root,'case.test.mjs'),`import {it,afterAll,onTestFinished} from 'vitest';\nimport {loopReadDiagnostic as diag} from ${JSON.stringify(client)};\nfor(const site of ['reader','consumer','output'])diag.siteLoaded(site);\nlet settled=false;const original=new Promise(()=>{});void original.then(()=>{settled=true;});\nit('original stays pending after hook wrapper times out',()=>{diag.readerBegin();onTestFinished(()=>original);});\nafterAll(()=>console.log('HOOK_AFTER_ALL_PENDING',!settled));\n`);
 const vitest=resolve(repo,'desktop/node_modules/vitest/vitest.mjs');
 const alias=resolve(repo,'desktop/node_modules/vitest/dist/index.js').replace(/\\/g,'/');
 writeFileSync(join(root,'vitest.config.mjs'),`export default {root:${JSON.stringify(root)},resolve:{alias:{vitest:${JSON.stringify(alias)}}},test:{include:['case.test.mjs'],environment:'node',hookTimeout:30,pool:'forks',maxWorkers:1}};\n`);
 const env={...process.env};delete env.XIAOK_LOOP_READ_ERROR_DIAGNOSTIC;
 const argv=[vitest,'run','--config',join(root,'vitest.config.mjs'),'--reporter=verbose'];
 const result=await runOwnedChild({argv:[process.execPath,...argv],cwd:root,env,logPath:join(root,'hook.log'),metadataPath:join(root,'child.json'),signal:t.signal});
 console.log('LOOP_DIAGNOSTIC_HARNESS_CHILD',JSON.stringify({root,pid:result.pid,pgid:result.pgid,parentPid:process.pid,reaped:result.reaped,residual:result.groupResidual.length}));
 const output=readFileSync(join(root,'hook.log'),'utf8');
 assert.equal(result.code,1);assert.equal(result.signal,null);assert.match(output,/Hook timed out/);assert.equal(hasUniqueHookPendingMarker(output),true);
 const observed=verifyTranscript(output);
 assert.equal(observed.complete,false);assert.equal(observed.receipt.activeReaderCount,1);
 assert.ok(observed.problems.includes('unsettled_readers'));
 // Preserve this exact, identified fixture for post-parent-exit group audit.
});

test('owned child deadline and metadata failure both reap only their own group',async(t)=>{
 const base=join(repo,'.xiaok/evals/pi-durable/remediation-20261022');mkdirSync(base,{recursive:true});
 for(const kind of ['deadline','metadata']){
  const root=realpathSync(mkdtempSync(join(base,'loop-read-owner-'+kind+'-'))),meta=join(root,'child.json');
  const metadataPath=kind==='metadata'?join(root,'absent','child.json'):meta;
  let failure;try{await runOwnedChild({argv:[process.execPath,'-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],cwd:root,env:process.env,logPath:join(root,'child.log'),metadataPath,signal:t.signal,budgetMs:1000});}catch(error){failure=error;}
  assert.match(failure?.message??'',/diagnostic_child_owner_incomplete/);
  assert.equal(failure.owner.reaped,true);assert.deepEqual(failure.owner.groupResidual,[]);
  writeFileSync(join(root,'failure-audit.json'),JSON.stringify(failure.owner,null,2)+'\n');
  if(kind==='deadline'){
   const row=JSON.parse(readFileSync(meta,'utf8'));
   assert.equal(row.reaped,true);assert.deepEqual(row.groupResidual,[]);assert.equal(row.pgid,row.pid);
   assert.equal(row.signals.filter(v=>v.kind==='SIGTERM').length,1);assert.equal(row.signals.filter(v=>v.kind==='SIGKILL').length,1);
   assert.ok(row.elapsedMs<6000);
  }
 }
});
