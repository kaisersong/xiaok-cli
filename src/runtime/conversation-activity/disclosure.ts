import type {ConversationActivity,WorkProjection} from './types.js';
const projectionKeys=new Set(['watchId','executionState','businessOutcome','freshness','sourceSequence','revision','lastProgressAt','lastHeartbeatAt','lastReportAt','errorCode','evidenceRefs']);
const activityKeys=new Set(['activityId','localSeq','watchId','threadId','kind','at','projection']);
export function unavailableProjection(value:WorkProjection):WorkProjection{
  return {watchId:value.watchId,executionState:'accepted',businessOutcome:'unknown',freshness:'unavailable',sourceSequence:0,revision:0,lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,errorCode:'activity_source_forbidden',evidenceRefs:[]};
}
/** Diagnostic strings are not authorization or evidence of redaction. */
export function isUnavailableProjection(value:WorkProjection):boolean{
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>projectionKeys.has(key))
    &&typeof value.watchId==='string'&&value.watchId.length>0&&value.errorCode==='activity_source_forbidden'
    &&value.executionState==='accepted'&&value.businessOutcome==='unknown'&&value.freshness==='unavailable'
    &&value.sourceSequence===0&&value.revision===0&&value.lastProgressAt===null&&value.lastHeartbeatAt===null&&value.lastReportAt===null
    &&Array.isArray(value.evidenceRefs)&&value.evidenceRefs.length===0);
}
export function unavailableActivity(value:ConversationActivity):ConversationActivity{
  return {activityId:`unavailable:${value.watchId}`,localSeq:value.localSeq,watchId:value.watchId,threadId:value.threadId,kind:'diagnostic',at:value.at,projection:unavailableProjection(value.projection)};
}
export function isUnavailableActivity(value:ConversationActivity):boolean{
  return Object.keys(value).every(key=>activityKeys.has(key))&&value.kind==='diagnostic'&&value.activityId===`unavailable:${value.watchId}`&&value.watchId===value.projection.watchId&&isUnavailableProjection(value.projection);
}
