import {it,expect} from 'vitest';
import {verificationRequestFixture} from '../../support/verification-request-fixture.js';
const signal=()=>new AbortController().signal;

it('looks up the original durable terminal response after a lost dispatch reply without executing again',async()=>{
 const f=await verificationRequestFixture();try{
  const prepared=await f.operations.prepareRequest(f.request,f.peer,signal());if(!prepared.created)throw Error('fresh');
  const response=await f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal());
  const count=f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get();
  const observed=f.operations.lookupRequest(f.query,f.peer) as any;
  expect(observed.operation.terminalResult).toEqual({attemptId:response.attemptId,sourceRun:response.sourceRun,verificationAtCompletion:response.currentVerification});
  expect(await f.operations.recoverRequest({...f.query,requestSource:'scheduler'},f.peer,signal())).toEqual(observed);
  expect(f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual(count);
  expect(observed.operation.terminalResult).not.toHaveProperty('currentVerification');
 }finally{await f.close();}
});

it.each(['insert-ignore','terminal-trigger'] as const)('does not acknowledge terminal success when %s prevents the original atomic commit',async mode=>{
 const f=await verificationRequestFixture();try{
  const prepared=await f.operations.prepareRequest(f.request,f.peer,signal());if(!prepared.created)throw Error('fresh');
  f.database.exec(mode==='insert-ignore'?"CREATE TRIGGER fail_result BEFORE INSERT ON verification_operation_results BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER fail_result AFTER UPDATE ON verification_operations WHEN NEW.state='terminal' BEGIN UPDATE verification_operation_results SET result_hash='changed' WHERE operation_id=NEW.id; END");
  await expect(f.operations.dispatch({operationHandle:prepared.operationHandle},f.peer,signal())).rejects.toThrow();
  expect(f.database.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(prepared.operationHandle.id)).toBeUndefined();
  expect(f.operations.lookupRequest(f.query,f.peer)).toMatchObject({state:'operation',operation:{state:'unknown'}});
 }finally{await f.close();}
});

it.each(['result','core','run'] as const)('rejects original terminal history whose %s binding changed',async mode=>{
 const f=await verificationRequestFixture();try{
  const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');
  const response=await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal());
  if(mode==='result')f.database.prepare("UPDATE verification_operation_results SET result_json='{}' WHERE operation_id=?").run(p.operationHandle.id);
  if(mode==='core')f.database.prepare("UPDATE execution_facts_revisions SET core_json='{}' WHERE attempt_id=?").run(response.attemptId);
  if(mode==='run')f.database.prepare("UPDATE verification_protected_runs SET archive_hash=? WHERE source_run_id=?").run('b'.repeat(64),response.sourceRun!.sourceRunId);
  expect(()=>f.operations.lookupRequest(f.query,f.peer)).toThrow();
 }finally{await f.close();}
});
it.each(['result-missing','core-missing','proof-missing','proof-tamper'] as const)('does not downgrade or accept terminal history with %s',async mode=>{const f=await verificationRequestFixture();try{const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal());const row=f.database.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(p.operationHandle.id) as any;if(mode==='result-missing')f.database.prepare('DELETE FROM verification_operation_results WHERE operation_id=?').run(p.operationHandle.id);if(mode==='core-missing')f.database.prepare('DELETE FROM execution_facts_revisions WHERE attempt_id=? AND revision=?').run(p.attemptId,row.core_revision);if(mode==='proof-missing'){expect(row.proof_id).toBeTruthy();f.database.prepare('DELETE FROM verifier_proofs WHERE proof_id=?').run(row.proof_id);}if(mode==='proof-tamper')f.database.prepare("UPDATE verifier_proofs SET proof_json='{}' WHERE proof_id=?").run(row.proof_id);expect(()=>f.operations.lookupRequest(f.query,f.peer)).toThrow();}finally{await f.close();}});
it('recreated operation factory reads the original result without dispatching again (same database)',async()=>{const f=await verificationRequestFixture();try{const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal());const before=f.operations.lookupRequest(f.query,f.peer),count=f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get();await f.operations.close();const next=f.recreateOperations();expect(next.lookupRequest(f.query,f.peer)).toEqual(before);expect(await next.recoverRequest({...f.query,requestSource:'scheduler'},f.peer,signal())).toEqual(before);expect(f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual(count);}finally{await f.close();}});
it.each(['run','request'] as const)('owner callback after controller result cannot change original %s facts',async mode=>{let callback=()=>{};const f=await verificationRequestFixture(undefined,()=>callback());try{const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');let changed=false;callback=()=>{if(!changed&&(f.database.prepare('SELECT core_json FROM obligation_attempts WHERE attempt_id=?').get(p.attemptId) as any)?.core_json){changed=true;if(mode==='run')f.database.prepare("UPDATE verification_protected_runs SET run_nonce='altered' WHERE source_run_id=(SELECT json_extract(record_json,'$.sourceRunId') FROM verification_operations WHERE id=?)").run(p.operationHandle.id);else f.database.prepare("UPDATE verification_prepare_requests SET request_json='{}' WHERE operation_id=?").run(p.operationHandle.id);}};await expect(f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal())).rejects.toThrow();expect(changed).toBe(true);callback=()=>{};expect(f.database.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(p.operationHandle.id)).toBeUndefined();}finally{callback=()=>{};await f.close();}});
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
it('does not accept core and proof rewritten by the final owner callback as the original controller result',async()=>{let callback=()=>{};const f=await verificationRequestFixture(undefined,()=>callback());try{const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');let changed=false;callback=()=>{const a=f.database.prepare('SELECT core_json,proof_json FROM obligation_attempts WHERE attempt_id=?').get(p.attemptId) as any;if(!changed&&a?.core_json&&a.proof_json){changed=true;const core=JSON.parse(a.core_json),proof=JSON.parse(a.proof_json);core.outputHashes=['b'.repeat(64)];const coreJson=json(core);proof.coreHash=createHash('sha256').update(coreJson).digest('hex');const proofJson=json(proof);f.database.prepare('UPDATE obligation_attempts SET core_json=?,proof_json=? WHERE attempt_id=?').run(coreJson,proofJson,p.attemptId);f.database.prepare('UPDATE execution_facts_revisions SET core_json=? WHERE attempt_id=? AND revision=?').run(coreJson,p.attemptId,core.coreFinalRevision);f.database.prepare('UPDATE verifier_proofs SET proof_json=? WHERE proof_id=?').run(proofJson,proof.proofId);}};await expect(f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal())).rejects.toThrow();expect(changed).toBe(true);}finally{callback=()=>{};await f.close();}});
it('successful dispatch has no duplicate ledger callbacks after the terminal result commit',async()=>{let callback=()=>{};const f=await verificationRequestFixture(undefined,undefined,()=>callback());try{const p=await f.operations.prepareRequest(f.request,f.peer,signal());if(!p.created)throw Error('fresh');let tailCalls=0;callback=()=>{if((f.database.prepare('SELECT state FROM verification_operations WHERE id=?').get(p.operationHandle.id) as any)?.state==='terminal'){tailCalls++;f.database.prepare("UPDATE verification_operation_results SET result_json='{}' WHERE operation_id=?").run(p.operationHandle.id);}};await f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal());callback=()=>{};expect(tailCalls).toBe(0);expect(f.operations.lookupRequest(f.query,f.peer)).toMatchObject({state:'operation',operation:{state:'terminal'}});}finally{callback=()=>{};await f.close();}});
