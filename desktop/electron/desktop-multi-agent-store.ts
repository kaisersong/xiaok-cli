import {readOriginalMainDshBrokerReply,type OriginalMainDshBrokerReply} from './main-dsh-broker-control-source.js';
import {readBrokerBaselineReceipt,readBrokerFenceReceipt,projectDshBrokerControlTarget,brokerAdmissionDigest} from '../../src/runtime/multi-agent/dsh-broker-control-data.js';
import {readDshAuthorityColdRow} from '../../src/runtime/multi-agent/dsh-admission-cold-data.js';
import {dshMandateIssuerEpoch} from '../../src/runtime/multi-agent/dsh-admission-authority-data.js';
import {classifySourceControl,evaluateAdmission} from '../../src/runtime/admission/evaluate.js';
import {assertOriginalMainDshPhysicalCompositionCached} from './main-dsh-physical-composition.js';
import {readOriginalDshAssessmentResult} from './main-dsh-model-source.js';
import {readOriginalMainDshBusinessSettlement,readOriginalMainDshDraftSlot} from './main-dsh-business-source.js';
import {DSH_ASSESSMENT_PROMPT_VERSION} from '../../src/runtime/admission/assessment-output.js';
import {hashEvidenceManifest,hashSemanticAssessment,hashA2Data} from '../../src/runtime/admission/hash.js';
import type {FrozenAutoAdmissionWindow,A2SnapshotV1,FrozenSemanticAssessment} from '../../src/runtime/admission/types.js';
import {parseA2Snapshot} from '../../src/runtime/admission/parse.js';
import {buildDshAdmissionOwnerCommand,buildDshDraftPreparationOwnerCommand,type DshAdmissionOwnerCommandInput} from '../../src/runtime/multi-agent/dsh-admission-owner-command.js';
import {instantMs,parseSemanticAssessment} from '../../src/runtime/admission/parse.js';
import {parseDshEgressPolicy} from '../../src/runtime/multi-agent/dsh-egress-policy-data.js';
import {readKSwarmOwnedDshServiceScope,readOriginalKSwarmDshReply} from './kswarm-service.js';
import type {KSwarmDshAdmission,KSwarmDshReplyView} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {parseMandateProjection} from '../../src/runtime/admission/parse.js';
import {hashMandateProjection} from '../../src/runtime/admission/hash.js';
import {readOriginalGithubSourceScan,readOriginalGithubSourceScanForAdmission} from './dsh-github-source-scan.js';
import {parseGithubSourceScan,planGithubSourceRows,validateGithubSourceRelations,readGithubSourceRow,type GithubSourceStorageRow} from '../../src/runtime/multi-agent/dsh-github-source-storage.js';
import {localObject,githubReadHash} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {readOriginalGithubSourceSetupResult,readOriginalGithubProviderDateFact} from './dsh-github-source-session.js';
import {parseDshSourceConfiguration,dshSourceScopeIdentity,dshSourceScopeKey,dshSourceModeId,dshSourceReadScopes} from '../../src/runtime/multi-agent/dsh-source-configuration.js';
import {readOriginalDshBudgetPort,readOriginalDshBudgetObservation,readOriginalDshBudgetRuntimeBinding,assertOriginalDshBudgetObservationCurrent,assertOriginalDshBudgetObservationUnchanged,readOriginalDshDraftAdmission,readOriginalDshBudgetWorkSnapshot,assertOriginalDshDraftAdmissionReserved,assertOriginalDshDraftAdmissionUnchanged,assertOriginalDshDraftAdmissionCurrent,type DshBudgetObservationView} from './harness-optimization-service.js';
import {readOriginalMainDshBootstrapAuthority,readOriginalDshAdmissionReferences,readOriginalMainDshClock,readOriginalMainDshAdmissionDatabase} from './main-dsh-bootstrap-authority.js';
import type {AuthorityDatabase,OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import {readOriginalMainDshControl} from './main-dsh-control-source.js';
import {DSH_A_AUTHORITY_PROFILE,DSH_A_AUTHORITY_DIGEST,DSH_A_AUTHORITY_FUNCTION,DSH_A_AUTHORITY_OPERATION_FUNCTION,DSH_A_AUTHORITY_DDL,DSH_A_AUTHORITY_TABLES,DSH_A_AUTHORITY_TEMPLATE_HASH,DSH_A_AUTHORITY_SQL_HASH,DSH_A_OLD_GUARDS,assertDshProfileAncestry,dshProfileAncestryHash} from '../../src/runtime/multi-agent/dsh-admission-authority-data.js';
import {createKnownDirectoryWriterFence} from '../../src/runtime/verification/known-directory-writer-fence.js';
import {assertOrdinarySourceWriterRoute,observeOrdinarySQLiteWriter} from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync,StatementSync } from 'node:sqlite';
import {readCapturedGroupsSchema} from '../../src/runtime/verification/groups-source-schema.js';
import {types as utilTypes} from 'node:util';
import {captureIpcData} from './ipc-data-snapshot.js';
import {dshSourceObjectIdentity,reduceDshSourceObjectHead} from './dsh-source-object-head.js';
import {validateDshAStoredBody,DSH_A_TABLES,DSH_A_DDL,DSH_A_PROFILE,DSH_A_DIGEST,DSH_A_FUNCTION,dshAJson,dshAHash,dshAFields,dshABinding,dshAEnvelope,dshASourceKey,dshAInputKey,dshAProof,dshAObservation,dshAFail,type DshARecord} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import { agentRunState, type AgentActivityRun, type AgentActivityMember } from '../../src/runtime/conversation-activity/agent-runs.js';
import type {
  DesktopAgentSnapshot, DesktopMultiAgentGroup, MultiAgentContent, MultiAgentContentPage,
  MultiAgentDrainedBatch, MultiAgentDurableEvent, MultiAgentEventKind, MultiAgentManagedResource,
  MultiAgentMessage, MultiAgentOperation, MultiAgentPage, MultiAgentRootBinding, MultiAgentSender, MultiAgentControlResult,
  WorkspaceExecutionAuthorizationRow, ExecutionAuthorizationReceiptEnvelope, ApprovalRequestOperation,
  MultiAgentApprovalDurable, MultiAgentApprovalStatus, MultiAgentApprovalReason, MultiAgentApprovalEventPayload,
} from '../shared/multi-agent-types.js';

const TABLES = ['groups', 'agents', 'events', 'messages', 'contents', 'operations', 'root_turns', 'managed_resources', 'activity_runs', 'activity_members'] as const;
const ACTIVITY_RUN_SCHEMA = `CREATE TABLE IF NOT EXISTS activity_runs(run_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity_members(run_id TEXT NOT NULL REFERENCES activity_runs(run_id),member_id TEXT NOT NULL,group_id TEXT NOT NULL REFERENCES groups(group_id),data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(run_id,member_id));`;
type Table = typeof TABLES[number];
type SqlValue = string | number | null;
interface JsonRow { data_json: string; logical_bytes: number }
export interface MultiAgentThreadBinding {
  threadId: string; profileId: string; workspaceId: string; cwd: string;
  activeGroupId?: string | null; threadRevision?: number;
  pendingApprovalCount?: number;
  deleteState?: 'none' | 'delete_pending' | 'deleted';
  deletionReceipt?: ThreadDeletionReceipt;
}
export interface ThreadDeletionReceipt {
  operationId: string; requestHash: string; actorId: string; bootId: string; expectedRevision: number; startedAt: number;
  result: MultiAgentControlResult;
}

import {encodeMultiAgentRow} from '../../src/runtime/multi-agent/row-codec.js';
export {encodeMultiAgentRow} from '../../src/runtime/multi-agent/row-codec.js';

export function truncateMultiAgentText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  return { text: new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true }), truncated: true };
}

import {MAX_CONTENT_BYTES,APPROVAL_STATUSES,APPROVAL_REASONS,boundedString,safeInteger,captureApprovalOperation,captureApprovalOperationForWrite,captureWorkspaceAuthorization,approvalEvent,captureApprovalEvent} from '../../src/runtime/multi-agent/approval-records.js';
export {captureApprovalOperationForWrite} from '../../src/runtime/multi-agent/approval-records.js';

export interface FinalizeApprovalInput {
  groupId: string; approvalId: string; bootId: string; status: Exclude<MultiAgentApprovalStatus, 'pending'>;
  reason?: MultiAgentApprovalReason; decisionOperation?: MultiAgentOperation;
}

const WORKSPACE_AUTHORIZATION_SQL = `CREATE TABLE workspace_execution_authorizations (
  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),
  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,
  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id));`;
const APPROVAL_INDEX_SQL = `CREATE INDEX operations_approval_requests ON operations (
  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request';`;
const THREAD_DELETION_COLUMNS = ["delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted'))", 'delete_json TEXT'];
const APPROVAL_COUNT_COLUMN = 'pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0)';
const PRESENTATION_RESERVATION_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS operations_presentation_ordinal ON operations(group_id,json_extract(data_json,'$.presentationReservation.ordinal')) WHERE json_extract(data_json,'$.presentationReservation.ordinal') IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS operations_presentation_agent ON operations(group_id,json_extract(data_json,'$.presentationReservation.agentId')) WHERE json_extract(data_json,'$.presentationReservation.agentId') IS NOT NULL;
`;
const PRESENTATION_RESERVATION_INDEX_NAMES = new Set(['operations_presentation_ordinal', 'operations_presentation_agent']);
/** Keep quoted JSON paths/literals case- and whitespace-sensitive. */
function schemaSql(sql: string): string {
  return (sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[^\s'"]+/g) ?? []).map(token => token.startsWith("'") ? token
    : token.replace(/^"|"$/g, '').toLowerCase()).join('').replace(/;$/, '').replace(/^create(table|index|uniqueindex)ifnotexists/, 'create$1');
}

interface KnownMultiAgentBodies {
  claimBootOwnership(pid?:number):void;
  settleBootOwnership():void;
  reconcileAgentResources(groupId:string):void;
  transaction<T>(action:(port:DesktopMultiAgentMutationPort)=>T):T;
  registerThread(binding:MultiAgentThreadBinding):void;
  initializeWorkspaceAuthorization(domain:{ profileId: string; workspaceId: string }):WorkspaceExecutionAuthorizationRow;
  compareAndSetWorkspaceAuthorization(input:{ profileId: string; workspaceId: string; expectedPermissionRevision: number; next: WorkspaceExecutionAuthorizationRow }):boolean;
  beginThreadDeletion(threadId:string,receipt:ThreadDeletionReceipt):void;
  updateThreadDeletion(threadId:string,operationId:string,result:MultiAgentControlResult):void;
  deleteThreadHistory(threadId:string,operationId:string):void;
  createGroup(threadId:string,permissionRevision?:number):DesktopMultiAgentGroup;
  putGroup(group:DesktopMultiAgentGroup,control?:boolean):void;
  clearActiveGroup(threadId:string,expectedGroupId:string):void;
  putAgent(groupId:string,input:Pick<DesktopAgentSnapshot, 'id' | 'parentId' | 'taskName' | 'canonicalName' | 'depth' | 'status' | 'turn'> & Partial<DesktopAgentSnapshot>,control?:boolean):DesktopAgentSnapshot;
  appendEvent(groupId:string,input:{ kind: MultiAgentEventKind; agentId: string; payload: Record<string, unknown>; turnId?: string }):MultiAgentDurableEvent;
  createActivityRun(input:Pick<AgentActivityRun, 'runId' | 'groupId' | 'kind' | 'originId' | 'rootTaskId'>):AgentActivityRun;
  putActivityMember(member:AgentActivityMember):void;
  confirmActivityRootTerminal(runId:string,proof:NonNullable<AgentActivityRun['rootTerminal']>):void;
  markActivityRunUnknown(runId:string,code:string):void;
  finalizeActivityRun(runId:string):AgentActivityRun | null;
  sendMessage(groupId:string,input:{ sender: MultiAgentSender; receiverId: string; text: string; kind?: MultiAgentMessage['kind']; contentId?: string; truncated?: boolean;bodyUnavailable?:true },settlement?:boolean):MultiAgentMessage;
  rerouteClosedHandoffs(groupId:string,agentId:string):void;
  drainInput(groupId:string,receiverId:string,turnId:string,maxBytes?:number):MultiAgentDrainedBatch;
  confirmApplied(groupId:string,claimId:string,turnId:string):void;
  returnClaim(groupId:string,claimId:string,expectedTurnId?:string):void;
  putContent(groupId:string,agentId:string,text:string,settlement?:boolean,unavailable?:{status: DesktopAgentSnapshot['status']}):MultiAgentContent;
  deleteUnreferencedContent(groupId:string,contentId:string):void;
  reservePresentationOrdinal(input:{groupId:string;operationId:string;requestHash:string;agentId:string}):number;
  reserveManagedFollowupTurn(input:{groupId:string;operationId:string;requestHash:string;agentId:string;previousTurnId:string;expectedTurn:number;rootEpoch:number;messageHash:string;closureHash:string}):NonNullable<MultiAgentOperation['managedTurnReservation']>;
  putOperation(operation:MultiAgentOperation,control?:boolean):void;
  commitApprovalRequest(input:ApprovalRequestOperation):{ created: boolean; operation: ApprovalRequestOperation };
  finalizeApproval(input:FinalizeApprovalInput):{ changed: boolean; operation: ApprovalRequestOperation };
  finalizeApprovalRecord(input:FinalizeApprovalInput,recovery:boolean):{ changed: boolean; operation: ApprovalRequestOperation };
  updateApprovalCount(threadId:string,count:number,changedFact?:boolean):void;
  recoverApprovalRequests():void;
  putRootBinding(binding:MultiAgentRootBinding,control?:boolean):void;
  putResource(resource:MultiAgentManagedResource,control?:boolean):void;
  recoverPreviousBoot():void;
  repairByteUsage(groupId:string):void;
  putMessage(message:MultiAgentMessage,control?:boolean):void;
  write(table:Table,groupId:string,key:Record<string, SqlValue>,indexes:Record<string, SqlValue>,data:unknown,control:boolean):void;
  applySchema(version:number):void;
  validateSchema(version:1 | 2 | 3 | 4,base:string):void;
}
export type DesktopMultiAgentMutationPort = Pick<DesktopMultiAgentStore,"claimBootOwnership"|"settleBootOwnership"|"reconcileAgentResources"|"registerThread"|"initializeWorkspaceAuthorization"|"compareAndSetWorkspaceAuthorization"|"beginThreadDeletion"|"updateThreadDeletion"|"deleteThreadHistory"|"createGroup"|"putGroup"|"clearActiveGroup"|"putAgent"|"appendEvent"|"createActivityRun"|"putActivityMember"|"confirmActivityRootTerminal"|"markActivityRunUnknown"|"finalizeActivityRun"|"sendMessage"|"rerouteClosedHandoffs"|"drainInput"|"confirmApplied"|"returnClaim"|"putContent"|"deleteUnreferencedContent"|"reservePresentationOrdinal"|"reserveManagedFollowupTurn"|"putOperation"|"commitApprovalRequest"|"finalizeApproval"|"putRootBinding"|"putResource"|"recoverPreviousBoot"|"previousGroups"|"assertResourceOwnerSettled"|"getThread"|"readWorkspaceAuthorization"|"listWorkspaceThreads"|"listWorkspaceGroups"|"activeGroup"|"getGroup"|"requireGroup"|"findThreadOperation"|"threadHasUnreleasedResources"|"threadHasAgentHistory"|"goalChildReadiness"|"listGroups"|"getAgent"|"listAgents"|"allAgents"|"residentAgents"|"agentCounts"|"readEvents"|"getActivityRun"|"getActivityRuns"|"pendingActivityRuns"|"getActivityMembers"|"listMessages"|"hasUnread"|"captureSemanticInputBoundary"|"unreadMessageIds"|"readContent"|"getOperation"|"listApprovalRequests"|"pendingCloseOperations"|"getRootBinding"|"previousRootBindings"|"resources"|"listResources"|"getByteUsage"|"recomputeByteUsage"> & {transaction<T>(action:(port:DesktopMultiAgentMutationPort)=>T):T};
const KNOWN_MUTATOR_NAMES=new Set<string>(["claimBootOwnership","settleBootOwnership","reconcileAgentResources","transaction","registerThread","initializeWorkspaceAuthorization","compareAndSetWorkspaceAuthorization","beginThreadDeletion","updateThreadDeletion","deleteThreadHistory","createGroup","putGroup","clearActiveGroup","putAgent","appendEvent","createActivityRun","putActivityMember","confirmActivityRootTerminal","markActivityRunUnknown","finalizeActivityRun","sendMessage","rerouteClosedHandoffs","drainInput","confirmApplied","returnClaim","putContent","deleteUnreferencedContent","reservePresentationOrdinal","reserveManagedFollowupTurn","putOperation","commitApprovalRequest","finalizeApproval","putRootBinding","putResource","recoverPreviousBoot"]);
const KNOWN_PORT_METHODS=["claimBootOwnership","settleBootOwnership","reconcileAgentResources","transaction","registerThread","initializeWorkspaceAuthorization","compareAndSetWorkspaceAuthorization","beginThreadDeletion","updateThreadDeletion","deleteThreadHistory","createGroup","putGroup","clearActiveGroup","putAgent","appendEvent","createActivityRun","putActivityMember","confirmActivityRootTerminal","markActivityRunUnknown","finalizeActivityRun","sendMessage","rerouteClosedHandoffs","drainInput","confirmApplied","returnClaim","putContent","deleteUnreferencedContent","reservePresentationOrdinal","reserveManagedFollowupTurn","putOperation","commitApprovalRequest","finalizeApproval","putRootBinding","putResource","recoverPreviousBoot","previousGroups","assertResourceOwnerSettled","getThread","readWorkspaceAuthorization","listWorkspaceThreads","listWorkspaceGroups","activeGroup","getGroup","requireGroup","findThreadOperation","threadHasUnreleasedResources","threadHasAgentHistory","goalChildReadiness","listGroups","getAgent","listAgents","allAgents","residentAgents","agentCounts","readEvents","getActivityRun","getActivityRuns","pendingActivityRuns","getActivityMembers","listMessages","hasUnread","captureSemanticInputBoundary","unreadMessageIds","readContent","getOperation","listApprovalRequests","pendingCloseOperations","getRootBinding","previousRootBindings","resources","listResources","getByteUsage","recomputeByteUsage"] as const;
type KnownMultiAgentTransactionFailure={stage:'commit'|'rollback'|'notification'|'admission';primary:unknown;secondaryPresent:boolean;secondary?:unknown};
type KnownMultiAgentWriter={fence?:ReturnType<typeof createKnownDirectoryWriterFence>;bodies:KnownMultiAgentBodies;integrityFailure?:{error:unknown};transactionPhase?:'beginning'|'committing'|'rolling_back';outcomeUnknown?:KnownMultiAgentTransactionFailure;admissionInvocation?:{exec(sql:string):unknown}};
const knownMultiAgentWriters=new WeakMap<object,KnownMultiAgentWriter>();
const knownWriterGet=Function.prototype.call.bind(WeakMap.prototype.get),knownWriterSet=Function.prototype.call.bind(WeakMap.prototype.set);
const knownMultiAgentPorts=new WeakMap<object,{owner:DesktopMultiAgentStore;active:boolean}>();
function knownMultiAgentWriter(owner:object):KnownMultiAgentWriter {const writer=knownWriterGet(knownMultiAgentWriters,owner);if(!writer)throw Error('known_writer_fence_owner');return writer;}
function assertKnownMultiAgentIntegrity(writer:KnownMultiAgentWriter):void {if(writer.integrityFailure)throw writer.integrityFailure.error;}
function assertKnownMultiAgentTransaction(writer:KnownMultiAgentWriter):void {if(writer.outcomeUnknown)throw Error('multi_agent_transaction_outcome_unknown',{cause:writer.outcomeUnknown.primary});if(writer.transactionPhase)throw Error('multi_agent_transaction_'+writer.transactionPhase);if(writer.admissionInvocation)throw Error('DSH_A_TRANSACTION_BUSY');}
function admitKnownMultiAgentWriter(owner:object):KnownMultiAgentWriter {const writer=knownMultiAgentWriter(owner);assertKnownMultiAgentIntegrity(writer);assertKnownMultiAgentTransaction(writer);writer.fence?.assertOpen();return writer;}
function invokeKnownMultiAgentBody(owner:DesktopMultiAgentStore,name:keyof KnownMultiAgentBodies,args:unknown[]):unknown {const writer=knownMultiAgentWriter(owner);assertKnownMultiAgentIntegrity(writer);assertKnownMultiAgentTransaction(writer);return Reflect.apply(writer.bodies[name],undefined,args);}
function createKnownMultiAgentPort(owner:DesktopMultiAgentStore):{port:DesktopMultiAgentMutationPort;seal():void} {
  const object:Object=Object.create(null),record={owner,active:true};
  for(const name of KNOWN_PORT_METHODS){Object.defineProperty(object,name,{enumerable:true,value:function(this:object,...args:unknown[]):unknown {const held=knownWriterGet(knownMultiAgentPorts,this);if(this!==object||held!==record||held.owner!==owner||!held.active)throw Error('known_writer_fence_port_owner_expired');if(KNOWN_MUTATOR_NAMES.has(name))return invokeKnownMultiAgentBody(owner,name as keyof KnownMultiAgentBodies,args);return Reflect.apply(Reflect.get(owner,name),owner,args);}});}
  knownWriterSet(knownMultiAgentPorts,object,record);return {port:Object.freeze(object) as DesktopMultiAgentMutationPort,seal(){record.active=false;}};
}
// Original Store child. Not exported as a factory: no caller can inject DB,
// transaction operations or a verifier and obtain an original semantic port.
const aNumber = Number;
const aApply = Reflect.apply,
  aDescriptor = Object.getOwnPropertyDescriptor,
  aDescriptors = Object.getOwnPropertyDescriptors,
  aOwn = Object.hasOwn,
  aKeys = Reflect.ownKeys,
  aProto = Object.getPrototypeOf,
  aFreeze = Object.freeze,
  aDefine = Object.defineProperty;
const aProxy = utilTypes.isProxy,
  aPromise = utilTypes.isPromise,
  aAsync = utilTypes.isAsyncFunction,
  aArray = Array.isArray,
  aAsyncPrototype = aProto(async () => {}),
  aJsonParse = JSON.parse,
  aByteLength = Buffer.byteLength;
const aLower = Function.prototype.call.bind(String.prototype.toLowerCase);
function aJoin(values: readonly unknown[]): string {
  let result = "";
  for (let i = 0; i < values.length; i++) {
    if (i) result += ",";
    result += values[i] as string;
  }
  return result;
}
function aPush<T>(values: T[], value: T): void {
  aDefine(values, values.length, {
    __proto__: null,
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  } as PropertyDescriptor);
}
const aExec = DatabaseSync.prototype.exec,
  aPrepare = DatabaseSync.prototype.prepare,
  aFunction = DatabaseSync.prototype.function,
  aClose = DatabaseSync.prototype.close,
  aGet = StatementSync.prototype.get,
  aAll = StatementSync.prototype.all,
  aRun = StatementSync.prototype.run;
const aOriginalDatabaseMethods=aFreeze({exec:aExec,prepare:aPrepare,function:aFunction,close:aClose}),
  aOriginalStatementMethods=aFreeze({get:aGet,all:aAll,run:aRun});
const aInteger = Number.isSafeInteger, aCharCode=String.prototype.charCodeAt,aMinimum=Math.min;
const ADate=Date,aIso=Date.prototype.toISOString;
const APromise = Promise,
  aThen = Promise.prototype.then,
  aWG = WeakMap.prototype.get,
  aWS = WeakMap.prototype.set;
const aUnconfirmedOwners = createIntrinsicSet<object>();
const aChildren = new WeakMap<
  object,
  ReturnType<typeof birthDshAdmissionChild>
>();
const aRead = (owner: object) =>
  aApply(aWG, aChildren, [owner]) as
    | ReturnType<typeof birthDshAdmissionChild>
    | undefined;
const aSync = (value: unknown): value is Function =>
  typeof value === "function" &&
  !aProxy(value) &&
  !aAsync(value) &&
  aProto(value) !== aAsyncPrototype;
function aFreezeData<T>(value:T):T{
  if(value&&typeof value==='object'){
    const names=aKeys(value);
    for(let i=0;i<names.length;i++){const row=aDescriptor(value,names[i]!);if(row&&aOwn(row,'value'))aFreezeData(row.value);}
    aFreeze(value);
  }
  return value;
}
function aFail(code: string): never {
  throw Error(code);
}
export function readOriginalDshAdmissionPort(owner: unknown, source: unknown) {
  const record = owner && typeof owner === "object" ? aRead(owner) : undefined;
  if (!record || !record.source || record.source !== source)
    aFail("DSH_A_ORIGINAL_SOURCE_REQUIRED");
  return record.port;
}
export function readOriginalDshUserControlPort(owner: unknown, source: unknown) {
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.userSource||record.userSource!==source)aFail('DSH_A_ORIGINAL_USER_SOURCE_REQUIRED');
  return record.port;
}
export interface DshClaimedCommandView {
 readonly commandId:string;readonly operationKey:string;readonly operation:'apply_dsh_control'|'apply_dsh_command'|'prepare_dsh_slot';readonly command:Readonly<DshARecord>;
 readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly expectedOwnerDomainId:string;
 readonly budgetReservation:Readonly<{receipt:object;reserveProof:object}>|null;
 assertCurrent():void;assertLocal():void;
}
/** Warm accepted command membership only. Durable IDs cannot reconstruct an
 * effect capability after restart; cold consumers reconcile the original B. */
export function readOriginalDshClaimedCommand(realm:unknown,owner:unknown,source:unknown,claim:object):DshClaimedCommandView {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readClaimedCommand(realm,claim);
}
export interface DshGithubReadCommon {
 readonly schemaVersion:1;readonly profileId:string;readonly workspaceId:string;readonly tenantId:string;readonly accountId:string;
 readonly mode:'observe'|'auto_draft';readonly configurationRevision:number;readonly prefixModeGuardsHash:string;
 readonly guardRevisions:readonly Readonly<{scopeKey:string;epoch:number;revision:number}>[];readonly minimumIntervalMs:number;
 assertCurrent():void;assertLocal():void;
}
export type DshGithubReadAuthority=DshGithubReadCommon & (
 Readonly<{kind:'source_binding';sourceBindingId:string;credentialEpoch:number;providerAccountId:string;repository:Readonly<{repositoryId:string;nodeId:string;owner:string;repo:string}>;candidateIssueRefs:readonly Readonly<{issueId:string;issueNumber:number}>[];verifiedIssueRefs:readonly Readonly<Record<string,unknown>>[];sourceBindingRevision:number;sourceBindingVersion:number;actorMappingVersion:number;provenanceVersion:number;authScope:Readonly<{tenantId:string;workspaceId:string;connectionId:string;providerAccountId:string;repositoryId:string;credentialEpoch:number}>;selection:Readonly<Record<string,unknown>>}>|
 Readonly<{kind:'source_setup';setupId:string;candidateRepository:Readonly<{owner:string;repo:string}>}>
);
export function readOriginalDshGithubReadAuthority(realm:unknown,owner:unknown,source:unknown,proof:object,purpose:'source_binding'|'source_setup'){
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  return record.readGithubAuthority(realm,proof,purpose) as DshGithubReadAuthority;
}
export interface DshDesktopState {
 readonly schemaVersion:1;readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;
 readonly authority:DshARecord|null;readonly sourceSetups:readonly DshARecord[];
 readonly sourceConfigurations:readonly DshARecord[];readonly modes:readonly DshARecord[];readonly scopePolicies:readonly DshARecord[];readonly sourceCheckpoints:readonly DshARecord[];
 readonly pendingOwnerCommands:readonly Readonly<{commandId:string;ownerDomain:string;deliveryRevision:number;state:'pending'|'leased'|'delivery_unknown';reconcileOnly:boolean;operation:'apply_dsh_control'|'apply_dsh_command'|'prepare_dsh_slot'}>[];
 readonly authorizations:Readonly<{ownerDomains:readonly DshARecord[];publishedMandates:readonly DshARecord[];egressPolicies:readonly DshARecord[]}>;readonly pendingBaseline:boolean;readonly executionQualified:false;
}
export function readOriginalDshDesktopState(realm:unknown,owner:unknown,source:unknown,scope:unknown){
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  return aFreezeData(record.readDesktopState(realm,scope)) as DshDesktopState;
}
export interface DshAssessmentRequestView {
 readonly schemaVersion:1;readonly kind:'dsh_assessment_request_v1';readonly attemptId:string;
 readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;readonly principalId:string;
 readonly authorityId:string;readonly authorityEpoch:number;readonly budgetAuthorityHash:string;
 readonly accountId:string;readonly mandate:Readonly<DshARecord>;readonly attempt:Readonly<DshARecord>;
 readonly input:Readonly<DshARecord>;readonly proof:Readonly<DshARecord>;readonly evidenceManifest:Readonly<DshARecord>;
 readonly model:Readonly<{modelId:string;promptVersion:string;ruleVersion:string;dataEgressPolicyRef:string}>;
 readonly sourceSnapshotRefs:readonly string[];readonly tenantId:string;readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;readonly inputId:string;readonly evidenceManifestHash:string;readonly modelId:string;readonly promptVersion:string;readonly ruleVersion:string;readonly dataEgressPolicyRef:string;readonly validUntil:number;readonly assessmentVersion:1|2;readonly purpose:'admission'|'preview';readonly operationKey:string;readonly semanticPayloadHash:string;readonly maxAttempts:number;readonly deadline:number;readonly evidenceRefs:readonly string[];assertCurrent():void;assertLocal():void;
}
export function readOriginalDshAssessmentRequest(realm:unknown,owner:unknown,source:unknown,attemptId:string):DshAssessmentRequestView{
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  return record.readAssessmentRequest(realm,attemptId);
}
export function assertOriginalDshAssessmentExecutionAuthority(realm:unknown,owner:unknown,source:unknown,attemptId:string):void{
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  record.assertAssessmentExecution(realm,attemptId);
}
export function readOriginalDshAssessmentSourceBody(realm:unknown,owner:unknown,source:unknown,attemptId:string):readonly Readonly<{inputId:string;snapshotRef:string;objectKind:string;objectId:string;providerRevision:string;contentHash:string;title:string|null;body:string|null}>[]{
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  return record.readAssessmentBody(realm,attemptId);
}
export interface DshDraftSourceBodyView {
 readonly command:Readonly<DshARecord>;readonly slot:Readonly<DshARecord>;readonly inputManifest:Readonly<DshARecord>;
 readonly bodies:readonly Readonly<{inputId:string;snapshotRef:string;objectKind:string;objectId:string;providerRevision:string;contentHash:string;title:string|null;body:string|null}>[];
 readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;readonly tenantId:string;readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;readonly budgetAuthorityHash:string;readonly accountId:string;
 readonly budgetReservation:DshClaimedCommandView['budgetReservation'];readonly ownerVersion:number;readonly modelId:string;readonly provider:string;readonly destinationRef:string;readonly dataEgressPolicyRef:string;readonly validUntil:number;readonly deadline:number;
 assertCurrent():void;assertLocal():void;
}
export function readOriginalDshDraftSourceBody(realm:unknown,owner:unknown,source:unknown,claim:object,slotDelivery:object):DshDraftSourceBodyView {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readDraftBody(realm,claim,slotDelivery);
}
export interface DshUserBudgetAudience {
 readonly kind:'main_dsh_user_budget_audience_v1';readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;
 readonly principalId:string;readonly tenantId:string;readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;
 readonly authorityId:string;readonly issuerEpoch:number;readonly budgetAuthorityHash:string;readonly accountId:string;
 readonly headRevision:number;readonly publishedMandateRevision:number|null;
 assertCurrent():void;assertLocal():void;
}
export function readOriginalDshUserBudgetAudience(realm:unknown,owner:unknown,source:unknown,userProof:object,bodyHash:string):DshUserBudgetAudience {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readUserBudgetAudience(realm,userProof,bodyHash);
}
export interface DshBudgetObservationAudience {
 readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;readonly tenantId:string;
 readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;
 readonly budgetAuthorityHash:string;readonly accountId:string;readonly maxActiveWorks:number;readonly maxDraftRequestsPerWork:number;assertCurrent():void;assertLocal():void;
}
export function readOriginalDshBudgetObservationAudience(realm:unknown,owner:unknown,source:unknown,mandateId:string):DshBudgetObservationAudience{
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readBudgetObservationAudience(realm,mandateId);
}
/** Accounting of an already accepted original command. This does not restore
 * its effect permission after mode, Mandate or Source revocation. */
export function readOriginalDshBudgetSettlementAudience(
 realm:unknown,owner:unknown,source:unknown,delivery:unknown,runtime:unknown,budgetSource:unknown,
):DshBudgetObservationAudience {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readBudgetSettlementAudience(realm,delivery,runtime,budgetSource);
}
export interface DshAutoAdmissionWindowView {
 readonly window:FrozenAutoAdmissionWindow;
 readonly observationsEndAt:string;
 readonly qualification:'operational-v1';
 readonly profile:'freshness_operational_v1';
 readonly isolationMs:300000;
 assertCurrent():void;assertLocal():void;
}
/** Original SQL window plus live Native clock epoch; copied window data is not
 * a freshness, model, budget or execution capability. */
export function readOriginalDshAutoAdmissionWindow(realm:unknown,owner:unknown,source:unknown,sourceBindingId:string,mandateId:string):DshAutoAdmissionWindowView|null {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readAutoAdmissionWindow(realm,sourceBindingId,mandateId);
}
export function readOriginalDshAutoAdmissionWindowBaseline(realm:unknown,owner:unknown,source:unknown,sourceBindingId:string,mandateId:string):Readonly<{expectedPrefixModeHash:string;assertCurrent():void;assertLocal():void}> {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readWindowBaseline(realm,sourceBindingId,mandateId);
}
export interface DshDraftAdmissionRequestView {
 readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;readonly tenantId:string;
 readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;readonly budgetAuthorityHash:string;
 readonly accountId:string;readonly bindingId:string;readonly generation:1;readonly thread:Readonly<DshARecord>;
 readonly initialTokens:number;readonly initialCostMicros:number;readonly deadline:number;readonly maxActiveWorks:number;readonly maxDraftRequestsPerWork:number;
 readonly command:Readonly<{operationKey:string;semanticPayloadHash:string;assessmentRef:string;purpose:'draft_admission'|'draft_prepare'}>;
 assertCurrent():void;assertLocal():void;
}
export function readOriginalDshDraftAdmissionRequest(realm:unknown,owner:unknown,source:unknown,proposal:object):DshDraftAdmissionRequestView {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readDraftAdmissionRequest(realm,proposal);
}
export interface DshAdmissionPlan {
 readonly bindingId:string;readonly inputId:string;readonly proofVersion:number;readonly mandateId:string;
 readonly requestedVersion:1|2;readonly expectedSelectionRevision:0|1|2;readonly expectedBindingRevision:number;
 readonly attemptId:string|null;readonly candidateId:string|null;
 readonly disposition:'assess'|'evaluate'|'reconcile'|'review';assertCurrent():void;assertLocal():void;
}
/** SQL revisions and accepted input identities only. This view is never a body,
 * budget, assessment, command or model-execution authorization. */
export function readOriginalDshAdmissionPlans(realm:unknown,owner:unknown,source:unknown,scan:object):readonly DshAdmissionPlan[] {
 const record=owner&&typeof owner==='object'?aRead(owner):undefined;
 if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
 return record.readAdmissionPlans(realm,scan);
}
export interface DshDomainMetadata {
 readonly schemaVersion:1;readonly kind:'main_dsh_domain_metadata';
 readonly storageScope:Readonly<{profileId:string;workspaceId:string}>;
 readonly principalId:string;readonly authorityId:string;readonly authorityEpoch:number;
 readonly revision:number;readonly state:string;readonly budgetAuthorityHash:string;
 readonly budget:Readonly<{ownerId:string;accountId:string;unitProfile:'dsh_budget_usd_micros_v1'}>|null;
}
export function readOriginalDshDomainMetadata(realm:unknown,owner:unknown,source:unknown,scope:unknown){
  const record=owner&&typeof owner==='object'?aRead(owner):undefined;
  if(!record||!record.source||record.source!==source)aFail('DSH_A_ORIGINAL_SOURCE_REQUIRED');
  const view=record.readDomainMetadata(realm,scope) as DshDomainMetadata;
  aFreeze(view.storageScope);if(view.budget)aFreeze(view.budget);return aFreeze(view);
}
function admissionSource(options: object, key = "dshAdmissionSource"): object | undefined {
  if (aProxy(options)) aFail("DSH_A_SOURCE_INVALID");
  const row = aDescriptor(options, key);
  if (!row) return;
  if (!aOwn(row, "value")) aFail("DSH_A_SOURCE_INVALID");
  const value = row.value;
  if (value === null || value === undefined) return;
  if (typeof value !== "object" || aProxy(value)) aFail("DSH_A_SOURCE_INVALID");
  const fn = aDescriptor(value, "resolve");
  if (!fn || !aOwn(fn, "value") || !aSync(fn.value))
    aFail("DSH_A_SOURCE_INVALID");
  return value;
}
function admissionBudgetBinding(options:object) {
  const slot=aDescriptor(options,'dshBudgetBinding');
  if(!slot)return;
  if(!aOwn(slot,'value')||!slot.value||typeof slot.value!=='object'||aProxy(slot.value))aFail('DSH_A_BUDGET_BINDING_REQUIRED');
  dshAFields(slot.value,['runtime','exactConstructorSource']);
  const runtime=slot.value.runtime,source=slot.value.exactConstructorSource;
  const binding=readOriginalDshBudgetRuntimeBinding(runtime,source);
  return aFreeze({runtime,source,port:binding.port,binding});
}
function admissionOwnerBinding(options:object){
 const slot=aDescriptor(options,'dshOwnerBinding');if(!slot)return;
 if(!aOwn(slot,'value')||!slot.value||typeof slot.value!=='object'||aProxy(slot.value))aFail('DSH_A_OWNER_BINDING_REQUIRED');
 dshAFields(slot.value,['service','exactAdmission']);
 const service=slot.value.service,admission=slot.value.exactAdmission;
 if(!aSync(admission))aFail('DSH_A_OWNER_BINDING_REQUIRED');
 const scope=readKSwarmOwnedDshServiceScope(service,admission as KSwarmDshAdmission);
 return aFreeze({service,admission:admission as KSwarmDshAdmission,scope});
}
function birthDshAdmissionChild(
  owner: DesktopMultiAgentStore,
  db: AuthorityDatabase,
  source: object | undefined,
  userSource: object | undefined,
  budgetBinding: ReturnType<typeof admissionBudgetBinding>,
  ownerBinding: ReturnType<typeof admissionOwnerBinding>,
  bootId: string,
  maxBytes: number,
  reserveBytes: number,
  databaseBundle: OriginalAdmissionDatabaseBundle | null,
) {
  // Only the original Core reader supplies this immutable, same-addon bundle.
  // A facade receiver does not possess Node DatabaseSync/StatementSync brands.
  const aExec=databaseBundle?.databaseMethods.exec??aOriginalDatabaseMethods.exec,
    aPrepare=databaseBundle?.databaseMethods.prepare??aOriginalDatabaseMethods.prepare,
    aFunction=databaseBundle?.databaseMethods.function??aOriginalDatabaseMethods.function,
    aClose=databaseBundle?.databaseMethods.close??aOriginalDatabaseMethods.close,
    aGet=databaseBundle?.statementMethods.get??aOriginalStatementMethods.get,
    aAll=databaseBundle?.statementMethods.all??aOriginalStatementMethods.all,
    aRun=databaseBundle?.statementMethods.run??aOriginalStatementMethods.run;
  const writer = knownMultiAgentWriter(owner),
    resolve = source
      ? (aDescriptor(source, "resolve")!.value as Function)
      : undefined;
  const userResolve = userSource
    ? (aDescriptor(userSource, "resolve")!.value as Function)
    : undefined;
  const tx = aDescriptor(db, "isTransaction"),
    nativeTransaction =
      tx?.configurable === false && typeof tx.get === "function"
        ? tx.get
        : undefined;
  const pending = createIntrinsicSet<object>(),
    unknown = createIntrinsicSet<unknown>(),
    observed = createIntrinsicSet<unknown>(),
    waiters = createIntrinsicSet<() => void>();
  const commandClaims = new WeakMap<
    object,
    { realm: unknown; view: DshClaimedCommandView }
  >();
  const admissionProposals = new WeakMap<
    object,
    {
      realm: unknown;
      frame: object;
      context: unknown;
      data: DshARecord;
      calculation: ReturnType<typeof calculateAdmission>;
      view: DshDraftAdmissionRequestView;
      accept(commandId: string): void;
    }
  >();
  const draftProposals = new WeakMap<
    object,
    {
      realm: unknown;
      data: DshARecord;
      view: DshDraftAdmissionRequestView;
      command: Readonly<DshARecord>;
      scopeId: string;
      targetDomain: string;
      accept(commandId: string): void;
    }
  >();
  // Warm original authority inventory only; durable JSON never reconstructs it.
  const warmCommandAuthorities: Array<{
    commandId: string;
    receipt: object;
    reserveProof: object;
    current(): void;
    reserved(): void;
    local(): void;
  }> = [];
  let operationKind: string | null = null;
  let authorizationRevision = 0,
    sourceAuthorizationRevision = 0;
  let abandoned = false,
    cleanupStarted = false;
  let retainedWitness = 0;
  let closed = false,
    claimed = false,
    busy = false,
    sourceFault = false,
    guard: (() => void) | undefined,
    firstPresent = false,
    first: unknown;
  function remember(value: unknown) {
    if (!firstPresent) {
      firstPresent = true;
      first = value;
    }
  }
  function poison(value: unknown) {
    remember(value);
    writer.outcomeUnknown ??= {
      stage: "admission",
      primary: value,
      secondaryPresent: false,
    };
  }
  function wake() {
    if (abandoned && !cleanupStarted && !pending.size && !unknown.size) {
      cleanupStarted = true;
      try {
        syncCall(aClose, db, [], (value) => value === undefined, true);
      } catch (error) {
        remember(error);
        unknown.add(error);
      }
    }
    if (!pending.size && !unknown.size) aUnconfirmedOwners.delete(owner);
    const rows = waiters.snapshot();
    for (let i = 0; i < rows.length; i++) rows[i]!();
  }
  function retain(raw: unknown, kind: "promise" | "unknown") {
    retainedWitness++;
    aUnconfirmedOwners.add(owner);
    if (kind === "unknown") unknown.add(raw);
    if (!aPromise(raw) || aProxy(raw) || observed.has(raw)) return;
    observed.add(raw);
    const row = { raw };
    pending.add(row);
    try {
      assertStandardIpcPromise(raw, "DSH_A_SDK_OBSERVATION_UNKNOWN");
      aApply(aThen, raw, [
        (value: unknown) => finish(value),
        (error: unknown) => {
          remember(error);
          finish(error);
        },
      ]);
    } catch (error) {
      unknown.add(raw);
      pending.delete(row);
      remember(error);
      wake();
    }
    function finish(value: unknown) {
      try {
        retainSourceErrorTails(value, retain);
      } catch (error) {
        unknown.add(raw);
        remember(error);
      } finally {
        pending.delete(row);
        wake();
      }
    }
  }
  function inventory(value: unknown) {
    retainSourceErrorTails(value, retain);
  }
  function pureLocal() {
    if (closed || !claimed) aFail("DSH_A_STORE_OWNER_UNAVAILABLE");
    if (sourceFault || writer.outcomeUnknown) aFail("DSH_A_SOURCE_UNCONFIRMED");
  }
  function local() {
    pureLocal();
    writer.fence?.assertOpen();
  }
  function syncCall(
    fn: Function,
    receiver: unknown,
    args: unknown[],
    accept: (value: unknown) => boolean,
    cleanup = false,
  ): unknown {
    const row = {};
    pending.add(row);
    try {
      if (!cleanup) {
        local();
        if (sourceFault) aFail("DSH_A_SOURCE_UNCONFIRMED");
      }
      let raw: unknown;
      try {
        raw = aApply(fn, receiver, args);
      } catch (error) {
        const before = retainedWitness;
        inventory(error);
        if (retainedWitness !== before) {
          sourceFault = true;
          poison(error);
        }
        throw error;
      }
      if (!accept(raw)) {
        inventory(raw);
        if (raw !== undefined)
          retain(raw, aPromise(raw) ? "promise" : "unknown");
        sourceFault = true;
        const error = Error("DSH_A_SDK_RETURN_UNCONFIRMED");
        poison(error);
        throw error;
      }
      return raw;
    } finally {
      pending.delete(row);
      wake();
    }
  }
  function nativeState(expected: boolean) {
    if (!nativeTransaction) aFail("DSH_A_NATIVE_TRANSACTION_UNAVAILABLE");
    const value = syncCall(
      nativeTransaction,
      db,
      [],
      (v) => typeof v === "boolean",
    );
    if (value !== expected) aFail("DSH_A_NATIVE_TRANSACTION_MISMATCH");
  }
  function invokeSource(
    fn: Function,
    receiver: unknown,
    args: unknown[],
    voidResult = false,
  ): unknown {
    if (!aSync(fn)) aFail("DSH_A_SOURCE_INVALID");
    const row = {};
    pending.add(row);
    try {
      let raw: unknown;
      try {
        raw = aApply(fn, receiver, args);
      } catch (error) {
        const before = retainedWitness;
        inventory(error);
        if (retainedWitness !== before) {
          sourceFault = true;
          poison(error);
        }
        throw error;
      }
      if (voidResult) {
        if (raw !== undefined) {
          inventory(raw);
          retain(raw, aPromise(raw) ? "promise" : "unknown");
          sourceFault = true;
          poison(Error("DSH_A_SOURCE_UNCONFIRMED"));
          aFail("DSH_A_SOURCE_UNCONFIRMED");
        }
        return;
      }
      if (
        !raw ||
        typeof raw !== "object" ||
        aProxy(raw) ||
        aPromise(raw) ||
        (aProto(raw) !== Object.prototype && aProto(raw) !== null)
      ) {
        inventory(raw);
        sourceFault = true;
        poison(Error("DSH_A_SOURCE_UNCONFIRMED"));
        aFail("DSH_A_SOURCE_UNCONFIRMED");
      }
      return raw;
    } finally {
      pending.delete(row);
      wake();
    }
  }
  function open(
    frame: object,
    purpose: string,
    ctx: unknown,
    setupSession?: unknown,
  ) {
    if (purpose === "control_receipt" || purpose === "owner_reconcile") {
      dshAFields(ctx, ["requestSource"]);
      if (ctx.requestSource !== "scheduler" || !ownerBinding)
        aFail("DSH_A_OWNER_BINDING_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [source, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const refs = invokeSource(readOriginalDshAdmissionReferences, undefined, [
        source,
        frame,
        purpose,
      ]) as { ownerObservation?: object };
      if (!refs.ownerObservation) aFail("DSH_A_OWNER_REPLY_REQUIRED");
      const view = invokeSource(readOriginalKSwarmDshReply, undefined, [
        ownerBinding.service,
        ownerBinding.admission,
        refs.ownerObservation,
      ]) as KSwarmDshReplyView;
      const raw = invokeSource(resolve!, source, [frame, purpose]) as {
        data: unknown;
        assertCurrent: Function;
      };
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(view.assertKnown, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        pureLocal();
      };
      // First snapshot may reserve a wait even while the known original reply
      // root is finishing. The writing phase calls the full fate guard.
      return {
        data: { request: captureIpcData(raw.data), reply: view },
        current: () => {
          invokeSource(qualification.assertCurrent, undefined, [], true);
          invokeSource(qualification.assertLocal, undefined, [], true);
          pureLocal();
        },
        userView: undefined,
        settledCurrent: current,
      };
    }
    if ((purpose === "register_broker_owner" || purpose === "broker_control_receipt")) {
      dshAFields(ctx,["requestSource","bootstrapAuthority"]);if(ctx.requestSource!=="scheduler")aFail("DSH_A_OWNER_BINDING_REQUIRED");
      const qualification=invokeSource(readOriginalMainDshBootstrapAuthority,undefined,[ctx.bootstrapAuthority,owner,source]) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const view=invokeSource(readOriginalMainDshBrokerReply,undefined,[frame,ctx.bootstrapAuthority,owner,source]) as OriginalMainDshBrokerReply;
      const current=()=>{invokeSource(qualification.assertCurrent,undefined,[],true);invokeSource(view.assertCurrent,undefined,[],true);invokeSource(view.assertKnown,undefined,[],true);invokeSource(qualification.assertLocal,undefined,[],true);local();};current();return {data:view,current,userView:undefined};
    }
    if (purpose === "register_owner") {
      dshAFields(ctx, ["requestSource", "bootstrapAuthority"]);
      if (ctx.requestSource !== "scheduler" || !ownerBinding)
        aFail("DSH_A_OWNER_BINDING_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const view = invokeSource(readOriginalKSwarmDshReply, undefined, [
        ownerBinding.service,
        ownerBinding.admission,
        frame,
      ]) as KSwarmDshReplyView;
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(view.assertCurrent, undefined, [], true);
        invokeSource(view.assertKnown, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        local();
      };
      current();
      return { data: view, current, userView: undefined };
    }
    if (purpose === "commit_source_scan") {
      dshAFields(ctx, ["requestSource", "bootstrapAuthority"]);
      if (ctx.requestSource !== "scheduler") aFail("DSH_A_SOURCE_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const value = invokeSource(readOriginalGithubSourceScan, undefined, [
        setupSession,
        frame,
        ctx.bootstrapAuthority,
        owner,
        source,
      ]) as ReturnType<typeof readOriginalGithubSourceScan>;
      if (
        value.qualification !== "budget_qualified" ||
        !value.authority ||
        !value.requestProof
      )
        aFail("DSH_A_SOURCE_SCAN_AUTHORITY_REQUIRED");
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(value.assertCurrent, undefined, [], true);
        invokeSource(value.authority!.assertLocal, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        local();
      };
      current();
      return { data: value, current, userView: undefined };
    }
    if (purpose === "commit_source_setup") {
      dshAFields(ctx, ["requestSource", "bootstrapAuthority"]);
      if (ctx.requestSource !== "scheduler") aFail("DSH_A_SOURCE_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const value = invokeSource(
        readOriginalGithubSourceSetupResult,
        undefined,
        [setupSession, frame, ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalGithubSourceSetupResult>;
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(value.assertCurrent, undefined, [], true);
        invokeSource(value.assertLocal, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        local();
      };
      current();
      return { data: value, current, userView: undefined };
    }
    if (
      purpose === "read_domain" ||
      purpose === "read_assessment" ||
      purpose === "read_budget_audience" ||
      purpose === "read_budget_settlement_audience" ||
      purpose === "read_draft_body" ||
      purpose === "read_window"
    ) {
      dshAFields(ctx, ["requestSource", "bootstrapAuthority"]);
      if (ctx.requestSource !== "scheduler") aFail("DSH_A_SOURCE_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        local();
      };
      if (purpose === "read_window") {
        dshAFields(frame, ["sourceBindingId", "mandateId"]);
        const data = captureIpcData(frame);
        if (
          typeof data.sourceBindingId !== "string" ||
          !data.sourceBindingId ||
          data.sourceBindingId.length > 256 ||
          typeof data.mandateId !== "string" ||
          !data.mandateId ||
          data.mandateId.length > 256
        )
          aFail("DSH_A_WINDOW_INVALID");
        current();
        return { data, current, userView: undefined };
      }
      if (purpose === "read_budget_audience") {
        dshAFields(frame, ["mandateId"]);
        const data = captureIpcData(frame);
        if (
          typeof data.mandateId !== "string" ||
          !data.mandateId ||
          data.mandateId.length > 256
        )
          aFail("DSH_A_MANDATE_REQUIRED");
        current();
        return { data, current, userView: undefined };
      }
      if (
        purpose === "read_budget_settlement_audience" ||
        purpose === "read_draft_body"
      ) {
        dshAFields(frame, ["commandId"]);
        const data = captureIpcData(frame);
        if (
          typeof data.commandId !== "string" ||
          !data.commandId ||
          data.commandId.length > 256
        )
          aFail("DSH_A_COMMAND_NOT_FOUND");
        current();
        return { data, current, userView: undefined };
      }
      if (purpose === "read_assessment") {
        current();
        dshAFields(frame, ["attemptId"]);
        const data = captureIpcData(frame);
        if (
          typeof data.attemptId !== "string" ||
          !data.attemptId ||
          data.attemptId.length > 256
        )
          aFail("DSH_A_ASSESSMENT_NOT_FOUND");
        return { data, current, userView: undefined };
      }
      current();
      dshAFields(frame, ["profileId", "workspaceId"]);
      const data = captureIpcData(frame);
      if (
        typeof data.profileId !== "string" ||
        typeof data.workspaceId !== "string" ||
        data.profileId.length !== 64 ||
        data.workspaceId.length !== 64
      )
        aFail("DSH_A_SCOPE_INVALID");
      const values = [data.profileId, data.workspaceId];
      for (let index = 0; index < values.length; index++) {
        const value = values[index]!;
        for (let i = 0; i < value.length; i++) {
          const code = aApply(aCharCode, value, [i]) as number;
          if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102)))
            aFail("DSH_A_SCOPE_INVALID");
        }
      }
      current();
      return { data, current, userView: undefined };
    }
    if (purpose === "pin_budget") {
      dshAFields(ctx, ["requestSource", "bootstrapAuthority"]);
      if (ctx.requestSource !== "scheduler" || !budgetBinding)
        aFail("DSH_A_BUDGET_BINDING_REQUIRED");
      const qualification = invokeSource(
        readOriginalMainDshBootstrapAuthority,
        undefined,
        [ctx.bootstrapAuthority, owner, source],
      ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
      const current = () => {
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        local();
      };
      current();
      invokeSource(budgetBinding.binding.assertCurrent, undefined, [], true);
      const value = invokeSource(readOriginalDshBudgetObservation, undefined, [
        budgetBinding.port,
        frame,
      ]);
      current();
      return { data: captureIpcData(value), current, userView: undefined };
    }
    const userControl =
      purpose === "enroll_authority" ||
      purpose === "mandate_control" ||
      purpose === "policy_control";
    const githubRead =
      purpose === "github_source_read" || purpose === "github_source_setup";
    dshAFields(
      ctx,
      userControl
        ? ["requestSource", "bodyHash", "bootstrapAuthority"]
        : githubRead
          ? ["requestSource", "bootstrapAuthority"]
          : ["requestSource"],
    );
    const githubQualification = githubRead
      ? (invokeSource(readOriginalMainDshBootstrapAuthority, undefined, [
          (ctx as DshARecord).bootstrapAuthority,
          owner,
          source,
        ]) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>)
      : undefined;
    if (userControl && ctx.requestSource !== "user")
      aFail("DSH_A_SOURCE_REQUIRED");
    if (purpose === "initialize" || purpose === "bind_source") {
      if (ctx.requestSource !== "user") aFail("DSH_A_SOURCE_REQUIRED");
    } else if (
      ctx.requestSource !== "user" &&
      ctx.requestSource !== "scheduler"
    )
      aFail("DSH_A_SOURCE_REQUIRED");
    const selectedSource = userControl ? userSource : source;
    const selectedResolve = userControl ? userResolve : resolve;
    if (!selectedResolve || !selectedSource) aFail("DSH_A_SOURCE_REQUIRED");
    local();
    if (sourceFault) aFail("DSH_A_SOURCE_UNCONFIRMED");
    const userView = userControl
      ? (invokeSource(readOriginalMainDshControl, undefined, [
          selectedSource,
          frame,
          owner,
          purpose,
          ctx.bodyHash,
        ]) as ReturnType<typeof readOriginalMainDshControl>)
      : undefined;
    const raw = invokeSource(selectedResolve, selectedSource, [frame, purpose]),
      witness = retainedWitness;
    const fields = aDescriptors(raw);
    const names = aKeys(fields);
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!,
        row = aDescriptor(raw, key);
      if (!row || !aOwn(row, "value") || !row.enumerable) {
        retain(raw, "unknown");
        continue;
      }
      if (key !== "assertCurrent" || !aSync(row.value)) inventory(row.value);
    }
    if (retainedWitness !== witness) {
      sourceFault = true;
      poison(Error("DSH_A_SOURCE_UNCONFIRMED"));
      aFail("DSH_A_SOURCE_UNCONFIRMED");
    }
    if (
      names.length !== 2 ||
      !aOwn(fields, "data") ||
      !aOwn(fields, "assertCurrent") ||
      !aOwn(fields.data!, "value") ||
      !aOwn(fields.assertCurrent!, "value") ||
      !aSync(fields.assertCurrent!.value)
    )
      aFail("DSH_A_SOURCE_INVALID");
    const current = () => {
      invokeSource(fields.assertCurrent!.value, undefined, [], true);
      if (userView) {
        if (userView.assertCurrent !== fields.assertCurrent!.value)
          invokeSource(userView.assertCurrent, undefined, [], true);
        invokeSource(userView.assertLocal, undefined, [], true);
      }
      if (githubQualification) {
        invokeSource(githubQualification.assertCurrent, undefined, [], true);
        invokeSource(githubQualification.assertLocal, undefined, [], true);
      }
      local();
    };
    current();
    if (purpose === "migrate_admission")
      dshAFields(fields.data!.value, [
        "schemaVersion",
        "expectedProfileDigest",
      ]);
    if (purpose === "read_basis")
      dshAFields(fields.data!.value, [
        "schemaVersion",
        "bindingId",
        "inputId",
        "proofVersion",
        "mandateId",
      ]);
    const captured = captureIpcData(fields.data!.value);
    if (
      userView &&
      dshAHash([
        "main_dsh_control_request_v1",
        purpose,
        userView.storageScope,
        userView.principalId,
        captured,
      ]) !== userView.bodyHash
    )
      aFail("DSH_A_USER_BODY_CONFLICT");
    return { data: captured as unknown, current, userView };
  }
  function beforeSql(cleanup = false) {
    if (!cleanup) {
      guard?.();
      local();
    }
  }
  function statement(sql: string) {
    beforeSql();
    return syncCall(
      aPrepare,
      db,
      [sql],
      (value) =>
        !!value &&
        typeof value === "object" &&
        !aProxy(value) &&
        !aPromise(value),
    ) as StatementSync;
  }
  function captureSqlOutcome(raw: unknown): unknown {
    const before = retainedWitness;
    inventory(raw);
    if (retainedWitness !== before) {
      const error = Error("DSH_A_SQL_OUTCOME_UNCONFIRMED");
      sourceFault = true;
      poison(error);
      throw error;
    }
    try {
      return captureIpcData(raw);
    } catch (error) {
      sourceFault = true;
      poison(error);
      throw error;
    }
  }
  function get(sql: string, args: unknown[] = []): DshARecord | undefined {
    const stmt = statement(sql);
    const raw = syncCall(
      aGet,
      stmt,
      args,
      (value) =>
        value === undefined ||
        (!!value &&
          typeof value === "object" &&
          !aProxy(value) &&
          !aPromise(value)),
    );
    return raw === undefined
      ? undefined
      : (captureSqlOutcome(raw) as DshARecord);
  }
  function all(sql: string, args: unknown[] = []): DshARecord[] {
    const stmt = statement(sql),
      raw = syncCall(aAll, stmt, args, (value) => aArray(value));
    return captureSqlOutcome(raw) as DshARecord[];
  }
  function run(sql: string, args: unknown[] = []) {
    const stmt = statement(sql),
      raw = syncCall(
        aRun,
        stmt,
        args,
        (value) =>
          !!value &&
          typeof value === "object" &&
          !aProxy(value) &&
          !aPromise(value),
      );
    return captureSqlOutcome(raw) as {
      changes: number | bigint;
    };
  }
  function exec(sql: string, cleanup = false) {
    beforeSql(cleanup);
    return syncCall(aExec, db, [sql], (value) => value === undefined, cleanup);
  }
  function requireProfile() {
    const version = get("PRAGMA user_version")?.user_version;
    if (version !== 5 && version !== 6) aFail("DSH_A_PROFILE_REQUIRED");
    readCapturedGroupsSchema(
      all(
        "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
      ) as unknown as Parameters<typeof readCapturedGroupsSchema>[0],
      version,
    );
    const row = get("SELECT * FROM dsh_a_profile WHERE singleton=1");
    if (
      row?.profile !==
        (version === 6 ? DSH_A_AUTHORITY_PROFILE : DSH_A_PROFILE) ||
      row.digest !== (version === 6 ? DSH_A_AUTHORITY_DIGEST : DSH_A_DIGEST)
    )
      aFail("DSH_A_PROFILE_INTEGRITY");
  }
  function readData(
    table:
      | (typeof DSH_A_TABLES)[number]
      | (typeof DSH_A_AUTHORITY_TABLES)[number],
    column: string,
    key: string,
  ) {
    const row = get(
      "SELECT data_json FROM " + table + " WHERE " + column + "=?",
      [key],
    );
    if (!row) return;
    return captureIpcData(aJsonParse(row.data_json as string)) as DshARecord;
  }
  function writeRow(
    table:
      | (typeof DSH_A_TABLES)[number]
      | (typeof DSH_A_AUTHORITY_TABLES)[number],
    keyFields: DshARecord,
    indexFields: DshARecord,
    data: DshARecord,
    replace = false,
  ) {
    const encoded = dshAJson(data),
      size = aByteLength(encoded);
    if (size > (table === "dsh_a_source_snapshots" ? 1024 * 1024 : 65536))
      aFail("DSH_A_RECORD_TOO_LARGE");
    let bytes = 0;
    for (let i = 1; i < DSH_A_TABLES.length; i++)
      bytes += aNumber(
        get(
          "SELECT coalesce(sum(logical_bytes),0) AS n FROM " + DSH_A_TABLES[i],
        )?.n ?? 0,
      );
    if (get("PRAGMA user_version")?.user_version === 6)
      for (let i = 0; i < DSH_A_AUTHORITY_TABLES.length; i++)
        bytes += aNumber(
          get(
            "SELECT coalesce(sum(logical_bytes),0) AS n FROM " +
              DSH_A_AUTHORITY_TABLES[i],
          )?.n ?? 0,
        );
    if (bytes + size > maxBytes - reserveBytes) aFail("DSH_A_METADATA_QUOTA");
    const columns = {
        ...keyFields,
        ...indexFields,
        data_json: encoded,
        logical_bytes: size,
      },
      names = aKeys(columns) as string[],
      values: unknown[] = [],
      marks: string[] = [],
      updates: string[] = [],
      where: string[] = [],
      keyValues: unknown[] = [],
      keys = aKeys(keyFields) as string[];
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!;
      aPush(values, (columns as DshARecord)[key]);
      aPush(marks, "?");
      if (!aOwn(keyFields, key)) aPush(updates, key + "=excluded." + key);
    }
    for (let i = 0; i < keys.length; i++) {
      aPush(where, keys[i] + "=?");
      aPush(keyValues, keyFields[keys[i]!]);
    }
    const sql =
      "INSERT INTO " +
      table +
      "(" +
      aJoin(names) +
      ") VALUES(" +
      aJoin(marks) +
      ")" +
      (replace
        ? " ON CONFLICT(" + aJoin(keys) + ") DO UPDATE SET " + aJoin(updates)
        : "");
    if (aNumber(run(sql, values).changes) !== 1)
      aFail("DSH_A_WRITESET_UNCONFIRMED");
    let condition = "";
    for (let i = 0; i < where.length; i++) {
      if (i) condition += " AND ";
      condition += where[i];
    }
    const row = get(
      "SELECT data_json FROM " + table + " WHERE " + condition,
      keyValues,
    );
    if (row?.data_json !== encoded) aFail("DSH_A_WRITESET_UNCONFIRMED");
  }
  function recordBindingRevision(row: DshARecord) {
    if (get("PRAGMA user_version")?.user_version !== 6) return;
    const binding = row.binding as DshARecord,
      sourceKey = dshASourceKey(
        binding.provider,
        binding.authScope as DshARecord,
      );
    const body = {
      schemaVersion: 1,
      bindingId: binding.bindingId,
      bindingRevision: row.revision,
      sourceKey,
      binding,
    };
    const prior = get(
      "SELECT data_json FROM dsh_a_source_binding_revisions WHERE binding_id=? AND binding_revision=?",
      [binding.bindingId, row.revision],
    );
    if (prior) {
      if (prior.data_json !== dshAJson(body))
        aFail("DSH_A_BINDING_HISTORY_CONFLICT");
      return;
    }
    writeRow(
      "dsh_a_source_binding_revisions",
      { binding_id: binding.bindingId, binding_revision: row.revision },
      {
        source_key: sourceKey,
        body_hash: dshAHash([
          "dsh-a-authority-row-v1",
          "dsh_a_source_binding_revisions",
          body,
        ]),
      },
      body,
    );
  }
  function importInput(data: unknown) {
    requireProfile();
    dshAFields(data, [
      "bindingId",
      "expectedBindingRevision",
      "envelope",
      "comparison",
    ]);
    const binding = readData(
      "dsh_a_source_bindings",
      "binding_id",
      data.bindingId as string,
    );
    if (
      !binding ||
      binding.status !== "active" ||
      binding.revision !== data.expectedBindingRevision
    )
      aFail("DSH_A_BINDING_UNAVAILABLE");
    dshAEnvelope(data.envelope);
    const envelope = data.envelope,
      details = binding.binding as DshARecord;
    if (
      (envelope.thread as DshARecord).sourceBindingId !== data.bindingId ||
      dshAJson(details.authScope) !== dshAJson(envelope.authScope)
    )
      aFail("DSH_A_SCOPE_MISMATCH");
    const observation = dshAObservation(envelope),
      objectId = dshSourceObjectIdentity(observation),
      old = readData("dsh_a_object_heads", "object_id", objectId),
      state = old?.state ?? { current: null, freeze: null },
      reduced = reduceDshSourceObjectHead(state, observation, data.comparison),
      inputKey = dshAInputKey(envelope),
      inputId = "dsh-input:" + inputKey,
      existing = readData("dsh_a_inbox", "input_id", inputId);
    const input = existing ?? { inputId, envelope };
    if (!existing)
      writeRow(
        "dsh_a_inbox",
        { input_id: inputId },
        {
          input_key: inputKey,
          binding_id: data.bindingId,
          object_id: objectId,
        },
        input,
      );
    const proof = dshAProof(envelope),
      proofHash = dshAHash(proof),
      version = envelope.provenanceVersion as number,
      prior = get(
        "SELECT data_json,proof_hash FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
        [inputId, version],
      );
    if (prior) {
      if (prior.proof_hash !== proofHash) aFail("DSH_A_PROOF_CONFLICT");
    } else
      writeRow(
        "dsh_a_input_proofs",
        { input_id: inputId, proof_version: version },
        { proof_hash: proofHash },
        proof,
      );
    if (!old || dshAJson(old.state) !== dshAJson(reduced.state))
      writeRow(
        "dsh_a_object_heads",
        { object_id: objectId },
        {
          binding_id: data.bindingId,
          revision: old ? aNumber(old.revision) + 1 : 1,
        },
        {
          objectId,
          revision: old ? aNumber(old.revision) + 1 : 1,
          state: reduced.state,
        },
        true,
      );
    return {
      ok: true,
      input,
      proof,
      objectId,
      objectHead: reduced.state,
      disposition: reduced.disposition,
      invalidatedRevision: reduced.invalidatedRevision,
    };
  }
  function capturedGithubRow(
    table: GithubSourceStorageRow["table"],
    row: DshARecord,
  ): GithubSourceStorageRow {
    const data = captureIpcData(
      aJsonParse(row.data_json as string),
    ) as DshARecord;
    let key: DshARecord, index: DshARecord;
    if (table === "dsh_a_source_scans") {
      key = { scan_id: row.scan_id };
      index = {
        binding_id: row.binding_id,
        binding_revision: row.binding_revision,
        read_set_id: row.read_set_id,
      };
    } else if (table === "dsh_a_source_reads") {
      key = { attempt_id: row.attempt_id };
      index = { scan_id: row.scan_id, plan_hash: row.plan_hash };
    } else if (table === "dsh_a_source_snapshots") {
      key = { snapshot_id: row.snapshot_id };
      index = {
        binding_id: row.binding_id,
        read_attempt_id: row.read_attempt_id,
        entry_index: row.entry_index,
        role: row.role,
        content_hash: row.content_hash,
      };
    } else if (table === "dsh_a_source_read_sets") {
      key = { read_set_id: row.read_set_id };
      index = { scan_id: row.scan_id, binding_id: row.binding_id };
    } else {
      key = { binding_id: row.binding_id };
      index = {
        revision: row.revision,
        scan_id: row.scan_id,
        read_set_id: row.read_set_id,
      };
    }
    const value = {
      table,
      key,
      index,
      data,
      json: row.data_json as string,
      hash: row.body_hash as string,
      bytes: row.logical_bytes as number,
    };
    readGithubSourceRow(table, value);
    return value;
  }
  function sourceCheckpoint(row: DshARecord) {
    const checkpoint = capturedGithubRow(
      "dsh_a_source_content_checkpoints",
      row,
    );
    if (
      !aInteger(checkpoint.data.revision) ||
      checkpoint.data.revision !== aNumber(checkpoint.data.expectedRevision) + 1
    )
      aFail("DSH_A_SOURCE_CHECKPOINT_CONFLICT");
    const scanRow = get("SELECT * FROM dsh_a_source_scans WHERE scan_id=?", [
        row.scan_id,
      ]),
      setRow = get("SELECT * FROM dsh_a_source_read_sets WHERE read_set_id=?", [
        row.read_set_id,
      ]);
    if (!scanRow || !setRow) aFail("DSH_A_SOURCE_CHECKPOINT_CONFLICT");
    const scan = capturedGithubRow("dsh_a_source_scans", scanRow),
      readSet = capturedGithubRow("dsh_a_source_read_sets", setRow),
      reads: GithubSourceStorageRow[] = [],
      snapshots: GithubSourceStorageRow[] = [];
    const actualReads = all(
      "SELECT * FROM dsh_a_source_reads WHERE scan_id=? ORDER BY rowid",
      [row.scan_id],
    );
    for (let i = 0; i < actualReads.length; i++)
      aPush(reads, capturedGithubRow("dsh_a_source_reads", actualReads[i]!));
    const actualSnapshots = all(
      "SELECT s.* FROM dsh_a_source_snapshots s JOIN dsh_a_source_reads r ON r.attempt_id=s.read_attempt_id WHERE r.scan_id=? ORDER BY s.rowid",
      [row.scan_id],
    );
    for (let i = 0; i < actualSnapshots.length; i++)
      aPush(
        snapshots,
        capturedGithubRow("dsh_a_source_snapshots", actualSnapshots[i]!),
      );
    const full = validateGithubSourceRelations({
      scan,
      reads,
      snapshots,
      readSet,
      checkpoint,
      imports: [],
      observations: [],
    });
    if (
      full.bindingId !== row.binding_id ||
      full.scanId !== row.scan_id ||
      readSet.data.pagination !== "complete"
    )
      aFail("DSH_A_SOURCE_CHECKPOINT_CONFLICT");
    return {
      ...checkpoint.data,
      sourceSnapshotAt: full.completedAt,
      pagination: readSet.data.pagination,
    };
  }
  function userDomain(
    user: ReturnType<typeof readOriginalMainDshControl> | undefined,
    context: unknown,
  ) {
    if (!user) aFail("DSH_A_USER_AUTHORITY_REQUIRED");
    const realm = (context as { bootstrapAuthority: unknown })
      .bootstrapAuthority;
    const qualification = invokeSource(
      readOriginalMainDshBootstrapAuthority,
      undefined,
      [realm, owner, source],
    ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
    const previous = guard;
    guard = () => {
      previous?.();
      invokeSource(qualification.assertCurrent, undefined, [], true);
      invokeSource(user.assertLocal, undefined, [], true);
      invokeSource(qualification.assertLocal, undefined, [], true);
      local();
    };
    guard();
    const floor = get("SELECT store_id FROM dsh_a_profile WHERE singleton=1")!;
    const scopeId = dshAHash([
      "dsh-a-domain-v1",
      floor.store_id,
      user.storageScope,
    ]);
    const row = get("SELECT * FROM dsh_a_domains WHERE scope_id=?", [scopeId]);
    if (
      !row ||
      row.principal_id !== user.principalId ||
      row.profile_id !== user.storageScope.profileId ||
      row.workspace_id !== user.storageScope.workspaceId
    )
      aFail("DSH_A_DOMAIN_REQUIRED");
    const domain = captureIpcData(
      aJsonParse(row.data_json as string),
    ) as DshARecord;
    if (
      row.body_hash !==
      dshAHash(["dsh-a-authority-row-v1", "dsh_a_domains", domain])
    )
      aFail("DSH_A_DOMAIN_CONFLICT");
    return { row, domain, scopeId, scope: user.storageScope };
  }
  function authorityWrite(
    table: Parameters<typeof writeRow>[0],
    key: DshARecord,
    index: DshARecord,
    value: DshARecord,
    replace = false,
  ) {
    if (table === "dsh_a_control_heads" && replace)
      assertPermissiveFenceSettled(key, value);
    writeRow(
      table,
      key,
      {
        ...index,
        body_hash: dshAHash(["dsh-a-authority-row-v1", table, value]),
      },
      value,
      replace,
    );
  }
  function assertPermissiveFenceSettled(key: DshARecord, next: DshARecord) {
    const value = next.value as DshARecord;
    const permissive =
      next.recordKind === "policy"
        ? next.axis === "mode"
          ? value.mode === "auto_draft"
          : value.allowed === true
        : next.axis === "source_auth" || next.axis === "mandate"
          ? value.status === "active"
          : next.axis === "egress"
            ? value.enabled === true
            : next.axis === "readonly";
    if (!permissive) return;
    // Never cover an accepted, unconfirmed B fence with a later allow. Check
    // all prior targets as well as the immediate head, so a cold WIP history
    // cannot turn an already superseded narrowing into an acknowledgement.
    const targets = all(
      "SELECT t.*,c.target_epoch guard_epoch FROM dsh_a_control_targets t JOIN dsh_a_control_operations c ON c.scope_id=t.scope_id AND c.operation_id=t.operation_id JOIN dsh_a_owner_domains o ON o.scope_id=t.scope_id AND o.owner_domain=t.owner_domain WHERE t.scope_id=? AND c.control_id=? AND o.owner_kind='work' ORDER BY c.target_epoch,t.operation_id,t.owner_domain",
      [key.scope_id, key.control_id],
    );
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]!,
        target = authorityBody("dsh_a_control_targets", row);
      if (
        target.controlId !== key.control_id ||
        target.operationId !== row.operation_id ||
        target.ownerDomain !== row.owner_domain ||
        target.epoch !== row.guard_epoch
      )
        aFail("DSH_A_CONTROL_CONFLICT");
      const receiptRow = get(
        "SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
        [key.scope_id, row.operation_id, row.owner_domain],
      );
      if (!receiptRow) aFail("DSH_A_FENCE_PENDING");
      const receipt = authorityBody(
        "dsh_a_control_domain_receipts",
        receiptRow,
      );
      if (
        receipt.controlId !== target.controlId ||
        receipt.operationId !== target.operationId ||
        receipt.ownerDomain !== target.ownerDomain ||
        receipt.epoch !== target.epoch ||
        receipt.canonicalHash !== target.canonicalHash
      )
        aFail("DSH_A_CONTROL_CONFLICT");
    }
  }
  function sourceControlRecord(
    scopeId: unknown,
    inputId: string,
    proofVersion: number,
    scanId: string,
    verifiedSnapshot: boolean,
  ) {
    const stored = readData("dsh_a_inbox", "input_id", inputId);
    if (!stored) aFail("DSH_A_INPUT_NOT_FOUND");
    const envelope = stored.envelope as DshARecord;
    if (envelope.kind !== "snapshot" && envelope.kind !== "deleted") return;
    const observation = { schemaVersion: 1, inputId, ...envelope };
    const evidence =
      verifiedSnapshot && envelope.kind === "snapshot"
        ? {
            state: "known",
            value: {
              thread: envelope.thread,
              objectKind: envelope.objectKind,
              objectId: envelope.objectId,
              providerRevision: envelope.providerRevision,
              contentHash: envelope.contentHash,
              proofRef: "dsh-source-scan:" + scanId,
              sourceBindingVersion: 1,
              kind: "verified_snapshot",
            },
          }
        : { state: "unknown", reason: "producer_unavailable" };
    const classification = classifySourceControl({
      envelope: observation,
      controlEvidence: evidence,
    });
    const value = {
      schemaVersion: 1,
      scopeId,
      inputId,
      proofVersion,
      scanId,
      disposition: classification.disposition,
      reasonCodes: classification.reasonCodes,
      commandId: null,
    };
    const old = get(
      "SELECT data_json FROM dsh_a_source_control_receipts WHERE scope_id=? AND input_id=? AND proof_version=?",
      [scopeId, inputId, proofVersion],
    );
    if (old) return;
    authorityWrite(
      "dsh_a_source_control_receipts",
      { scope_id: scopeId, input_id: inputId, proof_version: proofVersion },
      { disposition: classification.disposition, command_id: null },
      value,
    );
  }
  function userLeaf(
    scopeId: unknown,
    scope: unknown,
    identity: DshARecord,
    kind: string,
    value: DshARecord,
  ) {
    const scopeKey = dshSourceScopeKey(scope, identity),
      controlId =
        "dsh-leaf:" + dshAHash(["dsh-authorization-leaf-v1", scopeKey, kind]);
    const oldRow = get(
      "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
      [scopeId, controlId],
    );
    if (oldRow) {
      const old = captureIpcData(
        aJsonParse(oldRow.data_json as string),
      ) as DshARecord;
      if (dshAJson(old.value) === dshAJson(value)) {
        controlTargets(scopeId, old);
        return old;
      }
    }
    const epoch = oldRow ? aNumber(oldRow.epoch) + 1 : 1,
      revision = oldRow ? aNumber(oldRow.revision) + 1 : 1,
      canonicalHash = dshAHash(["dsh-a-leaf-value-v1", kind, value]);
    const operationId = dshAHash([
      "dsh-a-user-leaf-v1",
      scopeId,
      scopeKey,
      kind,
      epoch,
    ]);
    const head = {
      schemaVersion: 1,
      controlId,
      scopeKey,
      identity,
      recordKind: "leaf",
      axis: kind,
      epoch,
      revision,
      operationId,
      value,
    };
    const operation = {
      schemaVersion: 1,
      operationId,
      controlId,
      scopeKey,
      recordKind: "leaf",
      axis: kind,
      targetEpoch: epoch,
      previousRevision: oldRow ? oldRow.revision : 0,
      canonicalHash,
      domainsHash: dshAHash([]),
      semanticKey: operationId,
      head,
    };
    const previous = operationKind;
    operationKind = "control";
    try {
      authorityWrite(
        "dsh_a_control_operations",
        { scope_id: scopeId, operation_id: operationId },
        {
          control_id: controlId,
          scope_key: scopeKey,
          record_kind: "leaf",
          axis_or_leaf: kind,
          target_epoch: epoch,
          previous_revision: operation.previousRevision,
          canonical_hash: canonicalHash,
          domains_hash: operation.domainsHash,
          semantic_key: operationId,
        },
        operation,
      );
      authorityWrite(
        "dsh_a_control_heads",
        { scope_id: scopeId, control_id: controlId },
        {
          scope_key: scopeKey,
          record_kind: "leaf",
          axis_or_leaf: kind,
          epoch,
          revision,
          operation_id: operationId,
        },
        head,
        Boolean(oldRow),
      );
      controlTargets(scopeId, head);
    } finally {
      operationKind = previous;
    }
    return head;
  }
  function ownerControlCommand(head: DshARecord, scope: unknown) {
    const leaf = head.recordKind === "leaf";
    return {
      scope,
      type: leaf ? "leaf" : "policy",
      identity: head.identity,
      ...(leaf ? { factKind: head.axis } : { axis: head.axis }),
      epoch: head.epoch,
      value: head.ownerValue ?? head.value,
      authorityRef: "dsh-a-control:" + head.operationId,
    };
  }
  function controlTargets(scopeId: unknown, head: DshARecord) {
    const domainRow = get(
      "SELECT data_json FROM dsh_a_domains WHERE scope_id=?",
      [scopeId],
    );
    if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
    const domain = captureIpcData(
      aJsonParse(domainRow.data_json as string),
    ) as DshARecord;
    const owners = all(
      "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? ORDER BY owner_domain",
      [scopeId],
    );
    for (let i = 0; i < owners.length; i++) {
      const ownerRow = owners[i]!,
        ownerDomain = ownerRow.owner_domain;
      if (
        get(
          "SELECT data_json FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=? AND owner_domain=?",
          [scopeId, head.operationId, ownerDomain],
        )
      )
        continue;
      const target = {
        schemaVersion: 1,
        scopeId,
        operationId: head.operationId,
        ownerDomain,
        controlId: head.controlId,
        epoch: head.epoch,
        canonicalHash: dshAHash(head.value),
        command: ownerControlCommand(head, domain.storageScope),
      };
      authorityWrite(
        "dsh_a_control_targets",
        {
          scope_id: scopeId,
          operation_id: head.operationId,
          owner_domain: ownerDomain,
        },
        {},
        target,
      );
      const ownerRegistration=authorityBody("dsh_a_owner_domains",ownerRow);
      if (ownerRow.owner_kind === "work" || ownerRegistration.writerProfile === "broker_dsh_control_v1") {
        const delivery = {
          schemaVersion: 1,
          scopeId,
          operationId: head.operationId,
          ownerDomain,
          revision: 1,
          fencingToken: 1,
          state: "pending",
        };
        authorityWrite(
          "dsh_a_control_delivery_heads",
          {
            scope_id: scopeId,
            operation_id: head.operationId,
            owner_domain: ownerDomain,
          },
          { revision: 1, fencing_token: 1, delivery_state: "pending" },
          delivery,
        );
      } else {
        // Same original Native transaction installs this A owner's fence. This
        // is a local causal receipt, never an external B acknowledgement.
        const receiptId =
          "dsh-a-local-control-receipt:" +
          dshAHash([
            "dsh-a-local-control-receipt-v1",
            scopeId,
            head.operationId,
            ownerDomain,
          ]);
        const receipt = {
          schemaVersion: 1,
          scopeId,
          operationId: head.operationId,
          ownerDomain,
          receiptId,
          controlId: head.controlId,
          epoch: head.epoch,
          canonicalHash: target.canonicalHash,
          kind: "same_native_control_commit",
        };
        authorityWrite(
          "dsh_a_control_domain_receipts",
          {
            scope_id: scopeId,
            operation_id: head.operationId,
            owner_domain: ownerDomain,
          },
          { receipt_id: receiptId, receipt_hash: dshAHash(receipt) },
          receipt,
        );
      }
    }
  }
  function authorityBody(
    table: Parameters<typeof writeRow>[0],
    row: DshARecord,
  ): DshARecord {
    return readDshAuthorityColdRow(table, row);
  }
  function budgetMandateEpoch(
    scopeId: unknown,
    mandateId: unknown,
    requestedRevision: unknown,
    issuerEpoch: unknown,
  ) {
    if (
      typeof mandateId !== "string" ||
      !mandateId ||
      !aInteger(requestedRevision) ||
      aNumber(requestedRevision) < 1
    )
      aFail("DSH_A_MANDATE_REQUIRED");
    const head = get(
      "SELECT * FROM dsh_a_mandate_heads WHERE scope_id=? AND mandate_id=?",
      [scopeId, mandateId],
    );
    if (!head) {
      if (requestedRevision !== 1) aFail("DSH_A_MANDATE_CAS_CONFLICT");
      return {
        authorizationEpoch: aNumber(issuerEpoch),
        headRevision: 0,
        publishedMandateRevision: null,
      };
    }
    const accepted = authorityBody(
      "dsh_a_mandates",
      get(
        "SELECT * FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
        [scopeId, mandateId, head.mandate_revision],
      )!,
    );
    const document = parseMandateProjection(accepted.projection).document;
    if (
      requestedRevision !== document.revision &&
      requestedRevision !== document.revision + 1
    )
      aFail("DSH_A_MANDATE_CAS_CONFLICT");
    if (
      requestedRevision === document.revision &&
      dshMandateIssuerEpoch(accepted) !== issuerEpoch
    )
      aFail("DSH_A_MANDATE_SCOPE");
    return {
      authorizationEpoch:
        document.authorizationEpoch +
        (requestedRevision === document.revision ? 0 : 1),
      headRevision: aNumber(head.revision),
      publishedMandateRevision: document.revision,
    };
  }
  /** One original SQL cut of the fixed five prefixes, twenty policies and four
   * real leaves. This reads accepted controls; no command may supply a subset. */
  function currentAdmissionBaseline(
    sourceBindingId: string,
    mandateId: string,
    metadataOnly = false,
  ) {
    const configurationRow = get(
      "SELECT c.* FROM dsh_a_source_configurations c JOIN dsh_a_source_configuration_heads h ON h.binding_id=c.binding_id AND h.revision=c.revision WHERE c.binding_id=?",
      [sourceBindingId],
    );
    if (!configurationRow) aFail("DSH_A_SOURCE_CONFIG_REQUIRED");
    const configuration = parseDshSourceConfiguration(
      authorityBody("dsh_a_source_configurations", configurationRow)
        .configuration,
    );
    const sourceBinding = readData(
      "dsh_a_source_bindings",
      "binding_id",
      sourceBindingId,
    );
    if (
      !sourceBinding ||
      (!metadataOnly && sourceBinding.status !== "active") ||
      dshAJson(sourceBinding.binding) !== dshAJson(configuration.binding)
    )
      aFail("DSH_A_SOURCE_BINDING_CLOSED");
    const domainRow = get("SELECT * FROM dsh_a_domains WHERE scope_id=?", [
      configurationRow.scope_id,
    ]);
    if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
    const domain = authorityBody("dsh_a_domains", domainRow),
      scope = domain.storageScope as DshARecord;
    const mandateRow = get(
      "SELECT m.* FROM dsh_a_mandates m JOIN dsh_a_mandate_heads h ON h.scope_id=m.scope_id AND h.mandate_id=m.mandate_id AND h.mandate_revision=m.mandate_revision WHERE m.scope_id=? AND m.mandate_id=?",
      [domainRow.scope_id, mandateId],
    );
    if (!mandateRow) aFail("DSH_A_MANDATE_REQUIRED");
    const storedMandate = authorityBody("dsh_a_mandates", mandateRow),
      projection = parseMandateProjection(storedMandate.projection),
      mandate = projection.document;
    if (
      mandate.sourceBindingId !== sourceBindingId ||
      (!metadataOnly &&
        (mandate.status !== "active" ||
          dshMandateIssuerEpoch(storedMandate) !== domain.authorityEpoch))
    )
      aFail("DSH_A_MANDATE_CLOSED");
    const identities: DshARecord[] = [];
    const sourceScopes = dshSourceReadScopes(scope, configuration);
    for (let i = 0; i < sourceScopes.length; i++)
      aPush(identities, sourceScopes[i]!.identity as DshARecord);
    const auth = (configuration.binding as DshARecord).authScope as DshARecord;
    aPush(
      identities,
      dshSourceScopeIdentity({
        kind: "mandate",
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        provider: "github",
        repositoryId: auth.repositoryId,
        sourceBindingId,
        mandateId,
      }),
    );
    const heads: DshARecord[] = [],
      modeRefs: DshARecord[] = [],
      modes: DshARecord[] = [],
      policies: DshARecord[] = [],
      leaves: DshARecord[] = [];
    const axes = ["mandate", "egress", "privacy", "readonly"];
    const readHead = (id: string) => {
      const row = get(
        "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
        [domainRow.scope_id, id],
      );
      if (!row) aFail("DSH_A_BASELINE_UNCONFIRMED");
      const value = authorityBody("dsh_a_control_heads", row);
      if (
        value.controlId !== id ||
        value.epoch !== row.epoch ||
        value.revision !== row.revision ||
        value.operationId !== row.operation_id
      )
        aFail("DSH_A_AUTHORITY_CONFLICT");
      aPush(heads, value);
      return value;
    };
    for (let i = 0; i < identities.length; i++) {
      const identity = identities[i]!,
        scopeKey = dshSourceScopeKey(scope, identity),
        mode = readHead(dshSourceModeId(scopeKey));
      if (
        mode.recordKind !== "policy" ||
        mode.axis !== "mode" ||
        mode.scopeKey !== scopeKey ||
        dshAJson(mode.identity) !== dshAJson(identity)
      )
        aFail("DSH_A_AUTHORITY_CONFLICT");
      if (!metadataOnly && (mode.value as DshARecord).mode === "off")
        aFail("DSH_A_MODE_OFF");
      aPush(modes, mode);
      aPush(modeRefs, { scopeKey, epoch: mode.epoch });
      for (let j = 0; j < axes.length; j++) {
        const axis = axes[j]!,
          id = "dsh-policy:" + dshAHash(["dsh-policy-v1", scopeKey, axis]),
          policy = readHead(id);
        if (
          policy.recordKind !== "policy" ||
          policy.axis !== axis ||
          policy.scopeKey !== scopeKey ||
          dshAJson(policy.identity) !== dshAJson(identity)
        )
          aFail("DSH_A_AUTHORITY_CONFLICT");
        if (!metadataOnly && (policy.value as DshARecord).allowed !== true)
          aFail("DSH_A_SCOPE_POLICY_DENIED");
        aPush(policies, policy);
      }
    }
    const leafKinds = ["source_auth", "mandate", "egress", "readonly"];
    for (let i = 0; i < leafKinds.length; i++) {
      const kind = leafKinds[i]!,
        leafScope = dshSourceScopeKey(scope, identities[i === 0 ? 3 : 4]),
        leaf = readHead(
          "dsh-leaf:" +
            dshAHash(["dsh-authorization-leaf-v1", leafScope, kind]),
        );
      if (
        leaf.recordKind !== "leaf" ||
        leaf.axis !== kind ||
        leaf.scopeKey !== leafScope
      )
        aFail("DSH_A_AUTHORITY_CONFLICT");
      aPush(leaves, leaf);
    }
    if (dshAJson(leaves[1]!.value) !== dshAJson(mandate))
      aFail("DSH_A_MANDATE_CONFLICT");
    const egress = parseDshEgressPolicy(leaves[2]!.value);
    if (
      !metadataOnly &&
      (!egress.enabled || egress.policyRef !== mandate.dataEgressPolicyRef)
    )
      aFail("DSH_A_EGRESS_REQUIRED");
    let workOwner = false,brokerOwner=false,
      baselineConfirmed = true;
    for (let i = 0; i < mandate.ownerDomains.length; i++) {
      const expected = mandate.ownerDomains[i]!,
        actual = get(
          "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
          [domainRow.scope_id, expected.domainId],
        );
      if (!actual || actual.owner_kind !== expected.kind)
        aFail("DSH_A_BASELINE_UNCONFIRMED");
      const registered=authorityBody("dsh_a_owner_domains", actual);
      if (expected.kind === "work") workOwner = true;
      if(expected.kind==="active_pointer"&&registered.writerProfile==="broker_dsh_control_v1"){
        const baseline=readBrokerBaselineReceipt(registered.brokerBaseline),authority=baseline.authority as DshARecord;
        if(authority.authorityId!==domainRow.authority_id||authority.authorityEpoch!==domainRow.authority_epoch)aFail("DSH_A_BROKER_REBASELINE_REQUIRED");brokerOwner=true;
      }
      for (let j = 0; j < heads.length; j++) {
        const head = heads[j]!,
          target = get(
            "SELECT * FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=? AND owner_domain=?",
            [domainRow.scope_id, head.operationId, expected.domainId],
          ),
          receipt = get(
            "SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
            [domainRow.scope_id, head.operationId, expected.domainId],
          );
        if (!target || !receipt) {
          if (!metadataOnly) aFail("DSH_A_BASELINE_UNCONFIRMED");
          baselineConfirmed = false;
          continue;
        }
        const targetData = authorityBody("dsh_a_control_targets", target),
          receiptData = authorityBody("dsh_a_control_domain_receipts", receipt);
        if (
          targetData.controlId !== head.controlId ||
          targetData.epoch !== head.epoch ||
          receiptData.controlId !== head.controlId ||
          receiptData.epoch !== head.epoch ||
          receiptData.canonicalHash !== targetData.canonicalHash ||
          (registered.writerProfile==="broker_dsh_control_v1"&&(receiptData.kind!=="original_broker_control_receipt"||receiptData.brokerCurrentAtObservation!==true))
        )
          aFail("DSH_A_AUTHORITY_CONFLICT");
      }
    }
    if (!workOwner) {
      if (!metadataOnly) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
      baselineConfirmed = false;
    }
    if(!brokerOwner){if(!metadataOnly)aFail("DSH_A_BROKER_DOMAIN_REQUIRED");baselineConfirmed=false;}
    const member = get(
      "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND account_id=? AND mandate_id=?",
      [domainRow.scope_id, mandate.budgetRef, mandateId],
    );
    if (
      !budgetBinding ||
      !member ||
      member.owner_id !== budgetBinding.binding.ownerId ||
      member.unit_profile !== "dsh_budget_usd_micros_v1"
    )
      aFail("DSH_A_BUDGET_BINDING_REQUIRED");
    if (!metadataOnly)
      invokeSource(budgetBinding.binding.assertCurrent, undefined, [], true);
    return {
      configurationRow,
      configuration,
      sourceBinding,
      domainRow,
      domain,
      scope,
      projection,
      mandate,
      identities,
      heads,
      modes,
      policies,
      leaves,
      egress,
      prefixModeHash: hashA2Data(modeRefs),
      baselineConfirmed,
    };
  }
  function storedSourceScan(snapshotRef: string) {
    const snapshotRow = get(
      "SELECT * FROM dsh_a_source_snapshots WHERE snapshot_id=?",
      [snapshotRef],
    );
    if (!snapshotRow) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const snapshot = capturedGithubRow("dsh_a_source_snapshots", snapshotRow);
    const sourceRead = get(
      "SELECT * FROM dsh_a_source_reads WHERE attempt_id=?",
      [snapshot.data.readAttemptId],
    );
    if (!sourceRead) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const read = capturedGithubRow("dsh_a_source_reads", sourceRead);
    const scanRow = get("SELECT * FROM dsh_a_source_scans WHERE scan_id=?", [
      read.data.scanId,
    ]);
    if (!scanRow) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const scan = capturedGithubRow("dsh_a_source_scans", scanRow),
      setRow = get("SELECT * FROM dsh_a_source_read_sets WHERE read_set_id=?", [
        scan.data.readSetId,
      ]);
    if (!setRow) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const selected = capturedGithubRow("dsh_a_source_read_sets", setRow),
      reads: GithubSourceStorageRow[] = [],
      snapshots: GithubSourceStorageRow[] = [];
    const readRows = all(
      "SELECT * FROM dsh_a_source_reads WHERE scan_id=? ORDER BY rowid",
      [read.data.scanId],
    );
    for (let i = 0; i < readRows.length; i++)
      aPush(reads, capturedGithubRow("dsh_a_source_reads", readRows[i]!));
    const snapshotRows = all(
      "SELECT s.* FROM dsh_a_source_snapshots s JOIN dsh_a_source_reads r ON r.attempt_id=s.read_attempt_id WHERE r.scan_id=? ORDER BY s.rowid",
      [read.data.scanId],
    );
    for (let i = 0; i < snapshotRows.length; i++)
      aPush(
        snapshots,
        capturedGithubRow("dsh_a_source_snapshots", snapshotRows[i]!),
      );
    return validateGithubSourceRelations({
      scan,
      reads,
      snapshots,
      readSet: selected,
      checkpoint: null,
      imports: [],
      observations: [],
    });
  }
  function calculateAdmission(
    data: DshARecord,
    refs: { sourceScan?: object; ownerObservation?: object },
    budget: DshBudgetObservationView | undefined,
    workFund?: ReturnType<typeof readOriginalDshDraftAdmission>,
    metadataOnly = false,
    budgetCurrent = true,
  ) {
    dshAFields(data, [
      "schemaVersion",
      "bindingId",
      "inputId",
      "proofVersion",
      "mandateId",
      "candidateId",
      "expectedSelectionRevision",
      "expectedBindingRevision",
    ]);
    if (
      data.schemaVersion !== 1 ||
      typeof data.bindingId !== "string" ||
      typeof data.inputId !== "string" ||
      typeof data.mandateId !== "string" ||
      (data.candidateId !== null && typeof data.candidateId !== "string") ||
      !aInteger(data.proofVersion) ||
      aNumber(data.proofVersion) < 1 ||
      !aInteger(data.expectedSelectionRevision) ||
      aNumber(data.expectedSelectionRevision) < 0 ||
      !aInteger(data.expectedBindingRevision) ||
      aNumber(data.expectedBindingRevision) < 0
    )
      aFail("DSH_A_BASIS_INVALID");
    const basis = currentAdmissionBaseline(
        data.bindingId,
        data.mandateId,
        metadataOnly,
      ),
      scopeId = basis.domainRow.scope_id;
    const inputRow = get("SELECT * FROM dsh_a_inbox WHERE input_id=?", [
      data.inputId,
    ]);
    if (!inputRow) aFail("DSH_A_INPUT_NOT_FOUND");
    const input = readData("dsh_a_inbox", "input_id", data.inputId)!;
    validateDshAStoredBody("dsh_a_inbox", input);
    const envelope = input.envelope as DshARecord;
    if (
      (envelope.thread as DshARecord).sourceBindingId !== data.bindingId ||
      (envelope.kind !== "created" && envelope.kind !== "edited")
    )
      aFail("DSH_A_SOURCE_CONTROL_ONLY");
    const proofRow = get(
      "SELECT * FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
      [data.inputId, data.proofVersion],
    );
    if (!proofRow) aFail("DSH_A_PROOF_NOT_FOUND");
    const proof = captureIpcData(
      aJsonParse(proofRow.data_json as string),
    ) as DshARecord;
    validateDshAStoredBody("dsh_a_input_proofs", proof);
    if (
      proof.provenanceVersion !== data.proofVersion ||
      dshAHash(proof) !== proofRow.proof_hash ||
      (!metadataOnly &&
        dshAJson(proof.authScope) !==
          dshAJson((basis.configuration.binding as DshARecord).authScope))
    )
      aFail("DSH_A_PROOF_SCOPE_UNCONFIRMED");
    const projected = {
      ...envelope,
      schemaVersion: 1,
      inputId: data.inputId,
      authScope: proof.authScope,
      actorEvidence: proof.actorEvidence,
      actorEvidenceHash: proof.actorEvidenceHash,
      actorMappingVersion: proof.actorMappingVersion,
      provenanceVersion: proof.provenanceVersion,
      authorizationCheckedAt: proof.authorizationCheckedAt,
    };
    const head = readData(
      "dsh_a_object_heads",
      "object_id",
      dshSourceObjectIdentity(dshAObservation(envelope)),
    );
    if (!head) aFail("DSH_A_INPUT_NOT_CURRENT");
    const headState = head.state as DshARecord,
      current = headState.current as DshARecord | null;
    const headMatches = !(
      headState.freeze !== null ||
      !current ||
      current.objectKind !== envelope.objectKind ||
      current.objectId !== envelope.objectId ||
      current.providerRevision !== envelope.providerRevision ||
      current.contentHash !== envelope.contentHash
    );
    if (!metadataOnly && !headMatches) aFail("DSH_A_INPUT_NOT_CURRENT");
    if (!metadataOnly && !refs.sourceScan)
      aFail("DSH_A_SOURCE_PROOF_UNCONFIRMED");
    const scanView = metadataOnly
      ? null
      : (invokeSource(readOriginalGithubSourceScanForAdmission, undefined, [
          refs.sourceScan,
          source,
          owner,
          source,
        ]) as ReturnType<typeof readOriginalGithubSourceScanForAdmission>);
    const scan = scanView
      ? parseGithubSourceScan(scanView.data)
      : storedSourceScan(envelope.snapshotRef as string);
    let candidateMatches = false;
    for (let i = 0; i < scan.candidates.length; i++) {
      const candidate = scan.candidates[i]!,
        observed = candidate.envelope as DshARecord;
      if (
        "dsh-input:" + dshAInputKey(observed) === data.inputId &&
        dshAJson(dshAProof(observed)) === dshAJson(proof)
      )
        candidateMatches = true;
    }
    if (
      !metadataOnly &&
      (!candidateMatches ||
        scan.bindingId !== data.bindingId ||
        scan.bindingRevision !== basis.sourceBinding.revision)
    )
      aFail("DSH_A_SOURCE_PROOF_UNCONFIRMED");
    const snapshotRow = get(
      "SELECT * FROM dsh_a_source_snapshots WHERE snapshot_id=?",
      [envelope.snapshotRef],
    );
    if (!snapshotRow) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const snapshot = capturedGithubRow(
        "dsh_a_source_snapshots",
        snapshotRow,
      ).data,
      object = localObject(snapshot.object);
    const entry = {
      inputId: data.inputId,
      objectKind: envelope.objectKind,
      objectId: envelope.objectId,
      revision: envelope.providerRevision,
      contentHash: envelope.contentHash,
      provenanceVersion: proof.provenanceVersion,
      actorEvidenceHash: proof.actorEvidenceHash,
      actorMappingVersion: proof.actorMappingVersion,
    };
    const evidenceRead = get(
      "SELECT * FROM dsh_a_source_reads WHERE attempt_id=?",
      [snapshot.readAttemptId],
    );
    if (!evidenceRead) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const evidenceSource = capturedGithubRow(
      "dsh_a_source_reads",
      evidenceRead,
    ).data;
    const manifestCore = {
      schemaVersion: 1,
      thread: envelope.thread,
      entries: [entry],
      sourceSnapshotAt: evidenceSource.sourceSnapshotAt,
    };
    const manifest = {
      ...manifestCore,
      manifestHash: hashEvidenceManifest({
        ...manifestCore,
        manifestHash: "0".repeat(64),
      }),
    };
    let assessment: FrozenSemanticAssessment | null = null,
      candidate: DshARecord | null = null,
      attempt: DshARecord | null = null;
    if (data.candidateId !== null) {
      const candidateRow = get(
        "SELECT * FROM dsh_a_assessment_candidates WHERE scope_id=? AND candidate_id=?",
        [scopeId, data.candidateId],
      );
      if (!candidateRow) aFail("DSH_A_ASSESSMENT_NOT_FOUND");
      candidate = authorityBody("dsh_a_assessment_candidates", candidateRow);
      const attemptRow = get(
        "SELECT * FROM dsh_a_assessment_attempts WHERE scope_id=? AND attempt_id=?",
        [scopeId, candidate.attemptId],
      );
      if (!attemptRow) aFail("DSH_A_ASSESSMENT_NOT_FOUND");
      attempt = authorityBody("dsh_a_assessment_attempts", attemptRow);
      if (
        attempt.inputId !== data.inputId ||
        attempt.proofVersion !== data.proofVersion ||
        attempt.mandateId !== data.mandateId ||
        attempt.mandateRevision !== basis.mandate.revision ||
        candidate.evidenceManifestHash !== manifest.manifestHash ||
        dshAJson(attempt.evidenceManifest) !== dshAJson(manifest)
      )
        aFail("DSH_A_ASSESSMENT_BINDING_CONFLICT");
      const result = candidate.result as DshARecord;
      const final = {
        assessmentId: "dsh-assessment:" + candidate.outputHash,
        evidenceManifestHash: manifest.manifestHash,
        ruleVersion: candidate.ruleVersion,
        modelId: candidate.modelId,
        promptVersion: candidate.promptVersion,
        dataEgressPolicyRef: candidate.dataEgressPolicyRef,
        validUntil: aApply(aIso, new ADate(aNumber(candidate.validUntil)), []),
        assessmentHash: "0".repeat(64),
        assessmentVersion: candidate.assessmentVersion,
        purpose: candidate.purpose,
        decisive: true,
        suggestedIntent: result.suggestedIntent,
        evidenceRefs: result.evidenceRefs,
        uncertainty: result.uncertainty,
      };
      assessment = parseSemanticAssessment({
        ...final,
        assessmentHash: hashSemanticAssessment(final),
      });
    }
    const selectionRow = get(
      "SELECT * FROM dsh_a_selection_heads WHERE scope_id=? AND input_id=? AND mandate_id=?",
      [scopeId, data.inputId, data.mandateId],
    );
    const selectionRevision = selectionRow ? aNumber(selectionRow.revision) : 0;
    if (selectionRevision !== data.expectedSelectionRevision)
      aFail("DSH_A_SELECTION_CAS_CONFLICT");
    if (
      assessment &&
      ((assessment.assessmentVersion !== selectionRevision + 1 &&
        assessment.assessmentVersion !== selectionRevision) ||
        (assessment.assessmentVersion === 2 &&
          get(
            "SELECT command_id FROM dsh_a_command_outbox WHERE scope_id=? AND input_id=?",
            [scopeId, data.inputId],
          )))
    )
      aFail("DSH_A_ASSESSMENT_REPLACEMENT_FORBIDDEN");
    const workRow = get(
      "SELECT * FROM dsh_a_work_bindings WHERE scope_id=? AND stable_thread_key=? AND generation=1",
      [scopeId, dshAHash(envelope.thread)],
    );
    if (
      (workRow ? aNumber(workRow.revision) : 0) !== data.expectedBindingRevision
    )
      aFail("DSH_A_BINDING_CAS_CONFLICT");
    let bindingFact: unknown = { state: "known", value: { kind: "none" } },
      consumption: unknown = { state: "known", value: { kind: "none" } };
    if (workRow) {
      const binding = authorityBody("dsh_a_work_bindings", workRow);
      if (workRow.transport_kind === "reserved")
        bindingFact = { state: "known", value: { kind: "reserved", binding } };
      else if (metadataOnly && (!ownerBinding || !refs.ownerObservation)) {
        bindingFact = { state: "unknown", reason: "missing" };
        consumption = { state: "unknown", reason: "missing" };
      } else {
        if (!ownerBinding || !refs.ownerObservation)
          aFail("DSH_A_OWNER_BASIS_REQUIRED");
        const view = invokeSource(readOriginalKSwarmDshReply, undefined, [
          ownerBinding.service,
          ownerBinding.admission,
          refs.ownerObservation,
        ]) as KSwarmDshReplyView;
        invokeSource(view.assertKnown, undefined, [], true);
        invokeSource(view.assertCurrent, undefined, [], true);
        const output = captureIpcData(view.output) as DshARecord,
          observed = output.basis as DshARecord;
        if (
          view.operation !== "read_dsh_basis" ||
          output.ok !== true ||
          !observed ||
          dshAJson(view.scope) !== dshAJson(basis.scope)
        )
          aFail("DSH_A_OWNER_BASIS_REQUIRED");
        const control = observed.control as DshARecord,
          guard = observed.workGuard as DshARecord,
          receipt = observed.commandReceipt as DshARecord;
        if (
          control.projectId !== (binding.transport as DshARecord).ownerWorkId ||
          receipt.ownerWorkId !== control.projectId ||
          !aInteger(control.ownerVersion) ||
          aNumber(control.ownerVersion) < 1
        )
          aFail("DSH_A_OWNER_BASIS_CONFLICT");
        // Hydrate both versions from this same authenticated B snapshot. The
        // immutable A canonical binding/version and B original time stay fixed.
        const hydrated = {
          ...binding,
          transport: {
            ...(binding.transport as DshARecord),
            ownerVersion: control.ownerVersion,
          },
        };
        bindingFact = {
          state: "known",
          value: {
            kind: "bound",
            binding: hydrated,
            ownerVersion: control.ownerVersion,
            inputSetRevision: control.inputSetRevision,
            stopped: control.stopped,
            terminal: control.stopped,
            completionReached: control.completionLatch,
            generationClosed: control.generationClosed,
            workGuard: {
              scopeKey: guard.scopeKey,
              epoch: guard.epoch,
              revision: guard.revision,
              mode: guard.mode,
            },
          },
        };
        const ids = receipt.consumedInputIds as unknown[];
        for (let i = 0; i < ids.length; i++)
          if (ids[i] === data.inputId)
            consumption = {
              state: "known",
              value: {
                kind: "consumed",
                thread: envelope.thread,
                inputId: data.inputId,
                evidenceManifestHash: manifest.manifestHash,
                mandateId: data.mandateId,
                bindingId: binding.bindingId,
                ownerWorkId: receipt.ownerWorkId,
                ownerVersion: receipt.ownerVersion,
                inputSetRevision: receipt.inputSetRevision,
                operationKey: receipt.operationKey,
                semanticPayloadHash: receipt.semanticPayloadHash,
                receiptRef: receipt.id,
              },
            };
      }
    }
    const windowRow = get(
      "SELECT * FROM dsh_a_windows WHERE scope_id=? AND source_binding_id=? AND prefix_mode_hash=?",
      [scopeId, data.bindingId, basis.prefixModeHash],
    );
    const clock = invokeSource(readOriginalMainDshClock, undefined, [
      source,
      owner,
      source,
    ]) as ReturnType<typeof readOriginalMainDshClock>;
    let freshness: unknown = { state: "unknown", reason: "missing" };
    if (windowRow) {
      const window = authorityBody("dsh_a_windows", windowRow);
      if (
        clock.projection.state === "verified" &&
        window.clockDomain === clock.projection.domainId &&
        window.clockEpoch === clock.projection.qualificationEpoch &&
        window.configurationRevision === basis.configurationRow.revision &&
        window.mandateRevision === basis.mandate.revision &&
        envelope.providerOccurredAt &&
        envelope.providerTimeEvidenceRef
      )
        freshness = {
          state: "known",
          value: {
            window: window.window,
            inputId: data.inputId,
            evidenceManifestHash: manifest.manifestHash,
            eventTimeEvidenceRef: envelope.providerTimeEvidenceRef,
            eventOccurredAt: envelope.providerOccurredAt,
            attestationRef: "dsh-source-scan:" + scan.scanId,
            state:
              instantMs(envelope.providerOccurredAt as string) >
              instantMs((window.window as DshARecord).effectiveAt as string)
                ? "fresh"
                : "backlog",
          },
        };
    }
    const modes: DshARecord[] = [],
      policies: DshARecord[] = [],
      leaves: DshARecord[] = [],
      ownerIds: string[] = [];
    for (let i = 0; i < basis.modes.length; i++) {
      const row = basis.modes[i]!;
      aPush(modes, {
        identity: row.identity,
        scopeKey: row.scopeKey,
        epoch: row.epoch,
        revision: row.revision,
        mode: (row.value as DshARecord).mode,
      });
    }
    for (let i = 0; i < basis.policies.length; i++) {
      const row = basis.policies[i]!;
      aPush(policies, {
        identity: row.identity,
        scopeKey: row.scopeKey,
        axis: row.axis,
        epoch: row.epoch,
        revision: row.revision,
        allowed: (row.value as DshARecord).allowed,
      });
    }
    for (let i = 0; i < basis.leaves.length; i++) {
      const row = basis.leaves[i]!;
      aPush(leaves, {
        kind: row.axis,
        scopeKey: row.scopeKey,
        epoch: row.epoch,
        revision: row.revision,
        contentHash: hashA2Data([
          "dsh-authorization-leaf-v1",
          row.axis,
          row.ownerValue ?? row.value,
        ]),
      });
    }
    for (let i = 0; i < basis.mandate.ownerDomains.length; i++)
      aPush(ownerIds, basis.mandate.ownerDomains[i]!.domainId);
    const account = workFund ? workFund.status.account : budget?.status.account;
    if (
      account &&
      (!budgetBinding ||
        (workFund ? workFund.ownerId : budget!.ownerId) !==
          budgetBinding.binding.ownerId ||
        account.account_id !== basis.mandate.budgetRef ||
        account.mandate_id !== data.mandateId ||
        account.mandate_revision !== basis.mandate.revision ||
        account.authorization_epoch !== basis.mandate.authorizationEpoch ||
        (!metadataOnly && account.status !== "active") ||
        account.currency !== "USD" ||
        account.scale !== 6)
    )
      aFail("DSH_A_BUDGET_BINDING_CONFLICT");
    const limits = basis.mandate.limits,
      headroom =
        account && workFund
          ? {
              budgetRef: account.account_id,
              inputId: data.inputId,
              mandateId: data.mandateId,
              purpose: "draft",
              scopeRevision: account.revision,
              budgetPolicyVersion: "dsh-mandate-initial-work-fund-v1",
              requirementHash: dshAHash([
                "dsh-mandate-initial-work-fund-v1",
                basis.mandate,
              ]),
              remainingTokens: workFund.head.available_tokens,
              remainingCostMinor: workFund.head.available_cost,
              requiredMaxTokens: workFund.reservation.initial_tokens,
              requiredMaxCostMinor: workFund.reservation.initial_cost,
              currency: "USD",
              remainingActiveWorks: 1,
            }
          : account && budgetCurrent && budget?.status.workCapacity
            ? {
                budgetRef: account.account_id,
                inputId: data.inputId,
                mandateId: data.mandateId,
                purpose: "draft",
                scopeRevision: account.revision,
                budgetPolicyVersion: "dsh-mandate-initial-work-fund-v1",
                requirementHash: dshAHash([
                  "dsh-mandate-initial-work-fund-v1",
                  basis.mandate,
                ]),
                remainingTokens:
                  account.token_limit -
                  account.spent_tokens -
                  account.held_tokens,
                remainingCostMinor:
                  account.cost_limit - account.spent_cost - account.held_cost,
                requiredMaxTokens: aMinimum(
                  limits.maxTokens,
                  account.token_limit -
                    account.spent_tokens -
                    account.held_tokens,
                ),
                requiredMaxCostMinor: aMinimum(
                  limits.maxCostMinor,
                  account.cost_limit - account.spent_cost - account.held_cost,
                ),
                currency: "USD",
                remainingActiveWorks:
                  aMinimum(
                    limits.maxActiveWorks,
                    budget.status.workCapacity.maxActiveWorks,
                  ) > budget.status.workCapacity.activeWorks
                    ? aMinimum(
                        limits.maxActiveWorks,
                        budget.status.workCapacity.maxActiveWorks,
                      ) - budget.status.workCapacity.activeWorks
                    : 0,
              }
            : null;
    // The single slot above is this actual original-owner reservation's already
    // allocated slot. Unfunded proposals never claim an available work count.
    const boundSource = basis.configuration.binding as DshARecord,
      sourceAuth = basis.leaves[0]!.value as DshARecord;
    let parent = object;
    for (let i = 0; i < scan.snapshots.length; i++)
      if (
        scan.snapshots[i]!.object.objectKind === "issue" &&
        scan.snapshots[i]!.object.issueId ===
          (envelope.thread as DshARecord).threadId
      )
        parent = scan.snapshots[i]!.object;
    const raw = {
      schemaVersion: 1,
      policyVersion: "github_issue_draft_v1/a2-evaluator-v1",
      use: "admission",
      purpose: "admission",
      storageScope: basis.scope,
      principalId: basis.domain.principalId,
      input: {
        envelope: projected,
        inputUtf8Bytes: Buffer.byteLength(dshAJson(object), "utf8"),
        evidence: { state: "known", value: manifest },
      },
      source: {
        state: "known",
        value: {
          binding: {
            sourceBindingId: data.bindingId,
            tenantId: (envelope.thread as DshARecord).tenantId,
            workspaceId: (envelope.thread as DshARecord).workspaceId,
            provider: "github",
            repositoryId: (envelope.thread as DshARecord).repositoryId,
            activeAuthScope: boundSource.authScope,
            version: boundSource.sourceBindingVersion,
          },
          credential:
            basis.sourceBinding.status === "active" ? "active" : "revoked",
          credentialRevision: (boundSource.authScope as DshARecord)
            .credentialEpoch,
          authAttestationRef: sourceAuth.attestationRef,
          provenance:
            basis.sourceBinding.status === "active" ? "verified" : "revoked",
          provenanceVersion: proof.provenanceVersion,
          actorMapping: "verified",
          actorMappingVersion: proof.actorMappingVersion,
          evidenceHeads: [
            {
              ...entry,
              headHash: dshAHash(head),
              proofHash: proofRow.proof_hash,
              state: headMatches
                ? "current"
                : headState.freeze !== null
                  ? "conflict"
                  : "superseded",
            },
          ],
        },
      },
      labels: {
        state: "known",
        value: {
          repositoryId: parent.repositoryId,
          threadId: parent.issueId,
          revision: basis.sourceBinding.revision,
          labelIds: parent.labelIds,
        },
      },
      mandate: { state: "known", value: basis.projection },
      controls: {
        state: "known",
        value: {
          prefixModes: modes,
          prefixPolicies: policies,
          leaves,
          confirmedOwnerDomains: ownerIds,
          ownerDomainsHash: basis.mandate.ownerDomainsHash,
          baseline: basis.baselineConfirmed ? "confirmed" : "pending",
        },
      },
      budget: {
        assessment: { state: "unknown", reason: "missing" },
        draft: headroom
          ? { state: "known", value: headroom }
          : { state: "unknown", reason: "missing" },
      },
      egress: {
        state: "known",
        value: {
          policyRef: basis.egress.policyRef,
          revision: basis.leaves[2]!.revision,
          epoch: basis.egress.epoch,
          policyHash: basis.leaves[2]!.policyHash,
          provider: basis.egress.provider,
          destinationRef: basis.egress.destinationRef,
          purposes: basis.egress.purposes,
          executionProfile: "model_text_only_v1",
          decision: basis.egress.enabled ? "allow" : "deny",
          baseline: "confirmed",
        },
      },
      binding: bindingFact,
      consumption,
      selection: {
        state: "known",
        value: assessment
          ? {
              kind: "selected",
              value: {
                inputId: data.inputId,
                mandateId: data.mandateId,
                mandateRevision: basis.mandate.revision,
                assessmentVersion: assessment.assessmentVersion,
                assessmentId: assessment.assessmentId,
                assessmentHash: assessment.assessmentHash,
              },
            }
          : { kind: "none" },
      },
      assessment,
      freshness,
      modelPolicy: {
        modelId: assessment?.modelId ?? (basis.egress.modelIds as string[])[0],
        promptVersion: DSH_ASSESSMENT_PROMPT_VERSION,
        ruleVersion: basis.mandate.ruleVersion,
        assessmentProfile: "model_text_only_v1",
        negativeHintPolicy: "uncertainty-negative-v1",
      },
      clock: clock.projection,
    };
    const snapshotValue = parseA2Snapshot(raw),
      suggestion = evaluateAdmission(snapshotValue);
    return {
      basis,
      input,
      proof,
      head,
      scanView,
      clock,
      manifest,
      assessment,
      candidate,
      attempt,
      workRow,
      snapshot: snapshotValue,
      suggestion,
    };
  }
  function ownerBasisInput(command: DshARecord, withCommandId = false) {
    return {
      data: {
        scope: command.scope,
        thread: command.thread,
        bindingId: command.bindingId,
        generation: 1,
        operationKey: command.operationKey,
        ...(withCommandId ? { commandId: command.commandId } : {}),
      },
      budget: null,
    };
  }
  function matchesOwnerBasisInput(input: unknown, command: DshARecord) {
    const bytes = dshAJson(input);
    return (
      bytes === dshAJson(ownerBasisInput(command)) ||
      bytes === dshAJson(ownerBasisInput(command, true))
    );
  }
  function draftPreparationBasis(commandId: string, view: KSwarmDshReplyView) {
    if (!ownerBinding || !budgetBinding) aFail("DSH_A_OWNER_BINDING_REQUIRED");
    invokeSource(view.assertKnown, undefined, [], true);
    if (
      view.operation !== "read_dsh_basis" ||
      dshAJson(view.scope) !== dshAJson(ownerBinding.scope)
    )
      aFail("DSH_A_OWNER_BASIS_REQUIRED");
    const outboxRow = get(
      "SELECT * FROM dsh_a_command_outbox WHERE command_id=?",
      [commandId],
    );
    if (!outboxRow) aFail("DSH_A_COMMAND_NOT_FOUND");
    const outbox = authorityBody("dsh_a_command_outbox", outboxRow),
      command = outbox.command as DshARecord;
    if (
      command.commandId !== commandId ||
      (command.action !== "create_draft_work" &&
        command.action !== "append_input")
    )
      aFail("DSH_A_DRAFT_COMMAND_REQUIRED");
    const registered = get(
      "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
      [outboxRow.scope_id, outboxRow.target_domain],
    );
    const importedRow = get(
      "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
      [outboxRow.scope_id, commandId],
    );
    if (!registered || !importedRow) aFail("DSH_A_OWNER_RECEIPT_REQUIRED");
    const registration = authorityBody("dsh_a_owner_domains", registered),
      imported = authorityBody("dsh_a_owner_receipts", importedRow);
    const wire = captureIpcData(view.input) as DshARecord;
    if (!matchesOwnerBasisInput(wire, command))
      aFail("DSH_A_OWNER_BASIS_CONFLICT");
    const output = captureIpcData(view.output) as DshARecord,
      b = output.basis as DshARecord;
    if (output.ok !== true || !b || b.schemaVersion !== 1)
      aFail("DSH_A_OWNER_BASIS_CONFLICT");
    const workId =
      "dsh-work:" + dshAHash(["dsh-work-v1", command.scope, command.thread, 1]);
    const records = [
      b.commandReceipt,
      b.appliedOperation,
      b.binding,
      b.createRecord,
      b.control,
      b.workGuard,
    ];
    for (let i = 0; i < records.length; i++) {
      const row = records[i] as DshARecord;
      if (!row) aFail("DSH_A_OWNER_BASIS_CONFLICT");
      const plain = captureIpcData(row) as DshARecord;
      delete plain.recordDigest;
      if (
        row.schemaVersion !== 1 ||
        row.contract !== "dsh_owner_admission_v1" ||
        row.writerStoreId !== registration.storeId ||
        row.projectId !== workId ||
        dshAJson(row.scope) !== dshAJson(command.scope) ||
        row.recordDigest !== dshAHash(["dsh-record-v1", plain])
      )
        aFail("DSH_A_OWNER_BASIS_CONFLICT");
    }
    if (dshAJson(imported.receipt) !== dshAJson(b.commandReceipt))
      aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
    const control = b.control as DshARecord,
      work = b.workGuard as DshARecord,
      binding = b.binding as DshARecord;
    if (
      binding.bindingId !== command.bindingId ||
      dshAJson(binding.thread) !== dshAJson(command.thread) ||
      control.stopped !== false ||
      control.generationClosed !== false ||
      control.completionLatch !== false ||
      work.mode !== "auto_draft" ||
      control.workGuardId !== work.id
    )
      aFail("DSH_A_WORK_CLOSED");
    const row = get(
      "SELECT * FROM dsh_a_work_bindings WHERE scope_id=? AND binding_id=?",
      [outboxRow.scope_id, command.bindingId],
    );
    if (!row || row.transport_kind !== "bound")
      aFail("DSH_A_OWNER_BINDING_REQUIRED");
    const localBinding = authorityBody("dsh_a_work_bindings", row);
    if ((localBinding.transport as DshARecord).ownerWorkId !== workId)
      aFail("DSH_A_OWNER_BINDING_CONFLICT");
    const sourceBindingId = (command.thread as DshARecord).sourceBindingId,
      mandateId = command.mandateId;
    if (typeof sourceBindingId !== "string" || typeof mandateId !== "string")
      aFail("DSH_A_SCOPE_CONFLICT");
    const baseline = currentAdmissionBaseline(sourceBindingId, mandateId);
    if (
      baseline.domain.state !== "active" ||
      baseline.mandate.revision !== command.mandateRevision ||
      baseline.mandate.authorizationEpoch !== command.authorizationEpoch ||
      dshAJson((baseline.configuration.binding as DshARecord).authScope) !==
        dshAJson(command.authScope)
    )
      aFail("DSH_A_WORK_AUTHORITY_CHANGED");
    const policies = (command.controlGuards as DshARecord)
        .policies as DshARecord[],
      leaves = (command.controlGuards as DshARecord).leaves as DshARecord[];
    const allHeads: DshARecord[] = [];
    for (let i = 0; i < baseline.heads.length; i++)
      aPush(allHeads, baseline.heads[i]!);
    for (let i = 0; i < allHeads.length; i++) {
      const head = allHeads[i]!;
      let matched = false;
      const refs = head.recordKind === "leaf" ? leaves : policies;
      const receipt = get(
        "SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
        [outboxRow.scope_id, head.operationId, outboxRow.target_domain],
      );
      if (!receipt) aFail("DSH_A_BASELINE_UNCONFIRMED");
      const actual = authorityBody("dsh_a_control_domain_receipts", receipt)
        .ownerControl as DshARecord;
      for (let j = 0; j < refs.length; j++) {
        const ref = refs[j]!;
        if (
          head.recordKind === "leaf"
            ? ref.id === head.controlId
            : ref.scopeKey === head.scopeKey && ref.axis === head.axis
        ) {
          if (
            ref.epoch !== actual.epoch ||
            ref.canonicalHash !== actual.canonicalHash ||
            ref.controlRevision !== actual.revision
          )
            aFail("DSH_A_WORK_AUTHORITY_CHANGED");
          matched = true;
        }
      }
      if (!matched) aFail("DSH_A_WORK_AUTHORITY_CHANGED");
    }
    const clock = invokeSource(readOriginalMainDshClock, undefined, [
      source,
      owner,
      source,
    ]) as ReturnType<typeof readOriginalMainDshClock>;
    if (
      clock.projection.state !== "verified" ||
      clock.projection.nowMs >=
        instantMs(command.authorityValidUntil as string) ||
      clock.projection.nowMs >= instantMs(command.executionDeadline as string)
    )
      aFail("DSH_A_TIME_UNCONFIRMED");
    invokeSource(assertOriginalMainDshPhysicalCompositionCached, undefined, [
      source,
      owner,
      budgetBinding.runtime,
      budgetBinding.source,
    ]);
    const ids = control.validInputIds;
    if (!aArray(ids) || !ids.length) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    const entries: DshARecord[] = [];
    for (let i = 0; i < ids.length; i++) {
      const input = readData("dsh_a_inbox", "input_id", ids[i] as string);
      if (!input) aFail("DSH_A_INPUT_NOT_FOUND");
      validateDshAStoredBody("dsh_a_inbox", input);
      const e = input.envelope as DshARecord;
      if (dshAJson(e.thread) !== dshAJson(command.thread))
        aFail("DSH_A_SCOPE_CONFLICT");
      const head = readData(
          "dsh_a_object_heads",
          "object_id",
          dshSourceObjectIdentity(dshAObservation(e)),
        ),
        state = head?.state as DshARecord | undefined,
        current = state?.current as DshARecord | undefined;
      if (
        !state ||
        state.freeze !== null ||
        !current ||
        current.contentHash !== e.contentHash ||
        current.providerRevision !== e.providerRevision
      )
        aFail("DSH_A_INPUT_NOT_CURRENT");
      const acceptedRow = get(
        "SELECT o.* FROM dsh_a_command_outbox o JOIN dsh_a_owner_receipts r ON r.scope_id=o.scope_id AND r.command_id=o.command_id WHERE o.scope_id=? AND o.binding_id=? AND o.input_id=?",
        [outboxRow.scope_id, command.bindingId, ids[i]],
      );
      if (!acceptedRow) aFail("DSH_A_INPUT_NOT_CONSUMED");
      const accepted = authorityBody("dsh_a_command_outbox", acceptedRow)
          .command as DshARecord,
        manifest = (accepted.evidence as DshARecord).manifest as DshARecord;
      const original = manifest.entries as DshARecord[];
      let entry: DshARecord | undefined;
      for (let j = 0; j < original.length; j++)
        if (original[j]!.inputId === ids[i]) {
          if (entry) aFail("DSH_A_INPUT_CONFLICT");
          entry = original[j];
        }
      if (
        !entry ||
        entry.contentHash !== e.contentHash ||
        entry.objectId !== e.objectId ||
        entry.revision !== e.providerRevision
      )
        aFail("DSH_A_INPUT_CONFLICT");
      aPush(entries, entry);
    }
    for (let i = 1; i < entries.length; i++) {
      const value = entries[i]!;
      let j = i;
      while (
        j > 0 &&
        (entries[j - 1]!.inputId as string) > (value.inputId as string)
      ) {
        entries[j] = entries[j - 1]!;
        j--;
      }
      entries[j] = value;
    }
    invokeSource(clock.assertLocal, undefined, [], true);
    return {
      outboxRow,
      outbox,
      command,
      basis: b,
      baseline,
      workId,
      entries,
      scopeId: outboxRow.scope_id as string,
      targetDomain: outboxRow.target_domain as string,
    };
  }
  function sourceBodies(manifest: DshARecord) {
    const rows: Array<{
      inputId: string;
      snapshotRef: string;
      objectKind: string;
      objectId: string;
      providerRevision: string;
      contentHash: string;
      title: string | null;
      body: string | null;
    }> = [];
    if (!Array.isArray(manifest.entries))
      aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i] as DshARecord,
        input = readData("dsh_a_inbox", "input_id", entry.inputId as string);
      if (!input) aFail("DSH_A_INPUT_NOT_FOUND");
      const envelope = input.envelope as DshARecord;
      const stored = get(
        "SELECT data_json,body_hash FROM dsh_a_source_snapshots WHERE snapshot_id=?",
        [envelope.snapshotRef],
      );
      if (!stored) aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
      const snapshot = captureIpcData(
        aJsonParse(stored.data_json as string),
      ) as DshARecord;
      const object = localObject(snapshot.object) as unknown as DshARecord;
      if (
        stored.body_hash !==
          githubReadHash("dsh-source-snapshot-v1", snapshot) ||
        snapshot.snapshotId !==
          "dsh-snapshot:" +
            githubReadHash("dsh-source-snapshot-v1", [
              snapshot.bindingId,
              snapshot.readAttemptId,
              snapshot.entryIndex,
              snapshot.role,
              object,
            ])
      )
        aFail("DSH_A_SOURCE_CONTENT_CONFLICT");
      if (
        !object ||
        snapshot.snapshotId !== envelope.snapshotRef ||
        snapshot.bindingId !==
          (envelope.thread as DshARecord).sourceBindingId ||
        object.objectKind !== envelope.objectKind ||
        object.objectId !== envelope.objectId ||
        object.contentHash !== envelope.contentHash ||
        entry.contentHash !== envelope.contentHash ||
        entry.revision !== envelope.providerRevision
      )
        aFail("DSH_A_SOURCE_CONTENT_CONFLICT");
      aPush(rows, {
        inputId: entry.inputId as string,
        snapshotRef: envelope.snapshotRef as string,
        objectKind: envelope.objectKind as string,
        objectId: envelope.objectId as string,
        providerRevision: envelope.providerRevision as string,
        contentHash: envelope.contentHash as string,
        title: object.title as string | null,
        body: object.body as string | null,
      });
    }
    return aFreezeData(rows);
  }
  function admissionCommand(
    calculation: ReturnType<typeof calculateAdmission>,
    reservationId: string,
  ) {
    const { basis, snapshot, assessment } = calculation;
    if (
      !assessment ||
      snapshot.freshness.state !== "known" ||
      snapshot.binding.state !== "known"
    )
      aFail("DSH_A_COMMAND_BASIS_REQUIRED");
    let workOwner: (typeof basis.mandate.ownerDomains)[number] | undefined;
    for (let i = 0; i < basis.mandate.ownerDomains.length; i++)
      if (basis.mandate.ownerDomains[i]!.kind === "work") {
        if (workOwner) aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
        workOwner = basis.mandate.ownerDomains[i];
      }
    if (!workOwner) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
    const policies: DshARecord[] = [],
      leaves: DshARecord[] = [],
      modes: DshARecord[] = [];
    const ownerControl = (head: DshARecord) => {
      const row = get(
        "SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
        [basis.domainRow.scope_id, head.operationId, workOwner.domainId],
      );
      if (!row) aFail("DSH_A_BASELINE_UNCONFIRMED");
      const control = authorityBody("dsh_a_control_domain_receipts", row)
        .ownerControl as DshARecord;
      if (
        !control ||
        control.id !== head.controlId ||
        control.epoch !== head.epoch
      )
        aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
      return control;
    };
    for (let i = 0; i < basis.modes.length; i++) {
      const head = basis.modes[i]!,
        control = ownerControl(head);
      aPush(modes, { scopeKey: head.scopeKey, epoch: head.epoch });
      aPush(policies, {
        scopeKey: head.scopeKey,
        axis: "mode",
        epoch: head.epoch,
        canonicalHash: control.canonicalHash,
        controlRevision: control.revision,
      });
      // Original B references are prefix-major, with the five fixed axes at
      // each prefix. The mode-only window hash remains its separate 5 rows.
      const axes = ["mandate", "egress", "privacy", "readonly"];
      for (let j = 0; j < axes.length; j++) {
        const policy = basis.policies[i * axes.length + j];
        if (
          !policy ||
          policy.scopeKey !== head.scopeKey ||
          policy.axis !== axes[j]
        )
          aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
        const actual = ownerControl(policy);
        aPush(policies, {
          scopeKey: policy.scopeKey,
          axis: policy.axis,
          epoch: policy.epoch,
          canonicalHash: actual.canonicalHash,
          controlRevision: actual.revision,
        });
      }
    }
    for (let i = 0; i < basis.leaves.length; i++) {
      const head = basis.leaves[i]!,
        control = ownerControl(head);
      aPush(leaves, {
        id: control.id,
        epoch: control.epoch,
        canonicalHash: control.canonicalHash,
        controlRevision: control.revision,
      });
    }
    const bound =
      snapshot.binding.value.kind === "bound" ? snapshot.binding.value : null;
    if (snapshot.binding.value.kind === "reserved")
      aFail("DSH_A_BINDING_PENDING");
    const bindingId = bound
      ? bound.binding.bindingId
      : "dsh-work-binding:" +
        dshAHash([
          "dsh-a-work-binding-v1",
          basis.scope,
          snapshot.input.envelope.thread,
          1,
        ]);
    const target = bound
      ? {
          ownerWorkId:
            bound.binding.transport.kind === "bound"
              ? bound.binding.transport.ownerWorkId
              : "",
          ownerVersion: bound.ownerVersion,
        }
      : null;
    const authority = {
      mandateId: basis.mandate.mandateId,
      mandateRevision: basis.mandate.revision,
      authorizationEpoch: basis.mandate.authorizationEpoch,
      admissionWindowRef: snapshot.freshness.value.window.windowId,
      freshnessAttestationRef: snapshot.freshness.value.attestationRef,
      authorityValidUntil: aApply(
        aIso,
        new ADate(
          aMinimum(
            instantMs(basis.mandate.validUntil),
            instantMs(basis.egress.validUntil as string),
          ),
        ),
        [],
      ) as string,
      executionDeadline:
        bound && bound.binding.transport.kind === "bound"
          ? bound.binding.transport.workExecutionDeadline
          : basis.mandate.limits.executionDeadline,
      executionProfile: "model_text_only_v1",
      modeGuards: modes,
      controlGuards: { policies, leaves },
      workGuard: bound
        ? {
            scopeKey: bound.workGuard.scopeKey,
            epoch: bound.workGuard.epoch,
            revision: bound.workGuard.revision,
          }
        : null,
      egressGuard: {
        policyRef: basis.egress.policyRef as string,
        epoch: basis.egress.epoch as number,
        policyHash: basis.leaves[2]!.policyHash as string,
      },
      freshness: {
        window: snapshot.freshness.value.window as unknown as DshARecord,
        eventTimeEvidenceRef: snapshot.freshness.value.eventTimeEvidenceRef,
        attestationRef: snapshot.freshness.value.attestationRef,
      },
    };
    const attemptId =
      "dsh-a-owner-command:" +
      dshAHash([
        "dsh-a-owner-command-v1",
        basis.scope,
        bindingId,
        snapshot.input.envelope.inputId,
        assessment.assessmentHash,
        target,
      ]);
    const attestationRef =
      "dsh-a-manifest-link:" +
      dshAHash(["dsh-a-manifest-link-v1", attemptId, calculation.manifest]);
    const input = {
      scope: basis.scope,
      thread: snapshot.input.envelope.thread,
      bindingId,
      generation: 1,
      action: bound ? "append_input" : "create_work",
      input: snapshot.input.envelope,
      inputId: snapshot.input.envelope.inputId,
      evidenceManifest:
        snapshot.input.evidence.state === "known"
          ? snapshot.input.evidence.value
          : undefined,
      assessment,
      authority,
      target,
      budgetReservationRef: reservationId,
      attestationRef,
      attemptId,
    } as unknown as DshAdmissionOwnerCommandInput;
    return {
      ...buildDshAdmissionOwnerCommand(input),
      bindingId,
      ownerDomain: workOwner.domainId,
    };
  }
  function persistAdmissionDecision(
    calculation: ReturnType<typeof calculateAdmission>,
    data: DshARecord,
  ) {
    const { basis, snapshot, suggestion, assessment, candidate, attempt } =
      calculation;
    if (suggestion.kind !== "admission_suggestion")
      aFail("DSH_A_FORMAL_DECISION_REQUIRED");
    const scopeId = basis.domainRow.scope_id,
      inputId = snapshot.input.envelope.inputId,
      mandateId = basis.mandate.mandateId;
    let selected: DshARecord | null = null;
    if (assessment && candidate && attempt) {
      const final = {
        schemaVersion: 1,
        scopeId,
        assessment,
        candidateId: candidate.candidateId,
        attemptId: attempt.attemptId,
      };
      const existingFinal = get(
        "SELECT * FROM dsh_a_assessments WHERE scope_id=? AND attempt_id=?",
        [scopeId, attempt.attemptId],
      );
      if (existingFinal) {
        if (
          existingFinal.assessment_hash !== assessment.assessmentHash ||
          existingFinal.candidate_id !== candidate.candidateId ||
          existingFinal.data_json !== dshAJson(final)
        )
          aFail("DSH_A_ASSESSMENT_SELECTION_CONFLICT");
      } else
        authorityWrite(
          "dsh_a_assessments",
          { scope_id: scopeId, assessment_id: assessment.assessmentId },
          {
            candidate_id: candidate.candidateId,
            attempt_id: attempt.attemptId,
            assessment_hash: assessment.assessmentHash,
          },
          final,
        );
      const priorHead = get(
        "SELECT * FROM dsh_a_selection_heads WHERE scope_id=? AND input_id=? AND mandate_id=?",
        [scopeId, inputId, mandateId],
      );
      const oldSelection = priorHead
        ? authorityBody("dsh_a_selection_heads", priorHead)
        : null;
      selected = {
        schemaVersion: 1,
        scopeId,
        inputId,
        mandateId,
        mandateRevision: basis.mandate.revision,
        assessmentVersion: assessment?.assessmentVersion ?? null,
        assessmentId: assessment.assessmentId,
        assessmentHash: assessment.assessmentHash,
        previousSelectionHash: oldSelection
          ? dshAHash(oldSelection)
          : "0".repeat(64),
      };
      const old = get(
        "SELECT * FROM dsh_a_selections WHERE scope_id=? AND input_id=? AND mandate_id=? AND assessment_version=?",
        [scopeId, inputId, mandateId, assessment.assessmentVersion],
      );
      if (old) {
        const original = authorityBody("dsh_a_selections", old);
        selected = original;
        if (
          original.assessmentId !== assessment.assessmentId ||
          original.assessmentHash !== assessment.assessmentHash
        )
          aFail("DSH_A_ASSESSMENT_SELECTION_CONFLICT");
      } else {
        if (
          assessment.assessmentVersion !==
            aNumber(data.expectedSelectionRevision) + 1 ||
          (assessment.assessmentVersion === 2 &&
            get(
              "SELECT command_id FROM dsh_a_command_outbox WHERE scope_id=? AND input_id=?",
              [scopeId, inputId],
            ))
        )
          aFail("DSH_A_ASSESSMENT_REPLACEMENT_FORBIDDEN");
        authorityWrite(
          "dsh_a_selections",
          {
            scope_id: scopeId,
            input_id: inputId,
            mandate_id: mandateId,
            assessment_version: assessment?.assessmentVersion ?? null,
          },
          {
            assessment_id: assessment.assessmentId,
            previous_selection_hash: selected.previousSelectionHash,
          },
          selected,
        );
        const previous = operationKind;
        operationKind = "selection";
        try {
          authorityWrite(
            "dsh_a_selection_heads",
            { scope_id: scopeId, input_id: inputId, mandate_id: mandateId },
            {
              revision: assessment.assessmentVersion,
              assessment_version: assessment?.assessmentVersion ?? null,
            },
            selected,
            Boolean(priorHead),
          );
        } finally {
          operationKind = previous;
        }
      }
    }
    const decisionId =
      "dsh-decision:" +
      dshAHash([
        "dsh-a-decision-v1",
        scopeId,
        inputId,
        mandateId,
        basis.mandate.revision,
        suggestion.evaluatedSnapshotHash,
      ]);
    const decision = {
      schemaVersion: 1,
      scopeId,
      decisionId,
      inputId,
      mandateId,
      mandateRevision: basis.mandate.revision,
      policyVersion: snapshot.policyVersion,
      evaluatedSnapshotHash: suggestion.evaluatedSnapshotHash,
      assessmentVersion: assessment?.assessmentVersion ?? null,
      suggestion,
    };
    const oldDecision = get(
      "SELECT * FROM dsh_a_decisions WHERE scope_id=? AND decision_id=?",
      [scopeId, decisionId],
    );
    if (oldDecision) {
      if (oldDecision.data_json !== dshAJson(decision))
        aFail("DSH_A_DECISION_CONFLICT");
    } else
      authorityWrite(
        "dsh_a_decisions",
        { scope_id: scopeId, decision_id: decisionId },
        {
          input_id: inputId,
          mandate_id: mandateId,
          policy_version: snapshot.policyVersion,
          mandate_revision: basis.mandate.revision,
          evaluated_snapshot_hash: suggestion.evaluatedSnapshotHash,
          assessment_version: assessment?.assessmentVersion ?? null,
          supersedes_decision_id: null,
        },
        decision,
      );

    return { scopeId, inputId, mandateId, decisionId, decision, selected };
  }
  function body(
    frame: object,
    purpose: string,
    context: unknown,
    action: (
      data: unknown,
      userView?: ReturnType<typeof readOriginalMainDshControl>,
    ) => unknown,
    write: boolean | "snapshot" = true,
    setupSession?: unknown,
  ) {
    if (busy || writer.transactionPhase || writer.admissionInvocation)
      aFail("DSH_A_TRANSACTION_BUSY");
    local();
    if (write === true) assertKnownMultiAgentTransaction(writer);
    if (!nativeTransaction) aFail("DSH_A_NATIVE_TRANSACTION_UNAVAILABLE");
    busy = true;
    const token = { exec: (sql: string) => exec(sql, sql === "ROLLBACK") };
    writer.admissionInvocation = token;
    try {
      nativeState(false);
      operationKind =
        purpose === "enroll_authority" ||
        purpose === "pin_budget" ||
        (purpose === "register_owner" || purpose === "register_broker_owner")
          ? "authority"
          : purpose === "policy_control" || purpose === "commit_source_setup"
            ? "control"
            : purpose === "mandate_control"
              ? "mandate"
              : purpose === "claim_command" || purpose === "control_receipt" || purpose === "broker_control_receipt"
                ? "delivery"
                : purpose === "commit_source_scan" ||
                    purpose === "import_input" ||
                    purpose === "bind_source" ||
                    purpose === "narrow_source"
                  ? "source"
                  : null;
      const opened = open(frame, purpose, context, setupSession);
      guard = opened.current;
      const actionBody = () => {
        nativeState(true);
        const result = action(opened.data, opened.userView);
        opened.current();
        const closedResponse = captureIpcData(result);
        dshAJson(closedResponse);
        guard?.();
        nativeState(true);
        return closedResponse;
      };
      const result = write
        ? writer.bodies.transaction(() => actionBody())
        : action(opened.data, opened.userView);
      nativeState(false);
      if (
        write === true &&
        (purpose === "policy_control" ||
          purpose === "commit_source_setup" ||
          purpose === "enroll_authority" ||
          purpose === "pin_budget" ||
          purpose === "mandate_control" ||
          purpose === "bind_source" ||
          purpose === "narrow_source")
      )
        authorizationRevision++;
      if (write === true) {
        const data = opened.data as DshARecord,
          control =
            data && typeof data === "object"
              ? (data.control as DshARecord | undefined)
              : undefined;
        if (
          purpose === "commit_source_setup" ||
          purpose === "enroll_authority" ||
          purpose === "bind_source" ||
          purpose === "narrow_source" ||
          (purpose === "policy_control" &&
            control &&
            (control.kind === "source_setup" ||
              control.kind === "source_config" ||
              (control.kind === "mode" &&
                (control.identity as DshARecord).kind !== "mandate")))
        )
          sourceAuthorizationRevision++;
      }
      return result;
    } catch (error) {
      remember(error);
      if (nativeTransaction) {
        try {
          if (aApply(nativeTransaction, db, []) === true) {
            poison(error);
            try {
              exec("ROLLBACK", true);
            } catch (secondary) {
              remember(secondary);
            }
          }
        } catch (secondary) {
          poison(error);
          inventory(secondary);
        }
      }
      throw error;
    } finally {
      operationKind = null;
      guard = undefined;
      writer.admissionInvocation = undefined;
      busy = false;
    }
  }
  const port = aFreeze({
    prepareDraft(frame: object, context: unknown) {
      local();
      const root = {};
      pending.add(root);
      try {
        if (!budgetBinding || !ownerBinding)
          aFail("DSH_A_OWNER_BINDING_REQUIRED");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "draft_prepare"],
        ) as {
          ownerObservation?: object;
          budgetWorkSnapshot?: object;
          admissionProposal?: object;
          budgetReservation?: object;
          budgetReserveProof?: object;
        };
        if (!refs.ownerObservation || !refs.budgetWorkSnapshot)
          aFail("DSH_A_DRAFT_BASIS_REQUIRED");
        const view = invokeSource(readOriginalKSwarmDshReply, undefined, [
          ownerBinding.service,
          ownerBinding.admission,
          refs.ownerObservation,
        ]) as KSwarmDshReplyView;
        invokeSource(view.assertKnown, undefined, [], true);
        if (!refs.admissionProposal)
          invokeSource(view.assertCurrent, undefined, [], true);
        const work = invokeSource(
          readOriginalDshBudgetWorkSnapshot,
          undefined,
          [budgetBinding.port, refs.budgetWorkSnapshot],
        ) as ReturnType<typeof readOriginalDshBudgetWorkSnapshot>;
        if (
          work.state !== "observed" ||
          !work.reservation ||
          !work.head ||
          work.head.state !== "bound"
        )
          aFail("DSH_A_BUDGET_WORK_REQUIRED");
        const prior = refs.admissionProposal
          ? (aApply(aWG, draftProposals, [refs.admissionProposal]) as
              | {
                  realm: unknown;
                  data: DshARecord;
                  view: DshDraftAdmissionRequestView;
                  command: Readonly<DshARecord>;
                  scopeId: string;
                  targetDomain: string;
                  accept(commandId: string): void;
                }
              | undefined)
          : undefined;
        let fund: ReturnType<typeof readOriginalDshDraftAdmission> | undefined;
        if (refs.admissionProposal) {
          if (
            !prior ||
            prior.realm !== source ||
            !refs.budgetReservation ||
            !refs.budgetReserveProof
          )
            aFail("DSH_A_ORIGINAL_ADMISSION_PROPOSAL_REQUIRED");
          invokeSource(prior.view.assertCurrent, undefined, [], true);
          invokeSource(
            assertOriginalDshDraftAdmissionReserved,
            undefined,
            [
              budgetBinding.port,
              refs.budgetReserveProof,
              refs.budgetReservation,
            ],
            true,
          );
          fund = invokeSource(readOriginalDshDraftAdmission, undefined, [
            budgetBinding.port,
            refs.budgetReservation,
          ]) as ReturnType<typeof readOriginalDshDraftAdmission>;
        }
        let captured: ReturnType<typeof draftPreparationBasis> | undefined,
          prepared:
            | ReturnType<typeof buildDshDraftPreparationOwnerCommand>
            | undefined,
          dataCopy: DshARecord | undefined,
          acceptedId: string | undefined,
          totalChanges = 0;
        const result = body(
          frame,
          "draft_prepare",
          context,
          (data) => {
            requireProfile();
            dshAFields(data, ["commandId"]);
            if (
              typeof data.commandId !== "string" ||
              !data.commandId ||
              data.commandId.length > 256
            )
              aFail("DSH_A_COMMAND_NOT_FOUND");
            if (prior && dshAJson(prior.data) !== dshAJson(data))
              aFail("DSH_A_PROPOSAL_CONFLICT");
            const basis = draftPreparationBasis(data.commandId, view),
              r = work.reservation!,
              h = work.head!;
            if (
              typeof r.scope_json !== "string" ||
              typeof r.thread_json !== "string" ||
              typeof r.reservation_id !== "string"
            )
              aFail("DSH_A_BUDGET_WORK_CONFLICT");
            if (
              work.status.account.owner_id !== budgetBinding!.binding.ownerId ||
              work.status.account.account_id !==
                basis.baseline.mandate.budgetRef ||
              r.account_id !== basis.baseline.mandate.budgetRef ||
              r.binding_id !== basis.command.bindingId ||
              h.owner_work_id !== basis.workId ||
              dshAJson(aJsonParse(r.scope_json)) !==
                dshAJson(basis.command.scope) ||
              dshAJson(aJsonParse(r.thread_json)) !==
                dshAJson(basis.command.thread)
            )
              aFail("DSH_A_BUDGET_WORK_CONFLICT");
            const stamp = (
              (basis.command.evidence as DshARecord).manifest as DshARecord
            ).sourceSnapshotAt as string;
            const attemptId =
              "dsh-a-draft-command:" +
              dshAHash([
                "dsh-a-draft-command-v1",
                basis.scopeId,
                basis.command.bindingId,
                (basis.basis.control as DshARecord).inputSetRevision,
                basis.command.assessmentHash,
              ]);
            const command = buildDshDraftPreparationOwnerCommand({
              acceptedCommand: basis.command,
              ownerBasis: basis.basis,
              entries: basis.entries,
              sourceSnapshotAt: stamp,
              budgetReservationRef: r.reservation_id,
              attemptId,
            });
            const existing = get(
              "SELECT * FROM dsh_a_command_outbox WHERE scope_id=? AND command_id=?",
              [basis.scopeId, attemptId],
            );
            if (existing) {
              const old = authorityBody("dsh_a_command_outbox", existing);
              if (dshAJson(old.command) !== dshAJson(command.command))
                aFail("DSH_A_COMMAND_CONFLICT");
              return {
                ok: true,
                state: "reconcile",
                commandId: attemptId,
                bindingId: basis.command.bindingId,
              };
            }
            captured = basis;
            prepared = command;
            dataCopy = captureIpcData(data) as DshARecord;
            totalChanges = aNumber(
              get("SELECT total_changes() changes")!.changes,
            );
            if (!fund) return { ok: true, state: "funding_required" };
            if (
              !prior ||
              dshAJson(prior.command) !== dshAJson(command.command) ||
              fund.data.purpose !== "draft_prepare" ||
              fund.data.issuerDomain !== basis.baseline.mandate.budgetRef ||
              fund.data.operationKey !== command.command.operationKey ||
              fund.data.semanticPayloadHash !==
                command.command.semanticPayloadHash ||
              fund.data.assessmentRef !== basis.command.assessmentRef ||
              fund.data.reservationId !== r.reservation_id ||
              fund.data.mandateId !== basis.command.mandateId ||
              fund.data.mandateRevision !== basis.command.mandateRevision ||
              fund.data.authorizationEpoch !==
                basis.command.authorizationEpoch ||
              fund.reservation.initial_tokens !== r.initial_tokens ||
              fund.reservation.initial_cost !== r.initial_cost
            )
              aFail("DSH_A_BUDGET_RESERVATION_CONFLICT");
            const before = guard;
            guard = () => {
              before?.();
              prior.view.assertLocal();
              invokeSource(
                assertOriginalDshDraftAdmissionUnchanged,
                undefined,
                [
                  budgetBinding!.port,
                  refs.budgetReserveProof,
                  refs.budgetReservation,
                ],
                true,
              );
            };
            const outbox = {
              schemaVersion: 1,
              scopeId: basis.scopeId,
              command: command.command,
              targetDomain: basis.targetDomain,
              authorityEpoch: basis.command.authorizationEpoch,
              commandClass: "generating",
              decisionId: basis.outbox.decisionId,
              selectionHash: basis.outbox.selectionHash,
              manifestLink: basis.outbox.manifestLink,
            };
            authorityWrite(
              "dsh_a_command_outbox",
              { scope_id: basis.scopeId, command_id: attemptId },
              {
                binding_id: basis.command.bindingId,
                input_id: basis.command.inputId,
                command_class: "generating",
                operation_key: command.command.operationKey,
                attempt_hash: command.command.attemptPayloadHash,
                semantic_hash: command.command.semanticPayloadHash,
                decision_id: basis.outbox.decisionId,
                target_domain: basis.targetDomain,
              },
              outbox,
            );
            const delivery = {
              schemaVersion: 1,
              scopeId: basis.scopeId,
              commandId: attemptId,
              revision: 1,
              fencingToken: 1,
              state: "pending",
            };
            authorityWrite(
              "dsh_a_delivery_heads",
              { scope_id: basis.scopeId, command_id: attemptId },
              { revision: 1, fencing_token: 1, delivery_state: "pending" },
              delivery,
            );
            acceptedId = attemptId;
            return {
              ok: true,
              state: "command_pending",
              commandId: attemptId,
              bindingId: basis.command.bindingId,
              draftCommitKey: command.draftCommitKey,
            };
          },
          fund ? true : "snapshot",
        ) as DshARecord;
        if (acceptedId) {
          prior!.accept(acceptedId);
          const current = () => prior!.view.assertCurrent();
          aPush(warmCommandAuthorities, {
            commandId: acceptedId,
            receipt: refs.budgetReservation!,
            reserveProof: refs.budgetReserveProof!,
            current,
            reserved() {
              current();
              invokeSource(
                assertOriginalDshDraftAdmissionReserved,
                undefined,
                [
                  budgetBinding!.port,
                  refs.budgetReserveProof,
                  refs.budgetReservation,
                ],
                true,
              );
            },
            local() {
              prior!.view.assertLocal();
              invokeSource(
                assertOriginalDshDraftAdmissionUnchanged,
                undefined,
                [
                  budgetBinding!.port,
                  refs.budgetReserveProof,
                  refs.budgetReservation,
                ],
                true,
              );
            },
          });
          return result;
        }
        if (result.state !== "funding_required") return result;
        const accepted = captured!,
          command = prepared!.command,
          revision = authorizationRevision;
        let committed: string | undefined;
        const assertLocal = () => {
          pureLocal();
          budgetBinding!.binding.assertLocal();
          if (authorizationRevision !== revision) aFail("DSH_A_PROPOSAL_STALE");
        };
        const assertCurrent = () => {
          assertLocal();
          // The B snapshot was authenticated while its original call was
          // current. This accepted A preparation owns its semantic lifetime;
          // a new slot's transport guard must not re-enter the old RPC guard.
          invokeSource(view.assertKnown, undefined, [], true);
          invokeSource(readKSwarmOwnedDshServiceScope, undefined, [
            ownerBinding!.service,
            ownerBinding!.admission,
          ]);
          body(
            frame,
            "draft_prepare",
            context,
            () => {
              const now = draftPreparationBasis(
                dataCopy!.commandId as string,
                view,
              );
              if (
                !committed &&
                aNumber(get("SELECT total_changes() changes")!.changes) !==
                  totalChanges
              )
                aFail("DSH_A_PROPOSAL_STALE");
              if (
                dshAJson(now.entries) !== dshAJson(accepted.entries) ||
                now.baseline.mandate.revision !==
                  accepted.baseline.mandate.revision
              )
                aFail("DSH_A_PROPOSAL_STALE");
              return { ok: true };
            },
            "snapshot",
          );
          assertLocal();
        };
        const domain = accepted.baseline.domain,
          r = work.reservation!;
        const request = aFreezeData({
          storageScope: accepted.command.scope,
          tenantId: (accepted.command.thread as DshARecord).tenantId,
          mandateId: accepted.command.mandateId,
          mandateRevision: accepted.command.mandateRevision,
          authorizationEpoch: accepted.command.authorizationEpoch,
          budgetAuthorityHash: dshAHash([
            "dsh-a-budget-authority-v1",
            {
              storageScope: domain.storageScope,
              principalId: domain.principalId,
              authorityId: domain.authorityId,
              authorityEpoch: domain.authorityEpoch,
            },
          ]),
          accountId: r.account_id,
          bindingId: r.binding_id,
          generation: 1,
          thread: accepted.command.thread,
          initialTokens: r.initial_tokens,
          initialCostMicros: r.initial_cost,
          deadline: r.deadline,
          maxActiveWorks: accepted.baseline.mandate.limits.maxActiveWorks,
          maxDraftRequestsPerWork:
            accepted.baseline.mandate.limits.maxDraftRunsPerWork,
          command: {
            operationKey: command.operationKey,
            semanticPayloadHash: command.semanticPayloadHash,
            assessmentRef: command.assessmentRef,
            purpose: "draft_prepare",
          },
          assertCurrent,
          assertLocal,
        }) as unknown as DshDraftAdmissionRequestView;
        const proof = aFreeze(Object.create(null));
        aApply(aWS, draftProposals, [
          proof,
          {
            realm: source,
            data: dataCopy!,
            view: request,
            command,
            scopeId: accepted.scopeId,
            targetDomain: accepted.targetDomain,
            accept(id: string) {
              committed = id;
            },
          },
        ]);
        return { ok: true, state: "funding_required", proposal: proof };
      } finally {
        pending.delete(root);
        wake();
      }
    },
    finalizeAdmission(frame: object, context: unknown) {
      local();
      const root = {};
      pending.add(root);
      try {
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "admission_commit"],
        ) as {
          budgetObservation?: object;
          sourceScan?: object;
          ownerObservation?: object;
        };
        let budget: DshBudgetObservationView | undefined,
          budgetCurrent = false;
        if (budgetBinding && refs.budgetObservation) {
          budget = invokeSource(readOriginalDshBudgetObservation, undefined, [
            budgetBinding.port,
            refs.budgetObservation,
          ]) as DshBudgetObservationView;
          try {
            invokeSource(
              assertOriginalDshBudgetObservationCurrent,
              undefined,
              [budgetBinding.port, refs.budgetObservation],
              true,
            );
            budgetCurrent = true;
          } catch (error) {
            remember(error);
            local();
          }
        }
        return body(frame, "admission_commit", context, (data) => {
          requireProfile();
          dshAFields(data, [
            "schemaVersion",
            "bindingId",
            "inputId",
            "proofVersion",
            "mandateId",
            "candidateId",
            "expectedSelectionRevision",
            "expectedBindingRevision",
          ]);
          if (budgetCurrent) {
            const previous = guard;
            guard = () => {
              previous?.();
              invokeSource(
                assertOriginalDshBudgetObservationUnchanged,
                undefined,
                [budgetBinding!.port, refs.budgetObservation],
                true,
              );
            };
          }
          const calculation = calculateAdmission(
              data,
              refs,
              budget,
              undefined,
              true,
              budgetCurrent,
            ),
            { basis, snapshot, suggestion } = calculation;
          if (suggestion.kind === "shadow_suggestion") {
            const value = {
              schemaVersion: 1,
              scopeId: basis.domainRow.scope_id,
              inputId: snapshot.input.envelope.inputId,
              mandateId: basis.mandate.mandateId,
              mandateRevision: basis.mandate.revision,
              policyVersion: snapshot.policyVersion,
              evaluatedSnapshotHash: suggestion.evaluatedSnapshotHash,
              suggestion,
            };
            const key = {
              scope_id: value.scopeId,
              input_id: value.inputId,
              mandate_id: value.mandateId,
              policy_version: value.policyVersion,
              mandate_revision: value.mandateRevision,
              evaluated_snapshot_hash: value.evaluatedSnapshotHash,
            };
            const old = get(
              "SELECT data_json FROM dsh_a_shadow_results WHERE scope_id=? AND input_id=? AND mandate_id=? AND policy_version=? AND mandate_revision=? AND evaluated_snapshot_hash=?",
              [
                value.scopeId,
                value.inputId,
                value.mandateId,
                value.policyVersion,
                value.mandateRevision,
                value.evaluatedSnapshotHash,
              ],
            );
            if (old) {
              if (old.data_json !== dshAJson(value))
                aFail("DSH_A_DECISION_CONFLICT");
              return {
                ok: true,
                state: "shadow",
                shadow: value,
                replayed: true,
              };
            }
            authorityWrite("dsh_a_shadow_results", key, {}, value);
            return { ok: true, state: "shadow", shadow: value };
          }
          if (
            suggestion.verdict === "accept" ||
            suggestion.verdict === "followup"
          )
            aFail("DSH_A_COMMAND_AUTHORITY_REQUIRED");
          const { decision } = persistAdmissionDecision(calculation, data);
          return { ok: true, state: "review", decision };
        });
      } finally {
        pending.delete(root);
        wake();
      }
    },
    async importOwnerReceipt(frame: object, context: unknown) {
      local();
      const root = {};
      pending.add(root);
      let view: KSwarmDshReplyView | undefined;
      try {
        if (!ownerBinding) aFail("DSH_A_OWNER_BINDING_REQUIRED");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "owner_reconcile"],
        ) as { ownerObservation?: object };
        if (!refs.ownerObservation) aFail("DSH_A_OWNER_BASIS_REQUIRED");
        view = invokeSource(readOriginalKSwarmDshReply, undefined, [
          ownerBinding.service,
          ownerBinding.admission,
          refs.ownerObservation,
        ]) as KSwarmDshReplyView;
        const tail = aApply(view.waitKnown, undefined, []);
        retain(tail, aPromise(tail) ? "promise" : "unknown");
        assertStandardIpcPromise(tail, "DSH_A_OWNER_FATE_UNCONFIRMED");
        await (tail as Promise<void>);
        return body(frame, "owner_reconcile", context, (opened) => {
          requireProfile();
          const data = (
            opened as { request: DshARecord; reply: KSwarmDshReplyView }
          ).request;
          view = (opened as { request: DshARecord; reply: KSwarmDshReplyView })
            .reply;
          dshAFields(data, ["commandId"]);
          if (typeof data.commandId !== "string")
            aFail("DSH_A_COMMAND_NOT_FOUND");
          // Settlement authenticates the original reply and Native A lifetime.
          // It never resurrects the old generating Source/current permission.
          const native = invokeSource(
            readOriginalMainDshBootstrapAuthority,
            undefined,
            [source, owner, source],
          ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
          invokeSource(native.assertCurrent, undefined, [], true);
          invokeSource(view!.assertKnown, undefined, [], true);
          if (
            (view!.operation !== "read_dsh_basis" &&
              view!.operation !== "apply_dsh_command" &&
              view!.operation !== "prepare_dsh_slot") ||
            dshAJson(view!.scope) !== dshAJson(ownerBinding!.scope)
          )
            aFail("DSH_A_OWNER_BASIS_REQUIRED");
          const outboxRow = get(
            "SELECT * FROM dsh_a_command_outbox WHERE command_id=?",
            [data.commandId],
          );
          if (!outboxRow) aFail("DSH_A_COMMAND_NOT_FOUND");
          const outbox = authorityBody("dsh_a_command_outbox", outboxRow),
            command = outbox.command as DshARecord,
            wire = captureIpcData(view!.input) as DshARecord;
          const outcome = captureIpcData(view!.output) as DshARecord;
          if (
            view!.operation !== "read_dsh_basis" ||
            (outcome.receipt as DshARecord | undefined)?.result === "blocked"
          ) {
            const output = outcome,
              receipt = output.receipt as DshARecord;
            if (
              output.ok !== false ||
              !receipt ||
              receipt.kind !== "dsh_command" ||
              receipt.result !== "blocked" ||
              (view!.operation === "read_dsh_basis"
                ? !matchesOwnerBasisInput(wire, command)
                : dshAJson(wire.data) !== dshAJson(command)) ||
              dshAJson(receipt.command) !== dshAJson(command) ||
              receipt.commandId !== command.commandId ||
              receipt.operationKey !== command.operationKey ||
              receipt.semanticPayloadHash !== command.semanticPayloadHash ||
              !aArray(receipt.consumedInputIds) ||
              receipt.consumedInputIds.length !== 0 ||
              (view!.operation !== "read_dsh_basis" &&
                (view!.operation === "prepare_dsh_slot") !==
                  (command.action === "prepare_draft"))
            )
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
            const registrationRow = get(
              "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
              [outboxRow.scope_id, outboxRow.target_domain],
            );
            if (!registrationRow) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
            const registration = authorityBody(
                "dsh_a_owner_domains",
                registrationRow,
              ),
              plain = captureIpcData(receipt) as DshARecord;
            delete plain.recordDigest;
            const workId =
              "dsh-work:" +
              dshAHash(["dsh-work-v1", command.scope, command.thread, 1]);
            if (
              receipt.contract !== "dsh_owner_admission_v1" ||
              receipt.schemaVersion !== 1 ||
              receipt.writerStoreId !== registration.storeId ||
              receipt.projectId !== workId ||
              receipt.ownerWorkId !== workId ||
              dshAJson(receipt.scope) !== dshAJson(command.scope) ||
              receipt.recordDigest !== dshAHash(["dsh-record-v1", plain])
            )
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
            const value = {
              schemaVersion: 1,
              scopeId: outboxRow.scope_id,
              acceptedCommandId: command.commandId,
              receiptId: receipt.id,
              ownerReceiptCommandId: command.commandId,
              operationKey: command.operationKey,
              semanticPayloadHash: command.semanticPayloadHash,
              receipt,
              basis: null,
              ownerDomain: outboxRow.target_domain,
            };
            const previous = get(
              "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
              [outboxRow.scope_id, command.commandId],
            );
            if (previous) {
              if (
                dshAJson(
                  authorityBody("dsh_a_owner_receipts", previous).receipt,
                ) !== dshAJson(receipt)
              )
                aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
            } else
              authorityWrite(
                "dsh_a_owner_receipts",
                { scope_id: outboxRow.scope_id, command_id: command.commandId },
                { receipt_id: receipt.id, receipt_hash: receipt.recordDigest },
                value,
              );
            const delivery = get(
              "SELECT * FROM dsh_a_delivery_heads WHERE scope_id=? AND command_id=?",
              [outboxRow.scope_id, command.commandId],
            );
            if (!delivery) aFail("DSH_A_DELIVERY_CONFLICT");
            if (delivery.delivery_state !== "receipt_observed") {
              const prior = authorityBody("dsh_a_delivery_heads", delivery),
                next = {
                  ...prior,
                  revision: aNumber(delivery.revision) + 1,
                  state: "receipt_observed",
                };
              const kind = operationKind;
              operationKind = "delivery";
              try {
                authorityWrite(
                  "dsh_a_delivery_heads",
                  {
                    scope_id: outboxRow.scope_id,
                    command_id: command.commandId,
                  },
                  {
                    revision: next.revision,
                    fencing_token: delivery.fencing_token,
                    delivery_state: "receipt_observed",
                  },
                  next,
                  true,
                );
              } finally {
                operationKind = kind;
              }
            }
            return {
              ok: true,
              state: "blocked",
              receipt: value,
              replayed: Boolean(previous),
            };
          }
          if (!matchesOwnerBasisInput(wire, command))
            aFail("DSH_A_OWNER_BASIS_CONFLICT");
          const output = captureIpcData(view!.output) as DshARecord,
            basis = output.basis as DshARecord;
          if (
            output.ok !== true ||
            !basis ||
            basis.schemaVersion !== 1 ||
            !aInteger(basis.nativeRevision) ||
            aNumber(basis.nativeRevision) < 0
          )
            aFail("DSH_A_OWNER_BASIS_CONFLICT");
          const receipt = basis.commandReceipt as DshARecord,
            operation = basis.appliedOperation as DshARecord,
            binding = basis.binding as DshARecord,
            creation = basis.createRecord as DshARecord,
            control = basis.control as DshARecord,
            workGuard = basis.workGuard as DshARecord;
          const registrationRow = get(
            "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
            [outboxRow.scope_id, outboxRow.target_domain],
          );
          if (!registrationRow) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const registration = authorityBody(
              "dsh_a_owner_domains",
              registrationRow,
            ),
            workId =
              "dsh-work:" +
              dshAHash(["dsh-work-v1", command.scope, command.thread, 1]);
          const records = [
            receipt,
            operation,
            binding,
            creation,
            control,
            workGuard,
          ];
          for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record) aFail("DSH_A_OWNER_BASIS_CONFLICT");
            const plain = captureIpcData(record) as DshARecord;
            delete plain.recordDigest;
            if (
              record.schemaVersion !== 1 ||
              record.contract !== "dsh_owner_admission_v1" ||
              record.writerStoreId !== registration.storeId ||
              record.projectId !== workId ||
              dshAJson(record.scope) !== dshAJson(command.scope) ||
              record.recordDigest !== dshAHash(["dsh-record-v1", plain])
            )
              aFail("DSH_A_OWNER_BASIS_CONFLICT");
          }
          const reported = receipt.command as DshARecord;
          if (
            receipt.kind !== "dsh_command" ||
            receipt.result !== "applied" ||
            receipt.ownerWorkId !== workId ||
            receipt.operationKey !== command.operationKey ||
            receipt.semanticPayloadHash !== command.semanticPayloadHash ||
            dshAJson(reported.scope) !== dshAJson(command.scope) ||
            dshAJson(reported.thread) !== dshAJson(command.thread) ||
            reported.bindingId !== command.bindingId ||
            reported.generation !== 1 ||
            reported.action !== command.action ||
            operation.commandReceiptId !== receipt.id ||
            operation.semanticPayloadHash !== command.semanticPayloadHash ||
            binding.bindingId !== command.bindingId ||
            binding.generation !== 1 ||
            dshAJson(binding.thread) !== dshAJson(command.thread) ||
            binding.threadKey !==
              "dsh-thread:" + dshAHash(["dsh-thread-v1", command.thread])
          )
            aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
          if (reported.commandId === command.commandId) {
            if (reported.attemptPayloadHash !== command.attemptPayloadHash)
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
          } else {
            const original = get(
              "SELECT * FROM dsh_a_command_outbox WHERE scope_id=? AND command_id=?",
              [outboxRow.scope_id, reported.commandId],
            );
            if (
              !original ||
              original.operation_key !== command.operationKey ||
              original.semantic_hash !== command.semanticPayloadHash
            )
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
          }
          const consumed = receipt.consumedInputIds,
            preparingDraft = command.action === "prepare_draft";
          if (
            !Array.isArray(consumed) ||
            (preparingDraft
              ? consumed.length !== 0
              : consumed.length !== 1 || consumed[0] !== command.inputId) ||
            !aInteger(receipt.ownerVersion) ||
            aNumber(receipt.ownerVersion) < 1 ||
            !aInteger(receipt.inputSetRevision) ||
            aNumber(receipt.inputSetRevision) < 1 ||
            aNumber(control.ownerVersion) < aNumber(receipt.ownerVersion) ||
            aNumber(control.inputSetRevision) <
              aNumber(receipt.inputSetRevision)
          )
            aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
          if (preparingDraft) {
            const expectedSlot =
              "dsh-draft:" +
              dshAHash([
                "dsh-draft-commit-v1",
                command.scope,
                workId,
                command.bindingId,
                1,
                command.inputSetRevision,
                command.assessmentHash,
              ]);
            if (
              receipt.slotId !== expectedSlot ||
              operation.slotId !== expectedSlot ||
              receipt.inputSetRevision !== command.inputSetRevision
            )
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
          }
          if (
            !aInteger(basis.projectCreatedAt) ||
            aNumber(basis.projectCreatedAt) < 0 ||
            instantMs(control.workCreatedAt as string) !==
              basis.projectCreatedAt ||
            workGuard.id !== control.workGuardId
          )
            aFail("DSH_A_OWNER_BASIS_CONFLICT");
          const workRow = get(
            "SELECT * FROM dsh_a_work_bindings WHERE scope_id=? AND binding_id=?",
            [outboxRow.scope_id, command.bindingId],
          );
          if (!workRow) aFail("DSH_A_BINDING_CAS_CONFLICT");
          const acceptedBinding = authorityBody("dsh_a_work_bindings", workRow),
            canonical =
              command.action === "create_draft_work"
                ? (command.canonical as DshARecord)
                : null;
          if (
            (canonical &&
              (canonical.inputId !== workRow.canonical_initial_input_id ||
                canonical.createManifestHash !==
                  workRow.canonical_manifest_hash)) ||
            creation.canonicalInputId !== workRow.canonical_initial_input_id ||
            creation.canonicalCreateManifestHash !==
              workRow.canonical_manifest_hash
          )
            aFail("DSH_A_CANONICAL_CONFLICT");
          const value = {
            schemaVersion: 1,
            scopeId: outboxRow.scope_id,
            acceptedCommandId: command.commandId,
            receiptId: receipt.id,
            ownerReceiptCommandId: reported.commandId,
            operationKey: receipt.operationKey,
            semanticPayloadHash: receipt.semanticPayloadHash,
            receipt,
            basis,
            ownerDomain: outboxRow.target_domain,
          };
          const previous = get(
            "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
            [outboxRow.scope_id, command.commandId],
          );
          if (previous) {
            const old = authorityBody("dsh_a_owner_receipts", previous);
            if (dshAJson(old.receipt) !== dshAJson(receipt))
              aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
            return { ok: true, receipt: old, replayed: true };
          }
          authorityWrite(
            "dsh_a_owner_receipts",
            { scope_id: outboxRow.scope_id, command_id: command.commandId },
            { receipt_id: receipt.id, receipt_hash: receipt.recordDigest },
            value,
          );
          if (workRow.transport_kind === "reserved") {
            const next = {
              ...acceptedBinding,
              version: aNumber(workRow.revision) + 1,
              transport: {
                kind: "bound",
                ownerWorkId: workId,
                ownerVersion: receipt.ownerVersion,
                workCreatedAt: control.workCreatedAt,
                workExecutionDeadline: control.executionDeadline,
              },
            };
            const previous = operationKind;
            operationKind = "receipt";
            try {
              authorityWrite(
                "dsh_a_work_bindings",
                { scope_id: outboxRow.scope_id, binding_id: command.bindingId },
                {
                  source_binding_id: workRow.source_binding_id,
                  stable_thread_key: workRow.stable_thread_key,
                  generation: 1,
                  mandate_id: workRow.mandate_id,
                  revision: next.version,
                  transport_kind: "bound",
                  create_command_id: workRow.create_command_id,
                  canonical_initial_input_id:
                    workRow.canonical_initial_input_id,
                  canonical_manifest_hash: workRow.canonical_manifest_hash,
                },
                next,
                true,
              );
            } finally {
              operationKind = previous;
            }
          }
          const deliveryRow = get(
            "SELECT * FROM dsh_a_delivery_heads WHERE scope_id=? AND command_id=?",
            [outboxRow.scope_id, command.commandId],
          );
          if (!deliveryRow) aFail("DSH_A_DELIVERY_CONFLICT");
          const delivery = authorityBody("dsh_a_delivery_heads", deliveryRow),
            next = {
              ...delivery,
              revision: aNumber(deliveryRow.revision) + 1,
              state: "receipt_observed",
            };
          const previousKind = operationKind;
          operationKind = "delivery";
          try {
            authorityWrite(
              "dsh_a_delivery_heads",
              { scope_id: outboxRow.scope_id, command_id: command.commandId },
              {
                revision: next.revision,
                fencing_token: deliveryRow.fencing_token,
                delivery_state: "receipt_observed",
              },
              next,
              true,
            );
          } finally {
            operationKind = previousKind;
          }
          invokeSource(native.assertLocal, undefined, [], true);
          invokeSource(view!.assertKnown, undefined, [], true);
          return {
            ok: true,
            receipt: value,
            bindingId: command.bindingId,
            ownerWorkId: workId,
          };
        });
      } finally {
        pending.delete(root);
        wake();
      }
    },
    commitAdmission(frame: object, context: unknown) {
      local();
      const root = {};
      pending.add(root);
      try {
        if (!budgetBinding) aFail("DSH_A_BUDGET_BINDING_REQUIRED");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "admission_commit"],
        ) as {
          admissionProposal?: object;
          budgetReservation?: object;
          budgetReserveProof?: object;
          sourceScan?: object;
          ownerObservation?: object;
        };
        const proposal = refs.admissionProposal
          ? (aApply(aWG, admissionProposals, [refs.admissionProposal]) as
              | {
                  realm: unknown;
                  data: DshARecord;
                  calculation: ReturnType<typeof calculateAdmission>;
                  view: DshDraftAdmissionRequestView;
                  accept(commandId: string): void;
                }
              | undefined)
          : undefined;
        if (!proposal || proposal.realm !== source)
          aFail("DSH_A_ORIGINAL_ADMISSION_PROPOSAL_REQUIRED");
        if (!refs.budgetReservation || !refs.budgetReserveProof)
          aFail("DSH_A_BUDGET_RESERVATION_REQUIRED");
        invokeSource(
          assertOriginalDshDraftAdmissionReserved,
          undefined,
          [budgetBinding.port, refs.budgetReserveProof, refs.budgetReservation],
          true,
        );
        const fund = invokeSource(readOriginalDshDraftAdmission, undefined, [
          budgetBinding.port,
          refs.budgetReservation,
        ]) as ReturnType<typeof readOriginalDshDraftAdmission>;
        let acceptedCommandId: string | undefined;
        const result = body(frame, "admission_commit", context, (data) => {
          requireProfile();
          dshAFields(data, [
            "schemaVersion",
            "bindingId",
            "inputId",
            "proofVersion",
            "mandateId",
            "candidateId",
            "expectedSelectionRevision",
            "expectedBindingRevision",
          ]);
          if (dshAJson(data) !== dshAJson(proposal.data))
            aFail("DSH_A_PROPOSAL_CONFLICT");
          const originalGuard = guard;
          guard = () => {
            originalGuard?.();
            invokeSource(proposal.view.assertLocal, undefined, [], true);
            invokeSource(
              assertOriginalDshDraftAdmissionUnchanged,
              undefined,
              [
                budgetBinding!.port,
                refs.budgetReserveProof,
                refs.budgetReservation,
              ],
              true,
            );
          };
          const budget: DshBudgetObservationView = {
            schemaVersion: 1,
            kind: "ledger_observation",
            ownerId: fund.ownerId,
            ownerEpoch: fund.ownerEpoch,
            profileId: fund.data.scope.profileId,
            workspaceId: fund.data.scope.workspaceId,
            status: fund.status,
          };
          const calculation = calculateAdmission(
              data as DshARecord,
              refs,
              budget,
              fund,
            ),
            { snapshot, suggestion, basis, assessment, candidate, attempt } =
              calculation;
          if (suggestion.kind === "shadow_suggestion")
            return { ok: true, state: "shadow", suggestion };
          if (!assessment || !candidate || !attempt)
            aFail("DSH_A_ASSESSMENT_REQUIRED");
          const positive =
            suggestion.verdict === "accept" ||
            suggestion.verdict === "followup";
          const command = positive
            ? admissionCommand(calculation, fund.data.reservationId)
            : null;
          if (
            command &&
            (fund.data.issuerDomain !== basis.mandate.budgetRef ||
              fund.data.mandateId !== basis.mandate.mandateId ||
              fund.data.mandateRevision !== basis.mandate.revision ||
              fund.data.authorizationEpoch !==
                basis.mandate.authorizationEpoch ||
              dshAJson(fund.data.scope) !== dshAJson(basis.scope) ||
              dshAJson(fund.data.thread) !==
                dshAJson(snapshot.input.envelope.thread) ||
              fund.data.operationKey !== command.command.operationKey ||
              fund.data.semanticPayloadHash !==
                command.command.semanticPayloadHash ||
              fund.data.assessmentRef !== assessment.assessmentId ||
              fund.data.purpose !== "draft_admission" ||
              fund.data.state !== "reserved" ||
              fund.reservation.initial_tokens !== proposal.view.initialTokens ||
              fund.reservation.initial_cost !== proposal.view.initialCostMicros)
          )
            aFail("DSH_A_BUDGET_RESERVATION_CONFLICT");
          const {
            scopeId,
            inputId,
            mandateId,
            decisionId,
            decision,
            selected,
          } = persistAdmissionDecision(calculation, data);
          if (!command) return { ok: true, state: "review", decision };
          if (!calculation.workRow) {
            const binding = {
              bindingId: command.bindingId,
              mandateId,
              thread: snapshot.input.envelope.thread,
              generation: 1,
              ownerKind: "kswarm_dsh",
              version: 1,
              transport: {
                kind: "reserved",
                createOperationKey: command.command.operationKey,
                createCommandId: command.command.commandId,
                canonicalInitialInputId: inputId,
                canonicalCreateManifestHash: command.ownerManifest.manifestHash,
              },
            };
            authorityWrite(
              "dsh_a_work_bindings",
              { scope_id: scopeId, binding_id: command.bindingId },
              {
                source_binding_id: data.bindingId,
                stable_thread_key: dshAHash(snapshot.input.envelope.thread),
                generation: 1,
                mandate_id: mandateId,
                revision: 1,
                transport_kind: "reserved",
                create_command_id: command.command.commandId,
                canonical_initial_input_id: inputId,
                canonical_manifest_hash: command.ownerManifest.manifestHash,
              },
              binding,
            );
          }
          const outbox = {
            schemaVersion: 1,
            scopeId,
            command: command.command,
            targetDomain: command.ownerDomain,
            authorityEpoch: basis.mandate.authorizationEpoch,
            commandClass: "generating",
            decisionId,
            selectionHash: dshAHash(selected),
            manifestLink: command.manifestLink,
          };
          const previousCommand = get(
            "SELECT * FROM dsh_a_command_outbox WHERE scope_id=? AND command_id=?",
            [scopeId, command.command.commandId],
          );
          if (previousCommand) {
            if (previousCommand.data_json !== dshAJson(outbox))
              aFail("DSH_A_COMMAND_CONFLICT");
          } else {
            authorityWrite(
              "dsh_a_command_outbox",
              { scope_id: scopeId, command_id: command.command.commandId },
              {
                binding_id: command.bindingId,
                input_id: inputId,
                command_class: "generating",
                operation_key: command.command.operationKey,
                attempt_hash: command.command.attemptPayloadHash,
                semantic_hash: command.command.semanticPayloadHash,
                decision_id: decisionId,
                target_domain: command.ownerDomain,
              },
              outbox,
            );
            const delivery = {
              schemaVersion: 1,
              scopeId,
              commandId: command.command.commandId,
              revision: 1,
              fencingToken: 1,
              state: "pending",
            };
            authorityWrite(
              "dsh_a_delivery_heads",
              { scope_id: scopeId, command_id: command.command.commandId },
              { revision: 1, fencing_token: 1, delivery_state: "pending" },
              delivery,
            );
          }
          acceptedCommandId = command.command.commandId as string;
          return {
            ok: true,
            state: "command_pending",
            decision,
            commandId: acceptedCommandId,
            bindingId: command.bindingId,
          };
        });
        if (acceptedCommandId) {
          proposal.accept(acceptedCommandId);
          const current = () => {
            proposal.view.assertCurrent();
          };
          const reserved = () => {
            current();
            invokeSource(
              assertOriginalDshDraftAdmissionReserved,
              undefined,
              [
                budgetBinding!.port,
                refs.budgetReserveProof,
                refs.budgetReservation,
              ],
              true,
            );
          };
          const local = () => {
            proposal.view.assertLocal();
            invokeSource(
              assertOriginalDshDraftAdmissionUnchanged,
              undefined,
              [
                budgetBinding!.port,
                refs.budgetReserveProof,
                refs.budgetReservation,
              ],
              true,
            );
          };
          aPush(warmCommandAuthorities, {
            commandId: acceptedCommandId,
            receipt: refs.budgetReservation,
            reserveProof: refs.budgetReserveProof,
            current,
            reserved,
            local,
          });
        }
        return result;
      } finally {
        pending.delete(root);
        wake();
      }
    },
    prepareAdmission(frame: object, context: unknown) {
      local();
      const root = {};
      pending.add(root);
      try {
        if (!budgetBinding) aFail("DSH_A_BUDGET_BINDING_REQUIRED");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "admission_commit"],
        ) as {
          budgetObservation?: object;
          sourceScan?: object;
          ownerObservation?: object;
        };
        if (!refs.budgetObservation) aFail("DSH_A_BUDGET_OBSERVATION_REQUIRED");
        // Full Source/current is outside the A transaction: its original budget
        // Source re-reads A. The transaction below keeps the account pure cut.
        invokeSource(
          assertOriginalDshBudgetObservationCurrent,
          undefined,
          [budgetBinding.port, refs.budgetObservation],
          true,
        );
        const observed = invokeSource(
          readOriginalDshBudgetObservation,
          undefined,
          [budgetBinding.port, refs.budgetObservation],
        ) as DshBudgetObservationView;
        let calculation: ReturnType<typeof calculateAdmission> | undefined,
          dataCopy: DshARecord | undefined,
          command: ReturnType<typeof admissionCommand> | undefined,
          totalChanges = 0;
        const result = body(frame, "admission_commit", context, (data) => {
          requireProfile();
          dataCopy = data as DshARecord;
          const originalGuard = guard;
          guard = () => {
            originalGuard?.();
            invokeSource(
              assertOriginalDshBudgetObservationUnchanged,
              undefined,
              [budgetBinding!.port, refs.budgetObservation],
              true,
            );
          };
          calculation = calculateAdmission(dataCopy, refs, observed);
          const { snapshot, suggestion, assessment } = calculation;
          if (suggestion.kind === "shadow_suggestion")
            return { ok: true, state: "shadow", suggestion };
          if (
            !assessment ||
            !(
              suggestion.verdict === "accept" ||
              suggestion.verdict === "followup" ||
              (suggestion.verdict === "needs_review" &&
                suggestion.reasonCodes.length === 1 &&
                suggestion.reasonCodes[0] === "BUDGET_UNCONFIRMED")
            )
          )
            return { ok: true, state: "review", suggestion };
          // A proposal is intentionally not a positive decision. The remaining
          // slot/headroom is unknown until the original fund allocates it.
          if (
            assessment.uncertainty !== null ||
            assessment.purpose !== "admission" ||
            snapshot.clock.state !== "verified" ||
            instantMs(assessment.validUntil) <= snapshot.clock.nowMs ||
            snapshot.freshness.state !== "known" ||
            snapshot.freshness.value.state !== "fresh" ||
            snapshot.egress.state !== "known" ||
            snapshot.egress.value.decision !== "allow"
          )
            aFail("DSH_A_PROPOSAL_UNQUALIFIED");
          let draftEgress = false;
          for (let i = 0; i < snapshot.egress.value.purposes.length; i++)
            if (snapshot.egress.value.purposes[i] === "draft")
              draftEgress = true;
          if (!draftEgress) aFail("DSH_A_EGRESS_REQUIRED");
          if (
            snapshot.binding.state !== "known" ||
            snapshot.binding.value.kind === "reserved"
          )
            aFail("DSH_A_BINDING_PENDING");
          const bound =
            snapshot.binding.value.kind === "bound"
              ? snapshot.binding.value
              : null;
          if (
            bound &&
            (bound.stopped ||
              bound.terminal ||
              bound.completionReached ||
              bound.generationClosed ||
              bound.workGuard.mode !== "auto_draft")
          )
            aFail("DSH_A_OWNER_NOT_RESUMABLE");
          if (
            bound
              ? assessment.suggestedIntent !== "followup" &&
                assessment.suggestedIntent !== "draft_request"
              : assessment.suggestedIntent !== "draft_request"
          )
            aFail("DSH_A_PROPOSAL_UNQUALIFIED");
          command = admissionCommand(calculation, "dsh-unfunded-proposal");
          const existing = get(
            "SELECT command_id FROM dsh_a_command_outbox WHERE scope_id=? AND operation_key=?",
            [
              calculation.basis.domainRow.scope_id,
              command.command.operationKey,
            ],
          );
          if (existing)
            return {
              ok: true,
              state: "reconcile",
              commandId: existing.command_id,
            };
          totalChanges = aNumber(
            get("SELECT total_changes() AS changes")!.changes,
          );
          return { ok: true, state: "funding_required", suggestion };
        }) as DshARecord;
        if (result.state !== "funding_required") return result;
        const accepted = calculation!,
          acceptedData = aFreezeData(captureIpcData(dataCopy) as DshARecord),
          version = authorizationRevision;
        let acceptedCommandId: string | undefined;
        let currentClock = accepted.clock;
        const native = invokeSource(
          readOriginalMainDshBootstrapAuthority,
          undefined,
          [source, owner, source],
        ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
        const localBase = () => {
          pureLocal();
          invokeSource(native.assertLocal, undefined, [], true);
          invokeSource(accepted.scanView!.assertCurrent, undefined, [], true);
          if (authorizationRevision !== version) aFail("DSH_A_PROPOSAL_STALE");
        };
        const assertLocal = () => {
          localBase();
          invokeSource(currentClock.assertLocal, undefined, [], true);
        };
        const assertCurrent = () => {
          localBase();
          const refreshed = invokeSource(readOriginalMainDshClock, undefined, [
            source,
            owner,
            source,
          ]) as ReturnType<typeof readOriginalMainDshClock>;
          if (
            refreshed.projection.state !== "verified" ||
            accepted.clock.projection.state !== "verified" ||
            refreshed.projection.domainId !==
              accepted.clock.projection.domainId ||
            refreshed.projection.qualificationEpoch !==
              accepted.clock.projection.qualificationEpoch
          )
            aFail("DSH_A_PROPOSAL_STALE");
          currentClock = refreshed;
          assertLocal();
          body(
            frame,
            "admission_commit",
            context,
            () => {
              if (
                !acceptedCommandId &&
                aNumber(get("SELECT total_changes() AS changes")!.changes) !==
                  totalChanges
              )
                aFail("DSH_A_PROPOSAL_STALE");
              currentAdmissionBaseline(
                acceptedData.bindingId as string,
                acceptedData.mandateId as string,
              );
              if (acceptedCommandId) {
                const outbox = get(
                  "SELECT * FROM dsh_a_command_outbox WHERE scope_id=? AND command_id=?",
                  [accepted.basis.domainRow.scope_id, acceptedCommandId],
                );
                if (!outbox) aFail("DSH_A_COMMAND_NOT_FOUND");
                const original = authorityBody("dsh_a_command_outbox", outbox),
                  sent = original.command as DshARecord;
                if (
                  sent.operationKey !== command!.command.operationKey ||
                  sent.semanticPayloadHash !==
                    command!.command.semanticPayloadHash
                )
                  aFail("DSH_A_COMMAND_CONFLICT");
                const currentHead = readData(
                  "dsh_a_object_heads",
                  "object_id",
                  dshSourceObjectIdentity(
                    dshAObservation(accepted.input.envelope as DshARecord),
                  ),
                )!;
                const state = currentHead?.state as DshARecord | undefined,
                  value = state?.current as DshARecord | undefined,
                  originalInput = accepted.input.envelope as DshARecord;
                if (
                  !state ||
                  state.freeze !== null ||
                  !value ||
                  value.providerRevision !== originalInput.providerRevision ||
                  value.contentHash !== originalInput.contentHash
                )
                  aFail("DSH_A_INPUT_NOT_CURRENT");
              }
              invokeSource(currentClock.assertCurrent, undefined, [], true);
              return { ok: true };
            },
            "snapshot",
          );
          assertLocal();
        };
        const limits = accepted.basis.mandate.limits,
          scope = accepted.basis.scope,
          domain = accepted.basis.domain;
        const account = observed.status.account;
        const initialTokens = aMinimum(
            limits.maxTokens,
            account.token_limit - account.spent_tokens - account.held_tokens,
          ),
          initialCostMicros = aMinimum(
            limits.maxCostMinor,
            account.cost_limit - account.spent_cost - account.held_cost,
          );
        if (
          !aInteger(initialTokens) ||
          initialTokens <= 0 ||
          !aInteger(initialCostMicros) ||
          initialCostMicros <= 0
        )
          aFail("DSH_A_BUDGET_EXHAUSTED");
        const view = aFreezeData({
          storageScope: scope,
          tenantId: (
            (accepted.input.envelope as DshARecord).thread as DshARecord
          ).tenantId,
          mandateId: accepted.basis.mandate.mandateId,
          mandateRevision: accepted.basis.mandate.revision,
          authorizationEpoch: accepted.basis.mandate.authorizationEpoch,
          budgetAuthorityHash: dshAHash([
            "dsh-a-budget-authority-v1",
            {
              storageScope: scope,
              principalId: domain.principalId,
              authorityId: domain.authorityId,
              authorityEpoch: domain.authorityEpoch,
            },
          ]),
          accountId: accepted.basis.mandate.budgetRef,
          bindingId: command!.bindingId,
          generation: 1,
          thread: accepted.snapshot.input.envelope.thread,
          initialTokens,
          initialCostMicros,
          deadline: instantMs(command!.command.executionDeadline as string),
          maxActiveWorks: limits.maxActiveWorks,
          maxDraftRequestsPerWork: limits.maxDraftRunsPerWork,
          command: {
            operationKey: command!.command.operationKey,
            semanticPayloadHash: command!.command.semanticPayloadHash,
            assessmentRef: command!.command.assessmentRef,
            purpose: "draft_admission",
          },
          assertCurrent,
          assertLocal,
        }) as unknown as DshDraftAdmissionRequestView;
        const proposal = aFreeze(Object.create(null));
        aApply(aWS, admissionProposals, [
          proposal,
          {
            realm: source,
            frame,
            context,
            data: acceptedData,
            calculation: accepted,
            view,
            accept(commandId: string) {
              if (acceptedCommandId && acceptedCommandId !== commandId)
                aFail("DSH_A_COMMAND_CONFLICT");
              acceptedCommandId = commandId;
            },
          },
        ]);
        return aFreeze({
          ok: true,
          state: "funding_required",
          proposal,
          suggestion: result.suggestion,
        });
      } finally {
        pending.delete(root);
        wake();
      }
    },
    establishWindow(frame: object, context: unknown) {
      return body(frame, "admission_window", context, (data) => {
        requireProfile();
        dshAFields(data, [
          "schemaVersion",
          "sourceBindingId",
          "mandateId",
          "expectedPrefixModeHash",
        ]);
        if (
          data.schemaVersion !== 1 ||
          typeof data.sourceBindingId !== "string" ||
          typeof data.mandateId !== "string" ||
          typeof data.expectedPrefixModeHash !== "string"
        )
          aFail("DSH_A_WINDOW_INVALID");
        const basis = currentAdmissionBaseline(
          data.sourceBindingId,
          data.mandateId,
        );
        if (data.expectedPrefixModeHash !== basis.prefixModeHash)
          aFail("DSH_A_WINDOW_GUARD_CHANGED");
        for (let i = 0; i < basis.modes.length; i++)
          if ((basis.modes[i]!.value as DshARecord).mode !== "auto_draft")
            aFail("DSH_A_WINDOW_AUTO_REQUIRED");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "admission_window"],
        ) as { providerDateFact?: object };
        if (!refs.providerDateFact) aFail("DSH_A_WINDOW_TIME_UNCONFIRMED");
        const fact = invokeSource(
          readOriginalGithubProviderDateFact,
          undefined,
          [refs.providerDateFact, source, owner, source],
        ) as ReturnType<typeof readOriginalGithubProviderDateFact>;
        if (
          fact.sourceBindingId !== data.sourceBindingId ||
          fact.configurationRevision !== basis.configurationRow.revision ||
          fact.credentialEpoch !==
            (
              (basis.configuration.binding as DshARecord)
                .authScope as DshARecord
            ).credentialEpoch ||
          fact.providerAccountId !==
            (
              (basis.configuration.binding as DshARecord)
                .authScope as DshARecord
            ).providerAccountId ||
          dshAJson(fact.repository) !== dshAJson(basis.configuration.repository)
        )
          aFail("DSH_A_WINDOW_TIME_SCOPE");
        const clock = invokeSource(readOriginalMainDshClock, undefined, [
          source,
          owner,
          source,
        ]) as ReturnType<typeof readOriginalMainDshClock>;
        if (clock.projection.state !== "verified")
          aFail("DSH_A_WINDOW_TIME_UNCONFIRMED");
        const previousGuard = guard;
        guard = () => {
          previousGuard?.();
          invokeSource(fact.assertLocal, undefined, [], true);
          invokeSource(clock.assertLocal, undefined, [], true);
          pureLocal();
        };
        const checkpointRow = get(
          "SELECT * FROM dsh_a_source_content_checkpoints WHERE binding_id=?",
          [data.sourceBindingId],
        );
        if (!checkpointRow) aFail("DSH_A_WINDOW_BASELINE_REQUIRED");
        const checkpoint = sourceCheckpoint(checkpointRow) as DshARecord;
        const previousWindows = all(
          "SELECT * FROM dsh_a_windows WHERE scope_id=?",
          [basis.domainRow.scope_id],
        );
        for (let i = 0; i < previousWindows.length; i++) {
          const previous = authorityBody("dsh_a_windows", previousWindows[i]!);
          if (
            typeof previous.maxObservedAt !== "number" ||
            !aInteger(previous.maxObservedAt) ||
            clock.projection.nowMs < previous.maxObservedAt
          )
            aFail("DSH_A_CLOCK_ROLLBACK");
        }
        const old = get(
          "SELECT * FROM dsh_a_windows WHERE scope_id=? AND source_binding_id=? AND prefix_mode_hash=?",
          [
            basis.domainRow.scope_id,
            data.sourceBindingId,
            basis.prefixModeHash,
          ],
        );
        if (old) {
          const accepted = authorityBody("dsh_a_windows", old);
          if (
            accepted.clockDomain !== clock.projection.domainId ||
            accepted.clockEpoch !== clock.projection.qualificationEpoch ||
            accepted.configurationRevision !==
              basis.configurationRow.revision ||
            accepted.mandateId !== data.mandateId ||
            accepted.mandateRevision !== basis.mandate.revision
          )
            aFail("DSH_A_WINDOW_REBASELINE_REQUIRED");
          return { ok: true, window: accepted.window, replayed: true };
        }
        const effectiveMs = instantMs(fact.exclusiveSecondUpperBound) + 300000;
        const observationsEndAt = basis.mandate.validUntil;
        if (
          !aInteger(effectiveMs) ||
          effectiveMs >= instantMs(observationsEndAt) ||
          effectiveMs < clock.projection.nowMs
        )
          aFail("DSH_A_WINDOW_TIME_UNCONFIRMED");
        const admissionGrantHash = hashA2Data([
          "dsh-a-operational-window-grant-v1",
          basis.mandate,
          basis.heads,
          checkpoint.scanId,
          clock.projection.domainId,
          clock.projection.qualificationEpoch,
        ]);
        const window: FrozenAutoAdmissionWindow = {
          windowId:
            "dsh-window:" +
            dshAHash([
              "dsh-a-operational-window-v1",
              basis.domainRow.scope_id,
              data.sourceBindingId,
              basis.prefixModeHash,
              admissionGrantHash,
            ]),
          sourceBindingId: data.sourceBindingId,
          prefixModeGuardsHash: basis.prefixModeHash,
          admissionGrantHash,
          effectiveAt: aApply(aIso, new ADate(effectiveMs), []) as string,
          baselineCheckpointRef: checkpoint.scanId as string,
          providerTimeBasisProofRef: fact.factRef,
          freshnessPolicyVersion: 1,
        };
        const value = {
          schemaVersion: 1,
          scopeId: basis.domainRow.scope_id,
          sourceBindingId: data.sourceBindingId,
          mandateId: data.mandateId,
          mandateRevision: basis.mandate.revision,
          configurationRevision: basis.configurationRow.revision,
          window,
          observationsEndAt,
          qualification: "operational-v1",
          profile: "freshness_operational_v1",
          isolationMs: 300000,
          clockDomain: clock.projection.domainId,
          clockEpoch: clock.projection.qualificationEpoch,
          maxObservedAt: clock.projection.nowMs,
          providerDate: {
            factRef: fact.factRef,
            attemptId: fact.attemptId,
            rawBodyHash: fact.rawBodyHash,
            rawDate: fact.rawDate,
            secondLowerBound: fact.secondLowerBound,
            exclusiveSecondUpperBound: fact.exclusiveSecondUpperBound,
            clockRelation: "unconfirmed",
          },
          baselineCheckpointRevision: checkpoint.revision,
        };
        invokeSource(clock.assertCurrent, undefined, [], true);
        authorityWrite(
          "dsh_a_windows",
          {
            scope_id: basis.domainRow.scope_id,
            source_binding_id: data.sourceBindingId,
            prefix_mode_hash: basis.prefixModeHash,
          },
          { window_id: window.windowId },
          value,
        );
        // This is the original domain's metadata activation after all actual
        // owner fences. It grants neither a model attempt nor an N reservation.
        if (basis.domain.state !== "active") {
          const revision = aNumber(basis.domain.revision) + 1,
            next = { ...basis.domain, revision, state: "active" };
          const previous = operationKind;
          operationKind = "authority";
          try {
            authorityWrite(
              "dsh_a_domains",
              { scope_id: basis.domainRow.scope_id },
              {
                profile_id: basis.domainRow.profile_id,
                workspace_id: basis.domainRow.workspace_id,
                principal_id: basis.domainRow.principal_id,
                budget_owner_id: basis.domainRow.budget_owner_id,
                budget_account_id: basis.domainRow.budget_account_id,
                budget_unit_profile: basis.domainRow.budget_unit_profile,
                authority_id: basis.domainRow.authority_id,
                authority_epoch: basis.domainRow.authority_epoch,
                revision,
                state: "active",
              },
              next,
              true,
            );
          } finally {
            operationKind = previous;
          }
        }
        return { ok: true, window, replayed: false };
      });
    },
    async importBrokerControlReceipt(originalReply:object,context:unknown) {
      local();const invocation={};pending.add(invocation);
      try {
        dshAFields(context,["requestSource","bootstrapAuthority"]);if(context.requestSource!=="scheduler")aFail("DSH_A_OWNER_BINDING_REQUIRED");
        const view=invokeSource(readOriginalMainDshBrokerReply,undefined,[originalReply,context.bootstrapAuthority,owner,source]) as OriginalMainDshBrokerReply;
        const raw=aApply(view.waitKnown,undefined,[]);retain(raw,aPromise(raw)?"promise":"unknown");assertStandardIpcPromise(raw,"DSH_A_OWNER_REPLY_UNCONFIRMED");await raw;
        return body(originalReply,"broker_control_receipt",context,data=>{
          requireProfile();const accepted=data as OriginalMainDshBrokerReply,output=captureIpcData(accepted.output) as DshARecord;
          dshAFields(output,["ok","domain","visibility","receipt","current"]);if(accepted.operation!=="apply"&&accepted.operation!=="read"||output.ok!==true||typeof output.current!=="boolean")aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
          const broker=readBrokerFenceReceipt(output.receipt),request=broker.request as DshARecord;
          const domain=get("SELECT * FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",[accepted.scope.profileId,accepted.scope.workspaceId]);if(!domain)aFail("DSH_A_DOMAIN_REQUIRED");
          const targetRow=get("SELECT * FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=? AND owner_domain=?",[domain.scope_id,broker.operationId,broker.domainId]);if(!targetRow)aFail("DSH_A_CONTROL_TARGET_REQUIRED");const target=authorityBody("dsh_a_control_targets",targetRow);
          const registered=get("SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",[domain.scope_id,broker.domainId]);if(!registered)aFail("DSH_A_OWNER_DOMAIN_REQUIRED");const registration=authorityBody("dsh_a_owner_domains",registered),baseline=readBrokerBaselineReceipt(registration.brokerBaseline);
          const authority={authorityId:domain.authority_id,authorityEpoch:domain.authority_epoch};
          if(registration.writerProfile!=="broker_dsh_control_v1"||registration.storeId!==broker.realmId||dshAJson(baseline.authority)!==dshAJson(authority)||dshAJson(projectDshBrokerControlTarget(target,accepted.scope,authority,broker.realmId))!==dshAJson(request))aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
          const currentHead=get("SELECT operation_id FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",[domain.scope_id,target.controlId]);if(!output.current&&currentHead?.operation_id===broker.operationId)aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
          const receiptId="broker-control:"+brokerAdmissionDigest(broker),receipt={schemaVersion:1,scopeId:domain.scope_id,operationId:broker.operationId,ownerDomain:broker.domainId,receiptId,controlId:target.controlId,epoch:target.epoch,canonicalHash:target.canonicalHash,kind:"original_broker_control_receipt",brokerReceipt:broker,brokerCurrentAtObservation:output.current};
          const existing=get("SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",[domain.scope_id,broker.operationId,broker.domainId]);
          if(existing){const old=authorityBody("dsh_a_control_domain_receipts",existing);if(dshAJson(old.brokerReceipt)!==dshAJson(broker))aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");return {ok:true,receipt:old,replayed:true};}
          authorityWrite("dsh_a_control_domain_receipts",{scope_id:domain.scope_id,operation_id:broker.operationId,owner_domain:broker.domainId},{receipt_id:receiptId,receipt_hash:dshAHash(receipt)},receipt);
          const delivery=get("SELECT * FROM dsh_a_control_delivery_heads WHERE scope_id=? AND operation_id=? AND owner_domain=?",[domain.scope_id,broker.operationId,broker.domainId]);if(!delivery)aFail("DSH_A_DELIVERY_CONFLICT");const old=authorityBody("dsh_a_control_delivery_heads",delivery),next={...old,revision:aNumber(delivery.revision)+1,state:"receipt_observed"};
          authorityWrite("dsh_a_control_delivery_heads",{scope_id:domain.scope_id,operation_id:broker.operationId,owner_domain:broker.domainId},{revision:next.revision,fencing_token:delivery.fencing_token,delivery_state:"receipt_observed"},next,true);
          return {ok:true,receipt,replayed:false};
        });
      }finally{pending.delete(invocation);wake();}
    },
    async importControlReceipt(frame: object, context: unknown) {
      local();
      const invocation = {};
      pending.add(invocation);
      let view: KSwarmDshReplyView | undefined;
      try {
        body(
          frame,
          "control_receipt",
          context,
          (data) => {
            const opened = data as {
              request: DshARecord;
              reply: KSwarmDshReplyView;
            };
            dshAFields(opened.request, [
              "operationId",
              "ownerDomain",
              "receiptId",
            ]);
            view = opened.reply;
            return { ok: true };
          },
          "snapshot",
        );
        const raw = aApply(view!.waitKnown, undefined, []);
        retain(raw, aPromise(raw) ? "promise" : "unknown");
        assertStandardIpcPromise(raw, "DSH_A_OWNER_REPLY_UNCONFIRMED");
        await (raw as Promise<void>);
        return body(frame, "control_receipt", context, (data) => {
          requireProfile();
          const opened = data as {
              request: DshARecord;
              reply: KSwarmDshReplyView;
            },
            request = opened.request,
            reply = opened.reply;
          dshAFields(request, ["operationId", "ownerDomain", "receiptId"]);
          invokeSource(reply.assertKnown, undefined, [], true);
          if (
            (reply.operation !== "apply_dsh_control" &&
              reply.operation !== "read_dsh_domain") ||
            dshAJson(reply.scope) !== dshAJson(ownerBinding!.scope)
          )
            aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
          const domain = get(
            "SELECT scope_id FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
            [ownerBinding!.scope.profileId, ownerBinding!.scope.workspaceId],
          );
          if (!domain) aFail("DSH_A_DOMAIN_REQUIRED");
          const targetRow = get(
            "SELECT * FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=? AND owner_domain=?",
            [domain.scope_id, request.operationId, request.ownerDomain],
          );
          if (!targetRow) aFail("DSH_A_CONTROL_TARGET_REQUIRED");
          const target = captureIpcData(
            aJsonParse(targetRow.data_json as string),
          ) as DshARecord;
          if (
            targetRow.body_hash !==
            dshAHash([
              "dsh-a-authority-row-v1",
              "dsh_a_control_targets",
              target,
            ])
          )
            aFail("DSH_A_CONTROL_CONFLICT");
          const input = captureIpcData(reply.input) as DshARecord,
            output = captureIpcData(reply.output) as DshARecord;
          const expectedInput =
            reply.operation === "apply_dsh_control"
              ? target.command
              : { scope: ownerBinding!.scope };
          if (
            input.budget !== null ||
            dshAJson(input.data) !== dshAJson(expectedInput) ||
            output.ok !== true
          )
            aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
          let control = output.control as DshARecord | undefined;
          if (reply.operation === "read_dsh_domain") {
            if (!aArray(output.controlHeads))
              aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
            const rows = output.controlHeads as DshARecord[];
            control = undefined;
            for (let i = 0; i < rows.length; i++)
              if (rows[i]!.id === target.controlId) {
                if (control) aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
                control = rows[i];
              }
          }
          if (!control) aFail("DSH_A_CONTROL_RECEIPT_REQUIRED");
          const command = target.command as DshARecord;
          const registered = get(
            "SELECT data_json FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
            [domain.scope_id, request.ownerDomain],
          );
          if (!registered) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const registration = captureIpcData(
            aJsonParse(registered.data_json as string),
          ) as DshARecord;
          const copy = captureIpcData(control) as DshARecord;
          delete copy.recordDigest;
          if (
            control.contract !== "dsh_owner_admission_v1" ||
            control.schemaVersion !== 1 ||
            control.id !== target.controlId ||
            control.writerStoreId !== registration.storeId ||
            control.recordDigest !== dshAHash(["dsh-record-v1", copy]) ||
            dshAJson(control.scope) !== dshAJson(ownerBinding!.scope) ||
            dshAJson(control.identity) !== dshAJson(command.identity) ||
            control.epoch !== command.epoch ||
            dshAJson(control.value) !== dshAJson(command.value) ||
            control.authorityRef !== command.authorityRef ||
            (command.type === "policy"
              ? control.axis !== command.axis
              : control.factKind !== command.factKind)
          )
            aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
          const receiptId = "dsh-owner-control:" + control.recordDigest;
          if (request.receiptId !== receiptId)
            aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
          const receipt = {
            schemaVersion: 1,
            scopeId: domain.scope_id,
            operationId: request.operationId,
            ownerDomain: request.ownerDomain,
            receiptId,
            controlId: target.controlId,
            epoch: target.epoch,
            canonicalHash: target.canonicalHash,
            kind: "original_b_control_receipt",
            ownerControl: control,
          };
          const existing = get(
            "SELECT data_json FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
            [domain.scope_id, request.operationId, request.ownerDomain],
          );
          if (existing) {
            if (existing.data_json !== dshAJson(receipt))
              aFail("DSH_A_CONTROL_RECEIPT_CONFLICT");
            return { ok: true, receipt, replayed: true };
          }
          authorityWrite(
            "dsh_a_control_domain_receipts",
            {
              scope_id: domain.scope_id,
              operation_id: request.operationId,
              owner_domain: request.ownerDomain,
            },
            { receipt_id: receiptId, receipt_hash: dshAHash(receipt) },
            receipt,
          );
          const delivery = get(
            "SELECT * FROM dsh_a_control_delivery_heads WHERE scope_id=? AND operation_id=? AND owner_domain=?",
            [domain.scope_id, request.operationId, request.ownerDomain],
          );
          if (!delivery) aFail("DSH_A_DELIVERY_CONFLICT");
          const old = captureIpcData(
              aJsonParse(delivery.data_json as string),
            ) as DshARecord,
            next = {
              ...old,
              revision: aNumber(delivery.revision) + 1,
              state: "receipt_observed",
            };
          authorityWrite(
            "dsh_a_control_delivery_heads",
            {
              scope_id: domain.scope_id,
              operation_id: request.operationId,
              owner_domain: request.ownerDomain,
            },
            {
              revision: next.revision,
              fencing_token: delivery.fencing_token,
              delivery_state: "receipt_observed",
            },
            next,
            true,
          );
          return { ok: true, receipt };
        });
      } finally {
        pending.delete(invocation);
        wake();
      }
    },
    readOperation(frame: object, context: unknown) {
      return body(
        frame,
        "read_history",
        context,
        (data) => {
          requireProfile();
          dshAFields(data, ["schemaVersion", "query"]);
          if (data.schemaVersion !== 1) aFail("DSH_A_READ_INVALID");
          const query = data.query as DshARecord;
          dshAFields(
            query,
            query.kind === "command"
              ? ["kind", "commandId"]
              : query.kind === "control"
                ? ["kind", "operationId", "ownerDomain"]
                : ["kind", "bindingId"],
          );
          if (
            query.kind !== "command" &&
            query.kind !== "binding" &&
            query.kind !== "control"
          )
            aFail("DSH_A_READ_INVALID");
          const scope =
            ownerBinding?.scope ??
            (budgetBinding
              ? {
                  profileId: budgetBinding.binding.profileId,
                  workspaceId: budgetBinding.binding.workspaceId,
                }
              : undefined);
          if (!scope) aFail("DSH_A_SCOPE_REQUIRED");
          const domain = get(
            "SELECT scope_id FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
            [scope.profileId, scope.workspaceId],
          );
          if (!domain) aFail("DSH_A_DOMAIN_REQUIRED");
          const decode = (table: string, row: DshARecord | undefined) => {
            if (!row) return null;
            return authorityBody(
              table as Parameters<typeof authorityBody>[0],
              row,
            );
          };
          if (query.kind === "control") {
            if (
              typeof query.operationId !== "string" ||
              typeof query.ownerDomain !== "string"
            )
              aFail("DSH_A_READ_INVALID");
            const args = [
              domain.scope_id,
              query.operationId,
              query.ownerDomain,
            ];
            return {
              ok: true,
              control: decode(
                "dsh_a_control_targets",
                get(
                  "SELECT * FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=? AND owner_domain=?",
                  args,
                ),
              ),
              delivery: decode(
                "dsh_a_control_delivery_heads",
                get(
                  "SELECT * FROM dsh_a_control_delivery_heads WHERE scope_id=? AND operation_id=? AND owner_domain=?",
                  args,
                ),
              ),
              receipt: decode(
                "dsh_a_control_domain_receipts",
                get(
                  "SELECT * FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
                  args,
                ),
              ),
            };
          }
          if (query.kind === "command") {
            if (typeof query.commandId !== "string")
              aFail("DSH_A_READ_INVALID");
            const row = get(
              "SELECT * FROM dsh_a_command_outbox WHERE scope_id=? AND command_id=?",
              [domain.scope_id, query.commandId],
            );
            const outbox = decode("dsh_a_command_outbox", row);
            if (row && outbox) {
              const command = outbox.command as DshARecord;
              if (
                !command ||
                command.commandId !== row.command_id ||
                outbox.scopeId !== row.scope_id ||
                command.operationKey !== row.operation_key ||
                command.semanticPayloadHash !== row.semantic_hash ||
                command.attemptPayloadHash !== row.attempt_hash ||
                command.bindingId !== row.binding_id ||
                command.inputId !== row.input_id ||
                outbox.targetDomain !== row.target_domain
              )
                aFail("DSH_A_GRAPH_CONFLICT");
            }
            return {
              ok: true,
              command: outbox,
              delivery: decode(
                "dsh_a_delivery_heads",
                get(
                  "SELECT * FROM dsh_a_delivery_heads WHERE scope_id=? AND command_id=?",
                  [domain.scope_id, query.commandId],
                ),
              ),
              receipt: decode(
                "dsh_a_owner_receipts",
                get(
                  "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
                  [domain.scope_id, query.commandId],
                ),
              ),
            };
          }
          if (typeof query.bindingId !== "string") aFail("DSH_A_READ_INVALID");
          return {
            ok: true,
            binding: decode(
              "dsh_a_work_bindings",
              get(
                "SELECT * FROM dsh_a_work_bindings WHERE scope_id=? AND binding_id=?",
                [domain.scope_id, query.bindingId],
              ),
            ),
          };
        },
        "snapshot",
      );
    },
    async registerBrokerOwnerDomain(reply:object,context:unknown) {
      local();const invocation={};pending.add(invocation);
      try {
        dshAFields(context,["requestSource","bootstrapAuthority"]);if(context.requestSource!=="scheduler")aFail("DSH_A_OWNER_BINDING_REQUIRED");
        const view=invokeSource(readOriginalMainDshBrokerReply,undefined,[reply,context.bootstrapAuthority,owner,source]) as OriginalMainDshBrokerReply;
        const raw=aApply(view.waitKnown,undefined,[]);retain(raw,aPromise(raw)?"promise":"unknown");assertStandardIpcPromise(raw,"DSH_A_OWNER_REPLY_UNCONFIRMED");await raw;
        return body(reply,"register_broker_owner",context,data=>{
          requireProfile();const accepted=data as OriginalMainDshBrokerReply,output=captureIpcData(accepted.output) as DshARecord;
          dshAFields(output,["ok","domain","visibility","receipt","current"]);if(accepted.operation!=="baseline"&&accepted.operation!=="read"||output.ok!==true||output.current!==true)aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const baseline=readBrokerBaselineReceipt(output.receipt),domain=output.domain;dshAFields(domain,["schemaVersion","kind","ownerKind","domainId","storeId","scope","writerProfile","writerSchemaVersion"]);
          if(domain.schemaVersion!==1||domain.kind!=="broker_dsh"||domain.ownerKind!=="active_pointer"||domain.writerProfile!=="broker_dsh_control_v1"||domain.writerSchemaVersion!==9||domain.storeId!==baseline.realmId||domain.domainId!==baseline.domainId||dshAJson(domain.scope)!==dshAJson(accepted.scope)||dshAJson(domain.scope)!==dshAJson(baseline.scope)||(accepted.operation==="baseline"&&dshAJson(accepted.input)!==dshAJson(baseline.request)))aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const row=get("SELECT * FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",[accepted.scope.profileId,accepted.scope.workspaceId]);if(!row)aFail("DSH_A_DOMAIN_REQUIRED");
          const authority=baseline.authority as DshARecord;if(authority.authorityId!==row.authority_id||authority.authorityEpoch!==row.authority_epoch)aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
          const registrationRef="dsh-a-broker-registration:"+dshAHash(["dsh-a-broker-registration-v1",row.scope_id,domain,baseline]);
          const registration={schemaVersion:1,scopeId:row.scope_id,domainId:domain.domainId,kind:"active_pointer",registrationRef,storeId:domain.storeId,storageScope:accepted.scope,writerProfile:domain.writerProfile,writerSchemaVersion:9,brokerBaseline:baseline};
          const peers=all("SELECT * FROM dsh_a_owner_domains WHERE scope_id=?",[row.scope_id]);for(let i=0;i<peers.length;i++){const peer=authorityBody("dsh_a_owner_domains",peers[i]!);if(peer.writerProfile==="broker_dsh_control_v1"&&peer.domainId!==domain.domainId)aFail("DSH_A_BROKER_REALM_CHANGED");}
          const old=get("SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",[row.scope_id,domain.domainId]);
          if(accepted.operation==="read"){
            dshAFields(accepted.input,["schemaVersion","scope","authority","realmId","operationId"]);if(!old||accepted.input.realmId!==baseline.realmId||accepted.input.operationId!==baseline.operationId||dshAJson(accepted.input.authority)!==dshAJson(baseline.authority)||dshAJson(accepted.input.scope)!==dshAJson(baseline.scope))aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
          }
          if(old){if(dshAJson(authorityBody("dsh_a_owner_domains",old))!==dshAJson(registration))aFail("DSH_A_OWNER_DOMAIN_CONFLICT");return {ok:true,registration,replayed:true};}
          authorityWrite("dsh_a_owner_domains",{scope_id:row.scope_id,owner_domain:domain.domainId},{owner_kind:"active_pointer",registration_ref:registrationRef},registration);
          const controls=all("SELECT data_json FROM dsh_a_control_heads WHERE scope_id=?",[row.scope_id]);for(let i=0;i<controls.length;i++)controlTargets(row.scope_id,captureIpcData(aJsonParse(controls[i]!.data_json as string)) as DshARecord);
          return {ok:true,registration,replayed:false};
        });
      }finally{pending.delete(invocation);wake();}
    },
    async registerOwnerDomain(reply: object, context: unknown) {
      local();
      if (!ownerBinding) aFail("DSH_A_OWNER_BINDING_REQUIRED");
      const invocation = {};
      pending.add(invocation);
      try {
        const view = invokeSource(readOriginalKSwarmDshReply, undefined, [
          ownerBinding.service,
          ownerBinding.admission,
          reply,
        ]) as KSwarmDshReplyView;
        const raw = aApply(view.waitKnown, undefined, []);
        retain(raw, aPromise(raw) ? "promise" : "unknown");
        assertStandardIpcPromise(raw, "DSH_A_OWNER_REPLY_UNCONFIRMED");
        await (raw as Promise<void>);
        invokeSource(view.assertKnown, undefined, [], true);
        return body(reply, "register_owner", context, (value) => {
          requireProfile();
          const accepted = value as KSwarmDshReplyView;
          if (
            accepted.operation !== "read_dsh_domain" ||
            dshAJson(accepted.scope) !== dshAJson(ownerBinding.scope)
          )
            aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const input = captureIpcData(accepted.input) as DshARecord,
            output = captureIpcData(accepted.output) as DshARecord;
          dshAFields(input, ["data", "budget"]);
          dshAFields(input.data, ["scope"]);
          if (
            input.budget !== null ||
            dshAJson(input.data.scope) !== dshAJson(ownerBinding.scope) ||
            output.ok !== true
          )
            aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const domain = output.domain as DshARecord;
          dshAFields(domain, [
            "schemaVersion",
            "kind",
            "ownerKind",
            "domainId",
            "storeId",
            "scope",
            "writerProfile",
            "writerSchemaVersion",
            "nativeRevision",
          ]);
          if (
            domain.schemaVersion !== 1 ||
            domain.kind !== "kswarm_dsh" ||
            domain.ownerKind !== "kswarm_dsh" ||
            domain.writerProfile !== "dsh_admission_owner_writer_v1" ||
            domain.writerSchemaVersion !== 8 ||
            typeof domain.domainId !== "string" ||
            !domain.domainId ||
            typeof domain.storeId !== "string" ||
            !domain.storeId ||
            !aInteger(domain.nativeRevision) ||
            aNumber(domain.nativeRevision) < 0 ||
            dshAJson(domain.scope) !== dshAJson(ownerBinding.scope)
          )
            aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
          const row = get(
            "SELECT * FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
            [ownerBinding.scope.profileId, ownerBinding.scope.workspaceId],
          );
          if (!row) aFail("DSH_A_DOMAIN_REQUIRED");
          const registrationRef =
            "dsh-a-owner-registration:" +
            dshAHash([
              "dsh-a-owner-registration-v1",
              row.scope_id,
              domain.domainId,
              domain.storeId,
              domain.writerProfile,
              domain.writerSchemaVersion,
            ]);
          const registration = {
            schemaVersion: 1,
            scopeId: row.scope_id,
            domainId: domain.domainId,
            kind: "work",
            registrationRef,
            storeId: domain.storeId,
            storageScope: ownerBinding.scope,
            writerProfile: domain.writerProfile,
            writerSchemaVersion: 8,
          };
          const old = get(
            "SELECT data_json FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
            [row.scope_id, domain.domainId],
          );
          if (old) {
            if (old.data_json !== dshAJson(registration))
              aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
            return { ok: true, registration, replayed: true };
          }
          authorityWrite(
            "dsh_a_owner_domains",
            { scope_id: row.scope_id, owner_domain: domain.domainId },
            { owner_kind: "work", registration_ref: registrationRef },
            registration,
          );
          const controls = all(
            "SELECT data_json FROM dsh_a_control_heads WHERE scope_id=?",
            [row.scope_id],
          );
          for (let i = 0; i < controls.length; i++)
            controlTargets(
              row.scope_id,
              captureIpcData(
                aJsonParse(controls[i]!.data_json as string),
              ) as DshARecord,
            );
          return { ok: true, registration };
        });
      } finally {
        pending.delete(invocation);
        wake();
      }
    },
    claimCommand(frame: object, context: unknown) {
      const root = {};
      pending.add(root);
      try {
        let preflightWarm: (typeof warmCommandAuthorities)[number] | undefined;
        body(
          frame,
          "claim_command",
          context,
          (data) => {
            dshAFields(data, ["commandId", "expectedDeliveryRevision"]);
            for (let i = 0; i < warmCommandAuthorities.length; i++)
              if (warmCommandAuthorities[i]!.commandId === data.commandId)
                preflightWarm = warmCommandAuthorities[i];
            return { ok: true };
          },
          "snapshot",
        );
        preflightWarm?.reserved();
        let accepted: DshARecord | undefined;
        const result = body(frame, "claim_command", context, (data) => {
          requireProfile();
          dshAFields(data, ["commandId", "expectedDeliveryRevision"]);
          if (
            typeof data.commandId !== "string" ||
            !data.commandId ||
            data.commandId.length > 256 ||
            !aInteger(data.expectedDeliveryRevision) ||
            aNumber(data.expectedDeliveryRevision) < 1
          )
            aFail("DSH_A_COMMAND_CLAIM_INVALID");
          if (!ownerBinding) aFail("DSH_A_OWNER_BINDING_REQUIRED");
          const qualification = invokeSource(
            readOriginalMainDshBootstrapAuthority,
            undefined,
            [source, owner, source],
          ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
          invokeSource(qualification.assertCurrent, undefined, [], true);
          invokeSource(qualification.assertLocal, undefined, [], true);
          const row = get(
            "SELECT * FROM dsh_a_command_outbox WHERE command_id=?",
            [data.commandId],
          );
          if (!row) {
            const targetRows = all(
              "SELECT * FROM dsh_a_control_targets WHERE operation_id=?",
              [data.commandId],
            );
            let targetRow: DshARecord | undefined;
            for (let i = 0; i < targetRows.length; i++) {
              const ownerRow = get(
                "SELECT owner_kind FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
                [targetRows[i]!.scope_id, targetRows[i]!.owner_domain],
              );
              if (ownerRow?.owner_kind === "work") {
                if (targetRow) aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
                targetRow = targetRows[i];
              }
            }
            if (!targetRow) aFail("DSH_A_COMMAND_NOT_FOUND");
            const target = captureIpcData(
              aJsonParse(targetRow.data_json as string),
            ) as DshARecord;
            if (
              targetRow.body_hash !==
              dshAHash([
                "dsh-a-authority-row-v1",
                "dsh_a_control_targets",
                target,
              ])
            )
              aFail("DSH_A_CONTROL_CONFLICT");
            const currentHead = get(
              "SELECT data_json FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
              [targetRow.scope_id, target.controlId],
            );
            if (!currentHead) aFail("DSH_A_CONTROL_CONFLICT");
            const head = captureIpcData(
              aJsonParse(currentHead.data_json as string),
            ) as DshARecord;
            if (
              head.operationId !== data.commandId ||
              head.epoch !== target.epoch ||
              dshAHash(head.value) !== target.canonicalHash
            )
              aFail("DSH_A_CONTROL_SUPERSEDED");
            const delivery = get(
              "SELECT * FROM dsh_a_control_delivery_heads WHERE scope_id=? AND operation_id=? AND owner_domain=?",
              [targetRow.scope_id, data.commandId, targetRow.owner_domain],
            );
            if (
              !delivery ||
              delivery.revision !== data.expectedDeliveryRevision ||
              delivery.delivery_state !== "pending"
            )
              aFail("DSH_A_COMMAND_CLAIM_CONFLICT");
            const previous = captureIpcData(
                aJsonParse(delivery.data_json as string),
              ) as DshARecord,
              revision = aNumber(delivery.revision) + 1,
              fencingToken = aNumber(delivery.fencing_token) + 1;
            const next = {
              ...previous,
              revision,
              fencingToken,
              state: "leased",
            };
            authorityWrite(
              "dsh_a_control_delivery_heads",
              {
                scope_id: targetRow.scope_id,
                operation_id: data.commandId,
                owner_domain: targetRow.owner_domain,
              },
              {
                revision,
                fencing_token: fencingToken,
                delivery_state: "leased",
              },
              next,
              true,
            );
            accepted = {
              original: { command: target.command },
              operation: "apply_dsh_control",
              commandId: data.commandId,
              operationKey: data.commandId,
              scope: (target.command as DshARecord).scope,
              target: targetRow.owner_domain,
              revision,
              fencingToken,
              scopeId: targetRow.scope_id,
            };
            return { ok: true };
          }
          const original = captureIpcData(
            aJsonParse(row.data_json as string),
          ) as DshARecord;
          if (
            row.body_hash !==
            dshAHash([
              "dsh-a-authority-row-v1",
              "dsh_a_command_outbox",
              original,
            ])
          )
            aFail("DSH_A_COMMAND_CONFLICT");
          const domainRow = get(
            "SELECT * FROM dsh_a_domains WHERE scope_id=?",
            [row.scope_id],
          );
          if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
          const domain = captureIpcData(
            aJsonParse(domainRow.data_json as string),
          ) as DshARecord;
          if (row.command_class === "generating" && domain.state !== "active")
            aFail("DSH_A_AUTHORITY_NOT_ACTIVE");
          const delivery = get(
            "SELECT * FROM dsh_a_delivery_heads WHERE scope_id=? AND command_id=?",
            [row.scope_id, data.commandId],
          );
          if (
            !delivery ||
            delivery.revision !== data.expectedDeliveryRevision ||
            delivery.delivery_state !== "pending"
          )
            aFail("DSH_A_COMMAND_CLAIM_CONFLICT");
          const storedDelivery = captureIpcData(
            aJsonParse(delivery.data_json as string),
          ) as DshARecord;
          if (
            delivery.body_hash !==
            dshAHash([
              "dsh-a-authority-row-v1",
              "dsh_a_delivery_heads",
              storedDelivery,
            ])
          )
            aFail("DSH_A_DELIVERY_CONFLICT");
          let warm: (typeof warmCommandAuthorities)[number] | undefined;
          for (let i = 0; i < warmCommandAuthorities.length; i++)
            if (warmCommandAuthorities[i]!.commandId === data.commandId)
              warm = warmCommandAuthorities[i];
          if (row.command_class === "generating" && !warm)
            aFail("DSH_A_COMMAND_AUTHORITY_REQUIRED");
          warm?.local();
          const revision = aNumber(delivery.revision) + 1,
            fencingToken = aNumber(delivery.fencing_token) + 1;
          const next = {
            ...storedDelivery,
            revision,
            fencingToken,
            state: "leased",
          };
          authorityWrite(
            "dsh_a_delivery_heads",
            { scope_id: row.scope_id, command_id: data.commandId },
            { revision, fencing_token: fencingToken, delivery_state: "leased" },
            next,
            true,
          );
          accepted = {
            original,
            scope: domain.storageScope,
            target: row.target_domain,
            revision,
            fencingToken,
            scopeId: row.scope_id,
          };
          return { ok: true };
        }) as DshARecord;
        if (!result.ok || !accepted) aFail("DSH_A_COMMAND_CLAIM_CONFLICT");
        const snapshot = accepted,
          original = snapshot.original as DshARecord,
          command = original.command as DshARecord;
        let warm: (typeof warmCommandAuthorities)[number] | undefined;
        for (let i = 0; i < warmCommandAuthorities.length; i++)
          if (warmCommandAuthorities[i]!.commandId === command.commandId)
            warm = warmCommandAuthorities[i];
        const version = authorizationRevision;
        const assertLocal = () => {
          pureLocal();
          if (authorizationRevision !== version) aFail("DSH_A_COMMAND_STALE");
        };
        const assertCurrent = () => {
          assertLocal();
          warm?.current();
          assertLocal();
        };
        const view = aFreeze({
          commandId: (snapshot.commandId ?? command.commandId) as string,
          operationKey: (snapshot.operationKey ??
            command.operationKey) as string,
          operation:
            snapshot.operation === "apply_dsh_control"
              ? ("apply_dsh_control" as const)
              : command.action === "prepare_draft"
                ? ("prepare_dsh_slot" as const)
                : ("apply_dsh_command" as const),
          command: aFreezeData(command),
          scope: aFreezeData(snapshot.scope) as {
            profileId: string;
            workspaceId: string;
          },
          expectedOwnerDomainId: snapshot.target as string,
          budgetReservation: warm
            ? aFreeze({
                receipt: warm.receipt,
                reserveProof: warm.reserveProof,
              })
            : null,
          assertCurrent,
          assertLocal,
        });
        const claim = aFreeze(Object.create(null));
        aApply(aWS, commandClaims, [claim, { realm: source, view }]);
        return claim;
      } finally {
        pending.delete(root);
        wake();
      }
    },
    enrollAuthority(frame: object, context: unknown) {
      return body(frame, "enroll_authority", context, (data, user) => {
        requireProfile();
        dshAFields(data, [
          "schemaVersion",
          "expectedDomainRevision",
          "ownerDomainIds",
        ]);
        if (
          data.schemaVersion !== 1 ||
          !aInteger(data.expectedDomainRevision) ||
          aNumber(data.expectedDomainRevision) < 0 ||
          !Array.isArray(data.ownerDomainIds) ||
          data.ownerDomainIds.length > 128 ||
          !user
        )
          aFail("DSH_A_ENROLLMENT_INVALID");
        const names: string[] = [];
        for (let i = 0; i < data.ownerDomainIds.length; i++) {
          const value = data.ownerDomainIds[i];
          if (typeof value !== "string" || !value || value.length > 256)
            aFail("DSH_A_ENROLLMENT_INVALID");
          for (let j = 0; j < names.length; j++)
            if (names[j] === value) aFail("DSH_A_ENROLLMENT_INVALID");
          aPush(names, value);
        }
        const ctx = context as { bootstrapAuthority: unknown };
        const qualification = invokeSource(
          readOriginalMainDshBootstrapAuthority,
          undefined,
          [ctx.bootstrapAuthority, owner, source],
        ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
        const userGuard = guard;
        guard = () => {
          userGuard?.();
          invokeSource(qualification.assertCurrent, undefined, [], true);
          invokeSource(user.assertLocal, undefined, [], true);
          invokeSource(qualification.assertLocal, undefined, [], true);
          local();
        };
        guard();
        const floor = get(
          "SELECT store_id FROM dsh_a_profile WHERE singleton=1",
        )!;
        const scopeId = dshAHash([
          "dsh-a-domain-v1",
          floor.store_id,
          user.storageScope,
        ]);
        const authorityId = dshAHash([
          "dsh-a-authority-v1",
          floor.store_id,
          user.storageScope,
        ]);
        const previous = get("SELECT * FROM dsh_a_domains WHERE scope_id=?", [
          scopeId,
        ]);
        if (
          aNumber(data.expectedDomainRevision) !==
          (previous ? aNumber(previous.revision) : 0)
        )
          aFail("DSH_A_DOMAIN_CAS_CONFLICT");
        if (
          previous &&
          (previous.profile_id !== user.storageScope.profileId ||
            previous.workspace_id !== user.storageScope.workspaceId ||
            previous.principal_id !== user.principalId ||
            previous.authority_id !== authorityId)
        )
          aFail("DSH_A_DOMAIN_IDENTITY_CONFLICT");
        const revision = previous ? aNumber(previous.revision) + 1 : 1;
        const epoch = previous ? aNumber(previous.authority_epoch) + 1 : 1;
        if (!aInteger(revision) || !aInteger(epoch))
          aFail("DSH_A_DOMAIN_CAS_CONFLICT");
        const enrolled = {
          schemaVersion: 1,
          scopeId,
          storageScope: user.storageScope,
          principalId: user.principalId,
          authorityId,
          authorityEpoch: epoch,
          revision,
          state: "pending_baseline",
          ownerDomainIds: names,
          enrollmentRef: user.bodyHash,
          budget:
            previous && previous.budget_owner_id !== null
              ? {
                  ownerId: previous.budget_owner_id,
                  accountId: previous.budget_account_id,
                  unitProfile: previous.budget_unit_profile,
                }
              : null,
        };
        invokeSource(qualification.assertCurrent, undefined, [], true);
        invokeSource(qualification.assertLocal, undefined, [], true);
        writeRow(
          "dsh_a_domains",
          { scope_id: scopeId },
          {
            profile_id: user.storageScope.profileId,
            workspace_id: user.storageScope.workspaceId,
            principal_id: user.principalId,
            budget_owner_id: previous?.budget_owner_id ?? null,
            budget_account_id: previous?.budget_account_id ?? null,
            budget_unit_profile: previous?.budget_unit_profile ?? null,
            authority_id: authorityId,
            authority_epoch: epoch,
            revision,
            state: "pending_baseline",
            body_hash: dshAHash([
              "dsh-a-authority-row-v1",
              "dsh_a_domains",
              enrolled,
            ]),
          },
          enrolled,
          Boolean(previous),
        );
        // These are this original A connection's actual control owners, not
        // claimed external B domains. The B work owner is registered separately.
        for (const kind of ["egress_gate", "active_pointer"] as const) {
          const domainId =
            "dsh-a-" +
            kind +
            ":" +
            dshAHash([
              "dsh-a-local-owner-domain-v1",
              floor.store_id,
              user.storageScope,
              kind,
            ]);
          const registrationRef =
            "dsh-a-local-owner-registration:" +
            dshAHash([
              "dsh-a-local-owner-registration-v1",
              floor.store_id,
              user.storageScope,
              kind,
            ]);
          const localOwner = {
            schemaVersion: 1,
            scopeId,
            domainId,
            kind,
            registrationRef,
            storeId: floor.store_id,
            storageScope: user.storageScope,
            writerProfile: DSH_A_AUTHORITY_PROFILE,
            writerSchemaVersion: 6,
          };
          const oldOwner = get(
            "SELECT data_json FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
            [scopeId, domainId],
          );
          if (oldOwner) {
            if (oldOwner.data_json !== dshAJson(localOwner))
              aFail("DSH_A_OWNER_DOMAIN_CONFLICT");
          } else
            authorityWrite(
              "dsh_a_owner_domains",
              { scope_id: scopeId, owner_domain: domainId },
              { owner_kind: kind, registration_ref: registrationRef },
              localOwner,
            );
        }
        return { ok: true, enrollment: enrolled, qualified: false };
      });
    },
    commitGithubSourceScan(session: object, token: object, context: unknown) {
      return body(
        token,
        "commit_source_scan",
        context,
        (data) => {
          requireProfile();
          const original = data as ReturnType<
              typeof readOriginalGithubSourceScan
            >,
            scan = parseGithubSourceScan(original.data),
            authority = original.authority!;
          if (
            authority.kind !== "source_binding" ||
            authority.sourceBindingId !== scan.bindingId ||
            authority.sourceBindingRevision !== scan.bindingRevision ||
            authority.credentialEpoch !== scan.authScope.credentialEpoch ||
            authority.providerAccountId !== scan.authScope.providerAccountId ||
            authority.repository.repositoryId !==
              scan.boundRepository.repositoryId
          )
            aFail("DSH_A_SOURCE_SCAN_SCOPE");
          const head = get(
            "SELECT revision FROM dsh_a_source_configuration_heads WHERE binding_id=?",
            [scan.bindingId],
          );
          if (!head || head.revision !== authority.configurationRevision)
            aFail("DSH_A_SOURCE_CONFIG_STALE");
          const existingScan = get(
            "SELECT data_json FROM dsh_a_source_scans WHERE scan_id=?",
            [scan.scanId],
          );
          const canonical: DshARecord[] = [];
          for (let i = 0; i < scan.candidates.length; i++) {
            const candidate = scan.candidates[i]!,
              envelope = candidate.envelope as DshARecord,
              inputId = "dsh-input:" + dshAInputKey(envelope),
              input = readData("dsh_a_inbox", "input_id", inputId);
            if (input) aPush(canonical, input);
          }
          const planned = planGithubSourceRows(scan, canonical);
          validateGithubSourceRelations(planned);
          if (existingScan) {
            const original = get(
              "SELECT * FROM dsh_a_source_scans WHERE scan_id=?",
              [scan.scanId],
            )!;
            capturedGithubRow("dsh_a_source_scans", original);
            if (
              original.data_json !== planned.scan.json ||
              original.body_hash !== planned.scan.hash ||
              original.binding_id !== scan.bindingId ||
              original.binding_revision !== scan.bindingRevision ||
              original.read_set_id !== scan.selected.readSetId
            )
              aFail("DSH_A_SOURCE_SCAN_CONFLICT");
            return { ok: true, scanId: scan.scanId, replayed: true };
          }
          const checkpoint = get(
            "SELECT revision FROM dsh_a_source_content_checkpoints WHERE binding_id=?",
            [scan.bindingId],
          );
          if (
            (checkpoint ? checkpoint.revision : 0) !==
            scan.previousCheckpointRevision
          )
            aFail("DSH_A_SOURCE_CHECKPOINT_CAS_CONFLICT");
          for (let i = 0; i < planned.imports.length; i++)
            importInput(planned.imports[i]);
          const configured = get(
            "SELECT c.scope_id FROM dsh_a_source_configurations c JOIN dsh_a_source_configuration_heads h ON h.binding_id=c.binding_id AND h.revision=c.revision WHERE c.binding_id=?",
            [scan.bindingId],
          );
          if (!configured) aFail("DSH_A_SOURCE_CONFIG_REQUIRED");
          for (let i = 0; i < scan.candidates.length; i++) {
            const observed = scan.candidates[i]!.envelope as DshARecord,
              inputId = "dsh-input:" + dshAInputKey(observed);
            if (observed.kind === "snapshot" || observed.kind === "deleted")
              sourceControlRecord(
                configured.scope_id,
                inputId,
                aNumber(observed.provenanceVersion),
                scan.scanId,
                observed.kind === "snapshot",
              );
          }
          const write = (row: GithubSourceStorageRow, replace = false) =>
            writeRow(
              row.table,
              row.key,
              { ...row.index, body_hash: row.hash },
              row.data,
              replace,
            );
          write(planned.scan);
          for (let i = 0; i < planned.reads.length; i++)
            write(planned.reads[i]!);
          for (let i = 0; i < planned.snapshots.length; i++)
            write(planned.snapshots[i]!);
          write(planned.readSet);
          // Only complete original reads may advance the original durable cut.
          if (planned.checkpoint)
            write(planned.checkpoint, Boolean(checkpoint));
          return {
            ok: true,
            scanId: scan.scanId,
            readSetId: scan.selected.readSetId,
            importedInputs: planned.imports.length,
            checkpointRevision:
              planned.checkpoint?.data.revision ??
              scan.previousCheckpointRevision,
          };
        },
        true,
        session,
      );
    },
    commitGithubSourceSetup(session: object, result: object, context: unknown) {
      return body(
        result,
        "commit_source_setup",
        context,
        (data) => {
          requireProfile();
          const view = data as ReturnType<
            typeof readOriginalGithubSourceSetupResult
          >;
          const row = get(
            "SELECT * FROM dsh_a_source_setups WHERE setup_id=?",
            [view.setupId],
          );
          if (!row || row.revision !== view.configurationRevision)
            aFail("DSH_A_SOURCE_CONFIG_STALE");
          const stored = captureIpcData(
              aJsonParse(row.data_json as string),
            ) as DshARecord,
            setup = stored.configuration as DshARecord;
          if (
            row.body_hash !==
              dshAHash([
                "dsh-a-authority-row-v1",
                "dsh_a_source_setups",
                stored,
              ]) ||
            dshAJson(setup.candidateRepository) !==
              dshAJson(view.candidateRepository) ||
            setup.tenantId !== view.tenantId ||
            setup.mode !== "observe"
          )
            aFail("DSH_A_SOURCE_CONFIG_CONFLICT");
          const domainRow = get(
            "SELECT * FROM dsh_a_domains WHERE scope_id=?",
            [row.scope_id],
          );
          if (
            !domainRow ||
            domainRow.profile_id !== view.profileId ||
            domainRow.workspace_id !== view.workspaceId
          )
            aFail("DSH_A_SOURCE_CONFIG_SCOPE");
          const scope = {
            profileId: view.profileId,
            workspaceId: view.workspaceId,
          };
          const bindingId =
            "dsh-source-binding:" +
            dshAHash([
              "dsh-github-source-binding-v1",
              scope,
              view.tenantId,
              view.repository.repositoryId,
            ]);
          const connectionId =
            "dsh-source-connection:" +
            dshAHash([
              "dsh-github-source-connection-v1",
              scope,
              view.setupId,
              view.providerAccountId,
            ]);
          const binding = {
            bindingId,
            provider: "github",
            authScope: {
              tenantId: view.tenantId,
              workspaceId: view.workspaceId,
              connectionId,
              providerAccountId: view.providerAccountId,
              repositoryId: view.repository.repositoryId,
              credentialEpoch: 1,
            },
            sourceBindingVersion: 1,
            roleMappingVersion: 1,
            provenanceVersion: 1,
          };
          const accountId =
            "dsh-source-read:" +
            dshAHash(["dsh-github-source-account-v1", scope, bindingId]);
          const configuration = {
            schemaVersion: 1,
            binding,
            repository: view.repository,
            mode: "observe",
            selection: setup.selection,
            issueRefs: setup.issueRefs,
            accountId,
            minimumIntervalMs: setup.minimumIntervalMs,
          };
          parseDshSourceConfiguration(configuration);
          const existing = readData(
            "dsh_a_source_bindings",
            "binding_id",
            bindingId,
          );
          if (existing && dshAJson(existing.binding) !== dshAJson(binding))
            aFail("DSH_A_REBIND_REQUIRES_FENCE");
          const prior = get(
            "SELECT revision FROM dsh_a_source_configuration_heads WHERE binding_id=?",
            [bindingId],
          );
          if (prior) {
            const previous = get(
              "SELECT data_json FROM dsh_a_source_configurations WHERE binding_id=? AND revision=?",
              [bindingId, prior.revision],
            );
            if (
              !previous ||
              dshAJson(
                (aJsonParse(previous.data_json as string) as DshARecord)
                  .configuration,
              ) !== dshAJson(configuration)
            )
              aFail("DSH_A_SOURCE_CONFIG_CONFLICT");
            return {
              ok: true,
              bindingId,
              configurationRevision: prior.revision,
            };
          }
          if (!existing) {
            const b = { binding, status: "active", revision: 1 };
            writeRow(
              "dsh_a_source_bindings",
              { binding_id: bindingId },
              {
                source_key: dshASourceKey("github", binding.authScope),
                revision: 1,
              },
              b,
            );
            recordBindingRevision(b);
          }
          const value = {
            schemaVersion: 1,
            scopeId: row.scope_id,
            revision: 1,
            configuration,
            configurationHash: dshAHash(configuration),
            userIntentHash: stored.userIntentHash,
          };
          authorityWrite(
            "dsh_a_source_configurations",
            { binding_id: bindingId, revision: 1 },
            {
              scope_id: row.scope_id,
              configuration_hash: value.configurationHash,
            },
            value,
          );
          authorityWrite(
            "dsh_a_source_configuration_heads",
            { binding_id: bindingId },
            { revision: 1 },
            { schemaVersion: 1, bindingId, revision: 1 },
          );
          const identity = {
            kind: "sourceBinding",
            tenantId: view.tenantId,
            workspaceId: view.workspaceId,
            provider: "github",
            repositoryId: view.repository.repositoryId,
            sourceBindingId: bindingId,
          };
          const scopeKey = dshSourceScopeKey(scope, identity),
            controlId = dshSourceModeId(scopeKey),
            operationId = dshAHash([
              "dsh-a-connect-source-mode-v1",
              row.scope_id,
              view.setupId,
              bindingId,
            ]);
          if (
            get(
              "SELECT control_id FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
              [row.scope_id, controlId],
            )
          )
            aFail("DSH_A_SOURCE_MODE_CONFLICT");
          const head = {
            schemaVersion: 1,
            controlId,
            scopeKey,
            identity,
            recordKind: "policy",
            axis: "mode",
            epoch: 1,
            revision: 1,
            operationId,
            value: { mode: "observe" },
          };
          const canonicalHash = dshAHash(head),
            operation = {
              schemaVersion: 1,
              operationId,
              controlId,
              scopeKey,
              recordKind: "policy",
              axis: "mode",
              targetEpoch: 1,
              previousRevision: 0,
              canonicalHash,
              domainsHash: dshAHash([]),
              semanticKey: operationId,
              head,
            };
          authorityWrite(
            "dsh_a_control_operations",
            { scope_id: row.scope_id, operation_id: operationId },
            {
              control_id: controlId,
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: "mode",
              target_epoch: 1,
              previous_revision: 0,
              canonical_hash: canonicalHash,
              domains_hash: operation.domainsHash,
              semantic_key: operationId,
            },
            operation,
          );
          authorityWrite(
            "dsh_a_control_heads",
            { scope_id: row.scope_id, control_id: controlId },
            {
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: "mode",
              epoch: 1,
              revision: 1,
              operation_id: operationId,
            },
            head,
          );
          controlTargets(row.scope_id, head);
          return { ok: true, bindingId, configurationRevision: 1 };
        },
        true,
        session,
      );
    },
    applyControl(frame: object, context: unknown) {
      return body(frame, "policy_control", context, (data, user) => {
        requireProfile();
        dshAFields(data, ["control", "expectedRevision"]);
        if (
          !aInteger(data.expectedRevision) ||
          aNumber(data.expectedRevision) < 0
        )
          aFail("DSH_A_CONTROL_INVALID");
        const { scopeId, scope } = userDomain(user, context);
        const control = data.control as DshARecord;
        if (control.kind === "mode") {
          dshAFields(control, ["kind", "identity", "mode", "epoch"]);
          const identity = dshSourceScopeIdentity(control.identity);
          if (
            (control.mode !== "off" &&
              control.mode !== "observe" &&
              control.mode !== "auto_draft") ||
            !aInteger(control.epoch) ||
            aNumber(control.epoch) < 1
          )
            aFail("DSH_A_CONTROL_INVALID");
          const scopeKey = dshSourceScopeKey(scope, identity),
            controlId = dshSourceModeId(scopeKey),
            canonicalHash = dshAHash(control),
            operationId = dshAHash([
              "dsh-a-mode-control-v1",
              scopeId,
              scopeKey,
              control.epoch,
            ]);
          const existing = get(
            "SELECT data_json FROM dsh_a_control_operations WHERE scope_id=? AND operation_id=?",
            [scopeId, operationId],
          );
          if (existing) {
            const prior = aJsonParse(
              existing.data_json as string,
            ) as DshARecord;
            if (prior.canonicalHash !== canonicalHash)
              aFail("DSH_A_CONTROL_CONFLICT");
            return { ok: true, control: prior.head, replayed: true };
          }
          const old = get(
            "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
            [scopeId, controlId],
          );
          if (
            aNumber(data.expectedRevision) !==
              (old ? aNumber(old.revision) : 0) ||
            (old && aNumber(control.epoch) <= aNumber(old.epoch))
          )
            aFail("DSH_A_CONTROL_CAS_CONFLICT");
          const revision = old ? aNumber(old.revision) + 1 : 1;
          const head = {
            schemaVersion: 1,
            controlId,
            scopeKey,
            identity,
            recordKind: "policy",
            axis: "mode",
            epoch: control.epoch,
            revision,
            operationId,
            value: { mode: control.mode },
          };
          const operation = {
            schemaVersion: 1,
            operationId,
            controlId,
            scopeKey,
            recordKind: "policy",
            axis: "mode",
            targetEpoch: control.epoch,
            previousRevision: data.expectedRevision,
            canonicalHash,
            domainsHash: dshAHash([]),
            semanticKey: operationId,
            head,
          };
          authorityWrite(
            "dsh_a_control_operations",
            { scope_id: scopeId, operation_id: operationId },
            {
              control_id: controlId,
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: "mode",
              target_epoch: control.epoch,
              previous_revision: data.expectedRevision,
              canonical_hash: canonicalHash,
              domains_hash: operation.domainsHash,
              semantic_key: operationId,
            },
            operation,
          );
          authorityWrite(
            "dsh_a_control_heads",
            { scope_id: scopeId, control_id: controlId },
            {
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: "mode",
              epoch: control.epoch,
              revision,
              operation_id: operationId,
            },
            head,
            Boolean(old),
          );
          controlTargets(scopeId, head);
          return { ok: true, control: head };
        }
        if (control.kind === "scope_policy") {
          dshAFields(control, ["kind", "identity", "axis", "allowed", "epoch"]);
          if (
            (control.axis !== "mandate" &&
              control.axis !== "egress" &&
              control.axis !== "privacy" &&
              control.axis !== "readonly") ||
            typeof control.allowed !== "boolean" ||
            !aInteger(control.epoch) ||
            aNumber(control.epoch) < 1
          )
            aFail("DSH_A_CONTROL_INVALID");
          const identity = dshSourceScopeIdentity(control.identity),
            scopeKey = dshSourceScopeKey(scope, identity),
            axis = control.axis;
          const controlId =
            "dsh-policy:" + dshAHash(["dsh-policy-v1", scopeKey, axis]);
          const canonicalHash = dshAHash(control),
            operationId = dshAHash([
              "dsh-a-scope-policy-v1",
              scopeId,
              scopeKey,
              axis,
              control.epoch,
            ]);
          const prior = get(
            "SELECT data_json FROM dsh_a_control_operations WHERE scope_id=? AND operation_id=?",
            [scopeId, operationId],
          );
          if (prior) {
            const old = captureIpcData(
              aJsonParse(prior.data_json as string),
            ) as DshARecord;
            if (old.canonicalHash !== canonicalHash)
              aFail("DSH_A_CONTROL_CONFLICT");
            return { ok: true, control: old.head, replayed: true };
          }
          const old = get(
            "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
            [scopeId, controlId],
          );
          if (
            aNumber(data.expectedRevision) !==
              (old ? aNumber(old.revision) : 0) ||
            (old && aNumber(control.epoch) <= aNumber(old.epoch))
          )
            aFail("DSH_A_CONTROL_CAS_CONFLICT");
          const revision = old ? aNumber(old.revision) + 1 : 1,
            head = {
              schemaVersion: 1,
              controlId,
              scopeKey,
              identity,
              recordKind: "policy",
              axis,
              epoch: control.epoch,
              revision,
              operationId,
              value: { allowed: control.allowed, restriction: null },
            };
          const operation = {
            schemaVersion: 1,
            operationId,
            controlId,
            scopeKey,
            recordKind: "policy",
            axis,
            targetEpoch: control.epoch,
            previousRevision: data.expectedRevision,
            canonicalHash,
            domainsHash: dshAHash([]),
            semanticKey: operationId,
            head,
          };
          authorityWrite(
            "dsh_a_control_operations",
            { scope_id: scopeId, operation_id: operationId },
            {
              control_id: controlId,
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: axis,
              target_epoch: control.epoch,
              previous_revision: data.expectedRevision,
              canonical_hash: canonicalHash,
              domains_hash: operation.domainsHash,
              semantic_key: operationId,
            },
            operation,
          );
          authorityWrite(
            "dsh_a_control_heads",
            { scope_id: scopeId, control_id: controlId },
            {
              scope_key: scopeKey,
              record_kind: "policy",
              axis_or_leaf: axis,
              epoch: control.epoch,
              revision,
              operation_id: operationId,
            },
            head,
            Boolean(old),
          );
          controlTargets(scopeId, head);
          return { ok: true, control: head };
        }
        if (control.kind === "source_setup") {
          dshAFields(control, ["kind", "setup"]);
          const setup = control.setup as DshARecord;
          dshAFields(setup, [
            "schemaVersion",
            "setupId",
            "tenantId",
            "candidateRepository",
            "mode",
            "accountId",
            "minimumIntervalMs",
            "selection",
            "issueRefs",
          ]);
          dshAFields(setup.candidateRepository, ["owner", "repo"]);
          const selected = setup.selection as DshARecord;
          dshAFields(
            selected,
            selected.kind === "issue_ids"
              ? ["kind", "issueIds"]
              : ["kind", "match", "labelIds"],
          );
          const selectedIds =
            selected.kind === "issue_ids"
              ? selected.issueIds
              : selected.labelIds;
          if (
            (selected.kind !== "issue_ids" && selected.kind !== "label_ids") ||
            (selected.kind === "label_ids" && selected.match !== "all") ||
            !Array.isArray(selectedIds) ||
            !selectedIds.length ||
            selectedIds.length > 1000
          )
            aFail("DSH_A_SOURCE_CONFIG_INVALID");
          for (let i = 0; i < selectedIds.length; i++) {
            if (
              typeof selectedIds[i] !== "string" ||
              !selectedIds[i] ||
              selectedIds[i].length > 256
            )
              aFail("DSH_A_SOURCE_CONFIG_INVALID");
            for (let j = 0; j < i; j++)
              if (selectedIds[j] === selectedIds[i])
                aFail("DSH_A_SOURCE_CONFIG_INVALID");
          }
          if (
            setup.schemaVersion !== 1 ||
            typeof setup.setupId !== "string" ||
            !setup.setupId ||
            typeof setup.tenantId !== "string" ||
            !setup.tenantId ||
            (setup.mode !== "off" && setup.mode !== "observe") ||
            typeof setup.accountId !== "string" ||
            !setup.accountId ||
            !aInteger(setup.minimumIntervalMs) ||
            aNumber(setup.minimumIntervalMs) < 1000
          )
            aFail("DSH_A_SOURCE_CONFIG_INVALID");
          if (!Array.isArray(setup.issueRefs) || setup.issueRefs.length > 1000)
            aFail("DSH_A_SOURCE_CONFIG_INVALID");
          for (let i = 0; i < setup.issueRefs.length; i++) {
            const ref = setup.issueRefs[i];
            dshAFields(ref, ["issueId", "issueNumber"]);
            if (
              typeof ref.issueId !== "string" ||
              !ref.issueId ||
              !aInteger(ref.issueNumber) ||
              aNumber(ref.issueNumber) < 1
            )
              aFail("DSH_A_SOURCE_CONFIG_INVALID");
            let found = false;
            for (let j = 0; j < selectedIds.length; j++)
              if (selectedIds[j] === ref.issueId) found = true;
            if (!found) aFail("DSH_A_SOURCE_CONFIG_INVALID");
            for (let j = 0; j < i; j++)
              if (
                setup.issueRefs[j].issueId === ref.issueId ||
                setup.issueRefs[j].issueNumber === ref.issueNumber
              )
                aFail("DSH_A_SOURCE_CONFIG_INVALID");
          }
          if (
            (selected.kind === "issue_ids" &&
              setup.issueRefs.length !== selectedIds.length) ||
            (selected.kind === "label_ids" && setup.issueRefs.length)
          )
            aFail("DSH_A_SOURCE_CONFIG_INVALID");
          const candidate = setup.candidateRepository as DshARecord;
          if (
            typeof candidate.owner !== "string" ||
            typeof candidate.repo !== "string" ||
            !candidate.owner ||
            !candidate.repo ||
            candidate.owner.length > 39 ||
            candidate.repo.length > 100
          )
            aFail("DSH_A_SOURCE_CONFIG_INVALID");
          const old = get(
            "SELECT * FROM dsh_a_source_setups WHERE setup_id=?",
            [setup.setupId],
          );
          if (
            (old && old.scope_id !== scopeId) ||
            aNumber(data.expectedRevision) !== (old ? aNumber(old.revision) : 0)
          )
            aFail("DSH_A_SOURCE_CONFIG_CAS_CONFLICT");
          const revision = old ? aNumber(old.revision) + 1 : 1,
            value = {
              schemaVersion: 1,
              scopeId,
              revision,
              configuration: setup,
              configurationHash: dshAHash(setup),
              userIntentHash: user!.bodyHash,
            };
          authorityWrite(
            "dsh_a_source_setups",
            { setup_id: setup.setupId },
            {
              scope_id: scopeId,
              revision,
              configuration_hash: value.configurationHash,
            },
            value,
            Boolean(old),
          );
          return { ok: true, configuration: value };
        }
        if (control.kind !== "source_config") aFail("DSH_A_CONTROL_INVALID");
        dshAFields(control, ["kind", "configuration"]);
        const configuration = parseDshSourceConfiguration(
            control.configuration,
          ),
          binding = configuration.binding as DshARecord,
          auth = binding.authScope as DshARecord;
        if (auth.workspaceId !== scope.workspaceId)
          aFail("DSH_A_SOURCE_CONFIG_SCOPE");
        const existing = readData(
          "dsh_a_source_bindings",
          "binding_id",
          binding.bindingId as string,
        );
        if (existing && dshAJson(existing.binding) !== dshAJson(binding))
          aFail("DSH_A_REBIND_REQUIRES_FENCE");
        if (!existing) {
          const row = { binding, status: "active", revision: 1 };
          writeRow(
            "dsh_a_source_bindings",
            { binding_id: binding.bindingId },
            { source_key: dshASourceKey(binding.provider, auth), revision: 1 },
            row,
          );
          recordBindingRevision(row);
        }
        const old = get(
          "SELECT * FROM dsh_a_source_configuration_heads WHERE binding_id=?",
          [binding.bindingId],
        );
        if (
          aNumber(data.expectedRevision) !== (old ? aNumber(old.revision) : 0)
        )
          aFail("DSH_A_SOURCE_CONFIG_CAS_CONFLICT");
        const revision = old ? aNumber(old.revision) + 1 : 1,
          value = {
            schemaVersion: 1,
            scopeId,
            revision,
            configuration,
            configurationHash: dshAHash(configuration),
            userIntentHash: user!.bodyHash,
          };
        authorityWrite(
          "dsh_a_source_configurations",
          { binding_id: binding.bindingId, revision },
          { scope_id: scopeId, configuration_hash: value.configurationHash },
          value,
        );
        authorityWrite(
          "dsh_a_source_configuration_heads",
          { binding_id: binding.bindingId },
          { revision },
          { schemaVersion: 1, bindingId: binding.bindingId, revision },
          Boolean(old),
        );
        return { ok: true, configuration: value };
      });
    },
    reserveAssessment(frame: object, context: unknown) {
      return body(frame, "assessment_reserve", context, (data) => {
        requireProfile();
        dshAFields(data, [
          "schemaVersion",
          "bindingId",
          "inputId",
          "proofVersion",
          "mandateId",
          "requestedVersion",
          "expectedSelectionRevision",
        ]);
        if (
          data.schemaVersion !== 1 ||
          typeof data.bindingId !== "string" ||
          typeof data.inputId !== "string" ||
          typeof data.mandateId !== "string" ||
          !aInteger(data.proofVersion) ||
          aNumber(data.proofVersion) < 1 ||
          (data.requestedVersion !== 1 && data.requestedVersion !== 2) ||
          (data.expectedSelectionRevision !== 0 &&
            data.expectedSelectionRevision !== 1)
        )
          aFail("DSH_A_ASSESSMENT_INVALID");
        const input = readData("dsh_a_inbox", "input_id", data.inputId);
        if (!input) aFail("DSH_A_INPUT_NOT_FOUND");
        const envelope = input.envelope as DshARecord,
          thread = envelope.thread as DshARecord;
        if (envelope.kind !== "created" && envelope.kind !== "edited")
          aFail("DSH_A_SOURCE_CONTROL_ONLY");
        const refs = invokeSource(
          readOriginalDshAdmissionReferences,
          undefined,
          [source, frame, "assessment_reserve"],
        ) as { sourceScan?: object };
        if (!refs.sourceScan) aFail("DSH_A_ASSESSMENT_SOURCE_REQUIRED");
        const sourceView = invokeSource(
          readOriginalGithubSourceScanForAdmission,
          undefined,
          [refs.sourceScan, source, owner, source],
        ) as ReturnType<typeof readOriginalGithubSourceScanForAdmission>;
        const originalGuard = guard!;
        guard = () => {
          originalGuard();
          invokeSource(sourceView.assertCurrent, undefined, [], true);
        };
        const sourceData = sourceView.data as unknown as DshARecord;
        let matches = false;
        for (
          let i = 0;
          i < (sourceData.candidates as DshARecord[]).length;
          i++
        ) {
          const candidate = (sourceData.candidates as DshARecord[])[i]!,
            observed = candidate.envelope as DshARecord;
          if (
            "dsh-input:" + dshAInputKey(observed) === data.inputId &&
            dshAJson(observed) === dshAJson(envelope) &&
            (observed.actorEvidence as DshARecord).kind !== "unknown"
          )
            matches = true;
        }
        if (!matches) aFail("DSH_A_ASSESSMENT_SOURCE_REQUIRED");
        if (thread.sourceBindingId !== data.bindingId)
          aFail("DSH_A_INPUT_NOT_FOUND");
        const sourceBinding = readData(
          "dsh_a_source_bindings",
          "binding_id",
          data.bindingId,
        );
        if (!sourceBinding || sourceBinding.status !== "active")
          aFail("DSH_A_SOURCE_BINDING_CLOSED");
        const proofRow = get(
          "SELECT * FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
          [data.inputId, data.proofVersion],
        );
        if (!proofRow) aFail("DSH_A_PROOF_NOT_FOUND");
        const proof = captureIpcData(
          aJsonParse(proofRow.data_json as string),
        ) as DshARecord;
        validateDshAStoredBody("dsh_a_input_proofs", proof);
        if (
          proof.provenanceVersion !== proofRow.proof_version ||
          proofRow.proof_hash !== dshAHash(proof)
        )
          aFail("DSH_A_PROOF_CONFLICT");
        const head = readData(
          "dsh_a_object_heads",
          "object_id",
          dshSourceObjectIdentity(dshAObservation(envelope)),
        );
        const state = head?.state as DshARecord | undefined,
          current = state?.current as DshARecord | undefined;
        if (
          !head ||
          !state ||
          state.freeze !== null ||
          !current ||
          current.providerRevision !== envelope.providerRevision ||
          current.contentHash !== envelope.contentHash
        )
          aFail("DSH_A_INPUT_NOT_CURRENT");
        const configured = get(
          "SELECT c.scope_id FROM dsh_a_source_configurations c JOIN dsh_a_source_configuration_heads h ON h.binding_id=c.binding_id AND h.revision=c.revision WHERE c.binding_id=?",
          [data.bindingId],
        );
        if (!configured) aFail("DSH_A_SOURCE_CONFIG_REQUIRED");
        const domainRow = get("SELECT * FROM dsh_a_domains WHERE scope_id=?", [
          configured.scope_id,
        ]);
        if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
        const mandateHead = get(
          "SELECT * FROM dsh_a_mandate_heads WHERE scope_id=? AND mandate_id=?",
          [domainRow.scope_id, data.mandateId],
        );
        if (!mandateHead) aFail("DSH_A_MANDATE_REQUIRED");
        const mandateRow = get(
          "SELECT data_json FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
          [domainRow.scope_id, data.mandateId, mandateHead.mandate_revision],
        )!;
        const projection = parseMandateProjection(
            (
              captureIpcData(
                aJsonParse(mandateRow.data_json as string),
              ) as DshARecord
            ).projection,
          ),
          mandate = projection.document;
        if (
          mandate.sourceBindingId !== data.bindingId ||
          mandate.status !== "active"
        )
          aFail("DSH_A_MANDATE_SCOPE");
        const selected = get(
          "SELECT revision FROM dsh_a_selection_heads WHERE scope_id=? AND input_id=? AND mandate_id=?",
          [domainRow.scope_id, data.inputId, data.mandateId],
        );
        if (
          (selected ? aNumber(selected.revision) : 0) !==
            data.expectedSelectionRevision ||
          (data.requestedVersion === 1 && selected) ||
          (data.requestedVersion === 2 &&
            (!selected || selected.revision !== 1))
        )
          aFail("DSH_A_SELECTION_CAS_CONFLICT");
        if (
          data.requestedVersion === 2 &&
          get(
            "SELECT command_id FROM dsh_a_command_outbox WHERE scope_id=? AND input_id=?",
            [domainRow.scope_id, data.inputId],
          )
        )
          aFail("DSH_A_ASSESSMENT_REPLACEMENT_FORBIDDEN");
        const egressRows = all(
          "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND record_kind='leaf' AND axis_or_leaf='egress'",
          [domainRow.scope_id],
        );
        let policy: DshARecord | undefined;
        for (let i = 0; i < egressRows.length; i++) {
          const e = captureIpcData(
              aJsonParse(egressRows[i]!.data_json as string),
            ) as DshARecord,
            identity = e.identity as DshARecord;
          if (
            identity.sourceBindingId === data.bindingId &&
            identity.mandateId === data.mandateId &&
            (e.value as DshARecord).policyRef === mandate.dataEgressPolicyRef
          )
            policy = parseDshEgressPolicy(e.value);
        }
        if (!policy || policy.enabled !== true) aFail("DSH_A_EGRESS_REQUIRED");
        const snapshots = get(
          "SELECT data_json FROM dsh_a_source_snapshots WHERE snapshot_id=?",
          [envelope.snapshotRef],
        );
        let snapshotAt = envelope.receivedAt as string;
        if (snapshots) {
          const snap = captureIpcData(
              aJsonParse(snapshots.data_json as string),
            ) as DshARecord,
            read = get(
              "SELECT data_json FROM dsh_a_source_reads WHERE attempt_id=?",
              [snap.readAttemptId],
            );
          if (read)
            snapshotAt = (
              captureIpcData(aJsonParse(read.data_json as string)) as DshARecord
            ).sourceSnapshotAt as string;
        }
        const entry = {
          inputId: data.inputId,
          objectKind: envelope.objectKind,
          objectId: envelope.objectId,
          revision: envelope.providerRevision,
          contentHash: envelope.contentHash,
          provenanceVersion: proof.provenanceVersion,
          actorEvidenceHash: proof.actorEvidenceHash,
          actorMappingVersion: proof.actorMappingVersion,
        };
        const manifestBase = {
            schemaVersion: 1,
            thread,
            entries: [entry],
            sourceSnapshotAt: snapshotAt,
          },
          manifest = {
            ...manifestBase,
            manifestHash: hashEvidenceManifest({
              ...manifestBase,
              manifestHash: "0".repeat(64),
            }),
          };
        const basisHash = dshAHash([
          "dsh-a-input-basis-v1",
          {
            inputId: data.inputId,
            inputKey: dshAInputKey(envelope),
            proofVersion: data.proofVersion,
            proofHash: proofRow.proof_hash,
            headId: dshSourceObjectIdentity(dshAObservation(envelope)),
            headRevision: head.revision,
            headHash: dshAHash(head),
            bindingId: data.bindingId,
            bindingRevision: sourceBinding.revision,
          },
        ]);
        const attemptId =
          "dsh-assessment-attempt:" +
          dshAHash([
            "dsh-a-assessment-attempt-v1",
            domainRow.scope_id,
            data.inputId,
            data.mandateId,
            data.requestedVersion,
          ]);
        const operationKey =
          "dsh-assessment-operation:" +
          dshAHash([
            "dsh-a-assessment-operation-v1",
            domainRow.scope_id,
            data.inputId,
            data.mandateId,
            data.requestedVersion,
          ]);
        const validUntil = aMinimum(
          instantMs(mandate.validUntil),
          instantMs(policy.validUntil as string),
        );
        const modelPolicy = {
          modelId: (policy.modelIds as string[])[0],
          promptVersion: DSH_ASSESSMENT_PROMPT_VERSION,
          ruleVersion: mandate.ruleVersion,
          assessmentProfile: "model_text_only_v1",
          negativeHintPolicy: "uncertainty-negative-v1",
        };
        const value = {
          schemaVersion: 1,
          scopeId: domainRow.scope_id,
          attemptId,
          inputId: data.inputId,
          bindingId: data.bindingId,
          proofVersion: data.proofVersion,
          mandateId: data.mandateId,
          mandateRevision: mandate.revision,
          assessmentVersion: data.requestedVersion,
          previousSelectionRevision: data.expectedSelectionRevision,
          basisHash,
          evidenceManifest: manifest,
          modelPolicy,
          sourceSnapshotRefs: [envelope.snapshotRef],
          purpose: "admission",
          operationKey,
          semanticPayloadHash: dshAHash([
            "dsh-a-assessment-request-v1",
            basisHash,
            manifest,
            modelPolicy,
            mandate.revision,
          ]),
          maxAttempts: 2,
          deadline: aMinimum(
            validUntil,
            instantMs(mandate.limits.executionDeadline),
          ),
          validUntil,
          evidenceRefs: [data.inputId],
        };
        const old = get(
          "SELECT data_json FROM dsh_a_assessment_attempts WHERE scope_id=? AND input_id=? AND mandate_id=? AND assessment_version=?",
          [
            domainRow.scope_id,
            data.inputId,
            data.mandateId,
            data.requestedVersion,
          ],
        );
        if (old) {
          if (old.data_json !== dshAJson(value))
            aFail("DSH_A_ASSESSMENT_CONFLICT");
          return { ok: true, attempt: value, replayed: true };
        }
        // This bounded durable intent grants no body/model/network authority.
        // Actual Root/budget reservation belongs to ModelSource after body read.
        authorityWrite(
          "dsh_a_assessment_attempts",
          {
            scope_id: domainRow.scope_id,
            input_id: data.inputId,
            mandate_id: data.mandateId,
            assessment_version: data.requestedVersion,
          },
          {
            attempt_id: attemptId,
            proof_version: data.proofVersion,
            mandate_revision: mandate.revision,
            previous_selection_revision: data.expectedSelectionRevision,
          },
          value,
        );
        return { ok: true, attempt: value };
      });
    },
    async importAssessmentCandidate(frame: object, context: unknown) {
      local();
      const invocation = {};
      pending.add(invocation);
      let result:
        | ReturnType<typeof readOriginalDshAssessmentResult>
        | undefined;
      try {
        body(
          frame,
          "assessment_result",
          context,
          (data) => {
            requireProfile();
            dshAFields(data, ["attemptId"]);
            if (typeof data.attemptId !== "string")
              aFail("DSH_A_ASSESSMENT_NOT_FOUND");
            const refs = invokeSource(
              readOriginalDshAdmissionReferences,
              undefined,
              [source, frame, "assessment_result"],
            ) as { modelAttempt?: object };
            if (!refs.modelAttempt) aFail("DSH_A_MODEL_RESULT_REQUIRED");
            result = invokeSource(readOriginalDshAssessmentResult, undefined, [
              refs.modelAttempt,
              owner,
              source,
              data.attemptId,
            ]) as ReturnType<typeof readOriginalDshAssessmentResult>;
            return { ok: true };
          },
          "snapshot",
        );
        const known = aApply(result!.waitKnown, undefined, []);
        retain(known, aPromise(known) ? "promise" : "unknown");
        assertStandardIpcPromise(known, "DSH_A_MODEL_RESULT_UNCONFIRMED");
        await (known as Promise<void>);
        return body(frame, "assessment_result", context, (data) => {
          requireProfile();
          dshAFields(data, ["attemptId"]);
          const view = result!;
          invokeSource(view.assertKnown, undefined, [], true);
          invokeSource(view.assertLocal, undefined, [], true);
          const row = get(
            "SELECT * FROM dsh_a_assessment_attempts WHERE attempt_id=?",
            [view.attemptId],
          );
          if (!row) aFail("DSH_A_ASSESSMENT_NOT_FOUND");
          const attempt = captureIpcData(
              aJsonParse(row.data_json as string),
            ) as DshARecord,
            policy = attempt.modelPolicy as DshARecord,
            manifest = attempt.evidenceManifest as DshARecord;
          if (
            view.attemptId !== data.attemptId ||
            view.modelId !== policy.modelId ||
            view.promptVersion !== policy.promptVersion ||
            view.ruleVersion !== policy.ruleVersion ||
            view.evidenceManifestHash !== manifest.manifestHash ||
            view.assessmentVersion !== row.assessment_version ||
            view.validUntil !== attempt.validUntil ||
            view.purpose !== attempt.purpose
          )
            aFail("DSH_A_MODEL_RESULT_CONFLICT");
          const raw = captureIpcData(view.result),
            outputHash = dshAHash([
              "dsh-a-assessment-candidate-v1",
              view.attemptId,
              raw,
            ]),
            candidateId = "dsh-assessment-candidate:" + outputHash;
          const candidate = {
            schemaVersion: 1,
            scopeId: row.scope_id,
            candidateId,
            attemptId: view.attemptId,
            outputHash,
            result: raw,
            modelId: view.modelId,
            promptVersion: view.promptVersion,
            ruleVersion: view.ruleVersion,
            evidenceManifestHash: view.evidenceManifestHash,
            dataEgressPolicyRef: view.dataEgressPolicyRef,
            validUntil: view.validUntil,
            assessmentVersion: view.assessmentVersion,
            purpose: view.purpose,
          };
          const old = get(
            "SELECT data_json FROM dsh_a_assessment_candidates WHERE scope_id=? AND candidate_id=?",
            [row.scope_id, candidateId],
          );
          if (old) {
            if (old.data_json !== dshAJson(candidate))
              aFail("DSH_A_ASSESSMENT_CONFLICT");
            return { ok: true, candidate, replayed: true };
          }
          authorityWrite(
            "dsh_a_assessment_candidates",
            { scope_id: row.scope_id, candidate_id: candidateId },
            { attempt_id: view.attemptId, output_hash: outputHash },
            candidate,
          );
          return { ok: true, candidate };
        });
      } finally {
        pending.delete(invocation);
        wake();
      }
    },
    publishEgressPolicy(frame: object, context: unknown) {
      return body(frame, "policy_control", context, (data, user) => {
        requireProfile();
        dshAFields(data, [
          "sourceBindingId",
          "mandateId",
          "policy",
          "expectedRevision",
        ]);
        if (
          typeof data.sourceBindingId !== "string" ||
          !data.sourceBindingId ||
          typeof data.mandateId !== "string" ||
          !data.mandateId ||
          !aInteger(data.expectedRevision) ||
          aNumber(data.expectedRevision) < 0
        )
          aFail("DSH_A_EGRESS_POLICY_INVALID");
        const { scopeId, scope } = userDomain(user, context),
          policy = parseDshEgressPolicy(data.policy);
        const stored = readData(
          "dsh_a_source_bindings",
          "binding_id",
          data.sourceBindingId,
        );
        if (!stored || stored.status !== "active")
          aFail("DSH_A_SOURCE_BINDING_CLOSED");
        const binding = stored.binding as DshARecord,
          auth = binding.authScope as DshARecord;
        if (auth.workspaceId !== scope.workspaceId) aFail("DSH_A_EGRESS_SCOPE");
        const identity = dshSourceScopeIdentity({
          kind: "mandate",
          tenantId: auth.tenantId,
          workspaceId: auth.workspaceId,
          provider: "github",
          repositoryId: auth.repositoryId,
          sourceBindingId: binding.bindingId,
          mandateId: data.mandateId,
        });
        const scopeKey = dshSourceScopeKey(scope, identity),
          controlId =
            "dsh-leaf:" +
            dshAHash(["dsh-authorization-leaf-v1", scopeKey, "egress"]);
        const policyHash = dshAHash([
          "dsh-a-egress-policy-v1",
          scope,
          identity,
          policy,
        ]);
        const operationId = dshAHash([
          "dsh-a-egress-control-v1",
          scopeId,
          scopeKey,
          policy.epoch,
        ]);
        const existing = get(
          "SELECT data_json FROM dsh_a_control_operations WHERE scope_id=? AND operation_id=?",
          [scopeId, operationId],
        );
        if (existing) {
          const old = captureIpcData(
            aJsonParse(existing.data_json as string),
          ) as DshARecord;
          if (old.canonicalHash !== policyHash) aFail("DSH_A_EGRESS_CONFLICT");
          return { ok: true, policy: old.head, replayed: true };
        }
        const old = get(
          "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
          [scopeId, controlId],
        );
        if (
          aNumber(data.expectedRevision) !==
            (old ? aNumber(old.revision) : 0) ||
          (old && aNumber(policy.epoch) <= aNumber(old.epoch))
        )
          aFail("DSH_A_EGRESS_CAS_CONFLICT");
        const revision = old ? aNumber(old.revision) + 1 : 1;
        const ownerValue = {
          policyRef: policy.policyRef,
          policyHash,
          provider: policy.provider,
          destinationRef: policy.destinationRef,
          purposes: policy.purposes,
          enabled: policy.enabled,
        };
        const head = {
          schemaVersion: 1,
          controlId,
          scopeKey,
          identity,
          recordKind: "leaf",
          axis: "egress",
          epoch: policy.epoch,
          revision,
          operationId,
          value: policy,
          policyHash,
          ownerValue,
        };
        const operation = {
          schemaVersion: 1,
          operationId,
          controlId,
          scopeKey,
          recordKind: "leaf",
          axis: "egress",
          targetEpoch: policy.epoch,
          previousRevision: data.expectedRevision,
          canonicalHash: policyHash,
          domainsHash: dshAHash([]),
          semanticKey: operationId,
          head,
        };
        authorityWrite(
          "dsh_a_control_operations",
          { scope_id: scopeId, operation_id: operationId },
          {
            control_id: controlId,
            scope_key: scopeKey,
            record_kind: "leaf",
            axis_or_leaf: "egress",
            target_epoch: policy.epoch,
            previous_revision: data.expectedRevision,
            canonical_hash: policyHash,
            domains_hash: operation.domainsHash,
            semantic_key: operationId,
          },
          operation,
        );
        authorityWrite(
          "dsh_a_control_heads",
          { scope_id: scopeId, control_id: controlId },
          {
            scope_key: scopeKey,
            record_kind: "leaf",
            axis_or_leaf: "egress",
            epoch: policy.epoch,
            revision,
            operation_id: operationId,
          },
          head,
          Boolean(old),
        );
        controlTargets(scopeId, head);
        return { ok: true, policy: head };
      });
    },
    putMandate(frame: object, context: unknown) {
      return body(frame, "mandate_control", context, (data, user) => {
        requireProfile();
        dshAFields(data, ["projection", "expectedHeadRevision"]);
        if (
          !aInteger(data.expectedHeadRevision) ||
          aNumber(data.expectedHeadRevision) < 0
        )
          aFail("DSH_A_MANDATE_INVALID");
        const { scopeId, domain } = userDomain(user, context),
          projection = parseMandateProjection(data.projection),
          document = projection.document;
        if (document.issuedByUserId !== user!.principalId)
          aFail("DSH_A_MANDATE_SCOPE");
        if (
          projection.workProfile.state === "known" &&
          projection.workProfile.value.executionProfile !== "model_text_only_v1"
        )
          aFail("DSH_A_READONLY_QUALIFICATION_REQUIRED");
        const binding = readData(
          "dsh_a_source_bindings",
          "binding_id",
          document.sourceBindingId,
        );
        if (
          !binding ||
          binding.status !== "active" ||
          (binding.binding as DshARecord).provider !== "github"
        )
          aFail("DSH_A_SOURCE_BINDING_CLOSED");
        const account = get(
          "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND account_id=? AND mandate_id=?",
          [scopeId, document.budgetRef, document.mandateId],
        );
        if (
          !account ||
          !domain.budget ||
          account.owner_id !== (domain.budget as DshARecord).ownerId ||
          account.unit_profile !== "dsh_budget_usd_micros_v1"
        )
          aFail("DSH_A_BUDGET_BINDING_REQUIRED");
        const previous = get(
          "SELECT revision,mandate_revision FROM dsh_a_mandate_heads WHERE scope_id=? AND mandate_id=?",
          [scopeId, document.mandateId],
        );
        const hash = hashMandateProjection({
            ...projection,
            contentHash: null,
          }),
          value = {
            schemaVersion: 2,
            scopeId,
            issuerEpoch: domain.authorityEpoch,
            projection: { ...projection, contentHash: hash },
          };
        const existing = get(
          "SELECT data_json FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
          [scopeId, document.mandateId, document.revision],
        );
        if (existing) {
          const accepted = captureIpcData(
            aJsonParse(existing.data_json as string),
          ) as DshARecord;
          if (
            dshAJson(accepted.projection) !== dshAJson(value.projection) ||
            dshMandateIssuerEpoch(accepted) !== domain.authorityEpoch
          )
            aFail("DSH_A_MANDATE_CONTENT_CONFLICT");
          return {
            ok: true,
            mandate: value,
            headRevision: previous?.revision,
            replayed: true,
          };
        }
        if (
          aNumber(data.expectedHeadRevision) !==
            (previous ? aNumber(previous.revision) : 0) ||
          document.revision !==
            (previous ? aNumber(previous.mandate_revision) + 1 : 1)
        )
          aFail("DSH_A_MANDATE_CAS_CONFLICT");
        const previousDocument = previous
          ? parseMandateProjection(
              authorityBody(
                "dsh_a_mandates",
                get(
                  "SELECT * FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
                  [scopeId, document.mandateId, previous.mandate_revision],
                )!,
              ).projection,
            ).document
          : undefined;
        const expectedEpoch = previousDocument
          ? previousDocument.authorizationEpoch + 1
          : aNumber(domain.authorityEpoch);
        if (document.authorizationEpoch !== expectedEpoch)
          aFail("DSH_A_MANDATE_EPOCH_CONFLICT");
        const revision = previous ? aNumber(previous.revision) + 1 : 1;
        authorityWrite(
          "dsh_a_mandates",
          {
            scope_id: scopeId,
            mandate_id: document.mandateId,
            mandate_revision: document.revision,
          },
          { source_binding_id: document.sourceBindingId, content_hash: hash },
          value,
        );
        authorityWrite(
          "dsh_a_mandate_heads",
          { scope_id: scopeId, mandate_id: document.mandateId },
          { revision, mandate_revision: document.revision },
          {
            schemaVersion: 1,
            scopeId,
            mandateId: document.mandateId,
            revision,
            mandateRevision: document.revision,
          },
          Boolean(previous),
        );
        const auth = (binding.binding as DshARecord).authScope as DshARecord,
          sourceIdentity = dshSourceScopeIdentity({
            kind: "sourceBinding",
            tenantId: auth.tenantId,
            workspaceId: auth.workspaceId,
            provider: "github",
            repositoryId: auth.repositoryId,
            sourceBindingId: document.sourceBindingId,
          });
        const mandateIdentity = dshSourceScopeIdentity({
          ...sourceIdentity,
          kind: "mandate",
          mandateId: document.mandateId,
        });
        userLeaf(scopeId, user!.storageScope, sourceIdentity, "source_auth", {
          authScope: auth,
          sourceBindingVersion: (binding.binding as DshARecord)
            .sourceBindingVersion,
          roleMappingVersion: (binding.binding as DshARecord)
            .roleMappingVersion,
          provenanceVersion: (binding.binding as DshARecord).provenanceVersion,
          status: binding.status,
          attestationRef: "dsh-a-source-binding:" + document.sourceBindingId,
        });
        userLeaf(
          scopeId,
          user!.storageScope,
          mandateIdentity,
          "mandate",
          document as unknown as DshARecord,
        );
        if (projection.workProfile.state === "known")
          userLeaf(
            scopeId,
            user!.storageScope,
            mandateIdentity,
            "readonly",
            projection.workProfile.value as unknown as DshARecord,
          );
        return { ok: true, mandate: value, headRevision: revision };
      });
    },
    pinBudget(receipt: object, context: unknown) {
      return body(receipt, "pin_budget", context, (data) => {
        requireProfile();
        const view = data as ReturnType<
          typeof readOriginalDshBudgetObservation
        >;
        const account = view.status.account;
        if (
          view.kind !== "ledger_observation" ||
          account.owner_id !== view.ownerId ||
          view.ownerId !== budgetBinding!.binding.ownerId ||
          view.profileId !== budgetBinding!.binding.profileId ||
          view.workspaceId !== budgetBinding!.binding.workspaceId ||
          account.profile_id !== view.profileId ||
          account.workspace_id !== view.workspaceId ||
          account.currency !== "USD" ||
          account.scale !== 6
        )
          aFail("DSH_A_BUDGET_BINDING_CONFLICT");
        const row = get(
          "SELECT * FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
          [view.profileId, view.workspaceId],
        );
        if (!row) aFail("DSH_A_DOMAIN_REQUIRED");
        const old = captureIpcData(
          aJsonParse(row.data_json as string),
        ) as DshARecord;
        const mandateEpoch = budgetMandateEpoch(
          row.scope_id,
          account.mandate_id,
          account.mandate_revision,
          old.authorityEpoch,
        );
        if (
          account.authorization_epoch !== mandateEpoch.authorizationEpoch ||
          account.authority_hash !==
            dshAHash([
              "dsh-a-budget-authority-v1",
              {
                storageScope: old.storageScope,
                principalId: old.principalId,
                authorityId: old.authorityId,
                authorityEpoch: old.authorityEpoch,
              },
            ])
        )
          aFail("DSH_A_BUDGET_AUTHORITY_CONFLICT");
        const membership = get(
          "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND (account_id=? OR mandate_id=?)",
          [row.scope_id, account.account_id, account.mandate_id],
        );
        if (
          membership &&
          (membership.account_id !== account.account_id ||
            membership.mandate_id !== account.mandate_id ||
            membership.owner_id !== view.ownerId ||
            membership.unit_profile !== "dsh_budget_usd_micros_v1")
        )
          aFail("DSH_A_BUDGET_BINDING_CONFLICT");
        if (
          row.budget_owner_id !== null &&
          (row.budget_owner_id !== view.ownerId ||
            row.budget_unit_profile !== "dsh_budget_usd_micros_v1")
        )
          aFail("DSH_A_BUDGET_BINDING_CONFLICT");
        if (!membership) {
          const origin = {
            kind: "ledger_observation",
            ownerId: view.ownerId,
            ownerEpoch: view.ownerEpoch,
            accountId: account.account_id,
            accountRevision: account.revision,
            authorityHash: account.authority_hash,
          };
          const originDigest = dshAHash([
            "dsh-a-budget-observation-origin-v1",
            origin,
          ]);
          const value = {
            schemaVersion: 1,
            scopeId: row.scope_id,
            accountId: account.account_id,
            mandateId: account.mandate_id,
            ownerId: view.ownerId,
            unitProfile: "dsh_budget_usd_micros_v1",
            originDigest,
            origin,
          };
          authorityWrite(
            "dsh_a_budget_account_memberships",
            { scope_id: row.scope_id, account_id: account.account_id },
            {
              mandate_id: account.mandate_id,
              owner_id: view.ownerId,
              unit_profile: "dsh_budget_usd_micros_v1",
              origin_digest: originDigest,
            },
            value,
          );
        }
        if (row.budget_owner_id !== null)
          return {
            ok: true,
            enrollment: old,
            qualified: false,
            replayed: Boolean(membership),
          };
        if (row.state !== "pending_baseline" && row.state !== "off")
          aFail("DSH_A_BUDGET_BINDING_CONFLICT");
        invokeSource(budgetBinding!.binding.assertCurrent, undefined, [], true);
        invokeSource(budgetBinding!.binding.assertLocal, undefined, [], true);
        const next = {
          ...old,
          revision: aNumber(row.revision) + 1,
          budget: {
            ownerId: view.ownerId,
            accountId: account.account_id,
            unitProfile: "dsh_budget_usd_micros_v1",
          },
        };
        writeRow(
          "dsh_a_domains",
          { scope_id: row.scope_id },
          {
            profile_id: row.profile_id,
            workspace_id: row.workspace_id,
            principal_id: row.principal_id,
            budget_owner_id: view.ownerId,
            budget_account_id: account.account_id,
            budget_unit_profile: "dsh_budget_usd_micros_v1",
            authority_id: row.authority_id,
            authority_epoch: row.authority_epoch,
            revision: next.revision,
            state: row.state,
            body_hash: dshAHash([
              "dsh-a-authority-row-v1",
              "dsh_a_domains",
              next,
            ]),
          },
          next,
          true,
        );
        return { ok: true, enrollment: next, qualified: false };
      });
    },
    upgradeAdmission(frame: object, context: unknown) {
      dshAFields(context, ["requestSource"]);
      if (context.requestSource !== "user") aFail("DSH_A_SOURCE_REQUIRED");
      return body(frame, "migrate_admission", context, (data) => {
        dshAFields(data, ["schemaVersion", "expectedProfileDigest"]);
        requireProfile();
        const previous = get("SELECT * FROM dsh_a_profile WHERE singleton=1")!;
        if (
          data.schemaVersion !== 1 ||
          data.expectedProfileDigest !== DSH_A_DIGEST
        )
          aFail("DSH_A_MIGRATION_CONFLICT");
        if (get("PRAGMA user_version")?.user_version === 6)
          return { ok: true, profile: DSH_A_AUTHORITY_PROFILE };
        const originalBindings = all(
          "SELECT binding_id,source_key,revision,data_json FROM dsh_a_source_bindings ORDER BY binding_id",
        );
        for (let i = 0; i < DSH_A_OLD_GUARDS.length; i++)
          exec("DROP TRIGGER " + DSH_A_OLD_GUARDS[i]);
        // Original private migration only. Both floor swap and complete new DDL
        // remain in this one Native transaction; failure cannot publish half6.
        if (
          aNumber(
            run(
              "UPDATE dsh_a_profile SET profile=?,digest=? WHERE singleton=1 AND profile=? AND digest=?",
              [
                DSH_A_AUTHORITY_PROFILE,
                DSH_A_AUTHORITY_DIGEST,
                DSH_A_PROFILE,
                DSH_A_DIGEST,
              ],
            ).changes,
          ) !== 1
        )
          aFail("DSH_A_MIGRATION_CONFLICT");
        exec(DSH_A_AUTHORITY_DDL);
        exec("PRAGMA user_version=6");
        for (let i = 0; i < originalBindings.length; i++) {
          const row = originalBindings[i]!,
            original = captureIpcData(
              aJsonParse(row.data_json as string),
            ) as DshARecord;
          const ancestry = {
            schemaVersion: 1,
            bindingId: row.binding_id,
            bindingRevision: row.revision,
            sourceKey: row.source_key,
            binding: original.binding,
          };
          writeRow(
            "dsh_a_source_binding_revisions",
            { binding_id: row.binding_id, binding_revision: row.revision },
            {
              source_key: row.source_key,
              body_hash: dshAHash([
                "dsh-a-authority-row-v1",
                "dsh_a_source_binding_revisions",
                ancestry,
              ]),
            },
            ancestry,
          );
        }
        const migrationId = dshAHash([
          "dsh-a-profile-migration-v1",
          previous.store_id,
          DSH_A_DIGEST,
          DSH_A_AUTHORITY_DIGEST,
        ]);
        const ancestry = {
          schemaVersion: 1,
          migrationId,
          storeId: previous.store_id,
          fromVersion: 5,
          fromProfile: DSH_A_PROFILE,
          fromDigest: DSH_A_DIGEST,
          toVersion: 6,
          toProfile: DSH_A_AUTHORITY_PROFILE,
          toDigest: DSH_A_AUTHORITY_DIGEST,
          templateSqlHash: DSH_A_AUTHORITY_TEMPLATE_HASH,
          expandedSqlHash: DSH_A_AUTHORITY_SQL_HASH,
        };
        assertDshProfileAncestry(ancestry);
        writeRow(
          "dsh_a_profile_migrations",
          { migration_id: migrationId },
          {
            store_id: previous.store_id,
            from_version: 5,
            from_profile: DSH_A_PROFILE,
            from_digest: DSH_A_DIGEST,
            to_version: 6,
            to_profile: DSH_A_AUTHORITY_PROFILE,
            to_digest: DSH_A_AUTHORITY_DIGEST,
            ddl_hash: DSH_A_AUTHORITY_SQL_HASH,
            body_hash: dshProfileAncestryHash(ancestry),
          },
          ancestry,
        );
        requireProfile();
        return { ok: true, profile: DSH_A_AUTHORITY_PROFILE };
      });
    },
    readEvaluationBasis(frame: object, context: unknown) {
      return body(
        frame,
        "read_basis",
        context,
        (data) => {
          requireProfile();
          dshAFields(data, [
            "schemaVersion",
            "bindingId",
            "inputId",
            "proofVersion",
            "mandateId",
          ]);
          if (
            data.schemaVersion !== 1 ||
            typeof data.bindingId !== "string" ||
            typeof data.inputId !== "string" ||
            typeof data.mandateId !== "string" ||
            !aInteger(data.proofVersion) ||
            aNumber(data.proofVersion) < 1
          )
            aFail("DSH_A_BASIS_INVALID");
          const input = readData("dsh_a_inbox", "input_id", data.inputId);
          if (!input) aFail("DSH_A_INPUT_NOT_FOUND");
          validateDshAStoredBody("dsh_a_inbox", input);
          const envelope = input.envelope as DshARecord;
          if (
            (envelope.thread as DshARecord).sourceBindingId !== data.bindingId
          )
            aFail("DSH_A_INPUT_NOT_FOUND");
          const proof = get(
            "SELECT proof_version,proof_hash,data_json FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
            [data.inputId, data.proofVersion],
          );
          if (!proof) aFail("DSH_A_PROOF_NOT_FOUND");
          const proofBody = captureIpcData(
            aJsonParse(proof.data_json as string),
          ) as DshARecord;
          validateDshAStoredBody("dsh_a_input_proofs", proofBody);
          if (
            proofBody.provenanceVersion !== proof.proof_version ||
            dshAHash(proofBody) !== proof.proof_hash
          )
            aFail("DSH_A_PROOF_CONFLICT");
          const objectId = dshSourceObjectIdentity(dshAObservation(envelope)),
            head = readData("dsh_a_object_heads", "object_id", objectId),
            binding = readData(
              "dsh_a_source_bindings",
              "binding_id",
              data.bindingId,
            );
          if (!head || !binding) aFail("DSH_A_BASIS_UNCONFIRMED");
          validateDshAStoredBody("dsh_a_object_heads", head);
          validateDshAStoredBody("dsh_a_source_bindings", binding);
          const auth = proofBody.authScope as DshARecord,
            originalAuth = envelope.authScope as DshARecord;
          if (dshAJson(auth) !== dshAJson(originalAuth))
            aFail("DSH_A_PROOF_SCOPE_UNCONFIRMED");
          guard?.();
          return {
            ok: true,
            schemaVersion: 1,
            basis: {
              input,
              proof: {
                version: proof.proof_version,
                hash: proof.proof_hash,
                data: proofBody,
              },
              head,
              binding,
            },
            externalFacts: { state: "unknown", reason: "producer_unavailable" },
          };
        },
        "snapshot",
      );
    },
    initialize(frame: object, context: unknown) {
      return body(frame, "initialize", context, (data) => {
        dshAFields(data, ["schemaVersion"]);
        if (data.schemaVersion !== 1) dshAFail();
        const version = get("PRAGMA user_version")?.user_version;
        if (version === 5 || version === 6) {
          requireProfile();
          return {
            ok: true,
            profile: version === 6 ? DSH_A_AUTHORITY_PROFILE : DSH_A_PROFILE,
          };
        }
        if (version !== 4) aFail("DSH_A_PROFILE_REQUIRED");
        readCapturedGroupsSchema(
          all(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
          ) as unknown as Parameters<typeof readCapturedGroupsSchema>[0],
          4,
        );
        if (
          get(
            "SELECT name FROM sqlite_master WHERE name GLOB 'dsh_a_*' LIMIT 1",
          )
        )
          aFail("DSH_A_PROFILE_INTEGRITY");
        exec(DSH_A_DDL);
        const storeId = randomUUID();
        if (
          aNumber(
            run("INSERT INTO dsh_a_profile VALUES(1,?,?,?)", [
              DSH_A_PROFILE,
              DSH_A_DIGEST,
              storeId,
            ]).changes,
          ) !== 1
        )
          aFail("DSH_A_WRITESET_UNCONFIRMED");
        const tables = all(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        const operations = ["INSERT", "UPDATE", "DELETE"];
        for (let i = 0; i < tables.length; i++)
          for (let j = 0; j < operations.length; j++) {
            const operation = operations[j]!,
              table = tables[i]!.name as string;
            exec(
              `CREATE TRIGGER dsh_a_guard_${table}_${aLower(operation)} BEFORE ${operation} ON ${table} BEGIN SELECT CASE WHEN ${DSH_A_FUNCTION}() IS NOT '${DSH_A_DIGEST}' THEN RAISE(ABORT,'dsh_a_writer_required') END;${table === "dsh_a_profile" ? "SELECT RAISE(ABORT,'dsh_a_profile_immutable');" : ""} END`,
            );
          }
        exec("PRAGMA user_version=5");
        requireProfile();
        return { ok: true, profile: DSH_A_PROFILE };
      });
    },
    establishSourceBinding(frame: object, context: unknown) {
      return body(frame, "bind_source", context, (data) => {
        requireProfile();
        dshABinding(data);
        const auth = data.authScope as DshARecord,
          key = dshASourceKey(data.provider, auth),
          existing = get(
            "SELECT data_json FROM dsh_a_source_bindings WHERE source_key=?",
            [key],
          );
        if (existing) {
          const row = aJsonParse(existing.data_json as string) as DshARecord;
          if (dshAJson(row.binding) !== dshAJson(data))
            aFail("DSH_A_REBIND_REQUIRES_FENCE");
          return { ok: true, binding: row };
        }
        const row = { binding: data, status: "active", revision: 1 };
        writeRow(
          "dsh_a_source_bindings",
          { binding_id: data.bindingId },
          { source_key: key, revision: 1 },
          row,
        );
        recordBindingRevision(row);
        return { ok: true, binding: row };
      });
    },
    importVerifiedInput(frame: object, context: unknown) {
      return body(frame, "import_input", context, (data) => importInput(data));
    },
    narrowSourceBinding(frame: object, context: unknown) {
      return body(frame, "narrow_source", context, (data) => {
        requireProfile();
        dshAFields(data, ["bindingId", "expectedRevision"]);
        const old = readData(
          "dsh_a_source_bindings",
          "binding_id",
          data.bindingId as string,
        );
        if (!old || old.revision !== data.expectedRevision)
          aFail("DSH_A_BINDING_CONFLICT");
        const next = {
          ...old,
          status: "locally_revoked",
          revision: aNumber(old.revision) + 1,
        };
        const key = dshASourceKey(
          (old.binding as DshARecord).provider,
          (old.binding as DshARecord).authScope as DshARecord,
        );
        writeRow(
          "dsh_a_source_bindings",
          { binding_id: data.bindingId },
          { source_key: key, revision: next.revision },
          next,
          true,
        );
        recordBindingRevision(next);
        return { ok: true, binding: next };
      });
    },
    readSourceInput(frame: object, context: unknown) {
      return body(
        frame,
        "read",
        context,
        (data) => {
          requireProfile();
          dshAFields(data, ["bindingId", "inputId"]);
          const input = readData(
            "dsh_a_inbox",
            "input_id",
            data.inputId as string,
          );
          if (
            !input ||
            (input.envelope as DshARecord).thread === undefined ||
            ((input.envelope as DshARecord).thread as DshARecord)
              .sourceBindingId !== data.bindingId
          )
            aFail("DSH_A_INPUT_NOT_FOUND");
          guard?.();
          return captureIpcData({ ok: true, input });
        },
        false,
      );
    },
    waitKnown() {
      return new APromise<void>((yes, no) => {
        const check = () => {
          if (pending.size) return;
          waiters.delete(check);
          if (unknown.size)
            no(firstPresent ? first : Error("DSH_A_SDK_UNKNOWN"));
          else yes();
        };
        waiters.add(check);
        check();
      });
    },
  });
  return {
    source,
    userSource,
    port,
    readAdmissionPlans(
      realm: unknown,
      token: object,
    ): readonly DshAdmissionPlan[] {
      if (realm !== source) aFail("DSH_A_ORIGINAL_SOURCE_REQUIRED");
      const root = {};
      pending.add(root);
      try {
        const observed = invokeSource(
          readOriginalGithubSourceScanForAdmission,
          undefined,
          [token, realm, owner, source],
        ) as ReturnType<typeof readOriginalGithubSourceScanForAdmission>;
        const scan = parseGithubSourceScan(observed.data),
          authority = observed.authority;
        if (
          !authority ||
          authority.kind !== "source_binding" ||
          authority.sourceBindingId !== scan.bindingId
        )
          aFail("DSH_A_SOURCE_SCAN_SCOPE");
        const scope = {
          profileId: authority.profileId,
          workspaceId: authority.workspaceId,
        };
        let nativeLocal: (() => void) | undefined;
        const read = () =>
          body(
            scope,
            "read_domain",
            { requestSource: "scheduler", bootstrapAuthority: realm },
            () => {
              requireProfile();
              const native = invokeSource(
                readOriginalMainDshBootstrapAuthority,
                undefined,
                [realm, owner, source],
              ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
              nativeLocal = native.assertLocal;
              invokeSource(observed.assertCurrent, undefined, [], true);
              const floor = get(
                  "SELECT store_id FROM dsh_a_profile WHERE singleton=1",
                )!,
                scopeId = dshAHash(["dsh-a-domain-v1", floor.store_id, scope]);
              const mandates = all(
                "SELECT m.* FROM dsh_a_mandates m JOIN dsh_a_mandate_heads h ON h.scope_id=m.scope_id AND h.mandate_id=m.mandate_id AND h.mandate_revision=m.mandate_revision WHERE m.scope_id=? ORDER BY m.mandate_id",
                [scopeId],
              );
              const result: DshARecord[] = [];
              for (let i = 0; i < scan.candidates.length; i++) {
                const envelope = scan.candidates[i]!.envelope as DshARecord;
                if (envelope.kind !== "created" && envelope.kind !== "edited")
                  continue;
                const inputId = "dsh-input:" + dshAInputKey(envelope),
                  input = get(
                    "SELECT input_id FROM dsh_a_inbox WHERE input_id=?",
                    [inputId],
                  );
                if (!input) continue;
                let duplicate = false;
                for (let j = 0; j < result.length; j++)
                  if (result[j]!.inputId === inputId) duplicate = true;
                if (duplicate) continue;
                const proofVersion = aNumber(envelope.provenanceVersion),
                  proof = get(
                    "SELECT proof_hash FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
                    [inputId, proofVersion],
                  );
                for (let j = 0; j < mandates.length; j++) {
                  const projection = parseMandateProjection(
                      authorityBody("dsh_a_mandates", mandates[j]!).projection,
                    ),
                    document = projection.document;
                  if (document.sourceBindingId !== scan.bindingId) continue;
                  const selection = get(
                    "SELECT * FROM dsh_a_selection_heads WHERE scope_id=? AND input_id=? AND mandate_id=?",
                    [scopeId, inputId, document.mandateId],
                  );
                  const selected = selection ? aNumber(selection.revision) : 0;
                  if (selected !== 0 && selected !== 1 && selected !== 2)
                    aFail("DSH_A_SELECTION_CONFLICT");
                  const work = get(
                    "SELECT * FROM dsh_a_work_bindings WHERE scope_id=? AND stable_thread_key=? AND generation=1",
                    [scopeId, dshAHash(envelope.thread)],
                  );
                  const attempts = all(
                    "SELECT * FROM dsh_a_assessment_attempts WHERE scope_id=? AND input_id=? AND mandate_id=? ORDER BY assessment_version DESC",
                    [scopeId, inputId, document.mandateId],
                  );
                  let attemptRow: DshARecord | undefined;
                  for (let k = 0; k < attempts.length; k++)
                    if (attempts[k]!.mandate_revision === document.revision) {
                      attemptRow = attempts[k];
                      break;
                    }
                  const outbox = get(
                    "SELECT command_id FROM dsh_a_command_outbox WHERE scope_id=? AND input_id=? ORDER BY rowid DESC LIMIT 1",
                    [scopeId, inputId],
                  );
                  let candidateId: string | null = null,
                    attemptId: string | null = null,
                    requestedVersion: 1 | 2 = selected === 0 ? 1 : 2,
                    disposition: DshAdmissionPlan["disposition"] = "assess";
                  if (attemptRow) {
                    const attempt = authorityBody(
                      "dsh_a_assessment_attempts",
                      attemptRow,
                    );
                    attemptId = attempt.attemptId as string;
                    requestedVersion = attemptRow.assessment_version as 1 | 2;
                    const candidates = all(
                      "SELECT * FROM dsh_a_assessment_candidates WHERE scope_id=? AND attempt_id=? ORDER BY candidate_id",
                      [scopeId, attemptId],
                    );
                    const final = get(
                      "SELECT candidate_id FROM dsh_a_assessments WHERE scope_id=? AND attempt_id=?",
                      [scopeId, attemptId],
                    );
                    if (final) candidateId = final.candidate_id as string;
                    else if (candidates.length === 1)
                      candidateId = authorityBody(
                        "dsh_a_assessment_candidates",
                        candidates[0]!,
                      ).candidateId as string;
                    disposition = candidateId
                      ? "evaluate"
                      : candidates.length > 1
                        ? "review"
                        : "assess";
                    const decided = get(
                      "SELECT decision_id FROM dsh_a_decisions WHERE scope_id=? AND input_id=? AND mandate_id=? AND mandate_revision=? AND assessment_version=? LIMIT 1",
                      [
                        scopeId,
                        inputId,
                        document.mandateId,
                        document.revision,
                        requestedVersion,
                      ],
                    );
                    if (decided && !outbox) disposition = "review";
                  }
                  if (outbox) disposition = "reconcile";
                  if (
                    !proof ||
                    document.status !== "active" ||
                    (selected === 2 && !attemptRow)
                  )
                    disposition = "review";
                  aPush(result, {
                    bindingId: scan.bindingId,
                    inputId,
                    proofVersion,
                    mandateId: document.mandateId,
                    requestedVersion,
                    expectedSelectionRevision: selected,
                    expectedBindingRevision: work ? aNumber(work.revision) : 0,
                    attemptId,
                    candidateId,
                    disposition,
                  });
                }
              }
              return result;
            },
            "snapshot",
          ) as unknown as Omit<
            DshAdmissionPlan,
            "assertCurrent" | "assertLocal"
          >[];
        const values = aFreezeData(read()),
          revision = authorizationRevision;
        const assertLocal = () => {
          pureLocal();
          nativeLocal?.();
          observed.assertCurrent();
          if (authorizationRevision !== revision)
            aFail("DSH_A_ADMISSION_PLAN_STALE");
        };
        const assertCurrent = () => {
          assertLocal();
          if (dshAJson(read()) !== dshAJson(values))
            aFail("DSH_A_ADMISSION_PLAN_STALE");
          assertLocal();
        };
        const result: DshAdmissionPlan[] = [];
        for (let i = 0; i < values.length; i++)
          aPush(result, aFreeze({ ...values[i]!, assertCurrent, assertLocal }));
        return aFreeze(result);
      } finally {
        pending.delete(root);
        wake();
      }
    },
    readDraftAdmissionRequest(
      realm: unknown,
      proposal: object,
    ): DshDraftAdmissionRequestView {
      const row = (aApply(aWG, admissionProposals, [proposal]) ??
        aApply(aWG, draftProposals, [proposal])) as
        | { realm: unknown; view: DshDraftAdmissionRequestView }
        | undefined;
      if (!row || row.realm !== realm)
        aFail("DSH_A_ORIGINAL_ADMISSION_PROPOSAL_REQUIRED");
      row.view.assertCurrent();
      row.view.assertLocal();
      return row.view;
    },
    readWindowBaseline(
      realm: unknown,
      sourceBindingId: string,
      mandateId: string,
    ) {
      let native:
        | ReturnType<typeof readOriginalMainDshBootstrapAuthority>
        | undefined;
      const read = () =>
        body(
          { sourceBindingId, mandateId },
          "read_window",
          { requestSource: "scheduler", bootstrapAuthority: realm },
          () => {
            requireProfile();
            native = invokeSource(
              readOriginalMainDshBootstrapAuthority,
              undefined,
              [realm, owner, source],
            ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
            const baseline = currentAdmissionBaseline(
              sourceBindingId,
              mandateId,
            );
            return { expectedPrefixModeHash: baseline.prefixModeHash };
          },
          "snapshot",
        ) as { expectedPrefixModeHash: string };
      const value = read(),
        revision = authorizationRevision;
      const assertLocal = () => {
        pureLocal();
        native!.assertLocal();
        if (authorizationRevision !== revision)
          aFail("DSH_A_WINDOW_GUARD_CHANGED");
      };
      const assertCurrent = () => {
        assertLocal();
        if (read().expectedPrefixModeHash !== value.expectedPrefixModeHash)
          aFail("DSH_A_WINDOW_GUARD_CHANGED");
        assertLocal();
      };
      return aFreeze({ ...value, assertCurrent, assertLocal });
    },
    readAutoAdmissionWindow(
      realm: unknown,
      sourceBindingId: string,
      mandateId: string,
    ): DshAutoAdmissionWindowView | null {
      const exists = body(
        { sourceBindingId, mandateId },
        "read_window",
        { requestSource: "scheduler", bootstrapAuthority: realm },
        () => {
          requireProfile();
          return Boolean(
            get(
              "SELECT window_id FROM dsh_a_windows WHERE source_binding_id=? AND json_extract(data_json,'$.mandateId')=? LIMIT 1",
              [sourceBindingId, mandateId],
            ),
          );
        },
        "snapshot",
      );
      if (!exists) return null;
      let clock: ReturnType<typeof readOriginalMainDshClock> | undefined;
      const read = () =>
        body(
          { sourceBindingId, mandateId },
          "read_window",
          { requestSource: "scheduler", bootstrapAuthority: realm },
          () => {
            requireProfile();
            const basis = currentAdmissionBaseline(sourceBindingId, mandateId);
            const row = get(
              "SELECT * FROM dsh_a_windows WHERE scope_id=? AND source_binding_id=? AND prefix_mode_hash=?",
              [basis.domainRow.scope_id, sourceBindingId, basis.prefixModeHash],
            );
            if (!row) aFail("DSH_A_WINDOW_UNCONFIRMED");
            const stored = authorityBody("dsh_a_windows", row),
              window = stored.window as unknown as FrozenAutoAdmissionWindow;
            dshAFields(window, [
              "windowId",
              "sourceBindingId",
              "prefixModeGuardsHash",
              "admissionGrantHash",
              "effectiveAt",
              "baselineCheckpointRef",
              "providerTimeBasisProofRef",
              "freshnessPolicyVersion",
            ]);
            if (
              stored.qualification !== "operational-v1" ||
              stored.profile !== "freshness_operational_v1" ||
              stored.isolationMs !== 300000 ||
              stored.sourceBindingId !== sourceBindingId ||
              stored.mandateId !== mandateId ||
              stored.mandateRevision !== basis.mandate.revision ||
              stored.configurationRevision !==
                basis.configurationRow.revision ||
              window.windowId !== row.window_id ||
              window.prefixModeGuardsHash !== basis.prefixModeHash ||
              window.sourceBindingId !== sourceBindingId
            )
              aFail("DSH_A_WINDOW_REBASELINE_REQUIRED");
            clock = invokeSource(readOriginalMainDshClock, undefined, [
              realm,
              owner,
              source,
            ]) as ReturnType<typeof readOriginalMainDshClock>;
            if (
              clock.projection.state !== "verified" ||
              clock.projection.domainId !== stored.clockDomain ||
              clock.projection.qualificationEpoch !== stored.clockEpoch ||
              clock.projection.nowMs < aNumber(stored.maxObservedAt)
            )
              aFail("DSH_A_WINDOW_TIME_UNCONFIRMED");
            invokeSource(clock.assertLocal, undefined, [], true);
            return {
              window,
              observationsEndAt: stored.observationsEndAt,
              qualification: "operational-v1",
              profile: "freshness_operational_v1",
              isolationMs: 300000,
            };
          },
          "snapshot",
        ) as Omit<DshAutoAdmissionWindowView, "assertCurrent" | "assertLocal">;
      const snapshot = aFreezeData(read()),
        version = authorizationRevision;
      const assertLocal = () => {
        pureLocal();
        if (authorizationRevision !== version)
          aFail("DSH_A_WINDOW_GUARD_CHANGED");
        clock!.assertLocal();
      };
      const assertCurrent = () => {
        assertLocal();
        if (dshAJson(read()) !== dshAJson(snapshot))
          aFail("DSH_A_WINDOW_GUARD_CHANGED");
        assertLocal();
      };
      return aFreeze({ ...snapshot, assertCurrent, assertLocal });
    },
    readBudgetSettlementAudience(
      realm: unknown,
      delivery: unknown,
      runtime: unknown,
      exactBudgetSource: unknown,
    ): DshBudgetObservationAudience {
      local();
      const root = {};
      pending.add(root);
      try {
        const settlement = invokeSource(
          readOriginalMainDshBusinessSettlement,
          undefined,
          [delivery, realm, owner, runtime, exactBudgetSource],
        ) as ReturnType<typeof readOriginalMainDshBusinessSettlement>;
        invokeSource(settlement.assertKnown, undefined, [], true);
        if (
          !budgetBinding ||
          budgetBinding.runtime !== runtime ||
          budgetBinding.source !== exactBudgetSource
        )
          aFail("DSH_A_BUDGET_BINDING_REQUIRED");
        const command = settlement.command as DshARecord;
        let native:
          | ReturnType<typeof readOriginalMainDshBootstrapAuthority>
          | undefined;
        const read = () =>
          body(
            { commandId: command.commandId },
            "read_budget_settlement_audience",
            { requestSource: "scheduler", bootstrapAuthority: realm },
            () => {
              requireProfile();
              native = invokeSource(
                readOriginalMainDshBootstrapAuthority,
                undefined,
                [realm, owner, source],
              ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
              invokeSource(native.assertCurrent, undefined, [], true);
              invokeSource(settlement.assertKnown, undefined, [], true);
              invokeSource(
                budgetBinding!.binding.assertLocal,
                undefined,
                [],
                true,
              );
              const outboxRow = get(
                "SELECT * FROM dsh_a_command_outbox WHERE command_id=?",
                [command.commandId],
              );
              if (!outboxRow) aFail("DSH_A_COMMAND_NOT_FOUND");
              const outbox = authorityBody("dsh_a_command_outbox", outboxRow);
              if (dshAJson(outbox.command) !== dshAJson(command))
                aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
              const output = captureIpcData(
                settlement.observation.output,
              ) as DshARecord;
              const basis = output.basis as DshARecord | undefined;
              const receipt = (basis?.commandReceipt ?? output.receipt) as
                | DshARecord
                | undefined;
              if (
                !receipt ||
                receipt.kind !== "dsh_command" ||
                (receipt.result !== "applied" &&
                  receipt.result !== "blocked") ||
                receipt.operationKey !== command.operationKey ||
                receipt.semanticPayloadHash !== command.semanticPayloadHash ||
                dshAJson(receipt.command) !== dshAJson(command)
              )
                aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
              {
                const row = get(
                  "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
                  [outboxRow.scope_id, command.commandId],
                );
                if (
                  !row ||
                  dshAJson(
                    authorityBody("dsh_a_owner_receipts", row).receipt,
                  ) !== dshAJson(receipt)
                )
                  aFail("DSH_A_OWNER_RECEIPT_CONFLICT");
              }
              const mandateRow = get(
                "SELECT * FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
                [
                  outboxRow.scope_id,
                  command.mandateId,
                  command.mandateRevision,
                ],
              );
              if (!mandateRow) aFail("DSH_A_MANDATE_REQUIRED");
              const mandate = parseMandateProjection(
                authorityBody("dsh_a_mandates", mandateRow).projection,
              ).document;
              if (mandate.authorizationEpoch !== command.authorizationEpoch)
                aFail("DSH_A_MANDATE_CONFLICT");
              const memberRow = get(
                "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND account_id=? AND mandate_id=?",
                [outboxRow.scope_id, mandate.budgetRef, mandate.mandateId],
              );
              if (
                !memberRow ||
                memberRow.owner_id !== budgetBinding!.binding.ownerId ||
                memberRow.unit_profile !== "dsh_budget_usd_micros_v1"
              )
                aFail("DSH_A_BUDGET_BINDING_REQUIRED");
              const member = authorityBody(
                  "dsh_a_budget_account_memberships",
                  memberRow,
                ),
                origin = member.origin as DshARecord;
              if (
                !origin ||
                member.originDigest !==
                  dshAHash(["dsh-a-budget-observation-origin-v1", origin]) ||
                origin.ownerId !== memberRow.owner_id ||
                origin.accountId !== mandate.budgetRef ||
                typeof origin.authorityHash !== "string"
              )
                aFail("DSH_A_BUDGET_BINDING_CONFLICT");
              const scope = command.scope as DshARecord,
                auth = command.authScope as DshARecord;
              if (
                scope.profileId !== budgetBinding!.binding.profileId ||
                scope.workspaceId !== budgetBinding!.binding.workspaceId ||
                auth.tenantId !== (command.thread as DshARecord).tenantId
              )
                aFail("DSH_A_SCOPE_CONFLICT");
              return {
                storageScope: scope,
                tenantId: auth.tenantId,
                mandateId: mandate.mandateId,
                mandateRevision: mandate.revision,
                authorizationEpoch: mandate.authorizationEpoch,
                budgetAuthorityHash: origin.authorityHash,
                accountId: mandate.budgetRef,
                maxActiveWorks: mandate.limits.maxActiveWorks,
                maxDraftRequestsPerWork: mandate.limits.maxDraftRunsPerWork,
              };
            },
            "snapshot",
          ) as Omit<
            DshBudgetObservationAudience,
            "assertCurrent" | "assertLocal"
          >;
        const snapshot = aFreezeData(read());
        const assertLocal = () => {
          pureLocal();
          native!.assertLocal();
          budgetBinding!.binding.assertLocal();
          settlement.assertKnown();
          pureLocal();
        };
        const assertCurrent = () => {
          assertLocal();
          if (dshAJson(read()) !== dshAJson(snapshot))
            aFail("DSH_A_SETTLEMENT_AUDIENCE_STALE");
          assertLocal();
        };
        return aFreeze({ ...snapshot, assertCurrent, assertLocal });
      } finally {
        pending.delete(root);
        wake();
      }
    },
    readUserBudgetAudience(
      realm: unknown,
      userProof: object,
      bodyHash: string,
    ): DshUserBudgetAudience {
      if (realm !== source) aFail("DSH_A_ORIGINAL_SOURCE_REQUIRED");
      let nativeLocal: (() => void) | undefined,
        userLocal: (() => void) | undefined;
      const read = () =>
        body(
          userProof,
          "policy_control",
          { requestSource: "user", bodyHash, bootstrapAuthority: realm },
          (raw, user) => {
            requireProfile();
            dshAFields(raw, ["schemaVersion", "kind", "account", "mandate"]);
            if (raw.schemaVersion !== 1 || raw.kind !== "budget_config")
              aFail("DSH_A_BUDGET_CONFIGURATION_REQUIRED");
            dshAFields(raw.account, [
              "accountId",
              "tokenLimit",
              "costLimitMicros",
              "currency",
              "scale",
              "validUntil",
            ]);
            dshAFields(raw.mandate, [
              "tenantId",
              "mandateId",
              "mandateRevision",
            ]);
            const account = raw.account as DshARecord,
              mandate = raw.mandate as DshARecord;
            if (
              typeof account.accountId !== "string" ||
              !account.accountId ||
              account.currency !== "USD" ||
              account.scale !== 6 ||
              !aInteger(account.tokenLimit) ||
              aNumber(account.tokenLimit) < 1 ||
              !aInteger(account.costLimitMicros) ||
              aNumber(account.costLimitMicros) < 1 ||
              !aInteger(account.validUntil) ||
              aNumber(account.validUntil) < 1 ||
              typeof mandate.tenantId !== "string" ||
              !mandate.tenantId
            )
              aFail("DSH_A_BUDGET_CONFIGURATION_REQUIRED");
            const { domain, scopeId, scope } = userDomain(user, {
              bootstrapAuthority: realm,
            });
            const native = invokeSource(
              readOriginalMainDshBootstrapAuthority,
              undefined,
              [realm, owner, source],
            ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
            nativeLocal = native.assertLocal;
            userLocal = user!.assertLocal;
            const identity = budgetMandateEpoch(
              scopeId,
              mandate.mandateId,
              mandate.mandateRevision,
              domain.authorityEpoch,
            );
            const membership = get(
              "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND (mandate_id=? OR account_id=?)",
              [scopeId, mandate.mandateId, account.accountId],
            );
            if (
              membership &&
              (membership.mandate_id !== mandate.mandateId ||
                membership.account_id !== account.accountId)
            )
              aFail("DSH_A_BUDGET_BINDING_CONFLICT");
            if (identity.publishedMandateRevision !== null) {
              const original = authorityBody(
                  "dsh_a_mandates",
                  get(
                    "SELECT * FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
                    [
                      scopeId,
                      mandate.mandateId,
                      identity.publishedMandateRevision,
                    ],
                  )!,
                ),
                doc = parseMandateProjection(original.projection).document;
              if (doc.budgetRef !== account.accountId)
                aFail("DSH_A_BUDGET_BINDING_CONFLICT");
              const binding = readData(
                "dsh_a_source_bindings",
                "binding_id",
                doc.sourceBindingId,
              );
              if (
                !binding ||
                (binding.binding as DshARecord).authScope === undefined ||
                ((binding.binding as DshARecord).authScope as DshARecord)
                  .tenantId !== mandate.tenantId
              )
                aFail("DSH_A_SCOPE_CONFLICT");
            }
            return {
              kind: "main_dsh_user_budget_audience_v1",
              storageScope: scope,
              principalId: user!.principalId,
              tenantId: mandate.tenantId,
              mandateId: mandate.mandateId,
              mandateRevision: mandate.mandateRevision,
              ...identity,
              authorityId: domain.authorityId,
              issuerEpoch: domain.authorityEpoch,
              budgetAuthorityHash: dshAHash([
                "dsh-a-budget-authority-v1",
                {
                  storageScope: scope,
                  principalId: domain.principalId,
                  authorityId: domain.authorityId,
                  authorityEpoch: domain.authorityEpoch,
                },
              ]),
              accountId: account.accountId,
            };
          },
          "snapshot",
        ) as Omit<DshUserBudgetAudience, "assertCurrent" | "assertLocal">;
      const snapshot = aFreezeData(read());
      const assertLocal = () => {
        pureLocal();
        nativeLocal?.();
        userLocal?.();
        pureLocal();
      };
      const assertCurrent = () => {
        assertLocal();
        if (dshAJson(read()) !== dshAJson(snapshot))
          aFail("DSH_A_BUDGET_AUDIENCE_STALE");
        assertLocal();
      };
      return aFreeze({ ...snapshot, assertCurrent, assertLocal });
    },
    readBudgetObservationAudience(
      realm: unknown,
      mandateId: string,
    ): DshBudgetObservationAudience {
      if (typeof mandateId !== "string" || !mandateId || mandateId.length > 256)
        aFail("DSH_A_MANDATE_REQUIRED");
      if (!budgetBinding) aFail("DSH_A_BUDGET_BINDING_REQUIRED");
      let nativeLocal: (() => void) | undefined;
      const read = () =>
        body(
          { mandateId },
          "read_budget_audience",
          { requestSource: "scheduler", bootstrapAuthority: realm },
          () => {
            requireProfile();
            const native = invokeSource(
              readOriginalMainDshBootstrapAuthority,
              undefined,
              [realm, owner, source],
            ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
            nativeLocal = native.assertLocal;
            invokeSource(
              budgetBinding.binding.assertCurrent,
              undefined,
              [],
              true,
            );
            const domainRow = get(
              "SELECT * FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
              [
                budgetBinding.binding.profileId,
                budgetBinding.binding.workspaceId,
              ],
            );
            if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
            const domain = captureIpcData(
              aJsonParse(domainRow.data_json as string),
            ) as DshARecord;
            if (
              domainRow.body_hash !==
              dshAHash(["dsh-a-authority-row-v1", "dsh_a_domains", domain])
            )
              aFail("DSH_A_DOMAIN_CONFLICT");
            const doc = get(
              "SELECT m.* FROM dsh_a_mandates m JOIN dsh_a_mandate_heads h ON h.scope_id=m.scope_id AND h.mandate_id=m.mandate_id AND h.mandate_revision=m.mandate_revision WHERE m.scope_id=? AND m.mandate_id=?",
              [domainRow.scope_id, mandateId],
            );
            if (!doc) aFail("DSH_A_MANDATE_REQUIRED");
            const stored = captureIpcData(
                aJsonParse(doc.data_json as string),
              ) as DshARecord,
              mandate = parseMandateProjection(stored.projection).document;
            if (
              doc.body_hash !==
                dshAHash([
                  "dsh-a-authority-row-v1",
                  "dsh_a_mandates",
                  stored,
                ]) ||
              mandate.status !== "active" ||
              dshMandateIssuerEpoch(stored) !== domain.authorityEpoch
            )
              aFail("DSH_A_MANDATE_CLOSED");
            const member = get(
              "SELECT * FROM dsh_a_budget_account_memberships WHERE scope_id=? AND account_id=? AND mandate_id=?",
              [domainRow.scope_id, mandate.budgetRef, mandateId],
            );
            if (
              !member ||
              member.owner_id !== budgetBinding.binding.ownerId ||
              member.unit_profile !== "dsh_budget_usd_micros_v1"
            )
              aFail("DSH_A_BUDGET_BINDING_REQUIRED");
            const binding = readData(
              "dsh_a_source_bindings",
              "binding_id",
              mandate.sourceBindingId,
            );
            if (!binding || binding.status !== "active")
              aFail("DSH_A_SOURCE_BINDING_CLOSED");
            const auth = (binding.binding as DshARecord)
              .authScope as DshARecord;
            return {
              storageScope: domain.storageScope,
              tenantId: auth.tenantId,
              mandateId,
              mandateRevision: mandate.revision,
              authorizationEpoch: mandate.authorizationEpoch,
              budgetAuthorityHash: dshAHash([
                "dsh-a-budget-authority-v1",
                {
                  storageScope: domain.storageScope,
                  principalId: domain.principalId,
                  authorityId: domain.authorityId,
                  authorityEpoch: domain.authorityEpoch,
                },
              ]),
              accountId: mandate.budgetRef,
              maxActiveWorks: mandate.limits.maxActiveWorks,
              maxDraftRequestsPerWork: mandate.limits.maxDraftRunsPerWork,
            };
          },
          "snapshot",
        ) as Omit<
          DshBudgetObservationAudience,
          "assertCurrent" | "assertLocal"
        >;
      const snapshot = aFreezeData(read()),
        version = authorizationRevision;
      const assertLocal = () => {
        pureLocal();
        nativeLocal?.();
        budgetBinding.binding.assertLocal();
        if (authorizationRevision !== version)
          aFail("DSH_A_BUDGET_AUDIENCE_STALE");
      };
      const assertCurrent = () => {
        assertLocal();
        if (dshAJson(read()) !== dshAJson(snapshot))
          aFail("DSH_A_BUDGET_AUDIENCE_STALE");
        assertLocal();
      };
      return aFreeze({ ...snapshot, assertCurrent, assertLocal });
    },
    readClaimedCommand(realm: unknown, claim: object): DshClaimedCommandView {
      const entry = aApply(aWG, commandClaims, [claim]) as
        | { realm: unknown; view: DshClaimedCommandView }
        | undefined;
      if (!entry || entry.realm !== realm)
        aFail("DSH_A_ORIGINAL_COMMAND_CLAIM_REQUIRED");
      entry.view.assertCurrent();
      entry.view.assertLocal();
      return entry.view;
    },
    readGithubAuthority(
      realm: unknown,
      proof: object,
      purpose: "source_binding" | "source_setup",
    ) {
      if (purpose !== "source_binding" && purpose !== "source_setup")
        aFail("DSH_A_GITHUB_PURPOSE_REQUIRED");
      const wirePurpose =
        purpose === "source_binding"
          ? "github_source_read"
          : "github_source_setup";
      let nativeLocal: (() => void) | undefined,
        userLocal: (() => void) | undefined;
      const read = () =>
        body(
          proof,
          wirePurpose,
          { requestSource: "scheduler", bootstrapAuthority: realm },
          (data) => {
            requireProfile();
            const qualification = invokeSource(
              readOriginalMainDshBootstrapAuthority,
              undefined,
              [realm, owner, source],
            ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
            nativeLocal = qualification.assertLocal;
            let scopeId: string,
              configuration: DshARecord,
              configurationRevision: number,
              domain: DshARecord;
            let bindingRow: DshARecord | undefined;
            if (purpose === "source_setup") {
              dshAFields(data, [
                "setupId",
                "bodyHash",
                "candidateRepository",
                "expectedConfigurationRevision",
              ]);
              const refs = invokeSource(
                readOriginalDshAdmissionReferences,
                undefined,
                [realm, proof, wirePurpose],
              ) as { userControlProof?: object };
              if (!refs.userControlProof || !userSource || !userResolve)
                aFail("DSH_A_USER_AUTHORITY_REQUIRED");
              const user = invokeSource(readOriginalMainDshControl, undefined, [
                userSource,
                refs.userControlProof,
                owner,
                "policy_control",
                data.bodyHash,
              ]) as ReturnType<typeof readOriginalMainDshControl>;
              userLocal = user.assertLocal;
              const userRaw = invokeSource(userResolve, userSource, [
                refs.userControlProof,
                "policy_control",
              ]) as { data: unknown; assertCurrent: () => void };
              const intent = captureIpcData(userRaw.data) as DshARecord;
              dshAFields(intent, ["control", "expectedRevision"]);
              dshAFields(intent.control, ["kind", "setup"]);
              if (
                intent.control.kind !== "source_setup" ||
                ((intent.control as DshARecord).setup as DshARecord).setupId !==
                  data.setupId ||
                dshAJson(
                  ((intent.control as DshARecord).setup as DshARecord)
                    .candidateRepository,
                ) !== dshAJson(data.candidateRepository)
              )
                aFail("DSH_A_SOURCE_SETUP_INTENT_REQUIRED");
              const previous = guard;
              guard = () => {
                previous?.();
                invokeSource(user.assertCurrent, undefined, [], true);
                invokeSource(user.assertLocal, undefined, [], true);
                invokeSource(qualification.assertLocal, undefined, [], true);
                local();
              };
              guard();
              const row = get(
                "SELECT * FROM dsh_a_source_setups WHERE setup_id=?",
                [data.setupId],
              );
              if (!row || row.revision !== data.expectedConfigurationRevision)
                aFail("DSH_A_SOURCE_CONFIG_STALE");
              const stored = captureIpcData(
                aJsonParse(row.data_json as string),
              ) as DshARecord;
              if (
                row.body_hash !==
                  dshAHash([
                    "dsh-a-authority-row-v1",
                    "dsh_a_source_setups",
                    stored,
                  ]) ||
                dshAJson(
                  (stored.configuration as DshARecord).candidateRepository,
                ) !== dshAJson(data.candidateRepository)
              )
                aFail("DSH_A_SOURCE_CONFIG_CONFLICT");
              scopeId = row.scope_id as string;
              configuration = stored.configuration as DshARecord;
              configurationRevision = row.revision as number;
              const domainRow = get(
                "SELECT * FROM dsh_a_domains WHERE scope_id=?",
                [scopeId],
              );
              if (
                !domainRow ||
                domainRow.profile_id !== user.storageScope.profileId ||
                domainRow.workspace_id !== user.storageScope.workspaceId ||
                domainRow.principal_id !== user.principalId
              )
                aFail("DSH_A_SOURCE_CONFIG_SCOPE");
              domain = captureIpcData(
                aJsonParse(domainRow.data_json as string),
              ) as DshARecord;
            } else {
              dshAFields(data, ["bindingId", "configurationRevision"]);
              const head = get(
                "SELECT revision FROM dsh_a_source_configuration_heads WHERE binding_id=?",
                [data.bindingId],
              );
              if (!head || head.revision !== data.configurationRevision)
                aFail("DSH_A_SOURCE_CONFIG_STALE");
              const row = get(
                "SELECT * FROM dsh_a_source_configurations WHERE binding_id=? AND revision=?",
                [data.bindingId, head.revision],
              );
              if (!row) aFail("DSH_A_SOURCE_CONFIG_REQUIRED");
              const stored = captureIpcData(
                aJsonParse(row.data_json as string),
              ) as DshARecord;
              if (
                row.body_hash !==
                dshAHash([
                  "dsh-a-authority-row-v1",
                  "dsh_a_source_configurations",
                  stored,
                ])
              )
                aFail("DSH_A_SOURCE_CONFIG_CONFLICT");
              scopeId = row.scope_id as string;
              configuration = parseDshSourceConfiguration(stored.configuration);
              configurationRevision = head.revision as number;
              bindingRow = readData(
                "dsh_a_source_bindings",
                "binding_id",
                data.bindingId as string,
              );
              if (
                !bindingRow ||
                bindingRow.status !== "active" ||
                dshAJson(bindingRow.binding) !== dshAJson(configuration.binding)
              )
                aFail("DSH_A_SOURCE_BINDING_CLOSED");
              const domainRow = get(
                "SELECT * FROM dsh_a_domains WHERE scope_id=?",
                [scopeId],
              );
              if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
              domain = captureIpcData(
                aJsonParse(domainRow.data_json as string),
              ) as DshARecord;
            }
            if (configuration.mode === "off") aFail("DSH_A_SOURCE_DISABLED");
            const scope = domain.storageScope as DshARecord;
            const identities =
              purpose === "source_binding"
                ? dshSourceReadScopes(scope, configuration)
                : [
                    {
                      identity: { kind: "global" },
                      scopeKey: dshSourceScopeKey(scope, { kind: "global" }),
                    },
                    {
                      identity: {
                        kind: "tenant",
                        tenantId: configuration.tenantId,
                      },
                      scopeKey: dshSourceScopeKey(scope, {
                        kind: "tenant",
                        tenantId: configuration.tenantId,
                      }),
                    },
                    {
                      identity: {
                        kind: "workspace",
                        tenantId: configuration.tenantId,
                        workspaceId: scope.workspaceId,
                      },
                      scopeKey: dshSourceScopeKey(scope, {
                        kind: "workspace",
                        tenantId: configuration.tenantId,
                        workspaceId: scope.workspaceId,
                      }),
                    },
                  ];
            const guards: DshARecord[] = [],
              revisions: DshARecord[] = [];
            let mode = configuration.mode;
            for (let i = 0; i < identities.length; i++) {
              const identity = identities[i]!,
                controlId = dshSourceModeId(identity.scopeKey as string);
              const row = get(
                "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND control_id=?",
                [scopeId, controlId],
              );
              if (!row) aFail("DSH_A_SOURCE_BASELINE_UNCONFIRMED");
              const value = captureIpcData(
                aJsonParse(row.data_json as string),
              ) as DshARecord;
              if (
                row.body_hash !==
                  dshAHash([
                    "dsh-a-authority-row-v1",
                    "dsh_a_control_heads",
                    value,
                  ]) ||
                value.scopeKey !== identity.scopeKey ||
                value.axis !== "mode" ||
                value.epoch !== row.epoch ||
                value.revision !== row.revision
              )
                aFail("DSH_A_SOURCE_BASELINE_CONFLICT");
              if ((value.value as DshARecord).mode === "off")
                aFail("DSH_A_SOURCE_DISABLED");
              if ((value.value as DshARecord).mode === "observe")
                mode = "observe";
              aPush(guards, {
                scopeKey: identity.scopeKey,
                epoch: value.epoch,
              });
              aPush(revisions, {
                scopeKey: identity.scopeKey,
                epoch: value.epoch,
                revision: value.revision,
              });
            }
            guard?.();
            invokeSource(qualification.assertLocal, undefined, [], true);
            const common = {
              schemaVersion: 1,
              kind: purpose,
              profileId: scope.profileId,
              workspaceId: scope.workspaceId,
              tenantId:
                purpose === "source_setup"
                  ? configuration.tenantId
                  : (
                      (configuration.binding as DshARecord)
                        .authScope as DshARecord
                    ).tenantId,
              accountId: configuration.accountId,
              mode,
              configurationRevision,
              prefixModeGuardsHash: dshAHash(guards),
              guardRevisions: revisions,
              minimumIntervalMs: configuration.minimumIntervalMs,
            };
            if (purpose === "source_setup")
              return {
                ...common,
                setupId: configuration.setupId,
                candidateRepository: configuration.candidateRepository,
              };
            const binding = configuration.binding as DshARecord,
              auth = binding.authScope as DshARecord;
            return {
              ...common,
              selection: configuration.selection,
              candidateIssueRefs: configuration.issueRefs,
              verifiedIssueRefs: [],
              authScope: auth,
              sourceBindingId: binding.bindingId,
              credentialEpoch: auth.credentialEpoch,
              providerAccountId: auth.providerAccountId,
              repository: configuration.repository,
              sourceBindingRevision: bindingRow!.revision,
              sourceBindingVersion: binding.sourceBindingVersion,
              actorMappingVersion: binding.roleMappingVersion,
              provenanceVersion: binding.provenanceVersion,
            };
          },
          "snapshot",
        ) as DshARecord;
      const data = aFreezeData(read()),
        revision = sourceAuthorizationRevision;
      const assertLocal = () => {
        pureLocal();
        nativeLocal?.();
        if (userLocal) invokeSource(userLocal, undefined, [], true);
        if (sourceAuthorizationRevision !== revision)
          aFail("DSH_A_SOURCE_AUTHORITY_STALE");
      };
      const assertCurrent = () => {
        assertLocal();
        const current = read();
        if (dshAJson(current) !== dshAJson(data))
          aFail("DSH_A_SOURCE_AUTHORITY_STALE");
        assertLocal();
      };
      return aFreeze({ ...data, assertCurrent, assertLocal });
    },
    assertAssessmentExecution(realm: unknown, attemptId: string) {
      const request = this.readAssessmentRequest(realm, attemptId);
      body(
        { attemptId },
        "read_assessment",
        { requestSource: "scheduler", bootstrapAuthority: realm },
        () => {
          request.assertLocal();
          const domain = get(
            "SELECT state FROM dsh_a_domains WHERE profile_id=? AND workspace_id=?",
            [request.storageScope.profileId, request.storageScope.workspaceId],
          );
          if (!domain || domain.state !== "active")
            aFail("DSH_A_AUTHORITY_UNCONFIRMED");
          const document = request.mandate;
          if (
            document.status !== "active" ||
            document.revision !== request.mandateRevision ||
            document.authorizationEpoch !== request.authorizationEpoch
          )
            aFail("DSH_A_MANDATE_UNCONFIRMED");
          if (!budgetBinding) aFail("DSH_A_BUDGET_BINDING_REQUIRED");
          const baseline = currentAdmissionBaseline(
            ((request.input.envelope as DshARecord).thread as DshARecord)
              .sourceBindingId as string,
            request.mandateId,
          );
          if (
            baseline.mandate.revision !== request.mandateRevision ||
            baseline.mandate.authorizationEpoch !== request.authorizationEpoch
          )
            aFail("DSH_A_MANDATE_UNCONFIRMED");
          if (
            baseline.egress.enabled !== true ||
            baseline.egress.policyRef !== request.dataEgressPolicyRef
          )
            aFail("DSH_A_EGRESS_REQUIRED");
          let model = false,
            admission = false;
          for (
            let i = 0;
            i < (baseline.egress.modelIds as string[]).length;
            i++
          )
            if ((baseline.egress.modelIds as string[])[i] === request.modelId)
              model = true;
          for (
            let i = 0;
            i < (baseline.egress.purposes as string[]).length;
            i++
          )
            if ((baseline.egress.purposes as string[])[i] === request.purpose)
              admission = true;
          if (!model || !admission) aFail("DSH_A_EGRESS_REQUIRED");
          const clock = invokeSource(readOriginalMainDshClock, undefined, [
            realm,
            owner,
            source,
          ]) as ReturnType<typeof readOriginalMainDshClock>;
          if (
            clock.projection.state !== "verified" ||
            clock.projection.nowMs >= request.validUntil ||
            clock.projection.nowMs >= request.deadline
          )
            aFail("DSH_A_TIME_UNCONFIRMED");
          const envelope = request.input.envelope as DshARecord,
            proof = request.proof as DshARecord,
            actor = proof.actorEvidence as DshARecord;
          if (
            (envelope.kind !== "created" && envelope.kind !== "edited") ||
            actor.kind === "unknown" ||
            typeof actor.triggerActorId !== "string" ||
            dshAJson(proof.authScope) !==
              dshAJson((baseline.configuration.binding as DshARecord).authScope)
          )
            aFail("DSH_A_SOURCE_PROOF_UNCONFIRMED");
          let allowedActor = false,
            readAction = false,
            modelAction = false;
          for (
            let i = 0;
            i < baseline.mandate.allowedActorProviderIds.length;
            i++
          )
            if (
              baseline.mandate.allowedActorProviderIds[i] ===
              actor.triggerActorId
            )
              allowedActor = true;
          for (let i = 0; i < baseline.mandate.allowedActions.length; i++) {
            if (baseline.mandate.allowedActions[i] === "source.read")
              readAction = true;
            if (baseline.mandate.allowedActions[i] === "model.process_source")
              modelAction = true;
          }
          if (!allowedActor || !readAction || !modelAction)
            aFail("DSH_A_MANDATE_ACTION_UNAVAILABLE");
          const storedWindow = get(
            "SELECT * FROM dsh_a_windows WHERE scope_id=? AND source_binding_id=? AND prefix_mode_hash=?",
            [
              baseline.domainRow.scope_id,
              baseline.mandate.sourceBindingId,
              baseline.prefixModeHash,
            ],
          );
          if (!storedWindow) aFail("DSH_A_WINDOW_UNCONFIRMED");
          const acceptedWindow = authorityBody("dsh_a_windows", storedWindow),
            window = acceptedWindow.window as DshARecord;
          if (
            acceptedWindow.clockDomain !== clock.projection.domainId ||
            acceptedWindow.clockEpoch !== clock.projection.qualificationEpoch ||
            acceptedWindow.configurationRevision !==
              baseline.configurationRow.revision ||
            acceptedWindow.mandateRevision !== baseline.mandate.revision ||
            !envelope.providerOccurredAt ||
            !envelope.providerTimeEvidenceRef ||
            instantMs(envelope.providerOccurredAt as string) <=
              instantMs(window.effectiveAt as string) ||
            instantMs(envelope.providerOccurredAt as string) >
              clock.projection.nowMs
          )
            aFail("DSH_A_FRESHNESS_UNCONFIRMED");
          invokeSource(
            assertOriginalMainDshPhysicalCompositionCached,
            undefined,
            [realm, owner, budgetBinding.runtime, budgetBinding.source],
          );
          invokeSource(clock.assertLocal, undefined, [], true);
          request.assertLocal();
          return { ok: true };
        },
        "snapshot",
      );
    },
    readDraftBody(
      realm: unknown,
      claim: object,
      slotDelivery: object,
    ): DshDraftSourceBodyView {
      const member = aApply(aWG, commandClaims, [claim]) as
        | { realm: unknown; view: DshClaimedCommandView }
        | undefined;
      if (
        !member ||
        member.realm !== realm ||
        member.view.operation !== "prepare_dsh_slot" ||
        member.view.command.action !== "prepare_draft"
      )
        aFail("DSH_A_ORIGINAL_DRAFT_CLAIM_REQUIRED");
      local();
      const root = {};
      pending.add(root);
      try {
        if (!budgetBinding || !ownerBinding)
          aFail("DSH_A_OWNER_BINDING_REQUIRED");
        const original = invokeSource(readOriginalMainDshDraftSlot, undefined, [
          slotDelivery,
          realm,
          owner,
          claim,
        ]) as ReturnType<typeof readOriginalMainDshDraftSlot>;
        if (
          original.runtime !== budgetBinding.runtime ||
          original.budgetSource !== budgetBinding.source ||
          dshAJson(original.command) !== dshAJson(member.view.command)
        )
          aFail("DSH_A_DRAFT_SLOT_CONFLICT");
        invokeSource(original.assertKnown, undefined, [], true);
        let warm: (typeof warmCommandAuthorities)[number] | undefined;
        for (let i = 0; i < warmCommandAuthorities.length; i++)
          if (warmCommandAuthorities[i]!.commandId === member.view.commandId)
            warm = warmCommandAuthorities[i];
        if (!warm || !member.view.budgetReservation)
          aFail("DSH_A_ORIGINAL_DRAFT_CLAIM_REQUIRED");
        const command = member.view.command,
          revision = authorizationRevision;
        let nativeLocal: (() => void) | undefined;
        const read = () => {
          // Semantic current deliberately excludes the consumed command budget
          // proof and the already leased delivery CAS.
          warm!.current();
          return body(
            { commandId: command.commandId },
            "read_draft_body",
            { requestSource: "scheduler", bootstrapAuthority: realm },
            () => {
              requireProfile();
              invokeSource(original.assertKnown, undefined, [], true);
              const native = invokeSource(
                readOriginalMainDshBootstrapAuthority,
                undefined,
                [realm, owner, source],
              ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
              nativeLocal = native.assertLocal;
              const row = get(
                "SELECT * FROM dsh_a_command_outbox WHERE command_id=?",
                [command.commandId],
              );
              if (
                !row ||
                dshAJson(authorityBody("dsh_a_command_outbox", row).command) !==
                  dshAJson(command)
              )
                aFail("DSH_A_COMMAND_CONFLICT");
              const sourceBindingId = (command.thread as DshARecord)
                  .sourceBindingId,
                mandateId = command.mandateId;
              if (
                typeof sourceBindingId !== "string" ||
                typeof mandateId !== "string"
              )
                aFail("DSH_A_SCOPE_CONFLICT");
              const baseline = currentAdmissionBaseline(
                sourceBindingId,
                mandateId,
              );
              if (
                baseline.domain.state !== "active" ||
                baseline.mandate.revision !== command.mandateRevision ||
                baseline.mandate.authorizationEpoch !==
                  command.authorizationEpoch
              )
                aFail("DSH_A_WORK_AUTHORITY_CHANGED");
              const registered = get(
                "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? AND owner_domain=?",
                [row.scope_id, row.target_domain],
              );
              if (!registered) aFail("DSH_A_OWNER_DOMAIN_REQUIRED");
              const registration = authorityBody(
                "dsh_a_owner_domains",
                registered,
              );
              const output = captureIpcData(
                  original.observation.output,
                ) as DshARecord,
                slot = output.slot as DshARecord,
                manifest = output.inputManifest as DshARecord;
              if (
                output.ok !== true ||
                original.observation.operation !== "read_dsh_slot" ||
                !slot ||
                !manifest ||
                slot.kind !== "dsh_draft_slot" ||
                slot.writerStoreId !== registration.storeId ||
                slot.projectId !== command.targetWorkId ||
                slot.inputSetRevision !== command.inputSetRevision ||
                slot.assessmentHash !== command.assessmentHash ||
                slot.executionProfile !== command.executionProfile ||
                slot.state !== "prepared"
              )
                aFail("DSH_A_DRAFT_SLOT_CONFLICT");
              const slotPlain = captureIpcData(slot) as DshARecord;
              delete slotPlain.recordDigest;
              if (
                slot.recordDigest !== dshAHash(["dsh-record-v1", slotPlain]) ||
                dshAJson(slot.scope) !== dshAJson(command.scope)
              )
                aFail("DSH_A_DRAFT_SLOT_CONFLICT");
              const acceptedSlotRow = get(
                "SELECT * FROM dsh_a_owner_receipts WHERE scope_id=? AND command_id=?",
                [row.scope_id, command.commandId],
              );
              if (!acceptedSlotRow) aFail("DSH_A_OWNER_RECEIPT_REQUIRED");
              const acceptedSlot = authorityBody(
                  "dsh_a_owner_receipts",
                  acceptedSlotRow,
                ),
                slotReceipt = acceptedSlot.receipt as DshARecord;
              if (
                slotReceipt.result !== "applied" ||
                slotReceipt.slotId !== slot.id ||
                slotReceipt.operationKey !== command.operationKey ||
                !aInteger(slotReceipt.ownerVersion)
              )
                aFail("DSH_A_DRAFT_SLOT_CONFLICT");
              const core = captureIpcData(manifest) as DshARecord;
              delete core.manifestHash;
              if (
                manifest.manifestHash !==
                  dshAHash(["dsh-input-manifest-v1", core]) ||
                manifest.bindingId !== command.bindingId ||
                manifest.inputSetRevision !== command.inputSetRevision ||
                manifest.triggerAssessmentHash !== command.assessmentHash
              )
                aFail("DSH_A_DRAFT_MANIFEST_CONFLICT");
              const entries = manifest.entries as DshARecord[],
                expected = (
                  (command.evidence as DshARecord).manifest as DshARecord
                ).entries as DshARecord[];
              if (!aArray(entries) || entries.length !== expected.length)
                aFail("DSH_A_DRAFT_MANIFEST_CONFLICT");
              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i]!,
                  copy = captureIpcData(entry) as DshARecord;
                delete copy.admissionEvidenceManifestHash;
                if (dshAJson(copy) !== dshAJson(expected[i]))
                  aFail("DSH_A_DRAFT_MANIFEST_CONFLICT");
                const consumed = all(
                  "SELECT o.* FROM dsh_a_command_outbox o JOIN dsh_a_owner_receipts r ON r.scope_id=o.scope_id AND r.command_id=o.command_id WHERE o.scope_id=? AND o.binding_id=? AND o.input_id=?",
                  [row.scope_id, command.bindingId, entry.inputId],
                );
                let matched = false;
                for (let j = 0; j < consumed.length; j++) {
                  const accepted = authorityBody(
                    "dsh_a_command_outbox",
                    consumed[j]!,
                  ).command as DshARecord;
                  if (
                    (accepted.action === "create_draft_work" ||
                      accepted.action === "append_input") &&
                    accepted.evidenceManifestHash ===
                      entry.admissionEvidenceManifestHash
                  )
                    matched = true;
                }
                if (!matched) aFail("DSH_A_INPUT_NOT_CONSUMED");
              }
              const bodies = sourceBodies(manifest),
                policy = baseline.egress;
              let draftAllowed = false;
              for (let i = 0; i < (policy.purposes as string[]).length; i++)
                if ((policy.purposes as string[])[i] === "draft")
                  draftAllowed = true;
              if (!draftAllowed || policy.enabled !== true)
                aFail("DSH_A_EGRESS_REQUIRED");
              invokeSource(
                assertOriginalMainDshPhysicalCompositionCached,
                undefined,
                [realm, owner, budgetBinding!.runtime, budgetBinding!.source],
              );
              return {
                command,
                slot,
                inputManifest: manifest,
                bodies,
                storageScope: command.scope,
                tenantId: (command.thread as DshARecord).tenantId,
                mandateId: command.mandateId,
                mandateRevision: command.mandateRevision,
                authorizationEpoch: command.authorizationEpoch,
                budgetAuthorityHash: dshAHash([
                  "dsh-a-budget-authority-v1",
                  {
                    storageScope: baseline.domain.storageScope,
                    principalId: baseline.domain.principalId,
                    authorityId: baseline.domain.authorityId,
                    authorityEpoch: baseline.domain.authorityEpoch,
                  },
                ]),
                accountId: baseline.mandate.budgetRef,
                ownerVersion: slotReceipt.ownerVersion,
                modelId: (policy.modelIds as string[])[0],
                provider: policy.provider,
                destinationRef: policy.destinationRef,
                dataEgressPolicyRef: policy.policyRef,
                validUntil: instantMs(policy.validUntil as string),
                deadline: instantMs(command.executionDeadline as string),
              };
            },
            "snapshot",
          ) as Omit<
            DshDraftSourceBodyView,
            "budgetReservation" | "assertCurrent" | "assertLocal"
          >;
        };
        const snapshot = aFreezeData(read());
        const assertLocal = () => {
          pureLocal();
          nativeLocal?.();
          budgetBinding!.binding.assertLocal();
          original.assertKnown();
          if (authorizationRevision !== revision)
            aFail("DSH_A_DRAFT_AUTHORITY_STALE");
        };
        const assertCurrent = () => {
          assertLocal();
          if (dshAJson(read()) !== dshAJson(snapshot))
            aFail("DSH_A_DRAFT_AUTHORITY_STALE");
          assertLocal();
        };
        return aFreeze({
          ...snapshot,
          budgetReservation: member.view.budgetReservation,
          assertCurrent,
          assertLocal,
        });
      } finally {
        pending.delete(root);
        wake();
      }
    },
    readAssessmentBody(realm: unknown, attemptId: string) {
      this.assertAssessmentExecution(realm, attemptId);
      const request = this.readAssessmentRequest(realm, attemptId);
      return body(
        { attemptId },
        "read_assessment",
        { requestSource: "scheduler", bootstrapAuthority: realm },
        () => {
          request.assertLocal();
          const rows = sourceBodies(request.evidenceManifest as DshARecord);
          request.assertLocal();
          return rows;
        },
        "snapshot",
      ) as readonly Readonly<{
        inputId: string;
        snapshotRef: string;
        objectKind: string;
        objectId: string;
        providerRevision: string;
        contentHash: string;
        title: string | null;
        body: string | null;
      }>[];
    },
    readAssessmentRequest(
      realm: unknown,
      attemptId: string,
    ): DshAssessmentRequestView {
      let assessmentLocal: (() => void) | undefined;
      let snapshot: DshARecord;
      const read = () =>
        body(
          { attemptId },
          "read_assessment",
          { requestSource: "scheduler", bootstrapAuthority: realm },
          () => {
            const qualification = invokeSource(
              readOriginalMainDshBootstrapAuthority,
              undefined,
              [realm, owner, source],
            ) as ReturnType<typeof readOriginalMainDshBootstrapAuthority>;
            assessmentLocal = qualification.assertLocal;
            requireProfile();
            if (
              typeof attemptId !== "string" ||
              !attemptId ||
              attemptId.length > 256
            )
              aFail("DSH_A_ASSESSMENT_NOT_FOUND");
            const row = get(
              "SELECT * FROM dsh_a_assessment_attempts WHERE attempt_id=?",
              [attemptId],
            );
            if (!row) aFail("DSH_A_ASSESSMENT_NOT_FOUND");
            const attempt = authorityBody("dsh_a_assessment_attempts", row);
            if (
              row.body_hash !==
                dshAHash([
                  "dsh-a-authority-row-v1",
                  "dsh_a_assessment_attempts",
                  attempt,
                ]) ||
              attempt.attemptId !== attemptId
            )
              aFail("DSH_A_ASSESSMENT_CONFLICT");
            const domainRow = get(
              "SELECT * FROM dsh_a_domains WHERE scope_id=?",
              [row.scope_id],
            );
            if (!domainRow) aFail("DSH_A_DOMAIN_REQUIRED");
            const domain = captureIpcData(
              aJsonParse(domainRow.data_json as string),
            ) as DshARecord;
            const mandateRow = get(
              "SELECT * FROM dsh_a_mandates WHERE scope_id=? AND mandate_id=? AND mandate_revision=?",
              [row.scope_id, row.mandate_id, row.mandate_revision],
            );
            if (!mandateRow) aFail("DSH_A_MANDATE_REQUIRED");
            const storedMandate = authorityBody("dsh_a_mandates", mandateRow);
            const mandate = (storedMandate.projection as DshARecord)
              .document as DshARecord;
            const input = readData(
              "dsh_a_inbox",
              "input_id",
              row.input_id as string,
            );
            if (!input) aFail("DSH_A_INPUT_NOT_FOUND");
            const proofRow = get(
              "SELECT proof_hash,data_json FROM dsh_a_input_proofs WHERE input_id=? AND proof_version=?",
              [row.input_id, row.proof_version],
            );
            if (!proofRow) aFail("DSH_A_PROOF_NOT_FOUND");
            const proof = captureIpcData(
              aJsonParse(proofRow.data_json as string),
            ) as DshARecord;
            validateDshAStoredBody("dsh_a_input_proofs", proof);
            if (proofRow.proof_hash !== dshAHash(proof))
              aFail("DSH_A_PROOF_CONFLICT");
            const envelope = input.envelope as DshARecord,
              objectHead = readData(
                "dsh_a_object_heads",
                "object_id",
                dshSourceObjectIdentity(dshAObservation(envelope)),
              );
            if (!objectHead || (objectHead.state as DshARecord).freeze !== null)
              aFail("DSH_A_INPUT_NOT_CURRENT");
            const current = (objectHead.state as DshARecord)
              .current as DshARecord;
            if (
              !current ||
              current.providerRevision !== envelope.providerRevision ||
              current.contentHash !== envelope.contentHash
            )
              aFail("DSH_A_INPUT_NOT_CURRENT");
            const refs: string[] = [];
            if (Array.isArray(attempt.sourceSnapshotRefs))
              for (let i = 0; i < attempt.sourceSnapshotRefs.length; i++) {
                if (typeof attempt.sourceSnapshotRefs[i] !== "string")
                  aFail("DSH_A_ASSESSMENT_CONFLICT");
                aPush(refs, attempt.sourceSnapshotRefs[i]);
              }
            else aFail("DSH_A_SOURCE_CONTENT_REQUIRED");
            if (!attempt.modelPolicy || !attempt.evidenceManifest)
              aFail("DSH_A_ASSESSMENT_CONFLICT");
            const policy = attempt.modelPolicy as DshARecord,
              manifest = attempt.evidenceManifest as DshARecord;
            for (const key of [
              "operationKey",
              "semanticPayloadHash",
              "maxAttempts",
              "deadline",
              "validUntil",
              "purpose",
              "evidenceRefs",
            ])
              if (!aOwn(attempt, key)) aFail("DSH_A_ASSESSMENT_CONFLICT");
            return {
              schemaVersion: 1,
              kind: "dsh_assessment_request_v1",
              attemptId,
              tenantId: (envelope.authScope as DshARecord).tenantId,
              mandateId: mandate.mandateId,
              mandateRevision: mandate.revision,
              authorizationEpoch: mandate.authorizationEpoch,
              inputId: row.input_id,
              evidenceManifestHash: manifest.manifestHash,
              modelId: policy.modelId,
              promptVersion: policy.promptVersion,
              ruleVersion: policy.ruleVersion,
              dataEgressPolicyRef: mandate.dataEgressPolicyRef,
              validUntil: attempt.validUntil,
              assessmentVersion: row.assessment_version,
              purpose: attempt.purpose,
              operationKey: attempt.operationKey,
              semanticPayloadHash: attempt.semanticPayloadHash,
              maxAttempts: attempt.maxAttempts,
              deadline: attempt.deadline,
              evidenceRefs: attempt.evidenceRefs,
              storageScope: domain.storageScope,
              principalId: domain.principalId,
              authorityId: domain.authorityId,
              authorityEpoch: domain.authorityEpoch,
              budgetAuthorityHash: dshAHash([
                "dsh-a-budget-authority-v1",
                {
                  storageScope: domain.storageScope,
                  principalId: domain.principalId,
                  authorityId: domain.authorityId,
                  authorityEpoch: domain.authorityEpoch,
                },
              ]),
              accountId: mandate.budgetRef,
              mandate,
              attempt,
              input,
              proof,
              evidenceManifest: attempt.evidenceManifest,
              model: {
                ...(attempt.modelPolicy as DshARecord),
                dataEgressPolicyRef: mandate.dataEgressPolicyRef,
              },
              sourceSnapshotRefs: refs,
            };
          },
          "snapshot",
        ) as DshARecord;
      snapshot = aFreezeData(read());
      const version = authorizationRevision;
      const assertLocal = () => {
        pureLocal();
        if (assessmentLocal) invokeSource(assessmentLocal, undefined, [], true);
        if (authorizationRevision !== version) aFail("DSH_A_ASSESSMENT_STALE");
      };
      const assertCurrent = () => {
        assertLocal();
        if (dshAJson(read()) !== dshAJson(snapshot))
          aFail("DSH_A_ASSESSMENT_STALE");
        assertLocal();
      };
      return aFreeze({
        ...snapshot,
        assertCurrent,
        assertLocal,
      }) as unknown as DshAssessmentRequestView;
    },
    readDesktopState(realm: unknown, scope: unknown) {
      return body(
        scope as object,
        "read_domain",
        { requestSource: "scheduler", bootstrapAuthority: realm },
        (data) => {
          requireProfile();
          const storageScope = data as {
            profileId: string;
            workspaceId: string;
          };
          const floor = get(
            "SELECT store_id FROM dsh_a_profile WHERE singleton=1",
          )!;
          const scopeId = dshAHash([
            "dsh-a-domain-v1",
            floor.store_id,
            storageScope,
          ]);
          const domainRow = get(
            "SELECT * FROM dsh_a_domains WHERE scope_id=?",
            [scopeId],
          );
          const decode = (table: string, row: DshARecord) => {
            return authorityBody(
              table as Parameters<typeof authorityBody>[0],
              row,
            );
          };
          const domain = domainRow ? decode("dsh_a_domains", domainRow) : null;
          const sourceSetups: DshARecord[] = [],
            sourceConfigurations: DshARecord[] = [],
            modes: DshARecord[] = [],
            scopePolicies: DshARecord[] = [],
            sourceCheckpoints: DshARecord[] = [];
          if (domain) {
            const setups = all(
              "SELECT * FROM dsh_a_source_setups WHERE scope_id=? ORDER BY setup_id",
              [scopeId],
            );
            for (let i = 0; i < setups.length; i++)
              aPush(sourceSetups, decode("dsh_a_source_setups", setups[i]!));
            const configs = all(
              "SELECT c.* FROM dsh_a_source_configurations c JOIN dsh_a_source_configuration_heads h ON h.binding_id=c.binding_id AND h.revision=c.revision WHERE c.scope_id=? ORDER BY c.binding_id",
              [scopeId],
            );
            for (let i = 0; i < configs.length; i++)
              aPush(
                sourceConfigurations,
                decode("dsh_a_source_configurations", configs[i]!),
              );
            const controls = all(
              "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND record_kind='policy' AND axis_or_leaf='mode' ORDER BY scope_key",
              [scopeId],
            );
            for (let i = 0; i < controls.length; i++) {
              const head = decode("dsh_a_control_heads", controls[i]!),
                targets = all(
                  "SELECT owner_domain FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=?",
                  [scopeId, head.operationId],
                );
              let effective = targets.length > 0;
              for (let j = 0; j < targets.length; j++)
                if (
                  !get(
                    "SELECT receipt_id FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
                    [scopeId, head.operationId, targets[j]!.owner_domain],
                  )
                )
                  effective = false;
              aPush(modes, {
                ...head,
                status: effective
                  ? "effective"
                  : "accepted_pending_owner_fence",
              });
            }
          }
          if (domain) {
            const rows = all(
              "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND record_kind='policy' AND axis_or_leaf!='mode' ORDER BY scope_key,axis_or_leaf",
              [scopeId],
            );
            for (let i = 0; i < rows.length; i++) {
              const head = decode("dsh_a_control_heads", rows[i]!),
                targets = all(
                  "SELECT owner_domain FROM dsh_a_control_targets WHERE scope_id=? AND operation_id=?",
                  [scopeId, head.operationId],
                );
              let effective = targets.length > 0;
              for (let j = 0; j < targets.length; j++)
                if (
                  !get(
                    "SELECT receipt_id FROM dsh_a_control_domain_receipts WHERE scope_id=? AND operation_id=? AND owner_domain=?",
                    [scopeId, head.operationId, targets[j]!.owner_domain],
                  )
                )
                  effective = false;
              aPush(scopePolicies, {
                ...head,
                status: effective
                  ? "effective"
                  : "accepted_pending_owner_fence",
              });
            }
          }
          if (domain) {
            const checkpoints = all(
              "SELECT p.* FROM dsh_a_source_content_checkpoints p JOIN dsh_a_source_configuration_heads h ON h.binding_id=p.binding_id JOIN dsh_a_source_configurations c ON c.binding_id=h.binding_id AND c.revision=h.revision WHERE c.scope_id=?",
              [scopeId],
            );
            for (let i = 0; i < checkpoints.length; i++)
              aPush(sourceCheckpoints, sourceCheckpoint(checkpoints[i]!));
          }
          const ownerDomains: DshARecord[] = [],
            publishedMandates: DshARecord[] = [],
            egressPolicies: DshARecord[] = [];
          if (domain) {
            const owners = all(
              "SELECT * FROM dsh_a_owner_domains WHERE scope_id=? ORDER BY owner_domain",
              [scopeId],
            );
            for (let i = 0; i < owners.length; i++)
              aPush(
                ownerDomains,
                authorityBody("dsh_a_owner_domains", owners[i]!),
              );
            const docs = all(
              "SELECT m.*,h.revision head_revision FROM dsh_a_mandates m JOIN dsh_a_mandate_heads h ON h.scope_id=m.scope_id AND h.mandate_id=m.mandate_id AND h.mandate_revision=m.mandate_revision WHERE m.scope_id=? ORDER BY m.mandate_id",
              [scopeId],
            );
            for (let i = 0; i < docs.length; i++) {
              const value = authorityBody("dsh_a_mandates", docs[i]!);
              aPush(publishedMandates, {
                projection: value.projection,
                headRevision: docs[i]!.head_revision,
              });
            }
          }
          if (domain) {
            const rows = all(
              "SELECT * FROM dsh_a_control_heads WHERE scope_id=? AND record_kind='leaf' AND axis_or_leaf='egress' ORDER BY control_id",
              [scopeId],
            );
            for (let i = 0; i < rows.length; i++)
              aPush(egressPolicies, decode("dsh_a_control_heads", rows[i]!));
          }
          const pendingOwnerCommands: DshARecord[] = [];
          if (domain) {
            const deliveries = all(
              "SELECT d.* FROM dsh_a_control_delivery_heads d WHERE d.scope_id=? AND d.delivery_state IN ('pending','leased','unknown') ORDER BY d.operation_id,d.owner_domain",
              [scopeId],
            );
            for (let i = 0; i < deliveries.length; i++) {
              const row = deliveries[i]!,
                delivery = decode("dsh_a_control_delivery_heads", row);
              if (
                delivery.revision !== row.revision ||
                delivery.operationId !== row.operation_id ||
                delivery.ownerDomain !== row.owner_domain ||
                delivery.state !== row.delivery_state
              )
                aFail("DSH_A_GRAPH_CONFLICT");
              aPush(pendingOwnerCommands, {
                commandId: row.operation_id,
                ownerDomain: row.owner_domain,
                deliveryRevision: row.revision,
                operation: "apply_dsh_control",
                state:
                  row.delivery_state === "unknown"
                    ? "delivery_unknown"
                    : row.delivery_state,
                reconcileOnly: row.delivery_state !== "pending",
              });
            }
            const commands = all(
              "SELECT o.*,d.revision delivery_revision,d.delivery_state FROM dsh_a_command_outbox o JOIN dsh_a_delivery_heads d ON d.scope_id=o.scope_id AND d.command_id=o.command_id WHERE o.scope_id=? AND d.delivery_state IN ('pending','leased','unknown') ORDER BY o.command_id",
              [scopeId],
            );
            for (let i = 0; i < commands.length; i++) {
              const row = commands[i]!,
                outbox = decode("dsh_a_command_outbox", row),
                command = outbox.command as DshARecord;
              let warm = false;
              for (let j = 0; j < warmCommandAuthorities.length; j++)
                if (warmCommandAuthorities[j]!.commandId === row.command_id)
                  warm = true;
              aPush(pendingOwnerCommands, {
                commandId: row.command_id,
                ownerDomain: row.target_domain,
                deliveryRevision: row.delivery_revision,
                operation:
                  command.action === "prepare_draft"
                    ? "prepare_dsh_slot"
                    : "apply_dsh_command",
                state:
                  row.delivery_state === "unknown"
                    ? "delivery_unknown"
                    : row.delivery_state,
                reconcileOnly: row.delivery_state !== "pending" || !warm,
              });
            }
          }
          guard?.();
          return {
            schemaVersion: 1,
            storageScope,
            authority: domain,
            sourceSetups,
            sourceConfigurations,
            modes,
            scopePolicies,
            sourceCheckpoints,
            pendingOwnerCommands,
            authorizations: { ownerDomains, publishedMandates, egressPolicies },
            pendingBaseline: domain?.state === "pending_baseline",
            executionQualified: false,
          };
        },
        "snapshot",
      );
    },
    readDomainMetadata(realm: unknown, scope: unknown) {
      return body(
        scope as object,
        "read_domain",
        { requestSource: "scheduler", bootstrapAuthority: realm },
        (data) => {
          requireProfile();
          const storageScope = data as {
            profileId: string;
            workspaceId: string;
          };
          const floor = get(
            "SELECT store_id FROM dsh_a_profile WHERE singleton=1",
          )!;
          const scopeId = dshAHash([
            "dsh-a-domain-v1",
            floor.store_id,
            storageScope,
          ]);
          const row = get("SELECT * FROM dsh_a_domains WHERE scope_id=?", [
            scopeId,
          ]);
          if (!row) aFail("DSH_A_DOMAIN_REQUIRED");
          const domain = captureIpcData(
            aJsonParse(row.data_json as string),
          ) as DshARecord;
          if (
            row.profile_id !== storageScope.profileId ||
            row.workspace_id !== storageScope.workspaceId ||
            domain.scopeId !== scopeId ||
            dshAJson(domain.storageScope) !== dshAJson(storageScope) ||
            domain.principalId !== row.principal_id ||
            domain.authorityId !== row.authority_id ||
            domain.authorityEpoch !== row.authority_epoch ||
            domain.revision !== row.revision ||
            domain.state !== row.state ||
            row.body_hash !==
              dshAHash(["dsh-a-authority-row-v1", "dsh_a_domains", domain])
          )
            aFail("DSH_A_DOMAIN_CONFLICT");
          return aFreeze({
            schemaVersion: 1,
            kind: "main_dsh_domain_metadata",
            storageScope: aFreeze(storageScope),
            principalId: domain.principalId as string,
            authorityId: domain.authorityId as string,
            authorityEpoch: domain.authorityEpoch as number,
            revision: domain.revision as number,
            state: domain.state as string,
            budgetAuthorityHash: dshAHash([
              "dsh-a-budget-authority-v1",
              {
                storageScope,
                principalId: domain.principalId,
                authorityId: domain.authorityId,
                authorityEpoch: domain.authorityEpoch,
              },
            ]),
            budget: domain.budget,
          });
        },
        "snapshot",
      );
    },
    claim() {
      claimed = true;
    },
    revoke() {
      claimed = false;
    },
    close() {
      if (pending.size || unknown.size) aFail("DSH_A_SDK_BUSY");
      closed = true;
      claimed = false;
      syncCall(aClose, db, [], (v) => v === undefined, true);
    },
    exec,
    validateProfile() {
      syncCall(
        aFunction,
        db,
        [
          DSH_A_AUTHORITY_FUNCTION,
          { deterministic: true },
          () => DSH_A_AUTHORITY_DIGEST,
        ],
        (value) => value === undefined,
        true,
      );
      syncCall(
        aFunction,
        db,
        [
          DSH_A_AUTHORITY_OPERATION_FUNCTION,
          { deterministic: false },
          () => operationKind,
        ],
        (value) => value === undefined,
        true,
      );
      syncCall(
        aFunction,
        db,
        [DSH_A_FUNCTION, { deterministic: true }, () => DSH_A_DIGEST],
        (value) => value === undefined,
        true,
      );
    },
    abandon(error: unknown) {
      remember(error);
      closed = true;
      claimed = false;
      abandoned = true;
      aUnconfirmedOwners.add(owner);
      wake();
    },
  };
}

export class DesktopMultiAgentStore {
  private readonly db: AuthorityDatabase;
  readonly bootId: string;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly reserveBytes: number;
  private closed = false;
  private transactionDepth = 0;
  private readonly listeners = new Set<(event: MultiAgentDurableEvent) => void>();
  private pendingEvents: MultiAgentDurableEvent[] = [];
  private readonly committedEvents: MultiAgentDurableEvent[] = [];
  private publishing = false;
  private ownerClaimed = false;

  constructor(dbPath: string, options: { bootId?: string; now?: () => number; maxBytes?: number; reserveBytes?: number;dshAdmissionSource?:object|null;dshUserControlSource?:object|null;dshBudgetBinding?:{runtime:object;exactConstructorSource:object};dshOwnerBinding?:{service:object;exactAdmission:KSwarmDshAdmission} } = {}) {
    const source=admissionSource(options),userSource=aDescriptor(options,"dshUserControlSource")?admissionSource(options,"dshUserControlSource"):source,budgetBinding=admissionBudgetBinding(options),ownerBinding=admissionOwnerBinding(options);
    const databaseBundle=readOriginalMainDshAdmissionDatabase(source);
    this.bootId = options.bootId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
    this.reserveBytes = options.reserveBytes ?? 1024 * 1024;
    if (this.reserveBytes <= 0 || this.maxBytes <= this.reserveBytes) throw new Error('invalid multi-agent byte quota');
    if(!databaseBundle)assertOrdinarySourceWriterRoute();
    const bodies:KnownMultiAgentBodies={
      claimBootOwnership: (pid = process.pid):void => {
    if (this.ownerClaimed) return;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('multi_agent_owner_unknown');
    bodies.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM boot_owners WHERE boot_id=?').get(this.bootId)) throw new Error('multi_agent_owner_boot_collision');
      const missing = this.db.prepare(`SELECT 1 FROM groups g WHERE g.boot_id<>? AND NOT EXISTS(SELECT 1 FROM boot_owners b WHERE b.boot_id=g.boot_id)
        AND (EXISTS(SELECT 1 FROM agents a WHERE a.group_id=g.group_id AND (
          json_extract(a.data_json,'$.executionActive')=1 OR json_extract(a.data_json,'$.sessionResident')=1 OR json_extract(a.data_json,'$.runtimeResident')=1))
          OR EXISTS(SELECT 1 FROM managed_resources r WHERE r.group_id=g.group_id AND json_extract(r.data_json,'$.state') NOT IN ('released','retained_by_policy'))
          OR EXISTS(SELECT 1 FROM root_turns t WHERE t.group_id=g.group_id AND json_extract(t.data_json,'$.phase') NOT IN ('settled','abandoned'))) LIMIT 1`).get(this.bootId);
      if (missing) throw new Error('multi_agent_owner_unknown');
      let cursor = '';
      for (;;) {
        const owners = this.db.prepare("SELECT boot_id,owner_pid FROM boot_owners WHERE state='active' AND boot_id>? ORDER BY boot_id LIMIT 100")
          .all(cursor) as unknown as Array<{ boot_id: string; owner_pid: number }>;
        for (const owner of owners) {
          if (!Number.isSafeInteger(owner.owner_pid) || owner.owner_pid <= 0) throw new Error('multi_agent_owner_unknown');
          let exited = false;
          try { process.kill(owner.owner_pid, 0); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') exited = true; else throw new Error('multi_agent_owner_unknown', { cause: error }); }
          if (!exited) throw new Error('multi_agent_owner_live');
          this.db.prepare("UPDATE boot_owners SET state='exited' WHERE boot_id=? AND state='active'").run(owner.boot_id);
        }
        if (owners.length < 100) break;
        cursor = owners.at(-1)!.boot_id;
      }
      this.db.prepare("INSERT INTO boot_owners(boot_id,owner_pid,state) VALUES(?,?,'active')").run(this.bootId, pid);
    });
    this.ownerClaimed = true;aRead(this)?.claim();
  },
      settleBootOwnership: ():void => {
    aRead(this)?.revoke();if (this.ownerClaimed) this.db.prepare("UPDATE boot_owners SET state='quiesced' WHERE boot_id=? AND state='active'").run(this.bootId);
  },
      reconcileAgentResources: (groupId: string):void => {
    bodies.transaction(() => {
      const pending = new Map(this.resources(groupId).filter(resource => !['released', 'retained_by_policy'].includes(resource.state)).map(resource => [resource.agentId, resource]));
      for (const agent of this.allAgents(groupId)) {
        if (agent.executionActive || agent.sessionResident || agent.runtimeResident) throw new Error('multi_agent_resource_owner_live');
        const resource = pending.get(agent.id);
        bodies.putAgent(groupId, { ...agent, resourcesReleased: !resource, cleanupPending: Boolean(resource),
          ...(resource?.lastError ? { cleanupError: resource.lastError } : { cleanupError: undefined }) }, true);
      }
    });
  },
      transaction: <T>(action:(port:DesktopMultiAgentMutationPort)=>T):T => {
      const runAction=()=>{const accepted=createKnownMultiAgentPort(this);try{const result=action(accepted.port);assertKnownMultiAgentIntegrity(knownMultiAgentWriter(this));return result;}finally{accepted.seal();}};
    if (this.transactionDepth) return runAction();
    const writer=knownMultiAgentWriter(this);
    writer.transactionPhase='beginning';
    try { if(writer.admissionInvocation)writer.admissionInvocation.exec('BEGIN IMMEDIATE');else this.db.exec('BEGIN IMMEDIATE'); }
    finally { writer.transactionPhase=undefined; }
    this.transactionDepth += 1;
    let result!:T,commitAttempted=false;
    let events:MultiAgentDurableEvent[]=[];
    try {
      result = runAction();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('multi-agent transactions must be synchronous');
      assertKnownMultiAgentIntegrity(knownMultiAgentWriter(this));
      // The accepted callback port is already sealed. SDK reentry cannot join
      // this transaction once its body has finished.
      writer.transactionPhase='committing';commitAttempted=true;
      if(writer.admissionInvocation)writer.admissionInvocation.exec('COMMIT');else this.db.exec('COMMIT');
    } catch (primary) {
      const failure:KnownMultiAgentTransactionFailure={stage:commitAttempted?'commit':'rollback',primary,secondaryPresent:false};
      if(commitAttempted)writer.outcomeUnknown??=failure;
      writer.transactionPhase='rolling_back';
      try { if(writer.admissionInvocation)writer.admissionInvocation.exec('ROLLBACK');else this.db.exec('ROLLBACK'); }
      catch(secondary){failure.secondaryPresent=true;failure.secondary=secondary;writer.outcomeUnknown??=failure;}
      // A failed COMMIT return does not prove that COMMIT did not happen. A
      // secondary rollback error must never replace the original thrown value.
      throw primary;
    } finally {
      this.transactionDepth -= 1;
      events=this.pendingEvents;this.pendingEvents=[];
      writer.transactionPhase=undefined;
    }
    try {
      this.committedEvents.push(...events);this.publishCommitted();
    } catch(primary){
      // SQL is already committed. Notification failure cannot roll it back or
      // permit blind retry with a new business identity on this writer.
      writer.outcomeUnknown??={stage:'notification',primary,secondaryPresent:false};throw primary;
    }
    return result;
  },
      registerThread: (binding: MultiAgentThreadBinding):void => {
    const previous = this.getThread(binding.threadId);
    if (previous) {
      if (previous.profileId !== binding.profileId || previous.workspaceId !== binding.workspaceId || previous.cwd !== binding.cwd) throw new Error('thread ownership mismatch');
      return;
    }
    this.db.prepare('INSERT INTO thread_bindings(thread_id,profile_id,workspace_id,cwd,active_group_id,thread_revision) VALUES(?,?,?,?,NULL,0)')
      .run(binding.threadId, binding.profileId, binding.workspaceId, binding.cwd);
  },
      initializeWorkspaceAuthorization: (domain: { profileId: string; workspaceId: string }):WorkspaceExecutionAuthorizationRow => {
    const initial = captureWorkspaceAuthorization({ ...domain, permissionRevision: 0, executionAllowed: true, updatedAt: this.now(), actorId: null, lastReceiptJson: null });
    return bodies.transaction(() => {
      this.db.prepare('INSERT INTO workspace_execution_authorizations(profile_id,workspace_id,permission_revision,execution_allowed,updated_at,actor_id,last_receipt_json) VALUES(?,?,0,1,?,NULL,NULL) ON CONFLICT(profile_id,workspace_id) DO NOTHING')
        .run(initial.profileId, initial.workspaceId, initial.updatedAt);
      return this.readWorkspaceAuthorization(domain)!;
    });
  },
      compareAndSetWorkspaceAuthorization: (input: { profileId: string; workspaceId: string; expectedPermissionRevision: number; next: WorkspaceExecutionAuthorizationRow }):boolean => {
    boundedString(input.profileId); boundedString(input.workspaceId); safeInteger(input.expectedPermissionRevision);
    const next = captureWorkspaceAuthorization(input.next);
    if (next.profileId !== input.profileId || next.workspaceId !== input.workspaceId || next.permissionRevision !== input.expectedPermissionRevision + 1
      || !next.actorId || !next.lastReceiptJson) throw new Error('invalid workspace authorization CAS');
    const result = this.db.prepare('UPDATE workspace_execution_authorizations SET permission_revision=?,execution_allowed=?,updated_at=?,actor_id=?,last_receipt_json=? WHERE profile_id=? AND workspace_id=? AND permission_revision=?')
      .run(next.permissionRevision, Number(next.executionAllowed), next.updatedAt, next.actorId, next.lastReceiptJson, input.profileId, input.workspaceId, input.expectedPermissionRevision);
    return Number(result.changes) === 1;
  },
      beginThreadDeletion: (threadId: string,receipt: ThreadDeletionReceipt):void => {
    const data = encodeMultiAgentRow(receipt);
    if (Buffer.byteLength(data) > 4 * 1024) throw new Error('thread deletion receipt exceeds limit');
    const result = this.db.prepare("UPDATE thread_bindings SET delete_state='delete_pending',delete_json=?,thread_revision=thread_revision+1 WHERE thread_id=? AND thread_revision=? AND delete_state<>'deleted'")
      .run(data, threadId, receipt.expectedRevision);
    if (result.changes !== 1) throw new Error('stale thread deletion revision');
  },
      updateThreadDeletion: (threadId: string,operationId: string,result: MultiAgentControlResult):void => {
    const thread = this.getThread(threadId), receipt = thread?.deletionReceipt;
    if (!receipt || receipt.operationId !== operationId || thread?.deleteState === 'deleted') throw new Error('stale thread deletion operation');
    const data = encodeMultiAgentRow({ ...receipt, result });
    if (Buffer.byteLength(data) > 4 * 1024) throw new Error('thread deletion receipt exceeds limit');
    this.db.prepare('UPDATE thread_bindings SET delete_json=? WHERE thread_id=?').run(data, threadId);
  },
      deleteThreadHistory: (threadId: string,operationId: string):void => {
    bodies.transaction(() => {
      const thread = this.getThread(threadId), receipt = thread?.deletionReceipt;
      if (thread?.deleteState !== 'delete_pending' || receipt?.operationId !== operationId) throw new Error('stale thread deletion operation');
      if (this.threadHasUnreleasedResources(threadId)) throw new Error('thread deletion cleanup pending');
      for (const table of ['activity_members', 'activity_runs', 'events', 'messages', 'operations', 'root_turns', 'managed_resources', 'contents', 'agents', 'groups'] as const) {
        this.db.prepare(`DELETE FROM ${table} WHERE group_id IN (SELECT group_id FROM groups WHERE thread_id=?)`).run(threadId);
      }
      const data = encodeMultiAgentRow({ ...receipt, result: { operationId, state: 'completed', resourcesReleased: true } });
      this.db.prepare("UPDATE thread_bindings SET active_group_id=NULL,delete_state='deleted',delete_json=?,pending_approval_count=0,thread_revision=thread_revision+1 WHERE thread_id=?").run(data, threadId);
    });
  },
      createGroup: (threadId: string,permissionRevision = 0):DesktopMultiAgentGroup => {
    safeInteger(permissionRevision);
    return bodies.transaction(() => {
      const thread = this.getThread(threadId);
      if (!thread) throw new Error('unknown thread');
      if (thread.deleteState !== 'none') throw new Error('thread deletion prevents new groups');
      if (thread.activeGroupId) throw new Error('thread already has an active group');
      const group: DesktopMultiAgentGroup = {
        groupId: randomUUID(), threadId, bootId: this.bootId, historicalOnly: false,
        createdAt: this.now(), lastSeq: 0, byteUsage: 0, currentRootEpoch: 0, nextRootEpoch: 0, mutationBlockedReason: null, permissionRevision,
      };
      bodies.putGroup(group);
      bodies.putAgent(group.groupId, { id: `root_${group.groupId}`, parentId: null, taskName: 'main', canonicalName: '/root', depth: 0, status: 'pending', turn: 0 });
      this.db.prepare('UPDATE thread_bindings SET active_group_id=?,thread_revision=thread_revision+1 WHERE thread_id=? AND active_group_id IS NULL').run(group.groupId, threadId);
      return this.requireGroup(group.groupId);
    });
  },
      putGroup: (group: DesktopMultiAgentGroup,control = false):void => {
    const { byteUsage: _counter, ...data } = group;
    bodies.write('groups', group.groupId, { group_id: group.groupId }, {
      thread_id: group.threadId, boot_id: group.bootId, historical_only: Number(group.historicalOnly), created_at: group.createdAt,
    }, data, control);
  },
      clearActiveGroup: (threadId: string,expectedGroupId: string):void => {
    this.db.prepare('UPDATE thread_bindings SET active_group_id=NULL,thread_revision=thread_revision+1 WHERE thread_id=? AND active_group_id=?').run(threadId, expectedGroupId);
  },
      putAgent: (groupId: string,input: Pick<DesktopAgentSnapshot, 'id' | 'parentId' | 'taskName' | 'canonicalName' | 'depth' | 'status' | 'turn'> & Partial<DesktopAgentSnapshot>,control = false):DesktopAgentSnapshot => {
    return bodies.transaction(() => {
    const previous = this.getAgent(groupId, input.id);
    const ordinal = input.parentId === null ? undefined : previous ? previous.presentationOrdinal
      : this.presentationForAgent(groupId,input.id) ?? this.nextPresentationOrdinal(groupId);
    if (ordinal !== undefined && (!Number.isSafeInteger(ordinal) || ordinal < 1)) throw new Error('invalid presentation ordinal');
    const agent: DesktopAgentSnapshot = {
      createdAt: this.now(), executionActive: false, sessionResident: false, runtimeResident: false,
      resourcesReleased: false, cleanupPending: false, resumable: false, stopState: 'none', closeReason: null,
      activationState: 'prepared', unreadMessages: 0, ...previous, ...input, presentationOrdinal: ordinal,
    };
    bodies.write('agents', groupId, { group_id: groupId, agent_id: input.id }, {
      parent_id: agent.parentId, created_at: agent.createdAt,
    }, agent, control);
    return agent;
    });
  },
      appendEvent: (groupId: string,input: { kind: MultiAgentEventKind; agentId: string; payload: Record<string, unknown>; turnId?: string }):MultiAgentDurableEvent => {
    const approval = input.kind === 'approval' ? captureApprovalEvent(input.payload) : undefined;
    if (approval) input = { ...input, payload: { ...approval } };
    return bodies.transaction(() => {
      const group = this.requireGroup(groupId);
      const event: MultiAgentDurableEvent = { schemaVersion: 1, channel: 'durable', ...input, groupId, seq: group.lastSeq + 1, eventId: randomUUID(), timestamp: this.now() };
      const control = input.kind === 'status' || input.kind === 'cleanup' || input.kind === 'delivery' || input.kind === 'activity_run' || Boolean(approval && approval.status !== 'pending');
      if (Buffer.byteLength(encodeMultiAgentRow(event)) > (control ? 4 * 1024 : 64 * 1024)) throw new Error('multi-agent event exceeds wire limit');
      bodies.write('events', groupId, { group_id: groupId, seq: event.seq }, { event_id: event.eventId, agent_id: event.agentId }, event, control);
      bodies.putGroup({ ...group, lastSeq: event.seq }, control);
      this.pendingEvents.push(event);
      return event;
    });
  },
      createActivityRun: (input: Pick<AgentActivityRun, 'runId' | 'groupId' | 'kind' | 'originId' | 'rootTaskId'>):AgentActivityRun => {
    return bodies.transaction(() => {
      this.assertWritable(input.groupId);
      const group = this.requireGroup(input.groupId);
      for (const value of [input.runId,input.originId]) boundedString(value);
      const previous = this.getActivityRun(input.runId);
      if (previous) {
        if (previous.groupId !== input.groupId || previous.originId !== input.originId || previous.kind !== input.kind || previous.rootTaskId !== input.rootTaskId) throw new Error('activity_run_conflict');
        return previous;
      }
      const run: AgentActivityRun = { ...input, threadId: group.threadId, bootId: this.bootId, state: 'accepted', acceptedAt: this.now(), startSequence: group.lastSeq };
      bodies.write('activity_runs', run.groupId, { run_id: run.runId }, { group_id: run.groupId }, run, false);
      bodies.appendEvent(run.groupId, { kind: 'activity_run', agentId: `root_${run.groupId}`, payload: { run } });
      return run;
    });
  },
      putActivityMember: (member: AgentActivityMember):void => {
    bodies.transaction(() => {
      const run = this.getActivityRun(member.runId);
      if (!run || run.groupId !== member.groupId || run.terminalEventId) throw new Error('activity_run_not_open');
      this.assertWritable(member.groupId, member.physicalSettled);
      for (const value of [member.memberId,member.agentId,member.operationId]) boundedString(value);
      const previous = this.getActivityMembers(member.runId).find(item => item.memberId === member.memberId);
      if (previous && (previous.operationId !== member.operationId || previous.agentId !== member.agentId || previous.turnId && member.turnId !== previous.turnId)) throw new Error('activity_member_conflict');
      if (previous?.physicalSettled && !member.physicalSettled) throw new Error('activity_member_already_settled');
      bodies.write('activity_members', member.groupId, { run_id: member.runId, member_id: member.memberId }, { group_id: member.groupId }, member, member.physicalSettled);
    });
  },
      confirmActivityRootTerminal: (runId: string,proof: NonNullable<AgentActivityRun['rootTerminal']>):void => {
    bodies.transaction(() => {
      const run = this.getActivityRun(runId);
      if (!run || run.kind !== 'root' || run.rootTaskId !== proof.taskId) throw new Error('activity_root_proof_mismatch');
      if (run.rootTerminal && encodeMultiAgentRow(run.rootTerminal) !== encodeMultiAgentRow(proof)) throw new Error('activity_root_proof_conflict');
      if (run.rootTerminal && !run.sourceUnavailable) return;
      const { sourceUnavailable: _unavailable, ...confirmed } = run;
      bodies.write('activity_runs', run.groupId, { run_id: runId }, { group_id: run.groupId }, { ...confirmed, rootTerminal: proof }, true);
    });
  },
      markActivityRunUnknown: (runId: string,code: string):void => {
    bodies.transaction(() => {
      const run = this.getActivityRun(runId);
      if (!run || run.terminalEventId || run.sourceUnavailable === code) return;
      boundedString(code);
      bodies.write('activity_runs', run.groupId, { run_id: runId }, { group_id: run.groupId }, { ...run, sourceUnavailable: code }, true);
      bodies.finalizeActivityRun(runId);
    });
  },
      finalizeActivityRun: (runId: string):AgentActivityRun | null => {
    return bodies.transaction(() => {
      const run = this.getActivityRun(runId);
      if (!run || run.terminalEventId) return run;
      const state = agentRunState(run, this.getActivityMembers(runId));
      const next = { ...run, state };
      if (state !== run.state || ['completed','failed','cancelled'].includes(state)) {
        const event = bodies.appendEvent(run.groupId, { kind: 'activity_run', agentId: `root_${run.groupId}`, payload: { run: next } });
        if (['completed','failed','cancelled'].includes(state)) next.terminalEventId = event.eventId;
      }
      bodies.write('activity_runs', run.groupId, { run_id: runId }, { group_id: run.groupId }, next, true);
      return next;
    });
  },
      sendMessage: (groupId: string,input: { sender: MultiAgentSender; receiverId: string; text: string; kind?: MultiAgentMessage['kind']; contentId?: string; truncated?: boolean;bodyUnavailable?:true },settlement = false):MultiAgentMessage => {
    return bodies.transaction(() => {
      if (settlement && (input.sender.kind !== 'agent' || input.kind !== 'result' && input.kind !== 'error')) throw new Error('invalid settlement handoff');
      this.assertWritable(groupId, settlement);
      if (!input.text.trim() || Buffer.byteLength(input.text) > 16 * 1024) throw new Error('message exceeds 16KiB or is empty');
      if (input.sender.kind !== 'agent' && input.sender.kind !== 'user') throw new Error('invalid sender kind');
      const identityKey = input.sender.kind === 'user' ? 'actorId' : 'agentId';
      const identity = (input.sender as unknown as Record<string, unknown>)[identityKey];
      if (typeof identity !== 'string' || !identity || Object.keys(input.sender).some(key => key !== 'kind' && key !== identityKey)) {
        throw new Error('invalid sender identity');
      }
      if (input.contentId && !this.readScoped<MultiAgentContent>('contents', groupId, 'content_id', input.contentId)) {
        throw new Error('unknown content or group mismatch');
      }
      const message: MultiAgentMessage = {
        messageId: randomUUID(), groupId, sender: input.sender, receiverId: input.receiverId,
        kind: input.kind ?? 'message', preview: input.text, contentId: input.contentId,...(input.bodyUnavailable?{bodyUnavailable:true as const}:{}),
        truncated: input.truncated ?? false, deliveryState: 'unread', claimId: null, turnId: null, createdAt: this.now(),
      };
      bodies.putMessage(message);
      bodies.appendEvent(groupId, { kind: 'message_sent', agentId: input.receiverId, payload: { message } });
      return message;
    });
  },
      rerouteClosedHandoffs: (groupId: string,agentId: string):void => {
    bodies.transaction(() => {
      this.assertWritable(groupId, true);
      const closed = this.getAgent(groupId, agentId);
      if (!closed || closed.status !== 'closed') throw new Error('handoff receiver is not closed');
      let receiver = closed;
      while (receiver.status === 'closed' && receiver.parentId) receiver = this.getAgent(groupId, receiver.parentId)!;
      if (receiver.status === 'closed') return;
      const ids = this.db.prepare("SELECT message_id FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state<>'context_applied' AND json_extract(data_json,'$.kind') IN ('result','error')")
        .all(groupId, agentId) as unknown as Array<{ message_id: string }>;
      for (const { message_id: id } of ids) {
        const old = this.readScoped<MultiAgentMessage>('messages', groupId, 'message_id', id)!;
        const message: MultiAgentMessage = { ...old, receiverId: receiver.id, originalReceiverId: old.originalReceiverId ?? old.receiverId,
          deliveryState: 'unread', claimId: null, turnId: null };
        bodies.putMessage(message);
        bodies.appendEvent(groupId, { kind: 'message_sent', agentId: receiver.id, payload: { message, rerouted: true } });
      }
    });
  },
      drainInput: (groupId: string,receiverId: string,turnId: string,maxBytes = 16 * 1024):MultiAgentDrainedBatch => {
    return bodies.transaction(() => {
      this.assertWritable(groupId);
      const batch: MultiAgentMessage[] = [];
      let bytes = 0;
      const unread = this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' ORDER BY created_at,rowid").iterate(groupId, receiverId);
      for (const row of unread) {
        const message = this.parse<MultiAgentMessage>(row as unknown as JsonRow);
        const next = Buffer.byteLength(message.preview);
        if (bytes + next > Math.min(maxBytes, 16 * 1024)) break;
        bytes += next;
        batch.push(message);
      }
      if (!batch.length) return { claimId: null, messages: [] };
      const claimId = randomUUID();
      for (const message of batch) bodies.putMessage({ ...message, deliveryState: 'consuming', claimId, turnId });
      return { claimId, messages: batch.map(message => ({ ...message, deliveryState: 'consuming', claimId, turnId })) };
    });
  },
      confirmApplied: (groupId: string,claimId: string,turnId: string):void => {
    bodies.transaction(() => {
      this.assertWritable(groupId);
      const messages = (this.db.prepare('SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND claim_id=? ORDER BY rowid').all(groupId, claimId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentMessage>(row));
      if (!messages.length || messages.some(message => message.turnId !== turnId || message.deliveryState === 'unread')) throw new Error('stale message claim or turn');
      for (const message of messages) {
        if (message.deliveryState === 'context_applied') continue;
        bodies.putMessage({ ...message, deliveryState: 'context_applied' });
        bodies.appendEvent(groupId, { kind: 'message_consumed', agentId: message.receiverId, turnId, payload: { messageId: message.messageId, deliveryState: 'context_applied' } });
      }
    });
  },
      returnClaim: (groupId: string,claimId: string,expectedTurnId?: string):void => {
    bodies.transaction(() => {
      const messages = (this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND claim_id=? AND delivery_state='consuming'").all(groupId, claimId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentMessage>(row));
      if (expectedTurnId && messages.some(message => message.turnId !== expectedTurnId)) throw new Error('stale message claim or turn');
      for (const message of messages) {
        bodies.putMessage({ ...message, deliveryState: 'unread', claimId: null, turnId: null }, true);
      }
    });
  },
      putContent: (groupId: string,agentId: string,text: string,settlement = false,unavailable?: {status: DesktopAgentSnapshot['status']}):MultiAgentContent => {
    this.assertWritable(groupId, settlement);
    const clipped = truncateMultiAgentText(text, MAX_CONTENT_BYTES);
    const bytes = Buffer.from(clipped.text, 'utf8');
    const content: MultiAgentContent = { contentId: randomUUID(), groupId, agentId, utf8Text: clipped.text, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), truncated: clipped.truncated,...(unavailable?{bodyUnavailable:true as const,status:unavailable.status}:{}) };
    bodies.write('contents', groupId, { content_id: content.contentId }, { group_id: groupId, agent_id: agentId }, content, false);
    return content;
  },
      deleteUnreferencedContent: (groupId: string,contentId: string):void => {
    bodies.transaction(() => {
      this.assertWritable(groupId);
      const content = this.readOne<MultiAgentContent>('contents', 'content_id', contentId);
      if (!content) return;
      if (content.groupId !== groupId) throw new Error('content group mismatch');
      const referenced = this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND json_extract(data_json,'$.contentId')=? UNION ALL SELECT 1 FROM agents WHERE group_id=? AND json_extract(data_json,'$.resultContentId')=? UNION ALL SELECT 1 FROM events, json_tree(events.data_json) AS reference WHERE events.group_id=? AND reference.key IN ('contentId','resultContentId') AND reference.value=? LIMIT 1")
        .get(groupId, contentId, groupId, contentId, groupId, contentId);
      if (referenced) throw new Error('content is still referenced');
      const row = this.db.prepare('SELECT logical_bytes FROM contents WHERE group_id=? AND content_id=?').get(groupId, contentId) as { logical_bytes: number };
      this.db.prepare('DELETE FROM contents WHERE group_id=? AND content_id=?').run(groupId, contentId);
      this.db.prepare('UPDATE groups SET byte_usage=byte_usage-? WHERE group_id=?').run(row.logical_bytes, groupId);
    });
  },
      reservePresentationOrdinal: (input:{groupId:string;operationId:string;requestHash:string;agentId:string}):number => {
    const {groupId,operationId,requestHash,agentId}=input;
    return bodies.transaction(()=>{
      const operation=this.getOperation(groupId,operationId);
      if(!operation||operation.command!=='spawn'||operation.requestHash!==requestHash)throw Error('operation_id_conflict');
      if(operation.presentationReservation){if(operation.presentationReservation.agentId!==agentId)throw Error('presentation reservation conflict');return operation.presentationReservation.ordinal;}
      if(operation.applyState!=='prepared'||operation.result.targetAgentId!==agentId||this.getAgent(groupId,agentId)||this.presentationForAgent(groupId,agentId)!==undefined)throw Error('presentation reservation conflict');
      const ordinal=this.nextPresentationOrdinal(groupId);
      bodies.putOperation({...operation,presentationReservation:{agentId,ordinal}});
      return ordinal;
    });
  },
      reserveManagedFollowupTurn: (input:{groupId:string;operationId:string;requestHash:string;agentId:string;previousTurnId:string;expectedTurn:number;rootEpoch:number;messageHash:string;closureHash:string}):NonNullable<MultiAgentOperation['managedTurnReservation']> => {
    const {groupId,operationId,requestHash,agentId,previousTurnId,expectedTurn,rootEpoch,messageHash,closureHash}=input;
    if(!agentId||!previousTurnId||agentId.length>128||previousTurnId.length>128||!Number.isSafeInteger(expectedTurn)||expectedTurn<2||!Number.isSafeInteger(rootEpoch)||rootEpoch<1||!/^([a-f0-9]{64})$/.test(messageHash)||!/^([a-f0-9]{64})$/.test(closureHash))throw Error('invalid followup reservation');
    return bodies.transaction(()=>{
      const operation=this.getOperation(groupId,operationId);
      if(!operation||operation.command!=='followup'||operation.requestHash!==requestHash)throw Error('followup reservation conflict');
      const expected={agentId,previousTurnId,expectedTurn,rootEpoch,messageHash,closureHash};
      if(operation.managedTurnReservation){const saved=operation.managedTurnReservation;for(const key of Object.keys(expected) as Array<keyof typeof expected>)if(saved[key]!==expected[key])throw Error('followup reservation conflict');return saved;}
      if(operation.result.state!=='queued_next_admission'||operation.result.targetAgentId!==agentId||operation.result.expectedTurn!==expectedTurn)throw Error('followup reservation conflict');
      const reserved={...expected,nextTurnId:randomUUID()};
      bodies.putOperation({...operation,managedTurnReservation:reserved});return reserved;
    });
  },
      putOperation: (operation: MultiAgentOperation,control = false):void => {
    bodies.transaction(()=>{
    if (operation.command === 'approval_request') operation = captureApprovalOperationForWrite(operation);
    const existing = this.getOperation(operation.groupId, operation.operationId);
    if (existing && existing.requestHash !== operation.requestHash) throw new Error('operation_id_conflict');
    if(existing?.command.startsWith('published_message')&&encodeMultiAgentRow(existing)!==encodeMultiAgentRow(operation))throw Error('published_message_immutable');
    if(existing?.followupInput){
      if(operation.followupInput&&(operation.followupInput.targetId!==existing.followupInput.targetId||operation.followupInput.message!==existing.followupInput.message))throw Error('followup input conflict');
      operation={...operation,followupInput:existing.followupInput};
    }
    if(existing?.followupAcceptedResult){
      if(operation.followupAcceptedResult&&JSON.stringify(operation.followupAcceptedResult)!==JSON.stringify(existing.followupAcceptedResult))throw Error('followup receipt conflict');
      operation={...operation,followupAcceptedResult:existing.followupAcceptedResult};
    }
    if(existing?.followupAckBytes!==undefined){
      if(operation.followupAckBytes!==undefined&&operation.followupAckBytes!==existing.followupAckBytes)throw Error('followup ACK conflict');
      operation={...operation,followupAckBytes:existing.followupAckBytes};
    }
    if(operation.followupAckBytes!==undefined&&(typeof operation.followupAckBytes!=='string'||Buffer.byteLength(operation.followupAckBytes)>8192))throw Error('followup ACK capacity exceeded');
    if(existing?.managedTurnReservation){
      if(operation.managedTurnReservation&&JSON.stringify(operation.managedTurnReservation)!==JSON.stringify(existing.managedTurnReservation))throw Error('followup reservation conflict');
      operation={...operation,managedTurnReservation:existing.managedTurnReservation};
    }
    if(existing?.presentationReservation){
      const reserved=existing.presentationReservation;
      if(existing?.fixedAckBytes!==undefined){if(operation.fixedAckBytes!==undefined&&operation.fixedAckBytes!==existing.fixedAckBytes)throw Error('fixed ACK conflict');operation={...operation,fixedAckBytes:existing.fixedAckBytes};}
    if(operation.fixedAckBytes!==undefined&&(typeof operation.fixedAckBytes!=='string'||Buffer.byteLength(operation.fixedAckBytes)>8192))throw Error('fixed ACK capacity exceeded');
    if(operation.presentationReservation&&(operation.presentationReservation.agentId!==reserved.agentId||operation.presentationReservation.ordinal!==reserved.ordinal))throw Error('presentation reservation conflict');
      operation={...operation,presentationReservation:reserved};
    }
    if(operation.presentationReservation&&(!Number.isSafeInteger(operation.presentationReservation.ordinal)||operation.presentationReservation.ordinal<1||!operation.presentationReservation.agentId))throw Error('invalid presentation reservation');
    bodies.write('operations', operation.groupId, { group_id: operation.groupId, operation_id: operation.operationId }, {}, operation, control);
  });
  },
      commitApprovalRequest: (input: ApprovalRequestOperation):{ created: boolean; operation: ApprovalRequestOperation } => {
    const operation = captureApprovalOperationForWrite(input), approval = operation.result.approval;
    if (operation.applyState !== 'applied' || approval.status !== 'pending' || approval.persistenceState !== 'confirmed') throw new Error('invalid new approval request');
    return bodies.transaction(() => {
      this.assertWritable(operation.groupId);
      const group = this.requireGroup(operation.groupId), thread = this.getThread(group.threadId)!;
      if (approval.bootId !== this.bootId || approval.bootId !== group.bootId || approval.threadId !== group.threadId
        || approval.profileId !== thread.profileId || approval.workspaceId !== thread.workspaceId) throw new Error('approval request ownership mismatch');
      const previous = this.getOperation(operation.groupId, operation.operationId);
      if (previous) {
        if (previous.requestHash !== operation.requestHash) throw new Error('operation_id_conflict');
        return { created: false, operation: captureApprovalOperation(previous) };
      }
      bodies.putOperation(operation);
      bodies.appendEvent(group.groupId, { kind: 'approval', agentId: approval.agentId, turnId: approval.turnId, payload: { ...approvalEvent(approval) } });
      const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=pending_approval_count+1,thread_revision=thread_revision+1 WHERE thread_id=? AND pending_approval_count<9007199254740991 AND thread_revision<9007199254740991').run(group.threadId);
      if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
      return { created: true, operation };
    });
  },
      finalizeApproval: (input: FinalizeApprovalInput):{ changed: boolean; operation: ApprovalRequestOperation } => {
    return bodies.finalizeApprovalRecord(input, false);
  },
      finalizeApprovalRecord: (input: FinalizeApprovalInput,recovery: boolean):{ changed: boolean; operation: ApprovalRequestOperation } => {
    boundedString(input.groupId); boundedString(input.approvalId); boundedString(input.bootId);
    if (!APPROVAL_STATUSES.includes(input.status) || input.status === ('pending' as string)
      || input.reason !== undefined && !APPROVAL_REASONS.includes(input.reason)
      || !recovery && input.bootId !== this.bootId) throw new Error('invalid approval finalization');
    const key = `approval-request:${input.approvalId}`;
    const decision = input.decisionOperation ? JSON.parse(encodeMultiAgentRow(input.decisionOperation)) as MultiAgentOperation : undefined;
    if (decision && (decision.groupId !== input.groupId || decision.operationId === key || decision.command === 'approval_request'
      || Buffer.byteLength(encodeMultiAgentRow(decision)) > 4096)) throw new Error('invalid approval decision receipt');
    return bodies.transaction(() => {
      const previous = this.getOperation(input.groupId, key);
      if (!previous) throw new Error('unknown approval request');
      const operation = captureApprovalOperation(previous), approval = operation.result.approval, group = this.requireGroup(input.groupId);
      if (approval.bootId !== input.bootId || group.bootId !== approval.bootId || group.threadId !== approval.threadId) throw new Error('stale approval binding');
      if (approval.status !== 'pending' && !(recovery && approval.persistenceState === 'unknown')) return { changed: false, operation };
      if (!recovery && approval.persistenceState !== 'confirmed') throw new Error('approval_persistence_unknown');
      const next = captureApprovalOperation({ ...operation, applyState: 'applied', result: { approval: {
        ...approval, status: input.status, persistenceState: 'confirmed', reason: input.reason,
      } } });
      bodies.putOperation(next, true);
      if (decision) bodies.putOperation(decision, true);
      bodies.appendEvent(group.groupId, { kind: 'approval', agentId: approval.agentId, turnId: approval.turnId, payload: { ...approvalEvent(next.result.approval) } });
      if (recovery) {
        bodies.updateApprovalCount(group.threadId, this.rawPendingApprovalCount(group.threadId), true);
      } else {
        const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=pending_approval_count-1,thread_revision=thread_revision+1 WHERE thread_id=? AND pending_approval_count>0 AND thread_revision<9007199254740991').run(group.threadId);
        if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
      }
      return { changed: true, operation: next };
    });
  },
      updateApprovalCount: (threadId: string,count: number,changedFact = false):void => {
    safeInteger(count);
    const thread = this.getThread(threadId);
    if (!thread) throw new Error('unknown approval thread');
    if (!changedFact && thread.pendingApprovalCount === count) return;
    const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=?,thread_revision=thread_revision+1 WHERE thread_id=? AND thread_revision<9007199254740991').run(count, threadId);
    if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
  },
      recoverApprovalRequests: ():void => {
    // Same original store recovery transaction/readiness stage. No host/Goal
    // callbacks or live authority are created here, including on an old boot.
    for (const group of this.previousGroups()) {
      let cursor: string | undefined;
      do {
        const page = this.listApprovalRequests({ groupId: group.groupId, bootId: group.bootId, cursor });
        for (const operation of page.items) {
          const approval = operation.result.approval;
          if (approval.status === 'pending' || approval.persistenceState === 'unknown') bodies.finalizeApprovalRecord({
            groupId: group.groupId, approvalId: approval.approvalId, bootId: group.bootId, status: 'invalidated', reason: 'restart',
          }, true);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      bodies.updateApprovalCount(group.threadId, this.rawPendingApprovalCount(group.threadId));
    }
  },
      putRootBinding: (binding: MultiAgentRootBinding,control = false):void => {
    const existing = this.getRootBinding(binding.sourceTaskId);
    if (existing && (existing.groupId !== binding.groupId || existing.preparationId !== binding.preparationId)) throw new Error('source task binding conflict');
    bodies.write('root_turns', binding.groupId, { source_task_id: binding.sourceTaskId }, { group_id: binding.groupId, preparation_id: binding.preparationId, boot_id: binding.bootId }, binding, control);
  },
      putResource: (resource: MultiAgentManagedResource,control = false):void => {
    bodies.write('managed_resources', resource.groupId, { resource_id: resource.resourceId }, { group_id: resource.groupId, agent_id: resource.agentId }, resource, control);
  },
      recoverPreviousBoot: ():void => {
    bodies.transaction(() => {
      bodies.recoverApprovalRequests();
      // User resource disposition is allowed on historical groups too. A crash
      // during that operation must not preserve an old live/pending receipt.
      const uncertain = this.db.prepare(`SELECT o.data_json,o.logical_bytes FROM operations o JOIN groups g ON g.group_id=o.group_id
        WHERE g.boot_id<>? AND (json_extract(o.data_json,'$.applyState')='prepared'
          OR json_extract(o.data_json,'$.result.state')='cleanup_pending' OR json_extract(o.data_json,'$.result.phase')='cleanup_pending')`)
        .all(this.bootId) as unknown as JsonRow[];
      for (const row of uncertain) {
        const operation = this.parse<MultiAgentOperation>(row);
        if (operation.applyState !== 'unknown') bodies.putOperation({ ...operation, applyState: 'unknown' }, true);
      }
      const groups = (this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE boot_id<>? AND historical_only=0').all(this.bootId) as unknown as JsonRow[]).map(row => this.parse<DesktopMultiAgentGroup>(row));
      for (const group of groups) {
        bodies.repairByteUsage(group.groupId);
        for (const agent of this.allAgents(group.groupId)) bodies.putAgent(group.groupId, {
          ...agent, status: agent.status === 'pending' || agent.status === 'running' ? 'interrupted' : agent.status,
          executionActive: false, sessionResident: false, runtimeResident: false, resumable: false,
          closeReason: 'restart', activationState: 'settled',
        }, true);
        for (const message of this.readGroupRows<MultiAgentMessage>('messages', group.groupId)) {
          if (message.deliveryState === 'consuming') bodies.putMessage({ ...message, deliveryState: 'unread', claimId: null, turnId: null }, true);
        }
        for (const binding of this.readGroupRows<MultiAgentRootBinding>('root_turns', group.groupId)) {
          if (binding.phase !== 'settled' && binding.phase !== 'abandoned') bodies.putRootBinding({ ...binding, status: 'interrupted', phase: 'abandoned' }, true);
        }
        bodies.putGroup({ ...group, historicalOnly: true, byteUsage: this.getByteUsage(group.groupId) }, true);
        bodies.clearActiveGroup(group.threadId, group.groupId);
      }
    });
  },
      repairByteUsage: (groupId: string):void => {
    for (const table of TABLES) {
      const rows = this.db.prepare(`SELECT rowid,data_json FROM ${table} WHERE group_id=?`).all(groupId) as unknown as Array<{ rowid: number; data_json: string }>;
      for (const row of rows) this.db.prepare(`UPDATE ${table} SET logical_bytes=? WHERE rowid=?`).run(Buffer.byteLength(encodeMultiAgentRow(JSON.parse(row.data_json))), row.rowid);
    }
    this.db.prepare('UPDATE groups SET byte_usage=? WHERE group_id=?').run(this.recomputeByteUsage(groupId), groupId);
  },
      putMessage: (message: MultiAgentMessage,control = false):void => {
    bodies.write('messages', message.groupId, { message_id: message.messageId }, {
      group_id: message.groupId, sender_kind: message.sender.kind,
      sender_agent_id: message.sender.kind === 'agent' ? message.sender.agentId : null,
      sender_actor_id: message.sender.kind === 'user' ? message.sender.actorId : null,
      receiver_id: message.receiverId, delivery_state: message.deliveryState,
      claim_id: message.claimId, turn_id: message.turnId, created_at: message.createdAt,
    }, message, control);
  },
      write: (table: Table,groupId: string,key: Record<string, SqlValue>,indexes: Record<string, SqlValue>,data: unknown,control: boolean):void => {
    bodies.transaction(() => {
      const json = encodeMultiAgentRow(data);
      const size = Buffer.byteLength(json);
      const where = Object.keys(key).map(column => `${column}=?`).join(' AND ');
      const previous = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE ${where}`).get(...Object.values(key)) as JsonRow | undefined;
      if (control && size > 4 * 1024 && (!previous || size > previous.logical_bytes)) throw new Error('control row exceeds reserve record limit');
      const delta = size - (previous?.logical_bytes ?? 0);
      const usage = this.getByteUsage(groupId);
      if (delta > 0 && usage + delta > this.maxBytes - (control ? 0 : this.reserveBytes)) throw new Error('multi_agent_quota_exhausted');
      const columns = { ...key, ...indexes, data_json: json, logical_bytes: size };
      const names = Object.keys(columns);
      const updates = names.filter(column => !(column in key)).map(column => `${column}=excluded.${column}`).join(',');
      this.db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')}) ON CONFLICT(${Object.keys(key).join(',')}) DO UPDATE SET ${updates}`)
        .run(...Object.values(columns));
      this.db.prepare('UPDATE groups SET byte_usage=byte_usage+? WHERE group_id=?').run(delta, groupId);
    });
  },
      applySchema: (version: number):void => {
    const base = `
      CREATE TABLE IF NOT EXISTS thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')));
      CREATE TABLE IF NOT EXISTS groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id));
      CREATE TABLE IF NOT EXISTS root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE INDEX IF NOT EXISTS agents_page ON agents(group_id,created_at,agent_id);
      ${PRESENTATION_RESERVATION_INDEX_SQL}
      CREATE UNIQUE INDEX IF NOT EXISTS agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS messages_receiver ON messages(group_id,receiver_id,created_at);
      CREATE INDEX IF NOT EXISTS messages_claim ON messages(group_id,claim_id);
      CREATE INDEX IF NOT EXISTS root_turns_boot ON root_turns(boot_id);
      CREATE INDEX IF NOT EXISTS groups_page ON groups(thread_id,created_at,group_id);
    `;
    if (version === 5 || version === 6) {bodies.validateSchema(4, base + ACTIVITY_RUN_SCHEMA);return;}
    if (version === 4) { bodies.validateSchema(4, base + ACTIVITY_RUN_SCHEMA); return; }
    bodies.transaction(() => {
      if (version === 0) this.db.exec(base); else bodies.validateSchema(version as 1 | 2 | 3, base);
      if (version < 2) {
        const columns = new Set((this.db.prepare('PRAGMA table_info(thread_bindings)').all() as unknown as Array<{ name: string }>).map(column => column.name));
        for (const column of THREAD_DELETION_COLUMNS) if (!columns.has(column.split(' ')[0])) this.db.exec(`ALTER TABLE thread_bindings ADD COLUMN ${column}`);
        this.db.exec(WORKSPACE_AUTHORIZATION_SQL);
        this.db.exec(`ALTER TABLE thread_bindings ADD COLUMN ${APPROVAL_COUNT_COLUMN}`);
        this.db.exec(APPROVAL_INDEX_SQL);
      }
      this.db.exec(PRESENTATION_RESERVATION_INDEX_SQL);
      this.db.exec(ACTIVITY_RUN_SCHEMA);
      this.db.exec('PRAGMA user_version=4');
      bodies.validateSchema(4, base + ACTIVITY_RUN_SCHEMA);
    });
  },
      validateSchema: (version: 1 | 2 | 3 | 4,base: string):void => {
    const definitions = base.split(';').map(sql => sql.trim()).filter(Boolean);
    if (version >= 2) definitions.push(WORKSPACE_AUTHORIZATION_SQL, APPROVAL_INDEX_SQL);
    for (let expected of definitions) {
      const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX)(?: IF NOT EXISTS)? ([a-z_]+)/i.exec(expected);
      if (!match) throw new Error('multi_agent_schema_invalid');
      const [, kind, name] = match;
      if (name === 'thread_bindings') {
        const present = new Set((this.db.prepare('PRAGMA table_info(thread_bindings)').all() as unknown as Array<{ name: string }>).map(column => column.name));
        const extras = [...THREAD_DELETION_COLUMNS.filter(column => version >= 2 || present.has(column.split(' ')[0])), ...(version >= 2 ? [APPROVAL_COUNT_COLUMN] : [])];
        if (extras.length) expected = expected.replace(/\)$/, `,${extras.join(',')})`);
      }
      const actual = this.db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(kind.toLowerCase(), name) as { sql: string } | undefined;
      // Old v1/v2 may lack these additive indexes. Existing definitions must
      // still match exactly; v3 never repairs a missing or damaged index.
      if (!actual && version < 3 && PRESENTATION_RESERVATION_INDEX_NAMES.has(name)) continue;
      if (!actual || schemaSql(actual.sql) !== schemaSql(expected)) throw new Error(`multi_agent_schema_invalid:${name}`);
    }
  }
    };
    knownWriterSet(knownMultiAgentWriters,this,{fence:databaseBundle||dbPath===':memory:'||dbPath===''?undefined:createKnownDirectoryWriterFence(dirname(dbPath),'sqlite-db'),bodies});
    admitKnownMultiAgentWriter(this);
    if(!databaseBundle)mkdirSync(dirname(dbPath), { recursive: true });
    this.db = databaseBundle?new databaseBundle.Database():new DatabaseSync(dbPath);
    const admission=birthDshAdmissionChild(this,this.db,source,userSource,budgetBinding,ownerBinding,this.bootId,this.maxBytes,this.reserveBytes,databaseBundle);aApply(aWS,aChildren,[this,admission]);
    try {
      admission.validateProfile();
      if(!databaseBundle){observeOrdinarySQLiteWriter(dbPath, 'multi-agent-groups-sqlite-v1');assertOrdinarySourceWriterRoute();}
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (![0, 1, 2, 3, 4, 5, 6].includes(version.user_version)) throw new Error(`unsupported multi-agent schema version ${version.user_version}`);
      this.db.exec(databaseBundle?'PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0;':'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0;');
      if(version.user_version===5||version.user_version===6)readCapturedGroupsSchema(aApply(databaseBundle?.statementMethods.all??aAll,aApply(databaseBundle?.databaseMethods.prepare??aPrepare,this.db,['SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name']),[]) as Parameters<typeof readCapturedGroupsSchema>[0],version.user_version);
      bodies.applySchema(version.user_version);
    } catch (error) { admission.abandon(error); this.closed = true; throw error; }
  }

  close(): void { if (!this.closed) {const admission=aRead(this);if(admission)admission.close();else this.db.close();this.closed = true;this.listeners.clear();} }
  isClosed(): boolean { return this.closed; }

  /** Main-only startup admission. Closing SQLite does not release a JS owner. */
  claimBootOwnership(pid = process.pid): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.claimBootOwnership(pid);
  }

  /** Only the service that has physically drained all owned work may call this. */
  settleBootOwnership(): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.settleBootOwnership();
  }

  *previousGroups(): Generator<DesktopMultiAgentGroup> {
    let cursor = '';
    for (;;) {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE boot_id<>? AND group_id>? ORDER BY group_id LIMIT 50')
        .all(this.bootId, cursor) as unknown as JsonRow[];
      for (const row of rows) { const group = this.parse<DesktopMultiAgentGroup>(row); cursor = group.groupId; yield group; }
      if (rows.length < 50) break;
    }
  }

  assertResourceOwnerSettled(ownerBootId: string): void {
    const row = this.db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(ownerBootId) as { state: string } | undefined;
    if (!this.ownerClaimed || ownerBootId === this.bootId || !row || !['exited', 'quiesced'].includes(row.state)) throw new Error('multi_agent_resource_owner_unknown');
  }

  reconcileAgentResources(groupId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.reconcileAgentResources(groupId);
  }

  subscribe(listener: (event: MultiAgentDurableEvent) => void): () => void {
    if (this.closed) throw new Error('multi-agent store closed');
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }

  transaction<T>(action: (port:DesktopMultiAgentMutationPort) => T): T {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.transaction<T>(action);
  }

  private publishCommitted(): void {
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.committedEvents.length) {
        const event = this.committedEvents.shift()!;
        for (const listener of [...this.listeners]) { try { listener(structuredClone(event)); } catch { /* A subscriber cannot roll back committed truth. */ } }
      }
    } finally { this.publishing = false; }
  }

  registerThread(binding: MultiAgentThreadBinding): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.registerThread(binding);
  }

  getThread(threadId: string): MultiAgentThreadBinding | null {
    const row = this.db.prepare('SELECT thread_id,profile_id,workspace_id,cwd,active_group_id,thread_revision,delete_state,delete_json,pending_approval_count FROM thread_bindings WHERE thread_id=?')
      .get(threadId) as { thread_id: string; profile_id: string; workspace_id: string; cwd: string; active_group_id: string | null; thread_revision: number;
        delete_state: MultiAgentThreadBinding['deleteState']; delete_json: string | null; pending_approval_count: number } | undefined;
    return row ? { threadId: row.thread_id, profileId: row.profile_id, workspaceId: row.workspace_id, cwd: row.cwd, activeGroupId: row.active_group_id, threadRevision: row.thread_revision,
      deleteState: row.delete_state, pendingApprovalCount: row.pending_approval_count,
      ...(row.delete_json ? { deletionReceipt: JSON.parse(row.delete_json) as ThreadDeletionReceipt } : {}) } : null;
  }

  /** Main factory/service only, for its already-resolved fixed domain. No IPC creates arbitrary domains. */
  initializeWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): WorkspaceExecutionAuthorizationRow {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.initializeWorkspaceAuthorization(domain);
  }

  readWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): WorkspaceExecutionAuthorizationRow | null {
    boundedString(domain.profileId); boundedString(domain.workspaceId);
    const row = this.db.prepare('SELECT profile_id,workspace_id,permission_revision,execution_allowed,updated_at,actor_id,last_receipt_json FROM workspace_execution_authorizations WHERE profile_id=? AND workspace_id=?')
      .get(domain.profileId, domain.workspaceId) as { profile_id: string; workspace_id: string; permission_revision: number; execution_allowed: number; updated_at: number; actor_id: string | null; last_receipt_json: string | null } | undefined;
    if (!row) return null;
    if (row.execution_allowed !== 0 && row.execution_allowed !== 1) throw new Error('invalid stored workspace authorization');
    return captureWorkspaceAuthorization({ profileId: row.profile_id, workspaceId: row.workspace_id, permissionRevision: row.permission_revision,
      executionAllowed: row.execution_allowed === 1, updatedAt: row.updated_at, actorId: row.actor_id, lastReceiptJson: row.last_receipt_json });
  }

  /** Pure durable CAS: the service owns candidate allocation and all actor authorization. */
  compareAndSetWorkspaceAuthorization(input: { profileId: string; workspaceId: string; expectedPermissionRevision: number; next: WorkspaceExecutionAuthorizationRow }): boolean {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.compareAndSetWorkspaceAuthorization(input);
  }

  listWorkspaceThreads(input: { profileId: string; workspaceId: string; cursor?: string; limit?: number }): MultiAgentPage<MultiAgentThreadBinding> {
    boundedString(input.profileId); boundedString(input.workspaceId); if (input.cursor !== undefined) boundedString(input.cursor);
    const limit = this.limit(input.limit ?? 50, 50);
    const rows = this.db.prepare('SELECT thread_id FROM thread_bindings WHERE profile_id=? AND workspace_id=? AND thread_id>? ORDER BY thread_id LIMIT ?')
      .all(input.profileId, input.workspaceId, input.cursor ?? '', limit + 1) as Array<{ thread_id: string }>;
    const items = rows.slice(0, limit).map(row => this.getThread(row.thread_id)!);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.threadId : null };
  }

  listWorkspaceGroups(input: { threadId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<DesktopMultiAgentGroup> {
    boundedString(input.threadId); boundedString(input.bootId); const limit = this.limit(input.limit ?? 50, 50);
    const [time, id] = this.cursor(input.cursor, Number.MAX_SAFE_INTEGER, '\uffff');
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE thread_id=? AND boot_id=? AND historical_only=0 AND (created_at<? OR (created_at=? AND group_id<?)) ORDER BY created_at DESC,group_id DESC LIMIT ?')
      .all(input.threadId, input.bootId, time, time, id, limit + 1) as unknown as JsonRow[];
    return this.page(rows.map(row => { const group = this.parse<DesktopMultiAgentGroup>(row); return { ...group, byteUsage: this.getByteUsage(group.groupId) }; }), limit, group => [group.createdAt, group.groupId]);
  }

  beginThreadDeletion(threadId: string, receipt: ThreadDeletionReceipt): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.beginThreadDeletion(threadId,receipt);
  }

  updateThreadDeletion(threadId: string, operationId: string, result: MultiAgentControlResult): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.updateThreadDeletion(threadId,operationId,result);
  }

  /** Called only after the service's physical host/core/Goal gate, not by tools. */
  deleteThreadHistory(threadId: string, operationId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.deleteThreadHistory(threadId,operationId);
  }

  createGroup(threadId: string, permissionRevision = 0): DesktopMultiAgentGroup {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.createGroup(threadId,permissionRevision);
  }

  activeGroup(threadId: string): DesktopMultiAgentGroup | null {
    const id = this.getThread(threadId)?.activeGroupId;
    return id ? this.getGroup(id) : null;
  }

  getGroup(groupId: string): DesktopMultiAgentGroup | null {
    const data = this.readOne<DesktopMultiAgentGroup>('groups', 'group_id', groupId);
    return data ? { ...data, byteUsage: this.getByteUsage(groupId) } : null;
  }
  requireGroup(groupId: string): DesktopMultiAgentGroup {
    const group = this.getGroup(groupId);
    if (!group) throw new Error('unknown multi-agent group');
    return group;
  }

  /** A corrupt decoded identity must never select the next mutation's SQL key.
   * Keep the first original error sticky even when a transaction rolls back the
   * corrupt bytes, so abort/settlement and already admitted ports cannot write. */
  private failUsageIdentity(...original: [] | [unknown]): never {
    const error = original.length ? original[0] : Error('desktop_multi_agent_usage_identity_mismatch');
    const writer = knownMultiAgentWriter(this);
    writer.integrityFailure ??= { error };
    throw writer.integrityFailure.error;
  }
  hasUsageIdentityFailure(): boolean { return knownMultiAgentWriter(this).integrityFailure !== undefined; }

  readUsageGroupIdentity(groupId: string, expectedThreadId: string): DesktopMultiAgentGroup {
    assertKnownMultiAgentIntegrity(knownMultiAgentWriter(this));
    const row = this.db.prepare('SELECT group_id,thread_id,boot_id,historical_only,created_at,byte_usage,data_json FROM groups WHERE group_id=?')
      .get(groupId) as { group_id: string; thread_id: string; boot_id: string; historical_only: number; created_at: number; byte_usage: number; data_json: string } | undefined;
    if (!row) return this.failUsageIdentity();
    let decoded: unknown;
    try { decoded = JSON.parse(row.data_json); } catch (error) { return this.failUsageIdentity(error); }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return this.failUsageIdentity();
    const group = decoded as DesktopMultiAgentGroup;
    if (row.group_id !== groupId || row.thread_id !== expectedThreadId || row.boot_id !== this.bootId
      || group.groupId !== row.group_id || group.threadId !== row.thread_id || group.bootId !== row.boot_id
      || typeof group.historicalOnly !== 'boolean' || Number(group.historicalOnly) !== row.historical_only
      || group.createdAt !== row.created_at || !Number.isSafeInteger(row.created_at) || row.created_at < 0
      || !Number.isSafeInteger(row.byte_usage) || row.byte_usage < 0) return this.failUsageIdentity();
    return { ...group, byteUsage: row.byte_usage };
  }

  readUsageIdentity(groupId: string, agentId: string, expectedThreadId: string): { group: DesktopMultiAgentGroup; agent: DesktopAgentSnapshot } {
    const group = this.readUsageGroupIdentity(groupId, expectedThreadId);
    const row = this.db.prepare('SELECT group_id,agent_id,parent_id,created_at,data_json FROM agents WHERE group_id=? AND agent_id=?')
      .get(groupId, agentId) as { group_id: string; agent_id: string; parent_id: string | null; created_at: number; data_json: string } | undefined;
    if (!row) return this.failUsageIdentity();
    let decoded: unknown;
    try { decoded = JSON.parse(row.data_json); } catch (error) { return this.failUsageIdentity(error); }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return this.failUsageIdentity();
    const agent = decoded as DesktopAgentSnapshot;
    if (row.group_id !== groupId || row.agent_id !== agentId || agent.id !== row.agent_id
      || agent.parentId !== row.parent_id || !(row.parent_id === null || typeof row.parent_id === 'string' && row.parent_id.length > 0)
      || agent.createdAt !== row.created_at || !Number.isSafeInteger(row.created_at) || row.created_at < 0) return this.failUsageIdentity();
    return { group, agent: this.withUnread(groupId, agent) };
  }
  putGroup(group: DesktopMultiAgentGroup, control = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putGroup(group,control);
  }

  clearActiveGroup(threadId: string, expectedGroupId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.clearActiveGroup(threadId,expectedGroupId);
  }

  findThreadOperation(threadId: string, operationId: string, command: string): MultiAgentOperation | null {
    const row = this.db.prepare("SELECT o.data_json,o.logical_bytes FROM operations o JOIN groups g ON g.group_id=o.group_id WHERE g.thread_id=? AND o.operation_id=? AND json_extract(o.data_json,'$.command')=? LIMIT 1")
      .get(threadId, operationId, command) as JsonRow | undefined;
    return row ? this.parse<MultiAgentOperation>(row) : null;
  }

  /** Physical gate spans history as well as the active pointer; never trusts UI status. */
  threadHasUnreleasedResources(threadId: string): boolean {
    const live = this.db.prepare(`SELECT 1 FROM agents a JOIN groups g ON g.group_id=a.group_id WHERE g.thread_id=? AND (
      json_extract(a.data_json,'$.executionActive')=1 OR json_extract(a.data_json,'$.sessionResident')=1 OR json_extract(a.data_json,'$.runtimeResident')=1
      OR json_extract(a.data_json,'$.cleanupPending')=1 OR COALESCE(json_extract(a.data_json,'$.cleanupError'),'')<>''
      OR (json_extract(a.data_json,'$.activationState') IN ('prepared','activating') AND json_extract(a.data_json,'$.turn')>0)) LIMIT 1`).get(threadId);
    const disk = this.db.prepare("SELECT 1 FROM managed_resources r JOIN groups g ON g.group_id=r.group_id WHERE g.thread_id=? AND json_extract(r.data_json,'$.state') NOT IN ('released','retained_by_policy') LIMIT 1").get(threadId);
    return Boolean(live || disk);
  }

  /** Thread-wide history includes retained/old-boot children, never root-only groups. */
  threadHasAgentHistory(threadId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM groups g WHERE g.thread_id=? AND EXISTS (
      SELECT 1 FROM agents a WHERE a.group_id=g.group_id AND a.parent_id IS NOT NULL
    ) LIMIT 1`).get(threadId));
  }

  goalChildReadiness(groupId: string): 'ready' | 'waiting_children' | 'children_need_attention' {
    const failed = this.db.prepare(`SELECT 1 FROM messages m JOIN agents a ON a.group_id=m.group_id AND a.agent_id=m.sender_agent_id
      WHERE m.group_id=? AND m.delivery_state<>'context_applied' AND a.parent_id IS NOT NULL AND (
        json_extract(m.data_json,'$.kind')='error' OR (json_extract(m.data_json,'$.kind')='result'
        AND json_extract(a.data_json,'$.status') IN ('failed','interrupted'))) LIMIT 1`).get(groupId);
    if (failed) return 'children_need_attention';
    const live = this.db.prepare(`SELECT 1 FROM agents WHERE group_id=? AND parent_id IS NOT NULL AND (
      json_extract(data_json,'$.executionActive')=1 OR (json_extract(data_json,'$.turn')>0 AND json_extract(data_json,'$.activationState') IN ('prepared','activating'))) LIMIT 1`).get(groupId);
    const unread = this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND delivery_state<>'context_applied' AND json_extract(data_json,'$.kind') IN ('result','error') LIMIT 1").get(groupId);
    return live || unread ? 'waiting_children' : 'ready';
  }

  listGroups(threadId: string, cursor?: string, limit = 50, options: { onlyWithChildren?: boolean } = {}): MultiAgentPage<DesktopMultiAgentGroup> {
    const [time, id] = this.cursor(cursor, Number.MAX_SAFE_INTEGER, '\uffff');
    const childFilter = options.onlyWithChildren
      ? ' AND EXISTS (SELECT 1 FROM agents a WHERE a.group_id=groups.group_id AND a.parent_id IS NOT NULL)' : '';
    const rows = this.db.prepare(`SELECT data_json,logical_bytes FROM groups WHERE thread_id=?${childFilter} AND (created_at<? OR (created_at=? AND group_id<?)) ORDER BY created_at DESC,group_id DESC LIMIT ?`)
      .all(threadId, time, time, id, this.limit(limit, 50) + 1) as unknown as JsonRow[];
    return this.page(rows.map(row => {
      const group = this.parse<DesktopMultiAgentGroup>(row);
      return { ...group, byteUsage: this.getByteUsage(group.groupId) };
    }), limit, item => [item.createdAt, item.groupId]);
  }

  putAgent(groupId: string, input: Pick<DesktopAgentSnapshot, 'id' | 'parentId' | 'taskName' | 'canonicalName' | 'depth' | 'status' | 'turn'> & Partial<DesktopAgentSnapshot>, control = false): DesktopAgentSnapshot {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putAgent(groupId,input,control);
  }
  getAgent(groupId: string, agentId: string): DesktopAgentSnapshot | null {
    const agent = this.readScoped<DesktopAgentSnapshot>('agents', groupId, 'agent_id', agentId);
    return agent ? this.withUnread(groupId, agent) : null;
  }
  listAgents(groupId: string, cursor?: string, limit = 50, maxBytes = 48 * 1024,
    guardIO: <T>(query: () => T) => T = query => query()): MultiAgentPage<DesktopAgentSnapshot> {
    const [time, id] = this.cursor(cursor, -1, '');
    const queryLimit = this.limit(limit, 50) + 1;
    const agents = guardIO(() => {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM agents WHERE group_id=? AND (created_at>? OR (created_at=? AND agent_id>?)) ORDER BY created_at,agent_id LIMIT ?')
        .all(groupId, time, time, id, queryLimit) as unknown as JsonRow[];
      return rows.map(row => this.withUnread(groupId, this.parse<DesktopAgentSnapshot>(row)));
    });
    const page = this.page(agents, limit, item => [item.createdAt, item.id]);
    const items: DesktopAgentSnapshot[] = []; let bytes = 256;
    for (const agent of page.items) {
      const size = Buffer.byteLength(JSON.stringify(agent)) + 1;
      if (bytes + size > maxBytes && items.length) break;
      if (size > maxBytes) throw new Error('agent exceeds wire page limit');
      items.push(agent); bytes += size;
    }
    return { items, nextCursor: items.length < page.items.length ? Buffer.from(JSON.stringify([items.at(-1)!.createdAt, items.at(-1)!.id])).toString('base64url') : page.nextCursor };
  }
  allAgents(groupId: string): DesktopAgentSnapshot[] { return this.readGroupRows('agents', groupId); }

  residentAgents(groupId: string): DesktopAgentSnapshot[] {
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM agents WHERE group_id=? AND parent_id IS NOT NULL AND json_extract(data_json,'$.resourcesReleased')=0 ORDER BY created_at,agent_id LIMIT 8").all(groupId) as unknown as JsonRow[];
    return rows.map(row => this.withUnread(groupId, this.parse<DesktopAgentSnapshot>(row)));
  }
  agentCounts(groupId: string): { total: number; running: number; completed: number; failed: number; unread: number } {
    const row = this.db.prepare("SELECT COUNT(*) total,COALESCE(SUM(json_extract(data_json,'$.status')='running'),0) running,COALESCE(SUM(json_extract(data_json,'$.status')='completed'),0) completed,COALESCE(SUM(json_extract(data_json,'$.status')='failed'),0) failed FROM agents WHERE group_id=?").get(groupId) as { total: number; running: number; completed: number; failed: number };
    const unread = this.db.prepare("SELECT COUNT(*) count FROM messages WHERE group_id=? AND delivery_state<>'context_applied'").get(groupId) as { count: number };
    return { ...row, unread: unread.count };
  }
  private withUnread(groupId: string, agent: DesktopAgentSnapshot): DesktopAgentSnapshot {
    const row = this.db.prepare("SELECT COUNT(*) count FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state<>'context_applied'").get(groupId, agent.id) as { count: number };
    return { ...agent, unreadMessages: row.count };
  }

  appendEvent(groupId: string, input: { kind: MultiAgentEventKind; agentId: string; payload: Record<string, unknown>; turnId?: string }): MultiAgentDurableEvent {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.appendEvent(groupId,input);
  }
  readEvents(groupId: string, afterSeq = 0, limit = 100): MultiAgentDurableEvent[] {
    this.requireGroup(groupId);
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM events WHERE group_id=? AND seq>? ORDER BY seq LIMIT ?')
      .all(groupId, Math.max(0, afterSeq), this.limit(limit, 100)) as unknown as JsonRow[];
    return rows.map(row => this.parse(row));
  }

  createActivityRun(input: Pick<AgentActivityRun, 'runId' | 'groupId' | 'kind' | 'originId' | 'rootTaskId'>): AgentActivityRun {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.createActivityRun(input);
  }
  getActivityRun(runId: string): AgentActivityRun | null { return this.readOne('activity_runs', 'run_id', runId); }
  getActivityRuns(groupId: string): AgentActivityRun[] { return this.readGroupRows('activity_runs', groupId); }
  *pendingActivityRuns(): Generator<AgentActivityRun> {
    let cursor = '';
    for (;;) {
      const rows = this.db.prepare("SELECT data_json,logical_bytes FROM activity_runs WHERE run_id>? AND json_extract(data_json,'$.terminalEventId') IS NULL ORDER BY run_id LIMIT 100").all(cursor) as unknown as JsonRow[];
      if (!rows.length) return;
      for (const row of rows) { const run = this.parse<AgentActivityRun>(row); cursor = run.runId; yield run; }
    }
  }
  getActivityMembers(runId: string): AgentActivityMember[] {
    return (this.db.prepare('SELECT data_json,logical_bytes FROM activity_members WHERE run_id=? ORDER BY rowid').all(runId) as unknown as JsonRow[]).map(row => this.parse(row));
  }
  putActivityMember(member: AgentActivityMember): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putActivityMember(member);
  }
  confirmActivityRootTerminal(runId: string, proof: NonNullable<AgentActivityRun['rootTerminal']>): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.confirmActivityRootTerminal(runId,proof);
  }
  markActivityRunUnknown(runId: string, code: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.markActivityRunUnknown(runId,code);
  }
  finalizeActivityRun(runId: string): AgentActivityRun | null {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.finalizeActivityRun(runId);
  }

  sendMessage(groupId: string, input: { sender: MultiAgentSender; receiverId: string; text: string; kind?: MultiAgentMessage['kind']; contentId?: string; truncated?: boolean;bodyUnavailable?:true }, settlement = false): MultiAgentMessage {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.sendMessage(groupId,input,settlement);
  }
  /** Main settlement only: an unconfirmed claim cannot follow a closed receiver. */
  rerouteClosedHandoffs(groupId: string, agentId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.rerouteClosedHandoffs(groupId,agentId);
  }
  listMessages(groupId: string, receiverId: string): MultiAgentMessage[] {
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? ORDER BY created_at,rowid').all(groupId, receiverId) as unknown as JsonRow[];
    return rows.map(row => this.parse(row));
  }
  hasUnread(groupId: string, receiverId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' LIMIT 1").get(groupId, receiverId));
  }
  /** Main-owned input facts only; this is not a cross-process write fence. */
  captureSemanticInputBoundary(groupId: string, receiverId: string): (() => void) | undefined {
    const inspect = () => {
      if (this.closed) throw new Error('semantic_mailbox_closed');
      const group = this.requireGroup(groupId), thread = this.getThread(group.threadId);
      if (group.bootId !== this.bootId || group.historicalOnly || !thread || thread.activeGroupId !== groupId
        || thread.deleteState && thread.deleteState !== 'none' || !this.getAgent(groupId, receiverId)) throw new Error('semantic_mailbox_owner_changed');
      const blocked = Boolean(thread.pendingApprovalCount) || Boolean(this.db.prepare(
        "SELECT 1 FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state<>'context_applied' LIMIT 1").get(groupId, receiverId));
      const changes = group.lastSeq, threadRevision = thread.threadRevision;
      const external = this.db.prepare('PRAGMA data_version').get()!.data_version;
      if (!Number.isSafeInteger(changes) || !Number.isSafeInteger(threadRevision) || !Number.isSafeInteger(external)) throw new Error('semantic_mailbox_revision');
      return { blocked, changes, threadRevision, external };
    };
    const captured = inspect();
    if (captured.blocked) return undefined;
    return () => {
      const current = inspect();
      if (current.blocked || current.changes !== captured.changes || current.threadRevision !== captured.threadRevision || current.external !== captured.external) throw new Error('semantic_mailbox_changed');
    };
  }
  unreadMessageIds(groupId: string, receiverId: string, senderIds: readonly string[]): string[] {
    if (!senderIds.length) return [];
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' ORDER BY created_at,rowid").iterate(groupId, receiverId);
    const result: string[] = [];
    for (const row of rows) {
      const message = this.parse<MultiAgentMessage>(row as unknown as JsonRow);
      if (message.sender.kind === 'agent' && senderIds.includes(message.sender.agentId)) result.push(message.messageId);
      if (result.length === 50) break;
    }
    return result;
  }
  drainInput(groupId: string, receiverId: string, turnId: string, maxBytes = 16 * 1024): MultiAgentDrainedBatch {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.drainInput(groupId,receiverId,turnId,maxBytes);
  }
  confirmApplied(groupId: string, claimId: string, turnId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.confirmApplied(groupId,claimId,turnId);
  }
  returnClaim(groupId: string, claimId: string, expectedTurnId?: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.returnClaim(groupId,claimId,expectedTurnId);
  }

  putContent(groupId: string, agentId: string, text: string, settlement = false, unavailable?: {status: DesktopAgentSnapshot['status']}): MultiAgentContent {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putContent(groupId,agentId,text,settlement,unavailable);
  }
  readContent(groupId: string, contentId: string, offset: number, limit = 64 * 1024): MultiAgentContentPage {
    const content = this.readScoped<MultiAgentContent>('contents', groupId, 'content_id', contentId);
    if (!content) throw new Error('unknown content or group mismatch');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.byteLength) throw new Error('invalid content offset');
    const bytes = Buffer.from(content.utf8Text, 'utf8').subarray(offset, offset + this.limit(limit, 64 * 1024));
    return { contentId, base64: bytes.toString('base64'), nextOffset: offset + bytes.length, byteLength: content.byteLength, sha256: content.sha256, truncated: content.truncated,...(content.bodyUnavailable?{bodyUnavailable:true as const,status:content.status}:{}) };
  }

  /** Internal rollback/retention primitive; caller authorization belongs to the service. */
  deleteUnreferencedContent(groupId: string, contentId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.deleteUnreferencedContent(groupId,contentId);
  }

  private nextPresentationOrdinal(groupId:string):number {
    const row=this.db.prepare("SELECT COALESCE(MAX(ordinal),0) AS ordinal FROM (SELECT json_extract(data_json,'$.presentationOrdinal') AS ordinal FROM agents WHERE group_id=? UNION ALL SELECT json_extract(data_json,'$.presentationReservation.ordinal') AS ordinal FROM operations WHERE group_id=?)").get(groupId,groupId) as {ordinal:number};
    const ordinal=Number(row.ordinal)+1;
    if(!Number.isSafeInteger(ordinal)||ordinal<1)throw Error('presentation reservation capacity exhausted');
    return ordinal;
  }
  private presentationForAgent(groupId:string,agentId:string):number|undefined {
    const rows=this.db.prepare("SELECT data_json,logical_bytes FROM operations WHERE group_id=? AND json_extract(data_json,'$.presentationReservation.agentId')=?").all(groupId,agentId) as unknown as JsonRow[];
    if(rows.length>1)throw Error('presentation reservation conflict');
    return rows.length?this.parse<MultiAgentOperation>(rows[0]).presentationReservation!.ordinal:undefined;
  }
  /** Host metadata allocation in the same durable operation; never publishes an actor. */
  reservePresentationOrdinal(input:{groupId:string;operationId:string;requestHash:string;agentId:string}):number {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.reservePresentationOrdinal(input);
  }

  /** Immutable metadata only; admission still requires the actual Main and execution capabilities. */
  reserveManagedFollowupTurn(input:{groupId:string;operationId:string;requestHash:string;agentId:string;previousTurnId:string;expectedTurn:number;rootEpoch:number;messageHash:string;closureHash:string}):NonNullable<MultiAgentOperation['managedTurnReservation']> {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.reserveManagedFollowupTurn(input);
  }

  putOperation(operation: MultiAgentOperation, control = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putOperation(operation,control);
  }
  getOperation(groupId: string, operationId: string): MultiAgentOperation | null { return this.readScoped('operations', groupId, 'operation_id', operationId); }

  /** Caller supplies a service-validated invocation; this store never issues a waiter or grant. */
  commitApprovalRequest(input: ApprovalRequestOperation): { created: boolean; operation: ApprovalRequestOperation } {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.commitApprovalRequest(input);
  }

  finalizeApproval(input: FinalizeApprovalInput): { changed: boolean; operation: ApprovalRequestOperation } {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.finalizeApproval(input);
  }

  private finalizeApprovalRecord(input: FinalizeApprovalInput, recovery: boolean): { changed: boolean; operation: ApprovalRequestOperation } {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.finalizeApprovalRecord(input,recovery);
  }

  listApprovalRequests(input: { groupId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<ApprovalRequestOperation> {
    boundedString(input.groupId); boundedString(input.bootId); if (input.cursor !== undefined) boundedString(input.cursor);
    const limit = this.limit(input.limit ?? 50, 50);
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM operations WHERE group_id=? AND json_extract(data_json,'$.result.approval.bootId')=? AND json_extract(data_json,'$.command')='approval_request' AND operation_id>? ORDER BY operation_id LIMIT ?")
      .all(input.groupId, input.bootId, input.cursor ?? '', limit + 1) as unknown as JsonRow[];
    const items = rows.slice(0, limit).map(row => captureApprovalOperation(this.parse(row)));
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.operationId : null };
  }

  private rawPendingApprovalCount(threadId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM operations o JOIN groups g ON g.group_id=o.group_id WHERE g.thread_id=? AND json_extract(o.data_json,'$.command')='approval_request' AND json_extract(o.data_json,'$.result.approval.status')='pending'")
      .get(threadId) as { count: number };
    safeInteger(row.count); return row.count;
  }
  private updateApprovalCount(threadId: string, count: number, changedFact = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.updateApprovalCount(threadId,count,changedFact);
  }

  private recoverApprovalRequests(): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.recoverApprovalRequests();
  }
  pendingCloseOperations(groupId: string): MultiAgentOperation[] {
    return (this.db.prepare("SELECT data_json,logical_bytes FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='close' AND json_extract(data_json,'$.applyState')='applied' AND json_extract(data_json,'$.result.state')='cleanup_pending'")
      .all(groupId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentOperation>(row));
  }
  putRootBinding(binding: MultiAgentRootBinding, control = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putRootBinding(binding,control);
  }
  getRootBinding(taskId: string): MultiAgentRootBinding | null { return this.readOne('root_turns', 'source_task_id', taskId); }
  *previousRootBindings(): Generator<MultiAgentRootBinding> {
    let cursor = '';
    for (;;) {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM root_turns WHERE boot_id<>? AND source_task_id>? ORDER BY source_task_id LIMIT 50')
        .all(this.bootId, cursor) as unknown as JsonRow[];
      for (const row of rows) { const binding = this.parse<MultiAgentRootBinding>(row); cursor = binding.sourceTaskId; yield binding; }
      if (rows.length < 50) break;
    }
  }
  putResource(resource: MultiAgentManagedResource, control = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putResource(resource,control);
  }
  resources(groupId: string): MultiAgentManagedResource[] { return this.readGroupRows('managed_resources', groupId); }
  listResources(groupId: string, cursor?: string): MultiAgentPage<MultiAgentManagedResource> {
    if (cursor !== undefined && (!cursor || cursor.length > 256)) throw new Error('invalid resource cursor');
    const rows = (this.db.prepare('SELECT data_json,logical_bytes FROM managed_resources WHERE group_id=? AND resource_id>? ORDER BY resource_id LIMIT 51')
      .all(groupId, cursor ?? '') as unknown as JsonRow[]).map(row => this.parse<MultiAgentManagedResource>(row));
    const items: MultiAgentManagedResource[] = []; let bytes = 256;
    for (const row of rows.slice(0, 50)) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (size > 48 * 1024) throw new Error('resource exceeds wire page limit');
      if (bytes + size > 48 * 1024) break;
      items.push(row); bytes += size;
    }
    return { items, nextCursor: items.length < rows.length ? items.at(-1)!.resourceId : null };
  }

  recoverPreviousBoot(): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.recoverPreviousBoot();
  }

  getByteUsage(groupId: string): number {
    return (this.db.prepare('SELECT byte_usage FROM groups WHERE group_id=?').get(groupId) as { byte_usage: number } | undefined)?.byte_usage ?? 0;
  }
  recomputeByteUsage(groupId: string): number {
    return TABLES.reduce((total, table) => total + (this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=?`).all(groupId) as unknown as JsonRow[])
      .reduce((sum, row) => sum + Buffer.byteLength(encodeMultiAgentRow(JSON.parse(row.data_json))), 0), 0);
  }
  private repairByteUsage(groupId: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.repairByteUsage(groupId);
  }
  private assertWritable(groupId: string, settlement = false): void {
    const group = this.requireGroup(groupId);
    if (group.historicalOnly || group.bootId !== this.bootId) throw new Error('historical group is read-only');
    if (group.mutationBlockedReason && !settlement) throw new Error(group.mutationBlockedReason);
  }
  private putMessage(message: MultiAgentMessage, control = false): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.putMessage(message,control);
  }

  private write(table: Table, groupId: string, key: Record<string, SqlValue>, indexes: Record<string, SqlValue>, data: unknown, control: boolean): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.write(table,groupId,key,indexes,data,control);
  }

  private readOne<T>(table: Table, column: string, value: string): T | null {
    const row = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE ${column}=?`).get(value) as JsonRow | undefined;
    return row ? this.parse<T>(row) : null;
  }
  private readScoped<T>(table: Table, groupId: string, column: string, value: string): T | null {
    const row = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=? AND ${column}=?`).get(groupId, value) as JsonRow | undefined;
    return row ? this.parse<T>(row) : null;
  }
  private readGroupRows<T>(table: Table, groupId: string): T[] {
    return (this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=? ORDER BY rowid`).all(groupId) as unknown as JsonRow[]).map(row => this.parse<T>(row));
  }
  private parse<T>(row: JsonRow): T { return JSON.parse(row.data_json) as T; }
  private limit(value: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid page limit');
    return Math.min(maximum, value);
  }
  private cursor(value: string | undefined, time: number, id: string): [number, string] {
    if (!value) return [time, id];
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isFinite(parsed[0]) || typeof parsed[1] !== 'string') throw new Error('invalid page cursor');
    return parsed as [number, string];
  }
  private page<T>(items: T[], limit: number, identity: (value: T) => [number, string]): MultiAgentPage<T> {
    const size = this.limit(limit, 50);
    const visible = items.slice(0, size);
    return { items: visible, nextCursor: items.length > size ? Buffer.from(JSON.stringify(identity(visible.at(-1)!))).toString('base64url') : null };
  }

  private applySchema(version: number): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.applySchema(version);
  }

  private validateSchema(version: 1 | 2 | 3 | 4, base: string): void {
    const writer=admitKnownMultiAgentWriter(this);
    return writer.bodies.validateSchema(version,base);
  }
}
