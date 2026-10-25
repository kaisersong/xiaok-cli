import type {LoopRunRow, AssistantCandidateRow, LoopStageRow, StoredLoopPublicationCandidate, LoopNativePhase, LoopNativeAttempt, LoopVerificationSession} from '../../src/runtime/loop/producer-types.js';
export type {LoopRunRow, AssistantCandidateRow, LoopStageRow, StoredLoopPublicationCandidate, LoopNativePhase, LoopNativeAttempt, LoopVerificationSession} from '../../src/runtime/loop/producer-types.js';
import {openLoopDatabase,type LoopDatabaseSource,type LoopDatabaseLease} from './loop-database-owner.js';
import {migrateLoopArtifactExportJournal,parseLoopArtifactExportPreparation,parseLoopArtifactExportUpdate,createLoopArtifactExportRecord,advanceLoopArtifactExport,readLoopArtifactExportRow,loopArtifactExportHash,assertLoopArtifactExportDurability,type LoopArtifactExportPreparation,type LoopArtifactExportUpdate,type LoopArtifactExportRecord,type LoopArtifactExportRow} from './loop-artifact-export-journal.js';
import type {LoopEvaluation} from './loop-evaluator.js';
import {migrateLoopNativeSchema} from './loop-native-schema.js';
import {consumeLoopNativeReauthorization} from './loop-native-workflow.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
import {parseAssistantPromotionIntent,type AssistantPromotionIntent} from './assistant-promotion-intent.js';
import {consumeLoopBusinessProjection,consumeAssistantPromotionWrite} from './loop-business-publication-host.js';
import {freezeProjection,loopProjectionHash,normalizeLoopProjectionRows,projectedLoopRows,validateLoopProjectionOrigin,type LoopProjectionRows,type LoopProjectionOrigin,type LoopBusinessProjection,type LoopBusinessProjectionTarget} from './loop-business-projection.js';
import {consumeLoopTaskIdentity,consumeLoopTaskTerminal,loopTaskIdentityVector} from './loop-task-identity.js';
import {consumeLoopPublicationWrite} from './loop-publication-workflow.js';
import {parseLoopPublicationAttempt,assertLoopPublicationTransition,publicationFields,publicationIdentity,loopPublicationTerminal,type LoopPublicationAttempt} from './loop-publication-attempt.js';
import {consumeLoopTemplateExecutionRecovery,readLoopTemplateRecoveryVector,assertLoopTemplateRecoveryFile} from './loop-template-execution-recovery.js';
import {assertOrdinaryLoopOwner} from './loop-run-context.js';
import {captureExecutionValue,executionFields,executionIdentity,parseLoopVerificationCommand,parseLoopVerificationExecution,type LoopVerificationExecution} from './loop-verification-execution.js';
import type {ValidationMaterialDraft,ValidationMaterialRequestStep} from '../../src/runtime/verification/product-material-authorization.js';
import {parseMaterialRequestObservation,type MaterialRequestObservation} from '../../src/runtime/verification/material-request.js';
import {parseVerificationOperationRequestObservation,type VerificationOperationRequestObservation} from '../../src/runtime/verification/verification-operation-request.js';
import type {VerificationObligationObservation} from '../../src/runtime/verification/verification-obligation-observation.js';
export type {LoopVerificationExecution} from './loop-verification-execution.js';
import {createLoopApplicationBinding,parseLoopApplicationBinding,loopApplicationBindingHash,parseLoopCandidateBody,type LoopApplicationBinding,type LoopArtifactDescriptor} from '../../src/runtime/verification/loop-application-binding.js';
import {validateEveningReflection,validateMorningBriefing,type EveningReflectionOutput,type MorningBriefingOutput} from './assistant-llm.js';
import type {ArtifactEvidenceRegressionScanResult} from './artifact-evidence-regression-loop.js';
import type {KSwarmServiceHealthScanResult} from './kswarm-health-loop.js';
import type {TaskSnapshot} from '../../src/runtime/task-host/types.js';
import {parseGoalVerificationDefinition,type GoalVerificationDefinition} from '../../src/runtime/goal/verification-definition.js';
import {canonicalVerificationJson as publicationJson} from '../../src/runtime/verification/protocol.js';
import {parseLoopBusinessContract,type LoopBusinessContract} from '../../src/runtime/verification/loop-application-contract.js';
import {parseLoopPublicationConfiguration,freezeLoopPublicationValue,type StoredLoopPublicationConfiguration} from './loop-publication-config.js';
import {buildLoopScanPublicationBody,captureLoopProducerValue} from './loop-scan-publication-body.js';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDefaultLoopContract, parseLoopContractV1 } from './loop-contract.js';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';
import {
  BUILT_IN_LOOP_IDS,
  type BeginLoopRunResult,
  type CreateUserLoopTemplateInput,
  type CreateUserLoopTemplateResult,
  type DeactivationReason,
  type IgnoredLegacyScheduleField,
  type LearnedConstraint,
  type LearnedConstraintSource,
  type LoopDefinition,
  type LoopDefinitionOrigin,
  type LoopDefinitionStatus,
  type LoopRun,
  type LoopRunFailureKind,
  type LoopRunStatus,
  type LoopStage,
  type LoopStageKind,
  type LoopStageStatus,
  type LoopRunTrigger,
  type RecoverStaleRunsResult,
  type UserLoopTemplate,
  type UserLoopTemplateKind,
} from './loop-types.js';
import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
  type AssistantCandidate,
  type AssistantCandidateStatus,
  type AssistantProfile,
  type CreateAssistantCandidateInput,
} from './assistant-types.js';

interface LoopDefinitionRow {
  id: string;
  title: string;
  description: string;
  status: LoopDefinitionStatus;
  origin: LoopDefinitionOrigin;
  active_run_id: string | null;
  deleted_at: number | null;
  delete_reason: string | null;
  created_at: number;
  updated_at: number;
}

interface UserLoopTemplateRow {
  loop_id: string;
  kind: UserLoopTemplateKind;
  prompt: string;
  output_directory: string;
  output_file_name: string;
  schedule_action_id: string | null;
  schedule_enabled: number;
  schedule_trigger_json: string | null;
  auto_run_approved: number;
  contract_json: string | null;
  contract_schema_version: string | null;
  created_at: number;
  updated_at: number;
}

interface TableColumnRow {
  name: string;
}

interface AutomationStoreMetadataRow {
  value: number;
}


interface AssistantProfileRow {
  id: AssistantProfile['id']; status: AssistantProfile['status']; locale: AssistantProfile['locale']; time_zone: string;
  evening_time: string; morning_time: string; workdays_json: string; quiet_hours_json: string; data_scopes_json: string;
  created_at: number; updated_at: number;
}



interface LearnedConstraintRow {
  id: string;
  loop_id: string;
  source: LearnedConstraintSource;
  rule: string;
  source_run_id: string;
  failure_kind: string | null;
  failure_reason: string | null;
  active: number;
  hit_count: number;
  consecutive_ineffective_count: number;
  created_at: number;
  updated_at: number;
  last_hit_at: number | null;
  superseded_by: string | null;
  deactivation_reason: DeactivationReason | null;
  extraction_context: string | null;
}

export interface AddConstraintInput {
  loopId: string;
  source: LearnedConstraintSource;
  rule: string;
  sourceRunId: string;
  failureKind?: string;
  failureReason?: string;
  extractionContext?: string;
  now: number;
}

const BUILT_IN_LOOPS: Array<Pick<LoopDefinition, 'id' | 'title' | 'description' | 'status'>> = [
  {
    id: BUILT_IN_LOOP_IDS.ARTIFACT_EVIDENCE_REGRESSION,
    title: 'Artifact Evidence Regression',
    description: 'Checks artifact completion evidence flows for regressions.',
    status: 'active',
  },
  {
    id: BUILT_IN_LOOP_IDS.KSWARM_SERVICE_HEALTH,
    title: 'KSwarm Service Health',
    description: 'Checks KSwarm service startup, health, identity, and broker connectivity.',
    status: 'active',
  },
  {
    id: ASSISTANT_EVENING_LOOP_ID,
    title: 'Personal assistant evening reflection',
    description: 'Generates review candidates from structured Xiaok activity.',
    status: 'paused',
  },
  {
    id: ASSISTANT_MORNING_LOOP_ID,
    title: 'Personal assistant morning briefing',
    description: 'Generates a bounded morning briefing from structured state.',
    status: 'paused',
  },
];

const EXECUTOR_CRASH_MESSAGE = 'Loop executor crashed or was interrupted.';
const TERMINAL_STATUSES = new Set<LoopRunStatus>(['success', 'failed', 'blocked']);
const TERMINAL_STAGE_STATUSES = new Set<LoopStageStatus>(['success', 'failed', 'blocked', 'skipped']);
const LOOP_STAGE_KINDS = new Set<LoopStageKind>(['scan', 'execute', 'verify']);

export interface LoopRunPublicationBasis {
 version:1;runId:string;loopId:string;requestSource:'user'|'agent'|'scheduler';originalTriggerJson:string;logicalRunKey:string|null;
 configuration:Readonly<StoredLoopPublicationConfiguration>;contract:Readonly<LoopBusinessContract>;
 sourceRows:{run:LoopRunRow;definition:LoopDefinitionRow;template:UserLoopTemplateRow|null;assistantProfile:AssistantProfileRow|null};
}
const publicationHash=(value:string)=>createHash('sha256').update('xiaok-loop-run-publication-basis-v1\0').update(value).digest('hex');
export interface LoopPublicationProducer {
 recordTemplateNonSuccess(input:{executeStageId:string;verifyStageId:string;evaluation:Exclude<LoopEvaluation,{status:'success'}>;requestSource:'user'|'agent'|'scheduler';now:number}):void;
 recordScan(stageId:string,result:ArtifactEvidenceRegressionScanResult|KSwarmServiceHealthScanResult,now:number,artifacts?:readonly LoopArtifactDescriptor[]):void;
 recordAssistantOutput(output:EveningReflectionOutput|MorningBriefingOutput,now:number,artifacts?:readonly LoopArtifactDescriptor[]):void;
 recordTemplateExecution(input:{executeStageId:string;taskSnapshot:TaskSnapshot;summary:string;evidenceIds:string[];artifacts:readonly LoopArtifactDescriptor[];now:number}):void;
 recordTemplateTerminal(input:{executeStageId:string;verifyStageId:string;summary:string;evidenceIds:string[];artifacts:readonly LoopArtifactDescriptor[];now:number}):void;
}
interface LoopProducerResultRow {run_id:string;revision:number;body_json:string;body_hash:string;stage_id:string|null;evidence_ids_json:string;terminal_at:number}
interface LoopStageExecutionResultRow extends LoopProducerResultRow {stage_id:string;task_snapshot_json:string;task_snapshot_hash:string}
export interface LoopRunLifecycle {
 runId:string;executionPhase:'executing'|'awaiting_verification'|'execution_terminal';businessState:LoopRunStatus|'publication_pending';
 terminalResultPresent:boolean;executionStageIds:readonly string[];candidateIds:readonly string[];
}
const LOOP_NATIVE_PHASE_EDGES:Record<LoopNativePhase,readonly LoopNativePhase[]>={
 reserved:['enrolling','retired','stale'],enrolling:['enrolled','retired','stale'],enrolled:['binding','retired','stale'],
 binding:['ready','retired','needs_reauthorization','stale'],ready:[],retired:[],needs_reauthorization:[],stale:[],
};
const nativeDefinitionHash=(value:Readonly<GoalVerificationDefinition>)=>createHash('sha256').update('xiaok-loop-native-definition-v1\0').update(publicationJson(value)).digest('hex');
export class LoopStore {
  private readonly connection:LoopDatabaseLease;
  private get db():DatabaseSync{return this.connection.database;}
  private readonly publicationBegins=new WeakMap<object,{runId:string;runJson:string}>();
  private readonly publicationProducers=new WeakMap<object,{runId:string;basisJson:string}>();
  private readonly exportCursors=new WeakMap<object,{after:number;through:number}>();

  constructor(dbPath: string|LoopDatabaseSource) {
    this.connection=openLoopDatabase(dbPath);
    try { this.applySchema(); migrateLoopNativeSchema(this.db); migrateLoopArtifactExportJournal(this.db); this.connection.recordComponent('loop'); } catch(error) { this.connection.close(); throw error; }
  }

  close(): void {
    this.connection.close();
  }

  /** Main-only audit primitive. Production export remains gated by the fixed
   * publication, native ownership and shared-capacity composition. */
  prepareLoopArtifactExport(raw:LoopArtifactExportPreparation):Readonly<{disposition:'inserted'|'existing';record:Readonly<LoopArtifactExportRecord>}> {
    const p=parseLoopArtifactExportPreparation(raw);
    return this.transaction(()=>{
      assertLoopArtifactExportDurability(this.db);const old=this.getLoopArtifactExport(p.id);
      if(old){
        if(publicationJson(p)!==publicationJson({id:old.id,requestSource:old.requestSource,source:old.source,destination:old.destination,now:old.createdAt}))throw Error('loop_export_journal_conflict');
        return Object.freeze({disposition:'existing' as const,record:old});
      }
      const inserted=this.db.prepare('INSERT INTO loop_artifact_exports(id,revision,parent_device,parent_inode,temporary_name,record_json,record_hash) VALUES(?,1,?,?,?,\'{}\',\'\')')
        .run(p.id,p.destination.parentIdentity.device,p.destination.parentIdentity.inode,p.destination.temporaryName);
      const record=createLoopArtifactExportRecord(p,Number(inserted.lastInsertRowid)),encoded=publicationJson(record);
      this.db.prepare('UPDATE loop_artifact_exports SET record_json=?,record_hash=? WHERE id=?').run(encoded,loopArtifactExportHash(encoded),p.id);
      return Object.freeze({disposition:'inserted' as const,record:this.getLoopArtifactExport(p.id)!});
    });
  }

  getLoopArtifactExport(id:string):Readonly<LoopArtifactExportRecord>|undefined {
    executionIdentity(id);const row=this.db.prepare('SELECT * FROM loop_artifact_exports WHERE id=?').get(id) as LoopArtifactExportRow|undefined;
    if(!row)return undefined;const record=readLoopArtifactExportRow(row);if(record.id!==id)throw Error('loop_export_journal_corrupt');return record;
  }

  recordLoopArtifactExport(raw:LoopArtifactExportUpdate):Readonly<LoopArtifactExportRecord> {
    const update=parseLoopArtifactExportUpdate(raw);
    return this.transaction(()=>{
      assertLoopArtifactExportDurability(this.db);const old=this.getLoopArtifactExport(update.id);if(!old)throw Error('loop_export_journal_missing');
      const next=advanceLoopArtifactExport(old,update);if(next===old)return old;
      const encoded=publicationJson(next),write=this.db.prepare('UPDATE loop_artifact_exports SET revision=?,record_json=?,record_hash=? WHERE id=? AND revision=?')
        .run(next.revision,encoded,loopArtifactExportHash(encoded),next.id,old.revision);
      if(write.changes!==1)throw Error('loop_export_journal_conflict');return this.getLoopArtifactExport(next.id)!;
    });
  }

  listLoopArtifactExports(cursor?:object):Readonly<{items:readonly Readonly<LoopArtifactExportRecord>[];next:object|null}> {
    const issued=cursor===undefined?undefined:cursor&&typeof cursor==='object'?this.exportCursors.get(cursor):undefined;
    if(cursor!==undefined&&!issued)throw Error('loop_export_journal_cursor');
    return this.transaction(()=>{
      if(this.db.prepare("SELECT 1 FROM loop_artifact_exports WHERE typeof(sequence)!='integer' OR sequence<1 OR sequence>9007199254740991 LIMIT 1").get())throw Error('loop_export_journal_corrupt');
      const through=issued?.through??Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0) n FROM loop_artifact_exports').get()?.n),after=issued?.after??0;
      if(!Number.isSafeInteger(through)||through<after)throw Error('loop_export_journal_corrupt');
      const rows=this.db.prepare('SELECT * FROM loop_artifact_exports WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT 101').all(after,through) as unknown as LoopArtifactExportRow[];
      const checked=rows.map(readLoopArtifactExportRow),items=Object.freeze(checked.slice(0,100));let next:object|null=null;
      if(checked.length>100){next=Object.freeze({});this.exportCursors.set(next,{after:items[99].sequence,through});}
      return Object.freeze({items,next});
    });
  }

  reserveLoopPublicationAttempt(raw:{nativeAttemptId:string;expectedLatestAttemptId:string|null;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopPublicationAttempt> {
    const input=captureLoopProducerValue(raw);publicationFields(input,['nativeAttemptId','expectedLatestAttemptId','requestSource','now']);
    if(input.requestSource!=='user')throw Error('loop_publication_attempt_source');publicationIdentity(input.nativeAttemptId);if(input.expectedLatestAttemptId!==null)publicationIdentity(input.expectedLatestAttemptId);
    return this.transaction(()=>{
      const target=this.getLoopNativeAttemptTarget(input.nativeAttemptId);if(target.attempt.phase!=='ready')throw Error('loop_publication_attempt_native');this.assertLoopNativeAttemptCurrentInTransaction(input.nativeAttemptId);
      const records=this.listLoopPublicationAttempts(target.attempt.candidateId),previous=records.at(-1);
      if((previous?.attemptId??null)!==input.expectedLatestAttemptId||previous&&(!loopPublicationTerminal(previous)||previous.status==='committed'&&previous.nativeAttemptId===target.attempt.attemptId))throw Error('loop_publication_attempt_conflict');
      if(previous&&previous.nativeAttemptId!==target.attempt.attemptId){
        const old=this.getLoopNativeAttemptTarget(previous.nativeAttemptId).attempt,latest=this.listLoopNativeAttempts(target.attempt.candidateId).at(-1);
        if(previous.status!=='committed'||target.attempt.ordinal<=old.ordinal||latest?.attemptId!==target.attempt.attemptId)throw Error('loop_publication_attempt_target');
      }
      if(records.length>=32)throw Error('loop_publication_attempt_capacity');
      if(!Number.isSafeInteger(input.now)||input.now<Math.max(target.attempt.updatedAt,previous?.updatedAt??0))throw Error('loop_publication_attempt_time');
      const next=parseLoopPublicationAttempt({attemptId:randomUUID(),nativeAttemptId:target.attempt.attemptId,candidateId:target.attempt.candidateId,bindingHash:target.attempt.bindingHash,sourceVectorHash:target.attempt.sourceVectorHash,requestSource:'user',routeJson:null,sequence:records.length+1,revision:1,status:'preparing',challenge:null,observation:null,retirement:null,createdAt:input.now,updatedAt:input.now},target);
      const written=this.db.prepare('INSERT INTO loop_publication_attempts(attempt_id,native_attempt_id,candidate_id,sequence,revision,record_json) VALUES(?,?,?,?,?,?)').run(next.attemptId,next.nativeAttemptId,next.candidateId,next.sequence,next.revision,publicationJson(next));
      this.bumpAutomationStoreVersion();this.assertLoopNativeAttemptCurrentInTransaction(next.nativeAttemptId);if(publicationJson(this.getLoopNativeAttemptTarget(next.nativeAttemptId))!==publicationJson(target))throw Error('loop_publication_attempt_target_changed');const actual=this.getLoopPublicationAttempt(next.attemptId);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(next))throw Error('loop_publication_attempt_conflict');return actual;
    });
  }

  getLoopPublicationAttempt(attemptId:string):Readonly<LoopPublicationAttempt>|undefined {
    publicationIdentity(attemptId);const row=this.db.prepare('SELECT * FROM loop_publication_attempts WHERE attempt_id=?').get(attemptId);if(!row)return undefined;
    const target=this.getLoopNativeAttemptTarget(String(row.native_attempt_id)),actual=parseLoopPublicationAttempt(JSON.parse(String(row.record_json)),target);
    if(actual.attemptId!==row.attempt_id||actual.nativeAttemptId!==row.native_attempt_id||actual.candidateId!==row.candidate_id||actual.sequence!==row.sequence||actual.revision!==row.revision||publicationJson(actual)!==row.record_json)throw Error('loop_publication_attempt_corrupt');return actual;
  }

  listLoopPublicationAttempts(candidateId:string):Readonly<LoopPublicationAttempt>[] {
    publicationIdentity(candidateId);const rows=this.db.prepare('SELECT attempt_id FROM loop_publication_attempts WHERE candidate_id=? ORDER BY sequence').all(candidateId) as {attempt_id:string}[];
    const records=rows.map(row=>this.getLoopPublicationAttempt(row.attempt_id)!);if(records.length>32||records.some((row,i)=>row.sequence!==i+1))throw Error('loop_publication_attempt_corrupt');return records;
  }

  advanceLoopPublicationAttempt(raw:{attemptId:string;expectedRevision:number;requestSource:'user'|'agent'|'scheduler';ticket:object}):Readonly<LoopPublicationAttempt> {
    const write=consumeLoopPublicationWrite(this,raw);
    return this.transaction(()=>{
      const before=this.getLoopPublicationAttempt(write.before.attemptId);if(!before||publicationJson(before)!==publicationJson(write.before))throw Error('loop_publication_attempt_conflict');
      const target=this.getLoopNativeAttemptTarget(before.nativeAttemptId),next=parseLoopPublicationAttempt(write.next,target);assertLoopPublicationTransition(before,next);
      if(next.status==='authorizing'){if(write.source!=='user')throw Error('loop_publication_attempt_source');this.assertLoopNativeAttemptCurrentInTransaction(before.nativeAttemptId);}
      const written=this.db.prepare('UPDATE loop_publication_attempts SET revision=?,record_json=? WHERE attempt_id=? AND revision=?').run(next.revision,publicationJson(next),before.attemptId,before.revision);
      this.bumpAutomationStoreVersion();if(publicationJson(this.getLoopNativeAttemptTarget(before.nativeAttemptId))!==publicationJson(target))throw Error('loop_publication_attempt_target_changed');if(next.status==='authorizing')this.assertLoopNativeAttemptCurrentInTransaction(before.nativeAttemptId);const actual=this.getLoopPublicationAttempt(before.attemptId);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(next))throw Error('loop_publication_attempt_conflict');return actual;
    });
  }

  reserveLoopVerificationExecution(raw:{sessionRecordId:string;exactCommand:ValidationMaterialDraft['exactCommand'];expiresAt:number;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['sessionRecordId','exactCommand','expiresAt','requestSource','now']);
    if(input.requestSource!=='user')throw Error('loop_verification_execution_source');executionIdentity(input.sessionRecordId);
    const command=parseLoopVerificationCommand(input.exactCommand);
    return this.transaction(()=>{
      const session=this.getLoopVerificationSession(input.sessionRecordId);if(!session||session.phase!=='enrolled')throw Error('loop_verification_execution_session');
      this.assertLoopNativeAttemptCurrentInTransaction(session.nativeAttemptId);
      const previous=this.listLoopVerificationExecutions(session.id)[0];
      if(previous){if(publicationJson(previous.exactCommand)!==publicationJson(command)||previous.expiresAt!==input.expiresAt)throw Error('loop_verification_execution_conflict');return previous;}
      const expected:LoopVerificationExecution={id:randomUUID(),sessionRecordId:session.id,nativeAttemptId:session.nativeAttemptId,candidateId:session.candidateId,obligationId:session.obligationId,
        invocation:{sessionIdentity:session.sessionId,compoundOperationId:session.operationId,validationInvocationId:session.validationInvocationId},exactCommand:command,expiresAt:input.expiresAt,
        materialRequestId:randomUUID(),verificationRequestId:randomUUID(),phase:'selecting',revision:1,createdAt:input.now,updatedAt:input.now,
        draft:null,challengeId:null,obligationObservation:null,operationId:null,attemptId:null,materialObservation:null,verificationObservation:null};
      parseLoopVerificationExecution(expected,session,this.getLoopNativeAttemptTarget(session.nativeAttemptId));
      const written=this.db.prepare('INSERT INTO loop_verification_executions(id,session_record_id,revision,record_json) VALUES(?,?,?,?)').run(expected.id,session.id,1,publicationJson(expected));
      this.bumpAutomationStoreVersion();
      const actual=this.getLoopVerificationExecution(expected.id);if(written.changes!==1||publicationJson(actual)!==publicationJson(expected))throw Error('loop_verification_execution_commit');
      return actual!;
    });
  }

  getLoopVerificationExecution(id:string):Readonly<LoopVerificationExecution>|undefined {
    executionIdentity(id);const row=this.db.prepare('SELECT * FROM loop_verification_executions WHERE id=?').get(id);
    if(!row)return undefined;
    const session=this.getLoopVerificationSession(String(row.session_record_id));if(!session)throw Error('loop_verification_execution_session');
    const parsed=parseLoopVerificationExecution(JSON.parse(String(row.record_json)),session,this.getLoopNativeAttemptTarget(session.nativeAttemptId));
    if(parsed.id!==row.id||parsed.sessionRecordId!==row.session_record_id||parsed.revision!==row.revision)throw Error('loop_verification_execution_corrupt');
    return parsed;
  }

  listLoopVerificationExecutions(sessionRecordId:string):Readonly<LoopVerificationExecution>[] {
    executionIdentity(sessionRecordId);
    return (this.db.prepare('SELECT id FROM loop_verification_executions WHERE session_record_id=? ORDER BY id').all(sessionRecordId) as {id:string}[]).map(row=>this.getLoopVerificationExecution(row.id)!);
  }

  private changeLoopVerificationExecution(input:{id:string;expectedRevision:number;requestSource:string;now:number},fresh:boolean,change:(row:Readonly<LoopVerificationExecution>)=>LoopVerificationExecution):Readonly<LoopVerificationExecution> {
    if(!['user','scheduler'].includes(input.requestSource)||fresh&&input.requestSource!=='user')throw Error('loop_verification_execution_source');
    return this.transaction(()=>{
      const row=this.getLoopVerificationExecution(input.id);if(!row)throw Error('loop_verification_execution_missing');
      if(row.revision!==input.expectedRevision)throw Error('loop_verification_execution_conflict');
      if(!Number.isSafeInteger(input.now)||input.now<row.updatedAt)throw Error('loop_verification_execution_time');
      if(fresh){this.assertLoopNativeAttemptCurrentInTransaction(row.nativeAttemptId);if(input.now>=row.expiresAt)throw Error('loop_verification_execution_expired');}
      const changed=change(row),expected={...changed,revision:row.revision+1,updatedAt:input.now};
      const session=this.getLoopVerificationSession(row.sessionRecordId)!;
      parseLoopVerificationExecution(expected,session,this.getLoopNativeAttemptTarget(row.nativeAttemptId));
      const written=this.db.prepare('UPDATE loop_verification_executions SET revision=?,record_json=? WHERE id=? AND revision=?').run(expected.revision,publicationJson(expected),row.id,row.revision);
      this.bumpAutomationStoreVersion();
      const actual=this.getLoopVerificationExecution(row.id);if(written.changes!==1||publicationJson(actual)!==publicationJson(expected))throw Error('loop_verification_execution_commit');
      return actual!;
    });
  }

  recordLoopVerificationMaterialStep(raw:{id:string;expectedRevision:number;step:Readonly<ValidationMaterialRequestStep>;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['id','expectedRevision','step','requestSource','now']);
    executionFields(input.step,['requestId','phase','draft',...(Object.hasOwn(input.step,'challengeId')?['challengeId']:[])]);
    return this.changeLoopVerificationExecution(input,true,row=>{
      const step=input.step;if(step.requestId!==row.materialRequestId)throw Error('loop_verification_execution_material');
      const phase=step.phase==='prepare'?'preparing_material':step.phase==='authorize'?'authorizing_material':step.phase==='stage'?'staging_material':null;
      const prior=step.phase==='prepare'?'selecting':step.phase==='authorize'?'preparing_material':'authorizing_material';
      if(!phase||row.phase!==prior)throw Error('loop_verification_execution_phase');
      if(step.phase==='prepare'){if(step.challengeId!==undefined||row.draft!==null)throw Error('loop_verification_execution_material');}
      else {executionIdentity(step.challengeId);if(row.challengeId!==null&&step.challengeId!==row.challengeId||publicationJson(step.draft)!==publicationJson(row.draft))throw Error('loop_verification_execution_material');}
      return {...row,phase,draft:step.draft as ValidationMaterialDraft,challengeId:step.challengeId??null};
    });
  }

  beginLoopVerificationPrepare(raw:{id:string;expectedRevision:number;observation:Readonly<VerificationObligationObservation>;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['id','expectedRevision','observation','requestSource','now']);
    return this.changeLoopVerificationExecution(input,true,row=>{if(row.phase!=='staging_material'||row.obligationObservation!==null)throw Error('loop_verification_execution_phase');return {...row,phase:'preparing_verification',obligationObservation:input.observation};});
  }

  beginLoopVerificationDispatch(raw:{id:string;expectedRevision:number;operationId:string;attemptId:string;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['id','expectedRevision','operationId','attemptId','requestSource','now']);executionIdentity(input.operationId);executionIdentity(input.attemptId);
    return this.changeLoopVerificationExecution(input,true,row=>{if(row.phase!=='preparing_verification'||row.operationId!==null)throw Error('loop_verification_execution_phase');return {...row,phase:'dispatching',operationId:input.operationId,attemptId:input.attemptId};});
  }

  observeLoopVerificationExecution(raw:{id:string;expectedRevision:number;materialObservation?:Readonly<MaterialRequestObservation>;verificationObservation?:Readonly<VerificationOperationRequestObservation>;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['id','expectedRevision','requestSource','now',...(Object.hasOwn(input,'materialObservation')?['materialObservation']:[]),...(Object.hasOwn(input,'verificationObservation')?['verificationObservation']:[])]);
    return this.changeLoopVerificationExecution(input,false,row=>{
      if(['terminal','retired'].includes(row.phase))throw Error('loop_verification_execution_terminal');
      const material=input.materialObservation===undefined?row.materialObservation:parseMaterialRequestObservation(input.materialObservation);
      const observed=input.verificationObservation===undefined?row.verificationObservation:parseVerificationOperationRequestObservation(input.verificationObservation);
      let operationId=row.operationId,attemptId=row.attemptId;
      if(observed?.state==='operation'){
        if(operationId!==null&&(operationId!==observed.operation.id||attemptId!==observed.operation.attemptId))throw Error('loop_verification_execution_operation');
        operationId=observed.operation.id;attemptId=observed.operation.attemptId;
      }
      let phase:LoopVerificationExecution['phase']='observing';
      if(observed?.state==='operation'&&observed.operation.state==='terminal'&&observed.operation.terminalResult)phase='terminal';
      else if(observed?.state==='not_prepared'||observed?.state==='retired'||observed?.state==='operation'&&observed.operation.state==='cancelled')phase='retired';
      return {...row,phase,operationId,attemptId,materialObservation:material,verificationObservation:observed};
    });
  }

  cancelLoopVerificationSelection(raw:{id:string;expectedRevision:number;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationExecution> {
    const input=captureExecutionValue(raw);executionFields(input,['id','expectedRevision','requestSource','now']);
    if(input.requestSource!=='user')throw Error('loop_verification_execution_source');
    return this.changeLoopVerificationExecution(input,false,row=>{if(row.phase!=='selecting'||row.draft!==null)throw Error('loop_verification_execution_phase');return {...row,phase:'retired'};});
  }

  /** Session identifiers here are reservations only. The fixed Main session
   * host must verify the actual canonical file before using any invocation. */
  reserveLoopVerificationSession(raw:{nativeAttemptId:string;obligationId:string;sessionId:string;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationSession> {
    const input=captureLoopProducerValue(raw);
    if(!input||Object.keys(input).sort().join(',')!=='nativeAttemptId,now,obligationId,requestSource,sessionId')throw Error('loop_verification_session_input');
    if(input.requestSource!=='user')throw Error('loop_verification_session_source');
    if(typeof input.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(input.sessionId)||typeof input.nativeAttemptId!=='string'||typeof input.obligationId!=='string')throw Error('loop_verification_session_input');
    return this.transaction(()=>{
      const target=this.getLoopNativeAttemptTarget(input.nativeAttemptId);
      if(target.attempt.phase!=='ready')throw Error('loop_verification_native_not_ready');
      this.assertLoopNativeAttemptCurrentInTransaction(input.nativeAttemptId);
      if(!target.definition.obligations.some(item=>item.obligationId===input.obligationId))throw Error('loop_verification_obligation');
      const previous=this.listLoopVerificationSessions(input.nativeAttemptId).find(item=>item.obligationId===input.obligationId);
      if(!Number.isSafeInteger(input.now)||input.now<Math.max(target.attempt.updatedAt,previous?.updatedAt??0))throw Error('loop_verification_session_time');
      if(previous)return previous;
      const expected:LoopVerificationSession={id:randomUUID(),nativeAttemptId:input.nativeAttemptId,candidateId:target.attempt.candidateId,obligationId:input.obligationId,sessionId:input.sessionId,
        operationId:randomUUID(),validationInvocationId:randomUUID(),enrollmentRequestId:randomUUID(),phase:'reserved',revision:1,createdAt:input.now,updatedAt:input.now};
      const written=this.db.prepare(`INSERT INTO loop_verification_sessions(id,native_attempt_id,candidate_id,obligation_id,session_id,operation_id,validation_invocation_id,enrollment_request_id,phase,revision,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'reserved',1,?,?)`).run(expected.id,expected.nativeAttemptId,expected.candidateId,expected.obligationId,expected.sessionId,expected.operationId,expected.validationInvocationId,expected.enrollmentRequestId,expected.createdAt,expected.updatedAt);
      const actual=this.getLoopVerificationSession(expected.id);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(expected))throw Error('loop_verification_session_conflict');
      this.bumpAutomationStoreVersion();return actual;
    });
  }

  getLoopVerificationSession(id:string):Readonly<LoopVerificationSession>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_verification_sessions WHERE id=?').get(id);if(!row)return undefined;
    const value={id:row.id,nativeAttemptId:row.native_attempt_id,candidateId:row.candidate_id,obligationId:row.obligation_id,sessionId:row.session_id,operationId:row.operation_id,validationInvocationId:row.validation_invocation_id,enrollmentRequestId:row.enrollment_request_id,phase:row.phase,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
    for(const key of ['id','nativeAttemptId','candidateId','obligationId','sessionId','operationId','validationInvocationId','enrollmentRequestId'] as const){const v=value[key];if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('loop_verification_session_corrupt');}
    const phaseRevision:Record<string,number>={reserved:1,session_ready:2,enrolling:3,enrolled:4,retired:4,stale:4};
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(String(value.sessionId))||!Object.hasOwn(phaseRevision,String(value.phase))||value.revision!==phaseRevision[String(value.phase)]
      ||typeof value.createdAt!=='number'||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||typeof value.updatedAt!=='number'||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<value.createdAt
      ||new Set([value.id,value.sessionId,value.operationId,value.validationInvocationId,value.enrollmentRequestId]).size!==5)throw Error('loop_verification_session_corrupt');
    const target=this.getLoopNativeAttemptTarget(String(value.nativeAttemptId));
    if(target.attempt.phase!=='ready'||target.attempt.candidateId!==value.candidateId||!target.definition.obligations.some(item=>item.obligationId===value.obligationId))throw Error('loop_verification_session_target_changed');
    return freezeLoopPublicationValue(value as unknown as LoopVerificationSession);
  }

  listLoopVerificationSessions(nativeAttemptId:string):Readonly<LoopVerificationSession>[] {
    return (this.db.prepare('SELECT id FROM loop_verification_sessions WHERE native_attempt_id=? ORDER BY created_at,id').all(nativeAttemptId) as {id:string}[]).map(row=>this.getLoopVerificationSession(row.id)!);
  }

  acknowledgeLoopVerificationSession(raw:{id:string;expectedRevision:number;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationSession> {
    const input=captureLoopProducerValue(raw);
    if(!input||Object.keys(input).sort().join(',')!=='expectedRevision,id,now,requestSource'||typeof input.id!=='string')throw Error('loop_verification_session_input');
    if(!['user','scheduler'].includes(input.requestSource))throw Error('loop_verification_session_source');
    return this.transaction(()=>{
      const row=this.getLoopVerificationSession(input.id);if(!row)throw Error('loop_verification_session_missing');
      if(row.revision!==input.expectedRevision||row.phase!=='reserved')throw Error('loop_verification_session_conflict');
      if(!Number.isSafeInteger(input.now)||input.now<row.updatedAt)throw Error('loop_verification_session_time');
      const expected:LoopVerificationSession={...row,phase:'session_ready',revision:2,updatedAt:input.now};
      const written=this.db.prepare("UPDATE loop_verification_sessions SET phase='session_ready',revision=2,updated_at=? WHERE id=? AND revision=1 AND phase='reserved'").run(input.now,row.id);
      const actual=this.getLoopVerificationSession(row.id);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(expected))throw Error('loop_verification_session_conflict');
      this.bumpAutomationStoreVersion();return actual;
    });
  }

  advanceLoopVerificationEnrollment(raw:{id:string;expectedRevision:number;phase:'enrolling'|'enrolled'|'retired'|'stale';requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopVerificationSession> {
    const input=captureLoopProducerValue(raw);
    if(!input||Object.keys(input).sort().join(',')!=='expectedRevision,id,now,phase,requestSource'||typeof input.id!=='string'||!['enrolling','enrolled','retired','stale'].includes(input.phase))throw Error('loop_verification_session_input');
    if(!['user','scheduler'].includes(input.requestSource)||input.phase==='enrolling'&&input.requestSource!=='user')throw Error('loop_verification_session_source');
    return this.transaction(()=>{
      const row=this.getLoopVerificationSession(input.id);if(!row)throw Error('loop_verification_session_missing');
      if(row.revision!==input.expectedRevision||(input.phase==='enrolling'?row.phase!=='session_ready':row.phase!=='enrolling'))throw Error('loop_verification_session_conflict');
      if(!Number.isSafeInteger(input.now)||input.now<row.updatedAt)throw Error('loop_verification_session_time');
      if(input.phase==='enrolling')this.assertLoopNativeAttemptCurrentInTransaction(row.nativeAttemptId);
      const expected:LoopVerificationSession={...row,phase:input.phase,revision:row.revision+1,updatedAt:input.now};
      const written=this.db.prepare('UPDATE loop_verification_sessions SET phase=?,revision=?,updated_at=? WHERE id=? AND revision=?').run(expected.phase,expected.revision,expected.updatedAt,row.id,row.revision);
      const actual=this.getLoopVerificationSession(row.id);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(expected))throw Error('loop_verification_session_conflict');
      this.bumpAutomationStoreVersion();return actual;
    });
  }

  /** Native request journals are historical facts, never approval or publication
   * capabilities. All request identities and definitions come from this store. */
  reserveLoopNativeAttempt(raw:{candidateId:string;expectedLatestAttemptId:string|null;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopNativeAttempt> {
    const input=JSON.parse(publicationJson(raw));
    if(Object.keys(input).sort().join(',')!=='candidateId,expectedLatestAttemptId,now,requestSource'||input.requestSource!=='user')throw Error('loop_native_attempt_source');
    if(typeof input.candidateId!=='string'||!input.candidateId||input.expectedLatestAttemptId!==null&&(typeof input.expectedLatestAttemptId!=='string'||!input.expectedLatestAttemptId))throw Error('loop_native_attempt_input');
    return this.transaction(()=>{
      const target=this.loopNativeCandidateTarget(input.candidateId);
      this.assertLoopNativeCandidateCurrent(target.candidate);
      const records=this.listLoopNativeAttempts(input.candidateId),latest=records.at(-1);
      if((latest?.attemptId??null)!==input.expectedLatestAttemptId)throw Error('loop_native_attempt_conflict');
      if(latest&&(latest.kind==='application-reauthorization'&&latest.phase==='retired'||!['ready','retired','stale'].includes(latest.phase)))throw Error('loop_native_attempt_pending');
      if(records.length>=32)throw Error('loop_native_attempt_capacity');
      if(!Number.isSafeInteger(input.now)||input.now<Math.max(target.candidate.createdAt,latest?.updatedAt??0))throw Error('loop_native_attempt_time');
      const expected:LoopNativeAttempt={kind:'enrollment-and-application',enrollmentSourceAttemptId:null,reauthorizesAttemptId:null,attemptId:randomUUID(),candidateId:input.candidateId,revision:1,ordinal:records.length+1,originalSource:'user',
        bindingHash:target.candidate.bindingHash,sourceVectorHash:target.candidate.sourceVectorHash,configurationRevision:target.basis.configuration.revision,definitionHash:nativeDefinitionHash(target.definition),
        enrollmentRequestId:randomUUID(),applicationRequestId:randomUUID(),phase:'reserved',createdAt:input.now,updatedAt:input.now};
      const written=this.db.prepare(`INSERT INTO loop_native_attempts(attempt_id,candidate_id,revision,ordinal,original_source,binding_hash,source_vector_hash,configuration_revision,definition_hash,enrollment_request_id,application_request_id,phase,created_at,updated_at)
        VALUES(?,?,1,?,'user',?,?,?,?,?,?,'reserved',?,?)`).run(expected.attemptId,expected.candidateId,expected.ordinal,expected.bindingHash,expected.sourceVectorHash,expected.configurationRevision,expected.definitionHash,expected.enrollmentRequestId,expected.applicationRequestId,expected.createdAt,expected.updatedAt);
      const actual=this.getLoopNativeAttempt(expected.attemptId);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(expected))throw Error('loop_native_attempt_conflict');
      this.bumpAutomationStoreVersion();
      this.assertLoopNativeCandidateCurrent(target.candidate);
      if(publicationJson(this.loopNativeCandidateTarget(input.candidateId))!==publicationJson(target)||publicationJson(this.listLoopNativeAttempts(input.candidateId))!==publicationJson([...records,expected]))throw Error('loop_native_attempt_conflict');
      return actual;
    });
  }

  applyLoopNativeReauthorization(token:object):Readonly<LoopNativeAttempt> {
    const write=consumeLoopNativeReauthorization(token,this);
    return this.transaction(()=>{
      write.check();
      const target=this.getLoopNativeAttemptTarget(write.parent.attemptId),history=this.listLoopNativeAttempts(write.parent.candidateId);
      if(publicationJson(target)!==write.targetJson||publicationJson(history)!==write.historyJson||history.at(-1)?.attemptId!==write.parent.attemptId)throw Error('loop_native_attempt_conflict');
      this.assertLoopNativeAttemptCurrentInTransaction(write.parent.attemptId);
      if(history.length>=32)throw Error('loop_native_attempt_capacity');
      const ancestor=history.find(r=>r.attemptId===write.enrollmentSourceAttemptId);
      if(!ancestor||ancestor.kind!=='enrollment-and-application'||!['needs_reauthorization','retired'].includes(write.parent.phase)||write.parent.phase==='retired'&&write.parent.kind!=='application-reauthorization')throw Error('loop_native_attempt_lineage');
      if(!Number.isSafeInteger(write.now)||write.now<write.parent.updatedAt)throw Error('loop_native_attempt_time');
      const expected:LoopNativeAttempt={...write.parent,kind:'application-reauthorization',attemptId:randomUUID(),revision:1,ordinal:history.length+1,enrollmentRequestId:null,enrollmentSourceAttemptId:ancestor.attemptId,reauthorizesAttemptId:write.parent.attemptId,applicationRequestId:randomUUID(),phase:'enrolled',createdAt:write.now,updatedAt:write.now};
      const written=this.db.prepare(`INSERT INTO loop_native_attempts(attempt_id,candidate_id,revision,ordinal,original_source,binding_hash,source_vector_hash,configuration_revision,definition_hash,enrollment_request_id,application_request_id,phase,created_at,updated_at,kind,enrollment_source_attempt_id,reauthorizes_attempt_id)
        VALUES(?,?,1,?,'user',?,?,?,?,NULL,?,'enrolled',?,?,'application-reauthorization',?,?)`).run(expected.attemptId,expected.candidateId,expected.ordinal,expected.bindingHash,expected.sourceVectorHash,expected.configurationRevision,expected.definitionHash,expected.applicationRequestId,expected.createdAt,expected.updatedAt,expected.enrollmentSourceAttemptId,expected.reauthorizesAttemptId);
      if(written.changes!==1)throw Error('loop_native_attempt_conflict');
      this.bumpAutomationStoreVersion();
      write.check(true);
      this.assertLoopNativeAttemptCurrentInTransaction(expected.attemptId);
      if(publicationJson(this.getLoopNativeAttemptTarget(write.parent.attemptId))!==write.targetJson||publicationJson(this.listLoopNativeAttempts(expected.candidateId))!==publicationJson([...history,expected]))throw Error('loop_native_attempt_conflict');
      return this.getLoopNativeAttempt(expected.attemptId)!;
    });
  }

  getLoopNativeAttempt(attemptId:string):Readonly<LoopNativeAttempt>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_native_attempts WHERE attempt_id=?').get(attemptId);
    if(!row)return undefined;
    const value={kind:row.kind,enrollmentSourceAttemptId:row.enrollment_source_attempt_id,reauthorizesAttemptId:row.reauthorizes_attempt_id,attemptId:row.attempt_id,candidateId:row.candidate_id,revision:row.revision,ordinal:row.ordinal,originalSource:row.original_source,bindingHash:row.binding_hash,sourceVectorHash:row.source_vector_hash,
      configurationRevision:row.configuration_revision,definitionHash:row.definition_hash,enrollmentRequestId:row.enrollment_request_id,applicationRequestId:row.application_request_id,phase:row.phase,createdAt:row.created_at,updatedAt:row.updated_at};
    for(const key of ['attemptId','candidateId','applicationRequestId'] as const){const id=value[key];if(typeof id!=='string'||!id||Buffer.byteLength(id)>160||/[\x00-\x1f\x7f]/.test(id))throw Error('loop_native_attempt_corrupt');}
    const validId=(id:unknown)=>typeof id==='string'&&id.length>0&&Buffer.byteLength(id)<=160&&!/[\x00-\x1f\x7f]/.test(id);
    if(value.kind==='enrollment-and-application'){
      if(!validId(value.enrollmentRequestId)||value.enrollmentSourceAttemptId!==null||value.reauthorizesAttemptId!==null)throw Error('loop_native_attempt_corrupt');
    }else if(value.kind==='application-reauthorization'){
      if(value.enrollmentRequestId!==null||!validId(value.enrollmentSourceAttemptId)||!validId(value.reauthorizesAttemptId)||['reserved','enrolling'].includes(String(value.phase)))throw Error('loop_native_attempt_corrupt');
    }else throw Error('loop_native_attempt_corrupt');
    for(const key of ['bindingHash','sourceVectorHash','definitionHash'] as const)if(typeof value[key]!=='string'||!/^[a-f0-9]{64}$/.test(value[key]))throw Error('loop_native_attempt_corrupt');
    for(const key of ['revision','ordinal','configurationRevision','createdAt','updatedAt'] as const)if(typeof value[key]!=='number'||!Number.isSafeInteger(value[key])||value[key]<(key==='createdAt'||key==='updatedAt'?0:1))throw Error('loop_native_attempt_corrupt');
    if(value.originalSource!=='user'||typeof value.phase!=='string'||!Object.hasOwn(LOOP_NATIVE_PHASE_EDGES,value.phase)||Number(value.ordinal)>32||Number(value.updatedAt)<Number(value.createdAt)||value.enrollmentRequestId===value.applicationRequestId)throw Error('loop_native_attempt_corrupt');
    return freezeLoopPublicationValue(value as unknown as LoopNativeAttempt);
  }

  listLoopNativeAttempts(candidateId:string):Readonly<LoopNativeAttempt>[] {
    const rows=(this.db.prepare('SELECT attempt_id FROM loop_native_attempts WHERE candidate_id=? ORDER BY ordinal').all(candidateId) as {attempt_id:string}[]).map(row=>this.getLoopNativeAttempt(row.attempt_id)!);
    if(rows.length>32||rows.some((row,index)=>row.ordinal!==index+1))throw Error('loop_native_attempt_corrupt');
    for(const [index,row] of rows.entries())if(row.kind==='application-reauthorization'){
      const parent=rows[index-1],ancestor=rows.find(r=>r.attemptId===row.enrollmentSourceAttemptId);
      if(!parent||parent.attemptId!==row.reauthorizesAttemptId||!['needs_reauthorization','retired'].includes(parent.phase)
        ||parent.phase==='retired'&&parent.kind!=='application-reauthorization'||!ancestor||ancestor.kind!=='enrollment-and-application'||ancestor.ordinal>=row.ordinal
        ||parent.kind==='application-reauthorization'&&parent.enrollmentSourceAttemptId!==ancestor.attemptId
        ||parent.kind==='enrollment-and-application'&&parent.attemptId!==ancestor.attemptId
        ||[parent,ancestor].some(r=>r.bindingHash!==row.bindingHash||r.sourceVectorHash!==row.sourceVectorHash||r.definitionHash!==row.definitionHash||r.configurationRevision!==row.configurationRevision))throw Error('loop_native_attempt_lineage');
    }
    return rows;
  }

  getLoopNativeAttemptTarget(attemptId:string):Readonly<{attempt:Readonly<LoopNativeAttempt>;binding:Readonly<LoopApplicationBinding>;definition:Readonly<GoalVerificationDefinition>}> {
    const attempt=this.getLoopNativeAttempt(attemptId);if(!attempt)throw Error('loop_native_attempt_missing');
    const target=this.loopNativeCandidateTarget(attempt.candidateId);
    if(attempt.bindingHash!==target.candidate.bindingHash||attempt.sourceVectorHash!==target.candidate.sourceVectorHash||attempt.configurationRevision!==target.basis.configuration.revision||attempt.definitionHash!==nativeDefinitionHash(target.definition))throw Error('loop_native_attempt_target_changed');
    return freezeLoopPublicationValue({attempt,binding:target.candidate.binding,definition:target.definition});
  }

  assertLoopNativeAttemptCurrent(attemptId:string):void {
    this.transaction(()=>this.assertLoopNativeAttemptCurrentInTransaction(attemptId));
  }

  advanceLoopNativeAttempt(raw:{attemptId:string;expectedRevision:number;phase:LoopNativePhase;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<LoopNativeAttempt> {
    const input=JSON.parse(publicationJson(raw));
    if(Object.keys(input).sort().join(',')!=='attemptId,expectedRevision,now,phase,requestSource'||!['user','scheduler'].includes(input.requestSource))throw Error('loop_native_attempt_source');
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||typeof input.phase!=='string'||!Object.hasOwn(LOOP_NATIVE_PHASE_EDGES,input.phase))throw Error('loop_native_attempt_input');
    if(input.requestSource==='scheduler'&&['enrolling','binding'].includes(input.phase))throw Error('loop_native_attempt_source');
    return this.transaction(()=>{
      const target=this.getLoopNativeAttemptTarget(input.attemptId),row=target.attempt,history=this.listLoopNativeAttempts(row.candidateId);
      if(row.revision!==input.expectedRevision)throw Error('loop_native_attempt_conflict');
      if(!LOOP_NATIVE_PHASE_EDGES[row.phase].includes(input.phase))throw Error('loop_native_attempt_transition');
      if(!Number.isSafeInteger(input.now)||input.now<row.updatedAt||!Number.isSafeInteger(row.revision+1))throw Error('loop_native_attempt_time');
      if(['enrolling','binding','ready'].includes(input.phase))this.assertLoopNativeAttemptCurrentInTransaction(row.attemptId);
      const written=this.db.prepare('UPDATE loop_native_attempts SET revision=?,phase=?,updated_at=? WHERE attempt_id=? AND revision=?').run(row.revision+1,input.phase,input.now,row.attemptId,row.revision);
      const expected={...row,revision:row.revision+1,phase:input.phase,updatedAt:input.now},actual=this.getLoopNativeAttempt(row.attemptId);
      if(written.changes!==1||!actual||publicationJson(actual)!==publicationJson(expected))throw Error('loop_native_attempt_conflict');
      this.bumpAutomationStoreVersion();
      if(['enrolling','binding','ready'].includes(input.phase))this.assertLoopNativeAttemptCurrentInTransaction(row.attemptId);
      if(publicationJson(this.getLoopNativeAttemptTarget(row.attemptId))!==publicationJson({...target,attempt:expected})
        ||publicationJson(this.listLoopNativeAttempts(row.candidateId))!==publicationJson(history.map(r=>r.attemptId===row.attemptId?expected:r)))throw Error('loop_native_attempt_conflict');
      return actual;
    });
  }

  private loopNativeCandidateTarget(candidateId:string) {
    const candidate=this.getLoopPublicationCandidate(candidateId);if(!candidate)throw Error('loop_native_candidate_missing');
    const basis=this.getLoopRunPublicationBasis(candidate.runId);if(!basis)throw Error('loop_publication_basis_missing');
    const definitions=basis.configuration.configuration.verificationDefinitions,stage=candidate.binding.subject.stage;
    const definition=parseGoalVerificationDefinition(stage?definitions.stages[stage.stageKind]:definitions.run);
    return {candidate,basis,definition};
  }
  private assertLoopNativeCandidateCurrent(candidate:Readonly<StoredLoopPublicationCandidate>):void {
    const basis=this.assertLoopPublicationBasisCurrent(candidate.runId);
    const actual=this.captureLoopPublicationCandidateInTransaction({runId:candidate.runId,stageId:candidate.stageId,expectedResultRevision:1},basis);
    if(actual.candidateId!==candidate.candidateId||actual.bindingHash!==candidate.bindingHash||actual.sourceVectorHash!==candidate.sourceVectorHash)throw Error('loop_native_candidate_changed');
  }
  private assertLoopNativeAttemptCurrentInTransaction(attemptId:string):void {
    const target=this.getLoopNativeAttemptTarget(attemptId);
    this.assertLoopNativeCandidateCurrent(this.getLoopPublicationCandidate(target.attempt.candidateId)!);
  }

  /** Only the original live begin result can open a producer. Persisted JSON is
   * recovery data and cannot recreate execution provenance after restart. */
  openLoopPublicationProducer(run:LoopRun):Readonly<LoopPublicationProducer> {
    const started=run&&typeof run==='object'?this.publicationBegins.get(run):undefined;
    if(!started||publicationJson(captureLoopProducerValue(run))!==started.runJson)throw Error('loop_publication_producer_required');
    const basis=this.getLoopRunPublicationBasis(started.runId);if(!basis)throw Error('loop_publication_basis_missing');
    const producer:LoopPublicationProducer={
      recordScan:(stageId,result,now,artifacts=[])=>{
        const copied=captureLoopProducerValue({stageId,result,now,artifacts});
        this.transaction(()=>{
          const current=this.assertLoopPublicationProducer(producer),stage=this.publicationStage(current.runId,copied.stageId,'scan');
          const subject={kind:'loop-run' as const,loopId:current.loopId,runId:current.runId,stage:{stageId:stage.id,stageKind:'scan' as const}};
          const body=buildLoopScanPublicationBody(subject,copied.result,copied.now,copied.artifacts,current.contract);
          this.writeLoopProducerResult(current,body,stage.id,[],copied.now);
        });
      },
      recordAssistantOutput:(output,now,artifacts=[])=>{
        const copied=captureLoopProducerValue({output,now,artifacts});
        this.transaction(()=>{
          const current=this.assertLoopPublicationProducer(producer);if(current.contract.kind!=='assistant')throw Error('loop_publication_producer_kind');
          if(this.loopProducerResult(current.runId))throw Error('loop_publication_result_exists');
          let body:unknown;
          if(current.contract.assistantKind==='evening'){
            if(this.db.prepare('SELECT 1 FROM assistant_candidates WHERE run_id=? LIMIT 1').get(current.runId))throw Error('loop_publication_candidate_source_exists');
            const normalized=validateEveningReflection(copied.output);
            if(publicationJson(captureLoopProducerValue(normalized))!==publicationJson(copied.output))throw Error('loop_publication_output_shape');
            // The actual generated IDs and full result commit together.
            this.stageAssistantCandidatesInTransaction(current.runId,normalized.candidates,copied.now);
            body={kind:'assistant-evening',summary:normalized.summary,candidates:this.assistantPublicationRows(current.runId).map(row=>this.assistantPublicationValue(row)),artifacts:copied.artifacts};
          }else{
            const normalized=validateMorningBriefing(copied.output);
            if(publicationJson(normalized)!==publicationJson(copied.output))throw Error('loop_publication_output_shape');
            body={kind:'assistant-morning',recommendations:normalized.recommendations,artifacts:copied.artifacts};
          }
          this.writeLoopProducerResult(current,body,null,[],copied.now);
        });
      },
      recordTemplateExecution:raw=>{
        const input=captureLoopProducerValue(raw);
        if(Object.keys(input).sort().join(',')!=='artifacts,evidenceIds,executeStageId,now,summary,taskSnapshot')throw Error('loop_publication_execution_shape');
        this.transaction(()=>{
          const current=this.assertLoopPublicationProducer(producer);
          this.writeTemplateExecution(current,input);
        });
      },
      recordTemplateNonSuccess:raw=>{
        const input=captureLoopProducerValue(raw);
        publicationFields(input,['executeStageId','verifyStageId','evaluation','requestSource','now']);
        if(!['user','scheduler'].includes(input.requestSource))throw Error('loop_template_outcome_source');
        this.transaction(()=>{
          const basis=this.assertLoopPublicationProducer(producer);
          if(basis.contract.kind!=='user-template'||basis.requestSource!==input.requestSource)throw Error('loop_template_outcome_source');
          this.writeTemplateNonSuccess(basis,input);
        });
      },
      recordTemplateTerminal:raw=>{
        const input=JSON.parse(publicationJson(raw));
        if(Object.keys(input).sort().join(',')!=='artifacts,evidenceIds,executeStageId,now,summary,verifyStageId')throw Error('loop_publication_template_shape');
        this.transaction(()=>{
          const current=this.assertLoopPublicationProducer(producer);if(current.contract.kind!=='user-template')throw Error('loop_publication_producer_kind');
          this.writeTemplateTerminal(current,input);
        });
      },
    };
    this.publicationProducers.set(producer,{runId:basis.runId,basisJson:publicationJson(basis)});
    this.assertLoopPublicationProducer(producer);return Object.freeze(producer);
  }

  bindLoopExecutionTaskIdentity(token:object):{assertCurrent:()=>void;markStarted:()=>void} {
    const entry=consumeLoopTaskIdentity(token,this);
    return this.transaction(()=>{
      if(loopTaskIdentityVector(this,entry.runId)!==entry.vector)throw Error('loop_task_identity_changed');
      const run=this.getLoopRunRow(entry.runId),stage=this.publicationStage(entry.runId,entry.stageId,'execute');
      if(!run||run.status!=='running'||stage.status!=='running')throw Error('loop_task_identity_changed');
      if(this.getLoopRunPublicationBasis(entry.runId))this.assertLoopPublicationBasisCurrent(entry.runId);
      const metadata=JSON.parse(stage.metadata_json);if(metadata.taskId!==undefined)throw Error('loop_task_identity_exists');
      const nextMetadata=publicationJson({...metadata,taskId:entry.taskId,taskStartState:'unknown'});
      const written=this.db.prepare('UPDATE loop_stages SET metadata_json=? WHERE id=? AND metadata_json=?').run(nextMetadata,entry.stageId,stage.metadata_json);
      this.bumpAutomationStoreVersion();
      const expected=JSON.parse(entry.vector),target=expected.stages.find((item:{id:string})=>item.id===entry.stageId);target.metadata=JSON.parse(nextMetadata);
      if(written.changes!==1||loopTaskIdentityVector(this,entry.runId)!==publicationJson(expected))throw Error('loop_task_identity_changed');
      if(this.getLoopRunPublicationBasis(entry.runId))this.assertLoopPublicationBasisCurrent(entry.runId);
      const original=publicationJson(expected);let marked=false;
      const assertCurrent=()=>{if(marked||loopTaskIdentityVector(this,entry.runId)!==original||this.getLoopDefinition(run.loop_id)?.status!=='active')throw Error('loop_task_identity_changed');if(this.getLoopRunPublicationBasis(entry.runId))this.assertLoopPublicationBasisCurrent(entry.runId);};
      return Object.freeze({assertCurrent,markStarted:()=>{if(marked)throw Error('loop_task_identity_consumed');marked=true;this.transaction(()=>{
        if(loopTaskIdentityVector(this,entry.runId)!==original)throw Error('loop_task_identity_changed');
        const started=JSON.parse(original);started.stages.find((item:{id:string})=>item.id===entry.stageId).metadata.taskStartState='started';
        const changed=this.db.prepare('UPDATE loop_stages SET metadata_json=? WHERE id=? AND metadata_json=?').run(publicationJson({...JSON.parse(nextMetadata),taskStartState:'started'}),entry.stageId,nextMetadata);
        this.bumpAutomationStoreVersion();if(changed.changes!==1||loopTaskIdentityVector(this,entry.runId)!==publicationJson(started))throw Error('loop_task_identity_changed');
        if(this.getLoopRunPublicationBasis(entry.runId))this.assertLoopPublicationBasisCurrent(entry.runId);
      });}});
    });
  }

  recordLoopTaskTerminal(token:object):void {
    const entry=consumeLoopTaskTerminal(token,this);
    this.transaction(()=>{
      if(loopTaskIdentityVector(this,entry.runId)!==entry.vector)throw Error('loop_task_identity_changed');
      const stage=this.getLoopStage(entry.stageId);
      if(!stage||stage.runId!==entry.runId||stage.stageKind!=='execute'||stage.metadata.taskId!==entry.taskId||!['unknown','started','terminal'].includes(String(stage.metadata.taskStartState)))throw Error('loop_task_identity_changed');
      const previous=publicationJson(stage.metadata),metadata={...stage.metadata,taskStartState:'terminal'};
      const changed=this.db.prepare('UPDATE loop_stages SET metadata_json=? WHERE id=? AND metadata_json=?').run(publicationJson(metadata),entry.stageId,previous);
      const expected=JSON.parse(entry.vector);expected.stages.find((item:{id:string})=>item.id===entry.stageId).metadata=metadata;
      this.bumpAutomationStoreVersion();
      if(changed.changes!==1||loopTaskIdentityVector(this,entry.runId)!==publicationJson(expected))throw Error('loop_task_identity_changed');
    });
  }

  recoverLoopTemplateExecution(token:object):void {
    const entry=consumeLoopTemplateExecutionRecovery(token,this);
    this.transaction(()=>{
      if(readLoopTemplateRecoveryVector(this,entry.runId)!==entry.vector)throw Error('loop_template_recovery_changed');
      const basis=this.assertLoopPublicationBasisCurrent(entry.runId);
      this.writeTemplateExecution(basis,{executeStageId:entry.executeStageId,taskSnapshot:entry.snapshot,summary:`Task ${entry.snapshot.taskId} completed.`,evidenceIds:[],artifacts:[],now:entry.now});
      const saved=this.loopStageExecutionResult(entry.executeStageId);
      if(!saved||saved.task_snapshot_json!==publicationJson(entry.snapshot))throw Error('loop_template_recovery_changed');
      this.assertExecutionResultCurrent(saved,basis,this.publicationStage(entry.runId,entry.executeStageId,'execute'));
      const expected=JSON.parse(entry.vector);
      expected.lifecycle.executionPhase='awaiting_verification';
      expected.lifecycle.executionStageIds=[...expected.lifecycle.executionStageIds,entry.executeStageId].sort();
      this.assertLoopPublicationBasisCurrent(entry.runId);
      if(readLoopTemplateRecoveryVector(this,entry.runId)!==publicationJson(expected))throw Error('loop_template_recovery_changed');
    });
  }

  recoverLoopTemplateTerminal(token:object):void {
    const entry=consumeLoopTemplateExecutionRecovery(token,this,'terminal');
    this.transaction(()=>{
      if(readLoopTemplateRecoveryVector(this,entry.runId)!==entry.vector)throw Error('loop_template_recovery_changed');
      const basis=this.assertLoopPublicationBasisCurrent(entry.runId),execution=this.loopStageExecutionResult(entry.executeStageId);
      if(!execution||execution.task_snapshot_json!==publicationJson(entry.snapshot))throw Error('loop_template_recovery_changed');
      assertLoopTemplateRecoveryFile(entry);
      this.writeTemplateTerminal(basis,{executeStageId:entry.executeStageId,verifyStageId:entry.verifyStageId!,summary:entry.summary!,evidenceIds:[],artifacts:[],now:entry.now});
      const saved=this.loopProducerResult(entry.runId);
      if(!saved||JSON.parse(saved.body_json).summary!==entry.summary)throw Error('loop_template_recovery_changed');
      assertLoopTemplateRecoveryFile(entry);
      const expected=JSON.parse(entry.vector);expected.lifecycle.executionPhase='execution_terminal';expected.lifecycle.businessState='publication_pending';expected.lifecycle.terminalResultPresent=true;
      this.assertLoopPublicationBasisCurrent(entry.runId);
      if(readLoopTemplateRecoveryVector(this,entry.runId)!==publicationJson(expected))throw Error('loop_template_recovery_changed');
    });
  }

  private writeTemplateNonSuccess(basis:Readonly<LoopRunPublicationBasis>,input:Parameters<LoopPublicationProducer['recordTemplateNonSuccess']>[0]):void {
    const evaluation=input.evaluation;
    if(!evaluation||!['failed','blocked'].includes(evaluation.status))throw Error('loop_template_outcome_evaluation');
    publicationFields(evaluation,evaluation.status==='failed'?['status','evidenceIds','failureKind','message']:['status','evidenceIds','nextActionKind','nextActionSummary']);
    const message=evaluation.status==='failed'?evaluation.message:evaluation.nextActionSummary;
    if(typeof message!=='string'||!message||!Array.isArray(evaluation.evidenceIds)||evaluation.evidenceIds.some(id=>typeof id!=='string'||!id))throw Error('loop_template_outcome_evaluation');
    if(evaluation.status==='failed'&&!['executor_crash','executor_failed','validation_failed','evidence_missing','evidence_kind_mismatch','unknown'].includes(evaluation.failureKind)
      ||evaluation.status==='blocked'&&(typeof evaluation.nextActionKind!=='string'||!evaluation.nextActionKind))throw Error('loop_template_outcome_evaluation');
    const execute=this.publicationStage(basis.runId,input.executeStageId,'execute'),verify=this.publicationStage(basis.runId,input.verifyStageId,'verify'),execution=this.loopStageExecutionResult(execute.id);
    if(!execution||this.loopProducerResult(basis.runId)||this.getLoopBusinessProjection(basis.runId))throw Error('loop_template_outcome_original');
    this.assertExecutionResultCurrent(execution,basis,execute);
    const metadata=JSON.parse(verify.metadata_json),taskId=JSON.parse(execute.metadata_json).taskId;
    if(execute.status!=='running'||verify.status!=='running'||metadata.taskId!==taskId||metadata.localEvaluationStarted!==true||metadata.localEvaluation!==undefined)throw Error('loop_template_outcome_original');
    const snapshot=()=>{
      const facts=this.readLoopPublicationResults(basis.runId);
      return {storeVersion:(this.db.prepare("SELECT * FROM automation_store_metadata WHERE key='version'").get() as unknown as {key:string;value:number}|undefined)??null,rows:this.rawLoopProjectionRows(basis.runId),basis:this.getLoopRunPublicationBasis(basis.runId),definition:this.getLoopDefinitionRow(basis.loopId),configuration:this.getLoopPublicationConfiguration(basis.loopId),template:this.db.prepare('SELECT * FROM user_loop_templates WHERE loop_id=?').get(basis.loopId),facts:{result:facts.result??null,executions:facts.executions},candidates:this.listLoopPublicationCandidates(basis.runId)};
    };
    const before=snapshot();
    if(!before.storeVersion||!Number.isSafeInteger(before.storeVersion.value)||before.storeVersion.value<0||before.storeVersion.value>=Number.MAX_SAFE_INTEGER)throw Error('loop_template_outcome_version');
    if(before.rows.stages.some(stage=>stage.id!==execute.id&&stage.id!==verify.id&&['running','pending'].includes(stage.status)))throw Error('loop_template_outcome_open_stage');
    if(!Number.isSafeInteger(input.now)||input.now<Math.max(before.rows.run.updated_at,execute.updated_at,verify.updated_at,execution.terminal_at,before.definition!.updated_at))throw Error('loop_template_outcome_time');
    const expected=JSON.parse(publicationJson(before)) as typeof before;
    expected.storeVersion!.value+=1;
    const run=expected.rows.run,stage=expected.rows.stages.find(row=>row.id===verify.id)!;
    Object.assign(run,{status:evaluation.status,evidence_ids_json:publicationJson(evaluation.evidenceIds),finished_at:input.now,updated_at:input.now,failure_kind:evaluation.status==='failed'?evaluation.failureKind:null,message:evaluation.status==='failed'?message:null,next_action_kind:evaluation.status==='blocked'?evaluation.nextActionKind:null,next_action_summary:evaluation.status==='blocked'?message:null});
    Object.assign(stage,{status:evaluation.status,evidence_ids_json:publicationJson(evaluation.evidenceIds),finished_at:input.now,updated_at:input.now,failure_kind:evaluation.status==='failed'?evaluation.failureKind:null,message,metadata_json:publicationJson({...metadata,localEvaluation:evaluation})});
    expected.definition!.active_run_id=null;expected.definition!.updated_at=input.now;
    const stageWrite=this.db.prepare("UPDATE loop_stages SET status=?,evidence_ids_json=?,finished_at=?,updated_at=?,failure_kind=?,message=?,metadata_json=? WHERE id=? AND status='running' AND metadata_json=?").run(stage.status,stage.evidence_ids_json,stage.finished_at,stage.updated_at,stage.failure_kind,stage.message,stage.metadata_json,stage.id,verify.metadata_json);
    const runWrite=this.db.prepare("UPDATE loop_runs SET status=?,evidence_ids_json=?,finished_at=?,updated_at=?,failure_kind=?,message=?,next_action_kind=?,next_action_summary=? WHERE id=? AND status='running'").run(run.status,run.evidence_ids_json,run.finished_at,run.updated_at,run.failure_kind,run.message,run.next_action_kind,run.next_action_summary,run.id);
    this.clearActiveRun(basis.loopId,basis.runId,input.now);this.bumpAutomationStoreVersion();
    if(stageWrite.changes!==1||runWrite.changes!==1||publicationJson(snapshot())!==publicationJson(expected))throw Error('loop_template_outcome_changed');
  }

  private writeTemplateTerminal(current:Readonly<LoopRunPublicationBasis>,input:Parameters<LoopPublicationProducer['recordTemplateTerminal']>[0]):void {
          const execute=this.publicationStage(current.runId,input.executeStageId,'execute'),verify=this.publicationStage(current.runId,input.verifyStageId,'verify');
          const taskId=JSON.parse(execute.metadata_json).taskId;
          const execution=this.loopStageExecutionResult(execute.id);
          if(execution)this.assertExecutionResultCurrent(execution,current,execute);
          if(!execution&&execute.status!=='success'||typeof taskId!=='string'||!taskId||JSON.parse(verify.metadata_json).taskId!==taskId)throw Error('loop_publication_task_binding');
          if(execution&&input.now<execution.terminal_at)throw Error('loop_publication_result_time');
          this.writeLoopProducerResult(current,{kind:'user-template',taskId,executeStageId:execute.id,verifyStageId:verify.id,summary:input.summary,evidenceIds:input.evidenceIds,artifacts:input.artifacts},verify.id,input.evidenceIds,input.now);
  }

  private writeTemplateExecution(current:Readonly<LoopRunPublicationBasis>,input:Parameters<LoopPublicationProducer['recordTemplateExecution']>[0]):void {
          if(current.contract.kind!=='user-template')throw Error('loop_publication_producer_kind');
          const stage=this.publicationStage(current.runId,input.executeStageId,'execute');
          if(stage.status!=='running')throw Error('loop_publication_execution_stage');
          if(this.loopProducerResult(current.runId)||this.loopStageExecutionResult(stage.id))throw Error('loop_publication_result_exists');
          this.assertExecutionSnapshot(input.taskSnapshot,stage,input.now,current.sourceRows.run.started_at);
          const body=parseLoopCandidateBody({kind:'user-template-execute',taskId:input.taskSnapshot.taskId,executeStageId:stage.id,summary:input.summary,evidenceIds:input.evidenceIds,artifacts:input.artifacts},
            {kind:'loop-run',loopId:current.loopId,runId:current.runId,stage:{stageId:stage.id,stageKind:'execute'}},current.contract);
          const encoded=publicationJson(body),snapshotJson=publicationJson(input.taskSnapshot);
          this.db.prepare('INSERT INTO loop_stage_execution_results(stage_id,run_id,revision,body_json,body_hash,task_snapshot_json,task_snapshot_hash,evidence_ids_json,terminal_at) VALUES(?,?,1,?,?,?,?,?,?)')
            .run(stage.id,current.runId,encoded,publicationHash(encoded),snapshotJson,publicationHash(snapshotJson),publicationJson(input.evidenceIds),input.now);
          this.bumpAutomationStoreVersion();
  }

  captureLoopPublicationCandidate(raw:{runId:string;stageId:string|null;expectedResultRevision:number},producer:Readonly<LoopPublicationProducer>):Readonly<StoredLoopPublicationCandidate> {
    const input=JSON.parse(publicationJson(raw));if(Object.keys(input).sort().join(',')!=='expectedResultRevision,runId,stageId')throw Error('loop_publication_capture_shape');
    return this.transaction(()=>{
      const basis=this.assertLoopPublicationProducer(producer,true);if(input.runId!==basis.runId)throw Error('loop_publication_capture_run');
      return this.captureLoopPublicationCandidateInTransaction(input,basis);
    });
  }

  /** Rebuild only missing candidate facts from committed producer results. This
   * path never creates a live producer or repeats the underlying execution. */
  recoverLoopPublicationCandidates(raw:{runId:string;requestSource:'user'|'agent'|'scheduler'}):Readonly<StoredLoopPublicationCandidate>[] {
    const input=JSON.parse(publicationJson(raw));
    if(Object.keys(input).sort().join(',')!=='requestSource,runId'||!['user','scheduler'].includes(input.requestSource))throw Error('loop_publication_recovery_source');
    if(typeof input.runId!=='string'||!input.runId)throw Error('loop_publication_recovery_run');
    return this.transaction(()=>{
      const basis=this.assertLoopPublicationBasisCurrent(input.runId),result=this.loopProducerResult(input.runId);
      const executions=this.db.prepare('SELECT stage_id FROM loop_stage_execution_results WHERE run_id=? ORDER BY stage_id').all(input.runId) as {stage_id:string}[];
      if(!result&&!executions.length)throw Error('loop_publication_result_missing');
      for(const execution of executions)this.captureLoopPublicationCandidateInTransaction({runId:input.runId,stageId:execution.stage_id,expectedResultRevision:1},basis);
      if(result)for(const stageId of result.stage_id===null?[null]:[result.stage_id,null])this.captureLoopPublicationCandidateInTransaction({runId:input.runId,stageId,expectedResultRevision:result.revision},basis);
      return this.listLoopPublicationCandidates(input.runId);
    });
  }

  private rawLoopProjectionRows(runId:string):LoopProjectionRows {
    const run=this.getLoopRunRow(runId);if(!run)throw Error('loop_projection_run');
    return {run,stages:this.db.prepare('SELECT * FROM loop_stages WHERE run_id=? ORDER BY id COLLATE BINARY').all(runId) as unknown as LoopStageRow[],members:this.db.prepare('SELECT * FROM assistant_candidates WHERE run_id=? ORDER BY id COLLATE BINARY').all(runId) as unknown as AssistantCandidateRow[]};
  }
  getLoopBusinessProjection(runId:string):Readonly<LoopBusinessProjection>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_projection_origins WHERE run_id=?').get(runId) as {run_id:string;origin_hash:string;record_json:string}|undefined;
    const generations=this.db.prepare('SELECT * FROM loop_projection_generations WHERE run_id=? ORDER BY generation').all(runId) as unknown as {run_id:string;generation:number;generation_hash:string;record_json:string}[];
    if(!row){if(generations.length)throw Error('loop_projection_origin_missing');return undefined;}
    const origin=JSON.parse(row.record_json) as LoopProjectionOrigin;validateLoopProjectionOrigin(origin);
    if(publicationJson(origin)!==row.record_json||loopProjectionHash(origin)!==row.origin_hash||origin.before.run.id!==runId||origin.after.run.id!==runId||!generations.length||generations.length>32)throw Error('loop_projection_origin_corrupt');
    let previous:string|null=null,result:LoopBusinessProjection|undefined;
    for(let i=0;i<generations.length;i++){
      const r=generations[i],v=JSON.parse(r.record_json);
      publicationFields(v,['runId','originHash','generation','previousGenerationHash','observation']);
      if(v.runId!==runId||v.originHash!==row.origin_hash||v.generation!==i+1||r.generation!==v.generation||v.previousGenerationHash!==previous||publicationJson(v)!==r.record_json||loopProjectionHash(v)!==r.generation_hash)throw Error('loop_projection_generation_corrupt');
      previous=r.generation_hash;result={runId:v.runId,originHash:v.originHash,generation:v.generation,previousGenerationHash:v.previousGenerationHash,observation:v.observation,origin,generationHash:previous} as LoopBusinessProjection;
    }
    return freezeProjection(result!);
  }
  private normalizedLoopProjectionRows(runId:string):LoopProjectionRows {
    const rows=this.rawLoopProjectionRows(runId),projection=this.getLoopBusinessProjection(runId);
    if(projection)this.assistantPromotionHistory(rows);
    return projection?normalizeLoopProjectionRows(rows,projection.origin):rows;
  }
  getLoopBusinessProjectionTarget(runId:string):Readonly<LoopBusinessProjectionTarget> {return this.transaction(()=>this.loopBusinessProjectionTarget(runId));}
  private loopBusinessProjectionTarget(runId:string):Readonly<LoopBusinessProjectionTarget> {
    publicationIdentity(runId);const basis=this.assertLoopPublicationBasisCurrent(runId),facts=this.readLoopPublicationResults(runId);
    if(!facts.result)throw Error('loop_projection_result_missing');
    const candidates=this.listLoopPublicationCandidates(runId),rows=this.rawLoopProjectionRows(runId),body=JSON.parse(facts.result.body_json);
    const stageIds=body.kind==='builtin-diagnostic'?[facts.result.stage_id]:body.kind==='user-template'?[body.executeStageId,body.verifyStageId]:[];
    if(stageIds.some((id:unknown)=>typeof id!=='string')||new Set(stageIds).size!==stageIds.length||rows.stages.length!==stageIds.length||rows.stages.some(s=>!stageIds.includes(s.id))||candidates.length!==stageIds.length+1||candidates.filter(c=>c.stageId===null).length!==1||candidates.some(c=>c.stageId!==null&&!stageIds.includes(c.stageId)))throw Error('loop_projection_inventory');
    if(body.kind!=='assistant-evening'&&rows.members.length)throw Error('loop_projection_inventory');
    const publications=candidates.map(c=>{this.assertLoopNativeCandidateCurrent(c);const p=this.listLoopPublicationAttempts(c.candidateId).at(-1);if(!p||p.status!=='committed'||!p.observation||p.observation.status!=='committed')throw Error('loop_projection_not_published');this.assertLoopNativeAttemptCurrentInTransaction(p.nativeAttemptId);return p;});
    const natives=publications.map(p=>this.getLoopNativeAttemptTarget(p.nativeAttemptId)),projection=this.getLoopBusinessProjection(runId)??null;
    const promotionIntents=this.assistantPromotionHistory(rows);
    const vector=publicationJson({promotionIntents,basis,configuration:this.getLoopPublicationConfiguration(basis.loopId),definition:this.getLoopDefinitionRow(basis.loopId),facts,rows,candidates,publications,natives,projection});
    return freezeProjection({runId,vector,rows,candidates,publications,executions:facts.executions.map(e=>JSON.parse(e.task_snapshot_json) as TaskSnapshot),projection});
  }
  applyLoopBusinessProjection(raw:{ticket:object;runId:string;requestSource:'user'|'agent'|'scheduler'}):Readonly<LoopBusinessProjection> {
    const entry=consumeLoopBusinessProjection(this,raw),{target,observation,now,signal}=entry;
    return this.transaction(()=>{
      const current=this.loopBusinessProjectionTarget(target.runId);if(current.vector!==target.vector)throw Error('loop_projection_conflict');
      signal.throwIfAborted();
      if(!Number.isSafeInteger(now)||now<current.rows.run.updated_at)throw Error('loop_projection_time');
      const previous=current.projection;
      // Same receiver identities do not create a new validation generation merely
      // because the observation clock advanced.
      if(previous&&publicationJson(previous.observation.publications)===publicationJson(observation.publications))return previous;
      if(previous&&previous.generation>=32)throw Error('loop_projection_capacity');
      const before=current.rows,after=previous?JSON.parse(publicationJson(before)) as LoopProjectionRows:projectedLoopRows(before,now);
      const origin:LoopProjectionOrigin=previous?.origin??{before,after},originHash=previous?.originHash??loopProjectionHash(origin),generation=(previous?.generation??0)+1;
      const record={runId:target.runId,originHash,generation,previousGenerationHash:previous?.generationHash??null,observation},generationHash=loopProjectionHash(record),result=freezeProjection({...record,origin,generationHash});
      const update=(table:'loop_runs'|'loop_stages'|'assistant_candidates',row:LoopRunRow|LoopStageRow|AssistantCandidateRow)=>{
        const columns=Object.keys(row).filter(k=>k!=='id');if(columns.some(k=>!/^[a-z_]+$/.test(k)))throw Error('loop_projection_columns');
        const result=this.db.prepare(`UPDATE ${table} SET ${columns.map(k=>k+'=?').join(',')} WHERE id=?`).run(...columns.map(k=>(row as any)[k]),row.id);if(result.changes!==1)throw Error('loop_projection_write');
      };
      if(!previous){
        if(this.db.prepare('INSERT INTO loop_projection_origins(run_id,origin_hash,record_json) VALUES(?,?,?)').run(target.runId,originHash,publicationJson(origin)).changes!==1)throw Error('loop_projection_write');
        update('loop_runs',after.run);for(const stage of after.stages)update('loop_stages',stage);for(const member of after.members)update('assistant_candidates',member);
      }
      if(this.db.prepare('INSERT INTO loop_projection_generations(run_id,generation,generation_hash,record_json) VALUES(?,?,?,?)').run(target.runId,generation,generationHash,publicationJson(record)).changes!==1)throw Error('loop_projection_write');
      const expected=JSON.parse(target.vector);expected.rows=after;expected.projection=result;
      if(!previous&&expected.definition.active_run_id===target.runId){this.clearActiveRun(before.run.loop_id,target.runId,now);expected.definition.active_run_id=null;expected.definition.updated_at=now;}
      this.bumpAutomationStoreVersion();
      if(this.loopBusinessProjectionTarget(target.runId).vector!==publicationJson(expected))throw Error('loop_projection_commit_changed');
      signal.throwIfAborted();
      return result;
    });
  }

  private captureLoopPublicationCandidateInTransaction(input:{runId:string;stageId:string|null;expectedResultRevision:number},basis:Readonly<LoopRunPublicationBasis>):Readonly<StoredLoopPublicationCandidate> {
      const stage=input.stageId===null?null:this.publicationStage(basis.runId,input.stageId);
      const result=stage?.stage_kind==='execute'?this.loopStageExecutionResult(stage.id):this.loopProducerResult(basis.runId);
      if(!result||result.run_id!==basis.runId||result.revision!==input.expectedResultRevision)throw Error('loop_publication_result_revision');
      if(stage&&stage.id!==result.stage_id)throw Error('loop_publication_capture_stage');
      const subject={kind:'loop-run' as const,loopId:basis.loopId,runId:basis.runId,stage:stage?{stageId:stage.id,stageKind:stage.stage_kind}:null};
      const body=parseLoopCandidateBody(JSON.parse(result.body_json),subject,basis.contract);
      let templateStages:LoopStageRow[]=[];
      let execution:LoopStageExecutionResultRow|undefined;
      if(body.kind==='user-template-execute'){
        execution=this.loopStageExecutionResult(body.executeStageId)!;
        this.assertExecutionResultCurrent(execution,basis,stage!);
      }
      if(body.kind==='user-template'){
        const execute=this.publicationStage(basis.runId,body.executeStageId,'execute'),verify=this.publicationStage(basis.runId,body.verifyStageId,'verify');
        execution=this.loopStageExecutionResult(execute.id);
        if(execution)this.assertExecutionResultCurrent(execution,basis,execute);
        if(!execution&&execute.status!=='success'||JSON.parse(execute.metadata_json).taskId!==body.taskId||JSON.parse(verify.metadata_json).taskId!==body.taskId)throw Error('loop_publication_task_binding_changed');
        templateStages=[execute,verify];
      }
      const members=body.kind==='assistant-evening'?this.assistantPublicationRows(basis.runId):[];
      if(body.kind==='assistant-evening'&&publicationJson(members.map(row=>this.assistantPublicationValue(row)))!==publicationJson(body.candidates))throw Error('loop_publication_candidate_set_changed');
      // Preserve the original vector for pre-existing terminal candidates.
      const sourceVectorHash=publicationHash(publicationJson({basis,result,stage,templateStages,members,...(execution?{execution}: {})})),subjectKey=publicationJson(subject);
      const old=this.db.prepare('SELECT candidate_id,source_vector_hash FROM loop_publication_candidates WHERE subject_key=? ORDER BY revision DESC LIMIT 1').get(subjectKey) as {candidate_id:string;source_vector_hash:string}|undefined;
      if(old){if(old.source_vector_hash!==sourceVectorHash)throw Error('loop_publication_candidate_source_changed');return this.getLoopPublicationCandidate(old.candidate_id)!;}
      const candidateId=randomUUID(),binding=createLoopApplicationBinding({version:1,kind:'loop',subject,candidateId,candidateRevision:1,originalTriggerJson:basis.originalTriggerJson,logicalRunKey:basis.logicalRunKey,contract:basis.contract,body});
      this.db.prepare("INSERT INTO loop_publication_candidates(candidate_id,run_id,stage_id,subject_key,revision,binding_json,binding_hash,source_vector_hash,publication_state,created_at) VALUES(?,?,?,?,?,?,?,?, 'captured',?)").run(candidateId,basis.runId,stage?.id??null,subjectKey,1,publicationJson(binding),loopApplicationBindingHash(binding),sourceVectorHash,result.terminal_at);
      for(const row of members)this.db.prepare('INSERT INTO loop_publication_candidate_members(candidate_id,assistant_candidate_id,original_row_json) VALUES(?,?,?)').run(candidateId,row.id,publicationJson(row));
      this.bumpAutomationStoreVersion();return this.getLoopPublicationCandidate(candidateId)!;
  }

  getLoopPublicationCandidate(candidateId:string):Readonly<StoredLoopPublicationCandidate>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_publication_candidates WHERE candidate_id=?').get(candidateId) as {candidate_id:string;run_id:string;stage_id:string|null;subject_key:string;revision:number;binding_json:string;binding_hash:string;source_vector_hash:string;publication_state:'captured';created_at:number}|undefined;
    if(!row)return undefined;const binding=parseLoopApplicationBinding(JSON.parse(row.binding_json));
    if(binding.candidateId!==row.candidate_id||binding.subject.runId!==row.run_id||binding.candidateRevision!==row.revision||(binding.subject.stage?.stageId??null)!==row.stage_id||publicationJson(binding.subject)!==row.subject_key||publicationJson(binding)!==row.binding_json||loopApplicationBindingHash(binding)!==row.binding_hash||row.publication_state!=='captured')throw Error('loop_publication_candidate_corrupt');
    return freezeLoopPublicationValue({candidateId:row.candidate_id,runId:row.run_id,stageId:row.stage_id,binding,bindingHash:row.binding_hash,sourceVectorHash:row.source_vector_hash,publicationState:row.publication_state,createdAt:row.created_at});
  }

  listLoopPublicationCandidates(runId:string):Readonly<StoredLoopPublicationCandidate>[] {
    return (this.db.prepare('SELECT candidate_id FROM loop_publication_candidates WHERE run_id=? ORDER BY candidate_id').all(runId) as {candidate_id:string}[]).map(row=>this.getLoopPublicationCandidate(row.candidate_id)!);
  }

  /** Historical read only. Current permission/configuration is checked by each
   * mutation, never inferred from this execution observation. */
  getLoopRunLifecycle(runId:string):Readonly<LoopRunLifecycle>|undefined {
    const run=this.getLoopRunRow(runId);if(!run)return undefined;
    const facts=this.readLoopPublicationResults(runId),terminalResultPresent=!!facts.result;
    let cachedProtectedSuccess=false;if(run.status==='success'){try{this.assertRawLoopSuccess(runId);}catch{cachedProtectedSuccess=true;}}
    return freezeLoopPublicationValue({runId,executionPhase:terminalResultPresent||run.status!=='running'?'execution_terminal':facts.executions.length?'awaiting_verification':'executing',
      businessState:cachedProtectedSuccess||terminalResultPresent&&run.status==='running'?'publication_pending':run.status,terminalResultPresent,
      executionStageIds:facts.executions.map(row=>row.stage_id),candidateIds:this.listLoopPublicationCandidates(runId).map(row=>row.candidateId)});
  }

  private assertLoopPublicationProducer(producer:object,forCapture=false):Readonly<LoopRunPublicationBasis> {
    const entry=this.publicationProducers.get(producer);if(!entry)throw Error('loop_publication_producer_required');
    const basis=this.assertLoopPublicationBasisCurrent(entry.runId);
    if(!forCapture&&this.loopProducerResult(entry.runId))throw Error('loop_publication_result_exists');
    if(publicationJson(basis)!==entry.basisJson)throw Error('loop_publication_producer_stale');return basis;
  }
  private assertLoopPublicationBasisCurrent(runId:string):Readonly<LoopRunPublicationBasis> {
    const basis=this.getLoopRunPublicationBasis(runId),actual=this.getLoopRunRow(runId),run=actual?this.normalizedLoopProjectionRows(runId).run:undefined;if(!basis||!run||run.status!=='running')throw Error('loop_publication_producer_stale');
    for(const key of ['id','loop_id','trigger_json','logical_run_key','started_at'] as const)if(publicationJson(run[key])!==publicationJson(basis.sourceRows.run[key]))throw Error('loop_publication_run_identity_changed');
    const definition=this.getLoopDefinitionRow(basis.loopId);
    if(!definition||definition.status!=='active'||definition.active_run_id!==basis.runId&&!this.loopProducerResult(runId)||publicationJson(this.getLoopPublicationConfiguration(basis.loopId))!==publicationJson(basis.configuration))throw Error('loop_publication_producer_stale');
    if(basis.sourceRows.template){const current=this.db.prepare('SELECT * FROM user_loop_templates WHERE loop_id=?').get(basis.loopId);if(publicationJson(current)!==publicationJson(basis.sourceRows.template))throw Error('loop_publication_producer_stale');}
    if(basis.sourceRows.assistantProfile){const current=this.db.prepare('SELECT * FROM assistant_profiles WHERE id=?').get(basis.sourceRows.assistantProfile.id);if(publicationJson(current)!==publicationJson(basis.sourceRows.assistantProfile))throw Error('loop_publication_producer_stale');}
    return basis;
  }
  private publicationStage(runId:string,stageId:string,kind?:LoopStageKind):LoopStageRow {
    const row=this.normalizedLoopProjectionRows(runId).stages.find(s=>s.id===stageId);
    const run=this.getLoopRunRow(runId);
    if(!run||!row||row.run_id!==runId||row.loop_id!==run.loop_id||kind&&row.stage_kind!==kind||!['running','success'].includes(row.status))throw Error('loop_publication_stage_binding');
    return row;
  }
  private assistantPublicationRows(runId:string):AssistantCandidateRow[] {
    return this.normalizedLoopProjectionRows(runId).members.filter(m=>m.status==='staged');
  }
  private assistantPublicationValue(row:AssistantCandidateRow){
    return {id:row.id,runId:row.run_id,kind:row.kind,title:row.title,content:row.content,scope:row.scope,projectId:row.project_id,confidence:row.confidence,evidenceRefs:JSON.parse(row.evidence_refs_json),dedupeKey:row.dedupe_key};
  }
  private loopProducerResult(runId:string):LoopProducerResultRow|undefined {
    const row=this.db.prepare('SELECT * FROM loop_producer_results WHERE run_id=?').get(runId) as LoopProducerResultRow|undefined;
    if(row&&(row.revision!==1||publicationHash(row.body_json)!==row.body_hash||publicationJson(JSON.parse(row.body_json))!==row.body_json))throw Error('loop_publication_result_corrupt');return row;
  }
  private loopStageExecutionResult(stageId:string):LoopStageExecutionResultRow|undefined {
    const row=this.db.prepare('SELECT * FROM loop_stage_execution_results WHERE stage_id=?').get(stageId) as LoopStageExecutionResultRow|undefined;
    if(row&&(row.revision!==1||publicationHash(row.body_json)!==row.body_hash||publicationJson(JSON.parse(row.body_json))!==row.body_json
      ||publicationHash(row.task_snapshot_json)!==row.task_snapshot_hash||publicationJson(JSON.parse(row.task_snapshot_json))!==row.task_snapshot_json))throw Error('loop_publication_execution_corrupt');
    return row;
  }
  private readLoopPublicationResults(runId:string):{result:LoopProducerResultRow|undefined;executions:LoopStageExecutionResultRow[]} {
    const result=this.loopProducerResult(runId),executions=(this.db.prepare('SELECT stage_id FROM loop_stage_execution_results WHERE run_id=? ORDER BY stage_id').all(runId) as {stage_id:string}[]).map(row=>this.loopStageExecutionResult(row.stage_id)!);
    if(!result&&!executions.length)return {result,executions};
    const basis=this.getLoopRunPublicationBasis(runId);if(!basis)throw Error('loop_publication_basis_missing');
    for(const execution of executions)this.assertExecutionResultCurrent(execution,basis,this.publicationStage(runId,execution.stage_id,'execute'));
    if(result){
      const stage=result.stage_id===null?null:this.publicationStage(runId,result.stage_id);
      const body=parseLoopCandidateBody(JSON.parse(result.body_json),{kind:'loop-run',loopId:basis.loopId,runId,stage:stage?{stageId:stage.id,stageKind:stage.stage_kind}:null},basis.contract);
      if(body.kind==='user-template-execute')throw Error('loop_publication_result_corrupt');
      if(body.kind==='user-template'){
        const execute=this.publicationStage(runId,body.executeStageId,'execute'),verify=this.publicationStage(runId,body.verifyStageId,'verify');
        if(!executions.some(row=>row.stage_id===execute.id)&&execute.status!=='success'||JSON.parse(execute.metadata_json).taskId!==body.taskId||JSON.parse(verify.metadata_json).taskId!==body.taskId)throw Error('loop_publication_task_binding_changed');
      }
      if(body.kind==='assistant-evening'&&publicationJson(this.assistantPublicationRows(runId).map(row=>this.assistantPublicationValue(row)))!==publicationJson(body.candidates))throw Error('loop_publication_candidate_set_changed');
    }
    return {result,executions};
  }
  private hasLoopPublicationResults(runId:string):boolean {
    const facts=this.readLoopPublicationResults(runId);return !!facts.result||facts.executions.length>0;
  }
  private assertExecutionSnapshot(snapshot:TaskSnapshot,stage:LoopStageRow,now:number,runStartedAt:number):void {
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.status!=='completed'
      ||typeof snapshot.taskId!=='string'||!snapshot.taskId||snapshot.taskId!==JSON.parse(stage.metadata_json).taskId
      ||typeof snapshot.sessionId!=='string'||!snapshot.sessionId||typeof snapshot.prompt!=='string'
      ||!Array.isArray(snapshot.materials)||!Array.isArray(snapshot.events))throw Error('loop_publication_execution_snapshot');
    if(!Number.isSafeInteger(now)||!Number.isSafeInteger(snapshot.createdAt)||!Number.isSafeInteger(snapshot.updatedAt)
      ||snapshot.createdAt<runStartedAt||snapshot.updatedAt<snapshot.createdAt||now<snapshot.updatedAt)throw Error('loop_publication_result_time');
  }
  private assertExecutionResultCurrent(result:LoopStageExecutionResultRow,basis:Readonly<LoopRunPublicationBasis>,stage:LoopStageRow):void {
    if(result.run_id!==basis.runId||result.stage_id!==stage.id||stage.stage_kind!=='execute')throw Error('loop_publication_execution_binding');
    const snapshot=JSON.parse(result.task_snapshot_json) as TaskSnapshot;
    this.assertExecutionSnapshot(snapshot,stage,result.terminal_at,basis.sourceRows.run.started_at);
    const body=parseLoopCandidateBody(JSON.parse(result.body_json),{kind:'loop-run',loopId:basis.loopId,runId:basis.runId,stage:{stageId:stage.id,stageKind:'execute'}},basis.contract);
    if(body.kind!=='user-template-execute'||body.taskId!==snapshot.taskId||publicationJson(body.evidenceIds)!==result.evidence_ids_json)throw Error('loop_publication_execution_binding');
  }
  private writeLoopProducerResult(basis:Readonly<LoopRunPublicationBasis>,rawBody:unknown,stageId:string|null,evidenceIds:string[],now:number):void {
    if(this.loopProducerResult(basis.runId))throw Error('loop_publication_result_exists');
    if(!Number.isSafeInteger(now)||now<basis.sourceRows.run.started_at)throw Error('loop_publication_result_time');
    const stage=stageId?this.publicationStage(basis.runId,stageId):null;
    const body=parseLoopCandidateBody(rawBody,{kind:'loop-run',loopId:basis.loopId,runId:basis.runId,stage:stage?{stageId:stage.id,stageKind:stage.stage_kind}:null},basis.contract),encoded=publicationJson(body);
    this.db.prepare('INSERT INTO loop_producer_results(run_id,revision,body_json,body_hash,stage_id,evidence_ids_json,terminal_at) VALUES(?,1,?,?,?,?,?)').run(basis.runId,encoded,publicationHash(encoded),stageId,publicationJson(evidenceIds),now);
    // Releasing this logical execution slot says nothing about physical guest
    // quiescence or business success. The original runtime still owns cleanup.
    this.clearActiveRun(basis.loopId,basis.runId,now);
    this.bumpAutomationStoreVersion();
  }

  saveLoopPublicationConfiguration(raw:{loopId:string;expectedRevision:number|null;configuration:unknown;requestSource:'user'|'agent'|'scheduler';now:number}):Readonly<StoredLoopPublicationConfiguration> {
    const input=JSON.parse(publicationJson(raw));
    if(Object.keys(input).sort().join(',')!=='configuration,expectedRevision,loopId,now,requestSource'||input.requestSource!=='user')throw Error('loop_publication_config_source');
    if(typeof input.loopId!=='string'||!input.loopId||!Number.isSafeInteger(input.now)||input.now<0||input.expectedRevision!==null&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1))throw Error('loop_publication_config_input');
    const configuration=parseLoopPublicationConfiguration(input.configuration);
    return this.transaction(()=>{
      const definition=this.getLoopDefinitionRow(input.loopId);if(!definition||definition.status==='deleted')throw Error('loop_publication_config_owner');
      this.assertPublicationConfigurationOwner(input.loopId,configuration.contract);
      const previous=this.getLoopPublicationConfiguration(input.loopId);
      if((previous?.revision??null)!==input.expectedRevision)throw Error('loop_publication_config_conflict');
      const revision=(previous?.revision??0)+1;if(!Number.isSafeInteger(revision)||input.now<(previous?.updatedAt??0))throw Error('loop_publication_config_revision');
      const next={loopId:input.loopId,revision,configuration,createdAt:previous?.createdAt??input.now,updatedAt:input.now};
      this.db.prepare('INSERT INTO loop_publication_configs(loop_id,revision,configuration_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(loop_id) DO UPDATE SET revision=excluded.revision,configuration_json=excluded.configuration_json,updated_at=excluded.updated_at').run(input.loopId,revision,publicationJson(configuration),next.createdAt,next.updatedAt);
      this.bumpAutomationStoreVersion();return freezeLoopPublicationValue(next);
    });
  }

  getLoopPublicationConfiguration(loopId:string):Readonly<StoredLoopPublicationConfiguration>|undefined {
    const row=this.db.prepare('SELECT * FROM loop_publication_configs WHERE loop_id=?').get(loopId) as {loop_id:string;revision:number;configuration_json:string;created_at:number;updated_at:number}|undefined;
    if(!row)return undefined;
    if(!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.created_at)||!Number.isSafeInteger(row.updated_at)||row.created_at<0||row.updated_at<row.created_at)throw Error('loop_publication_config_corrupt');
    const configuration=parseLoopPublicationConfiguration(JSON.parse(row.configuration_json));if(publicationJson(configuration)!==row.configuration_json)throw Error('loop_publication_config_corrupt');
    return freezeLoopPublicationValue({loopId:row.loop_id,revision:row.revision,configuration,createdAt:row.created_at,updatedAt:row.updated_at});
  }

  getLoopRunPublicationBasis(runId:string):Readonly<LoopRunPublicationBasis>|undefined {
    const row=this.db.prepare('SELECT basis_json,basis_hash FROM loop_run_publication_basis WHERE run_id=?').get(runId) as {basis_json:string;basis_hash:string}|undefined;
    if(!row)return undefined;
    if(publicationHash(row.basis_json)!==row.basis_hash)throw Error('loop_publication_basis_corrupt');
    const basis=JSON.parse(row.basis_json) as LoopRunPublicationBasis;
    if(basis.version!==1||basis.runId!==runId||basis.sourceRows.run.id!==runId||basis.loopId!==basis.sourceRows.run.loop_id||publicationJson(basis)!==row.basis_json)throw Error('loop_publication_basis_corrupt');
    parseLoopPublicationConfiguration(basis.configuration.configuration);parseLoopBusinessContract(basis.contract);
    return freezeLoopPublicationValue(basis);
  }

  private assertPublicationConfigurationOwner(loopId:string,contract:Readonly<StoredLoopPublicationConfiguration>['configuration']['contract']):void {
    const definition=this.getLoopDefinitionRow(loopId);
    if(!definition||definition.status==='deleted')throw Error('loop_publication_config_owner');
    if(contract.kind==='builtin-diagnostic'&&definition.origin==='built_in'&&contract.scanner===loopId)return;
    if(contract.kind==='assistant'&&definition.origin==='built_in'&&loopId===(contract.assistantKind==='evening'?ASSISTANT_EVENING_LOOP_ID:ASSISTANT_MORNING_LOOP_ID))return;
    if(contract.kind==='user-template'&&definition.origin==='user_template'&&this.getUserLoopTemplate(loopId))return;
    throw Error('loop_publication_config_owner');
  }

  private captureRunPublicationBasis(runId:string,source:unknown):void {
    const run=this.getLoopRunRow(runId)!;const configuration=this.getLoopPublicationConfiguration(run.loop_id);if(!configuration)return;
    if(!['user','agent','scheduler'].includes(source as string))throw Error('loop_publication_basis_source');
    const definition=this.getLoopDefinitionRow(run.loop_id)!;this.assertPublicationConfigurationOwner(run.loop_id,configuration.configuration.contract);
    const c=configuration.configuration.contract;
    const template=c.kind==='user-template'?this.db.prepare('SELECT * FROM user_loop_templates WHERE loop_id=?').get(run.loop_id) as unknown as UserLoopTemplateRow:null;
    const assistantProfile=c.kind==='assistant'?this.db.prepare('SELECT * FROM assistant_profiles WHERE id=?').get('default-personal-assistant') as unknown as AssistantProfileRow:null;
    let business:unknown;
    if(c.kind==='builtin-diagnostic')business={version:1,...c};
    else if(c.kind==='user-template'){
      if(!template||!template.contract_json)throw Error('loop_publication_basis_template');
      business={version:1,kind:c.kind,templateKind:template.kind,prompt:template.prompt,outputDirectory:template.output_directory,outputFileName:template.output_file_name,loopContract:JSON.parse(template.contract_json)};
    }else{
      if(!assistantProfile||assistantProfile.status!=='active')throw Error('loop_publication_basis_profile');
      business={version:1,...c,profileId:assistantProfile.id,locale:assistantProfile.locale,timeZone:assistantProfile.time_zone,dataScopes:JSON.parse(assistantProfile.data_scopes_json)};
    }
    const basis:LoopRunPublicationBasis={version:1,runId,loopId:run.loop_id,requestSource:source as LoopRunPublicationBasis['requestSource'],originalTriggerJson:publicationJson(JSON.parse(run.trigger_json)),logicalRunKey:run.logical_run_key,configuration,contract:parseLoopBusinessContract(business),sourceRows:{run,definition,template,assistantProfile}};
    const encoded=publicationJson(basis);if(Buffer.byteLength(encoded)>1024*1024)throw Error('loop_publication_basis_limit');
    this.db.prepare('INSERT INTO loop_run_publication_basis(run_id,basis_json,basis_hash) VALUES(?,?,?)').run(runId,encoded,publicationHash(encoded));
  }

  getAutomationStoreVersion(): number {
    const row = this.db.prepare(`
      select value from automation_store_metadata where key = 'version'
    `).get() as AutomationStoreMetadataRow | undefined;
    return row?.value ?? 0;
  }

  ensureBuiltInLoops(now: number): LoopDefinition[] {
    this.transaction(() => {
      for (const loop of BUILT_IN_LOOPS) {
        this.db.prepare(`
          insert into loop_definitions (
            id, title, description, status, origin, active_run_id, created_at, updated_at
          ) values (
            @id, @title, @description, @status, 'built_in', null, @createdAt, @updatedAt
          )
          on conflict(id) do update set
            title = excluded.title,
            description = excluded.description,
            origin = 'built_in',
            updated_at = case
              when loop_definitions.title != excluded.title
                or loop_definitions.description != excluded.description
                or loop_definitions.origin != 'built_in'
              then excluded.updated_at
              else loop_definitions.updated_at
            end
        `).run({
          id: loop.id,
          title: loop.title,
          description: loop.description,
          status: loop.status,
          createdAt: now,
          updatedAt: now,
        });
      }
      this.bumpAutomationStoreVersion();
    });

    return BUILT_IN_LOOPS
      .map(loop => this.getLoopDefinition(loop.id))
      .filter((loop): loop is LoopDefinition => loop !== undefined);
  }

  createUserLoopTemplate(input: CreateUserLoopTemplateInput): CreateUserLoopTemplateResult {
    validateUserLoopTemplateInput(input);
    const ignoredLegacyScheduleFields = legacyScheduleFieldsIn(input);
    const outputDirectory = input.kind === 'task_completion' ? '' : input.outputDirectory;
    const outputFileName = input.kind === 'task_completion' ? '' : input.outputFileName;
    const contract = createDefaultLoopContract(input);
    return this.transaction(() => {
      this.db.prepare(`
        insert into loop_definitions (
          id, title, description, status, origin, active_run_id, deleted_at, delete_reason, created_at, updated_at
        ) values (
          @id, @title, @description, 'active', 'user_template', null, null, null, @createdAt, @updatedAt
        )
      `).run({
        id: input.loopId,
        title: input.title,
        description: input.description ?? '',
        createdAt: input.now,
        updatedAt: input.now,
      });

      this.db.prepare(`
        insert into user_loop_templates (
          loop_id, kind, prompt, output_directory, output_file_name,
          schedule_action_id, schedule_enabled, schedule_trigger_json, auto_run_approved,
          contract_json, contract_schema_version,
          created_at, updated_at
        ) values (
          @loopId, @kind, @prompt, @outputDirectory, @outputFileName,
          null, 0, null, 0,
          @contractJson, @contractSchemaVersion,
          @createdAt, @updatedAt
        )
      `).run({
        loopId: input.loopId,
        kind: input.kind,
        prompt: input.prompt,
        outputDirectory,
        outputFileName,
        contractJson: JSON.stringify(contract),
        contractSchemaVersion: contract.schemaVersion,
        createdAt: input.now,
        updatedAt: input.now,
      });

      const template = this.getUserLoopTemplate(input.loopId);
      if (!template) {
        throw new Error('User loop template insert did not persist a record.');
      }
      this.bumpAutomationStoreVersion();
      return { template, ignoredLegacyScheduleFields };
    });
  }

  getUserLoopTemplate(loopId: string): UserLoopTemplate | undefined {
    const row = this.db.prepare('select * from user_loop_templates where loop_id = ?').get(loopId) as UserLoopTemplateRow | undefined;
    return row ? this.userLoopTemplateRowToRecord(row) : undefined;
  }

  listUserLoopTemplates(): UserLoopTemplate[] {
    const rows = typedRows<UserLoopTemplateRow>(this.db.prepare(`
      select * from user_loop_templates
      order by created_at asc, loop_id asc
    `).all());
    return rows.map(row => this.userLoopTemplateRowToRecord(row));
  }

  getLoopDefinition(loopId: string): LoopDefinition | undefined {
    const row = this.db.prepare('select * from loop_definitions where id = ?').get(loopId) as LoopDefinitionRow | undefined;
    return row ? this.definitionRowToRecord(row) : undefined;
  }

  listLoopDefinitions(): LoopDefinition[] {
    const rows = typedRows<LoopDefinitionRow>(this.db.prepare(`
      select * from loop_definitions
      order by id asc
    `).all());
    return rows.map(row => this.definitionRowToRecord(row));
  }

  setLoopStatus(loopId: string, status: LoopDefinitionStatus, now: number, deleteReason?: string): LoopDefinition | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update loop_definitions
        set status = @status,
            updated_at = @updatedAt,
            deleted_at = case when @status = 'deleted' then @updatedAt else null end,
            delete_reason = case when @status = 'deleted' then @deleteReason else null end
        where id = @loopId
      `).run({
        status,
        updatedAt: now,
        deleteReason: status === 'deleted' ? deleteReason ?? 'deleted' : null,
        loopId,
      });
      if (result.changes === 0) return undefined;
      this.bumpAutomationStoreVersion();
      return this.getLoopDefinition(loopId);
    });
  }

  updateUserLoopTemplate(loopId: string, patch: { title?: string; description?: string; prompt?: string; outputDirectory?: string; outputFileName?: string }): UserLoopTemplate | undefined {
    return this.transaction(() => {
      const now = Date.now();
      const currentTemplate = this.getUserLoopTemplate(loopId);
      if (!currentTemplate) return undefined;
      if (patch.title !== undefined || patch.description !== undefined) {
        const sets: string[] = ['updated_at = @now'];
        const params: Record<string, unknown> = { loopId, now };
        if (patch.title !== undefined) { sets.push('title = @title'); params.title = patch.title; }
        if (patch.description !== undefined) { sets.push('description = @description'); params.description = patch.description; }
        this.db.prepare(`update loop_definitions set ${sets.join(', ')} where id = @loopId`).run(params as any);
      }
      const tplSets: string[] = ['updated_at = @now'];
      const tplParams: Record<string, unknown> = { loopId, now };
      if (patch.prompt !== undefined) { tplSets.push('prompt = @prompt'); tplParams.prompt = patch.prompt; }
      if (patch.outputDirectory !== undefined) { tplSets.push('output_directory = @outputDirectory'); tplParams.outputDirectory = patch.outputDirectory; }
      if (patch.outputFileName !== undefined) { tplSets.push('output_file_name = @outputFileName'); tplParams.outputFileName = patch.outputFileName; }
      if (patch.prompt !== undefined || patch.outputDirectory !== undefined || patch.outputFileName !== undefined) {
        const nextPrompt = patch.prompt ?? currentTemplate.prompt;
        const nextOutputDirectory = patch.outputDirectory ?? currentTemplate.outputDirectory;
        const nextOutputFileName = patch.outputFileName ?? currentTemplate.outputFileName;
        const nextContract = createDefaultLoopContract(currentTemplate.kind === 'task_completion'
          ? {
              kind: 'task_completion',
              loopId,
              title: loopId,
              prompt: nextPrompt,
              now,
            }
          : {
              kind: 'markdown_file',
              loopId,
              title: loopId,
              prompt: nextPrompt,
              outputDirectory: nextOutputDirectory,
              outputFileName: nextOutputFileName,
              now,
            });
        tplSets.push('contract_json = @contractJson', 'contract_schema_version = @contractSchemaVersion');
        tplParams.contractJson = JSON.stringify(nextContract);
        tplParams.contractSchemaVersion = nextContract.schemaVersion;
      }
      if (tplSets.length > 1) {
        this.db.prepare(`update user_loop_templates set ${tplSets.join(', ')} where loop_id = @loopId`).run(tplParams as any);
      }
      this.bumpAutomationStoreVersion();
      return this.getUserLoopTemplate(loopId);
    });
  }

  deleteUserLoopTemplate(loopId: string): void {
    this.transaction(() => {
      const now = Date.now();
      this.db.prepare("delete from user_loop_templates where loop_id = ?").run(loopId);
      this.db.prepare("update loop_definitions set status = 'deleted', deleted_at = @now, delete_reason = 'user_deleted', updated_at = @now where id = @loopId").run({ loopId, now });
      this.bumpAutomationStoreVersion();
    });
  }

  clearLoopRunHistory(loopId: string, statuses?: string[]): number {
    return this.transaction(() => {
      let runIds: string[];
      if (statuses && statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        const rows = this.db.prepare(`select id from loop_runs where loop_id = ? and status in (${placeholders})`).all(loopId, ...statuses) as Array<{ id: string }>;
        runIds = rows.map(r => r.id);
      } else {
        const rows = this.db.prepare('select id from loop_runs where loop_id = ?').all(loopId) as Array<{ id: string }>;
        runIds = rows.map(r => r.id);
      }
      if (runIds.length === 0) return 0;
      if (
        loopId === ASSISTANT_EVENING_LOOP_ID || loopId === ASSISTANT_MORNING_LOOP_ID ||
        this.db.prepare(`select count(*) as count from assistant_candidates where run_id in (${runIds.map(() => '?').join(',')})`).get(...runIds) as { count: number }
      ) {
        const protectedCandidate = this.db.prepare(`select 1 as value from assistant_candidates where run_id in (${runIds.map(() => '?').join(',')}) limit 1`).get(...runIds) as { value: number } | undefined;
        if (loopId === ASSISTANT_EVENING_LOOP_ID || loopId === ASSISTANT_MORNING_LOOP_ID || protectedCandidate) {
          throw new Error('protected_history');
        }
      }
      const idPlaceholders = runIds.map(() => '?').join(',');
      this.db.prepare(`delete from loop_stages where run_id in (${idPlaceholders})`).run(...runIds);
      const result = this.db.prepare(`delete from loop_runs where id in (${idPlaceholders})`).run(...runIds);
      this.bumpAutomationStoreVersion();
      return Number(result.changes ?? runIds.length);
    });
  }

  beginLoopRun(loopId: string, trigger: LoopRunTrigger, now: number, staleAfterMs: number, context?: {requestSource:'user'|'agent'|'scheduler'}): BeginLoopRunResult {
    // Capture host provenance before any caller trigger serialization or getters.
    // Trigger fields cannot alter the independent source used for the new basis.
    const sourceContext=context===undefined?undefined:JSON.parse(publicationJson(context));
    if(sourceContext!==undefined&&(Object.keys(sourceContext).join(',')!=='requestSource'||!['user','agent','scheduler'].includes(sourceContext.requestSource)))throw Error('loop_publication_basis_source');
    return this.transaction(() => {
      const definitionRow = this.getLoopDefinitionRow(loopId);
      if (!definitionRow) return { status: 'skipped', reason: 'missing_loop' };
      if (definitionRow.status === 'deleted') return { status: 'skipped', reason: 'deleted_loop' };
      if (definitionRow.status === 'paused') return { status: 'skipped', reason: 'paused' };

      const actualTrigger=this.getLoopPublicationConfiguration(loopId)?captureLoopProducerValue(trigger):trigger;
      const logicalRunKey = typeof actualTrigger.logicalRunKey === 'string' && actualTrigger.logicalRunKey.trim() ? actualTrigger.logicalRunKey.trim() : undefined;
      if (logicalRunKey) {
        const pending=this.db.prepare(`SELECT r.id FROM loop_runs r WHERE r.loop_id=? AND r.logical_run_key=? AND r.status='running'
          AND (EXISTS(SELECT 1 FROM loop_producer_results p WHERE p.run_id=r.id) OR EXISTS(SELECT 1 FROM loop_stage_execution_results e WHERE e.run_id=r.id))`).all(loopId,logicalRunKey) as {id:string}[];
        if(pending.length>1)throw Error('loop_publication_logical_key_conflict');
        if(pending.length){this.readLoopPublicationResults(pending[0]!.id);return {status:'already_running',activeRunId:pending[0]!.id};}
        const completed = this.db.prepare(`
          select id from loop_runs where loop_id = ? and logical_run_key = ? and status = 'success' order by started_at desc limit 1
        `).get(loopId, logicalRunKey) as { id: string } | undefined;
        if (completed) return { status: 'already_completed', completedRunId: completed.id };
      }

      if (definitionRow.active_run_id) {
        const activeRun = this.getLoopRunRow(definitionRow.active_run_id);
        if (!activeRun || TERMINAL_STATUSES.has(activeRun.status)) {
          this.clearActiveRun(loopId, definitionRow.active_run_id, now);
        } else if (this.isStaleRun(activeRun, now, staleAfterMs)) {
          this.markRunExecutorCrash(activeRun, now);
          this.clearActiveRun(loopId, activeRun.id, now);
        } else {
          return { status: 'already_running', activeRunId: definitionRow.active_run_id };
        }
      }

      const runId = randomUUID();
      const triggerJson = JSON.stringify(actualTrigger);
      const evidenceIdsJson = JSON.stringify([]);
      this.db.prepare(`
        insert into loop_runs (
          id, loop_id, status, trigger_json, logical_run_key, evidence_ids_json, started_at, finished_at,
          updated_at, failure_kind, message, summary, next_action_kind, next_action_summary
        ) values (
          @id, @loopId, 'running', @triggerJson, @logicalRunKey, @evidenceIdsJson, @startedAt, null,
          @updatedAt, null, null, null, null, null
        )
      `).run({
        id: runId,
        loopId,
        triggerJson,
        logicalRunKey: logicalRunKey ?? null,
        evidenceIdsJson,
        startedAt: now,
        updatedAt: now,
      });

      this.db.prepare(`
        update loop_definitions
        set active_run_id = ?, updated_at = ?
        where id = ?
      `).run(runId, now, loopId);

      this.captureRunPublicationBasis(runId,sourceContext?.requestSource);
      const run = this.getLoopRun(runId);
      if (!run) {
        throw new Error('Loop run insert did not persist a record.');
      }
      this.bumpAutomationStoreVersion();
      if(this.getLoopRunPublicationBasis(runId))this.publicationBegins.set(run,{runId,runJson:publicationJson(captureLoopProducerValue(run))});
      return { status: 'started', run };
    });
  }

  finishLoopRunSuccess(runId: string, evidenceIds: string[], now: number, summary: string): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'success',
      evidenceIds,
      now,
      summary,
    });
  }

  finishAssistantLoopRunSuccess(runId: string, evidenceIds: string[], now: number, summary: string): LoopRun | undefined {
    return this.transaction(() => {
      const current = this.getLoopRunRow(runId);
      if (!current || current.status !== 'running') return current ? this.runRowToRecord(current) : undefined;
      if(this.hasLoopPublicationResults(runId)||this.hasUnknownLoopTask(runId))return this.runRowToRecord(current);
      this.assertRawLoopSuccess(current.id);
      const updated = this.db.prepare(`
        update loop_runs set status = 'success', evidence_ids_json = ?, finished_at = ?, updated_at = ?, summary = ?
        where id = ? and status = 'running'
      `).run(JSON.stringify(evidenceIds), now, now, summary, runId);
      if (updated.changes === 1) {
        this.db.prepare(`update assistant_candidates set status = 'pending' where run_id = ? and status = 'staged'`).run(runId);
        this.finishOpenStagesForTerminalRun(current.loop_id, runId, { status: 'success' }, current.status, now);
        this.clearActiveRun(current.loop_id, runId, now);
        this.bumpAutomationStoreVersion();
      }
      return this.getLoopRun(runId);
    });
  }

  ensureAssistantProfile(profile: AssistantProfile): AssistantProfile {
    return this.transaction(() => {
      this.db.prepare(`
        insert into assistant_profiles (id, status, locale, time_zone, evening_time, morning_time, workdays_json, quiet_hours_json, data_scopes_json, created_at, updated_at)
        values (@id, @status, @locale, @timeZone, @eveningTime, @morningTime, @workdaysJson, @quietHoursJson, @dataScopesJson, @createdAt, @updatedAt)
        on conflict(id) do nothing
      `).run({
        id: profile.id,
        status: profile.status,
        locale: profile.locale,
        timeZone: profile.timeZone,
        eveningTime: profile.eveningTime,
        morningTime: profile.morningTime,
        workdaysJson: JSON.stringify(profile.workdays),
        quietHoursJson: JSON.stringify(profile.quietHours),
        dataScopesJson: JSON.stringify(profile.dataScopes),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      });
      return this.getAssistantProfile(profile.id)!;
    });
  }

  getAssistantProfile(id: AssistantProfile['id']): AssistantProfile | undefined {
    const row = this.db.prepare('select * from assistant_profiles where id = ?').get(id) as AssistantProfileRow | undefined;
    return row ? this.assistantProfileRowToRecord(row) : undefined;
  }

  setAssistantProfileStatus(id: AssistantProfile['id'], status: AssistantProfile['status'], now: number): AssistantProfile | undefined {
    return this.transaction(() => {
      this.db.prepare('update assistant_profiles set status = ?, updated_at = ? where id = ?').run(status, now, id);
      return this.getAssistantProfile(id);
    });
  }

  stageAssistantCandidates(runId: string, inputs: CreateAssistantCandidateInput[], now: number): AssistantCandidate[] {
    return this.transaction(()=>this.stageAssistantCandidatesInTransaction(runId,inputs,now));
  }
  private stageAssistantCandidatesInTransaction(runId: string, inputs: CreateAssistantCandidateInput[], now: number): AssistantCandidate[] {
      const run = this.getLoopRunRow(runId);
      if (!run || run.status !== 'running') throw new Error('Assistant candidates require a running loop run.');
      return inputs.map(input => {
        if (input.evidenceRefs.length === 0 || input.confidence < 0 || input.confidence > 1 || (input.scope === 'project' && !input.projectId)) {
          throw new Error('Invalid assistant candidate.');
        }
        const id = randomUUID();
        this.db.prepare(`
          insert into assistant_candidates (id, run_id, kind, title, content, scope, project_id, confidence, evidence_refs_json, dedupe_key, status, target_kind, target_id, accepted_target_ref, created_at, decided_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', null, null, null, ?, null)
        `).run(id, runId, input.kind, input.title, input.content, input.scope, input.projectId ?? null, input.confidence, JSON.stringify(input.evidenceRefs), input.dedupeKey, now);
        return this.getAssistantCandidate(id)!;
      });

  }

  getAssistantCandidate(id: string): AssistantCandidate | undefined {
    const row = this.db.prepare('select * from assistant_candidates where id = ?').get(id) as AssistantCandidateRow | undefined;
    return row ? this.assistantCandidateRowToRecord(row) : undefined;
  }

  listAssistantCandidates(input: { statuses?: AssistantCandidateStatus[] } = {}): AssistantCandidate[] {
    const statuses = input.statuses;
    const rows = statuses?.length
      ? typedRows<AssistantCandidateRow>(this.db.prepare(`select * from assistant_candidates where status in (${statuses.map(() => '?').join(',')}) order by created_at asc`).all(...statuses))
      : typedRows<AssistantCandidateRow>(this.db.prepare('select * from assistant_candidates order by created_at asc').all());
    return rows.map(row => this.assistantCandidateRowToRecord(row));
  }

  private assistantPromotionHistory(rows:LoopProjectionRows,allowLegacy=false):Readonly<AssistantPromotionIntent>[] {
    const ids=this.db.prepare('SELECT i.candidate_id FROM assistant_promotion_intents i JOIN assistant_candidates c ON c.id=i.candidate_id WHERE c.run_id=? ORDER BY i.candidate_id COLLATE BINARY').all(rows.run.id) as unknown as {candidate_id:string}[];
    const intents=ids.map(row=>this.getAssistantPromotionIntent(row.candidate_id)!);
    for(const member of rows.members){const intent=intents.find(i=>i.candidateId===member.id);if(!allowLegacy&&['accepting','accepted'].includes(member.status)&&!intent)throw Error('assistant_promotion_intent_missing');if(intent&&member.status!==intent.state)throw Error('assistant_promotion_intent_state');}
    return intents;
  }
  getAssistantCandidatePublicationMode(candidateId:string):'ordinary'|'protected' {
    const candidate=this.getAssistantCandidate(candidateId);if(!candidate)throw Error('assistant_candidate_not_found');
    const route=readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:candidate.runId}));
    if(!route||route.kind==='unavailable')throw Error('assistant_publication_unavailable');
    return this.getLoopRunPublicationBasis(candidate.runId)||route.kind!=='ordinary'?'protected':'ordinary';
  }
  /** Factual ordinary snapshot. Only the fixed host can turn it into a write ticket. */
  getOrdinaryAssistantPromotionTarget(candidateId:string){return this.transaction(()=>this.ordinaryAssistantPromotionTarget(candidateId));}
  private ordinaryAssistantPromotionTarget(candidateId:string){
    const member=this.getAssistantCandidate(candidateId);if(!member)throw Error('assistant_candidate_not_found');
    if(this.getAssistantCandidatePublicationMode(candidateId)!=='ordinary')throw Error('assistant_promotion_changed');
    const rows=this.rawLoopProjectionRows(member.runId),route=readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:member.runId}));
    if(route.kind!=='ordinary'||rows.run.status!=='success'||this.getLoopBusinessProjection(member.runId))throw Error('assistant_promotion_changed');
    const promotionIntents=this.assistantPromotionHistory(rows,true);
    return freezeProjection({runId:member.runId,rows,vector:publicationJson({rows,promotionIntents,route})});
  }
  getAssistantPromotionIntent(candidateId:string):Readonly<AssistantPromotionIntent>|undefined {
    const row=this.db.prepare('SELECT * FROM assistant_promotion_intents WHERE candidate_id=?').get(candidateId) as {candidate_id:string;revision:number;record_json:string}|undefined;
    if(!row)return undefined;const value=parseAssistantPromotionIntent(JSON.parse(row.record_json));
    if(value.candidateId!==row.candidate_id||value.revision!==row.revision||publicationJson(value)!==row.record_json)throw Error('assistant_promotion_corrupt');
    const member=this.getAssistantCandidate(candidateId),t=value.target;
    const stable=member?`assistant-${member.kind==='memory'?'memory':member.kind==='knowledge'?'source':'follow-up'}:${member.id}`:undefined;
    if(t.targetId!==stable||member?.decidedAt!==value.updatedAt||(member?.kind==='knowledge'&&!t.collectionId)||(member?.kind==='memory'&&member.scope==='project'&&(!t.projectId||!t.projectCwd)))throw Error('assistant_promotion_target');
    if(!member||member.runId!==value.runId||member.title!==t.title||member.content!==t.content||member.scope!==t.scope||member.projectId!==t.projectId||publicationJson(member.evidenceRefs)!==publicationJson(t.provenance.evidenceRefs)||member.targetId!==t.targetId||member.targetKind!==member.kind||member.status!==value.state||(value.state==='accepted'&&member.acceptedTargetRef!==value.targetRef))throw Error('assistant_promotion_changed');
    return value;
  }
  applyAssistantPromotionWrite(token:object):Readonly<AssistantPromotionIntent>{
    const entry=consumeAssistantPromotionWrite(this,token);
    return this.transaction(()=>{
      const readTarget=()=>entry.mode==='ordinary'?this.ordinaryAssistantPromotionTarget(entry.member.id):this.loopBusinessProjectionTarget(entry.target.runId);
      entry.check();const before=readTarget();
      if(before.vector!==entry.target.vector||JSON.stringify(this.getAssistantCandidate(entry.member.id))!==JSON.stringify(entry.member)||publicationJson(this.getAssistantPromotionIntent(entry.member.id)??null)!==publicationJson(entry.before??null))throw Error('assistant_promotion_conflict');
      const after=parseAssistantPromotionIntent(entry.after),member=this.getAssistantCandidate(entry.member.id)!;
      if(!Number.isSafeInteger(after.updatedAt)||after.updatedAt<member.createdAt||after.candidateId!==member.id||after.runId!==member.runId)throw Error('assistant_promotion_time');
      if(!entry.before){
        if(entry.source!=='user'||after.state!=='accepting'||after.revision!==1||!['pending','accept_failed'].includes(member.status))throw Error('assistant_promotion_transition');
        if(this.db.prepare('INSERT INTO assistant_promotion_intents(candidate_id,revision,record_json) VALUES(?,?,?)').run(member.id,after.revision,publicationJson(after)).changes!==1)throw Error('assistant_promotion_write');
      }else{
        if(after.state!=='accepted'||entry.before.state!=='accepting'||after.revision!==entry.before.revision+1||publicationJson(after.target)!==publicationJson(entry.before.target))throw Error('assistant_promotion_transition');
        if(this.db.prepare('UPDATE assistant_promotion_intents SET revision=?,record_json=? WHERE candidate_id=? AND revision=? AND record_json=?').run(after.revision,publicationJson(after),member.id,entry.before.revision,publicationJson(entry.before)).changes!==1)throw Error('assistant_promotion_write');
      }
      if(this.db.prepare('UPDATE assistant_candidates SET status=?,target_kind=?,target_id=?,accepted_target_ref=?,decided_at=? WHERE id=?').run(after.state,member.kind,after.target.targetId,after.targetRef,after.updatedAt,member.id).changes!==1)throw Error('assistant_promotion_write');
      this.bumpAutomationStoreVersion();
      entry.check();
      entry.signal.throwIfAborted();
      const actual=this.getAssistantPromotionIntent(member.id);if(publicationJson(actual)!==publicationJson(after))throw Error('assistant_promotion_write');
      const expected=JSON.parse(before.vector);expected.promotionIntents=[...expected.promotionIntents.filter((i:AssistantPromotionIntent)=>i.candidateId!==member.id),after].sort((a:AssistantPromotionIntent,b:AssistantPromotionIntent)=>a.candidateId<b.candidateId?-1:a.candidateId>b.candidateId?1:0);expected.rows.members=expected.rows.members.map((row:AssistantCandidateRow)=>row.id===member.id?{...row,status:after.state,target_kind:member.kind,target_id:after.target.targetId,accepted_target_ref:after.targetRef,decided_at:after.updatedAt}:row);
      if(readTarget().vector!==publicationJson(expected))throw Error('assistant_promotion_changed');
      entry.signal.throwIfAborted();return actual!;
    });
  }

  beginAssistantCandidateAccept(candidateId:string,targetKind:NonNullable<AssistantCandidate['targetKind']>,targetId:string,now:number):AssistantCandidate|undefined {throw Error('assistant_promotion_ticket');}
  markAssistantCandidateAccepted(candidateId:string,targetRef:string,now:number):AssistantCandidate|undefined {throw Error('assistant_promotion_ticket');}
  markAssistantCandidateAcceptFailed(candidateId:string,now:number):AssistantCandidate|undefined {throw Error('assistant_promotion_ticket');}

  rejectAssistantCandidate(candidateId: string, now: number,requestSource?:'user'|'agent'|'scheduler'): AssistantCandidate | undefined {
    const mode=this.getAssistantCandidatePublicationMode(candidateId);
    if(requestSource!=='user'&&(mode==='protected'||requestSource!==undefined))throw Error('assistant_candidate_user_only');
    return this.transaction(() => {
      const before=this.getAssistantCandidate(candidateId),intent=this.getAssistantPromotionIntent(candidateId);
      if(mode==='protected'&&intent)throw Error('assistant_candidate_reject_conflict');

      this.db.prepare(`
        update assistant_candidates set status = 'rejected', decided_at = ?
        where id = ? and status in ('pending', 'accept_failed')
      `).run(now, candidateId);
      this.bumpAutomationStoreVersion();
      const actual=this.getAssistantCandidate(candidateId),afterIntent=this.getAssistantPromotionIntent(candidateId);
      const expected=before&&['pending','accept_failed'].includes(before.status)?{...before,status:'rejected',decidedAt:now}:before;
      if(JSON.stringify(actual)!==JSON.stringify(expected)||publicationJson(afterIntent??null)!==publicationJson(intent??null))throw Error('assistant_candidate_reject_conflict');
      return actual;
    });
  }

  finishLoopRunFailure(
    runId: string,
    failureKind: LoopRunFailureKind,
    message: string,
    evidenceIds: string[],
    now: number
  ): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'failed',
      evidenceIds,
      now,
      failureKind,
      message,
    });
  }

  finishLoopRunBlocked(
    runId: string,
    evidenceIds: string[],
    nextActionKind: string,
    nextActionSummary: string,
    now: number
  ): LoopRun | undefined {
    return this.finishLoopRun(runId, {
      status: 'blocked',
      evidenceIds,
      now,
      nextActionKind,
      nextActionSummary,
    });
  }

  recoverStaleRuns(now: number, staleAfterMs: number): RecoverStaleRunsResult {
    const failedRunIds: string[] = [];
    try {
      const recovered = this.transaction(() => {
        const rows = typedRows<LoopRunRow>(this.db.prepare(`
          select * from loop_runs
          where status = 'running'
            and updated_at <= ?
          order by started_at asc
        `).all(now - staleAfterMs)).filter(row=>this.isStaleRun(row,now,staleAfterMs));

        for (const row of rows) {
          this.markRunExecutorCrash(row, now);
          this.clearActiveRun(row.loop_id, row.id, now);
          failedRunIds.push(row.id);
        }

        if (rows.length > 0) {
          this.bumpAutomationStoreVersion();
        }
        return rows.length;
      });
      return { ok: true, recovered, failedRunIds };
    } catch (error) {
      return {
        ok: false,
        recovered: 0,
        failedRunIds: [],
        error: (error as Error).message || String(error),
        partial: false,
      };
    }
  }

  touchLoopRun(runId: string, now: number): LoopRun | undefined {
    return this.transaction(() => {
      const result = this.db.prepare(`
        update loop_runs
        set updated_at = ?
        where id = ? and status = 'running'
      `).run(now, runId);
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
      return this.getLoopRun(runId);
    });
  }

  listLoopRuns(loopId: string, limit: number): LoopRun[] {
    const rows = typedRows<LoopRunRow>(this.db.prepare(`
      select * from loop_runs
      where loop_id = ?
      order by started_at desc, id desc
      limit ?
    `).all(loopId, Math.max(0, limit)));
    return rows.map(row => this.runRowToRecord(row));
  }

  getLoopRun(runId: string): LoopRun | undefined {
    const row = this.getLoopRunRow(runId);
    return row ? this.runRowToRecord(row) : undefined;
  }

  findLoopRunsByTimedActionRunId(timedActionRunId: string): LoopRun[] {
    const needle = timedActionRunId.trim();
    if (!needle) return [];
    const rows = typedRows<LoopRunRow>(this.db.prepare(`
      select * from loop_runs
      where trigger_json like ?
      order by started_at desc, id desc
    `).all('%"timedActionRunId"%'));
    return rows.map(row=>this.runRowToRecord(row)).filter(run=>run.trigger.timedActionRunId===needle);
  }

  findLoopRunByTimedActionRunId(timedActionRunId:string):LoopRun|undefined {
    const runs=this.findLoopRunsByTimedActionRunId(timedActionRunId);if(runs.length>1)throw Error('loop_timed_multiple_runs');return runs[0];
  }

  startLoopStage(
    runId: string,
    loopId: string,
    stageKind: LoopStageKind,
    now: number,
    metadata: Record<string, unknown> = {}
  ): LoopStage {
    return this.transaction(() => {
      if (!LOOP_STAGE_KINDS.has(stageKind)) throw new Error('Unsupported loop stage kind.');
      const run = this.getLoopRunRow(runId);
      if (!run) throw new Error('Loop run does not exist.');
      if (run.loop_id !== loopId) throw new Error('Loop stage loopId does not match the run loopId.');
      if (run.status !== 'running') throw new Error('Loop stage can only start for a running loop run.');

      const stageId = randomUUID();
      this.db.prepare(`
        insert into loop_stages (
          id, run_id, loop_id, stage_kind, status, started_at, finished_at,
          evidence_ids_json, summary, failure_kind, message, metadata_json,
          created_at, updated_at
        ) values (
          @id, @runId, @loopId, @stageKind, 'running', @startedAt, null,
          @evidenceIdsJson, null, null, null, @metadataJson,
          @createdAt, @updatedAt
        )
      `).run({
        id: stageId,
        runId,
        loopId,
        stageKind,
        startedAt: now,
        evidenceIdsJson: JSON.stringify([]),
        metadataJson: JSON.stringify(metadata),
        createdAt: now,
        updatedAt: now,
      });

      const stage = this.getLoopStage(stageId);
      if (!stage) {
        throw new Error('Loop stage insert did not persist a record.');
      }
      this.bumpAutomationStoreVersion();
      return stage;
    });
  }

  updateLoopStageMetadata(stageId: string, patch: Record<string, unknown>): void {
    const stage = this.getLoopStage(stageId);
    if (!stage) return;
    if(stage.metadata.localEvaluationStarted===true&&this.getLoopRunPublicationBasis(stage.runId)){
      patch=captureLoopProducerValue(patch);
      if(['localEvaluationStarted','localEvaluation'].some(key=>Object.hasOwn(patch,key)&&publicationJson(patch[key]??null)!==publicationJson(stage.metadata[key]??null)))throw Error('loop_template_evaluation_started');
    }
    if(stage.metadata.taskStartState&&['taskId','taskStartState'].some(key=>Object.hasOwn(patch,key)&&patch[key]!==stage.metadata[key]))throw Error('loop_task_identity_changed');
    const merged = { ...stage.metadata, ...patch };
    this.db.prepare(`
      update loop_stages set metadata_json = @metadataJson, updated_at = @updatedAt where id = @id
    `).run({
      id: stageId,
      metadataJson: JSON.stringify(merged),
      updatedAt: Date.now(),
    });
  }

  finishLoopStageSuccess(
    stageId: string,
    evidenceIds: string[],
    now: number,
    summary?: string,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'success',
      evidenceIds,
      now,
      summary,
      metadata,
    });
  }

  finishLoopStageFailure(
    stageId: string,
    failureKind: LoopRunFailureKind,
    message: string,
    evidenceIds: string[],
    now: number,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'failed',
      evidenceIds,
      now,
      failureKind,
      message,
      metadata,
    });
  }

  finishLoopStageBlocked(
    stageId: string,
    evidenceIds: string[],
    nextAction: string | undefined,
    now: number,
    metadata?: Record<string, unknown>
  ): LoopStage | undefined {
    return this.finishLoopStage(stageId, {
      status: 'blocked',
      evidenceIds,
      now,
      message: nextAction,
      metadata,
    });
  }

  listLoopStages(runId: string): LoopStage[] {
    const rows = typedRows<LoopStageRow>(this.db.prepare(`
      select * from loop_stages
      where run_id = ?
      order by created_at asc, id asc
    `).all(runId));
    return rows.map(row => this.stageRowToRecord(row));
  }

  // --- Learned Constraints ---

  addConstraint(input: AddConstraintInput): LearnedConstraint {
    return this.transaction(() => {
      // Dedup: find existing active/pending constraint with same four-tuple
      const existing = this.db.prepare(`
        select id from loop_learned_constraints
        where loop_id = ? and source = ? and failure_kind = ? and failure_reason = ?
          and superseded_by is null and deactivation_reason is null
        order by created_at desc
        limit 1
      `).get(
        input.loopId,
        input.source,
        input.failureKind ?? null,
        input.failureReason ?? null
      ) as { id: string } | undefined;

      const newId = randomUUID();

      if (existing) {
        // Supersede the old constraint
        this.db.prepare(`
          update loop_learned_constraints
          set superseded_by = ?, deactivation_reason = 'superseded', updated_at = ?
          where id = ?
        `).run(newId, input.now, existing.id);
      }

      this.db.prepare(`
        insert into loop_learned_constraints (
          id, loop_id, source, rule, source_run_id,
          failure_kind, failure_reason, active, hit_count,
          consecutive_ineffective_count, created_at, updated_at,
          last_hit_at, superseded_by, deactivation_reason, extraction_context
        ) values (
          @id, @loopId, @source, @rule, @sourceRunId,
          @failureKind, @failureReason, 0, 0,
          0, @createdAt, @updatedAt,
          null, null, null, @extractionContext
        )
      `).run({
        id: newId,
        loopId: input.loopId,
        source: input.source,
        rule: input.rule,
        sourceRunId: input.sourceRunId,
        failureKind: input.failureKind ?? null,
        failureReason: input.failureReason ?? null,
        createdAt: input.now,
        updatedAt: input.now,
        extractionContext: input.extractionContext ?? null,
      });

      this.bumpAutomationStoreVersion();
      const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(newId) as LearnedConstraintRow | undefined;
      return this.constraintRowToRecord(row!);
    });
  }

  getActiveConstraints(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ? and active = 1 and deactivation_reason is null
      order by created_at desc
      limit 10
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  getPendingConstraints(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ? and active = 0 and deactivation_reason is null and superseded_by is null
      order by created_at desc
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  bumpConstraintHits(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    for (const id of ids) {
      this.db.prepare(`
        update loop_learned_constraints
        set hit_count = hit_count + 1, last_hit_at = ?, updated_at = ?
        where id = ?
      `).run(now, now, id);
    }
  }

  confirmConstraint(constraintId: string): LearnedConstraint | undefined {
    const now = Date.now();
    const result = this.db.prepare(`
      update loop_learned_constraints
      set active = 1, updated_at = ?
      where id = ? and active = 0 and deactivation_reason is null
    `).run(now, constraintId);
    if (result.changes === 0) return undefined;

    // Check overflow: if more than 10 active for this loop, deactivate oldest
    const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    if (row) {
      const activeRows = typedRows<LearnedConstraintRow>(this.db.prepare(`
        select * from loop_learned_constraints
        where loop_id = ? and active = 1 and deactivation_reason is null
        order by created_at desc
      `).all(row.loop_id));
      if (activeRows.length > 10) {
        const overflow = activeRows.slice(10);
        for (const old of overflow) {
          this.db.prepare(`
            update loop_learned_constraints
            set active = 0, deactivation_reason = 'overflow', updated_at = ?
            where id = ?
          `).run(now, old.id);
        }
      }
    }

    this.bumpAutomationStoreVersion();
    const updated = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    return updated ? this.constraintRowToRecord(updated) : undefined;
  }

  setConstraintActive(constraintId: string, active: boolean): LearnedConstraint | undefined {
    const now = Date.now();
    if (active) {
      this.db.prepare(`
        update loop_learned_constraints
        set active = 1, deactivation_reason = null, updated_at = ?
        where id = ?
      `).run(now, constraintId);
    } else {
      this.db.prepare(`
        update loop_learned_constraints
        set active = 0, deactivation_reason = 'user', updated_at = ?
        where id = ?
      `).run(now, constraintId);
    }
    this.bumpAutomationStoreVersion();
    const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(constraintId) as LearnedConstraintRow | undefined;
    return row ? this.constraintRowToRecord(row) : undefined;
  }

  incrementConsecutiveIneffective(constraintIds: string[]): void {
    if (constraintIds.length === 0) return;
    const now = Date.now();
    for (const id of constraintIds) {
      this.db.prepare(`
        update loop_learned_constraints
        set consecutive_ineffective_count = consecutive_ineffective_count + 1, updated_at = ?
        where id = ?
      `).run(now, id);

      // Auto-deactivate if reached 3
      const row = this.db.prepare('select * from loop_learned_constraints where id = ?').get(id) as LearnedConstraintRow | undefined;
      if (row && row.consecutive_ineffective_count >= 3) {
        this.db.prepare(`
          update loop_learned_constraints
          set active = 0, deactivation_reason = 'ineffective', updated_at = ?
          where id = ? and active = 1
        `).run(now, id);
      }
    }
    this.bumpAutomationStoreVersion();
  }

  resetConsecutiveIneffective(constraintIds: string[]): void {
    if (constraintIds.length === 0) return;
    const now = Date.now();
    for (const id of constraintIds) {
      this.db.prepare(`
        update loop_learned_constraints
        set consecutive_ineffective_count = 0, updated_at = ?
        where id = ?
      `).run(now, id);
    }
  }

  deactivateStaleConstraints(loopId: string, now: number): number {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    // Active constraints not hit in 30 days
    const staleActive = this.db.prepare(`
      update loop_learned_constraints
      set active = 0, deactivation_reason = 'stale', updated_at = ?
      where loop_id = ? and active = 1 and deactivation_reason is null
        and ((last_hit_at is null and created_at <= ?)
             or (last_hit_at is not null and last_hit_at <= ?))
    `).run(now, loopId, now - thirtyDaysMs, now - thirtyDaysMs);

    // Pending constraints not confirmed in 14 days
    const stalePending = this.db.prepare(`
      update loop_learned_constraints
      set deactivation_reason = 'stale', updated_at = ?
      where loop_id = ? and active = 0 and deactivation_reason is null and superseded_by is null
        and created_at <= ?
    `).run(now, loopId, now - fourteenDaysMs);

    const total = Number(staleActive.changes ?? 0) + Number(stalePending.changes ?? 0);
    if (total > 0) {
      this.bumpAutomationStoreVersion();
    }
    return total;
  }

  getConstraintsByLoopId(loopId: string): LearnedConstraint[] {
    const rows = typedRows<LearnedConstraintRow>(this.db.prepare(`
      select * from loop_learned_constraints
      where loop_id = ?
      order by created_at desc
    `).all(loopId));
    return rows.map(row => this.constraintRowToRecord(row));
  }

  finishLoopRunWithDuration(runId: string, durationMs: number): void {
    this.db.prepare(`
      update loop_runs
      set duration_ms = ?
      where id = ?
    `).run(durationMs, runId);
  }

  private applySchema(): void {
    this.db.exec(`
      create table if not exists loop_definitions (
        id text primary key,
        title text not null,
        description text not null,
        status text not null,
        origin text not null default 'built_in',
        active_run_id text,
        deleted_at integer,
        delete_reason text,
        created_at integer not null,
        updated_at integer not null
      );

      create index if not exists idx_loop_definitions_status
      on loop_definitions(status);

      create table if not exists loop_runs (
        id text primary key,
        loop_id text not null,
        status text not null,
        trigger_json text not null,
        evidence_ids_json text not null,
        started_at integer not null,
        finished_at integer,
        updated_at integer not null,
        failure_kind text,
        message text,
        summary text,
        next_action_kind text,
        next_action_summary text,
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_loop_runs_loop_started
      on loop_runs(loop_id, started_at);

      create index if not exists idx_loop_runs_stale
      on loop_runs(status, started_at, updated_at);

      create table if not exists assistant_profiles (
        id text primary key,
        status text not null,
        locale text not null,
        time_zone text not null,
        evening_time text not null,
        morning_time text not null,
        workdays_json text not null,
        quiet_hours_json text not null,
        data_scopes_json text not null,
        created_at integer not null,
        updated_at integer not null
      );

      create table if not exists assistant_candidates (
        id text primary key,
        run_id text not null,
        kind text not null,
        title text not null,
        content text not null,
        scope text not null,
        project_id text,
        confidence real not null,
        evidence_refs_json text not null,
        dedupe_key text not null,
        status text not null,
        target_kind text,
        target_id text,
        accepted_target_ref text,
        created_at integer not null,
        decided_at integer,
        foreign key(run_id) references loop_runs(id)
      );
      create index if not exists idx_assistant_candidates_status_created on assistant_candidates(status, created_at);
      create index if not exists idx_assistant_candidates_run on assistant_candidates(run_id);

      create table if not exists loop_stages (
        id text primary key,
        run_id text not null,
        loop_id text not null,
        stage_kind text not null,
        status text not null,
        started_at integer,
        finished_at integer,
        evidence_ids_json text not null default '[]',
        summary text,
        failure_kind text,
        message text,
        metadata_json text not null default '{}',
        created_at integer not null,
        updated_at integer not null,
        foreign key(run_id) references loop_runs(id),
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_loop_stages_run
      on loop_stages(run_id, created_at);

      create table if not exists user_loop_templates (
        loop_id text primary key,
        kind text not null,
        prompt text not null,
        output_directory text not null,
        output_file_name text not null,
        schedule_action_id text,
        schedule_enabled integer not null default 0,
        schedule_trigger_json text,
        auto_run_approved integer not null default 0,
        contract_json text,
        contract_schema_version text,
        created_at integer not null,
        updated_at integer not null,
        foreign key(loop_id) references loop_definitions(id)
      );

      create table if not exists loop_producer_results (
        run_id text primary key references loop_runs(id), revision integer not null,
        body_json text not null, body_hash text not null, stage_id text references loop_stages(id),
        evidence_ids_json text not null, terminal_at integer not null
      );
      create table if not exists loop_stage_execution_results (
        stage_id text primary key references loop_stages(id), run_id text not null references loop_runs(id), revision integer not null,
        body_json text not null, body_hash text not null, task_snapshot_json text not null, task_snapshot_hash text not null,
        evidence_ids_json text not null, terminal_at integer not null
      );
      create table if not exists loop_publication_candidates (
        candidate_id text primary key, run_id text not null references loop_runs(id), stage_id text references loop_stages(id),
        subject_key text not null, revision integer not null, binding_json text not null, binding_hash text not null,
        source_vector_hash text not null, publication_state text not null, created_at integer not null,
        unique(subject_key,revision)
      );
      create table if not exists loop_publication_candidate_members (
        candidate_id text not null references loop_publication_candidates(candidate_id), assistant_candidate_id text not null references assistant_candidates(id),
        original_row_json text not null, primary key(candidate_id,assistant_candidate_id)
      );
      create table if not exists loop_native_attempts (
        attempt_id text primary key, candidate_id text not null references loop_publication_candidates(candidate_id),
        revision integer not null, ordinal integer not null, original_source text not null,
        binding_hash text not null, source_vector_hash text not null, configuration_revision integer not null, definition_hash text not null,
        enrollment_request_id text not null unique, application_request_id text not null unique, phase text not null,
        created_at integer not null, updated_at integer not null, unique(candidate_id,ordinal)
      );
      create table if not exists loop_publication_configs (
        loop_id text primary key references loop_definitions(id), revision integer not null,
        configuration_json text not null, created_at integer not null, updated_at integer not null
      );
      create table if not exists loop_run_publication_basis (
        run_id text primary key references loop_runs(id), basis_json text not null, basis_hash text not null
      );
      create table if not exists loop_verification_sessions (
        id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id),
        candidate_id text not null references loop_publication_candidates(candidate_id), obligation_id text not null,
        session_id text not null unique, operation_id text not null unique, validation_invocation_id text not null unique,
        enrollment_request_id text not null unique, phase text not null, revision integer not null,
        created_at integer not null, updated_at integer not null, unique(native_attempt_id,obligation_id)
      );
      create table if not exists assistant_promotion_intents (
        candidate_id text primary key references assistant_candidates(id),revision integer not null,record_json text not null
      );
      create table if not exists loop_projection_origins (
        run_id text primary key references loop_runs(id), origin_hash text not null, record_json text not null
      );
      create table if not exists loop_projection_generations (
        run_id text not null references loop_projection_origins(run_id), generation integer not null,
        generation_hash text not null, record_json text not null, primary key(run_id,generation)
      );
      create table if not exists loop_publication_attempts (
        attempt_id text primary key, native_attempt_id text not null references loop_native_attempts(attempt_id),
        candidate_id text not null references loop_publication_candidates(candidate_id), sequence integer not null,
        revision integer not null, record_json text not null, unique(candidate_id,sequence)
      );
      create table if not exists loop_verification_executions (
        id text primary key, session_record_id text not null unique references loop_verification_sessions(id),
        revision integer not null, record_json text not null
      );
      create table if not exists automation_store_metadata (
        key text primary key,
        value integer not null
      );

      create table if not exists loop_learned_constraints (
        id text primary key,
        loop_id text not null,
        source text not null,
        rule text not null,
        source_run_id text not null,
        failure_kind text,
        failure_reason text,
        active integer not null default 0,
        hit_count integer not null default 0,
        consecutive_ineffective_count integer not null default 0,
        created_at integer not null,
        updated_at integer not null,
        last_hit_at integer,
        superseded_by text,
        deactivation_reason text,
        extraction_context text,
        foreign key(loop_id) references loop_definitions(id)
      );

      create index if not exists idx_constraints_loop_active
      on loop_learned_constraints(loop_id, active);
    `);
    this.ensureColumn('loop_definitions', 'origin', "text not null default 'built_in'");
    this.ensureColumn('loop_definitions', 'deleted_at', 'integer');
    this.ensureColumn('loop_definitions', 'delete_reason', 'text');
    this.ensureColumn('loop_runs', 'duration_ms', 'integer default 0');
    this.ensureColumn('loop_runs', 'logical_run_key', 'text');
    this.ensureColumn('user_loop_templates', 'contract_json', 'text');
    this.ensureColumn('user_loop_templates', 'contract_schema_version', 'text');
    this.db.exec(`create unique index if not exists idx_loop_runs_success_logical_key
      on loop_runs(loop_id, logical_run_key) where status = 'success' and logical_run_key is not null`);
  }

  private ensureColumn(tableName: 'loop_definitions' | 'loop_runs' | 'user_loop_templates', columnName: string, definition: string): void {
    const columns = typedRows<TableColumnRow>(this.db.prepare(`pragma table_info(${tableName})`).all());
    if (columns.some(column => column.name === columnName)) return;
    this.db.exec(`alter table ${tableName} add column ${columnName} ${definition}`);
  }

  private finishLoopRun(
    runId: string,
    input: {
      status: Exclude<LoopRunStatus, 'running'>;
      evidenceIds: string[];
      now: number;
      failureKind?: LoopRunFailureKind;
      message?: string;
      summary?: string;
      nextActionKind?: string;
      nextActionSummary?: string;
    }
  ): LoopRun | undefined {
    return this.transaction(() => {
      const current = this.getLoopRunRow(runId);
      if (!current) return undefined;
      if (current.status !== 'running') return this.runRowToRecord(current);
      if(this.hasLoopPublicationResults(runId)||this.hasUnknownLoopTask(runId))return this.runRowToRecord(current);
      if(input.status==='success')this.assertRawLoopSuccess(runId);

      const result = this.db.prepare(`
        update loop_runs
        set status = ?, evidence_ids_json = ?, finished_at = ?, updated_at = ?,
            failure_kind = ?, message = ?, summary = ?,
            next_action_kind = ?, next_action_summary = ?
        where id = ? and status = 'running'
      `).run(
        input.status,
        JSON.stringify(input.evidenceIds),
        input.now,
        input.now,
        input.failureKind ?? null,
        input.message ?? null,
        input.summary ?? null,
        input.nextActionKind ?? null,
        input.nextActionSummary ?? null,
        runId
      );

      if (result.changes === 1) {
        if (input.status !== 'success') this.supersedeStagedCandidates(runId, input.now);
        this.finishOpenStagesForTerminalRun(current.loop_id, runId, input, current.status, input.now);
        this.clearActiveRun(current.loop_id, runId, input.now);
        this.bumpAutomationStoreVersion();
      }
      return this.getLoopRun(runId);
    });
  }

  private getLoopDefinitionRow(loopId: string): LoopDefinitionRow | undefined {
    return this.db.prepare('select * from loop_definitions where id = ?').get(loopId) as LoopDefinitionRow | undefined;
  }

  private getLoopRunRow(runId: string): LoopRunRow | undefined {
    return this.db.prepare('select * from loop_runs where id = ?').get(runId) as LoopRunRow | undefined;
  }

  private getLoopStage(stageId: string): LoopStage | undefined {
    const row = this.db.prepare('select * from loop_stages where id = ?').get(stageId) as LoopStageRow | undefined;
    return row ? this.stageRowToRecord(row) : undefined;
  }

  private finishLoopStage(
    stageId: string,
    input: {
      status: Exclude<LoopStageStatus, 'pending' | 'running'>;
      evidenceIds: string[];
      now: number;
      summary?: string;
      failureKind?: LoopRunFailureKind;
      message?: string;
      metadata?: Record<string, unknown>;
    }
  ): LoopStage | undefined {
    return this.transaction(() => {
      const current = this.db.prepare('select * from loop_stages where id = ?').get(stageId) as LoopStageRow | undefined;
      if (!current) return undefined;
      if (TERMINAL_STAGE_STATUSES.has(current.status)) {
        return this.stageRowToRecord(current);
      }
      const parentRun = this.getLoopRunRow(current.run_id);
      if (!parentRun || parentRun.status !== 'running') {
        return this.stageRowToRecord(current);
      }
      if(this.hasLoopPublicationResults(current.run_id)||this.hasUnknownLoopTask(current.run_id))return this.stageRowToRecord(current);
      if(input.status==='success'){this.assertRawLoopSuccess(current.run_id);assertOrdinaryLoopOwner('loop_stage',stageId);}

      const result = this.db.prepare(`
        update loop_stages
        set status = ?, evidence_ids_json = ?, finished_at = ?, updated_at = ?,
            summary = ?, failure_kind = ?, message = ?,
            metadata_json = coalesce(?, metadata_json)
        where id = ? and status not in ('success', 'failed', 'blocked', 'skipped')
      `).run(
        input.status,
        JSON.stringify(input.evidenceIds),
        input.now,
        input.now,
        input.summary ?? null,
        input.failureKind ?? null,
        input.message ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        stageId
      );
      if (result.changes === 1) {
        this.bumpAutomationStoreVersion();
      }
      return this.getLoopStage(stageId);
    });
  }

  private hasUnknownLoopTask(runId:string):boolean {return !!this.db.prepare("SELECT 1 FROM loop_stages WHERE run_id=? AND json_extract(metadata_json,'$.taskStartState') IN ('unknown','started') AND typeof(json_extract(metadata_json,'$.taskId'))='text' LIMIT 1").get(runId);}

  private isStaleRun(row: LoopRunRow, now: number, staleAfterMs: number): boolean {
    const threshold = now - staleAfterMs;
    return row.status === 'running' && row.updated_at <= threshold&&!this.hasLoopPublicationResults(row.id)&&!this.hasUnknownLoopTask(row.id);
  }

  private markRunExecutorCrash(row: LoopRunRow, now: number): void {
    if(this.hasLoopPublicationResults(row.id)||this.hasUnknownLoopTask(row.id))return;
    this.db.prepare(`
      update loop_runs
      set status = 'failed', finished_at = ?, updated_at = ?,
          failure_kind = 'executor_crash', message = ?
      where id = ? and status = 'running'
    `).run(now, now, EXECUTOR_CRASH_MESSAGE, row.id);
    this.supersedeStagedCandidates(row.id, now);
    this.failOpenStages(row.loop_id, row.id, 'executor_crash', EXECUTOR_CRASH_MESSAGE, now);
  }

  private assertRawLoopSuccess(runId:string):void {
    const run=this.getLoopRunRow(runId);if(!run)throw Error('loop_missing');
    if(this.getLoopRunPublicationBasis(runId)||this.getLoopPublicationConfiguration(run.loop_id))throw Error('loop_publication_required');
    assertOrdinaryLoopOwner('loop_run',runId);
  }

  private finishOpenStagesForTerminalRun(
    loopId: string,
    runId: string,
    input: {
      status: Exclude<LoopRunStatus, 'running'>;
      failureKind?: LoopRunFailureKind;
      message?: string;
      nextActionSummary?: string;
    },
    previousRunStatus: LoopRunStatus,
    now: number
  ): void {
    if (previousRunStatus !== 'running') return;
    if (input.status === 'success') {
      this.assertRawLoopSuccess(runId);
      for(const stage of this.listLoopStages(runId))assertOrdinaryLoopOwner('loop_stage',stage.id);
      this.db.prepare(`
        update loop_stages
        set status = 'skipped', finished_at = ?, updated_at = ?,
            message = coalesce(message, ?)
        where loop_id = ? and run_id = ? and status in ('pending', 'running')
      `).run(now, now, 'Loop run finished before stage completed.', loopId, runId);
      return;
    }
    if (input.status === 'blocked') {
      this.db.prepare(`
        update loop_stages
        set status = 'blocked', finished_at = ?, updated_at = ?,
            message = coalesce(message, ?)
        where loop_id = ? and run_id = ? and status in ('pending', 'running')
      `).run(now, now, input.nextActionSummary ?? 'Loop run blocked before stage completed.', loopId, runId);
      return;
    }
    this.failOpenStages(
      loopId,
      runId,
      input.failureKind ?? 'unknown',
      input.message ?? 'Loop run failed before stage completed.',
      now
    );
  }

  private failOpenStages(loopId: string, runId: string, failureKind: LoopRunFailureKind, message: string, now: number): void {
    this.db.prepare(`
      update loop_stages
      set status = 'failed', finished_at = ?, updated_at = ?,
          failure_kind = ?, message = ?
      where loop_id = ? and run_id = ? and status in ('pending', 'running')
    `).run(now, now, failureKind, message, loopId, runId);
  }

  private clearActiveRun(loopId: string, runId: string, now: number): void {
    this.db.prepare(`
      update loop_definitions
      set active_run_id = null, updated_at = ?
      where id = ? and active_run_id = ?
    `).run(now, loopId, runId);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (error) {
      try {
        if(this.db.isTransaction)this.db.exec('rollback');
      } catch { /* ignore rollback errors */ }
      throw error;
    }
  }

  private bumpAutomationStoreVersion(): void {
    this.db.prepare(`
      insert into automation_store_metadata(key, value)
      values ('version', 1)
      on conflict(key) do update set value = value + 1
    `).run();
  }

  private definitionRowToRecord(row: LoopDefinitionRow): LoopDefinition {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      origin: row.origin,
      activeRunId: row.active_run_id ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
      deleteReason: row.delete_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assistantProfileRowToRecord(row: AssistantProfileRow): AssistantProfile {
    return {
      id: row.id,
      status: row.status,
      locale: row.locale,
      timeZone: row.time_zone,
      eveningTime: row.evening_time,
      morningTime: row.morning_time,
      workdays: parseJson<number[]>(row.workdays_json),
      quietHours: parseJson<AssistantProfile['quietHours']>(row.quiet_hours_json),
      dataScopes: parseJson<AssistantProfile['dataScopes']>(row.data_scopes_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assistantCandidateRowToRecord(row: AssistantCandidateRow): AssistantCandidate {
    return {
      id: row.id, runId: row.run_id, kind: row.kind, title: row.title, content: row.content, scope: row.scope,
      projectId: row.project_id ?? undefined, confidence: row.confidence, evidenceRefs: parseJson<AssistantCandidate['evidenceRefs']>(row.evidence_refs_json),
      dedupeKey: row.dedupe_key, status: row.status, targetKind: row.target_kind ?? undefined, targetId: row.target_id ?? undefined,
      acceptedTargetRef: row.accepted_target_ref ?? undefined, createdAt: row.created_at, decidedAt: row.decided_at ?? undefined,
    };
  }

  private supersedeStagedCandidates(runId: string, now: number): void {
    this.db.prepare(`update assistant_candidates set status = 'superseded', decided_at = ? where run_id = ? and status = 'staged'`).run(now, runId);
  }

  private userLoopTemplateRowToRecord(row: UserLoopTemplateRow): UserLoopTemplate {
    const fallbackInput = row.kind === 'task_completion'
      ? {
          kind: 'task_completion' as const,
          loopId: row.loop_id,
          title: row.loop_id,
          prompt: row.prompt,
          now: row.created_at,
        }
      : {
          kind: 'markdown_file' as const,
          loopId: row.loop_id,
          title: row.loop_id,
          prompt: row.prompt,
          outputDirectory: row.output_directory,
          outputFileName: row.output_file_name,
          now: row.created_at,
        };
    const contract = row.contract_json
      ? parseLoopContractV1(parseJson<unknown>(row.contract_json), {
          registeredCriteria: ['task_completed', 'file_exists', 'command_exit_zero'],
        })
      : createDefaultLoopContract(fallbackInput);
    return {
      loopId: row.loop_id,
      kind: row.kind,
      prompt: row.prompt,
      outputDirectory: row.output_directory,
      outputFileName: row.output_file_name,
      scheduleActionId: row.schedule_action_id ?? undefined,
      scheduleEnabled: row.schedule_enabled === 1,
      scheduleTrigger: row.schedule_trigger_json ? parseJson<Record<string, unknown>>(row.schedule_trigger_json) : undefined,
      autoRunApproved: row.auto_run_approved === 1,
      contract,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private runRowToRecord(row: LoopRunRow): LoopRun {
    return {
      id: row.id,
      loopId: row.loop_id,
      status: row.status,
      trigger: parseJson<LoopRunTrigger>(row.trigger_json),
      logicalRunKey: row.logical_run_key ?? undefined,
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      updatedAt: row.updated_at,
      failureKind: row.failure_kind ?? undefined,
      message: row.message ?? undefined,
      summary: row.summary ?? undefined,
      nextActionKind: row.next_action_kind ?? undefined,
      nextActionSummary: row.next_action_summary ?? undefined,
    };
  }

  private stageRowToRecord(row: LoopStageRow): LoopStage {
    return {
      id: row.id,
      runId: row.run_id,
      loopId: row.loop_id,
      stageKind: row.stage_kind,
      status: row.status,
      evidenceIds: parseJson<string[]>(row.evidence_ids_json),
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      summary: row.summary ?? undefined,
      failureKind: row.failure_kind ?? undefined,
      message: row.message ?? undefined,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private constraintRowToRecord(row: LearnedConstraintRow): LearnedConstraint {
    return {
      id: row.id,
      loopId: row.loop_id,
      source: row.source,
      rule: row.rule,
      sourceRunId: row.source_run_id,
      failureKind: row.failure_kind,
      failureReason: row.failure_reason,
      active: row.active === 1,
      hitCount: row.hit_count,
      consecutiveIneffectiveCount: row.consecutive_ineffective_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastHitAt: row.last_hit_at,
      supersededBy: row.superseded_by,
      deactivationReason: row.deactivation_reason,
      extractionContext: row.extraction_context,
    };
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function typedRows<T>(rows: unknown): T[] {
  return rows as T[];
}

function validateUserLoopTemplateInput(input: CreateUserLoopTemplateInput): void {
  if (input.kind === 'markdown_file') {
    if (!isAbsolute(input.outputDirectory)) {
      throw new Error('User loop outputDirectory must be an absolute path.');
    }
    if (!isSafeLoopOutputFileName(input.outputFileName)) {
      throw new Error('User loop outputFileName must be a file name, not a path.');
    }
    const outputDirectory = resolve(input.outputDirectory);
    const outputPath = resolve(outputDirectory, input.outputFileName);
    if (dirname(outputPath) !== outputDirectory) {
      throw new Error('User loop outputFileName must be a file name, not a path.');
    }
  } else if (input.kind === 'task_completion') {
    // task_completion: no output path validation needed
  } else {
    throw new Error('Unsupported user loop template kind.');
  }
}

function legacyScheduleFieldsIn(input: CreateUserLoopTemplateInput): IgnoredLegacyScheduleField[] {
  const fields: IgnoredLegacyScheduleField[] = [];
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleEnabled')) fields.push('scheduleEnabled');
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleTrigger')) fields.push('scheduleTrigger');
  if (Object.prototype.hasOwnProperty.call(input, 'autoRunApproved')) fields.push('autoRunApproved');
  return fields;
}
