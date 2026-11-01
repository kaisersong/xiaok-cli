import {it,expect} from 'vitest';
import {loopPublicationFixture,readyLoopNative} from '../support/loop-publication-fixture.js';
import type {AssistantDerivedVisibility} from '../../electron/assistant-derived-lineage.js';
it('gates binding/body brothers without erasing original terminal/native execution identities',()=>{
 const f=loopPublicationFixture();try{
  const native=readyLoopNative(f),id=f.candidate.runId;
  const before=f.store.getLoopRunLifecycle(id)!;expect(before.terminalResultPresent).toBe(true);expect(before.candidateIds).toHaveLength(2);
  const visibility:AssistantDerivedVisibility={readLineage:()=>undefined,isRunVisible:runId=>runId!==id,isCandidateVisible:()=>false,isEvidenceVisible:()=>false};
  f.store.bindAssistantDerivedVisibility(visibility);
  expect(f.store.getLoopPublicationCandidate(f.candidate.candidateId)).toBeUndefined();expect(f.store.listLoopPublicationCandidates(id)).toEqual([]);
  expect(()=>f.store.getLoopBusinessProjectionTarget(id)).toThrow('assistant_source_unavailable');expect(()=>f.store.getLoopNativeAttemptTarget(native.attemptId)).toThrow('assistant_source_unavailable');
  expect(f.store.getLoopNativeAttempt(native.attemptId)?.attemptId).toBe(native.attemptId);expect(f.store.listLoopNativeAttempts(f.candidate.candidateId)).toHaveLength(1);expect(f.store.getLoopRunLifecycle(id)).toEqual(before);
  expect(()=>f.store.recoverLoopPublicationCandidates({runId:id,requestSource:'user'})).toThrow('assistant_source_unavailable');expect(f.store.getLoopRunLifecycle(id)).toEqual(before);
 }finally{f.close();}
});
it('does not decode protected origin bodies when their assistant source is invisible',()=>{
 const f=loopPublicationFixture();try{
  const id=f.candidate.runId;
  // A denied reader must reject before decoding even a damaged historical body.
  const db=(f.store as any).db;db.prepare('INSERT INTO loop_projection_origins(run_id,origin_hash,record_json) VALUES(?,?,?)').run(id,'a'.repeat(64),'private historical body');
  f.store.bindAssistantDerivedVisibility({readLineage:()=>undefined,isRunVisible:runId=>runId!==id,isCandidateVisible:()=>false,isEvidenceVisible:()=>false});
  expect(f.store.getLoopBusinessProjection(id)).toBeUndefined();
 }finally{f.close();}
});

it('rejects execution observation bodies without losing journal identities or reserving a new execution',()=>{
 const f=loopPublicationFixture();try{
  const native=readyLoopNative(f);let session=f.store.reserveLoopVerificationSession({nativeAttemptId:native.attemptId,obligationId:'run-original',sessionId:'source-session',requestSource:'user',now:30});
  session=f.store.acknowledgeLoopVerificationSession({id:session.id,expectedRevision:session.revision,requestSource:'scheduler',now:31});for(const phase of ['enrolling','enrolled'] as const)session=f.store.advanceLoopVerificationEnrollment({id:session.id,expectedRevision:session.revision,phase,requestSource:'user',now:32});
  const request={sessionRecordId:session.id,exactCommand:{argv:['node','verify.cjs'],cwdRelative:'.'},expiresAt:10000,requestSource:'user' as const,now:40};
  const execution=f.store.reserveLoopVerificationExecution(request),runId=f.candidate.runId;
  f.store.bindAssistantDerivedVisibility({readLineage:()=>undefined,isRunVisible:id=>id!==runId,isCandidateVisible:()=>false,isEvidenceVisible:()=>false});
  expect(()=>f.store.getLoopVerificationExecution(execution.id)).toThrow('assistant_source_unavailable');expect(()=>f.store.listLoopVerificationExecutions(session.id)).toThrow('assistant_source_unavailable');
  expect(()=>f.store.cancelLoopVerificationSelection({id:execution.id,expectedRevision:execution.revision,requestSource:'user',now:50})).toThrow('assistant_source_unavailable');
  const db=(f.store as any).db,row=db.prepare('SELECT record_json FROM loop_verification_executions WHERE id=?').get(execution.id),actual=JSON.parse(row.record_json);
  expect(actual).toMatchObject({id:execution.id,phase:'retired',materialRequestId:execution.materialRequestId,verificationRequestId:execution.verificationRequestId});
  expect(()=>f.store.reserveLoopVerificationExecution(request)).toThrow('assistant_source_unavailable');expect(db.prepare('SELECT count(*) AS n FROM loop_verification_executions').get().n).toBe(1);expect(f.store.getLoopVerificationSession(session.id)?.sessionId).toBe('source-session');
 }finally{f.close();}
});
