import {rawCommandFaultHarness} from '../../support/raw-command-fault.js';
import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {createControllerMaterialPipeline} from '../../../src/runtime/verification/material-pipeline.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveBlobAuthority,createPrimitiveCapacityOwnerBinding} from '../../support/primitive-blob-authority.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
// Actual authority, SQLite and immutable stager. Broker metadata/native approval
// and file page retrieval are explicit leaves, not an installed OS claim.
async function fixture(onResolve?:()=>void){
 const root=mkdtempSync(join(tmpdir(),'material-handoff-')),databaseRoot=join(root,'db'),db=openPrivateVerificationDatabase(databaseRoot),body=Buffer.from('original material'),hash=createHash('sha256').update(body).digest('hex'),peer={uid:501,gid:20,auditSessionId:10},invocation={sessionIdentity:'real-session',compoundOperationId:'original-operation',validationInvocationId:'original-validation'};
 const owner=createPrimitiveBlobAuthority({database:db,authorityId:'material-handoff',assertCurrent(){},deletion:{assertDeleted(){throw Error('no physical deletion receipt');}}});const budget=owner.budget;
 const resolveOwnerKey=(p:typeof peer)=>{if(p.uid!==peer.uid||p.auditSessionId!==peer.auditSessionId)throw Error('wrong owner');onResolve?.();return 'original-owner';};
 const options={root:join(root,'bodies'),database:db,budget,engineBinding:{engineId:'engine',incarnation:'boot'},assertCurrent(){},assertCleanup(){throw Error('still in use');},resolveOwnerKey,createCapacityOwnerBinding(p:typeof peer,invocation:object){return createPrimitiveCapacityOwnerBinding({database:db,facts:{authorityId:'material-handoff',profileId:'primitive-profile',ownerKey:resolveOwnerKey(p),sessionKey:'primitive-session',invocation:invocation as Readonly<object>},assertCurrent(){}});},wallNow:()=>1000,broker:{clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),async inspectMaterial(){return {sha256:hash,size:body.length,executable:false};},async authorizeMaterials(input:any){return {uid:input.uid,auditSessionId:input.auditSessionId,reviewHash:createHash('sha256').update(canonicalVerificationJson(input.review)).digest('hex')};},async readMaterialPage(input:any){return {contentHash:hash,totalBytes:body.length,offset:input.offset,bytes:body.subarray(input.offset,input.offset+input.length).toString('base64'),executable:false};}}};
 const pipeline=createControllerMaterialPipeline(options),signal=new AbortController().signal;
 const challenge=await pipeline.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/input',byteLimit:100}],exactCommand:{argv:['/bin/sh','input'],cwdRelative:'.'},expiresAt:10000},peer,signal),grant=await pipeline.authorize(challenge.challengeId,peer,signal),prepared=await pipeline.stage({grantHandle:grant,invocation},peer,signal);
 return {root,databaseRoot,db,budget,pipeline,options,peer,invocation,challenge,prepared,body,close(){budget.close();db.close();rmSync(root,{recursive:true,force:true});}};
}
it('durably records the actual mount plan claim before returning it to a consumer',async()=>{const f=await fixture();try{
 const consumed=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);
 expect(f.pipeline.stager.readFile(consumed.plan,'input')).toEqual(f.body);
 expect(consumed.deadline).toEqual({wallExpiresAt:10000,continuousExpiresAt:9100,clockDomainId:'clock',clockQualificationEpoch:1,preparedLowerBound:100});expect(Object.isFrozen(consumed.deadline)).toBe(true);
 const fact=f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer);
 expect(fact).toMatchObject({state:'claimed',authorizationId:f.challenge.challengeId,ownerKey:'original-owner',invocation:f.invocation,scopeDigest:f.prepared.scopeDigest});
 if(fact.state!=='claimed')throw Error('expected claimed');expect(typeof fact.handoffId).toBe('string');expect(fact.handoffId.length).toBeGreaterThan(0);
 expect(()=>f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer)).toThrow();
 expect(f.db.prepare('SELECT state FROM broker_staging_intents').all()).toEqual([{state:'published'}]);
 expect(f.db.prepare('SELECT state FROM verification_blob_reservations').all()).toEqual([{state:'reserved'}]);
 }finally{f.close();}});
it('handoff observation rejects foreign principal and cannot mint a new plan',async()=>{const f=await fixture();try{
 f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);
 expect(typeof f.pipeline.inspectMountPlanHandoff).toBe('function');
 expect(()=>f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},{...f.peer,auditSessionId:11})).toThrow();
 const fact=f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer);
 expect(fact).not.toHaveProperty('mountPlanHandle');expect(fact).not.toHaveProperty('secret');expect(fact).not.toHaveProperty('plan');
 expect(()=>f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer)).toThrow();
 }finally{f.close();}});
it('actual consume changes durable SQLite facts rather than only removing an in-memory map entry',async()=>{const f=await fixture();try{const before=(f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;const consumed=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);expect(f.pipeline.stager.readFile(consumed.plan,'input')).toEqual(f.body);const after=(f.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;expect(after).toBeGreaterThan(before);}finally{f.close();}});
it.each(['ignore','tamper'] as const)('failed %s claim returns no plan, burns ticket and preserves charged material',async(mode)=>{const f=await fixture();try{
 f.db.exec(mode==='ignore'?"CREATE TRIGGER fail_claim BEFORE INSERT ON material_mount_plan_handoffs BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER fail_claim AFTER INSERT ON material_mount_plan_handoffs BEGIN UPDATE material_mount_plan_handoffs SET handoff_id='altered' WHERE authorization_id=NEW.authorization_id; END");
 expect(()=>f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer)).toThrow('material_handoff_commit');expect(f.db.prepare('SELECT * FROM material_mount_plan_handoffs').all()).toEqual([]);f.db.exec('DROP TRIGGER fail_claim');expect(()=>f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer)).toThrow('material_plan');expect(f.db.prepare('SELECT state FROM broker_staging_intents').all()).toEqual([{state:'published'}]);expect(f.db.prepare('SELECT state FROM verification_blob_reservations').all()).toEqual([{state:'reserved'}]);
 }finally{f.close();}});
it('retains claim after actual database reopen and challenge retirement without reviving grant',async()=>{const f=await fixture();let closed=false;try{
 const consumed=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer),original=f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer);expect(f.pipeline.readMountPlanHandoff(consumed.handoff)).toEqual(original);expect(()=>f.pipeline.readMountPlanHandoff({...consumed.handoff})).toThrow('material_handoff_ticket');
 f.db.prepare('DELETE FROM material_authority_challenges WHERE id=?').run(f.challenge.challengeId);f.budget.close();f.db.close();closed=true;
 const db=openPrivateVerificationDatabase(f.databaseRoot),budget=createPrimitiveBlobAuthority({database:db,authorityId:'material-handoff',assertCurrent(){},deletion:{assertDeleted(){throw Error('no deletion receipt');}}}).budget;try{const pipeline=createControllerMaterialPipeline({...f.options,database:db,budget,wallNow:()=>999999});expect(pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toEqual(original);expect(()=>pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer)).toThrow('material_plan');expect(()=>pipeline.readMountPlanHandoff(consumed.handoff)).toThrow('material_handoff_ticket');}finally{budget.close();db.close();}
 }finally{if(!closed){f.budget.close();f.db.close();}rmSync(f.root,{recursive:true,force:true});}});
it('detects mutated durable claim or original staging record',async()=>{const f=await fixture();try{
 f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);const record=f.db.prepare('SELECT record_json FROM material_mount_plan_handoffs').get() as {record_json:string};const value=JSON.parse(record.record_json);value.authorization.ownerKey='different-owner';f.db.prepare('UPDATE material_mount_plan_handoffs SET record_json=?').run(JSON.stringify(value));expect(()=>f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toThrow();f.db.prepare('UPDATE material_mount_plan_handoffs SET record_json=?').run(record.record_json);
 const resource=f.db.prepare('SELECT record_json FROM broker_staging_intents').get() as {record_json:string};const changed=JSON.parse(resource.record_json);changed.manifest.command.argv=['other'];f.db.prepare('UPDATE broker_staging_intents SET record_json=?').run(JSON.stringify(changed));expect(()=>f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toThrow('material_handoff_resource');
 }finally{f.close();}});
it('unconsumed material is only an unclaimed observation, and new owner resolution can deny history',async()=>{const f=await fixture();try{expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toEqual({state:'unclaimed',authorizationId:f.challenge.challengeId});f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);const other=createControllerMaterialPipeline({...f.options,resolveOwnerKey(){return 'different-owner';}});expect(()=>other.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toThrow('material_handoff_owner');}finally{f.close();}});
it('rechecks durable handoff after the captured owner resolver callback',async()=>{const f=await fixture();try{f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);const reader=createControllerMaterialPipeline({...f.options,resolveOwnerKey(){f.db.prepare("UPDATE material_mount_plan_handoffs SET handoff_id=?").run('b'.repeat(36));return 'original-owner';}});expect(()=>reader.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toThrow('material_handoff_changed');}finally{f.close();}});

import {createDockerRunner} from '../../../src/runtime/isolated-execution/docker-runner.js';
function rawFor(f:Awaited<ReturnType<typeof fixture>>){return rawCommandFaultHarness(createDockerRunner({database:f.db,budget:f.budget,engine:{} as any,engineBinding:{engineId:'engine',incarnation:'boot',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:f.pipeline.stager,outputBytes:4096}),f.db);}
function reservationInput(f:Awaited<ReturnType<typeof fixture>>,plan:any,ownerKey='original-owner'){return {...f.invocation,ownerKey,scopeDigest:f.prepared.scopeDigest,command:f.prepared.command,materializedInput:plan};}
it('binds the real plan to the actual raw reservation in its original private transaction',async()=>{const f=await fixture(),raw=rawFor(f);try{
 const material=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);
 let oldTransaction:object|undefined;
 const reserved=raw.withReservationTransaction(transaction=>{oldTransaction=transaction;const value=raw.reserveExecution(reservationInput(f,material.plan),transaction);f.pipeline.attachMountPlanHandoff(material.handoff,transaction,value.expected);return value;});
 expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'attached',expected:reserved.expected});
 expect(()=> f.pipeline.attachMountPlanHandoff(material.handoff,oldTransaction!,reserved.expected)).toThrow();
 expect(raw.readExecution(reserved.expected).state).toBe('prepared');
 }finally{raw.close();f.close();}});
it.each(['rollback','ignore','tamper','fake-token','wrong-owner'] as const)('attachment %s keeps the original claim and rolls back all raw reservation facts',async mode=>{const f=await fixture(),raw=rawFor(f);try{
 const material=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);
 if(mode==='ignore')f.db.exec("CREATE TRIGGER attachment_fault BEFORE UPDATE ON material_mount_plan_handoffs BEGIN SELECT RAISE(IGNORE); END");
 if(mode==='tamper')f.db.exec("CREATE TRIGGER attachment_fault AFTER UPDATE ON material_mount_plan_handoffs BEGIN UPDATE material_mount_plan_handoffs SET handoff_id='tampered' WHERE authorization_id=NEW.authorization_id; END");
 let expected:any;
 // Under the shared binding the wrong-owner reservation is now rejected inside the
 // reserve transaction before an expected handle is returned; capture the handle
 // (and the in-memory uncommitted plan) with a correct-owner pass that rolls back.
 if(mode==='wrong-owner')expect(()=>raw.withReservationTransaction(transaction=>{expected=raw.reserveExecution(reservationInput(f,material.plan),transaction).expected;throw Error('capture expected with rollback');})).toThrow();
 expect(()=>raw.withReservationTransaction(transaction=>{const reserved=raw.reserveExecution(reservationInput(f,material.plan,mode==='wrong-owner'?'other':'original-owner'),transaction);expected=reserved.expected;f.pipeline.attachMountPlanHandoff(material.handoff,mode==='fake-token'?{}:transaction,expected);if(mode==='rollback')throw Error('original outer transaction failure');})).toThrow();
 expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});
 expect(f.db.prepare('SELECT * FROM execution_attempts').all()).toEqual([]);expect(f.db.prepare('SELECT * FROM docker_runner_resources').all()).toEqual([]);
 expect(f.db.prepare('SELECT kind,state FROM verification_blob_reservations').all()).toEqual([{kind:'host-staging',state:'reserved'}]);
 raw.discardUncommittedExecution(expected);
 }finally{raw.close();f.close();}});


// Only installed OS engine/qualification branding are leaves. The material,
// public consumer, transaction, raw driver and both durable journals are real.
vi.mock('../../../src/runtime/verification/installed-engine.js',()=>({assertInstalledMacEngineHandle(){},assertInstalledEngineDatabase(){}}));
vi.mock('../../../src/runtime/verification/installed-engine-qualification.js',()=>({assertInstalledEngineQualification(){}}));
import {createInstalledExecutionController} from '../../../src/runtime/verification/installed-execution-controller.js';
it.each([false,true])('execution.reserve attaches in its actual raw transaction (lost attachment=%s)',async fault=>{const f=await fixture();
 const controller=createInstalledExecutionController({engine:{hostSocket:join(f.root,'unused.sock'),imageDigest:'sha256:'+'b'.repeat(64)} as any,database:f.db,budget:f.budget,materials:f.pipeline,
  qualification:{currentFacts(){return {engineBinding:f.options.engineBinding};},async ensureCurrent(){}} as any,resolveOwnerKey(){return 'original-owner';},readApprovedRecipeBinding(){throw Error('no recipe invocation');},onActualExecutionResult(){throw Error('no execution');}});
 try{
  if(fault)f.db.exec("CREATE TRIGGER attachment_fault BEFORE UPDATE ON material_mount_plan_handoffs BEGIN SELECT RAISE(IGNORE); END");
  const pending=controller.publicPort.invoke('execution.reserve',{mountPlanHandle:f.prepared.mountPlanHandle,invocation:f.invocation,command:f.prepared.command,scopeDigest:f.prepared.scopeDigest},f.peer,new AbortController().signal);
  if(fault){await expect(pending).rejects.toThrow('material_handoff_attach_commit');expect(f.db.prepare('SELECT * FROM execution_attempts').all()).toEqual([]);expect(f.db.prepare('SELECT * FROM docker_runner_resources').all()).toEqual([]);expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});}
  else {const reserved=await pending as any;expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'attached',expected:reserved.expected});expect(controller.privateHost.raw.readExecution(reserved.expected).state).toBe('prepared');}
 }finally{await controller.close();f.close();}
});
it('rejects another transaction, cloned ticket and a reservation for another real staged plan',async()=>{const f=await fixture(),raw=rawFor(f);try{
 const first=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer),signal=new AbortController().signal;
 const invocation={...f.invocation,compoundOperationId:'second-operation'};
 const challenge=await f.pipeline.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/input',byteLimit:100}],exactCommand:f.prepared.command,expiresAt:10000},f.peer,signal),grant=await f.pipeline.authorize(challenge.challengeId,f.peer,signal),second=await f.pipeline.stage({grantHandle:grant,invocation},f.peer,signal),consumed=f.pipeline.consumeMountPlan(second.mountPlanHandle,f.peer);
 const original=raw.withReservationTransaction(transaction=>raw.reserveExecution(reservationInput(f,first.plan),transaction));
 expect(()=>raw.withReservationTransaction(transaction=>f.pipeline.attachMountPlanHandoff(first.handoff,transaction,original.expected))).toThrow('docker_reservation_handoff_changed');
 let expected:any;
 expect(()=>raw.withReservationTransaction(transaction=>{const reserved=raw.reserveExecution({...invocation,ownerKey:'original-owner',scopeDigest:second.scopeDigest,command:second.command,materializedInput:consumed.plan},transaction);expected=reserved.expected;expect(()=>f.pipeline.attachMountPlanHandoff({...consumed.handoff},transaction,expected)).toThrow('material_handoff_ticket');f.pipeline.attachMountPlanHandoff(consumed.handoff,transaction,original.expected);})).toThrow('docker_reservation_handoff_changed');
 raw.discardUncommittedExecution(expected);expect(f.pipeline.inspectMountPlanHandoff({authorizationId:challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});
 }finally{raw.close();f.close();}});
it('rejects a live transaction and same-looking original invocation from another actual database',async()=>{const f=await fixture(),other=await fixture(),raw=rawFor(other);let expected:any;try{const first=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer),second=other.pipeline.consumeMountPlan(other.prepared.mountPlanHandle,other.peer);expect(()=>raw.withReservationTransaction(transaction=>{const reserved=raw.reserveExecution(reservationInput(other,second.plan),transaction);expected=reserved.expected;f.pipeline.attachMountPlanHandoff(first.handoff,transaction,expected);})).toThrow('docker_reservation_handoff_transaction');expect(other.db.prepare('SELECT * FROM execution_attempts').all()).toEqual([]);expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});raw.discardUncommittedExecution(expected);}finally{raw.close();other.close();f.close();}});
it('rejects wrong actual plan for a reservation made in the same live private transaction',async()=>{const f=await fixture(),raw=rawFor(f);const made:any[]=[];try{const first=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer),signal=new AbortController().signal,invocation={...f.invocation,compoundOperationId:'second-operation'};const challenge=await f.pipeline.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/input',byteLimit:100}],exactCommand:f.prepared.command,expiresAt:10000},f.peer,signal),grant=await f.pipeline.authorize(challenge.challengeId,f.peer,signal),stage=await f.pipeline.stage({grantHandle:grant,invocation},f.peer,signal),second=f.pipeline.consumeMountPlan(stage.mountPlanHandle,f.peer);
 expect(()=>raw.withReservationTransaction(transaction=>{const b=raw.reserveExecution({...invocation,ownerKey:'original-owner',scopeDigest:stage.scopeDigest,command:stage.command,materializedInput:second.plan},transaction);made.push(b.expected);f.pipeline.attachMountPlanHandoff(first.handoff,transaction,b.expected);})).toThrow('material_handoff_execution');expect(f.db.prepare('SELECT * FROM execution_attempts').all()).toEqual([]);for(const expected of made)raw.discardUncommittedExecution(expected);expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});
 }finally{raw.close();f.close();}});
it('final owner callback modifying raw journal cannot commit an attached handoff',async()=>{let mutate=()=>{};const f=await fixture(()=>mutate()),raw=rawFor(f);let expected:any,changed=false;try{const material=f.pipeline.consumeMountPlan(f.prepared.mountPlanHandle,f.peer);mutate=()=>{if((f.db.prepare('SELECT state FROM material_mount_plan_handoffs').get() as any)?.state==='attached'){changed=true;f.db.prepare("UPDATE execution_attempts SET state='unknown'").run();}};expect(()=>raw.withReservationTransaction(transaction=>{const value=raw.reserveExecution(reservationInput(f,material.plan),transaction);expected=value.expected;f.pipeline.attachMountPlanHandoff(material.handoff,transaction,expected);})).toThrow(/handoff_changed/);expect(changed).toBe(true);mutate=()=>{};expect(f.pipeline.inspectMountPlanHandoff({authorizationId:f.challenge.challengeId},f.peer)).toMatchObject({state:'claimed'});expect(f.db.prepare('SELECT * FROM execution_attempts').all()).toEqual([]);raw.discardUncommittedExecution(expected);}finally{mutate=()=>{};raw.close();f.close();}});
