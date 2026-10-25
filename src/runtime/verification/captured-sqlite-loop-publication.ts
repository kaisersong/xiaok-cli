import {createHash} from 'node:crypto';
import {capturedFields,capturedIdentity,capturedInteger,parseCapturedSourceJson} from './captured-source-json.js';
import type {CapturedLoopRow,CapturedLoopSourceReader} from './captured-sqlite-loop-reader.js';
import {parseCapturedLoopSemanticRow} from './captured-sqlite-loop-values.js';
import {loopSemanticFailure as fail,loopObject as object,loopChoice as choice} from './captured-sqlite-loop-row-semantics.js';
import {canonicalVerificationJson as canonical} from './protocol.js';
import {parseLoopPublicationConfiguration} from '../loop/publication-config.js';
import {parseLoopApplicationBinding,loopApplicationBindingHash} from './loop-application-binding.js';
import {parseLoopBusinessContract} from './loop-application-contract.js';
import {parseLoopPublicationAttempt} from '../loop/publication-attempt.js';
import {parseLoopVerificationExecution} from '../loop/verification-execution.js';
import type {LoopNativeAttempt,LoopNativeAttemptTarget,LoopVerificationSession} from '../loop/producer-types.js';
import type {GoalVerificationDefinition} from '../goal/verification-definition.js';
export const capturedLoopBasisHash=(raw:string)=>createHash('sha256').update('xiaok-loop-run-publication-basis-v1\0').update(raw).digest('hex');
export interface CapturedLoopRunBasis {readonly value:Record<string,unknown>;readonly configuration:ReturnType<typeof parseLoopPublicationConfiguration>}
function string(value:unknown):asserts value is string{if(typeof value!=='string')fail('text');}
function hash(value:unknown):void{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('hash');}

/** Historical configuration ownership; current deletion never erases the old binding. */
export function assertCapturedLoopConfigurationOwner(loopId:string,definition:Readonly<Record<string,unknown>>,contract:ReturnType<typeof parseLoopPublicationConfiguration>['contract'],hasTemplate:boolean,allowDeletedTemplate=false):void{
 if(definition.id!==loopId)fail('configuration_owner');
 if(contract.kind==='builtin-diagnostic'&&definition.origin==='built_in'&&contract.scanner===loopId)return;
 if(contract.kind==='assistant'&&definition.origin==='built_in'&&loopId===(contract.assistantKind==='evening'?'personal-assistant-evening-reflection':'personal-assistant-morning-briefing'))return;
 if(contract.kind==='user-template'&&definition.origin==='user_template'&&(hasTemplate||allowDeletedTemplate&&definition.status==='deleted'))return;
 fail('configuration_owner');
}
export function readCapturedLoopRunBasis(reader:CapturedLoopSourceReader,current:CapturedLoopRow):CapturedLoopRunBasis|undefined{
 const item=reader.one('loop:basis',current.value.id,false);if(!item)return undefined;
 const row=item.value,value=object(item.json.basis_json);capturedFields(value,['version','runId','loopId','requestSource','originalTriggerJson','logicalRunKey','configuration','contract','sourceRows']);
 const source=object(value.sourceRows),configuration=object(value.configuration);capturedFields(source,['run','definition','template','assistantProfile']);capturedFields(configuration,['loopId','revision','configuration','createdAt','updatedAt']);
 const run=object(source.run),definition=object(source.definition);parseCapturedLoopSemanticRow('loop_runs',run);parseCapturedLoopSemanticRow('loop_definitions',definition);if(source.template!==null)parseCapturedLoopSemanticRow('user_loop_templates',object(source.template));if(source.assistantProfile!==null)parseCapturedLoopSemanticRow('assistant_profiles',object(source.assistantProfile));choice(value.requestSource,['user','agent','scheduler']);capturedInteger(configuration.revision,1);capturedInteger(configuration.createdAt);capturedInteger(configuration.updatedAt,configuration.createdAt as number);
 if(value.version!==1||value.runId!==row.run_id||value.loopId!==current.value.loop_id||run.id!==row.run_id||definition.id!==value.loopId||run.loop_id!==value.loopId||configuration.loopId!==value.loopId||value.logicalRunKey!==run.logical_run_key)fail('basis_identity');
 for(const key of ['id','loop_id','trigger_json','logical_run_key','started_at'] as const)if(canonical(current.value[key])!==canonical(run[key]))fail('basis_run_changed');
 string(row.basis_json);if(canonical(value)!==row.basis_json||capturedLoopBasisHash(row.basis_json)!==row.basis_hash)fail('basis_hash');string(run.trigger_json);if(canonical(parseCapturedSourceJson(run.trigger_json))!==value.originalTriggerJson)fail('basis_trigger');
 const config=parseLoopPublicationConfiguration(configuration.configuration),contract=parseLoopBusinessContract(value.contract);assertCapturedLoopConfigurationOwner(String(value.loopId),definition,config.contract,source.template!==null);let derived:unknown;
 if(config.contract.kind==='builtin-diagnostic'){if(source.template!==null||source.assistantProfile!==null)fail('basis_kind');derived={version:1,...config.contract};}
 else if(config.contract.kind==='user-template'){const template=object(source.template);if(source.assistantProfile!==null||template.loop_id!==value.loopId)fail('basis_kind');string(template.contract_json);derived={version:1,kind:'user-template',templateKind:template.kind,prompt:template.prompt,outputDirectory:template.output_directory,outputFileName:template.output_file_name,loopContract:parseCapturedSourceJson(template.contract_json)};}
 else{const profile=object(source.assistantProfile);if(source.template!==null||profile.status!=='active')fail('basis_kind');string(profile.data_scopes_json);derived={version:1,...config.contract,profileId:profile.id,locale:profile.locale,timeZone:profile.time_zone,dataScopes:parseCapturedSourceJson(profile.data_scopes_json)};}
 if(canonical(contract)!==canonical(derived))fail('basis_contract');return{value,configuration:config};
}
export function readCapturedLoopBinding(reader:CapturedLoopSourceReader,item:CapturedLoopRow,run:CapturedLoopRow,basis:CapturedLoopRunBasis){
 const row=item.value,binding=parseLoopApplicationBinding(item.json.binding_json);
 if(binding.candidateId!==row.candidate_id||binding.subject.runId!==row.run_id||row.run_id!==run.value.id||binding.subject.loopId!==run.value.loop_id||binding.candidateRevision!==row.revision||(binding.subject.stage?.stageId??null)!==row.stage_id||canonical(binding.subject)!==row.subject_key||canonical(binding)!==row.binding_json||loopApplicationBindingHash(binding)!==row.binding_hash||row.publication_state!=='captured'||canonical(binding.contract)!==canonical(basis.value.contract)||binding.originalTriggerJson!==basis.value.originalTriggerJson||binding.logicalRunKey!==basis.value.logicalRunKey)fail('candidate_binding');
 if(row.stage_id!==null){const stage=reader.one('loop:stage',row.stage_id)!.value;if(stage.run_id!==row.run_id||binding.subject.stage?.stageKind!==stage.stage_kind)fail('candidate_stage');}
 hash(row.source_vector_hash);return binding;
}
export function readCapturedLoopNativeTarget(item:CapturedLoopRow,candidate:CapturedLoopRow,binding:ReturnType<typeof parseLoopApplicationBinding>,basis:CapturedLoopRunBasis):Readonly<LoopNativeAttemptTarget>{
 const row=item.value;if(row.candidate_id!==candidate.value.candidate_id)fail('native_candidate');
 for(const field of ['attempt_id','candidate_id','application_request_id'])capturedIdentity(row[field]);for(const field of ['binding_hash','source_vector_hash','definition_hash'])hash(row[field]);for(const field of ['revision','ordinal','configuration_revision'])capturedInteger(row[field],1);
 capturedInteger(row.created_at);capturedInteger(row.updated_at,row.created_at as number);if((row.ordinal as number)>32||row.original_source!=='user'||row.application_request_id===row.enrollment_request_id)fail('native_identity');
 const phase=String(row.phase),edges:Record<string,readonly string[]>={reserved:['enrolling','retired','stale'],enrolling:['enrolled','retired','stale'],enrolled:['binding','retired','stale'],binding:['ready','retired','needs_reauthorization','stale'],ready:[],retired:[],needs_reauthorization:[],stale:[]};if(!Object.hasOwn(edges,phase))fail('native_phase');
 if(row.kind==='enrollment-and-application'){capturedIdentity(row.enrollment_request_id);if(row.enrollment_source_attempt_id!==null||row.reauthorizes_attempt_id!==null)fail('native_lineage');}
 else if(row.kind==='application-reauthorization'){if(row.enrollment_request_id!==null||['reserved','enrolling'].includes(phase))fail('native_lineage');capturedIdentity(row.enrollment_source_attempt_id);capturedIdentity(row.reauthorizes_attempt_id);}else fail('native_kind');
 let reached=new Set([row.kind==='application-reauthorization'?'enrolled':'reserved']);for(let revision=1;revision<(row.revision as number)&&reached.size;revision++)reached=new Set([...reached].flatMap(p=>edges[p]!));if(!reached.has(phase))fail('native_revision');
 const definitions=basis.configuration.verificationDefinitions,definition=(binding.subject.stage?definitions.stages[binding.subject.stage.stageKind]:definitions.run) as Readonly<GoalVerificationDefinition>|undefined;if(!definition)fail('native_definition');
 const definitionHash=createHash('sha256').update('xiaok-loop-native-definition-v1\0').update(canonical(definition)).digest('hex');
 if(row.binding_hash!==candidate.value.binding_hash||row.source_vector_hash!==candidate.value.source_vector_hash||row.definition_hash!==definitionHash||row.configuration_revision!==object(basis.value.configuration).revision)fail('native_target');
 const attempt={kind:row.kind,attemptId:row.attempt_id,candidateId:row.candidate_id,revision:row.revision,ordinal:row.ordinal,originalSource:row.original_source,bindingHash:row.binding_hash,sourceVectorHash:row.source_vector_hash,configurationRevision:row.configuration_revision,definitionHash:row.definition_hash,enrollmentRequestId:row.enrollment_request_id,applicationRequestId:row.application_request_id,phase:row.phase,createdAt:row.created_at,updatedAt:row.updated_at,enrollmentSourceAttemptId:row.enrollment_source_attempt_id,reauthorizesAttemptId:row.reauthorizes_attempt_id} as LoopNativeAttempt;
 return{attempt,binding,definition};
}
export function readCapturedLoopVerificationSession(item:CapturedLoopRow,target:Readonly<LoopNativeAttemptTarget>):LoopVerificationSession{
 const row=item.value;if(target.attempt.phase!=='ready'||target.attempt.attemptId!==row.native_attempt_id||target.attempt.candidateId!==row.candidate_id||!target.definition.obligations.some(o=>o.obligationId===row.obligation_id))fail('session_target');
 for(const key of ['id','native_attempt_id','candidate_id','obligation_id','session_id','operation_id','validation_invocation_id','enrollment_request_id'])capturedIdentity(row[key]);
 const phases:Record<string,number>={reserved:1,session_ready:2,enrolling:3,enrolled:4,retired:4,stale:4};if(!/^[A-Za-z0-9_-]{1,160}$/.test(String(row.session_id))||row.revision!==phases[String(row.phase)]||new Set([row.id,row.session_id,row.operation_id,row.validation_invocation_id,row.enrollment_request_id]).size!==5)fail('session_identity');capturedInteger(row.created_at);capturedInteger(row.updated_at,row.created_at as number);
 return{id:row.id,nativeAttemptId:row.native_attempt_id,candidateId:row.candidate_id,obligationId:row.obligation_id,sessionId:row.session_id,operationId:row.operation_id,validationInvocationId:row.validation_invocation_id,enrollmentRequestId:row.enrollment_request_id,phase:row.phase,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at} as LoopVerificationSession;
}
export function validateCapturedLoopCandidateHistory(reader:CapturedLoopSourceReader,candidate:CapturedLoopRow,binding:ReturnType<typeof parseLoopApplicationBinding>,basis:CapturedLoopRunBasis):void{
 const targets=new Map<string,Readonly<LoopNativeAttemptTarget>>(),history:LoopNativeAttempt[]=[];
 for(const item of reader.related('loop:candidate-native-history',String(candidate.value.candidate_id))){const target=readCapturedLoopNativeTarget(item,candidate,binding,basis),attempt=target.attempt;if(history.length>=32||attempt.ordinal!==history.length+1||targets.has(attempt.attemptId))fail('native_ordinal');
  if(attempt.kind==='application-reauthorization'){const parent=history.at(-1),ancestor=history.find(r=>r.attemptId===attempt.enrollmentSourceAttemptId);if(!parent||parent.attemptId!==attempt.reauthorizesAttemptId||!['needs_reauthorization','retired'].includes(parent.phase)||parent.phase==='retired'&&parent.kind!=='application-reauthorization'||!ancestor||ancestor.kind!=='enrollment-and-application'||ancestor.ordinal>=attempt.ordinal||parent.kind==='application-reauthorization'&&parent.enrollmentSourceAttemptId!==ancestor.attemptId||parent.kind==='enrollment-and-application'&&parent.attemptId!==ancestor.attemptId||[parent,ancestor].some(r=>r.bindingHash!==attempt.bindingHash||r.sourceVectorHash!==attempt.sourceVectorHash||r.definitionHash!==attempt.definitionHash||r.configurationRevision!==attempt.configurationRevision))fail('native_lineage');}
  history.push(attempt);targets.set(attempt.attemptId,target);
 }
 for(const item of reader.related('loop:candidate-verification-sessions',String(candidate.value.candidate_id))){const target=targets.get(String(item.value.native_attempt_id));if(!target)fail('session_target');const session=readCapturedLoopVerificationSession(item,target),execution=reader.one('loop:verification-execution',session.id,false);if(execution){const value=parseLoopVerificationExecution(execution.json.record_json,session,target),row=execution.value;if(value.id!==row.id||value.sessionRecordId!==row.session_record_id||value.revision!==row.revision||canonical(value)!==row.record_json)fail('execution_row');}}
 let sequence=0;for(const item of reader.related('loop:candidate-publication-history',String(candidate.value.candidate_id))){const target=targets.get(String(item.value.native_attempt_id));if(!target)fail('publication_target');const value=parseLoopPublicationAttempt(item.json.record_json,target),row=item.value;if(value.attemptId!==row.attempt_id||value.nativeAttemptId!==row.native_attempt_id||value.candidateId!==row.candidate_id||value.sequence!==row.sequence||value.revision!==row.revision||canonical(value)!==row.record_json)fail('publication_row');if(++sequence>32||value.sequence!==sequence)fail('publication_sequence');}
}
/** Publication subpass only. Full source/row/end integrity also requires the
 * ordinary, result/projection and final declaration passes. */
export function validateCapturedLoopPublicationPass(reader:CapturedLoopSourceReader):void{
 if(!reader.tables.includes('loop_runs'))return;
 for(const item of reader.rows('loop_publication_configs')){const row=item.value;reader.one('loop:definition',row.loop_id);capturedInteger(row.revision,1);capturedInteger(row.created_at);capturedInteger(row.updated_at,row.created_at as number);if(canonical(parseLoopPublicationConfiguration(item.json.configuration_json))!==row.configuration_json)fail('configuration');}
 for(const run of reader.rows('loop_runs')){
  const basis=readCapturedLoopRunBasis(reader,run);
  for(const candidate of reader.related('loop:run-candidates',String(run.value.id))){if(!basis)fail('basis_missing');const binding=readCapturedLoopBinding(reader,candidate,run,basis);validateCapturedLoopCandidateHistory(reader,candidate,binding,basis);}
 }
}
