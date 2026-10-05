import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { createSessionExecutionAuthority, createSessionExecutionContext, assertSessionExecutionLease } from '../../../src/ai/runtime/session-store/execution-authority.js';
const profileSetupPath = resolve('tests/support/profile-account-child.setup.mjs');
const roots: string[] = [];
const authorities: ReturnType<typeof createSessionExecutionAuthority>[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'session-authority-')),accountHome=mkdtempSync(join(tmpdir(),'session-authority-account-')); roots.push(root,accountHome);
  const context = createSessionExecutionContext({ requestSource: 'user', ownerId: 'host', scopeId: 'scope' });
  const authority = createSessionExecutionAuthority({ root, sessionIdentity: 'sess_test', hostContext: context }); authorities.push(authority);
  return { root, accountHome, authority, context };
}
afterEach(() => { for (const a of authorities.splice(0)) a.dispose(); for (const p of roots.splice(0)) rmSync(p,{recursive:true,force:true}); });
it('serializes real same-process invocations and removes a cancelled waiter', async () => {
  const {authority}=setup(); const a=await authority.acquire({invocationId:'a',kind:'compound'});
  const abort=new AbortController();const b=authority.acquire({invocationId:'b',kind:'direct-mutation',signal:abort.signal});
  const rejected=expect(b).rejects.toThrow();abort.abort();await rejected;
  let acquired=false;const c=authority.acquire({invocationId:'c',kind:'compaction'}).then(lease=>{acquired=true;return lease;});
  await new Promise(r=>setImmediate(r));expect(acquired).toBe(false);
  await a.releaseAfterDrain();const third=await c;third.assertCurrent();await third.releaseAfterDrain();
});
it('keeps the OS lock while tracked work drains and rejects released or forged leases', async()=>{
 const {authority,root}=setup();const a=await authority.acquire({invocationId:'a',kind:'compound'});
 let finish!:()=>void;const work=new Promise<void>(r=>{finish=r;});a.trackInFlight(work);
 const releasing=a.releaseAfterDrain();let next=false;const b=authority.acquire({invocationId:'b',kind:'compaction'}).then(l=>{next=true;return l;});
 await new Promise(r=>setImmediate(r));expect(next).toBe(false);expect(()=>a.assertCurrent()).toThrow();
 finish();await releasing;const lease=await b;assertSessionExecutionLease(lease,{root,sessionIdentity:'sess_test'});
 expect(()=>assertSessionExecutionLease({...lease},{root,sessionIdentity:'sess_test'})).toThrow();
 expect(()=>assertSessionExecutionLease(lease,{root,sessionIdentity:'different'})).toThrow();await lease.releaseAfterDrain();
});
it('rejects duplicate same-session owners and forged caller context', async()=>{
 const {authority,root,context}=setup();
 expect(()=>createSessionExecutionAuthority({root,sessionIdentity:'sess_test',hostContext:context})).toThrow();
 expect(()=>createSessionExecutionAuthority({root,sessionIdentity:'other',hostContext:{} as any})).toThrow();
 const lease=await authority.acquire({invocationId:'a',kind:'compound'});expect(()=>authority.dispose()).toThrow();lease.assertCurrent();await lease.releaseAfterDrain();
});
it('uses an actual OS lock against a second Node process', async()=>{
 const {authority,root,accountHome}=setup();const lease=await authority.acquire({invocationId:'parent',kind:'compound'});
 const module=resolve('src/ai/runtime/session-store/execution-authority.ts');
 const source=`import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[1]).href);const a=m.createSessionExecutionAuthority({root:process.argv[2],sessionIdentity:'sess_test',hostContext:m.createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});try{const l=await a.acquire({invocationId:'child',kind:'compound'});await l.releaseAfterDrain();process.stdout.write('ACQUIRED');}catch{process.stdout.write('BUSY');}finally{a.dispose();}`;
 async function child(){return await new Promise<string>((res,rej)=>{const p=spawn(process.execPath,['--import',profileSetupPath,'--import','tsx','--input-type=module','-e',source,module,root],{stdio:['ignore','pipe','pipe'],env:{...process.env,XIAOK_TEST_ACCOUNT_HOME:accountHome}});let text='';let err='';p.stdout.on('data',b=>text+=b);p.stderr.on('data',b=>err+=b);p.once('error',rej);p.once('close',code=>code===0?res(text):rej(Error(err)));});}
 expect(await child()).toBe('BUSY');await lease.releaseAfterDrain();expect(await child()).toBe('ACQUIRED');
});
it.each(['sess_test','SESS_TEST'])('fences a real ordinary FileSessionStore writer in a second Node process (%s)', async sessionAlias=>{
 const {authority,root,accountHome}=setup();const lease=await authority.acquire({invocationId:'parent',kind:'compound'});
 const module=resolve('src/ai/runtime/session-store/file-store.ts');
 const source=`import {pathToFileURL} from 'node:url';const {FileSessionStore}=await import(pathToFileURL(process.argv[1]).href);const s=new FileSessionStore(process.argv[2]);try{await s.save({sessionId:process.argv[3],cwd:process.cwd(),createdAt:1,updatedAt:1,lineage:['sess_test'],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});process.stdout.write('SAVED');}catch(e){process.stdout.write('BLOCKED');}`;
 const output=await new Promise<string>((res,rej)=>{const p=spawn(process.execPath,['--import',profileSetupPath,'--import','tsx','--input-type=module','-e',source,module,root,sessionAlias],{stdio:['ignore','pipe','pipe'],env:{...process.env,XIAOK_TEST_ACCOUNT_HOME:accountHome}});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',rej);p.on('close',code=>code===0?res(out):rej(Error(err)));});
 expect(output).toBe('BLOCKED');await lease.releaseAfterDrain();
});
it('cannot issue a first execution lease after an ordinary writer passed the absent-lock probe', async()=>{
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const {writeFileAtomicallySync}=await import('../../../src/utils/atomic-file.js');
 const {spawnSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'session-first-lock-')),accountHome=mkdtempSync(join(tmpdir(),'session-first-lock-account-'));roots.push(root,accountHome);
 const module=resolve('src/ai/runtime/session-store/execution-authority.ts');let observation='';
 const source=`import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]).href);let a;try{a=m.createSessionExecutionAuthority({root:process.argv[2],sessionIdentity:'sess_first',hostContext:m.createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});const l=await a.acquire({invocationId:'first',kind:'compound'});await l.releaseAfterDrain();process.stdout.write('ACQUIRED');}catch{process.stdout.write('BLOCKED');}finally{a?.dispose();}`;
 const store=new FileSessionStore(root,(path,data,options)=>{
  if(!observation){const child=spawnSync(process.execPath,['--import',profileSetupPath,'--import','tsx','--input-type=module','-e',source,module,root],{encoding:'utf8',timeout:10000,env:{...process.env,XIAOK_TEST_ACCOUNT_HOME:accountHome}});expect(child.status).toBe(0);observation=child.stdout;}
  writeFileAtomicallySync(path,data,options);
 });
 await store.save({sessionId:'sess_first',cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 expect(observation).toBe('BLOCKED');
});
it('captures the rejection guard and rejects async/reentrant/revoked admission without granting new claims',async()=>{
 const {authority,root}=setup();let current=true;const input={invocationId:'guarded',kind:'direct-mutation' as const,assertAdmission:()=>{if(!current)throw Error('permission_revoked');}};const lease=await authority.acquire(input);input.assertAdmission=()=>{};current=false;expect(()=>assertSessionExecutionLease(lease,{root,sessionIdentity:'sess_test'})).toThrow('permission_revoked');await lease.releaseAfterDrain();
 const asyncLease=await authority.acquire({invocationId:'async',kind:'direct-mutation',assertAdmission:async()=>{throw Error('async invalid');}});expect(()=>asyncLease.assertCurrent()).toThrow('admission_async');await asyncLease.releaseAfterDrain();
 let reentrant:typeof lease;reentrant=await authority.acquire({invocationId:'reentrant',kind:'direct-mutation',assertAdmission:()=>reentrant.assertCurrent()});expect(()=>reentrant.assertCurrent()).toThrow('admission_reentrant');await reentrant.releaseAfterDrain();
});
