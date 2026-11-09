import {captureDispatchBusinessData} from '../conversation-activity/dispatch-business-data.js';
import {dshAFields,dshAHash,dshAJson,type DshARecord} from './dsh-admission-data.js';
import {parseEvidenceManifest,parseSemanticAssessment,parseSourceControl,instantMs} from '../admission/parse.js';
import {hashEvidenceManifest,hashSemanticAssessment} from '../admission/hash.js';
import type {FrozenInputEnvelopeV1,FrozenEvidenceManifest,FrozenSemanticAssessment,FrozenThreadKey,StorageScope} from '../admission/types.js';
const includes=Array.prototype.includes;
const integer=Number.isSafeInteger,pattern=RegExp.prototype.test,apply=Reflect.apply;
const hex=/^[a-f0-9]{64}$/,control=/[\x00-\x1f\x7f]/;
function deny(code='ADMISSION_OWNER_COMMAND_INVALID'):never{throw Error(code);}
function text(value:unknown):asserts value is string{if(typeof value!=='string'||value.length<1||value.length>256||apply(pattern,control,[value]))deny('ADMISSION_OWNER_FIELD_UNREPRESENTABLE');}
function hash(value:unknown):void{if(typeof value!=='string'||!apply(pattern,hex,[value]))deny();}
function revision(value:unknown):void{if(typeof value!=='number'||!integer(value)||value<1)deny();}
function record(value:unknown,fields:readonly string[]):DshARecord{dshAFields(value,fields);return value;}
function guard(value:unknown,fields:readonly string[]):DshARecord{
 const row=record(value,fields);for(const key of fields){if(key==='epoch'||key==='revision'||key==='controlRevision')revision(row[key]);else if(key==='canonicalHash'||key==='policyHash')hash(row[key]);else text(row[key]);}return row;
}
export interface DshAdmissionOwnerAuthority {
 readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;
 readonly admissionWindowRef:string;readonly freshnessAttestationRef:string;
 readonly authorityValidUntil:string;readonly executionDeadline:string;readonly executionProfile:string;
 readonly modeGuards:readonly Readonly<{scopeKey:string;epoch:number}>[];
 readonly controlGuards:Readonly<{policies:readonly DshARecord[];leaves:readonly DshARecord[]}>;
 readonly workGuard:Readonly<{scopeKey:string;epoch:number;revision:number}>|null;
 readonly egressGuard:Readonly<{policyRef:string;epoch:number;policyHash:string}>;
 readonly freshness:Readonly<{window:DshARecord;eventTimeEvidenceRef:string;attestationRef:string}>;
}
export interface DshAdmissionOwnerCommandInput {
 readonly scope:StorageScope;readonly thread:FrozenThreadKey;readonly bindingId:string;readonly generation:1;
 readonly action:'create_work'|'append_input';readonly input:FrozenInputEnvelopeV1;readonly inputId:string;
 readonly evidenceManifest:FrozenEvidenceManifest;readonly assessment:FrozenSemanticAssessment;
 readonly authority:DshAdmissionOwnerAuthority;readonly target:Readonly<{ownerWorkId:string;ownerVersion:number}>|null;
 readonly budgetReservationRef:string;readonly attestationRef:string;readonly attemptId:string;
}
export interface DshAdmissionOwnerCommandResult {
 readonly command:Readonly<DshARecord>;readonly ownerManifest:Readonly<DshARecord>;
 readonly manifestLink:Readonly<{schemaVersion:1;adapterVersion:'a2-to-kswarm-dsh-v1';a2ManifestHash:string;ownerManifestHash:string;entriesHash:string;sourceSnapshotAt:string;assessmentHash:string;assessmentId:string;attestationRef:string}>;
}
/** Pure exact A2→original B bytes. Neither a DTO, its digest nor this adapter
 * grants Source, egress, spending, N/M/P or command-delivery authority. */
export function buildDshAdmissionOwnerCommand(raw:DshAdmissionOwnerCommandInput):DshAdmissionOwnerCommandResult {
 const value=captureDispatchBusinessData(raw) as unknown as DshAdmissionOwnerCommandInput;
 record(value,['scope','thread','bindingId','generation','action','input','inputId','evidenceManifest','assessment','authority','target','budgetReservationRef','attestationRef','attemptId']);
 const scope=record(value.scope,['profileId','workspaceId']);hash(scope.profileId);hash(scope.workspaceId);
 const thread=record(value.thread,['tenantId','workspaceId','sourceBindingId','provider','repositoryId','kind','threadId']);
 for(const key of Object.keys(thread))text(thread[key]);if(thread.provider!=='github'||thread.kind!=='issue')deny();
 const envelope=parseSourceControl({envelope:value.input,controlEvidence:{state:'unknown',reason:'producer_unavailable'}}).envelope;
 if(value.generation!==1||value.action!=='create_work'&&value.action!=='append_input'||envelope.kind!=='created'&&envelope.kind!=='edited'||envelope.actorEvidence.kind==='unknown')deny();
 if(value.inputId!==envelope.inputId||dshAJson(envelope.thread)!==dshAJson(thread))deny();
 for(const id of [value.bindingId,value.inputId,value.budgetReservationRef,value.attestationRef,value.attemptId,envelope.objectId,envelope.providerRevision,envelope.snapshotRef])text(id);
 const authScope=record(envelope.authScope,['tenantId','workspaceId','connectionId','providerAccountId','repositoryId','credentialEpoch']);
 for(const key of ['tenantId','workspaceId','connectionId','providerAccountId','repositoryId'])text(authScope[key]);revision(authScope.credentialEpoch);
 for(const key of ['tenantId','workspaceId','repositoryId'])if(authScope[key]!==thread[key])deny();
 const manifest=parseEvidenceManifest(value.evidenceManifest),assessment=parseSemanticAssessment(value.assessment);
 if(manifest.manifestHash!==hashEvidenceManifest(manifest)||assessment.assessmentHash!==hashSemanticAssessment(assessment)||assessment.evidenceManifestHash!==manifest.manifestHash||dshAJson(manifest.thread)!==dshAJson(thread)||manifest.entries.length!==1||!assessment.decisive||assessment.purpose!=='admission'||!apply(includes,assessment.evidenceRefs,[envelope.inputId])||assessment.suggestedIntent!=='draft_request'&&assessment.suggestedIntent!=='followup')deny('ADMISSION_OWNER_EVIDENCE_CONFLICT');
 text(assessment.assessmentId);
 const input={inputId:envelope.inputId,sourceObjectId:envelope.objectId,sourceRevision:envelope.providerRevision,contentHash:envelope.contentHash,provenanceHash:envelope.actorEvidenceHash,objectKind:envelope.objectKind,provenanceVersion:envelope.provenanceVersion,actorMappingVersion:envelope.actorMappingVersion,snapshotRef:envelope.snapshotRef};
 const entry={inputId:input.inputId,objectKind:input.objectKind,objectId:input.sourceObjectId,revision:input.sourceRevision,contentHash:input.contentHash,provenanceVersion:input.provenanceVersion,actorEvidenceHash:input.provenanceHash,actorMappingVersion:input.actorMappingVersion};
 if(dshAJson(manifest.entries[0])!==dshAJson(entry))deny('ADMISSION_OWNER_EVIDENCE_CONFLICT');
 for(let i=0;i<manifest.entries.length;i++){const item=manifest.entries[i]!;for(const id of [item.inputId,item.objectId,item.revision])text(id);}
 const authority=record(value.authority,['mandateId','mandateRevision','authorizationEpoch','admissionWindowRef','freshnessAttestationRef','authorityValidUntil','executionDeadline','executionProfile','modeGuards','controlGuards','workGuard','egressGuard','freshness']);
 for(const name of ['mandateId','admissionWindowRef','freshnessAttestationRef','executionProfile'])text(authority[name]);revision(authority.mandateRevision);revision(authority.authorizationEpoch);
 instantMs(authority.authorityValidUntil as string);instantMs(authority.executionDeadline as string);
 const modes=authority.modeGuards;if(!Array.isArray(modes)||modes.length!==5)deny();for(let i=0;i<modes.length;i++)guard(modes[i],['scopeKey','epoch']);
 const controls=record(authority.controlGuards,['policies','leaves']);
 if(!Array.isArray(controls.policies)||controls.policies.length!==25||!Array.isArray(controls.leaves)||controls.leaves.length!==4)deny();
 for(let i=0;i<controls.policies.length;i++){const row=guard(controls.policies[i],['scopeKey','axis','epoch','canonicalHash','controlRevision']);if(!['mode','mandate','egress','privacy','readonly'].includes(row.axis as string))deny();}
 for(let i=0;i<controls.leaves.length;i++)guard(controls.leaves[i],['id','epoch','canonicalHash','controlRevision']);
 guard(authority.egressGuard,['policyRef','epoch','policyHash']);
 const freshness=record(authority.freshness,['window','eventTimeEvidenceRef','attestationRef']),window=record(freshness.window,['windowId','sourceBindingId','prefixModeGuardsHash','admissionGrantHash','effectiveAt','baselineCheckpointRef','providerTimeBasisProofRef','freshnessPolicyVersion']);
 for(const key of ['windowId','sourceBindingId','baselineCheckpointRef','providerTimeBasisProofRef'])text(window[key]);text(freshness.eventTimeEvidenceRef);text(freshness.attestationRef);hash(window.prefixModeGuardsHash);hash(window.admissionGrantHash);instantMs(window.effectiveAt as string);
 if(window.windowId!==authority.admissionWindowRef||window.sourceBindingId!==thread.sourceBindingId||window.prefixModeGuardsHash!==dshAHash(modes)||window.freshnessPolicyVersion!==1||freshness.attestationRef!==authority.freshnessAttestationRef)deny();
 const create=value.action==='create_work';
 if(create){if(value.target!==null||authority.workGuard!==null)deny();}else{const target=record(value.target,['ownerWorkId','ownerVersion']);text(target.ownerWorkId);revision(target.ownerVersion);guard(authority.workGuard,['scopeKey','epoch','revision']);const workId='dsh-work:'+dshAHash(['dsh-work-v1',scope,thread,1]);if(target.ownerWorkId!==workId)deny();}
 const ownerCore={schemaVersion:1,thread,entries:manifest.entries,sourceSnapshotAt:manifest.sourceSnapshotAt},ownerManifestHash=dshAHash(['dsh-evidence-manifest-v1',ownerCore]);
 const ownerManifest={...ownerCore,manifestHash:ownerManifestHash};
 const command:DshARecord={scope,thread,authScope,schemaVersion:2,commandId:value.attemptId,bindingId:value.bindingId,generation:1,ownerKind:'kswarm_dsh',mandateId:authority.mandateId,mandateRevision:authority.mandateRevision,authorizationEpoch:authority.authorizationEpoch,action:create?'create_draft_work':'append_input',purpose:'draft',inputId:input.inputId,input,canonical:create?{inputId:input.inputId,createManifestHash:ownerManifestHash}:null,targetWorkId:create?null:value.target!.ownerWorkId,expectedOwnerVersion:create?null:value.target!.ownerVersion,targetFenceEpoch:null,dispatchPolicy:'draft_only_no_business_dispatch',assessmentRef:assessment.assessmentId,assessmentHash:assessment.assessmentHash,admissionWindowRef:authority.admissionWindowRef,freshnessAttestationRef:authority.freshnessAttestationRef,evidenceManifestHash:ownerManifestHash,evidence:{manifest:ownerManifest,attestationRef:value.attestationRef},freshness:authority.freshness,egressGuard:authority.egressGuard,budgetReservationRef:value.budgetReservationRef,authorityValidUntil:authority.authorityValidUntil,executionDeadline:authority.executionDeadline,executionProfile:authority.executionProfile,modeGuards:modes,controlGuards:controls,workGuard:authority.workGuard};
 const semantic={scope,thread,generation:1,action:command.action,target:command.targetWorkId,inputId:create?null:input.inputId,purpose:'draft'},operationKey='dsh-operation:'+dshAHash(['dsh-operation-v1',semantic]);
 const semanticPayloadHash=dshAHash(['dsh-semantic-v1',semantic,value.bindingId,{inputId:input.inputId,input,canonical:command.canonical}]);
 const attemptPayloadHash=dshAHash(['dsh-attempt-v1',command,operationKey,semanticPayloadHash]);
 const manifestLink={schemaVersion:1,adapterVersion:'a2-to-kswarm-dsh-v1',a2ManifestHash:manifest.manifestHash,ownerManifestHash,entriesHash:dshAHash(['dsh-a-manifest-entries-v1',thread,manifest.entries]),sourceSnapshotAt:manifest.sourceSnapshotAt,assessmentHash:assessment.assessmentHash,assessmentId:assessment.assessmentId,attestationRef:value.attestationRef};
 return captureDispatchBusinessData({command:{...command,operationKey,semanticPayloadHash,attemptPayloadHash},ownerManifest,manifestLink}) as unknown as DshAdmissionOwnerCommandResult;
}

export interface DshDraftPreparationCommandInput {
 readonly acceptedCommand:Readonly<DshARecord>;readonly ownerBasis:Readonly<DshARecord>;
 readonly entries:readonly DshARecord[];readonly sourceSnapshotAt:string;
 readonly budgetReservationRef:string;readonly attemptId:string;
}
/** Pure projection of an authenticated accepted work's next draft command.
 * The caller must independently authenticate A, B, all input snapshots and the
 * original budget reservation. These bytes grant none of those permissions. */
export function buildDshDraftPreparationOwnerCommand(raw:DshDraftPreparationCommandInput):Readonly<{command:Readonly<DshARecord>;ownerManifest:Readonly<DshARecord>;draftCommitKey:string}> {
 const value=captureDispatchBusinessData(raw) as unknown as DshDraftPreparationCommandInput;
 record(value,['acceptedCommand','ownerBasis','entries','sourceSnapshotAt','budgetReservationRef','attemptId']);
 const base=value.acceptedCommand;
 record(base,['scope','thread','authScope','schemaVersion','commandId','bindingId','generation','ownerKind','mandateId','mandateRevision','authorizationEpoch','action','purpose','inputId','input','canonical','targetWorkId','expectedOwnerVersion','targetFenceEpoch','dispatchPolicy','assessmentRef','assessmentHash','admissionWindowRef','freshnessAttestationRef','evidenceManifestHash','evidence','freshness','egressGuard','budgetReservationRef','authorityValidUntil','executionDeadline','executionProfile','modeGuards','controlGuards','workGuard','operationKey','semanticPayloadHash','attemptPayloadHash']);
 if(base.schemaVersion!==2||base.generation!==1||base.ownerKind!=='kswarm_dsh'||base.purpose!=='draft'||base.dispatchPolicy!=='draft_only_no_business_dispatch'||base.action!=='create_draft_work'&&base.action!=='append_input')deny();
 text(value.attemptId);text(value.budgetReservationRef);instantMs(value.sourceSnapshotAt);hash(base.assessmentHash);
 const basis=record(value.ownerBasis,['schemaVersion','commandReceipt','appliedOperation','binding','createRecord','control','workGuard','projectCreatedAt','nativeRevision']);
 const binding=basis.binding as DshARecord,control=basis.control as DshARecord,work=basis.workGuard as DshARecord;
 const ownerWorkId='dsh-work:'+dshAHash(['dsh-work-v1',base.scope,base.thread,1]);
 if(basis.schemaVersion!==1||!binding||!control||!work||binding.kind!=='dsh_binding'||binding.bindingId!==base.bindingId||binding.projectId!==ownerWorkId||dshAJson(binding.thread)!==dshAJson(base.thread)||control.kind!=='dsh_control'||control.projectId!==ownerWorkId||control.stopped!==false||control.generationClosed!==false||work.kind!=='dsh_work_guard'||work.projectId!==ownerWorkId||work.mode!=='auto_draft')deny('ADMISSION_OWNER_WORK_CONFLICT');
 revision(control.ownerVersion);revision(control.inputSetRevision);revision(work.epoch);revision(work.revision);text(work.scopeKey);
 const ids=control.validInputIds;if(!Array.isArray(ids)||!ids.length||!Array.isArray(value.entries)||value.entries.length!==ids.length)deny('ADMISSION_OWNER_EVIDENCE_CONFLICT');
 const core={schemaVersion:1 as const,thread:base.thread as unknown as FrozenThreadKey,entries:value.entries as unknown as FrozenEvidenceManifest['entries'],sourceSnapshotAt:value.sourceSnapshotAt};
 const parsed=parseEvidenceManifest({...core,manifestHash:hashEvidenceManifest({...core,manifestHash:'0'.repeat(64)} as FrozenEvidenceManifest)});
 const seen=new Set<string>();for(let i=0;i<parsed.entries.length;i++){const id=parsed.entries[i]!.inputId;if(!apply(includes,ids,[id])||seen.has(id))deny('ADMISSION_OWNER_EVIDENCE_CONFLICT');seen.add(id);}
 const ownerManifest={...core,manifestHash:dshAHash(['dsh-evidence-manifest-v1',core])};
 const command:DshARecord={...base,commandId:value.attemptId,action:'prepare_draft',canonical:null,targetWorkId:ownerWorkId,expectedOwnerVersion:control.ownerVersion,inputSetRevision:control.inputSetRevision,budgetReservationRef:value.budgetReservationRef,evidenceManifestHash:ownerManifest.manifestHash,evidence:{manifest:ownerManifest,attestationRef:(base.evidence as DshARecord).attestationRef},workGuard:{scopeKey:work.scopeKey,epoch:work.epoch,revision:work.revision}};
 delete command.operationKey;delete command.semanticPayloadHash;delete command.attemptPayloadHash;
 const semantic={scope:base.scope,thread:base.thread,generation:1,action:'prepare_draft',target:ownerWorkId,inputId:null,purpose:'draft',inputSetRevision:control.inputSetRevision,assessmentHash:base.assessmentHash};
 const operationKey='dsh-operation:'+dshAHash(['dsh-operation-v1',semantic]);
 const semanticPayloadHash=dshAHash(['dsh-semantic-v1',semantic,base.bindingId,{executionProfile:base.executionProfile}]);
 const attemptPayloadHash=dshAHash(['dsh-attempt-v1',command,operationKey,semanticPayloadHash]);
 const draftCommitKey='dsh-draft:'+dshAHash(['dsh-draft-commit-v1',base.scope,ownerWorkId,base.bindingId,1,control.inputSetRevision,base.assessmentHash]);
 return captureDispatchBusinessData({command:{...command,operationKey,semanticPayloadHash,attemptPayloadHash},ownerManifest,draftCommitKey}) as ReturnType<typeof buildDshDraftPreparationOwnerCommand>;
}
