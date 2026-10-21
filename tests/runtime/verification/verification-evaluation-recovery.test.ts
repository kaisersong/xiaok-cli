import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {verificationRequestFixture} from '../../support/verification-request-fixture.js';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

it('publishes the original compared artifact after replacing the operation factory without another execution',async()=>{
 const f=await verifiedOperationFixture('loop-application');try{
  const executions=f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all();
  await f.operations.close();const recovered=f.recreateOperations();
  const staged=recovered.stageVerifiedPayload(f.owner);
  const payload=JSON.parse(f.composition.privateHost.payloads.read(staged.payloadId,f.owner).toString('utf8'));
  expect(Buffer.from(payload.evaluations[0].artifacts[0].bytesBase64,'base64').toString()).toBe('result');
  expect(f.database.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all()).toEqual(executions);
 }finally{await f.close();}
});

it('rolls back the original retained bytes with proof and terminal result when the result commit fails',async()=>{
 const f=await verificationRequestFixture(),signal=new AbortController().signal;try{
  const p=await f.operations.prepareRequest(f.request,f.peer,signal);if(!p.created)throw Error('fresh');
  f.database.exec("CREATE TRIGGER fail_after_retention BEFORE INSERT ON verification_operation_results BEGIN SELECT RAISE(IGNORE); END");
  await expect(f.operations.dispatch({operationHandle:p.operationHandle},f.peer,signal)).rejects.toThrow();
  expect(f.database.prepare('SELECT * FROM verified_evaluation_retentions WHERE attempt_id=?').get(p.attemptId)).toBeUndefined();
  expect(f.database.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(p.operationHandle.id)).toBeUndefined();
  expect(f.operations.lookupRequest(f.query,f.peer)).toMatchObject({state:'operation',operation:{state:'unknown'}});
  expect(()=>f.operations.stageVerifiedPayload(f.owner)).toThrow();
 }finally{await f.close();}
});

it('rejects substituted retained artifact bytes even when their local bundle checksum was recomputed',async()=>{
 const f=await verifiedOperationFixture('loop-application');try{
  const row=f.database.prepare('SELECT attempt_id,bundle FROM verified_evaluation_retentions').get() as {attempt_id:string;bundle:Buffer};
  const body=JSON.parse(row.bundle.toString('utf8')),changed=Buffer.from('forged'),hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  body.artifacts[0]={...body.artifacts[0],bytesBase64:changed.toString('base64'),size:changed.length,sha256:hash(changed)};
  const bytes=Buffer.from(json(body));f.database.prepare('UPDATE verified_evaluation_retentions SET bundle=?,bundle_hash=? WHERE attempt_id=?').run(bytes,hash(bytes),row.attempt_id);
  await f.operations.close();const recovered=f.recreateOperations();expect(()=>recovered.stageVerifiedPayload(f.owner)).toThrow();
 }finally{await f.close();}
});

it('can reuse the original signed evaluation from an existing payload after retention was transferred',async()=>{
 const f=await verifiedOperationFixture('loop-application');try{
  const original=f.operations.stageVerifiedPayload(f.owner);
  await f.operations.close();const recovered=f.recreateOperations();
  expect(recovered.stageVerifiedPayload(f.owner)).toEqual(original);
 }finally{await f.close();}
});
