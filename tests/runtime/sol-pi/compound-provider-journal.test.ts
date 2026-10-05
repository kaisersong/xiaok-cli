import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundSessionJournal} from '../../../src/runtime/sol-pi/compound-session-journal.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
async function setup(){const root=mkdtempSync(join(tmpdir(),'provider-journal-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const store=new FileSessionStore(root),sessionIdentity='child';await store.save({sessionId:sessionIdentity,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'agent',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const journal=createCompoundSessionJournal({store,root,sessionIdentity,ownerId:'host',scopeId:'scope',requestSource:'agent',assertCurrent:()=>{}});const lease=await authority.acquire({invocationId:'journal',kind:'compound'});return{root,store,journal,lease};}
const request={issuerIncarnation:'fixture-issuer',logicalInvocationId:'request',attemptIndex:0 as 0|1|2,serializedBodySha256:'a'.repeat(64),destination:{provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'},closureDigest:'b'.repeat(64),parentAdmission:{parentSessionIdentity:'parent',parentOperationId:'parent-op',generation:1}};
it('actual FileSessionStore durably reserves exact provider attempts and rejects changed body, false retry, and unknown revival',async()=>{
 const f=await setup();try{
  const first=await f.journal.reserveProviderAttempt(request,f.lease);expect(first.created).toBe(true);
  expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0]).toMatchObject({id:first.reservationId,transportState:'reserved',serializedBodySha256:request.serializedBodySha256});
  expect(await f.journal.reserveProviderAttempt(request,f.lease)).toMatchObject({created:false,reservationId:first.reservationId});
  await expect(f.journal.reserveProviderAttempt({...request,serializedBodySha256:'c'.repeat(64)},f.lease)).rejects.toThrow();
  await expect(f.journal.reserveProviderAttempt({...request,attemptIndex:1},f.lease)).rejects.toThrow();
  await f.journal.settleProviderAttempt({reservationId:first.reservationId,transportState:'unknown'},f.lease);
  await expect(f.journal.settleProviderAttempt({reservationId:first.reservationId,transportState:'drained'},f.lease)).rejects.toThrow();
  await expect(f.journal.reserveProviderAttempt({...request,attemptIndex:1},f.lease)).rejects.toThrow();
  expect((await f.store.load('child'))!.compoundOperations!.providerAttempts![0].transportState).toBe('unknown');
 }finally{await f.lease.releaseAfterDrain();}
});
it('three actual physical attempts share exact logical binding and tombstones cannot authorize repeat send',async()=>{
 const f=await setup();try{
  for(const attemptIndex of [0,1,2] as const){const r=await f.journal.reserveProviderAttempt({...request,attemptIndex},f.lease);await f.journal.settleProviderAttempt({reservationId:r.reservationId,transportState:'drained'},f.lease);await f.journal.retireProviderAttempt(r.reservationId,{requestSource:'user'},f.lease);}
  const snapshot=(await f.store.load('child'))!;expect(snapshot.compoundOperations!.providerAttempts).toHaveLength(0);expect(snapshot.compoundOperations!.tombstones).toHaveLength(3);
  expect(await f.journal.reserveProviderAttempt(request,f.lease)).toMatchObject({created:false});
  await expect(f.journal.reserveProviderAttempt({...request,attemptIndex:3 as any},f.lease)).rejects.toThrow();
  await expect(f.journal.reserveProviderAttempt({...request,attemptIndex:2,parentAdmission:{...request.parentAdmission,generation:2}},f.lease)).rejects.toThrow();
 }finally{await f.lease.releaseAfterDrain();}
});
it('provider reserve uses the same journal capacity as real native operation slots',async()=>{
 const f=await setup();try{
  for(let i=0;i<256;i++)await f.journal.createOrGetDirect({hostProviderInvocationId:`native-${i}`,originalToolUseId:'tool',inputHash:'d'.repeat(64),toolName:'write',permissionGeneration:0},f.lease);
  await expect(f.journal.reserveProviderAttempt(request,f.lease)).rejects.toThrow('compound_capacity');
  expect((await f.store.load('child'))!.compoundOperations!.providerAttempts??[]).toHaveLength(0);
 }finally{await f.lease.releaseAfterDrain();}
},30000);

it('pre-send cancellation retains its tombstone and cannot authorize the old request or a retry',async()=>{
 const f=await setup();try{
  const first=await f.journal.reserveProviderAttempt(request,f.lease);
  await f.journal.settleProviderAttempt({reservationId:first.reservationId,transportState:'cancelled_before_send'},f.lease);
  await f.journal.retireProviderAttempt(first.reservationId,{requestSource:'user'},f.lease);
  expect(await f.journal.reserveProviderAttempt(request,f.lease)).toMatchObject({created:false});
  await expect(f.journal.reserveProviderAttempt({...request,attemptIndex:1},f.lease)).rejects.toThrow();
  expect((await f.store.load('child'))!.compoundOperations!.tombstones[0].providerAttempt?.transportState).toBe('cancelled_before_send');
 }finally{await f.lease.releaseAfterDrain();}
});

it('only the original issuing journal may append a final transport fact after execution permission revocation',async()=>{
 const f=await setup();let live=true;
 const options={store:f.store,root:f.root,sessionIdentity:'child',ownerId:'host',scopeId:'scope',requestSource:'agent' as const,assertCurrent(){if(!live)throw Error('revoked');}};
 const issuer=createCompoundSessionJournal(options),other=createCompoundSessionJournal(options);
 try{
  const first=await issuer.reserveProviderAttempt(request,f.lease);
  expect(await other.reserveProviderAttempt(request,f.lease)).toMatchObject({created:false,reservationId:first.reservationId});
  live=false;
  await expect(issuer.reserveProviderAttempt({...request,logicalInvocationId:'new'},f.lease)).rejects.toThrow('revoked');
  await expect(issuer.settleProviderAttempt({reservationId:first.reservationId,transportState:'drained'},f.lease)).rejects.toThrow('revoked');
  await expect(other.settleIssuedProviderAttemptFacts({reservationId:first.reservationId,transportState:'drained'},f.lease)).rejects.toThrow('compound_provider_issuer_mismatch');
  await issuer.settleIssuedProviderAttemptFacts({reservationId:first.reservationId,transportState:'unknown'},f.lease);
  await expect(issuer.settleIssuedProviderAttemptFacts({reservationId:first.reservationId,transportState:'drained'},f.lease)).rejects.toThrow();
  expect((await f.store.load('child'))!.compoundOperations!.providerAttempts).toMatchObject([{id:first.reservationId,transportState:'unknown'}]);
 }finally{await f.lease.releaseAfterDrain();}
});
