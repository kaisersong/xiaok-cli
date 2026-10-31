import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {rmSync} from 'node:fs';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import * as handoff from '../../../src/runtime/verification/installed-maintenance-handoff.js';
import * as runners from '../../../src/runtime/isolated-execution/docker-runner.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

async function originalPreparedRaw(f:Awaited<ReturnType<typeof installedControllerFixture>>){
 const invocation={sessionIdentity:'maintenance-control',compoundOperationId:randomUUID(),validationInvocationId:randomUUID()},signal=new AbortController().signal;
 const recipe={kind:'artifact-content' as const,checks:[{id:'original',path:'result',sha256:'a'.repeat(64),structure:'bytes' as const}]},compiled=f.composition.privateHost.recipes.compile(recipe);
 const enrollment=f.composition.privateHost.enrollment,review=enrollment.prepare({enrollment:{ownerKind:'task',ownerId:randomUUID(),invocations:[invocation]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'bytes',predicateVersion:'1',semantics:'current-subject',definitionHash:compiled.definitionHash,requiredCheckIds:compiled.requiredCheckIds},recipe}],source:{kind:'new-owner'}}},f.peer);
 const {owner}=await enrollment.authorize(review.challengeId,f.peer,signal),command={argv:['/bin/true'],cwdRelative:'.'};
 const prepared=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:join(f.root,'original'),byteLimit:1}],exactCommand:command,expiresAt:105000},f.peer,signal);
 const grant=await f.material.authorize(prepared.challengeId,f.peer,signal),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal),plan=f.material.consumeMountPlan(staged.mountPlanHandle,f.peer).plan;
 const {expected}=f.raw.reserveExecution({...invocation,ownerKey:json(owner),scopeDigest:staged.scopeDigest,command,materializedInput:plan});f.raw.cancelPreparedExecution(expected);return expected;
}
function currentItems(f:Awaited<ReturnType<typeof installedControllerFixture>>){return f.database.prepare('SELECT item_id,target_json,target_hash,outcome,evidence_hash FROM verification_maintenance_handoff_items ORDER BY item_id').all();}

it('rejects copied commands and proxies without inspecting caller properties',()=>{
 let traps=0;const copied={},proxy=new Proxy({}, {get(){traps++;throw Error('read caller');},ownKeys(){traps++;throw Error('enumerate caller');}});
 expect(()=>handoff.persistInstalledMaintenanceRequest(copied)).toThrow('maintenance_handoff_command');expect(()=>handoff.persistInstalledMaintenanceRequest(proxy)).toThrow('maintenance_handoff_command');expect(traps).toBe(0);
});

it('ordinary stop and a residual terminal allocation do not manufacture cleanup requests',async()=>{
 const f=await installedControllerFixture();let expected:Awaited<ReturnType<typeof originalPreparedRaw>>|undefined;
 try{
  expected=await originalPreparedRaw(f);
  expect(f.database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'verification_maintenance_handoff%'").all()).toEqual([]);
  expect(handoff.claimInstalledMaintenanceBatch(f.lifetime)).toBeUndefined();
  await f.close(true);const db=openPrivateVerificationDatabase(f.state);
  try{expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'verification_maintenance_handoff%'").all()).toEqual([]);expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:3});}finally{db.close();}
 }finally{await f.close();}
});

it('persists only the accepted original target before I/O and keeps ack monotonic',async()=>{
 const f=await installedControllerFixture(),actual=handoff.persistInstalledMaintenanceRequest,paused=Error('accepted request not yet deleted');let copied:object|undefined;
 try{
  const expected=await originalPreparedRaw(f),spy=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{actual(command);copied={...command};throw paused;});
  try{await expect(f.raw.cleanupExecution(expected)).rejects.toBe(paused);}finally{spy.mockRestore();}
  expect(()=>handoff.persistInstalledMaintenanceRequest(copied!)).toThrow('maintenance_handoff_command');
  const before=f.database.prepare<[],{target_json:string;target_hash:string;outcome:string;evidence_hash:string|null}>('SELECT * FROM verification_maintenance_handoff_items').get();expect(before).toBeDefined();expect(before!.outcome).toBe('requested');expect(before!.evidence_hash).toBeNull();
  expect(f.database.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:3});
  await f.raw.cleanupExecution(expected);const completed=currentItems(f);expect(completed).toEqual([expect.objectContaining({target_json:before!.target_json,target_hash:before!.target_hash,outcome:'completed',evidence_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})]);
  await f.raw.cleanupExecution(expected);expect(currentItems(f)).toEqual(completed);
 }finally{await f.close();}
});

it('refuses a seal before actual whole-root drain, even after the real stack closed',async()=>{
 const f=await installedControllerFixture();
 try{expect(()=>handoff.sealInstalledMaintenanceRequests(f.lifetime,f.stack)).toThrow('installed_stack_drain_unknown');await f.stack.close();expect(()=>handoff.sealInstalledMaintenanceRequests(f.lifetime,f.stack)).toThrow('installed_controller_drain_unknown');}
 finally{await f.close();}
});

it('joins the same accepted raw cleanup before root can seal or close the database',async()=>{
 const constructor=vi.spyOn(runners,'createDockerRunner'),f=await installedControllerFixture();let release!:()=>void;const gate=new Promise<void>(yes=>{release=yes;});
 const input=constructor.mock.calls.find(([options])=>options.database===f.database);if(!input)throw Error('actual raw constructor missing');
 const engine=input[0].engine,original=engine.isVolumeAbsent.bind(engine),inspection=vi.spyOn(engine,'isVolumeAbsent').mockImplementation(async volume=>{await gate;return original(volume);});let cleanup:Promise<void>|undefined,closing:Promise<void>|undefined;
 try{
  const expected=await originalPreparedRaw(f);cleanup=f.raw.cleanupExecution(expected);closing=f.installed.close();
  await Promise.resolve();expect(f.database.open).toBe(true);expect(f.database.prepare('SELECT phase FROM verification_maintenance_handoffs').get()).toEqual({phase:'requested'});
  release();await cleanup;await closing;expect(f.database.open).toBe(false);
  const db=openPrivateVerificationDatabase(f.state);try{expect(db.prepare('SELECT phase FROM verification_maintenance_handoffs').get()).toEqual({phase:'completed'});}finally{db.close();}
 }finally{release();inspection.mockRestore();constructor.mockRestore();await cleanup;await closing;await f.close();}
});

it('retains an unsealed request and original database when a real child close fails',async()=>{
 const f=await installedControllerFixture({onQualificationClose(){throw Error('original close failed');}}),actual=handoff.persistInstalledMaintenanceRequest,paused=Error('accepted not deleted');
 try{
  const expected=await originalPreparedRaw(f),spy=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{actual(command);throw paused;});try{await expect(f.raw.cleanupExecution(expected)).rejects.toBe(paused);}finally{spy.mockRestore();}
  await expect(f.installed.close()).rejects.toThrow('installed_controller_shutdown_unknown');expect(f.database.open).toBe(true);expect(f.database.prepare('SELECT phase,close_attempt_id FROM verification_maintenance_handoffs').get()).toEqual({phase:'requested',close_attempt_id:null});
 }finally{if(f.database.open)f.database.close();rmSync(f.root,{recursive:true,force:true});}
});

it('claims an actually sealed old-root set before construction and fences changed revisions and claim epochs',async()=>{
 const stacks=await import('../../../src/runtime/verification/installed-execution-stack.js'),f=await installedControllerFixture(),actual=handoff.persistInstalledMaintenanceRequest,paused=Error('persisted source request');
 let expected:Awaited<ReturnType<typeof originalPreparedRaw>>|undefined;
 try{
  expected=await originalPreparedRaw(f);const stop=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{actual(command);throw paused;});try{await expect(f.raw.cleanupExecution(expected)).rejects.toBe(paused);}finally{stop.mockRestore();}
  await f.close(true);let inspected=false;
  // A deliberate pre-attachment fault: the real zero-argument root has already
  // issued its claim. No replacement owner/attachment/issuer is manufactured.
  const construction=vi.spyOn(stacks,'createInstalledMaintenanceStack').mockImplementation(async input=>{
   inspected=true;const db=input.lifetime.database,original=db.prepare<[],{phase:string;revision:number;claim_epoch:string;items_hash:string;origin_epoch:string}>('SELECT * FROM verification_maintenance_handoffs').get();if(!original)throw Error('real claim missing');
   expect(original.phase).toBe('claimed');expect(original.origin_epoch).toBe(f.lifetime.serviceEpoch);expect(original.claim_epoch).toBe(input.lifetime.serviceEpoch);expect(original.claim_epoch).not.toBe(original.origin_epoch);
   expect(handoff.readInstalledMaintenanceBatch(input.batch,input.lifetime)).toEqual([expect.objectContaining({kind:'raw',expected})]);expect(()=>handoff.readInstalledMaintenanceBatch({...input.batch},input.lifetime)).toThrow('maintenance_handoff_claim');
   expect(()=>handoff.finishInstalledMaintenanceBatch(input.batch,input.lifetime,false)).toThrow('maintenance_handoff_incomplete');
   db.prepare('UPDATE verification_maintenance_handoffs SET revision=revision+1').run();expect(()=>handoff.readInstalledMaintenanceBatch(input.batch,input.lifetime)).toThrow('maintenance_handoff_fence');db.prepare('UPDATE verification_maintenance_handoffs SET revision=?').run(original.revision);
   db.prepare('UPDATE verification_maintenance_handoffs SET claim_epoch=?').run('different-actual-claim');expect(()=>handoff.finishInstalledMaintenanceBatch(input.batch,input.lifetime,true)).toThrow('maintenance_handoff_fence');db.prepare('UPDATE verification_maintenance_handoffs SET claim_epoch=?').run(original.claim_epoch);
   const targets=db.prepare('SELECT item_id,target_json,target_hash FROM verification_maintenance_handoff_items').all();handoff.finishInstalledMaintenanceBatch(input.batch,input.lifetime,true);
   expect(db.prepare('SELECT phase,claim_epoch,items_hash FROM verification_maintenance_handoffs').get()).toEqual({phase:'failed-retained',claim_epoch:original.claim_epoch,items_hash:original.items_hash});expect(db.prepare('SELECT item_id,target_json,target_hash FROM verification_maintenance_handoff_items').all()).toEqual(targets);
   expect(()=>handoff.claimInstalledMaintenanceBatch(input.lifetime)).toThrow('maintenance_handoff_claim_used');throw Error('control stopped before actual attachment');
  });
  try{await expect(installedControllerFixture({existingRoot:f.root,recoveryOnly:true})).rejects.toThrow();expect(inspected).toBe(true);}finally{construction.mockRestore();}
 }finally{await f.close();}
});

it('brands the final startup aggregate without losing the primary or actual drain error',async()=>{
 const {isInstalledControllerShutdownUnresolved}=await import('../../../src/runtime/verification/installed-controller.js');
 const primary=Error('qualification startup fault'),cleanup=Error('qualification close fault');let caught:unknown;
 try{await installedControllerFixture({onQualified(){throw primary;},onQualificationClose(){throw cleanup;}});}catch(error){caught=error;}
 function contains(error:unknown,wanted:unknown):boolean{return error===wanted||error instanceof AggregateError&&error.errors.some(item=>contains(item,wanted));}
 expect(caught).toBeInstanceOf(AggregateError);expect(contains(caught,primary)).toBe(true);expect(contains(caught,cleanup)).toBe(true);
 expect(isInstalledControllerShutdownUnresolved(caught)).toBe(true);
 expect(isInstalledControllerShutdownUnresolved(new AggregateError([caught],'installed_controller_startup_cleanup_unknown'))).toBe(false);
 expect(isInstalledControllerShutdownUnresolved({...Object(caught)})).toBe(false);
});

it.each(['pending','failed'] as const)('does not seal until the actual last owned finalizer succeeds: %s',async mode=>{
 const shutdown=await import('../../../src/runtime/verification/controller-shutdown.js'),actualClose=shutdown.closeInstalledControllerComponents;
 const f=await installedControllerFixture(),persist=handoff.persistInstalledMaintenanceRequest,paused=Error('accepted before I/O'),late=Error('last owned finalizer failed');
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(yes=>{entered=yes;}),gate=new Promise<void>(yes=>{release=yes;});let closing:Promise<void>|undefined;
 const finalizer=vi.spyOn(shutdown,'closeInstalledControllerComponents');
 try{
  const expected=await originalPreparedRaw(f),stop=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{persist(command);throw paused;});
  try{await expect(f.raw.cleanupExecution(expected)).rejects.toBe(paused);}finally{stop.mockRestore();}
  finalizer.mockImplementation(input=>{
   const list=[...(input.finalizers??[])],index=list.length-2,owned=list[index];if(!owned)throw Error('actual root finalizers missing');
   list[index]=async()=>{await owned();entered();await gate;if(mode==='failed')throw late;};
   return actualClose({...input,finalizers:list});
  });
  closing=f.installed.close();const settled=closing.then(()=>({ok:true,error:undefined}),error=>({ok:false,error}));await started;
  expect(f.database.open).toBe(true);expect(f.database.prepare('SELECT phase,close_attempt_id FROM verification_maintenance_handoffs').get()).toEqual({phase:'requested',close_attempt_id:null});
  release();const outcome=await settled;
  if(mode==='failed'){
   expect(outcome.ok).toBe(false);expect(outcome.error).toBeInstanceOf(AggregateError);if(!(outcome.error instanceof AggregateError))throw Error('actual finalizer error missing');expect(outcome.error.errors).toContain(late);
   expect(f.database.open).toBe(true);expect(f.database.prepare('SELECT phase,close_attempt_id FROM verification_maintenance_handoffs').get()).toEqual({phase:'requested',close_attempt_id:null});
  }else{
   expect(outcome.ok).toBe(true);expect(f.database.open).toBe(false);const db=openPrivateVerificationDatabase(f.state);
   try{expect(db.prepare('SELECT phase,close_attempt_id FROM verification_maintenance_handoffs').get()).toEqual({phase:'sealed',close_attempt_id:expect.any(String)});}finally{db.close();}
  }
 }finally{
  release();finalizer.mockRestore();if(closing)await closing.catch(()=>{});
  // An intentionally failed real drain is never retried/declared successful.
  // Only this test's exact DB and private directory are disposed afterwards.
  if(f.database.open)f.database.close();rmSync(f.root,{recursive:true,force:true});
 }
});

it.each(['extra-target-key','wrong-expected-primitive','extra-issuer-key'] as const)('rejects a checksum-consistent malformed durable target before maintenance construction: %s',async fault=>{
 const stacks=await import('../../../src/runtime/verification/installed-execution-stack.js'),f=await installedControllerFixture(),persist=handoff.persistInstalledMaintenanceRequest,paused=Error('accepted before I/O');
 try{
  const expected=await originalPreparedRaw(f),stop=vi.spyOn(handoff,'persistInstalledMaintenanceRequest').mockImplementation(command=>{persist(command);throw paused;});
  try{await expect(f.raw.cleanupExecution(expected)).rejects.toBe(paused);}finally{stop.mockRestore();}
  await f.close(true);const db=openPrivateVerificationDatabase(f.state);
  try{
   const row=db.prepare<[],{item_id:string;target_json:string}>('SELECT item_id,target_json FROM verification_maintenance_handoff_items').get();if(!row)throw Error('actual original request missing');
   // Deliberate durable corruption, including consistent checksums, to exercise
   // the decoder rather than merely failing the outer checksum comparison.
   const target=JSON.parse(row.target_json);
   if(fault==='extra-target-key')target.unapproved=true;
   if(fault==='wrong-expected-primitive')target.expected.sessionIdentity=7;
   if(fault==='extra-issuer-key')target.issuers[0].unapproved=true;
   const encoded=json(target),digest=(value:unknown)=>createHash('sha256').update(json(value)).digest('hex'),targetHash=digest(target);
   db.prepare('UPDATE verification_maintenance_handoff_items SET target_json=?,target_hash=? WHERE item_id=?').run(encoded,targetHash,row.item_id);
   const rows=db.prepare<[],{item_id:string;target_json:string;target_hash:string}>('SELECT item_id,target_json,target_hash FROM verification_maintenance_handoff_items ORDER BY item_id').all();
   db.prepare('UPDATE verification_maintenance_handoffs SET items_hash=?').run(digest(rows.map(item=>({itemId:item.item_id,targetJson:item.target_json,targetHash:item.target_hash}))));
  }finally{db.close();}
  const constructor=vi.spyOn(stacks,'createInstalledMaintenanceStack');
  try{await expect(installedControllerFixture({existingRoot:f.root,recoveryOnly:true})).rejects.toThrow('maintenance_handoff_target_schema');expect(constructor).not.toHaveBeenCalled();}finally{constructor.mockRestore();}
 }finally{await f.close();}
});
