import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileOwnerRegistry} from '../../../src/runtime/verification/profile-owner-registry.js';
const peer={uid:501,gid:20,auditSessionId:7},accountId='11111111-2222-3333-4444-555555555555';
const invocation={sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'validation'};
const proposal={ownerKind:'task' as const,ownerId:'task',invocations:[invocation]};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'profile-owner-')),database=openPrivateVerificationDatabase(root),permits=new WeakSet<object>();let failPublish=false,account=accountId;
 const options={database,authorityId:'authority',resolvePrincipal:(p:typeof peer)=>({uid:p.uid,accountId:account}),assertEnrollmentCurrent:()=>{},assertEnrollmentAuthorization:(_proposal:unknown,context:{authorization:object})=>{if(!permits.delete(context.authorization))throw Error('native_authorization');},publishProfile:(record:unknown)=>{if(failPublish)throw Error('directory_barrier');writeFileSync(join(root,'index.json'),JSON.stringify(record));},assertProfilePublished:(record:unknown)=>{expect(JSON.parse(readFileSync(join(root,'index.json'),'utf8'))).toEqual(record);}};
 const registry=createProfileOwnerRegistry(options),context=()=>{const authorization={};permits.add(authorization);return {peer,requestSource:'user' as const,authorization};};
 return {root,database,registry,options,context,fail:()=>{failPublish=true;},allow:()=>{failPublish=false;},reuse:()=>{account='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';},close:()=>{database.close();rmSync(root,{recursive:true,force:true});}};
}
it('binds persistent default profile to actual OS identity and exact approved invocation, not audit login or client profile',()=>{
 const f=fixture();try{
  expect(()=>f.registry.enroll(proposal,{peer,requestSource:'agent',authorization:{}})).toThrow(/source/);
  const owner=f.registry.enroll(proposal,f.context());expect(owner).toMatchObject({ownerKind:'task',ownerId:'task'});
  expect(f.registry.resolveOwnerKey({...peer,auditSessionId:8},invocation)).toBe(JSON.stringify({ownerId:owner.ownerId,ownerKind:owner.ownerKind,profileId:owner.profileId}));
  expect(()=>f.registry.resolveOwnerKey(peer,{...invocation,validationInvocationId:'forged'})).toThrow(/invocation/);
  expect(()=>f.registry.enroll({...proposal,ownerId:'different'},f.context())).toThrow(/binding/);
  const restarted=createProfileOwnerRegistry(f.options);expect(restarted.enroll(proposal,f.context())).toEqual(owner);
  f.reuse();expect(()=>restarted.resolveOwnerKey(peer,invocation)).toThrow(/identity/);expect(()=>restarted.enroll(proposal,f.context())).toThrow(/identity/);
 }finally{f.close();}
});
it('keeps durable pending intent after publication failure, never routes it, and resumes the same profile with fresh authorization',()=>{
 const f=fixture();try{
  f.fail();const context=f.context();expect(()=>f.registry.enroll(proposal,context)).toThrow('directory_barrier');
  const pending=f.database.prepare('SELECT profile_id,state FROM verification_profiles').get() as {profile_id:string;state:string};expect(pending.state).toBe('pending');
  expect(()=>f.registry.resolveOwnerKey(peer,invocation)).toThrow(/pending/);
  f.allow();expect(()=>f.registry.enroll(proposal,context)).toThrow(/native_authorization/);
  const restarted=createProfileOwnerRegistry(f.options),owner=restarted.enroll(proposal,f.context());expect(owner.profileId).toBe(pending.profile_id);
  expect(f.database.prepare('SELECT COUNT(*) n FROM verification_profiles').get()).toEqual({n:1});
 }finally{f.close();}
});
it('leaves pending when authorization expires during index publication and rejects outer transactions before consumption',()=>{
 const f=fixture();let expired=false;const registry=createProfileOwnerRegistry({...f.options,assertEnrollmentCurrent:()=>{if(expired)throw Error('expired');},publishProfile:index=>{f.options.publishProfile(index);expired=true;}});
 try{
  const context=f.context();expect(()=>f.database.transaction(()=>registry.enroll(proposal,context))()).toThrow(/outer_transaction/);
  expect(()=>registry.enroll(proposal,context)).toThrow('expired');
  expect(f.database.prepare('SELECT state FROM verification_profiles').get()).toEqual({state:'pending'});
 }finally{f.close();}
});
it('resolves only the active current OS account owner without a caller profile or invocation grant',()=>{
 const f=fixture();try{
  const owner=f.registry.enroll(proposal,f.context());expect(f.registry.resolveOwner(peer,{ownerKind:'task',ownerId:'task'})).toEqual(owner);
  expect(()=>f.registry.resolveOwner(peer,{ownerKind:'task',ownerId:'missing'})).toThrow(/owner/);
  expect(()=>f.registry.resolveOwner(peer,{profileId:'forged',ownerKind:'task',ownerId:'task'} as any)).toThrow(/shape/);
  expect(()=>f.registry.resolveOwner({...peer,uid:502},{ownerKind:'task',ownerId:'task'})).toThrow();
  f.database.prepare("UPDATE verification_registered_owners SET state='pending'").run();expect(()=>f.registry.resolveOwner(peer,{ownerKind:'task',ownerId:'task'})).toThrow(/owner/);
 }finally{f.close();}
});
it('issues same-session capacity bindings from actual registered invocations and keeps different owners in one session',async()=>{const {readProfileCapacityOwnerBinding}=await import('../../../src/runtime/verification/profile-owner-registry.js');const f=fixture();try{f.registry.enroll(proposal,f.context());const next={...invocation,compoundOperationId:'second',validationInvocationId:'second'};f.registry.enroll({...proposal,ownerId:'second-owner',invocations:[next]},f.context());const first=f.registry.createCapacityOwnerBinding(peer,invocation),second=f.registry.createCapacityOwnerBinding(peer,next),a=readProfileCapacityOwnerBinding(first,f.database),b=readProfileCapacityOwnerBinding(second,f.database);expect(a.ownerKey).not.toBe(b.ownerKey);expect(a.sessionKey).toBe(b.sessionKey);expect(()=>readProfileCapacityOwnerBinding({...first},f.database)).toThrow('profile_capacity_binding');f.reuse();expect(()=>readProfileCapacityOwnerBinding(first,f.database)).toThrow('profile_registry_identity_changed');}finally{f.close();}});
it.each(['throw','thenable','reentrant'] as const)('keeps activation pending if final private callback fails: %s', mode => {
 const f=fixture();let calls=0;let registry:ReturnType<typeof createProfileOwnerRegistry>;
 registry=createProfileOwnerRegistry({...f.options,commitEnrollment(){calls++;expect(f.database.inTransaction).toBe(true);
  if(mode==='throw')throw Error('commit failure');if(mode==='thenable')return Promise.resolve() as never;
  registry.resolveOwnerKey(peer,invocation);
 }});
 try{expect(()=>registry.enroll(proposal,f.context())).toThrow(mode==='throw'?'commit failure':mode==='thenable'?'profile_registry_sync':'profile_registry_reentrant');
  expect(calls).toBe(1);expect(f.database.prepare('SELECT state FROM verification_registered_invocations').get()).toEqual({state:'pending'});
  expect(()=>registry.resolveOwnerKey(peer,invocation)).toThrow(/pending/);
 }finally{f.close();}
});
