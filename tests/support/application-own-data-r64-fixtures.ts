// Approved R65 regression support: virtual tests/support module. Typechecked, never executed before design approval.
import { createIntentApplicationBinding, parseIntentApplicationBinding, intentApplicationBindingHash, type IntentApplicationCandidate, type IntentApplicationBinding } from '../../src/runtime/verification/intent-application-binding.js';

const definition = () => ({ version: 1 as const, obligations: [{ obligationId: 'o', predicateId: 'p', predicateVersion: '1', semantics: 'current-subject' as const, recipe: { kind: 'artifact-content' as const, checks: [{ id: 'c', path: 'out.txt', sha256: 'a'.repeat(64), structure: 'utf8' as const }] } }] });

export function validIntentCandidate(): IntentApplicationCandidate {
  return {
    version: 1 as const, kind: 'intent' as const, candidateId: 'candidate', candidateRevision: 1,
    subject: { version: 1 as const, sessionId: 'session', intentId: 'intent', stageId: 'stage' },
    contract: {
      version: 1 as const, sessionId: 'session', intentId: 'intent', rawIntent: 'write', normalizedIntent: 'write', providedSourcePaths: [],
      intentType: 'generate' as const, deliverable: 'report', finalDeliverable: 'report', explicitConstraints: [], delegationBoundary: [],
      riskTier: 'low' as const, intentMode: 'single_stage' as const, segmentationConfidence: 'low' as const, templateId: 'template',
      stages: [{ stageId: 'stage', order: 0, label: 'stage', intentType: 'generate' as const, deliverable: 'report', templateId: 'template',
        riskTier: 'low' as const, dependsOnStageIds: [], steps: [{ stepId: 'step', key: 'collect', order: 0, role: 'collect' as const, skillName: null, dependsOn: [], riskTier: 'low' as const }], verification: definition() }],
      verification: definition(),
    },
    body: { kind: 'intent-stage' as const, stageId: 'stage', summary: 'result', executionReports: [], artifacts: [] },
  };
}

type DeepMutable<T> = T extends readonly (infer U)[] ? DeepMutable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
export type MutableIntentBinding = DeepMutable<IntentApplicationBinding> & { padding?: string; extra?: boolean };

export function validIntentBindingForMutation(): MutableIntentBinding {
  return structuredClone(createIntentApplicationBinding(validIntentCandidate())) as MutableIntentBinding;
}

export function parseMutatedIntent(raw: unknown) {
  return parseIntentApplicationBinding(raw);
}


// Additional sibling fixture families. Setup is planned before malicious patch installation.
import {createHash} from 'node:crypto';
import {createLoopApplicationBinding, parseLoopApplicationBinding, parseLoopCandidateBody, loopApplicationBindingHash, type LoopApplicationCandidate} from '../../src/runtime/verification/loop-application-binding.js';
import {parseGoalApplicationBinding, parseActiveGoalApplicationBinding, goalApplicationBindingHash, type GoalApplicationBinding} from '../../src/runtime/verification/goal-application-binding.js';
import {createPublishedArtifactIndex, publishedArtifactLookupKeys, findIndexedPublishedArtifacts, readIndexedPublishedArtifact, verifyIndexedPublishedArtifact, publishedArtifactPopulation, assertPublishedArtifactIndexOwner} from '../../src/runtime/verification/published-artifact-index.js';
import {readPublishedArtifacts, readPublishedArtifact} from '../../src/runtime/verification/published-artifact-reader.js';
import {assertIntentApplicationArtifacts, assertIndexedIntentApplicationArtifacts} from '../../src/runtime/verification/intent-application-artifacts.js';
import {assertLoopApplicationArtifacts, assertIndexedLoopApplicationArtifacts} from '../../src/runtime/verification/loop-application-artifacts.js';
import {loopHostSubjectOwner} from '../../src/runtime/verification/loop-host-subject.js';
import {intentHostSubjectOwner} from '../../src/runtime/verification/intent-host-subject.js';
import {assertIntentApplicationEnvelope} from '../../src/runtime/verification/intent-application-binding.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import type {PublishedArtifactSelection} from '../../src/runtime/verification/published-artifact-selection.js';
import type {VerificationOwner} from '../../src/runtime/verification/proof-authority.js';
export const selection: PublishedArtifactSelection = {kind:'local',obligationId:'o',path:'a.txt'};
const contentText='x';
const contentHash='2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';
export function sections(){return [{obligationId:'o',definitionHash:'a'.repeat(64),binding:{},evaluation:{},artifacts:[{path:'a.txt',sha256:contentHash,size:1,bytesBase64:'eA=='}]}];}
export function goalCandidate(): GoalApplicationBinding {return {version:1,kind:'goal',sessionId:'session',goalId:'goal',epoch:1,objective:'Complete source',completionCriterion:'Source checked',expectedEvidenceKinds:['answer','file_artifact']};}
export function loopCandidate(): LoopApplicationCandidate {return {version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Original',completionCriterion:'Original'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1,summary:'Original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:1,resolvedAnomalyCount:0,anomalies:[{id:'anomaly',ownerKind:'task',ownerId:'task',kind:'validation_failed',status:'open',firstSeenAt:1,lastSeenAt:1,lastResolvedAt:null,seenCount:1,ignoredUntil:null,message:'Original',evidenceIds:['evidence']}]},artifacts:[{selection:{...selection},sha256:contentHash,size:1}]}};}
export function intentArtifactCandidate():IntentApplicationCandidate {const c=validIntentCandidate();return {...c,body:{kind:'intent-stage',stageId:'stage',summary:'Original',executionReports:[{kind:'step',identity:'step',status:'completed',requestSource:'user',recordedAt:1}],artifacts:[{artifactId:'artifact',stageId:'stage',kind:'report',label:'Report',summary:null,createdAt:1,content:{kind:'inline',text:contentText},selection:{...selection},sha256:contentHash,size:1}]}};}
export function preparePublishedReader(variant='default'){
 let owner:VerificationOwner={profileId:'profile',ownerKind:'task',ownerId:'task'};
 let application:unknown=undefined;
 if(variant.startsWith('intent-')){const binding=createIntentApplicationBinding(intentVariant(variant.slice(7)));owner={profileId:'profile',...intentHostSubjectOwner(binding.subject)};application={binding,bindingHash:intentApplicationBindingHash(binding),revision:1};}
 if(variant.startsWith('loop-')){const binding=createLoopApplicationBinding(loopVariant(variant.slice(5)));owner={profileId:'profile',...loopHostSubjectOwner(binding.subject)};application={binding,bindingHash:loopApplicationBindingHash(binding),revision:1};}
 if(variant==='goal'){const binding=goalCandidate();owner={profileId:'profile',ownerKind:'goal',ownerId:'goal'};application={binding,bindingHash:goalApplicationBindingHash(binding),revision:1};}
 const rawSections=sections(),evaluations=application===undefined?rawSections:rawSections.map(s=>({...s,application}));
 const body=application===undefined?{version:1,owner,dependencies:[],evaluations}:{version:1,owner,dependencies:[],evaluations,application};
 const bytes=Buffer.from(canonicalVerificationJson(body));return {payload:{owner,businessRevision:1,operationId:'publication',fullTupleHash:'b'.repeat(64),payloadHash:createHash('sha256').update(bytes).digest('hex'),bytes},selections:[{...selection}]};
}
import {captureApplicationData, applicationDataDescriptors, readApplicationOwnDataField, applicationDataFromEntries} from '../../src/runtime/verification/application-value-data.js';
import {parsePublishedArtifactSelection} from '../../src/runtime/verification/published-artifact-selection.js';
export interface PreparedPublicCase {invoke:()=>unknown;fixtureFamily:string}
export function preparePublicCase(entry:string,variant="default"):PreparedPublicCase {
 if(entry==='createIntentApplicationBinding'&&variant==='producer-descriptor-invalid'){
  const raw=structuredClone(intentVariant('producer'));
  if(raw.body.kind!=='intent-stage'||!raw.body.producerReports)throw Error('producer fixture');
  (raw.body.producerReports[0] as unknown as Record<string,unknown>).snapshotProbe=['value'];
  return {fixtureFamily:'malformed-producer-object-array-data',invoke:()=>createIntentApplicationBinding(raw)};
 }
 if(entry==='parseGoalApplicationBinding'){const raw=goalCandidate();return {fixtureFamily:'goal',invoke:()=>parseGoalApplicationBinding(raw)};}
 if(entry==='parseActiveGoalApplicationBinding'){const binding=goalCandidate(),raw={binding,bindingHash:goalApplicationBindingHash(binding),revision:1};return {fixtureFamily:'goal-active',invoke:()=>parseActiveGoalApplicationBinding(raw)};}
 if(entry==='canonicalVerificationJson'){const raw={value:['x',1,true,null]};return {fixtureFamily:'canonical-data',invoke:()=>canonicalVerificationJson(raw)};}
 if(entry==='captureApplicationData'){const raw={value:['x',1,true,null]},limits={maximumBytes:65536,maximumNodes:65536,invalid:'fixture_data',limit:'fixture_limit'};return {fixtureFamily:'capture-data',invoke:()=>captureApplicationData(raw,limits)};}
 if(entry==='applicationDataDescriptors'){const raw={value:'x'};return {fixtureFamily:'descriptor-data',invoke:()=>applicationDataDescriptors(raw)};}
 if(entry==='readApplicationOwnDataField'){const raw={value:'x'};return {fixtureFamily:'own-field-data',invoke:()=>readApplicationOwnDataField(raw,'value','fixture_data')};}
 if(entry==='applicationDataFromEntries'){const raw:[string,unknown][]=[['value','x']];return {fixtureFamily:'from-entries-data',invoke:()=>applicationDataFromEntries(raw)};}
 if(entry==='parsePublishedArtifactSelection'){const raw={...selection};return {fixtureFamily:'local-selection',invoke:()=>parsePublishedArtifactSelection(raw)};}
 if(entry==='readPublishedArtifact'){const f=preparePublishedReader(variant);return {fixtureFamily:'reader-local-single',invoke:()=>readPublishedArtifact(f.payload,f.selections[0]!)};}
 if(entry==='readPublishedArtifacts'){const f=preparePublishedReader(variant);return {fixtureFamily:'reader-local-content',invoke:()=>readPublishedArtifacts(f.payload,f.selections)};}
 if(entry==='completionConsumerOwner'){const raw={ownerKind:'loop_run' as const,ownerId:'run'};return {fixtureFamily:'completion-loop-owner',invoke:()=>completionConsumerOwner(raw)};}
 if(entry==='createLoopApplicationBinding'){const raw=loopVariant(variant);return {fixtureFamily:'loop-diagnostic-with-anomaly-artifact',invoke:()=>createLoopApplicationBinding(raw)};}
 if(entry==='parseLoopCandidateBody'){const raw=loopVariant(variant);return {fixtureFamily:'loop-diagnostic-body',invoke:()=>parseLoopCandidateBody(raw.body,raw.subject,raw.contract)};}
 if(entry==='parseLoopApplicationBinding'){const raw=createLoopApplicationBinding(loopVariant(variant));return {fixtureFamily:'loop-diagnostic-binding',invoke:()=>parseLoopApplicationBinding(raw)};}
 if(entry==='createIntentApplicationBinding'){const raw=intentVariant(variant);return {fixtureFamily:'intent-stage-report-artifact',invoke:()=>createIntentApplicationBinding(raw)};}
 if(entry==='parseIntentApplicationBinding'){const raw=createIntentApplicationBinding(intentVariant(variant));return {fixtureFamily:'intent-stage-binding',invoke:()=>parseIntentApplicationBinding(raw)};}
 if(entry==='assertIntentApplicationEnvelope'){const binding=createIntentApplicationBinding(intentVariant(variant)),raw={binding};return {fixtureFamily:'intent-envelope',invoke:()=>assertIntentApplicationEnvelope(raw)};}
 if(entry==='assertLoopApplicationArtifacts'||entry==='assertIndexedLoopApplicationArtifacts'){const binding=createLoopApplicationBinding(loopCandidate()),owner={profileId:'profile',...loopHostSubjectOwner(binding.subject)},raw=sections(),keys=new Set(publishedArtifactLookupKeys(owner,selection,true)),index=createPublishedArtifactIndex(owner,raw,keys);return {fixtureFamily:'loop-index-content',invoke:()=>entry==='assertLoopApplicationArtifacts'?assertLoopApplicationArtifacts(owner,binding,owner,raw):assertIndexedLoopApplicationArtifacts(owner,binding,owner,index)};}
 if(entry==='assertIntentApplicationArtifacts'||entry==='assertIndexedIntentApplicationArtifacts'){const binding=createIntentApplicationBinding(intentArtifactCandidate()),owner={profileId:'profile',...intentHostSubjectOwner(binding.subject)},raw=sections(),keys=new Set(publishedArtifactLookupKeys(owner,selection,true)),index=createPublishedArtifactIndex(owner,raw,keys);return {fixtureFamily:'intent-index-content',invoke:()=>entry==='assertIntentApplicationArtifacts'?assertIntentApplicationArtifacts(owner,binding,owner,raw):assertIndexedIntentApplicationArtifacts(owner,binding,owner,index)};}
 const owner:VerificationOwner={profileId:'profile',ownerKind:'task',ownerId:'task'},raw=sections(),keys=new Set(publishedArtifactLookupKeys(owner,selection)),index=createPublishedArtifactIndex(owner,raw,keys),record=findIndexedPublishedArtifacts(index,owner,selection)[0]!;
 if(entry==='publishedArtifactPopulation')return {fixtureFamily:'index-population',invoke:()=>publishedArtifactPopulation(index)};
 if(entry==='assertPublishedArtifactIndexOwner')return {fixtureFamily:'index-owner',invoke:()=>assertPublishedArtifactIndexOwner(index,owner)};
 if(entry==='createPublishedArtifactIndex')return {fixtureFamily:'direct-index-local-content',invoke:()=>createPublishedArtifactIndex(owner,raw,keys)};
 if(entry==='findIndexedPublishedArtifacts')return {fixtureFamily:'index-selected-record',invoke:()=>findIndexedPublishedArtifacts(index,owner,selection)};
 if(entry==='readIndexedPublishedArtifact')return {fixtureFamily:'index-undecoded-content',invoke:()=>readIndexedPublishedArtifact(index,record)};
 if(entry==='verifyIndexedPublishedArtifact')return {fixtureFamily:'index-undecoded-content',invoke:()=>verifyIndexedPublishedArtifact(index,record)};
 throw new Error('no_public_fixture:'+entry);
}

export function loopVariant(variant:string):LoopApplicationCandidate {
 const b=loopCandidate();
 if(variant==='health')return {...b,subject:{...b.subject,loopId:'kswarm-service-health'},contract:{version:1,kind:'builtin-diagnostic',scanner:'kswarm-service-health',objective:'Original',completionCriterion:'Original'},body:{kind:'builtin-diagnostic',scanner:'kswarm-service-health',observedAt:1,summary:'Original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'kswarm-service-health',openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[],diagnosticKinds:['service_not_running'],findings:['Original'],suggestedActions:['Inspect'],logPaths:['logs/service.log']},artifacts:[]}};
 if(variant==='evening'||variant==='morning')return {...b,subject:{...b.subject,loopId:variant==='evening'?'personal-assistant-evening-reflection':'personal-assistant-morning-briefing'},contract:{version:1,kind:'assistant',assistantKind:variant,profileId:'default-personal-assistant',locale:'zh',timeZone:'Asia/Shanghai',dataScopes:['tasks','threads'],objective:'Original',completionCriterion:'Original'},body:variant==='evening'?{kind:'assistant-evening',summary:'Original',candidates:[{id:'one',runId:'run',kind:'follow_up',title:'First',content:'Original',scope:'global',projectId:null,confidence:0.75,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'one'},{id:'two',runId:'run',kind:'follow_up',title:'Second',content:'Original',scope:'global',projectId:null,confidence:0.5,evidenceRefs:[{kind:'task',id:'task'}],dedupeKey:'two'}],artifacts:[]}:{kind:'assistant-morning',recommendations:[{title:'Original',reasonCode:'open_task',evidenceRefs:[{kind:'task',id:'task'}]}],artifacts:[]}};
 if(variant==='template'||variant==='execute')return {...b,subject:{...b.subject,stage:variant==='execute'?{stageId:'execute',stageKind:'execute'}:null},contract:{version:1,kind:'user-template',templateKind:'task_completion',prompt:'Original',outputDirectory:'',outputFileName:'',loopContract:{schemaVersion:'loop_contract_v1',objective:'Original',triggerPolicy:{kind:'manual'},successCriteria:[{kind:'task_completed',strength:'weak'},{kind:'file_exists',pathTemplate:'out.txt',minBytes:1,expectedMime:'text/plain'},{kind:'command_exit_zero',commandId:'inspect',args:['--version'],cwdPolicy:'workspace'}],stopPolicy:{maxConsecutiveFailures:1},permissionPolicy:{mode:'read_only',autoRunApproved:false,allowedToolCategories:['read'],approvedTargetRefs:['project:fixture']},concurrencyPolicy:{perLoop:'skip_if_running',coalesceMissedRuns:false}}},body:variant==='execute'?{kind:'user-template-execute',taskId:'task',executeStageId:'execute',summary:'Original',evidenceIds:['evidence'],artifacts:[]}:{kind:'user-template',taskId:'task',executeStageId:'execute',verifyStageId:'verify',summary:'Original',evidenceIds:['evidence'],artifacts:[]}};
 return b;
}
export function intentVariant(variant:string):IntentApplicationCandidate {
 const c=intentArtifactCandidate();
 if(variant==='parent')return {...c,subject:{...c.subject,stageId:null},body:{kind:'intent-parent',summary:'Original',stages:[{subject:{...c.subject},candidateId:'stage-candidate',candidateRevision:1,bindingHash:'a'.repeat(64),immutablePayloadHash:'b'.repeat(64),operationId:'operation',fullTupleHash:'c'.repeat(64),committedBusinessRevision:1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1}],artifacts:c.body.artifacts}};
 if(variant==='blackbox'){const v={version:1 as const,obligations:[{obligationId:'o',predicateId:'谓词',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'blackbox' as const,cases:[{id:'case',inputBase64:'eA==',expectedOutputBase64:'eA==',sideEffects:[{path:'out.txt',sha256:contentHash}]}]}}]};return {...c,contract:{...c.contract,verification:structuredClone(v),stages:c.contract.stages.map(s=>({...s,verification:structuredClone(v)}))}};}
 if(variant==='producer'&&c.body.kind==='intent-stage')return {...c,body:{...c.body,producerReports:[{protectionMode:'ordinary',requestSource:'user',now:1,artifactId:'artifact',action:{kind:'artifact-report',stageId:'stage',kindOfArtifact:'report',storage:'inline',label:'Report',path:null,inlineValue:contentText,summary:null,reportedStructuralValidation:'passed',reportedSemanticValidation:'passed',origin:{kind:'model-report',providerInvocationId:'provider',toolInvocationId:'tool'}}},{protectionMode:'ordinary',requestSource:'user',now:1,artifactId:null,action:{kind:'step-report',stepId:'step',status:'completed',breadcrumb:'Original',receiptNote:null,blockedReason:null,origin:{kind:'model-report',providerInvocationId:'provider-2',toolInvocationId:'tool-2'}}}]}};
 return c;
}

import {GOAL_APPLICATION_EVIDENCE_KINDS} from '../../src/runtime/verification/goal-application-binding.js';
import {LOOP_DIAGNOSTIC_SCANNERS,LOOP_ASSISTANT_DATA_SCOPES} from '../../src/runtime/verification/loop-application-contract.js';
import {LOOP_EVIDENCE_ANOMALY_KINDS,LOOP_HEALTH_DIAGNOSTIC_KINDS} from '../../src/runtime/verification/loop-application-binding.js';
const fixtureCapturedApply=Reflect.apply,fixtureCapturedSlice=Array.prototype.slice,fixtureCapturedSplice=Array.prototype.splice;
export function prepareExportedArrayMutation(name:string):()=>{restore:()=>void} {
 const arrays:Record<string,readonly string[]>={GOAL_APPLICATION_EVIDENCE_KINDS,LOOP_DIAGNOSTIC_SCANNERS,LOOP_ASSISTANT_DATA_SCOPES,LOOP_EVIDENCE_ANOMALY_KINDS,LOOP_HEALTH_DIAGNOSTIC_KINDS};
 const target=arrays[name];if(!target)throw new Error('unknown_exported_array');
 const original=fixtureCapturedApply(fixtureCapturedSlice,target,[]) as string[];
 return ()=>{fixtureCapturedApply(fixtureCapturedSplice,target,[0,target.length,'caller-forged']);return {restore:()=>{fixtureCapturedApply(fixtureCapturedSplice,target,[0,target.length,...original]);}};};
}
