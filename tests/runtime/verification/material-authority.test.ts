import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createMaterialAuthority} from '../../../src/runtime/verification/material-authority.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
it('persists one-shot OS approval intent, rejects peer substitution and does not renew expired GUI time',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-authority-')),db=openPrivateVerificationDatabase(root);let continuous=100,approvals=0;
 const peer={uid:501,gid:20,auditSessionId:10},draft={purpose:'isolated-command' as const,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:1100};
 const options={database:db,engineBinding:{engineId:'engine',incarnation:'boot'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:continuous,upperBound:continuous,evidenceHash:'a'.repeat(64)}),wallNow:()=>1000,inspectFile:async()=>({sha256:'a'.repeat(64),size:3,executable:false}),approve:async(_peer:any,review:any)=>{approvals++;continuous=201;return {uid:_peer.uid,auditSessionId:_peer.auditSessionId,reviewHash:createHash('sha256').update(canonicalVerificationJson(review)).digest('hex')};},acceptPlan(){},discardPlan(){},stage:async()=>({}) as any};
 const authority=createMaterialAuthority(options);
 try{const challenge=await authority.prepare(draft,peer,new AbortController().signal);
  await expect(authority.authorize(challenge.challengeId,{...peer,auditSessionId:11},new AbortController().signal)).rejects.toThrow();expect(approvals).toBe(0);
  await expect(authority.authorize(challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow('material_deadline_expired');expect(approvals).toBe(1);
  continuous=101;await expect(authority.authorize(challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();expect(approvals).toBe(1);
  const reopened=createMaterialAuthority(options);await expect(reopened.authorize(challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow();expect(approvals).toBe(1);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('binds a live staged plan to one authenticated peer and revokes the underlying host grant',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-authority-plan-')),db=openPrivateVerificationDatabase(root);let grant:object|undefined,stages=0;
 const peer={uid:501,gid:20,auditSessionId:10},invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},plan={} as any;
 const authority=createMaterialAuthority({database:db,engineBinding:{engineId:'e',incarnation:'b'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),wallNow:()=>1000,inspectFile:async()=>({sha256:'a'.repeat(64),size:3,executable:false}),approve:async(_peer,review)=>({uid:_peer.uid,auditSessionId:_peer.auditSessionId,reviewHash:createHash('sha256').update(canonicalVerificationJson(review)).digest('hex')}),acceptPlan(){},discardPlan(){},stage:async(g)=>{grant=g;stages++;return plan;}});
 try{
  const challenge=await authority.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:10000},peer,new AbortController().signal);
  db.exec('BEGIN IMMEDIATE');await expect(authority.authorize(challenge.challengeId,peer,new AbortController().signal)).rejects.toThrow('material_outer_transaction');db.exec('ROLLBACK');const handle=await authority.authorize(challenge.challengeId,peer,new AbortController().signal);
  db.exec('BEGIN IMMEDIATE');await expect(authority.stage({grantHandle:handle,invocation},peer,new AbortController().signal)).rejects.toThrow('material_outer_transaction');expect(stages).toBe(0);db.exec('ROLLBACK');
  const prepared=await authority.stage({grantHandle:handle,invocation},peer,new AbortController().signal);
  await expect(authority.stage({grantHandle:handle,invocation},peer,new AbortController().signal)).rejects.toThrow();expect(stages).toBe(1);
  expect(()=>authority.consumeMountPlan(prepared.mountPlanHandle,{...peer,uid:502})).toThrow();
  // This fixture intentionally has no actual stager identity. The production pipeline
  // positive test retains real-plan consumption and the exact frozen deadline.
  expect(()=>authority.consumeMountPlan(prepared.mountPlanHandle,peer)).toThrow('broker_staging_capacity_plan');
  expect(()=>authority.consumeMountPlan(prepared.mountPlanHandle,peer)).toThrow();
  authority.assertGrant(grant!);db.exec('BEGIN IMMEDIATE');expect(()=>authority.revoke(handle.id,peer)).toThrow('material_outer_transaction');db.exec('ROLLBACK');authority.assertGrant(grant!);authority.revoke(handle.id,peer);expect(()=>authority.assertGrant(grant!)).toThrow();
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('retires rejected or revoked authorization tickets without retaining unlimited full reviews or reviving old handles',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-retire-')),db=openPrivateVerificationDatabase(root);let approvals=0;
 const peer={uid:501,gid:20,auditSessionId:10},signal=new AbortController().signal;
 const authority=createMaterialAuthority({database:db,engineBinding:{engineId:'e',incarnation:'b'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),wallNow:()=>1000,inspectFile:async()=>({sha256:'a'.repeat(64),size:3,executable:false}),approve:async()=>{approvals++;throw Error('not approved');},acceptPlan(){},discardPlan(){},stage:async()=>{throw Error('not staged');}});
 try{let first='';for(let i=0;i<128;i++){const c=await authority.prepare({purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'op'+i,validationInvocationId:'v'},materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:10000},peer,signal);if(!first)first=c.challengeId;authority.revoke(c.challengeId,peer);}
 expect((db.prepare('SELECT count(*) n FROM material_authority_challenges').get() as {n:number}).n).toBeLessThanOrEqual(1);await expect(authority.authorize(first,peer,signal)).rejects.toThrow();expect(approvals).toBe(0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('does not resurrect an old lifetime approval when the GUI returns after its durable ticket was retired',async()=>{
 const root=mkdtempSync(join(tmpdir(),'material-gui-retired-')),db=openPrivateVerificationDatabase(root),peer={uid:501,gid:20,auditSessionId:10},signal=new AbortController().signal;
 let finish!:(value:{uid:number;auditSessionId:number;reviewHash:string})=>void,pendingReview:any;
 const options={database:db,engineBinding:{engineId:'e',incarnation:'b'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),wallNow:()=>1000,inspectFile:async()=>({sha256:'a'.repeat(64),size:3,executable:false}),approve:async(_peer:any,review:any)=>{pendingReview=review;return new Promise<{uid:number;auditSessionId:number;reviewHash:string}>(resolve=>{finish=resolve;});},acceptPlan(){},discardPlan(){},stage:async()=>({}) as any};
 const draft={purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:10000};
 try{const first=createMaterialAuthority(options),challenge=await first.prepare(draft,peer,signal),pending=first.authorize(challenge.challengeId,peer,signal);const assertion=expect(pending).rejects.toThrow('material_challenge_consumed');const second=createMaterialAuthority(options);await second.prepare(draft,peer,signal);expect(db.prepare('SELECT id FROM material_authority_challenges WHERE id=?').get(challenge.challengeId)).toBeUndefined();finish({uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:createHash('sha256').update(canonicalVerificationJson(pendingReview)).digest('hex')});await assertion;
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('retires an expired scope durably so wall-clock rollback cannot restore cleanup admission',async()=>{const root=mkdtempSync(join(tmpdir(),'material-retire-')),db=openPrivateVerificationDatabase(root);let wall=1000;const peer={uid:501,gid:20,auditSessionId:10},signal=new AbortController().signal;const a=createMaterialAuthority({database:db,engineBinding:{engineId:'e',incarnation:'i'},clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),wallNow:()=>wall,inspectFile:async()=>({sha256:'a'.repeat(64),size:1,executable:false}),approve:async()=>{throw Error('no GUI');},acceptPlan(){},discardPlan(){},stage:async()=>({}) as any});try{const c=await a.prepare({purpose:'isolated-command',invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},materials:[{path:'/workspace/input',byteLimit:10}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:1100},peer,signal);expect(()=>a.assertScopeInactive(c.canonicalReview.scopeDigest)).toThrow('active');wall=1200;a.assertScopeInactive(c.canonicalReview.scopeDigest);expect(db.prepare('SELECT state FROM material_authority_challenges').get()).toEqual({state:'expired'});wall=1000;a.assertScopeInactive(c.canonicalReview.scopeDigest);await expect(a.authorize(c.challengeId,peer,signal)).rejects.toThrow('consumed');}finally{db.close();rmSync(root,{recursive:true,force:true});}});
