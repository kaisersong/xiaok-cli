import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,it,expect,vi } from 'vitest';
import OpenAI from 'openai';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createSessionExecutionAuthority,createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { createSessionExecutionChain } from '../../../src/ai/runtime/session-store/execution-chain.js';
import { createCompoundSessionJournal } from '../../../src/runtime/sol-pi/compound-session-journal.js';
import { createCompoundProviderAdmission } from '../../../src/runtime/sol-pi/compound-provider-admission.js';
import { createTransportLeaseIssuer } from '../../../src/runtime/sol-pi/transport-lease.js';
import { createProviderDisclosureContext,createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();});
const destination={provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'};
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'actual-provider-chain-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=new FileSessionStore(root),abort=new AbortController(),targets=[];
 for(const sessionIdentity of ['parent','child']){
  await store.save({sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanups.push(()=>authority.dispose());
  const journal=createCompoundSessionJournal({root,store,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>abort.signal.throwIfAborted()});targets.push({root,store,sessionIdentity,authority,journal});
 }
 const [parent,child]=targets;const lease=await parent.authority.acquire({invocationId:'prepare',kind:'compound'});let operationId='';
 try{const row=await parent.journal.createOrGetDirect({hostProviderInvocationId:'request',originalToolUseId:'call',inputHash:'a'.repeat(64),toolName:'subagent',permissionGeneration:0},lease);operationId=row.operation.id;
 const delegation={version:1 as const,admissionId:'admission',childSessionIdentity:'child',childStoreRoot:root,generation:1,state:'live' as const,childPhase:'not_started' as const};
 await parent.journal.advanceDirect(operationId,{stage:'started',finalInputHash:'b'.repeat(64),delegation},lease);
 await parent.journal.advanceDirect(operationId,{stage:'started',delegation:{...delegation,childPhase:'running'}},lease);
 }finally{await lease.releaseAfterDrain();}
 const chain=createSessionExecutionChain({target:child,parent:createSessionExecutionChain({target:parent})});
 const capability=await createCompoundProviderAdmission({chain,parent:{...parent,operationId,generation:1},child,rootBudget:parent,issuerIncarnation:'actual-sdk-issuer',executionSignal:abort.signal});
 // Only the existing single-authority policy port is a fixture. Provider cap,
 // ancestry, journals, FileStore CAS and SDK execution are production code.
 const authority={};const issuer=createTransportLeaseIssuer({authority,withAdmission:op=>op(),validate(){abort.signal.throwIfAborted();},onRevoke(){return()=>{};}});cleanups.push(()=>issuer.dispose());
 const context=createProviderDisclosureContext({issuer,invocationId:'actual-sdk-logical',destination:destination.url,model:destination.model,capacityProfile:testOnlyCapacity(destination.url,destination.model),
  dependencies:[{authority,key:'archived-source',epoch:1}],ancestorAdmission:{capability,destination,closureDigest:'d'.repeat(64)}});
 return {root,store,abort,parent,child,capability,issuer,context};
}
it('actual SDK creates at most three durable physical attempts and records each drain before retry',async()=>{
 const f=await fixture();let calls=0;
 const raw=vi.fn(async()=>{calls++;const rows=(await f.store.load('child'))!.compoundOperations!.providerAttempts!;
  expect(rows).toHaveLength(calls);expect(rows.at(-1)!.transportState).toBe('reserved');
  expect(rows.slice(0,-1).every(row=>row.transportState==='drained')).toBe(true);
  return new Response('{}',{status:500,headers:{'retry-after-ms':'1','content-type':'application/json'}});
 });
 const client=new OpenAI({apiKey:'test',baseURL:'https://api.deepseek.com',maxRetries:4,fetch:createProviderDisclosureFetch(f.context,raw)});
 await expect(client.chat.completions.create({model:destination.model,messages:[{role:'user',content:'synthetic'}]})).rejects.toThrow();
 expect(calls).toBe(3);expect(raw).toHaveBeenCalledTimes(3);
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts!.map(row=>[row.attemptIndex,row.transportState])).toEqual([[0,'drained'],[1,'drained'],[2,'drained']]);
 expect((await f.store.load('parent'))!.compoundOperations!.treeBudget!.allocations).toHaveLength(3);
 await f.issuer.disposeAndDrain();
},15000);
it('actual response cancellation holds owner drain until local stream and durable attempt settle',async()=>{
 const f=await fixture();let release!:()=>void;const cancel=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
 const raw=vi.fn(async()=>new Response(new ReadableStream({cancel})));
 const guarded=createProviderDisclosureFetch(f.context,raw);
 await guarded(destination.url,{method:'POST',body:JSON.stringify({model:destination.model,messages:[]})});
 let drained=false;const pending=f.issuer.disposeAndDrain().then(()=>{drained=true;});
 await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(drained).toBe(false);
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('reserved');
 release();await pending;expect(drained).toBe(true);
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('drained');
 expect(raw).toHaveBeenCalledOnce();
});

it('owner revoke while actual ancestor lock is busy waits for no-send admission cancellation and never calls fetch',async()=>{
 const f=await fixture(),block=await f.parent.authority.acquire({invocationId:'blocking-other-writer',kind:'recovery'});
 const raw=vi.fn(async()=>new Response('{}'));const guarded=createProviderDisclosureFetch(f.context,raw);
 try{
  const sent=guarded(destination.url,{method:'POST',body:JSON.stringify({model:destination.model,messages:[]})});
  const rejected=expect(sent).rejects.toThrow(/AUTHORIZATION/);
  let drained=false;const draining=f.issuer.disposeAndDrain().then(()=>{drained=true;});
  expect(drained).toBe(false);await rejected;await draining;expect(drained).toBe(true);
  expect(raw).not.toHaveBeenCalled();expect((await f.store.load('child'))!.compoundOperations?.providerAttempts??[]).toHaveLength(0);
 }finally{await block.releaseAfterDrain();}
});
it('host owner binds the exact child admission before any request and protects zero-observation sends',async()=>{
 const f=await fixture();
 const {createObservationService}=await import('../../../src/runtime/sol-pi/observation-service.js');
 const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');
 const {createObservationSessionOwner,bindObservationProviderAdmission}=await import('../../../src/runtime/sol-pi/observation-session-owner.js');
 const service=createObservationService({profileRoot:join(f.root,'archive'),profileId:'test',redactor:{version:'fixture',redact:text=>text}});cleanups.push(()=>service.dispose());
 const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'child',cwd:f.root});
 const claims={sessionId:'child',ownerAgentId:'child',scopeId:'child',permissionGeneration:1,surface:'ordinary-owner' as const};
 const caller=service.bindCaller({...claims,requestSource:'agent'}),user=service.bindCaller({...claims,requestSource:'user'});
 const owner=createObservationSessionOwner({service,caller,session,destination,capacityProfile:testOnlyCapacity(destination.url,destination.model),persist:snapshot=>f.store.save(snapshot)});cleanups.push(()=>owner.dispose());
 expect(()=>bindObservationProviderAdmission({} as never,f.capability)).toThrow();
 expect(()=>bindObservationProviderAdmission(owner,{...f.capability})).toThrow();
 bindObservationProviderAdmission(owner,f.capability);
 const alternate=new AgentSessionState();alternate.restoreSnapshot({...alternate.exportSnapshot(),sessionId:'child',cwd:f.root});
 const alternateCaller=service.bindCaller({...claims,ownerAgentId:'other',scopeId:'other',requestSource:'agent'});
 const alternateOwner=createObservationSessionOwner({service,caller:alternateCaller,session:alternate,destination,capacityProfile:testOnlyCapacity(destination.url,destination.model),persist:snapshot=>f.store.save(snapshot)});cleanups.push(()=>alternateOwner.dispose());
 expect(()=>bindObservationProviderAdmission(alternateOwner,f.capability)).toThrow();
 const {withObservationExecutionOwner}=await import('../../../src/runtime/sol-pi/observation-execution-scope.js');
 expect(owner.hasDependencies()).toBe(true);
 expect(()=>withObservationExecutionOwner(owner,()=>withObservationExecutionOwner(undefined,()=>{}))).toThrow(/AUTHORIZATION/);
 expect(()=>bindObservationProviderAdmission(owner,f.capability)).toThrow();
 const prepared=await owner.prepareRequest({logicalInvocationId:'empty-source',messages:[],tools:[],systemPrompt:''});
 expect(prepared.providerDisclosure).toBeDefined();expect(session.getProtectedObservationClosure()).toBeUndefined();
 const queued=owner.prepareProviderDisclosure()!;
 const raw=vi.fn(async()=>new Response('ok'));
 const response=await createProviderDisclosureFetch(prepared.providerDisclosure!,raw)(destination.url,{method:'POST',body:JSON.stringify({model:destination.model,messages:[]})});
 expect(await response.text()).toBe('ok');
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts!).toHaveLength(1);
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].logicalInvocationId).toBe('empty-source');
 service.revokeCaller({requestSource:'user',caller:user,target:caller});
 await expect(createProviderDisclosureFetch(queued,raw)(destination.url,{method:'POST',body:JSON.stringify({model:destination.model,messages:[]})})).rejects.toThrow();
 expect(raw).toHaveBeenCalledOnce();
});

it('failed underlying cancellation writes unknown and cannot masquerade as drained or retry',async()=>{
 const f=await fixture();const raw=vi.fn(async()=>new Response(new ReadableStream({cancel(){return Promise.reject(Error('cancel uncertain'));}})));
 const guarded=createProviderDisclosureFetch(f.context,raw),body=JSON.stringify({model:destination.model,messages:[]});
 const response=await guarded(destination.url,{method:'POST',body});
 await expect(response.body!.cancel()).rejects.toThrow('cancel uncertain');
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('unknown');
 let drained=false;void f.issuer.disposeAndDrain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 await expect(guarded(destination.url,{method:'POST',body})).rejects.toThrow(/AUTHORIZATION/);expect(raw).toHaveBeenCalledOnce();
});

it('header-time revoke with failed response cancellation preserves unknown and owner drain',async()=>{
 const f=await fixture();const cancel=vi.fn(()=>Promise.reject(Error('header cancel uncertain')));
 const raw=vi.fn(async()=>{const response=new Response(new ReadableStream({cancel}));f.issuer.dispose();return response;});
 const guarded=createProviderDisclosureFetch(f.context,raw),body=JSON.stringify({model:destination.model,messages:[]});
 await expect(guarded(destination.url,{method:'POST',body})).rejects.toThrow();
 expect(cancel).toHaveBeenCalledOnce();
 expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('unknown');
 let drained=false;void f.issuer.disposeAndDrain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 await expect(guarded(destination.url,{method:'POST',body})).rejects.toThrow();expect(raw).toHaveBeenCalledOnce();
});
it('errored underlying response cannot be recorded as drained when reader cancellation also rejects',async()=>{
 const f=await fixture();const raw=vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.error(Error('underlying transport uncertain'));}})));
 const response=await createProviderDisclosureFetch(f.context,raw)(destination.url,{method:'POST',body:JSON.stringify({model:destination.model,messages:[]})});
 await expect(response.text()).rejects.toThrow('underlying transport uncertain');
 // Stream error becomes visible before the asynchronous durable settlement.
 await vi.waitFor(async()=>expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('unknown'));
 let drained=false;void f.issuer.disposeAndDrain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
});
