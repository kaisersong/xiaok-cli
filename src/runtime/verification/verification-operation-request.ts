import {canonicalVerificationJson as json} from './protocol.js';
import {parseVerificationObligationQuery,type VerificationObligationQuery} from './verification-obligation-observation.js';
import type {PrivateMaterialHandle} from './product-material-authorization.js';
import type {VerificationOwner} from './proof-authority.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
export interface VerificationOperationRequestQuery extends VerificationObligationQuery {readonly requestId:string}
export interface VerificationOperationPrepareRequest extends VerificationOperationRequestQuery {readonly expectedAttemptEpoch:number;readonly requestSource:'user'|'agent'|'scheduler';readonly mountPlanHandle:Readonly<PrivateMaterialHandle>}
export interface VerificationOperationTerminalResult {readonly attemptId:string;readonly sourceRun?:Readonly<{sourceRunId:string;runNonce:string;archiveHash:string;scope:'protected-execution-run'}>;readonly verificationAtCompletion:'valid'|'needs_revalidation'|'unavailable'}
export type VerificationOperationRequestObservation = Readonly<VerificationOperationRequestQuery & {owner:Readonly<VerificationOwner>} & (
 {state:'absent'|'not_prepared'|'preparing'|'retired'} | {state:'operation';operation:Readonly<{id:string;state:'prepared'|'dispatching'|'terminal'|'unknown'|'cancelling'|'cancelled';attemptId:string;expected:Readonly<QuiescenceExpectation>;terminalResult?:VerificationOperationTerminalResult}>})>;
function record(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('verification_request_shape');}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!value||Buffer.byteLength(value)>160||/[\x00-\x1f\x7f]/.test(value))throw Error('verification_request_identity');}
function snapshot(raw:unknown){const encoded=json(raw);if(Buffer.byteLength(encoded)>16384)throw Error('verification_request_size');return JSON.parse(encoded);}
function query(value:Record<string,any>):Readonly<VerificationOperationRequestQuery>{id(value.requestId);return Object.freeze({requestId:value.requestId,...parseVerificationObligationQuery({invocation:value.invocation,obligationId:value.obligationId})});}
export function parseVerificationOperationRequestQuery(raw:unknown){const value=snapshot(raw);record(value,['requestId','invocation','obligationId']);return query(value);}
export function parseVerificationOperationPrepareRequest(raw:unknown):Readonly<VerificationOperationPrepareRequest>{
 const value=snapshot(raw);record(value,['requestId','invocation','obligationId','expectedAttemptEpoch','requestSource','mountPlanHandle']);const parsed=query(value);
 if(!['user','agent','scheduler'].includes(value.requestSource)||!Number.isSafeInteger(value.expectedAttemptEpoch)||value.expectedAttemptEpoch<0)throw Error('verification_request_source_epoch');
 record(value.mountPlanHandle,['id','secret']);id(value.mountPlanHandle.id);if(typeof value.mountPlanHandle.secret!=='string'||!/^[a-f0-9]{64}$/.test(value.mountPlanHandle.secret))throw Error('verification_request_handle');
 return Object.freeze({...parsed,expectedAttemptEpoch:value.expectedAttemptEpoch,requestSource:value.requestSource,mountPlanHandle:Object.freeze({...value.mountPlanHandle}) as PrivateMaterialHandle});
}
export function parseVerificationOperationRetireRequest(raw:unknown){const value=snapshot(raw);record(value,['requestId','invocation','obligationId','requestSource']);if(!['user','scheduler'].includes(value.requestSource))throw Error('verification_request_retire_source');return Object.freeze({...query(value),requestSource:value.requestSource as 'user'|'scheduler'});}
export function parseVerificationOperationTerminalResult(raw:unknown):VerificationOperationTerminalResult{
 const value=snapshot(raw);record(value,['attemptId','verificationAtCompletion',...('sourceRun' in value?['sourceRun']:[])]);id(value.attemptId);
 if(!['valid','needs_revalidation','unavailable'].includes(value.verificationAtCompletion))throw Error('verification_result_state');
 if('sourceRun' in value){record(value.sourceRun,['sourceRunId','runNonce','archiveHash','scope']);id(value.sourceRun.sourceRunId);id(value.sourceRun.runNonce);if(typeof value.sourceRun.archiveHash!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceRun.archiveHash)||value.sourceRun.scope!=='protected-execution-run')throw Error('verification_result_source');Object.freeze(value.sourceRun);}
 return Object.freeze(value) as VerificationOperationTerminalResult;
}
export function parseVerificationOperationRequestObservation(raw:unknown):VerificationOperationRequestObservation{
 const value=snapshot(raw);record(value,['requestId','invocation','obligationId','owner','state',...(value.state==='operation'?['operation']:[])]);const parsed=query(value);
 record(value.owner,['profileId','ownerKind','ownerId']);id(value.owner.profileId);id(value.owner.ownerId);if(!['task','intent','goal','loop','project'].includes(value.owner.ownerKind))throw Error('verification_request_owner');const common={...parsed,owner:Object.freeze({...value.owner}) as VerificationOwner};
 if(value.state!=='operation'){if(!['absent','not_prepared','preparing','retired'].includes(value.state))throw Error('verification_request_state');return Object.freeze({...common,state:value.state});}
 record(value.operation,['id','state','attemptId','expected',...('terminalResult' in value.operation?['terminalResult']:[])]);id(value.operation.id);id(value.operation.attemptId);if(!['prepared','dispatching','terminal','unknown','cancelling','cancelled'].includes(value.operation.state))throw Error('verification_request_state');
 if('terminalResult' in value.operation){value.operation.terminalResult=parseVerificationOperationTerminalResult(value.operation.terminalResult);if(value.operation.state!=='terminal'||value.operation.terminalResult.attemptId!==value.operation.attemptId)throw Error('verification_result_binding');}
 const expected=value.operation.expected;record(expected,['sessionIdentity','compoundOperationId','validationInvocationId','executionIdentity','scopeDigest']);Object.values(expected).forEach(id);if(!/^[a-f0-9]{64}$/.test(expected.scopeDigest)||json({sessionIdentity:expected.sessionIdentity,compoundOperationId:expected.compoundOperationId,validationInvocationId:expected.validationInvocationId})!==json(parsed.invocation))throw Error('verification_request_execution');
 return Object.freeze({...common,state:'operation',operation:Object.freeze({...value.operation,expected:Object.freeze({...expected})}) as Extract<VerificationOperationRequestObservation,{state:'operation'}>['operation']});
}
