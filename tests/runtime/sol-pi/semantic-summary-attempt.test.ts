import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createSessionExecutionAuthority, createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { parseObservationPolicyFile } from '../../../src/runtime/sol-pi/product-bootstrap.js';
import { prepareSemanticSummaryAttempt, finishSemanticSummaryAttempt, resolveSemanticSummaryAttempt } from '../../../src/runtime/sol-pi/semantic-summary-attempt.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
const profileSetupPath = join(process.cwd(), 'tests', 'support', 'profile-account-child.setup.mjs');
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(maxCalls = 2) {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'summary-attempt-'))),accountHome=realpathSync(mkdtempSync(join(tmpdir(),'summary-attempt-account-'))); cleanups.push(() => rmSync(root,{recursive:true,force:true}),()=>rmSync(accountHome,{recursive:true,force:true}));
 const file = join(root,'input.txt'); writeFileSync(file,'source'); const expiresAt = Date.now()+60000;
 const destination = 'https://api.deepseek.com/chat/completions';
 const policyFile = join(root,'policy.json'); writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:destination},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls,maxCostUnits:50000000,maxOutputTokens:2048,expiresAt,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiresAt}}}));
 const policy=parseObservationPolicyFile(policyFile);const store=new FileSessionStore(root);
 await store.save({sessionId:'session',cwd:root,createdAt:1,updatedAt:1,lineage:['session'],messages:[{role:'user',content:[{type:'text',text:'exact user goal'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'summary',kind:'compaction'});cleanups.push(()=>lease.releaseAfterDrain());
 const serializedBody=JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'summary'}],max_tokens:2048});
 return {root,accountHome,policyFile,authority,store,lease,policy,sessionId:'session',destination,serializedBody,capacityProfile:testOnlyCapacity(destination,'deepseek-flash')};
}
it('persists a charged dispatched reservation before returning any sending capability',async()=>{
 const input=await setup();const source=(await input.store.load(input.sessionId))!;
 const attempt=await prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'op1'});
 const saved=(await input.store.load(input.sessionId))!;
 expect(saved.messages).toEqual(source.messages);expect(saved.semanticCompaction!.reservations[0].status).toBe('dispatched');
 expect(saved.semanticCompaction!.reservations[0].bodyDigest).toMatch(/^[a-f0-9]{64}$/);
 // Fixture qualification may test persistence, but never yields a production sending capability.
 expect(()=>resolveSemanticSummaryAttempt(attempt)).toThrow(/QUALIFICATION/);
 expect(()=>resolveSemanticSummaryAttempt({...attempt})).toThrow();
 await finishSemanticSummaryAttempt(attempt,'unknown');
 expect((await input.store.load(input.sessionId))!.semanticCompaction!.reservations[0].status).toBe('unknown');
 await expect(prepareSemanticSummaryAttempt({...input,sourceSnapshot:(await input.store.load(input.sessionId))!,operationId:'op1'})).rejects.toThrow();
});
it('does not refund unknown attempts or allow stale source history to reserve',async()=>{
 const input=await setup(1);const source=(await input.store.load(input.sessionId))!;
 const attempt=await prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'op1'});
 await finishSemanticSummaryAttempt(attempt,'unknown');
 await expect(prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'op2'})).rejects.toThrow();
 await expect(prepareSemanticSummaryAttempt({...input,sourceSnapshot:(await input.store.load(input.sessionId))!,operationId:'op2'})).rejects.toThrow();
 expect((await input.store.load(input.sessionId))!.semanticCompaction!.reservations).toHaveLength(1);
});
it('rejects forged policy and released lease before durable mutations',async()=>{
 const input=await setup();const source=(await input.store.load(input.sessionId))!;
 await expect(prepareSemanticSummaryAttempt({...input,policy:{} as never,sourceSnapshot:source,operationId:'op1'})).rejects.toThrow();
 await input.lease.releaseAfterDrain();
 await expect(prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'op1'})).rejects.toThrow();
 expect((await input.store.load(input.sessionId))!.semanticCompaction).toBeUndefined();
});
it('rechecks the host boundary inside the actual reservation commit and keeps admitted costs after boundary changes',async()=>{
 const input=await setup();const source=(await input.store.load(input.sessionId))!;
 let calls=0;
 await expect(prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'blocked',assertBoundaryCurrent(){if(++calls>=2)throw Error('changed boundary');}})).rejects.toThrow('changed boundary');
 expect((await input.store.load(input.sessionId))!.semanticCompaction).toBeUndefined();
 let valid=true;
 const attempt=await prepareSemanticSummaryAttempt({...input,sourceSnapshot:source,operationId:'admitted',assertBoundaryCurrent(){if(!valid)throw Error('changed boundary');}});
 valid=false;await finishSemanticSummaryAttempt(attempt,'unknown');
 const saved=(await input.store.load(input.sessionId))!;
 expect(saved.semanticCompaction!.reservations).toHaveLength(1);
 expect(saved.semanticCompaction!.reservations[0]).toMatchObject({status:'unknown'});
 expect(saved.semanticCompaction!.reservations[0].maximumCostUnits).toBeGreaterThan(0);
 expect(saved.messages).toEqual(source.messages);
});

it('retains the full durable charge after real SIGKILL without reconstructing a sending capability',async()=>{
 const input=await setup(1);await input.lease.releaseAfterDrain();
 const code=`import{FileSessionStore}from'./src/ai/runtime/session-store/file-store.ts';
 import{createSessionExecutionAuthority,createSessionExecutionContext}from'./src/ai/runtime/session-store/execution-authority.ts';
 import{parseObservationPolicyFile}from'./src/runtime/sol-pi/product-bootstrap.ts';
 import{prepareSemanticSummaryAttempt}from'./src/runtime/sol-pi/semantic-summary-attempt.ts';
 import{testOnlyCapacity}from'./tests/support/sol-pi-capacity.ts';
 const [root,file,body]=process.argv.slice(1),store=new FileSessionStore(root),policy=parseObservationPolicyFile(file),destination='https://api.deepseek.com/chat/completions';
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const lease=await authority.acquire({invocationId:'child',kind:'compaction'});
 await prepareSemanticSummaryAttempt({store,lease,policy,sessionId:'session',destination,serializedBody:body,capacityProfile:testOnlyCapacity(destination,'deepseek-flash'),sourceSnapshot:await store.load('session'),operationId:'killed-summary'});
 console.log('DURABLE_DISPATCHED');setInterval(()=>{},10000);`;
 const child=spawn(process.execPath,['--import',profileSetupPath,'--import','tsx','--input-type=module','-e',code,input.root,input.policyFile,input.serializedBody],{stdio:['ignore','pipe','pipe'],env:{...process.env,XIAOK_TEST_ACCOUNT_HOME:input.accountHome}});
 let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  await new Promise<void>((resolve,reject)=>{let out='';child.stdout.on('data',bytes=>{out+=bytes;if(out.includes('DURABLE_DISPATCHED'))resolve();});child.once('error',reject);child.once('exit',()=>reject(Error(stderr||'child exited before durable write')));});
  child.kill('SIGKILL');expect((await exit).signal).toBe('SIGKILL');
  const lease=await input.authority.acquire({invocationId:'restart',kind:'recovery'});
  try{
   const durable=(await input.store.load(input.sessionId))!,reservation=durable.semanticCompaction!.reservations[0];
   expect(reservation.status).toBe('dispatched');expect(reservation.maximumCostUnits).toBeGreaterThan(0);expect(durable.compactions).toHaveLength(0);
   expect(()=>resolveSemanticSummaryAttempt(reservation as any)).toThrow();
   await expect(prepareSemanticSummaryAttempt({...input,lease,sourceSnapshot:durable,operationId:'killed-summary'})).rejects.toThrow();
   expect((await input.store.load(input.sessionId))!.semanticCompaction).toEqual(durable.semanticCompaction);
  }finally{await lease.releaseAfterDrain();}
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;}
},20000);
