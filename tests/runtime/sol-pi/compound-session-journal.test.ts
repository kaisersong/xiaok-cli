import {writeFileAtomicallySync} from '../../../src/utils/atomic-file.js';
import {mkdtempSync,rmSync,existsSync,readFileSync,fstatSync,fsyncSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
it('real CAS journal atomically keeps one host dispatch identity, rejects changed replay and cannot revive a retired operation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-journal-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='sess_journal';await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'delivery',kind:'compound'});let current=true;
 const journal=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{if(!current)throw Error('revoked');}});
 const input={hostProviderInvocationId:'provider',originalToolUseId:'tool',inputHash:'a'.repeat(64),toolName:'write' as const,permissionGeneration:1};
 try{
 const a=await journal.createOrGet(input,lease),b=await journal.createOrGet(input,lease);expect(a.created).toBe(true);expect(b.created).toBe(false);expect(b.operation.id).toBe(a.operation.id);
 await expect(journal.createOrGet({...input,inputHash:'b'.repeat(64)},lease)).rejects.toThrow('dispatch_identity_conflict');
 await journal.advance(a.operation.id,{stage:'settled',editStatus:'denied',validation:{status:'not_started',exitCode:null}},lease);
 await expect(journal.retire(a.operation.id,{requestSource:'agent'},lease)).rejects.toThrow();await journal.retire(a.operation.id,{requestSource:'user'},lease);
 const replay=await journal.createOrGet(input,lease);expect(replay.created).toBe(false);expect(replay.operation.id).toBe(a.operation.id);expect('terminalKind' in replay.operation).toBe(true);
 const prepared=await journal.createOrGetDirect({...input,originalToolUseId:'direct-prepared'},lease);
 const other=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});
 await expect(other.settleIssuedPreparedDirectFacts({operationId:prepared.operation.id,outcome:'cancelled'},lease)).rejects.toThrow('compound_prepared_issuer_mismatch');
 const started=await journal.createOrGetDirect({...input,originalToolUseId:'direct-started'},lease);
 await journal.advanceDirect(started.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease);
 await expect(journal.settleIssuedPreparedDirectFacts({operationId:started.operation.id,outcome:'cancelled'},lease)).rejects.toThrow('compound_prepared_issuer_mismatch');
 const compoundPrepared=await journal.createOrGet({...input,originalToolUseId:'compound-prepared'},lease);
 await expect(other.settleIssuedPreparedCompoundFacts({operationId:compoundPrepared.operation.id,outcome:'cancelled'},lease)).rejects.toThrow('compound_prepared_issuer_mismatch');
 const compoundStarted=await journal.createOrGet({...input,originalToolUseId:'compound-started'},lease);
 await journal.advance(compoundStarted.operation.id,{stage:'edit_started',finalInputHash:'c'.repeat(64)},lease);
 await expect(journal.settleIssuedPreparedCompoundFacts({operationId:compoundStarted.operation.id,outcome:'cancelled'},lease)).rejects.toThrow('compound_prepared_issuer_mismatch');
 const committed=await journal.createOrGet({...input,originalToolUseId:'committed-file'},lease);
 const file={path:join(root,'edited'),beforeHash:null,afterHash:'d'.repeat(64)};
 await journal.advance(committed.operation.id,{stage:'edit_started',finalInputHash:'c'.repeat(64)},lease);
 await journal.advance(committed.operation.id,{stage:'edit_committed',file},lease);
 await expect(other.settleIssuedCommittedEditFacts({operationId:committed.operation.id,validationStatus:'denied'},lease)).rejects.toThrow('compound_committed_edit_issuer_mismatch');
 const dispatched=await journal.createOrGet({...input,originalToolUseId:'validation-started'},lease);
 await journal.advance(dispatched.operation.id,{stage:'edit_started',finalInputHash:'c'.repeat(64)},lease);
 const ready=await journal.advance(dispatched.operation.id,{stage:'edit_committed',file},lease);
 await journal.advance(ready.id,{stage:'validation_started',physicalExecution:{sessionIdentity:sessionId,compoundOperationId:ready.id,validationInvocationId:ready.validationInvocationId,executionIdentity:'execution',scopeDigest:'a'.repeat(64)}},lease);
 await expect(journal.settleIssuedCommittedEditFacts({operationId:ready.id,validationStatus:'cancelled'},lease)).rejects.toThrow('compound_committed_edit_issuer_mismatch');
 current=false;await expect(journal.createOrGet({...input,originalToolUseId:'new'},lease)).rejects.toThrow('revoked');
 await journal.settleIssuedCommittedEditFacts({operationId:committed.operation.id,validationStatus:'denied'},lease);
 expect((await store.load(sessionId))!.compoundOperations!.operations.find(row=>row.id===committed.operation.id)).toMatchObject({stage:'settled',editStatus:'succeeded',file,validation:{status:'denied',exitCode:null}});
 await journal.settleIssuedPreparedCompoundFacts({operationId:compoundPrepared.operation.id,outcome:'cancelled'},lease);
 expect((await store.load(sessionId))!.compoundOperations!.operations.find(row=>row.id===compoundPrepared.operation.id)).toMatchObject({stage:'settled',editStatus:'cancelled',validation:{status:'not_started'}});
 await journal.settleIssuedPreparedDirectFacts({operationId:prepared.operation.id,outcome:'cancelled'},lease);
 expect((await store.load(sessionId))!.compoundOperations!.directOperations!.find(row=>row.id===prepared.operation.id)).toMatchObject({stage:'settled',outcome:'cancelled',quiescence:null});
 }finally{await lease.releaseAfterDrain();}
 expect((await store.load(sessionId))!.compoundOperations!.tombstones).toHaveLength(1);
});
it('rechecks host admission synchronously inside the actual direct-stage CAS',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-journal-guard-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='guarded';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'guard',kind:'compound'});
 const journal=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 try{
  const row=await journal.createOrGetDirect({hostProviderInvocationId:'request',originalToolUseId:'tool',inputHash:'a'.repeat(64),toolName:'write',permissionGeneration:0},lease);
  await expect(journal.advanceDirect(row.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease,()=>{throw Error('main_admission_revoked');})).rejects.toThrow('main_admission_revoked');
  expect((await journal.read(lease)).directOperations![0].stage).toBe('prepared');
  await expect(journal.advanceDirect(row.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease,async()=>{})).rejects.toThrow(/synchronous/);
  expect((await journal.read(lease)).directOperations![0].stage).toBe('prepared');
  let observed=false;
  await journal.advanceDirect(row.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)},lease,()=>{expect(existsSync(join(root,'.session-store-lock'))).toBe(true);expect(JSON.parse(readFileSync(join(root,`${sessionId}.json`),'utf8')).compoundOperations.directOperations[0].stage).toBe('prepared');observed=true;});
  expect(observed).toBe(true);expect((await journal.read(lease)).directOperations![0].stage).toBe('started');
 }finally{await lease.releaseAfterDrain();}
});
it('checks the live provider admission in the actual reservation CAS before granting an issued attempt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-provider-guard-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='provider_guard';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'provider',kind:'compound'});
 const journal=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 const input={issuerIncarnation:'issuer',logicalInvocationId:'logical',attemptIndex:0 as const,serializedBodySha256:'a'.repeat(64),destination:{provider:'test',model:'test',url:'https://example.test/messages'},closureDigest:'b'.repeat(64),parentAdmission:{parentSessionIdentity:'parent',parentOperationId:'operation',generation:1}};
 try{
  await expect(journal.reserveProviderAttempt(input,lease,()=>{throw Error('tree_became_unknown');})).rejects.toThrow('tree_became_unknown');
  expect((await store.load(sessionId))!.compoundOperations?.providerAttempts??[]).toHaveLength(0);
  await expect(journal.reserveProviderAttempt({...input,logicalInvocationId:'async-logical'},lease,async()=>{})).rejects.toThrow('synchronous');
  expect((await store.load(sessionId))!.compoundOperations?.providerAttempts??[]).toHaveLength(0);
  let checked=false;const reserved=await journal.reserveProviderAttempt({...input,logicalInvocationId:'successful-logical'},lease,candidate=>{expect(candidate.compoundOperations!.providerAttempts![0].transportState).toBe('reserved');expect(candidate.sessionId).toBe(sessionId);candidate.messages=[];expect(existsSync(join(root,'.session-store-lock'))).toBe(true);checked=true;});
  expect(checked).toBe(true);await journal.settleIssuedProviderAttemptFacts({reservationId:reserved.reservationId,transportState:'cancelled_before_send'},lease);
 }finally{await lease.releaseAfterDrain();}
});
it('records cancellation for only its own failed never-issued provider reservation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-unissued-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionId='unissued';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'reserve',kind:'compound'});
 const config={store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent' as const,assertCurrent(){}};const journal=createCompoundSessionJournal(config),other=createCompoundSessionJournal(config);
 try{
  const input={issuerIncarnation:'issuer',logicalInvocationId:'request',attemptIndex:0 as const,serializedBodySha256:'a'.repeat(64),destination:{provider:'test',model:'test',url:'https://example.test/messages'},closureDigest:'b'.repeat(64),parentAdmission:{parentSessionIdentity:'parent',parentOperationId:'operation',generation:1}};
  let failure:unknown;try{await journal.reserveProviderAttempt(input,lease,()=>{throw Error('final_admission_rejected');});}catch(error){failure=error;}
  expect(journal.isUnissuedProviderAttemptFailure(failure)).toBe(true);expect(other.isUnissuedProviderAttemptFailure(failure)).toBe(false);expect(journal.isUnissuedProviderAttemptFailure({...failure as object})).toBe(false);
  await expect(other.cancelUnissuedProviderAttempt(failure,lease)).rejects.toThrow('issuer');
  await expect(journal.reserveProviderAttempt(input,lease)).rejects.toThrow('pending');
  let nested:Promise<string>[]=[];
  const unsubscribe=store.onCommit(snapshot=>{if(snapshot.compoundOperations?.providerAttempts?.[0]?.transportState==='cancelled_before_send')nested=[
   journal.cancelUnissuedProviderAttempt(failure,lease).then(()=> 'unexpected cancellation',error=>String(error)),
   journal.reserveProviderAttempt(input,lease).then(result=>{expect(result.created).toBe(false);return 'durable cancelled record only';},error=>String(error)),
  ];});
  try{await journal.cancelUnissuedProviderAttempt(failure,lease);}finally{unsubscribe();}
  expect(await Promise.all(nested)).toEqual([expect.stringContaining('issuer'),'durable cancelled record only']);
  expect((await journal.read(lease)).providerAttempts).toMatchObject([{logicalInvocationId:'request',transportState:'cancelled_before_send'}]);
  const record=(await journal.read(lease)).providerAttempts![0];await expect(journal.settleIssuedProviderAttemptFacts({reservationId:record.id,transportState:'drained'},lease)).rejects.toThrow('issuer');
  await expect(journal.cancelUnissuedProviderAttempt(failure,lease)).rejects.toThrow('issuer');
 }finally{await lease.releaseAfterDrain();}
});

it('does not acknowledge never-issued cancellation when the actual post-rename directory fsync fails',async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-unissued-fsync-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));let failDirectory=false;
 const store=new FileSessionStore(root,(path,bytes,options)=>writeFileAtomicallySync(path,bytes,{...options,operations:{fsyncSync(fd){if(failDirectory&&bytes.includes('cancelled_before_send')&&fstatSync(fd).isDirectory())throw Object.assign(Error('actual_directory_fsync_failure'),{code:'EIO'});fsyncSync(fd);}}})),sessionId='unissued-fsync';
 await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'reserve',kind:'compound'});
 const journal=createCompoundSessionJournal({store,root,sessionIdentity:sessionId,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent(){}});
 try{
  const input={issuerIncarnation:'issuer',logicalInvocationId:'request',attemptIndex:0 as const,serializedBodySha256:'a'.repeat(64),destination:{provider:'test',model:'test',url:'https://example.test/messages'},closureDigest:'b'.repeat(64),parentAdmission:{parentSessionIdentity:'parent',parentOperationId:'operation',generation:1}};
  let failure:unknown;try{await journal.reserveProviderAttempt(input,lease,()=>{throw Error('final_admission_rejected');});}catch(error){failure=error;}
  failDirectory=true;await expect(journal.cancelUnissuedProviderAttempt(failure,lease)).rejects.toThrow('actual_directory_fsync_failure');
  expect(journal.isUnissuedProviderAttemptFailure(failure)).toBe(true);await expect(journal.reserveProviderAttempt(input,lease)).rejects.toThrow('unissued_pending');
  const row=(await store.load(sessionId))!.compoundOperations!.providerAttempts![0];expect(row.transportState).toBe('cancelled_before_send');
  await expect(journal.settleIssuedProviderAttemptFacts({reservationId:row.id,transportState:'drained'},lease)).rejects.toThrow('issuer');
  failDirectory=false;await journal.cancelUnissuedProviderAttempt(failure,lease);expect(journal.isUnissuedProviderAttemptFailure(failure)).toBe(false);
 }finally{failDirectory=false;await lease.releaseAfterDrain();}
});
