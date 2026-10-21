import { expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { FileGoalNativeJournal, goalNativeCandidate, type GoalNativeMutation } from '../../../src/runtime/goal/native-mutation-journal.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
const nativeIt = it.skipIf(process.platform === 'win32');

function row(id='mutation'): GoalNativeMutation {
 return {id,revision:1,sessionId:'session',kind:'create',previous:null,
  target:{version:1,kind:'goal',sessionId:'session',goalId:'goal',epoch:1,objective:'Original goal',completionCriterion:null,expectedEvidenceKinds:['answer']},
  turnLimit:3,definition:{version:1,obligations:[{obligationId:'original',predicateId:'exact-content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8'}]}}]},
  enrollmentRequestId:`${id}-enrollment`,applicationRequestId:`${id}-application`,status:'reserved',createdAt:1000,updatedAt:1000};
}
function setup(){const root=mkdtempSync(join(tmpdir(),'goal-native-journal-'));return {root,journal:new FileGoalNativeJournal(root),close:()=>rmSync(root,{recursive:true,force:true})};}
nativeIt('persists only a draft and enforces exact record CAS across independent long-lived instances and restart',()=>{
 const f=setup();try{
  const second=new FileGoalNativeJournal(f.root),original=row();expect(f.journal.load('session')).toEqual([]);
  f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:original});
  expect(second.load('session')).toEqual([original]);
  const enrolling: GoalNativeMutation={...original,revision:2,status:'enrolling',updatedAt:1001};second.put({sessionId:'session',requestSource:'user',expectedRevision:1,next:enrolling});
  expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:1,next:{...enrolling,status:'retired'}})).toThrow(/revision/);
  expect(new FileGoalNativeJournal(f.root).load('session')).toEqual([enrolling]);
  expect(goalNativeCandidate(original)).toMatchObject({goalId:'goal',epoch:1,revision:1,status:'active',turnsUsed:0,tokensUsed:0,createdAt:1000,updatedAt:1000});
  expect(readdirSync(f.root).filter(x=>x.endsWith('.json'))).toHaveLength(1);
 }finally{f.close();}
});
nativeIt('rejects agent writes, scheduler native admission and source omissions while allowing original recovery facts',()=>{
 const f=setup();try{
  for(const requestSource of ['agent','scheduler',undefined])expect(()=>f.journal.put({sessionId:'session',requestSource,expectedRevision:null,next:row()} as any)).toThrow();
  f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()});
  expect(()=>f.journal.put({sessionId:'session',requestSource:'scheduler',expectedRevision:1,next:{...row(),revision:2,status:'enrolling'}})).toThrow(/source/);
  f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:1,next:{...row(),revision:2,status:'enrolling'}});
  f.journal.put({sessionId:'session',requestSource:'scheduler',expectedRevision:2,next:{...row(),revision:3,status:'enrolled'}});
  expect(f.journal.load('session')[0].status).toBe('enrolled');
 }finally{f.close();}
});
nativeIt('rejects changed immutable input, phase jumps, reused request IDs and all changes to terminal history',()=>{
 const f=setup();try{
  const original=row();f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:original});
  for(const next of [{...original,revision:2,status:'ready'}, {...original,revision:2,status:'enrolling',turnLimit:50},
   {...original,revision:2,status:'enrolling',target:{...original.target,objective:'changed'}},
   {...row('another'),enrollmentRequestId:original.applicationRequestId},
   {...row('another'),applicationRequestId:row('another').enrollmentRequestId},
  ]) expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:next.id===original.id?1:null,next:next as GoalNativeMutation})).toThrow();
  f.journal.put({sessionId:'session',requestSource:'scheduler',expectedRevision:1,next:{...original,revision:2,status:'retired'}});
  expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:2,next:{...original,revision:3,status:'enrolling'}})).toThrow(/terminal|transition/);
 }finally{f.close();}
});
nativeIt('keeps the old durable revision when the actual writer fails and never treats a draft phase as approval',()=>{
 const f=setup();let fail=true;const broken=new FileGoalNativeJournal(f.root,(path,contents,options)=>{if(fail)throw Error('disk_failure');writeFileAtomicallySync(path,contents,options);});
 try{expect(()=>broken.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()})).toThrow('disk_failure');expect(f.journal.load('session')).toEqual([]);
 fail=false;broken.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()});expect(f.journal.load('session')[0].status).toBe('reserved');
 }finally{f.close();}
});
nativeIt('charges all 32 retained records and rejects malformed or cross-session data on every read',()=>{
 const f=setup();try{
  for(let i=0;i<32;i++)f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row(`mutation-${i}`)});
  expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row('overflow')})).toThrow(/capacity/);
  const file=join(f.root,readdirSync(f.root).find(x=>x.endsWith('.json'))!),saved=readFileSync(file,'utf8'),document=JSON.parse(saved);
  document.sessionId='foreign';writeFileSync(file,JSON.stringify(document));expect(()=>f.journal.load('session')).toThrow(/session/);
  document.sessionId='session';document.records[0].target.epoch=0;writeFileSync(file,JSON.stringify(document));expect(()=>f.journal.load('session')).toThrow();
  writeFileSync(file,' '.repeat(2*1024**2+1));expect(()=>f.journal.load('session')).toThrow(/capacity/);
 }finally{f.close();}
});
nativeIt('uses a hashed file name and captures immutable input before invoking the writer',()=>{
 const f=setup();const original={...row(),sessionId:'../other',target:{...row().target,sessionId:'../other'}};
 const journal=new FileGoalNativeJournal(f.root,(path,body,options)=>{original.target.objective='late replacement';writeFileAtomicallySync(path,body,options);});
 try{journal.put({sessionId:'../other',requestSource:'user',expectedRevision:null,next:original});expect(journal.load('../other')[0].target.objective).toBe('Original goal');expect(readdirSync(f.root).filter(x=>x.endsWith('.json'))[0]).toMatch(/^[a-f0-9]{64}\.native-goal\.json$/);
 }finally{f.close();}
});
nativeIt('reconstructs the complete replacement candidate without copying usage or pending completion',()=>{
 const value={...row(),kind:'replace',target:{...row().target,epoch:5},previous:{goalId:'goal',epoch:2,revision:10,createdAt:100,forkedFromGoalId:'source-goal',stateHash:'b'.repeat(64)}};
 const candidate=goalNativeCandidate(value);
 expect(candidate).toMatchObject({goalId:'goal',revision:11,epoch:5,sessionId:'session',forkedFromGoalId:'source-goal',createdAt:100,updatedAt:1000,turnsUsed:0,tokensUsed:0,activeWallClockMs:0,consecutiveBlockedTurns:0,status:'active',budgetLimits:{turnLimit:3}});
 expect(candidate.pendingCompletionIntentId).toBeUndefined();
 expect(()=>goalNativeCandidate({...value,target:{...value.target,epoch:2}})).toThrow();
});

nativeIt('reports a post-replacement writer failure without rolling back or allowing stale CAS replay',()=>{
 const f=setup();const broken=new FileGoalNativeJournal(f.root,(path,body,options)=>{writeFileAtomicallySync(path,body,options);throw Error('post_replace_failure');});
 try{expect(()=>broken.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()})).toThrow('post_replace_failure');
 expect(f.journal.load('session')[0]).toEqual(row());expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()})).toThrow(/revision/);
 }finally{f.close();}
});
nativeIt('enforces actual per-session UTF-8 bytes before writing even below the record count limit',()=>{
 const f=setup();let persisted=0;try{
  for(let i=0;i<32;i++){const next={...row(`large-${i}`),target:{...row().target,objective:'中'.repeat(4000),completionCriterion:'文'.repeat(4000)},
   definition:{version:1,obligations:[{...row().definition.obligations[0],recipe:{kind:'blackbox',cases:[{id:'case',inputBase64:Buffer.alloc(17500).toString('base64'),expectedOutputBase64:Buffer.alloc(17500).toString('base64'),sideEffects:[]}]}}]}};
   try{f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next} as any);persisted++;}catch(error){expect(String(error)).toContain('goal_native_journal_capacity');break;}
  }
  expect(persisted).toBeGreaterThan(0);expect(persisted).toBeLessThan(32);expect(f.journal.load('session')).toHaveLength(persisted);
 }finally{f.close();}
});
it('requires directory fsync and rejects the unsupported Windows durability path before publishing',()=>{
 const f=setup();const journal=new FileGoalNativeJournal(f.root,(path,body,options)=>{expect(options?.requireDirectorySync).toBe(true);writeFileAtomicallySync(path,body,{...options,platform:'win32'});});
 try{expect(()=>journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()} as any)).toThrow('directory sync durability unsupported on Windows');expect(f.journal.load('session')).toEqual([]);}finally{f.close();}
});
nativeIt.each(['live','killed'] as const)('actual process lock prevents duplicate journal CAS and recovers a %s writer',async mode=>{
 const f=setup(),entered=join(f.root,'entered'),release=join(f.root,'release'),script=join(f.root,'writer.mjs');
 f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:row()} as any);
 writeFileSync(script,`
import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';const originalUserInfo=os.userInfo.bind(os);os.userInfo=()=>({...originalUserInfo(),homedir:${JSON.stringify(userInfo().homedir)}});syncBuiltinESMExports();
const {FileGoalNativeJournal}=await import(${JSON.stringify(pathToFileURL(join(process.cwd(),'src/runtime/goal/native-mutation-journal.ts')).href)});
import {writeFileAtomicallySync} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'src/utils/atomic-file.ts')).href)};
import {existsSync,writeFileSync} from 'node:fs';
const root=${JSON.stringify(f.root)},entered=${JSON.stringify(entered)},release=${JSON.stringify(release)};
const hold=process.argv[2]==='hold';const journal=new FileGoalNativeJournal(root,(path,body,options)=>{if(hold){writeFileSync(entered,'ready');const until=Date.now()+15000;while(!existsSync(release)){if(Date.now()>until)throw Error('fixture_timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}writeFileAtomicallySync(path,body,options);});
const original=journal.load('session')[0];journal.put({sessionId:'session',requestSource:'user',expectedRevision:1,next:{...original,revision:2,status:'enrolling'}});
`);
 const run=(hold:boolean)=>{const child=spawn(process.execPath,['--import','tsx',script,hold?'hold':'write'],{cwd:process.cwd(),stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});const done=new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,stderr}));});return {child,done};};
 const first=run(true);try{
  await vi.waitFor(()=>expect(existsSync(entered)).toBe(true),{timeout:10000});
  const second=await run(false).done;expect(second.code,second.stderr).not.toBe(0);expect(second.stderr).toContain('session_save_locked');
  if(mode==='killed'){first.child.kill('SIGKILL');await first.done;expect(f.journal.load('session')[0].revision).toBe(1);f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:1,next:{...row(),revision:2,status:'enrolling'}} as any);}
  else{writeFileSync(release,'continue');const result=await first.done;expect(result.code,result.stderr).toBe(0);}
  expect(f.journal.load('session')[0]).toMatchObject({revision:2,status:'enrolling'});expect(existsSync(join(f.root,'.goal-native.save.lock'))).toBe(false);
 }finally{if(first.child.exitCode===null&&first.child.signalCode===null)first.child.kill('SIGKILL');await first.done;f.close();}
},30000);

nativeIt('rejects a target that cannot form a valid Goal before persisting the draft',()=>{
 const f=setup();try{expect(()=>f.journal.put({sessionId:'session',requestSource:'user',expectedRevision:null,next:{...row(),target:{...row().target,expectedEvidenceKinds:[]}}})).toThrow(/evidence/);expect(f.journal.load('session')).toEqual([]);}finally{f.close();}
});

it('native identity predicate exactly preserves strict journal lookup domain',async()=>{
 const {isGoalNativeJournalId}=await import('../../../src/runtime/goal/native-mutation-journal.js');
 const root=mkdtempSync(join(tmpdir(),'goal-native-id-')),journal=new FileGoalNativeJournal(root);
 try{for(const value of ['','\u0001'.repeat(256),'x'.repeat(161),'坏'.repeat(54)]){expect(isGoalNativeJournalId(value)).toBe(false);expect(()=>journal.load(value)).toThrow('goal_native_journal_id');}
 for(const value of ['thread','x'.repeat(160),'坏'.repeat(53)]){expect(isGoalNativeJournalId(value)).toBe(true);expect(journal.load(value)).toEqual([]);}}
 finally{rmSync(root,{recursive:true,force:true});}
});
