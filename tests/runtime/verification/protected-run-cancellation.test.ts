import {rawCommandFaultHarness} from '../../support/raw-command-fault.js';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveMaterialHarness} from '../../support/primitive-blob-authority.js';
import {createDockerRunner} from '../../../src/runtime/isolated-execution/docker-runner.js';
import {createProtectedRunLedger} from '../../../src/runtime/verification/protected-run-ledger.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import type {QuiescenceExpectation} from '../../../src/runtime/isolated-execution/physical-quiescence.js';
// Real SQLite, raw cancellation and ledger. Engine absence is an explicit leaf,
// so these tests do not qualify an installed operating-system execution engine.
async function open(root:string){
 const db=openPrivateVerificationDatabase(join(root,'db')),invocation={sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'validation'},command={argv:['/bin/true'],cwdRelative:'.'};let serial=0;
 let raw:ReturnType<typeof createDockerRunner>;
 const harness=createPrimitiveMaterialHarness({database:db,authorityId:'run-cancellation',engineBinding:{engineId:'engine',incarnation:'boot'},deletion:{assertDeleted(p:any,r:any){raw.deletionAuthority.assertDeleted(p,r);}}});const budget=harness.budget;
 raw=createDockerRunner({database:db,budget,engine:{async isVolumeAbsent(){return true;},async isContainerAbsent(){return true;}} as any,engineBinding:{engineId:'engine',incarnation:'boot',epoch:1},imageId:'sha256:'+'b'.repeat(64),assertCurrent(){},stager:harness.pipeline.stager,outputBytes:4096});
 const receipts=new WeakMap<object,string>(),quiescence={async inspectExecution(expected:QuiescenceExpectation){await raw.inspectCancellationFacts(expected);const receipt={};receipts.set(receipt,json(expected));return receipt as any;},assertQuiescent(receipt:object,expected:QuiescenceExpectation){if(receipts.get(receipt)!==json(expected)||raw.readExecution(expected).cancelledBeforeStart!==true)throw Error('physical cancellation not established');}};
 const authorization={},ledger=createProtectedRunLedger({root:join(root,'runs'),database:db,budget,execution:raw,quiescence,assertCurrent(){},access:{assertStart(_proposal,token){if(token!==authorization)throw Error('no start authority');},assertRead(){throw Error('no archive authority');},assertDelete(){throw Error('no deletion authority');}}});
 return {db,budget,raw,ledger,quiescence,async begin(){const suffix=String(++serial),reserveInvocation={...invocation,validationInvocationId:'validation-'+suffix};const staged=await harness.stagePlan(reserveInvocation,command);return rawCommandFaultHarness(raw,db).withReservationTransaction(transaction=>{const run=ledger.beginRunInTransaction({ownerKey:'owner',rootInvocation:reserveInvocation,authorization});const reserved=raw.reserveExecution({...reserveInvocation,ownerKey:'owner',scopeDigest:staged.scopeDigest,command,materializedInput:staged.plan},transaction);ledger.registerExecution(run.producer,reserved.expected);return {run,expected:reserved.expected};});},close(){ledger.close();raw.close();budget.close();harness.owner.close();db.close();}};
}
it('seals the original cancelled prepared run after actually closing and reopening the database without its producer token',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cancelled-run-'));let f=await open(root);
 try{const {run,expected}=await f.begin();f.raw.cancelPreparedExecution(expected);await f.raw.cleanupExecution(expected);f.close();f=await open(root);
  const receipt=await f.quiescence.inspectExecution(expected);f.ledger.sealCancelledPreparedRun({sourceRunId:run.sourceRunId,expected,receipt});
  expect(f.ledger.describeArchive(run.sourceRunId)).toMatchObject({state:'sealed',archiveHash:null,memberCount:1,producers:[{state:'ended'}]});
  const row=f.db.prepare('SELECT observation_json FROM verification_run_executions WHERE execution_id=?').get(expected.executionIdentity) as {observation_json:string};expect(JSON.parse(row.observation_json)).toMatchObject({expected,cancelledBeforeStart:true,exitCode:null});
  expect(()=>f.ledger.endProducer(run.producer)).toThrow();expect(()=>f.ledger.assertComplete(receipt,{sourceRunId:run.sourceRunId,runNonce:run.runNonce,archiveHash:'a'.repeat(64),scope:'protected-execution-run'})).toThrow();
  f.ledger.sealCancelledPreparedRun({sourceRunId:run.sourceRunId,expected,receipt});
 }finally{f.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['receipt','producer','member','ignore','tamper'] as const)('does not seal a cancelled run with %s drift',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'cancelled-run-')),f=await open(root);
 try{const {run,expected}=await f.begin();if(mode==='producer')f.ledger.forkProducer(run.producer);if(mode==='member')f.db.prepare('UPDATE verification_run_executions SET producer_id=?').run('foreign');
  f.raw.cancelPreparedExecution(expected);await f.raw.cleanupExecution(expected);const receipt=await f.quiescence.inspectExecution(expected);
  if(mode==='ignore')f.db.exec("CREATE TRIGGER seal_fault BEFORE UPDATE ON verification_run_producers BEGIN SELECT RAISE(IGNORE); END");
  if(mode==='tamper')f.db.exec("CREATE TRIGGER seal_fault AFTER UPDATE ON verification_protected_runs BEGIN UPDATE verification_protected_runs SET run_nonce='wrong' WHERE source_run_id=NEW.source_run_id; END");
  expect(()=>f.ledger.sealCancelledPreparedRun({sourceRunId:run.sourceRunId,expected,receipt:mode==='receipt'?{}:receipt})).toThrow();
  expect(f.ledger.describeArchive(run.sourceRunId).state).toBe('open');expect(f.db.prepare('SELECT observation_json FROM verification_run_executions').get()).toEqual({observation_json:null});
 }finally{f.close();rmSync(root,{recursive:true,force:true});}
});
