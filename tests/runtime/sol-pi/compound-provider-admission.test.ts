import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createSessionExecutionChain} from '../../../src/ai/runtime/session-store/execution-chain.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
import {createCompoundProviderAdmission,getProviderAncestorAdmissionBinding,assertCompoundProviderLiveReservations} from '../../../src/runtime/sol-pi/compound-provider-admission.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
const facts={logicalInvocationId:'sdk-request',attemptIndex:0 as const,serializedBodySha256:'c'.repeat(64),destination:{provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'},closureDigest:'d'.repeat(64)};
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'provider-admission-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),abort=new AbortController();
 const targets=[];
 for(const sessionIdentity of ['parent','child']){
  await store.save({sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());
  const journal=createCompoundSessionJournal({root,store,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>abort.signal.throwIfAborted()});targets.push({root,store,sessionIdentity,authority,journal});
 }
 const [parent,child]=targets;const lease=await parent.authority.acquire({invocationId:'prepare',kind:'compound'});let operationId:string;
 try{
  const prepared=await parent.journal.createOrGetDirect({hostProviderInvocationId:'request',originalToolUseId:'call',inputHash:'a'.repeat(64),toolName:'subagent',permissionGeneration:0},lease);operationId=prepared.operation.id;
  const delegation={version:1 as const,admissionId:'admission',childSessionIdentity:'child',childStoreRoot:root,generation:1,state:'live' as const,childPhase:'not_started' as const};
  await parent.journal.advanceDirect(operationId,{stage:'started',finalInputHash:'b'.repeat(64),delegation},lease);
  await parent.journal.advanceDirect(operationId,{stage:'started',delegation:{...delegation,childPhase:'running'}},lease);
 }finally{await lease.releaseAfterDrain();}
 const parentChain=createSessionExecutionChain({target:parent});const chain=createSessionExecutionChain({target:child,parent:parentChain});
 const cap=await createCompoundProviderAdmission({chain,parent:{...parent,operationId:operationId!,generation:1},child,rootBudget:parent,issuerIncarnation:'issuer',executionSignal:abort.signal});
 return{root,store,abort,cap,binding:getProviderAncestorAdmissionBinding(cap)};
}
it('actual ancestor CAS binds one-use provider tickets to body and retains root budget after revoked factual drain',async()=>{
 const {store,abort,cap,binding}=await fixture();
 expect(()=>getProviderAncestorAdmissionBinding({...cap})).toThrow();
 expect(binding.childSessionIdentity).toBe('child');expect(Object.isFrozen(binding)).toBe(true);
 const ticket=await binding.reserve(facts);
 expect((await store.load('parent'))!.compoundOperations!.treeBudget!.allocations).toHaveLength(1);
 expect((await store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('reserved');
 expect(()=>binding.consume(ticket,{...facts,closureDigest:'e'.repeat(64)})).toThrow();
 binding.consume(ticket,facts);expect(()=>binding.consume(ticket,facts)).toThrow();
 const cancelledFacts={...facts,logicalInvocationId:'cancel-before-send'};
 const cancelled=await binding.reserve(cancelledFacts);
 const cancelling=binding.settle(cancelled,'cancelled_before_send');
 expect(()=>binding.consume(cancelled,cancelledFacts)).toThrow();
 await cancelling;
 await expect(binding.reserve(cancelledFacts)).rejects.toThrow('compound_provider_admission_duplicate');
 const uncertain=await binding.reserve({...facts,logicalInvocationId:'uncertain'});
 await binding.settle(uncertain,'unknown');
 await expect(binding.settle(uncertain,'drained')).rejects.toThrow();
 abort.abort(Error('revoked'));
 await expect(binding.reserve({...facts,attemptIndex:1})).rejects.toThrow('revoked');
 await expect(binding.settle(ticket,'cancelled_before_send')).rejects.toThrow();
 await binding.settle(ticket,'drained');
 expect((await store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('drained');
 expect((await store.load('parent'))!.compoundOperations!.treeBudget!.allocations).toHaveLength(3);
});
it('recognizes only this live private issuer reservations and never treats restored reserved or unknown rows as supervision',async()=>{
 const f=await fixture(),ticket=await f.binding.reserve(facts),row=(await f.store.load('child'))!.compoundOperations!.providerAttempts![0];
 expect(()=>assertCompoundProviderLiveReservations(f.cap,[row])).not.toThrow();
 expect(()=>assertCompoundProviderLiveReservations({...f.cap},[row])).toThrow();
 expect(()=>assertCompoundProviderLiveReservations(f.cap,[{...row,id:'other'}])).toThrow();
 expect(()=>assertCompoundProviderLiveReservations(f.cap,[{...row,closureDigest:'e'.repeat(64)}])).toThrow();
 f.binding.consume(ticket,facts);expect(()=>assertCompoundProviderLiveReservations(f.cap,[row])).not.toThrow();
 await f.binding.settle(ticket,'unknown');const unknown=(await f.store.load('child'))!.compoundOperations!.providerAttempts![0];
 expect(()=>assertCompoundProviderLiveReservations(f.cap,[unknown])).toThrow();expect(()=>assertCompoundProviderLiveReservations(f.cap,[row])).toThrow();
});
it('an actual lock-close failure after durable reserve never delivers a usable ticket and records pre-send cancellation',async()=>{
 const {store,binding}=await fixture();
 const Database=createRequire(import.meta.url)('better-sqlite3'),close=Database.prototype.close;let armed=false;
 const unsubscribe=store.onCommit(snapshot=>{if(snapshot.sessionId==='child'&&snapshot.compoundOperations?.providerAttempts?.some(row=>row.transportState==='reserved'))armed=true;});
 const spy=vi.spyOn(Database.prototype,'close').mockImplementation(function(this:any){const result=close.call(this);if(armed){armed=false;throw Error('injected-reserve-release-error');}return result;});
 try{
  await expect(binding.reserve(facts)).rejects.toMatchObject({noDispatchPossible:true,reservationMayExist:true});
 }finally{spy.mockRestore();unsubscribe();}
 expect((await store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('cancelled_before_send');
 expect((await store.load('parent'))!.compoundOperations!.treeBudget!.allocations).toHaveLength(1);
});
