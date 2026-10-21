import {describe,expect,it} from 'vitest';
import {activateIntentStep,applyIntentStepUpdate} from '../../../src/runtime/intent-delegation/dispatcher.js';
import {assertIntentPublicationRetained} from '../../../src/runtime/intent-delegation/publication-candidate-journal.js';
import {projectIntentBusinessLedger,assertIntentBusinessProjectionTransition,type IntentBusinessProjection} from '../../../src/runtime/intent-delegation/business-projection.js';
import type {StoredIntentRecordInput,StoredSessionIntentLedgerInput} from '../../../src/runtime/intent-delegation/stored-intent-clone.js';

// Scripted public DATA only. No store/host/client/SDK/lease/issuer/registration construction.
// Legacy review values remain legacy values, never a Modern or execution-admission claim.
function record():StoredIntentRecordInput {
 return {intentId:'legacy-intent',instanceId:'data-instance',sessionId:'data-session',
 rawIntent:'original legacy data',normalizedIntent:'original legacy data',intentType:'review',deliverable:'memo',
 explicitConstraints:[],delegationBoundary:[],riskTier:'legacy-risk',templateId:'data-template',
 steps:[{stepId:'step-one',key:'collect',order:0,role:'review',skillName:null,dependsOn:[],status:'planned',riskTier:'legacy-risk'},
 {stepId:'step-two',key:'compose',order:1,role:'review',skillName:null,dependsOn:['step-one'],status:'planned',riskTier:'legacy-risk'}],
 activeStepId:'step-one',overallStatus:'planned',attemptCount:0,createdAt:100,updatedAt:100,
 producerReports:{opaqueHistory:['review','retained']}};
}
function ledger():StoredSessionIntentLedgerInput {
 const intent=record();return {sessionId:intent.sessionId,instanceId:intent.instanceId,latestPlan:intent,intents:[intent],
 activeIntentId:intent.intentId,breadcrumbs:[],receipt:null,salvage:null,ownership:{state:'owned',ownerInstanceId:intent.instanceId,updatedAt:100},updatedAt:100};
}
const missingProjection:IntentBusinessProjection={version:1,candidateId:'missing',receiverRequestId:'data-request',appliedAt:101,
 clock:{domainId:'data-clock',qualificationEpoch:0,lowerBound:0,upperBound:1000,evidenceHash:'a'.repeat(64)},publications:[]};

describe('real Raw publication transition and dispatcher DATA contracts',()=>{
 it('activates the original legacy first step using the existing clone fallback without upgrading review values',()=>{
  const input=record(),before=structuredClone(input),next=activateIntentStep(input,'step-one',101);
  expect(next.intentType).toBe('review');expect(next.steps[0]?.role).toBe('review');
  expect(next.steps[0]?.status).toBe('running');expect(next.stages).toHaveLength(1);
  expect(next.producerReports).toEqual(input.producerReports);expect(input).toEqual(before);
 });
 it('advances to the original dependency-linked second step while retaining opaque history and the original input',()=>{
  const input=record(),before=structuredClone(input),next=applyIntentStepUpdate(input,{stepId:'step-one',status:'completed',now:102});
  expect(next.activeStepId).toBe('step-two');expect(next.steps[0]?.status).toBe('completed');
  expect(next.intentType).toBe('review');expect(next.producerReports).toEqual(input.producerReports);expect(input).toEqual(before);
 });
 it('retains the existing blocked transition without changing the legacy role or metadata',()=>{
  const next=applyIntentStepUpdate(record(),{stepId:'step-one',status:'blocked',now:103});
  expect(next.overallStatus).toBe('waiting_user');expect(next.steps[0]?.role).toBe('review');expect(next.riskTier).toBe('legacy-risk');
 });
 it('retains the existing failed transition without inventing a modern intent type',()=>{
  const next=applyIntentStepUpdate(record(),{stepId:'step-one',status:'failed',now:104});
  expect(next.overallStatus).toBe('failed');expect(next.intentType).toBe('review');expect(next.steps[0]?.status).toBe('failed');
 });
 it('preserves the original out-of-order rejection before any clone or input mutation',()=>{
  const input=record(),before=structuredClone(input);expect(()=>activateIntentStep(input,'step-two',105)).toThrow(/out of order/);expect(input).toEqual(before);
 });
 it('preserves the original concurrent-running-step rejection',()=>{
  const input=record();input.steps[1]!.status='running';expect(()=>activateIntentStep(input,'step-one',106)).toThrow(/another step is running/);
 });
 it('rejects a non-number order at the actual comparison instead of coercing a legacy string',()=>{
  const input=record(),before=structuredClone(input);input.steps[1]!.order='1';
  expect(()=>applyIntentStepUpdate(input,{stepId:'step-one',status:'completed',now:107})).toThrow('intent_dispatch_order_data');
  expect(input.steps[0]?.status).toBe(before.steps[0]?.status);
 });
 it('compares the complete Raw retention carrier while allowing only the original updatedAt difference',()=>{
  const before=ledger(),after=structuredClone(before);after.updatedAt=108;
  expect(()=>assertIntentPublicationRetained(before,after,true)).not.toThrow();expect(before.intents[0]?.intentType).toBe('review');
 });
 it('rejects a change to opaque unselected history rather than replacing the full ledger with a selected view',()=>{
  const before=ledger(),after=structuredClone(before);after.intents.push({...record(),intentId:'unselected'});
  expect(()=>assertIntentPublicationRetained(before,after,true)).toThrow('intent_candidate_original_changed');
 });
 it('rejects a malformed prior publication container through the real retention entry',()=>{
  const before=ledger(),after=structuredClone(before);before.publicationCandidates={not:'an array'};
  expect(()=>assertIntentPublicationRetained(before,after,true)).toThrow();
 });
 it('rejects a missing projection candidate through the original whole projector without modifying the full Raw input',()=>{
  const input=ledger(),before=structuredClone(input);expect(()=>projectIntentBusinessLedger(input,'missing',missingProjection)).toThrow('intent_projection_candidate');expect(input).toEqual(before);
 });
 it('retains the original missing-prior-state transition rejection',()=>{
  expect(()=>assertIntentBusinessProjectionTransition(undefined,ledger())).toThrow('intent_projection_original');
 });
});
