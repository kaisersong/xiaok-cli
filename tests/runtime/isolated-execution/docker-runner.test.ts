import * as rawCommands from '../../../src/runtime/isolated-execution/docker-runner.js';
import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveMaterialHarness,createPrimitiveInputArchiveEngine} from '../../support/primitive-blob-authority.js';
import {createDockerRunner} from '../../../src/runtime/isolated-execution/docker-runner.js';
it('durably reserves exact volume resources before dispatch and never recreates an uncertain attempt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'docker-runner-')),db=openPrivateVerificationDatabase(root);let creates=0;
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'docker-runner-brand',engineBinding:{engineId:'e',incarnation:'one'}});
 const budget=harness.budget;
 const command={argv:['/bin/true'],cwdRelative:'.'};const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};const staged=await harness.stagePlan(invocation,command);const plan=staged.plan;const manifest={files:[],command,scopeDigest:staged.scopeDigest,invocation};
 const runner=createDockerRunner({database:db,budget,engine:{async createVolume(){creates++;throw Error('lost response');}} as any,engineBinding:{engineId:'e',incarnation:'one',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:harness.pipeline.stager,outputBytes:4096});
 try{let called=false;expect(()=>runner.reserveCommand((()=>{called=true;db.exec('COMMIT');}) as object)).toThrow('execution_command_brand');expect(called).toBe(false);expect(db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:0});const input={ownerKey:'owner',sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',scopeDigest:manifest.scopeDigest,command,materializedInput:plan};expect(()=>runner.reserveExecution({...input,validationInvocationId:'other'})).toThrow('docker_runner_material_changed');const reserved=runner.reserveExecution(input);expect(creates).toBe(0);await expect(runner.dispatchExecution(reserved.expected)).rejects.toThrow('lost response');expect(creates).toBe(1);expect(runner.readExecution(reserved.expected).state).toBe('unknown');await expect(runner.dispatchExecution(reserved.expected)).rejects.toThrow();expect(creates).toBe(1);}
 finally{runner.close();budget.close();harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it.each([false,true])('keeps capacity after a lost physical deletion reply and reconciles exact resources after restart (attach failure=%s)',async(attachFailure)=>{
 const root=mkdtempSync(join(tmpdir(),'docker-runner-cleanup-')),db=openPrivateVerificationDatabase(root);
 const volumes=new Map<string,unknown>(),containers=new Map<string,any>();let serial=0,lost=true;
 let runner:ReturnType<typeof createDockerRunner>;
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'docker-runner-cleanup',engineBinding:{engineId:'e',incarnation:'one'},deletion:{assertDeleted(proof,proposal){runner.deletionAuthority.assertDeleted(proof,proposal);}}});const budget=harness.budget;const revoke=()=>db.prepare("UPDATE broker_staging_intents SET state='revoked'").run();
 const inputArchive=createPrimitiveInputArchiveEngine();const engine={...inputArchive.engine,
  async createVolume(v:any){volumes.set(v.name,v);},async inspectVolume(v:any){if(!volumes.has(v.name))throw Error('missing');},
  async createMounted(body:any){const Id=(++serial).toString(16).padStart(64,'0');containers.set(Id,{Id,Image:body.Image,HostConfig:body.HostConfig,Config:body,State:{Running:false,Pid:0,Status:'created',ExitCode:0}});return {Id};},
  async inspect(id:string){const c=containers.get(id);if(!c)throw Error('missing');return c;},
  async attachOutput(id:string){expect(containers.get(id).State.Status).toBe('created');if(attachFailure)throw Error('attach unavailable before start');return {completed:Promise.resolve({complete:true,truncated:false,stdout:Buffer.from('actual captured stream'),stderr:Buffer.alloc(0)}),cancel(){}};},
  async start(id:string){Object.assign(containers.get(id).State,{Running:true,Pid:1,Status:'running'});},
  async wait(id:string){Object.assign(containers.get(id).State,{Running:false,Pid:0,Status:'exited'});},
  async kill(id:string){Object.assign(containers.get(id).State,{Running:false,Pid:0,Status:'exited'});},
  async isContainerAbsent(id:string){return !containers.has(id);},async remove(id:string){containers.delete(id);},
  async isVolumeAbsent(v:any){return !volumes.has(v.name);},async removeVolume(v:any){volumes.delete(v.name);if(lost){lost=false;throw Error('reply lost after deletion');}},
 };
 const command={argv:['/bin/true'],cwdRelative:'.'};const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'};const stagedPlan=await harness.stagePlan(invocation,command),plan=stagedPlan.plan,manifest={files:[],command,scopeDigest:stagedPlan.scopeDigest,invocation};
 const options={database:db,budget,engine:engine as any,engineBinding:{engineId:'e',incarnation:'one',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:harness.pipeline.stager,outputBytes:4096};
 runner=createDockerRunner(options);
 try{
  const {expected}=runner.reserveExecution({ownerKey:'owner',sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',scopeDigest:manifest.scopeDigest,command,materializedInput:plan});
  db.exec('BEGIN IMMEDIATE');await expect(runner.dispatchExecution(expected)).rejects.toThrow('docker_runner_outer_transaction');db.exec('ROLLBACK');if(attachFailure){await expect(runner.dispatchExecution(expected)).rejects.toThrow('attach unavailable before start');expect(runner.readExecution(expected)).toMatchObject({state:'terminal',cancelledBeforeStart:true});expect(runner.readExecution(expected).exitCode).toBeUndefined();await expect(runner.inspectCancellationFacts(expected)).rejects.toThrow('cancellation_resources_present');}else{const result=await runner.dispatchExecution(expected);runner.assertOutputDisclosure(result.output,{expected});revoke();expect(runner.readCapturedOutput(result.output,{expected}).stdout.toString()).toBe('actual captured stream');expect(()=>runner.assertOutputDisclosure(result.output,{expected})).toThrow('broker_staging_state');expect(()=>runner.readCapturedOutput({}, {expected})).toThrow('docker_runner_output_binding');}revoke();
  await expect(runner.cleanupExecution(expected)).rejects.toThrow('reply lost');
  expect(db.prepare('SELECT state FROM verification_blob_reservations').all()).toEqual([{state:'reserved'},{state:'reserved'},{state:'reserved'}]);
  runner.close();runner=createDockerRunner(options);
  await runner.cleanupExecution(expected);
  expect(volumes.size).toBe(0);expect(containers.size).toBe(0);
  if(!attachFailure){expect((await runner.inspectExecutionFacts(expected)).exitCode).toBe(0);const row=db.prepare('SELECT resources_json FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity) as {resources_json:string};const resources=JSON.parse(row.resources_json);volumes.set(resources.input.name,resources.input);await expect(runner.inspectExecutionFacts(expected)).rejects.toThrow('docker_runner_cleanup_unknown');volumes.clear();}
  // staging reservation stays charged; only the two execution volumes are refunded
  expect(db.prepare('SELECT state FROM verification_blob_reservations').all()).toEqual([{state:'reserved'},{state:'released'},{state:'released'}]);
 }finally{runner.close();budget.close();harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('cancels an unpublished prepared execution without start, then verifies exact absence before refund',async()=>{
 const root=mkdtempSync(join(tmpdir(),'runner-unstarted-')),db=openPrivateVerificationDatabase(root);let runner:ReturnType<typeof createDockerRunner>,absent=false;
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'runner-unstarted',engineBinding:{engineId:'engine',incarnation:'one'},deletion:{assertDeleted(p:any,r:any){runner.deletionAuthority.assertDeleted(p,r);}}});const budget=harness.budget;const command={argv:['/bin/true'],cwdRelative:'.'},invocation={sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v'};const staged3=await harness.stagePlan(invocation,command),plan=staged3.plan,scopeDigest=staged3.scopeDigest;
 try{runner=createDockerRunner({database:db,budget,engine:{async isVolumeAbsent(){return absent;}} as any,engineBinding:{engineId:'engine',incarnation:'one',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:harness.pipeline.stager,outputBytes:4096});const {expected}=runner.reserveExecution({...invocation,ownerKey:'owner',scopeDigest,command,materializedInput:plan});runner.cancelPreparedExecution(expected);await expect(runner.cleanupExecution(expected)).rejects.toThrow('never_created_conflict');expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:3});absent=true;await runner.cleanupExecution(expected);expect(runner.readExecution(expected).cancelledBeforeStart).toBe(true);expect((await runner.inspectCancellationFacts(expected)).cancelledBeforeStart).toBe(true);expect(db.prepare("SELECT COUNT(*) n FROM verification_blob_reservations WHERE state='reserved'").get()).toEqual({n:1});await expect(runner.dispatchExecution(expected)).rejects.toThrow();}
 finally{runner!?.close();budget.close();harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('discards only an exact never-dispatched cache entry after the enclosing transaction rolled back',async()=>{
 const root=mkdtempSync(join(tmpdir(),'runner-rollback-')),db=openPrivateVerificationDatabase(root);
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'runner-rollback',engineBinding:{engineId:'e',incarnation:'one'}});const budget=harness.budget;
 const invocation={sessionIdentity:'s',compoundOperationId:'rollback',validationInvocationId:'v'},command={argv:['/bin/true'],cwdRelative:'.'};const staged4=await harness.stagePlan(invocation,command),scopeDigest=staged4.scopeDigest,plan=staged4.plan;
 const runner=createDockerRunner({database:db,budget,engine:{} as any,engineBinding:{engineId:'e',incarnation:'one',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:harness.pipeline.stager,outputBytes:4096});
 try{
  const input={...invocation,ownerKey:'owner',scopeDigest,command,materializedInput:plan};db.exec('BEGIN IMMEDIATE');expect(()=>runner.reserveExecution(input)).toThrow('verification_blob_outer_transaction');db.exec('ROLLBACK');
  let expected!:import('../../../src/runtime/isolated-execution/physical-quiescence.js').QuiescenceExpectation;
  const execute=rawCommands.executeDockerTransactionCommand,fault=vi.spyOn(rawCommands,'executeDockerTransactionCommand').mockImplementation((command,context)=>{const handled=execute(command,context);if(handled){expected=JSON.parse((db.prepare('SELECT resources_json FROM docker_runner_resources').get() as {resources_json:string}).resources_json).expected;expect(()=>runner.discardUncommittedExecution(expected)).toThrow('docker_runner_outer_transaction');throw Error('original enclosing transaction failed');}return handled;});
  try{expect(()=>runner.reserveExecution(input)).toThrow('original enclosing transaction failed');}finally{fault.mockRestore();}
  expect(()=>runner.discardUncommittedExecution({...expected,scopeDigest:'b'.repeat(64)})).toThrow('docker_runner_uncommitted_identity');
  runner.discardUncommittedExecution(expected);
  expect(()=>runner.discardUncommittedExecution(expected)).toThrow('docker_runner_uncommitted_identity');
  expect(db.prepare('SELECT COUNT(*) n FROM verification_blob_reservations').get()).toEqual({n:1});
  const committed=runner.reserveExecution({...invocation,ownerKey:'owner',scopeDigest,command,materializedInput:plan});
  expect(()=>runner.discardUncommittedExecution(committed.expected)).toThrow('docker_runner_durable_execution');
  expect(runner.readExecution(committed.expected).state).toBe('prepared');
 }finally{if(db.inTransaction)db.exec('ROLLBACK');runner.close();budget.close();harness.owner.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('binds mounted stdin bytes to its frozen manifest before starting the original command',async()=>{
 const root=mkdtempSync(join(tmpdir(),'runner-stdin-')),db=openPrivateVerificationDatabase(root),inputBytes=Buffer.from('original input');let creates=0;
 const budget=createPrimitiveMaterialHarness({database:db,authorityId:'runner-stdin',engineBinding:{engineId:'e',incarnation:'one'}}).budget;
 const {createHash}=await import('node:crypto'),stdin={sha256:createHash('sha256').update(inputBytes).digest('hex'),bytes:inputBytes.length},plan={} as any,command={argv:['/bin/cat'],cwdRelative:'.'},invocation={sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v'},scopeDigest='a'.repeat(64);
 const runner=createDockerRunner({database:db,budget,engine:{async createVolume(){creates++;throw Error('should not create');}} as any,engineBinding:{engineId:'e',incarnation:'one',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:{getManifest(){return {invocation,command,scopeDigest,files:[],stdin};},readFile(){throw Error('none');},readStdin(){return Buffer.from('tampered input');}} as any,outputBytes:4096});
 try{expect(()=>runner.reserveExecution({...invocation,ownerKey:'owner',scopeDigest,command,materializedInput:plan})).toThrow('docker_runner_stdin_binding');expect(creates).toBe(0);expect(db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:0});}finally{runner.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
