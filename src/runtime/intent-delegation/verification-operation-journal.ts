import {isDeepStrictEqual} from 'node:util';
import {captureIntentData} from './data.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {parseVerificationObligationObservation,type VerificationObligationObservation} from '../verification/verification-obligation-observation.js';
import {parseMaterialRequestObservation,type MaterialRequestObservation} from '../verification/material-request.js';
import {parseVerificationOperationRequestObservation,type VerificationOperationRequestObservation} from '../verification/verification-operation-request.js';
import type {ValidationMaterialRequestStep,AuthorizedProductValidationMaterials} from '../verification/product-material-authorization.js';
import type {IntentApplicationBinding} from '../verification/intent-application-binding.js';
import type {IntentVerificationExecution} from './verification-execution-journal.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
export interface IntentVerificationOperation {
 revision:number;phase:'material_preparing'|'material_authorizing'|'material_staging'|'preparing'|'dispatching'|'observing'|'terminal'|'retired';
 obligationObservation:null|{definitionHash:string;attemptEpoch:number;activeAttemptId:string|null;bindingHash:string;applicationRevision:number};
 challengeId:string|null;materialReceipt:AuthorizedProductValidationMaterials['publicReceipt']|null;
 operationId:string|null;attemptId:string|null;expected:Readonly<QuiescenceExpectation>|null;
 materialObservation:Readonly<MaterialRequestObservation>|null;verificationObservation:VerificationOperationRequestObservation|null;
}
/** Public comparison facts, not a complete execution row or material authority. */
export interface IntentVerificationOperationRowData {
 readonly registration:{readonly obligations:readonly {readonly obligation:{readonly obligationId:unknown;readonly definitionHash:unknown}}[]};
 readonly obligationId:unknown;readonly bindingHash:unknown;readonly invocation:unknown;
 readonly route:string;readonly materialRequestId:unknown;readonly verificationRequestId:unknown;
}
export type IntentVerificationOperationAction=
 |{kind:'begin-materials';observation:VerificationObligationObservation}
 |{kind:'material-step';step:ValidationMaterialRequestStep}
 |{kind:'prepare';receipt:AuthorizedProductValidationMaterials['publicReceipt']}
 |{kind:'dispatch';operationId:string;attemptId:string;attemptEpoch:number;observation:VerificationOperationRequestObservation;materialObservation:MaterialRequestObservation}
 |{kind:'observe';materialObservation:MaterialRequestObservation;verificationObservation:VerificationOperationRequestObservation};
const shape=(v:unknown,keys:string)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_operation_shape');};
const id=(v:unknown)=>{if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('intent_operation_identity');};
const owner=(row:Pick<IntentVerificationOperationRowData,'route'>)=>JSON.parse(row.route).owner;
function compact(raw:VerificationObligationObservation,row:IntentVerificationExecution,binding:Readonly<IntentApplicationBinding>){const value=parseVerificationObligationObservation(raw),obligation=row.registration.obligations.find(o=>o.obligation.obligationId===row.obligationId);if(!obligation||value.obligationId!==row.obligationId||value.definitionHash!==obligation.obligation.definitionHash||json(value.owner)!==json(owner(row))||value.application.state!=='active'||value.application.pendingTransitionId!==null||!value.application.current||value.application.current.bindingHash!==row.bindingHash||json(value.application.current.binding)!==json(binding))throw Error('intent_operation_obligation');return {definitionHash:value.definitionHash,attemptEpoch:value.attemptEpoch,activeAttemptId:value.activeAttemptId,bindingHash:row.bindingHash,applicationRevision:value.application.current.revision};}
function receipt(raw:unknown,row:Pick<IntentVerificationOperationRowData,'invocation'>,challengeId:string|null){shape(raw,'authorizationId scopeDigest invocation');const value=raw as AuthorizedProductValidationMaterials['publicReceipt'];id(value.authorizationId);if(value.authorizationId!==challengeId||!/^[a-f0-9]{64}$/.test(value.scopeDigest)||json(value.invocation)!==json(row.invocation))throw Error('intent_operation_material');return value;}
function pair(materialRaw:MaterialRequestObservation,verificationRaw:VerificationOperationRequestObservation,row:Pick<IntentVerificationOperationRowData,'materialRequestId'|'verificationRequestId'|'invocation'|'obligationId'|'route'>,prior:IntentVerificationOperation){
 const material=parseMaterialRequestObservation(materialRaw),verification=parseVerificationOperationRequestObservation(verificationRaw);
 if(material.requestId!==row.materialRequestId||verification.requestId!==row.verificationRequestId||json(verification.invocation)!==json(row.invocation)||verification.obligationId!==row.obligationId||json(verification.owner)!==json(owner(row)))throw Error('intent_operation_binding');
 if(prior.challengeId&&material.challengeId&&prior.challengeId!==material.challengeId)throw Error('intent_operation_material');
 if(verification.state==='operation'){
  const op=verification.operation;if(prior.operationId&&prior.operationId!==op.id||prior.attemptId&&prior.attemptId!==op.attemptId||prior.expected&&json(prior.expected)!==json(op.expected))throw Error('intent_operation_identity');
  if(op.state!=='cancelled'){
   const h=material.handoff;if(!h||h.state!=='attached'||h.ownerKey!==json(owner(row))||json(h.invocation)!==json(row.invocation)||json(h.expected)!==json(op.expected)||!prior.obligationObservation)throw Error('intent_operation_attachment');
   if(prior.materialReceipt&&(prior.materialReceipt.authorizationId!==h.authorizationId||prior.materialReceipt.scopeDigest!==h.scopeDigest))throw Error('intent_operation_attachment');
  }
 }
 return {material,verification};
}
function observationPhase(verification:VerificationOperationRequestObservation,material:Readonly<MaterialRequestObservation>):IntentVerificationOperation['phase']{
 if(verification.state==='operation'&&verification.operation.state==='terminal'&&verification.operation.terminalResult)return 'terminal';
 if((verification.state==='not_prepared'||verification.state==='retired'||verification.state==='operation'&&verification.operation.state==='cancelled')&&['not_prepared','retired'].includes(material.state))return 'retired';
 return 'observing';
}
export function parseIntentVerificationOperation(raw:unknown,row:IntentVerificationExecution,binding:Readonly<IntentApplicationBinding>):IntentVerificationOperation|null;
export function parseIntentVerificationOperation(raw:unknown,row:IntentVerificationOperationRowData,binding:Readonly<IntentApplicationBinding>):IntentVerificationOperation|null;
export function parseIntentVerificationOperation(raw:unknown,row:IntentVerificationOperationRowData,binding:Readonly<IntentApplicationBinding>):IntentVerificationOperation|null {
 if(raw===null)return null;const v=captureIntentData(raw) as IntentVerificationOperation;shape(v,'revision phase obligationObservation challengeId materialReceipt operationId attemptId expected materialObservation verificationObservation');
 if(!Number.isSafeInteger(v.revision)||v.revision<1||!['material_preparing','material_authorizing','material_staging','preparing','dispatching','observing','terminal','retired'].includes(v.phase))throw Error('intent_operation_phase');
 if(v.obligationObservation!==null){shape(v.obligationObservation,'definitionHash attemptEpoch activeAttemptId bindingHash applicationRevision');const o=v.obligationObservation,definition=row.registration.obligations.find(entry=>entry.obligation.obligationId===row.obligationId);if(!definition||o.definitionHash!==definition.obligation.definitionHash||o.bindingHash!==row.bindingHash||!Number.isSafeInteger(o.attemptEpoch)||o.attemptEpoch<0||!Number.isSafeInteger(o.applicationRevision)||o.applicationRevision<1||(o.attemptEpoch===0)!==(o.activeAttemptId===null))throw Error('intent_operation_obligation');if(o.activeAttemptId!==null)id(o.activeAttemptId);}
 for(const value of [v.challengeId,v.operationId,v.attemptId])if(value!==null)id(value);
 if(v.materialReceipt!==null)receipt(v.materialReceipt,row,v.challengeId);
 if((v.operationId===null)!==(v.attemptId===null)||(v.operationId===null)!==(v.expected===null))throw Error('intent_operation_identity');
 const fresh=['material_preparing','material_authorizing','material_staging','preparing'];
 if(fresh.includes(v.phase)){
  if(!v.obligationObservation||v.operationId!==null||v.materialObservation!==null||v.verificationObservation!==null||v.revision<({material_preparing:1,material_authorizing:2,material_staging:3,preparing:4} as Record<string,number>)[v.phase])throw Error('intent_operation_phase');
  if((v.phase==='material_preparing')!==(v.challengeId===null)||(v.phase==='preparing')!==(v.materialReceipt!==null))throw Error('intent_operation_phase');
 }else{
  if(!v.materialObservation||!v.verificationObservation)throw Error('intent_operation_phase');const checked=pair(v.materialObservation,v.verificationObservation,row,v);
  if(checked.verification.state==='operation'){if(v.operationId!==checked.verification.operation.id||v.attemptId!==checked.verification.operation.attemptId||json(v.expected)!==json(checked.verification.operation.expected))throw Error('intent_operation_identity');}else if(v.operationId!==null)throw Error('intent_operation_identity');
  if(v.phase==='dispatching'){if(!v.obligationObservation||!v.materialReceipt||v.revision<5||checked.verification.state!=='operation'||checked.verification.operation.state!=='prepared')throw Error('intent_operation_phase');}else if(v.phase!==observationPhase(checked.verification,checked.material))throw Error('intent_operation_phase');
 }
 return v;
}
export function applyIntentVerificationOperation(row:IntentVerificationExecution,binding:Readonly<IntentApplicationBinding>,raw:IntentVerificationOperationAction):IntentVerificationOperation {
 const action=captureIntentData(raw);shape(action,({ 'begin-materials':'kind observation','material-step':'kind step',prepare:'kind receipt',dispatch:'kind operationId attemptId attemptEpoch observation materialObservation',observe:'kind materialObservation verificationObservation'} as Record<string,string>)[action.kind]??'');
 const old=parseIntentVerificationOperation(row.operation,row,binding);let next:IntentVerificationOperation=old?captureIntentData(old):{revision:0,phase:'observing',obligationObservation:null,challengeId:null,materialReceipt:null,operationId:null,attemptId:null,expected:null,materialObservation:null,verificationObservation:null};
 if(action.kind==='begin-materials'){if(old)throw Error('intent_operation_phase');next.obligationObservation=compact(action.observation,row,binding);next.phase='material_preparing';}
 else if(action.kind==='material-step'){
  if(!old)throw Error('intent_operation_phase');const step=action.step;shape(step,step.phase==='prepare'?'requestId phase draft':'requestId phase draft challengeId');if(step.requestId!==row.materialRequestId||json(step.draft)!==json(row.draft))throw Error('intent_operation_material');
  if(step.phase==='prepare'){if(old.phase!=='material_preparing')throw Error('intent_operation_phase');return old;}
  if(step.phase==='authorize'){if(old.phase!=='material_preparing')throw Error('intent_operation_phase');id(step.challengeId);next.challengeId=step.challengeId!;next.phase='material_authorizing';}
  else if(step.phase==='stage'){if(old.phase!=='material_authorizing'||step.challengeId!==old.challengeId)throw Error('intent_operation_phase');next.phase='material_staging';}else throw Error('intent_operation_phase');
 }else if(action.kind==='prepare'){if(old?.phase!=='material_staging')throw Error('intent_operation_phase');next.materialReceipt=receipt(action.receipt,row,old.challengeId);next.phase='preparing';}
 else if(action.kind==='dispatch'){
  if(old?.phase!=='preparing'||!old.obligationObservation||action.attemptEpoch!==old.obligationObservation.attemptEpoch+1)throw Error('intent_operation_epoch');const checked=pair(action.materialObservation,action.observation,row,old);if(checked.verification.state!=='operation'||checked.verification.operation.state!=='prepared'||checked.verification.operation.id!==action.operationId||checked.verification.operation.attemptId!==action.attemptId)throw Error('intent_operation_binding');next.operationId=action.operationId;next.attemptId=action.attemptId;next.expected=checked.verification.operation.expected;next.materialObservation=checked.material;next.verificationObservation=checked.verification;next.phase='dispatching';
 }else{
  const checked=pair(action.materialObservation,action.verificationObservation,row,next);if(old&&['terminal','retired'].includes(old.phase)){if(json(old.materialObservation)!==json(checked.material)||json(old.verificationObservation)!==json(checked.verification))throw Error('intent_operation_terminal');return old;}
  next.materialObservation=checked.material;next.verificationObservation=checked.verification;if(checked.material.challengeId){if(next.challengeId&&next.challengeId!==checked.material.challengeId)throw Error('intent_operation_material');next.challengeId=checked.material.challengeId;}
  if(checked.verification.state==='operation'){next.operationId=checked.verification.operation.id;next.attemptId=checked.verification.operation.attemptId;next.expected=checked.verification.operation.expected;}
  next.phase=observationPhase(checked.verification,checked.material);if(old&&isDeepStrictEqual(next,old))return old;
 }
 next.revision++;return parseIntentVerificationOperation(next,row,binding)!;
}
