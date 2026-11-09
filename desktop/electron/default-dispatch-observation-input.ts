import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {captureOriginalChildPreparation,originalChildPreparationInputDigest} from '../../src/runtime/task-host/default-dispatch-preparation.js';
import {buildKSwarmTaskCreateInputCandidates,KSWARM_TASK_INPUT_MAPPER_VERSION} from './kswarm-task-input.js';
import type {OriginalDefaultDispatchObservationRequestData} from './default-dispatch-business-controller.js';
/** Data projection only. Calling this with a copied B receipt grants no Host
 * access; only the owner of the actual original read may use its private proof. */
export function mapDefaultDispatchObservationInput(request:OriginalDefaultDispatchObservationRequestData,raw:unknown){
 const basis=captureDispatchBusinessData(raw) as any;
 if(basis.ok!==true||basis.protocol!=='ordinary_default_dispatch_preparation_basis_v1'&&basis.protocol!=='ordinary_default_dispatch_preparation_basis_v2')return{kind:'unavailable' as const,reason:'basis_unavailable'};
 if(basis.protocol==='ordinary_default_dispatch_preparation_basis_v2'){
  const effect=basis.hostEffect;
  if(!effect||typeof effect!=='object'||Array.isArray(effect)||Object.keys(effect).length!==2||!Object.hasOwn(effect,'registration')||!Object.hasOwn(effect,'noEffectFinish'))throw Error('DEFAULT_DISPATCH_HOST_EFFECT_BASIS_INVALID');
  const registration=effect.registration,finish=effect.noEffectFinish;
  if(registration!==null&&(!registration||registration.kind!=='ordinary_default_dispatch_host_registration'||registration.childKey!==basis.child?.id||registration.payloadHash!==basis.child?.payloadHash||registration.projectId!==basis.child?.projectId))throw Error('DEFAULT_DISPATCH_HOST_EFFECT_BASIS_INVALID');
  if(finish!==null&&(!registration||!finish||finish.kind!=='ordinary_default_dispatch_host_no_effect_finish'||finish.registrationId!==registration.id||finish.childKey!==registration.childKey||finish.payloadHash!==registration.payloadHash||finish.hostLeaseKey!==registration.hostLeaseKey||finish.sourceIncarnation!==registration.sourceIncarnation||finish.disposition!=='no_effect'||basis.observation!==null))throw Error('DEFAULT_DISPATCH_HOST_EFFECT_BASIS_INVALID');
 }
 const child=basis.child,intent=basis.intent;
 if(!child||child.id!==request.childKey||child.payloadHash!==request.payloadHash||child.taskId!==request.taskId||child.projectId!==request.projectId||canonicalVerificationJson(child.scope)!==canonicalVerificationJson(request.scope))throw Error('DEFAULT_DISPATCH_OBSERVATION_CHILD_MISMATCH');
 if(intent===null)return{kind:'unavailable' as const,reason:'preparation_intent_missing'};
 if(!intent||intent.childKey!==child.id||intent.payloadHash!==child.payloadHash||intent.projectId!==child.projectId||intent.writerStoreId!==child.writerStoreId||intent.bindingDigest!==child.bindingDigest||canonicalVerificationJson(intent.scope)!==canonicalVerificationJson(child.scope)||intent.inputMapperVersion!==KSWARM_TASK_INPUT_MAPPER_VERSION)throw Error('DEFAULT_DISPATCH_OBSERVATION_INTENT_MISMATCH');
 const marker=captureOriginalChildPreparation({version:1,contract:'ordinary_default_dispatch_task_preparation_v1',scope:child.scope,projectId:child.projectId,kswarmTaskId:child.taskId,runId:intent.runId,businessExecutionGeneration:child.businessExecutionGeneration,childKey:child.id,payloadHash:child.payloadHash,bindingDigest:child.bindingDigest,hostId:intent.hostId,inputDigest:intent.inputDigest,taskId:intent.taskId,sessionId:intent.sessionId,preparationId:intent.preparationId});
 const execution=child.payload?.execution;
 if(!execution||execution.project?.id!==child.projectId||execution.task?.id!==child.taskId)throw Error('DEFAULT_DISPATCH_OBSERVATION_EXECUTION_MISMATCH');
 const candidates=buildKSwarmTaskCreateInputCandidates({execution,runId:intent.runId,targetParticipantId:intent.targetParticipantId});
 let input:typeof candidates[number]|undefined;
 for(let i=0;i<candidates.length;i++)if(originalChildPreparationInputDigest(candidates[i]!)===intent.inputDigest){if(input)throw Error('DEFAULT_DISPATCH_OBSERVATION_INPUT_AMBIGUOUS');input=candidates[i]!;}
 if(!input)return{kind:'unavailable' as const,reason:'input_mapping_unverified'};
 const data=captureDispatchBusinessData({scope:child.scope,projectId:child.projectId,taskId:child.taskId,runId:intent.runId,businessExecutionGeneration:child.businessExecutionGeneration,childKey:child.id,payloadHash:child.payloadHash,bindingDigest:child.bindingDigest,hostId:intent.hostId,input});
 return{kind:'mapped' as const,data,marker};
}
