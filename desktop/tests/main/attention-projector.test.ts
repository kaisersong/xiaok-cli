import { describe, expect, it } from 'vitest';
import { projectWorkAttention, projectActivityAttention } from '../../../src/runtime/conversation-activity/attention-projector.js';
const fact=(reasonCode:string,fields={})=>({profile:'dsh',schemaVersion:1,factId:'fact:'+reasonCode,revision:2,evidenceRefs:[],reasonCode,...fields});
const base=()=>({schemaVersion:1,scope:{profileId:'profile',workspaceId:'workspace',tenantId:'tenant'},anchor:{kind:'binding',bindingId:'binding'},workRef:'work',factRevision:2,projectionVersion:3,executionState:'running',watchStopped:false,freshness:'fresh',deliveryStage:'none',sourceFacts:[],questions:[]});
describe('single original owner attention projector',()=>{
 it('retains all reason sources and separate questions without changing the safety primary reason',()=>{
  const questions=[{questionRef:'mcp:q',ownerKind:'mcp',answerApiRef:'mcpAnswer',sourceRevision:4,permissionRef:'mcp:watch'},
   {questionRef:'task:q',ownerKind:'task_host',answerApiRef:'answerQuestion',sourceRevision:5,permissionRef:'task:task'}];
  const result=projectWorkAttention({...base(),questions,sourceFacts:[fact('STALE_INPUT'),fact('SEAL_CLEARANCE_DENIED'),fact('delivery_unknown')]});
  expect(result.categoryRank).toBe(0);expect(result.primaryReason).toBe('authority_suspect');expect(result.severity).toBe('blocking');expect(result.questions).toHaveLength(2);expect(result.reasons).toHaveLength(3);
  expect(projectWorkAttention({...base(),questions:[...questions].reverse(),sourceFacts:[fact('delivery_unknown'),fact('SEAL_CLEARANCE_DENIED'),fact('STALE_INPUT')]})).toEqual(result);
 });
 it('keeps ordinary delivery ready distinct from its compatibility review reason',()=>{
  const ready=projectWorkAttention({...base(),deliveryStage:'ready_for_acceptance',sourceFacts:[fact('review_required',{profile:'ordinary'})]});expect(ready.categoryRank).toBe(3);expect(ready.primaryReason).toBe('review_required');expect(ready.severity).toBe('warning');
  expect(projectWorkAttention({...base(),deliveryStage:'draft_ready',sourceFacts:[fact('draft_ready'),fact('accepted_pending_owner_fence',{controlKind:'revoke'})]}).categoryRank).toBe(1);
 });
 it('preserves unknown protocol facts without downgrading an existing blocking control',()=>{
  const result=projectWorkAttention({...base(),sourceFacts:[fact('not_a_known_code'),fact('stop_unconfirmed')]});expect(result.primaryReason).toBe('stop_unconfirmed');expect(result.protocolUnavailable).toBe(true);expect(result.categoryRank).toBe(1);expect(result.sourceFacts).toHaveLength(2);expect(result.automaticActionsAllowed).toBe(false);
 });
 it('separates system reconciliation and control ACK waiting from a user answer or acceptance',()=>{
  expect(projectWorkAttention({...base(),sourceFacts:[fact('accepted_pending_owner_fence',{controlKind:'stop'})]})).toMatchObject({categoryRank:1,waitingOn:'system',recommendedAction:'reconcile'});
  expect(projectWorkAttention({...base(),sourceFacts:[fact('receipt_unknown')]})).toMatchObject({waitingOn:'system',recommendedAction:'reconcile'});
  expect(projectWorkAttention({...base(),sourceFacts:[fact('resource_wait')]})).toMatchObject({categoryRank:4,waitingOn:'resource'});
 });
 it('deduplicates exact fact replay while refusing same immutable identity with changed content',()=>{
  const first=fact('review_required');expect(projectWorkAttention({...base(),sourceFacts:[first,first]}).sourceFacts).toHaveLength(1);
  expect(()=>projectWorkAttention({...base(),sourceFacts:[first,{...first,evidenceRefs:['changed']}]})).toThrow(/conflict/);
 });
 it('keeps the anchor stable as facts change and uses canonical scope encoding',()=>{
  const empty=projectWorkAttention(base());expect(projectWorkAttention({...base(),sourceFacts:[fact('STALE_INPUT')]}).anchorFactId).toBe(empty.anchorFactId);
  expect(projectWorkAttention({...base(),scope:{profileId:'profile:workspace',workspaceId:'x',tenantId:'tenant'}}).anchorFactId).not.toBe(projectWorkAttention({...base(),scope:{profileId:'profile',workspaceId:'workspace:x',tenantId:'tenant'}}).anchorFactId);
  expect(projectWorkAttention({...base(),scope:{...base().scope,tenantId:'other'}}).anchorFactId).not.toBe(empty.anchorFactId);
 });
 it('does not treat unavailable terminal data or stopped unresolved control as completed',()=>{
  expect(projectWorkAttention({...base(),executionState:'completed',freshness:'unavailable'}).categoryRank).toBe(2);
  expect(projectWorkAttention({...base(),watchStopped:true,sourceFacts:[fact('delivery_unknown')]}).categoryRank).toBe(1);
  expect(projectWorkAttention({...base(),watchStopped:true}).categoryRank).toBe(6);
  expect(projectWorkAttention({...base(),watchStopped:true,freshness:'unavailable'}).categoryRank).toBe(6);
 });
 it('does not accept an arbitrary answer endpoint or cross-owner question action',()=>{
  const q={questionRef:'q',ownerKind:'mcp',sourceRevision:2,permissionRef:'watch'};
  expect(()=>projectWorkAttention({...base(),questions:[{...q,answerApiRef:'https://example.test/execute'}]})).toThrow();
  expect(()=>projectWorkAttention({...base(),questions:[{...q,answerApiRef:'answerQuestion'}]})).toThrow();
 });
 it('adapts actual WorkBinding identity without collapsing different works in the same conversation',()=>{
  const watch={operationId:'op',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'epoch',workId:'one',origin:{profileId:'p',workspaceId:'w',threadId:'thread',actorId:'user'},status:'active',generation:1,preference:'normal',policyRevision:0,nextReportDueAt:100};
  const projection={watchId:'watch',executionState:'input_required',businessOutcome:'unknown',freshness:'fresh',sourceSequence:2,revision:3,lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,evidenceRefs:[]};
  const first=projectActivityAttention(watch as any,projection as any);expect(first.categoryRank).toBe(0);expect(first.reasons).toHaveLength(0);
  expect(projectActivityAttention({...watch,workId:'two'} as any,projection as any).anchorFactId).not.toBe(first.anchorFactId);
  expect(projectActivityAttention({...watch,watchId:'another-window'} as any,projection as any).anchorFactId).toBe(first.anchorFactId);
  expect(projectActivityAttention({...watch,sourceDataEpoch:'new-source-store'} as any,projection as any).anchorFactId).not.toBe(first.anchorFactId);
 });
});
function readyProjectInput(){return{...base(),anchor:{kind:'activity',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:'epoch',workId:'p',runId:''},executionState:'accepted',deliveryStage:'ready_for_acceptance',sourceFacts:[fact('queued',{profile:'activity'}),fact('ordinary_ready',{profile:'activity'})]};}
it('keeps the queued fact while excluding its normal-state reason for a fresh qualified ordinary ready project',()=>{
 const view=projectWorkAttention(readyProjectInput());expect(view.primaryReason).toBe('review_required');expect(view.reasons.some(reason=>reason.code==='owner_create_pending')).toBe(false);expect(view.sourceFacts.some(source=>source.reasonCode==='queued')).toBe(true);expect(view.categoryRank).toBe(3);
});
it.each(['capacity_pending','resource_wait','runtime_unavailable','plan_input_waiting_consumption'])('retains a real %s reason alongside ordinary ready',reason=>{
 const input=readyProjectInput(),extra=fact(reason,{profile:'activity'}),view=projectWorkAttention({...input,sourceFacts:[...input.sourceFacts,extra]});expect(view.reasons.find(item=>item.code==='owner_create_pending')?.sources).toEqual([{factId:extra.factId,revision:extra.revision}]);
});
it('preserves DSH primary, unavailable queued diagnosis, questions and blocked priority',()=>{
 const input=readyProjectInput(),dsh=projectWorkAttention({...input,sourceFacts:[...input.sourceFacts,fact('stop_unconfirmed')]});expect(dsh.primaryReason).toBe('stop_unconfirmed');expect(dsh.reasons.some(reason=>reason.code==='owner_create_pending')).toBe(true);
 expect(projectWorkAttention({...input,freshness:'unavailable'}).reasons.some(reason=>reason.code==='owner_create_pending')).toBe(true);
 expect(projectWorkAttention({...input,questions:[{questionRef:'question',ownerKind:'room',answerApiRef:'answerRoomQuestion',sourceRevision:1,permissionRef:'room'}]}).categoryRank).toBe(0);
 expect(projectWorkAttention({...input,executionState:'blocked'}).categoryRank).toBe(2);
});
