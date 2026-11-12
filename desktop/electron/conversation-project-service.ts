import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import type {FileTaskSnapshotStore} from '../../src/runtime/task-host/snapshot-store.js';
import {resolvePreparedSubmissionProof,type PreparedSubmissionProof,type MainUserSubmissionOwner} from './main-user-submission.js';
import { writeFileAtomicallySync } from '../../src/utils/atomic-file.js';
import { assertCapturedJsonUniqueKeys } from '../../src/runtime/verification/captured-source-json.js';
import { compactProjectCreationResponse } from '../../src/runtime/task-host/tool-result-response.js';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {desktopActivityProfileId} from '../../src/runtime/conversation-activity/owner-profile-id.js';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {KSwarmInitialPlanBootstrapPayload} from './kswarm-initial-plan-bootstrap.js';
import type {ProjectPlanningOutput} from '../shared/project-planning-ipc-contract.js';
import type { KSwarmService } from './kswarm-service.js';
import {hasPlanOnlyProjectIntent,isUserRequestedProjectFolder,negatesProjectCreation} from './project-creation-user-intent.js';
import {getTaskPreparedSourceReceipt,type TaskPreparedSourceReceipt} from '../../src/runtime/task-host/task-runtime-host.js';
import {isDeepStrictEqual} from 'node:util';

type Source = 'user' | 'agent' | 'scheduler';
type RecordValue = Record<string, unknown>;
interface UserRequest { prompt: string; permissionMode?: string; threadId?: string }
interface Operation {
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  canonicalSource?: ProjectUserSourceIdentity;
  currentUserSessionId?: string;
  confirmedFromSessionId?: string;
  confirmedFromTaskId?: string;
  originThreadId?: string;
  activityOperationId?: string;
  taskId: string;
  prompt: string;
  startPolicy: 'plan_only' | 'activate_and_dispatch_after_plan';
  clientRequestKey: string;
  roomId?: string;
  sourceMessageId?: string;
  creationAttempt?: 'sent_unknown';
  initialPlanProducer?:{protocol:'ordinary_initial_plan_v1';canonicalCreateOperationId:string;profileId:string;workspaceId:string};
  proposal?: RecordValue;
  result?: RecordValue;
}

export interface ConversationProjectRoomClient {
  createRoom(input: unknown, context: unknown): Promise<unknown>;
  sendRoomMessage(input: unknown, context: unknown): Promise<unknown>;
  getRoomSnapshot(roomId: string): Promise<unknown>;
}

function record(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

// Conservative admission of a top-level user command. Quoted material,
// questions, diagnosis, and negated requests do not create a durable project.
function requestsCreation(prompt: string): boolean {
  if(negatesProjectCreation(prompt))return false;
  // Delivery-oriented workflow requests are executable work, while pure
  // design/preview requests do not grant durable project creation authority.
  if (/^(?:(?:请(?:你)?|帮我)\s*)?设计.{0,20}工作流/u.test(prompt.trim())
    && /交付[^\n。；]{0,80}报告/u.test(prompt)
    && !/[?？]|只(?:设计|输出|生成|要|规划)|(?:不要|不用|不需要|别|不|暂不|先不).{0,12}(?:执行|启动|创建|建立)/u.test(prompt)) return true;
  const clause = prompt.trim().split(/[，。；\n]/, 1)[0] ?? '';
  if (/(?:不要|别|不需要|不用|先不|暂不).{0,8}(?:创建|新建|建立|建项目)/.test(clause)) return false;
  if (/(?:项目(?:的)?(?:流程|方法|步骤)|项目.{0,8}(?:是什么|如何|怎么|了吗|是否))/u.test(clause)) return false;
  return /^(?:(?:请(?:你)?|帮我|麻烦(?:你)?|我要|我想(?:要)?|我希望|我要求|现在|直接|先|在xiaok里)\s*)*(?:创建|新建|建立|建).{0,40}项目/u.test(clause)
    || /^(?:please\s+)?(?:create|set up|make)\s+(?:a\s+|an\s+)?(?:xiaok\s+)?project\b/i.test(clause);
}

function confirmsCreation(prompt: string): boolean {
  return /^(?:同意|确认|可以|好的|开始吧|执行吧|yes|confirm)(?:[。！!\s]*$|[，,]\s*(?:报告)?主题(?:是|为|[：:]))/i.test(prompt.trim())
    && !/[?？]|不同意|(?:不要|不用|不需要|别|不|先不|暂不).{0,12}(?:创建|新建|建立|启动|执行)|只(?:规划|计划)/u.test(prompt);
}

function hasPendingCreation(snapshot: TaskSnapshot | null, threadId: string): boolean {
  if (!snapshot || snapshot.context?.threadId !== threadId || snapshot.status !== 'completed'
    || !/^(?:请|帮我)?\s*设计.{0,20}工作流/u.test(snapshot.prompt)
    || !/是否确认.{0,30}创建.{0,12}启动.{0,8}项目[?？]/u.test(snapshot.result?.summary ?? '')) return false;
  let proposal = false;
  for (const event of snapshot.events) {
    if (event.type !== 'canvas_tool_result' || event.toolName !== 'create_project' || !event.ok) continue;
    try {
      const result = JSON.parse(event.response);
      if (result.projectId || result.project?.id) return false;
      if (result.ok === true && result.proposal?.kind === 'project_proposal') proposal = true;
    } catch { return false; }
  }
  return proposal;
}

interface PreparedUserTaskBase {
  requestSource: 'user'; profileId: string;
  taskId: string; sessionId: string; threadId: string; promptSha256: string;
  permissionMode?: string;
}
type PreparedUserTaskFact = PreparedUserTaskBase & ({schemaVersion:1}|{
  schemaVersion:2;workspaceId:string;canonicalUserTaskId:string;canonicalMessageId:string;
  sourceGoalId:string;sourceGoalEpoch:number;sourceGoalTurnId:string;
}|{schemaVersion:3;sourceFamily:'main_user_submission';workspaceId:string;canonicalUserTaskId:string;canonicalMessageId:string;submissionId:string;
});
interface ProjectUserSourceBase {
 profileId:string;workspaceId:string;threadId:string;canonicalUserTaskId:string;canonicalMessageId:string;promptSha256:string;permissionMode?:string;
}
export type ProjectUserSourceIdentity=ProjectUserSourceBase & (
 {schemaVersion:1;sourceGoalId:string;sourceGoalEpoch:number;sourceGoalTurnId:string;}
 |{schemaVersion:2;sourceFamily:'main_user_submission';submissionId:string;sourceTaskId:string;sourceSessionId:string;}
);
declare const sourceProofBrand:unique symbol;
export type ProjectUserSourceProof={readonly [sourceProofBrand]:true};
const sourceProofs=new WeakMap<object,{owner:ConversationProjectService;sourceTaskId:string;sourceSessionId:string;identity:Readonly<ProjectUserSourceIdentity>;assertCurrent:()=>void}>();
/** Main-only source authenticity, never creation/follow-up/dispatch authority. */
export function resolveProjectUserSourceProof(proof:ProjectUserSourceProof,expectedOwner?:ConversationProjectService):Readonly<ProjectUserSourceIdentity>{
  const source=sourceProofs.get(proof);if(!source||expectedOwner!==undefined&&source.owner!==expectedOwner)throw Error('conversation_user_source_unverified');
  source.assertCurrent();return Object.freeze({...source.identity});
}
function canonicalUserIds(profileId:string,workspaceId:string,threadId:string,goalId:string,epoch:number,goalTurnId:string){
  const key=createHash('sha256').update(JSON.stringify(['main-user-input-v1',profileId,workspaceId,threadId,goalId,epoch,goalTurnId])).digest('hex');
  return {canonicalUserTaskId:'main-user-task:'+key,canonicalMessageId:'main-user-message:'+key};
}
const promptDigest = (prompt: string) => createHash('sha256').update(prompt).digest('hex');

/** Main owns authorization and side-effect receipts; model input cannot grant access. */
export class ConversationProjectService {
  private readonly admission = new AsyncLocalStorage<UserRequest>();
  private readonly inflight = new Map<string, Promise<RecordValue>>();
  private readonly originalTaskReads=new Set<Promise<unknown>>();
  private readonly originalTaskReadLifetime=new AbortController();
  private readonly refusedPreparations = new Set<string>();
  private readonly directory: string;
  private roomClient?: ConversationProjectRoomClient;
  private readonly userFactDirectory: string;
  private readonly userFactProfileId: string;
  private readonly userFactWorkspaceId:string;
  private readonly userFactDirectoryIdentity: {dev:number;ino:number};
  private userFactsSealed = false;
  private userFactWriteFailure?: { error: unknown };

  constructor(private readonly options: {
    dataRoot: string;
    workspaceRoot?:string;
    /** Main's service-scope profile id; defaults to the legacy data-root digest. */
    profileId?:string;
    userSubmissions?:MainUserSubmissionOwner;
    kswarmService: Pick<KSwarmService, 'request' | 'getDesktopMutationToken'>;
    initialPlanBootstrap?:{enqueue(input:KSwarmInitialPlanBootstrapPayload):ProjectPlanningOutput};
    readPreviousUserTask?: (threadId: string, taskId: string) => Promise<TaskSnapshot | null>;
    sourceSnapshots?:Pick<FileTaskSnapshotStore,'readOriginalUserInput'>;
    activityHooks?: {
      prepare(input: { threadId: string; operationId: string; creationIdempotencyKey: string }): Promise<void>;
      created(input: { threadId: string; operationId: string; projectId: string; roomId?: string; project: RecordValue }): Promise<RecordValue>;
    };
  }) {
    this.directory = join(options.dataRoot, 'conversation-projects');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.userFactDirectory = join(this.directory, 'user-inputs');
    this.userFactProfileId = options.profileId ?? desktopActivityProfileId(options.dataRoot);
    this.userFactWorkspaceId=createHash('sha256').update(resolve(options.workspaceRoot??process.cwd())).digest('hex');
    mkdirSync(this.userFactDirectory, { recursive: true, mode: 0o700 });
    const directory = lstatSync(this.userFactDirectory);
    this.userFactDirectoryIdentity = {dev:directory.dev,ino:directory.ino};
    this.assertUserFactDirectory();
  }

  bindRoomClient(client: ConversationProjectRoomClient): void { this.roomClient = client; }

  withUserRequest<T>(input: UserRequest, context: { requestSource: Source }, action: () => T): T {
    if (context.requestSource !== 'user') throw new Error('conversation_project_user_source_required');
    return this.admission.run({ ...input }, action);
  }

  /** Main-only: caller passes host.inspectTask(actualPrepared.taskId), never a DTO.
   * The existing ALS supplies origin; this fact alone never authorizes creation. */
  recordPreparedUserTask(snapshot: TaskSnapshot, context: { requestSource: Source;preparedSource?:TaskPreparedSourceReceipt;submissionSource?:PreparedSubmissionProof }): boolean {
    const admitted = this.admission.getStore();
    if (context.requestSource !== 'user' || !admitted) return false;
    const refuse=()=>{if(text(snapshot.taskId))this.refusedPreparations.add(snapshot.taskId);return false;};
    if (admitted.prompt !== snapshot.prompt
      || snapshot.executionScope && (snapshot.executionScope.kind !== 'goal_turn' || snapshot.executionScope.origin !== 'user')) return refuse();
    let prepared:ReturnType<typeof getTaskPreparedSourceReceipt>|undefined;
    if(Object.hasOwn(context,'preparedSource')&&!context.preparedSource)return refuse();
    if(context.preparedSource){
      try{prepared=getTaskPreparedSourceReceipt(context.preparedSource);}catch{return refuse();}
      if(prepared.taskId!==snapshot.taskId || prepared.sessionId!==snapshot.sessionId || prepared.prompt!==snapshot.prompt
        || prepared.threadId!==snapshot.context?.threadId || !isDeepStrictEqual(prepared.executionScope,snapshot.executionScope))return refuse();
      if(prepared.permissionMode==='plan' && admitted.permissionMode!=='plan'
        || prepared.permissionMode!==undefined && admitted.permissionMode!==undefined && prepared.permissionMode!==admitted.permissionMode)return refuse();
    }
    if(snapshot.executionScope && !prepared)return refuse();
    const threadId = snapshot.context?.threadId;
    if (!threadId || admitted.threadId && admitted.threadId !== threadId) return refuse();
    if(this.refusedPreparations.has(snapshot.taskId))return false;
    this.assertUserFactWriter();
    if (admitted.permissionMode !== undefined && !['auto','plan','default'].includes(admitted.permissionMode)) throw Error('conversation_user_fact_mode');
    if (snapshot.status !== 'understanding' || !text(snapshot.taskId) || !text(snapshot.sessionId)
      || text(snapshot.sessionId)!==snapshot.sessionId || text(threadId)!==threadId) throw Error('conversation_user_preparation_mismatch');
    const base:PreparedUserTaskBase={requestSource: 'user', profileId: this.userFactProfileId,
      taskId: snapshot.taskId, sessionId: snapshot.sessionId, threadId, promptSha256: promptDigest(snapshot.prompt),
      ...(admitted.permissionMode === undefined ? {} : {permissionMode: admitted.permissionMode}) };
    const scope=snapshot.executionScope;
    const identity=scope?.kind==='goal_turn'&&scope.origin==='user'&&scope.threadId===threadId
      && text(scope.goalId)===scope.goalId&&text(scope.goalTurnId)===scope.goalTurnId&&!!scope.goalId&&!!scope.goalTurnId
      && Number.isSafeInteger(scope.epoch)&&scope.epoch>=0
      ? {workspaceId:this.userFactWorkspaceId,...canonicalUserIds(this.userFactProfileId,this.userFactWorkspaceId,threadId,scope.goalId,scope.epoch,scope.goalTurnId),
        sourceGoalId:scope.goalId,sourceGoalEpoch:scope.epoch,sourceGoalTurnId:scope.goalTurnId}:undefined;
    if(scope&&!identity)return refuse();
    let submission:ReturnType<typeof resolvePreparedSubmissionProof>|undefined;
    if(Object.hasOwn(context,'submissionSource')&&!context.submissionSource)return refuse();
    if(context.submissionSource){
      try{submission=resolvePreparedSubmissionProof(context.submissionSource);}catch{return refuse();}
      if(!prepared||!this.options.userSubmissions||submission.profileId!==this.userFactProfileId||submission.workspaceId!==this.userFactWorkspaceId
        ||submission.prepared.taskId!==base.taskId||submission.prepared.sessionId!==base.sessionId||submission.prepared.threadId!==base.threadId
        ||submission.prepared.promptSha256!==base.promptSha256||submission.prepared.permissionMode!==admitted.permissionMode)return refuse();
      const observed=this.options.userSubmissions.observePreparedBinding(submission.submissionId);
      if(!isDeepStrictEqual(observed,submission))return refuse();
    }
    const fact:PreparedUserTaskFact=submission?{schemaVersion:3,...base,sourceFamily:'main_user_submission',workspaceId:submission.workspaceId,
      canonicalUserTaskId:submission.canonicalUserTaskId,canonicalMessageId:submission.canonicalMessageId,submissionId:submission.submissionId}
      :identity?{schemaVersion:2,...base,...identity}:{schemaVersion:1,...base};
    const previous = this.readUserTaskFact(snapshot.taskId);
    // Reading an old record is not evidence of its missing workspace. Preserve
    // legacy creation compatibility without silently upgrading source authority.
    if(previous?.schemaVersion===1&&isDeepStrictEqual(previous,{schemaVersion:1,...base}))return true;
    if (previous && !isDeepStrictEqual(previous,fact)) throw Error('conversation_user_preparation_conflict');
    if(fact.schemaVersion!==1){const source=this.sourceIdentity(fact);if(existsSync(this.canonicalSourcePath(source)))this.assertCanonicalUserSource(source);}
    try {
      // Reuse ordinary Main journal IO: fsync temp, atomic rename, directory sync
      // under the existing helper's platform policy. There is no async write tail.
      this.assertUserFactDirectory();
      if(fact.schemaVersion!==1)this.writeCanonicalUserSource(this.sourceIdentity(fact));
      writeFileAtomicallySync(this.userFactPath(snapshot.taskId), JSON.stringify(fact));
      this.assertUserFactDirectory();
    } catch (error) {
      this.userFactWriteFailure = {error};
      throw error; // Preserve the actual IO rejection identity.
    }
    return true; // Including plan: source fact is NOT creation authorization.
  }

  /** Called by the real Main ingress stop; all accepted async prep is still
   * drained by the existing Goal coordinator, and synchronous IO has returned. */
  sealUserTaskFacts(): void { this.userFactsSealed = true;this.originalTaskReadLifetime.abort(Error('conversation_user_source_sealed')); }

  readProjectUserSource(taskId:string):ProjectUserSourceProof|undefined {
    this.assertUserFactWriter();const fact=this.readUserTaskFact(taskId);
    if(!fact||fact.schemaVersion===1||fact.workspaceId!==this.userFactWorkspaceId)return undefined;
    const identity=Object.freeze(this.sourceIdentity(fact));this.assertCanonicalUserSource(identity);
    const proof=Object.freeze(Object.create(null)) as ProjectUserSourceProof;
    sourceProofs.set(proof,{owner:this,sourceTaskId:fact.taskId,sourceSessionId:fact.sessionId,identity,assertCurrent:()=>{
      this.assertUserFactWriter();const current=this.readUserTaskFact(taskId);
      if(!current||current.schemaVersion!==fact.schemaVersion||JSON.stringify(current)!==JSON.stringify(fact))throw Error('conversation_user_source_changed');
      this.assertCanonicalUserSource(identity);
    }});
    return proof;
  }
  /** Fixed inspector of the same source issuer; never a target-project,
   * initial-planner, B mutation or Native execution permission. */
  inspectOriginalTaskSource(proof:ProjectUserSourceProof){
    const entry=sourceProofs.get(proof);if(!entry||entry.owner!==this)throw Error('conversation_user_source_unverified');entry.assertCurrent();
    return Object.freeze({identity:Object.freeze({...entry.identity}),sourceTaskId:entry.sourceTaskId,sourceSessionId:entry.sourceSessionId});
  }
  /** Read the retained original body, not a proposed body or runtime cache.
   * The original source owner holds this complete read until all raw IO joins. */
  readOriginalTaskSource(proof:ProjectUserSourceProof,signal:AbortSignal,beforeEffects?:()=>void){
    const current=()=>{signal.throwIfAborted();assertBeforeEffects(beforeEffects);return this.inspectOriginalTaskSource(proof);};current();
    const snapshots=this.options.sourceSnapshots;if(!snapshots)throw Error('conversation_user_body_unavailable');
    const lifetime=AbortSignal.any([signal,this.originalTaskReadLifetime.signal]);
    const run=Promise.resolve().then(async()=>{
      const before=current();lifetime.throwIfAborted();
      const input=await snapshots.readOriginalUserInput(before.sourceTaskId,{signal:lifetime,trackPending(){/* original reader joins its raw tails before settling */}});
      lifetime.throwIfAborted();const after=current();if(!isDeepStrictEqual(before,after))throw Error('conversation_user_source_changed');
      if(!input)throw Error('conversation_user_body_unavailable');
      if(input.taskId!==before.sourceTaskId||input.sessionId!==before.sourceSessionId||input.threadId!==before.identity.threadId
        ||promptDigest(input.prompt)!==before.identity.promptSha256)throw Error('conversation_user_source_body_invalid');
      if(before.identity.schemaVersion===1){
        const expected={kind:'goal_turn',origin:'user',goalId:before.identity.sourceGoalId,epoch:before.identity.sourceGoalEpoch,goalTurnId:before.identity.sourceGoalTurnId,threadId:before.identity.threadId};
        if(!isDeepStrictEqual(input.executionScope,expected))throw Error('conversation_user_source_body_invalid');
      }else if(input.executionScope!==undefined){
        const scope=input.executionScope as {kind?:unknown;origin?:unknown;threadId?:unknown};
        if(!scope||scope.kind!=='goal_turn'||scope.origin!=='user'||scope.threadId!==before.identity.threadId)throw Error('conversation_user_source_body_invalid');
      }
      current();return Object.freeze({binding:before,body:input.prompt,...(input.executionProtected||input.protectedObservationClosure?{protection:Object.freeze({...(input.executionProtected?{executionProtected:true as const}:{}),...(input.protectedObservationClosure?{protectedObservationClosure:input.protectedObservationClosure}:{})})}:{})});
    });
    this.originalTaskReads.add(run);void run.then(()=>{this.originalTaskReads.delete(run);},()=>{this.originalTaskReads.delete(run);});return run;
  }
  async drainOriginalTaskReads():Promise<void>{while(this.originalTaskReads.size)await Promise.allSettled([...this.originalTaskReads]);}

  private sourceIdentity(fact:Exclude<PreparedUserTaskFact,{schemaVersion:1}>):ProjectUserSourceIdentity {
    if(fact.schemaVersion===3){
      const submission=this.options.userSubmissions?.observePreparedBinding(fact.submissionId);
      if(!submission||submission.profileId!==fact.profileId||submission.workspaceId!==fact.workspaceId||submission.canonicalMessageId!==fact.canonicalMessageId
        ||submission.canonicalUserTaskId!==fact.canonicalUserTaskId||submission.prepared.taskId!==fact.taskId||submission.prepared.sessionId!==fact.sessionId
        ||submission.prepared.threadId!==fact.threadId||submission.prepared.promptSha256!==fact.promptSha256||submission.prepared.permissionMode!==fact.permissionMode)throw Error('conversation_user_submission_unverified');
      return {schemaVersion:2,sourceFamily:'main_user_submission',profileId:fact.profileId,workspaceId:fact.workspaceId,threadId:fact.threadId,
        canonicalUserTaskId:fact.canonicalUserTaskId,canonicalMessageId:fact.canonicalMessageId,promptSha256:fact.promptSha256,permissionMode:fact.permissionMode??'default',
        submissionId:fact.submissionId,sourceTaskId:fact.taskId,sourceSessionId:fact.sessionId};
    }
    return {schemaVersion:1,profileId:fact.profileId,workspaceId:fact.workspaceId,threadId:fact.threadId,
      canonicalUserTaskId:fact.canonicalUserTaskId,canonicalMessageId:fact.canonicalMessageId,promptSha256:fact.promptSha256,
      sourceGoalId:fact.sourceGoalId,sourceGoalEpoch:fact.sourceGoalEpoch,sourceGoalTurnId:fact.sourceGoalTurnId,
      ...(fact.permissionMode===undefined?{}:{permissionMode:fact.permissionMode})};
  }
  private canonicalSourcePath(identity:ProjectUserSourceIdentity):string {
    return join(this.userFactDirectory,'canonical-'+createHash('sha256').update(identity.canonicalMessageId).digest('hex')+'.json');
  }
  private assertCanonicalUserSource(identity:ProjectUserSourceIdentity):void {
    this.assertUserFactDirectory();const path=this.canonicalSourcePath(identity),file=lstatSync(path);
    if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>8192||process.platform!=='win32'&&((file.mode&0o077)!==0||file.uid!==process.getuid?.()))throw Error('conversation_user_fact_storage');
    const raw=readFileSync(path,'utf8');assertCapturedJsonUniqueKeys(raw,'conversation_user_source_invalid');
    const stored:unknown=JSON.parse(raw);const keys=Object.keys(identity);
    if(!record(stored)||Object.keys(stored).length!==keys.length||keys.some(key=>!Object.hasOwn(stored,key)||stored[key]!==Reflect.get(identity,key)))throw Error('conversation_user_source_conflict');
  }
  private writeCanonicalUserSource(identity:ProjectUserSourceIdentity):void {
    const path=this.canonicalSourcePath(identity);
    if(existsSync(path)){this.assertCanonicalUserSource(identity);return;}
    writeFileAtomicallySync(path,JSON.stringify(identity));this.assertCanonicalUserSource(identity);
  }

  private assertUserFactWriter(): void {
    if (this.userFactsSealed) throw Error('conversation_user_admission_closed');
    if (this.userFactWriteFailure) throw Error('conversation_user_admission_write_unconfirmed', {cause:this.userFactWriteFailure.error});
  }

  private userFactPath(taskId: string): string {
    return join(this.userFactDirectory, createHash('sha256').update(taskId).digest('hex') + '.json');
  }

  private assertUserFactDirectory(): void {
    const directory = lstatSync(this.userFactDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.dev !== this.userFactDirectoryIdentity.dev
      || directory.ino !== this.userFactDirectoryIdentity.ino || process.platform !== 'win32'
        && ((directory.mode & 0o077) !== 0 || directory.uid !== process.getuid?.())) throw Error('conversation_user_fact_directory_changed');
  }

  private readUserTaskFact(taskId: string): PreparedUserTaskFact | undefined {
    this.assertUserFactDirectory();
    const path = this.userFactPath(taskId);
    if (!existsSync(path)) return undefined;
    const directory = lstatSync(this.userFactDirectory), file = lstatSync(path);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size > 8192
      || process.platform !== 'win32' && ((directory.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0 || directory.uid !== process.getuid?.() || file.uid !== process.getuid?.())) throw Error('conversation_user_fact_storage');
    const raw = readFileSync(path, 'utf8');
    assertCapturedJsonUniqueKeys(raw, 'conversation_user_fact_invalid');
    const value: unknown = JSON.parse(raw);
    if (!record(value) || Object.keys(value).some(key => !['schemaVersion','requestSource','profileId','taskId','sessionId','threadId','promptSha256','permissionMode',
      ...(value.schemaVersion===2?['workspaceId','canonicalUserTaskId','canonicalMessageId','sourceGoalId','sourceGoalEpoch','sourceGoalTurnId']:value.schemaVersion===3?['workspaceId','canonicalUserTaskId','canonicalMessageId','submissionId','sourceFamily']:[])].includes(key))
      || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !==3) || value.requestSource !== 'user' || value.profileId !== this.userFactProfileId || value.taskId !== taskId
      || !text(value.sessionId) || !text(value.threadId) || typeof value.promptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.promptSha256)
      || value.permissionMode !== undefined && !['auto','plan','default'].includes(String(value.permissionMode))) throw Error('conversation_user_fact_invalid');
    const base:PreparedUserTaskBase={requestSource:'user',profileId:this.userFactProfileId,taskId,
      sessionId:text(value.sessionId),threadId:text(value.threadId),promptSha256:value.promptSha256,
      ...(value.permissionMode === undefined ? {} : {permissionMode:String(value.permissionMode)})};
    if(value.schemaVersion===1)return {schemaVersion:1,...base};
    if(value.schemaVersion===3){
      if(value.sourceFamily!=='main_user_submission'||typeof value.workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(value.workspaceId)
       ||typeof value.canonicalMessageId!=='string'||!/^main-user-message:[a-f0-9]{64}$/.test(value.canonicalMessageId)
       ||typeof value.canonicalUserTaskId!=='string'||!/^main-user-task:[a-f0-9]{64}$/.test(value.canonicalUserTaskId)||typeof value.submissionId!=='string')throw Error('conversation_user_fact_invalid');
      const fact:PreparedUserTaskFact={schemaVersion:3,...base,workspaceId:value.workspaceId,sourceFamily:'main_user_submission',canonicalUserTaskId:value.canonicalUserTaskId,canonicalMessageId:value.canonicalMessageId,submissionId:value.submissionId};
      if(fact.workspaceId===this.userFactWorkspaceId)this.sourceIdentity(fact);return fact;
    }
    if(typeof value.workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(value.workspaceId)||typeof value.sourceGoalId!=='string'||!text(value.sourceGoalId)||text(value.sourceGoalId)!==value.sourceGoalId
      ||typeof value.sourceGoalTurnId!=='string'||!text(value.sourceGoalTurnId)||text(value.sourceGoalTurnId)!==value.sourceGoalTurnId||!Number.isSafeInteger(value.sourceGoalEpoch)||Number(value.sourceGoalEpoch)<0)throw Error('conversation_user_fact_invalid');
    const ids=canonicalUserIds(this.userFactProfileId,value.workspaceId,base.threadId,value.sourceGoalId,Number(value.sourceGoalEpoch),value.sourceGoalTurnId);
    if(value.canonicalUserTaskId!==ids.canonicalUserTaskId||value.canonicalMessageId!==ids.canonicalMessageId)throw Error('conversation_user_fact_invalid');
    return {schemaVersion:2,...base,workspaceId:value.workspaceId,...ids,sourceGoalId:value.sourceGoalId,sourceGoalEpoch:Number(value.sourceGoalEpoch),sourceGoalTurnId:value.sourceGoalTurnId};
  }

  bindPreparedTask(input: {
    taskId: string; prompt: string; permissionMode?: string;
    executionScope?: { kind: string; origin?: string };
  }, context: { requestSource: Source }): boolean | Promise<boolean> {
    const admitted = this.admission.getStore();
    if (context.requestSource !== 'user' || !admitted || admitted.prompt !== input.prompt
      || this.refusedPreparations.has(input.taskId)
      || admitted.permissionMode === 'plan' || input.permissionMode === 'plan'
      || input.executionScope && (input.executionScope.kind !== 'goal_turn' || input.executionScope.origin !== 'user')) return false;
    this.assertUserFactWriter();
    if (!requestsCreation(admitted.prompt)) {
      if (!admitted.threadId || !confirmsCreation(admitted.prompt) || !this.options.readPreviousUserTask) return false;
      const currentFact = this.readUserTaskFact(input.taskId);
      if (!currentFact || currentFact.threadId !== admitted.threadId || currentFact.promptSha256 !== promptDigest(input.prompt)
        || currentFact.permissionMode === 'plan') return false;
      return this.options.readPreviousUserTask(admitted.threadId, input.taskId).then(previous => {
        this.assertUserFactWriter();
        if (!previous || !hasPendingCreation(previous, admitted.threadId!)) return false;
        const priorFact = this.readUserTaskFact(previous.taskId), current = this.readUserTaskFact(input.taskId);
        if (!priorFact || !current || JSON.stringify(current) !== JSON.stringify(currentFact)
          || priorFact.threadId !== admitted.threadId || priorFact.sessionId !== previous.sessionId
          || priorFact.promptSha256 !== promptDigest(previous.prompt)) return false;
        return this.bindAuthorizedTask(input, admitted, previous.taskId, currentFact.sessionId, priorFact.sessionId,hasPlanOnlyProjectIntent(previous.prompt));
      });
    }
    return this.bindAuthorizedTask(input, admitted);
  }

  private bindAuthorizedTask(input: { taskId: string; prompt: string }, admitted: UserRequest, confirmedFromTaskId?: string, currentUserSessionId?: string, confirmedFromSessionId?: string,inheritedPlanOnly=false): boolean | Promise<boolean> {
    const prior = this.read(input.taskId);
    if (prior) {
      if (prior.originThreadId && admitted.threadId && prior.originThreadId !== admitted.threadId) throw new Error('conversation_project_origin_conflict');
      if (prior.prompt !== input.prompt) return false;
      return this.options.activityHooks && prior.originThreadId && prior.activityOperationId
        ? this.options.activityHooks.prepare({ threadId: prior.originThreadId, operationId: prior.activityOperationId, creationIdempotencyKey: prior.clientRequestKey }).then(() => true)
        : true;
    }
    const startPolicy = inheritedPlanOnly || hasPlanOnlyProjectIntent(input.prompt)
      ? 'plan_only' : 'activate_and_dispatch_after_plan';
    const canonicalSource = this.currentCreationSource(input.taskId);
    if (canonicalSource && (canonicalSource.promptSha256 !== promptDigest(input.prompt)
      || admitted.threadId !== undefined && canonicalSource.threadId !== admitted.threadId || canonicalSource.permissionMode === 'plan')) return false;
    const originThreadId=canonicalSource?.threadId ?? admitted.threadId;
    const key = this.creationKey(input.taskId, canonicalSource);
    const operation: Operation = { schemaVersion: canonicalSource ? 5 : confirmedFromTaskId ? 4 : 2,
      ...(canonicalSource ? { canonicalSource } : {}), ...(confirmedFromTaskId ? { confirmedFromTaskId, currentUserSessionId, confirmedFromSessionId } : {}), taskId: input.taskId, prompt: input.prompt, startPolicy,
      clientRequestKey: key, ...(originThreadId ? { originThreadId, activityOperationId: key } : {}) };
    // Journal the trusted creation intent first. If the independent activity
    // database commit is interrupted, startup can reconstruct that association
    // without inventing origin evidence or replaying source creation.
    this.save(operation);
    return this.options.activityHooks && originThreadId
      ? this.options.activityHooks.prepare({ threadId: originThreadId, operationId: key, creationIdempotencyKey: key }).then(() => true)
      : true;
  }

  isAuthorized(taskId: string): boolean { return Boolean(this.read(taskId)); }

  /** Recover observation receipts, never replay project creation or dispatch. */
  async recoverActivityBindings(): Promise<void> {
    if (!this.options.activityHooks && !this.options.initialPlanBootstrap) return;
    let projects: unknown[] | undefined;
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue;
      // Canonical journals are keyed by Main message identity, not runtime ID.
      // Read through the original task's source evidence before observing them.
      let taskId = name.slice(0, -5);
      if (taskId.startsWith('canonical-')) {
        try {
          const stored: unknown = JSON.parse(readFileSync(join(this.directory, name), 'utf8'));
          if (!record(stored) || stored.schemaVersion !== 5 || typeof stored.taskId !== 'string'
            || this.operationFilename(stored.taskId) !== join(this.directory, name)) continue;
          taskId = stored.taskId;
        } catch { continue; }
      }
      const operation = this.read(taskId);
      if (!operation) continue;
      if(this.options.activityHooks && operation.originThreadId && operation.activityOperationId)await this.options.activityHooks.prepare({ threadId: operation.originThreadId, operationId: operation.activityOperationId, creationIdempotencyKey: operation.clientRequestKey });
      if (operation.result) {
        await this.observeReceipt(operation, await this.resumeInitialPlanning(operation,operation.result));
      } else if (operation.proposal && operation.roomId && operation.sourceMessageId) {
        // The source may have committed before the process could persist its response.
        // A lookup is safe on restart; creation/dispatch is never replayed here.
        if (!projects) {
          const known = await this.request('/projects');
          projects = Array.isArray(known.projects) ? known.projects : [];
        }
        const project = projects.find(value => record(value) && value.clientRequestKey === operation.clientRequestKey);
        if (record(project) && project.primaryRoomId === operation.roomId) {
          await this.receipt(operation, { ok: true, project, reused: true });
        }
      }
    }
  }


  async create(proposal: RecordValue, context: { requestSource: Source; taskId: string; signal?: AbortSignal }): Promise<RecordValue> {
    context.signal?.throwIfAborted();
    const operation = this.read(context.taskId);
    if (!operation || !['user', 'agent'].includes(context.requestSource)) return { ok: false, error: 'conversation_project_user_authorization_required' };
    if (operation.result) return this.observeReceipt(operation, await this.resumeInitialPlanning(operation,{ ...operation.result, reused: true }));
    const pending = this.inflight.get(operation.clientRequestKey);
    if (pending) return pending;
    const run = this.execute(operation, proposal, context.signal).finally(() => this.inflight.delete(operation.clientRequestKey));
    this.inflight.set(operation.clientRequestKey, run);
    return run;
  }

  /** Read-only overlay of a provably matching old truncated success receipt. */
  restoreCreationCard(snapshot: TaskSnapshot): TaskSnapshot {
    // Source admission failure cannot authorize an overlay or prevent viewing
    // the original cancelled/failed native task. Mutation/source APIs stay closed.
    if(this.userFactWriteFailure || this.userFactsSealed)return snapshot;
    const operation = this.read(snapshot.taskId);
    if (!operation?.result || operation.prompt !== snapshot.prompt) return snapshot;
    const raw = JSON.stringify(operation.result);
    const compact = compactProjectCreationResponse(raw);
    if (!compact) return snapshot;
    let changed = false;
    const events = snapshot.events.map(event => {
      if (event.type !== 'canvas_tool_result' || event.toolName !== 'create_project' || !event.ok
        || event.response.length !== 10000 || !raw.startsWith(event.response)) return event;
      changed = true;
      return { ...event, response: compact };
    });
    return changed ? { ...snapshot, events } : snapshot;
  }

  private filename(taskId: string): string | undefined {
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(taskId) ? join(this.directory, `${taskId}.json`) : undefined;
  }
  private currentCreationSource(taskId: string): ProjectUserSourceIdentity | undefined {
    const proof = this.readProjectUserSource(taskId);
    return proof ? resolveProjectUserSourceProof(proof) : undefined;
  }
  private creationKey(taskId: string, source?: ProjectUserSourceIdentity): string {
    const key = source ? JSON.stringify(['main-project-create-v1', source.profileId, source.workspaceId, source.canonicalMessageId]) : taskId;
    return `conversation-project:${createHash('sha256').update(key).digest('hex')}`;
  }
  private operationFilename(taskId: string): string | undefined {
    const legacy = this.filename(taskId);
    const fact=this.readUserTaskFact(taskId);
    if(fact&&fact.schemaVersion!==1 && fact.workspaceId!==this.userFactWorkspaceId)throw Error('conversation_project_workspace_mismatch');
    const source = this.currentCreationSource(taskId);
    if (!source) return legacy;
    // Never silently abandon a pre-canonical pending operation or replay it
    // under a second key. Legacy v1 source records retain their original path.
    if (legacy && existsSync(legacy)) throw Error('conversation_project_legacy_source_reconciliation_required');
    return join(this.directory, `canonical-${this.creationKey(taskId, source).split(':')[1]}.json`);
  }
  private read(taskId: string): Operation | undefined {
    if(this.refusedPreparations.has(taskId))return undefined;
    const filename = this.operationFilename(taskId);
    if (!filename || !existsSync(filename)) return undefined;
    const canonicalFile=filename!==this.filename(taskId);
    try {
      const value = JSON.parse(readFileSync(filename, 'utf8')) as Operation;
      const canonical = value.schemaVersion === 5 && value.canonicalSource
        && JSON.stringify(this.currentCreationSource(taskId)) === JSON.stringify(value.canonicalSource)
        && JSON.stringify(this.currentCreationSource(value.taskId)) === JSON.stringify(value.canonicalSource)
        && value.canonicalSource.promptSha256 === promptDigest(value.prompt)
        && value.canonicalSource.threadId === value.originThreadId
        && value.canonicalSource.permissionMode !== 'plan'
        && value.clientRequestKey === this.creationKey(taskId, value.canonicalSource);
      const direct = ([1, 2].includes(value.schemaVersion) || canonical && !value.confirmedFromTaskId) && requestsCreation(value.prompt);
      const confirmation = value.schemaVersion === 4 || canonical && Boolean(value.confirmedFromTaskId);
      const current = confirmation ? this.readUserTaskFact(value.taskId) : undefined;
      const previous = confirmation && value.confirmedFromTaskId ? this.readUserTaskFact(value.confirmedFromTaskId) : undefined;
      const confirmed = confirmation && confirmsCreation(value.prompt) && current && previous
        && current.threadId === value.originThreadId && previous.threadId === value.originThreadId
        && current.sessionId === value.currentUserSessionId && previous.sessionId === value.confirmedFromSessionId
        && current.promptSha256 === promptDigest(value.prompt) && current.permissionMode !== 'plan';
      // Old completed receipts remain historical facts; an unqualified schema3
      // pending intent cannot acquire new creation authority on upgrade.
      const historicalReceipt = [1,2,3,4,5].includes(value.schemaVersion) && record(value.result)
        && (text(value.result.projectId) || record(value.result.project) && text(value.result.project.id));
      const valid=(value.schemaVersion === 5 ? canonical : value.taskId === taskId) && (direct || confirmed || historicalReceipt);
      if(!valid && canonicalFile)throw Error('conversation_project_operation_invalid');
      return valid ? value : undefined;
    } catch (error) {
      if(canonicalFile)throw Error('conversation_project_operation_invalid',{cause:error});
      return undefined;
    }
  }
  private save(operation: Operation): void {
    const filename = this.operationFilename(operation.taskId);
    if (!filename) throw new Error('conversation_project_task_id_invalid');
    writeFileAtomicallySync(filename, JSON.stringify(operation));
  }
  private async request(path: string, body?: RecordValue, signal?: AbortSignal): Promise<RecordValue> {
    signal?.throwIfAborted();
    const response = await this.options.kswarmService.request(path, body ? {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-kswarm-mutation-token': this.options.kswarmService.getDesktopMutationToken() },
      body: JSON.stringify(body),
    } : { signal,headers:{'x-kswarm-mutation-token':this.options.kswarmService.getDesktopMutationToken()} });
    const result: unknown = await response.json();
    if (!response.ok || !record(result) || result.ok === false) {
      throw new Error(record(result) ? text(result.error) || text(result.code) || `http_${response.status}` : 'kswarm_response_invalid');
    }
    return result;
  }
  private actor() {
    return { sessionId: 'desktop-main-user', requestSource: 'user' as const,
      actor: { kind: 'user' as const, userId: 'user.local' }, allowedLogicalAgentIds: [], issuedAt: new Date().toISOString() };
  }
  private async receipt(operation: Operation, result: RecordValue): Promise<RecordValue> {
    const project = record(result.project) ? result.project : undefined;
    if (!text(project?.id)) throw new Error('conversation_project_creation_missing_id');
    const receipt = { ...result, ok: true, created: true, projectId: text(project?.id), roomId: operation.roomId };
    operation.result = receipt;
    this.save(operation);
    return this.observeReceipt(operation, await this.resumeInitialPlanning(operation,receipt));
  }

  private async resumeInitialPlanning(operation:Operation,receipt:RecordValue):Promise<RecordValue>{
    if(!operation.initialPlanProducer || !this.options.initialPlanBootstrap)return receipt;
    const project=record(receipt.project)?receipt.project:undefined;
    let planningStart:RecordValue;
    try{
      if(!project || text(project.id)!==text(receipt.projectId) || project.clientRequestKey!==operation.clientRequestKey
        || project.primaryRoomId!==operation.roomId)throw Error('initial_plan_owner_binding_unverified');
      const state=await this.request(`/projects/${encodeURIComponent(text(project.id))}/initial-plan-inputs`);
      const owner=state.ownerBinding;
      if(!record(owner) || owner.protocol!=='ordinary_initial_plan_v1' || owner.projectId!==project.id
        || owner.profileId!==this.userFactProfileId || owner.workspaceId!==this.userFactWorkspaceId
        || owner.canonicalCreateOperationId!==operation.clientRequestKey || owner.planGeneration!==1
        || typeof owner.canonicalCreateDigest!=='string' || !/^[a-f0-9]{64}$/.test(owner.canonicalCreateDigest)
        || typeof owner.enqueueKey!=='string' || !/^initial-plan:[a-f0-9]{64}$/.test(owner.enqueueKey)
        || state.startPolicy!==operation.startPolicy)throw Error('initial_plan_owner_binding_unverified');
      if(project.requiredProtocol==='room_workspace_v1' && (!record(project.workspaceMapping)||project.workspaceMapping.state!=='active')){
        planningStart={sent:false,reason:'workspace_mapping_required'};
      }else{
        const result=this.options.initialPlanBootstrap.enqueue({projectId:text(project.id),projectName:text(project.name),goal:text(project.goal),
          requirements:text(project.requirements),planningGuidance:text(project.planningGuidance),poAgent:text(project.poAgent),
          members:Array.isArray(project.members)?project.members.map(text).filter(Boolean):[],startPolicy:operation.startPolicy,
          ownerBinding:owner as unknown as NonNullable<KSwarmInitialPlanBootstrapPayload['ownerBinding']>});
        planningStart=result.ok?{sent:false,reason:'desktop_main_bootstrap',status:result.status}:{sent:false,reason:result.error};
      }
    }catch(error){planningStart={sent:false,reason:error instanceof Error?error.message:'initial_plan_owner_unavailable'};}
    const result={...receipt,planningStart};operation.result=result;this.save(operation);return result;
  }

  private async observeReceipt(operation: Operation, receipt: RecordValue): Promise<RecordValue> {
    if (!this.options.activityHooks || !operation.originThreadId || !operation.activityOperationId) return receipt;
    try {
      const project = record(receipt.project) ? receipt.project : {};
      const activity = await this.options.activityHooks.created({ threadId: operation.originThreadId,
        operationId: operation.activityOperationId, projectId: text(receipt.projectId) || text(project.id), roomId: operation.roomId, project });
      const result = { ...receipt, ...activity, activityStatus: 'active' };
      operation.result = result; this.save(operation); return result;
    } catch (error) {
      // The source commit is already real. Observation failure never reruns it.
      const result = { ...receipt, activityStatus: 'pending', activityError: error instanceof Error ? error.message : 'activity_binding_unavailable' };
      operation.result = result; this.save(operation); return result;
    }
  }

  private async execute(operation: Operation, input: RecordValue, signal?: AbortSignal): Promise<RecordValue> {
    if (!this.roomClient) return { ok: false, error: 'conversation_project_room_service_unavailable' };
    try {
      if (operation.creationAttempt === 'sent_unknown') {
        // A prior process may have committed the POST without recording its
        // response. Only owner observation can resolve it; no retry POST here.
        const known = await this.request('/projects', undefined, signal);
        const project = Array.isArray(known.projects) ? known.projects.find(value => record(value) && value.clientRequestKey === operation.clientRequestKey) : undefined;
        if (!record(project) || project.primaryRoomId !== operation.roomId) throw Error('conversation_project_creation_outcome_unknown');
        return this.receipt(operation, { ok: true, project, reused: true,
          planningStart: { sent: false, reason: 'creation_response_lost_start_unverified' } });
      }
      if(this.options.initialPlanBootstrap && operation.canonicalSource){
        const capability=await this.request('/desktop/project-protocol',undefined,signal);
        if(capability.protocol!=='ordinary_initial_plan_v1' || capability.producer!=='desktop_main_v1' || !record(capability.scope)
          || capability.scope.profileId!==this.userFactProfileId || capability.scope.workspaceId!==this.userFactWorkspaceId)throw Error('initial_plan_producer_unavailable');
        const producer={protocol:'ordinary_initial_plan_v1' as const,canonicalCreateOperationId:operation.clientRequestKey,profileId:this.userFactProfileId,workspaceId:this.userFactWorkspaceId};
        if(operation.initialPlanProducer && JSON.stringify(operation.initialPlanProducer)!==JSON.stringify(producer))throw Error('initial_plan_producer_conflict');
        operation.initialPlanProducer=producer;this.save(operation);
      }
      const proposal = operation.proposal ?? input;
      const name = text(proposal.name), goal = text(proposal.goal), poAgent = text(proposal.poAgent);
      if (!name || !goal || !poAgent) throw new Error('conversation_project_input_invalid');
      const workFolder = text(proposal.workFolder);
      if (workFolder && !isUserRequestedProjectFolder(operation.prompt,workFolder)) throw new Error('conversation_project_workfolder_not_authorized');
      const count = Number(proposal.memberCount ?? 0);
      if (!Number.isSafeInteger(count) || count < 0 || count > 10) throw new Error('conversation_project_member_count_invalid');
      const agentResult = await this.request('/agents', undefined, signal);
      const agents = Array.isArray(agentResult.agents) ? agentResult.agents.filter(record) : [];
      if (!agents.some(agent => agent.id === poAgent && !agent.archivedAt)) throw new Error('conversation_project_po_unavailable');
      const named = Array.isArray(proposal.memberNames) ? proposal.memberNames.map(text).filter(Boolean) : [];
      const members = [...new Set((Array.isArray(proposal.members) ? proposal.members : []).map(text).filter(id => id && id !== poAgent))];
      for (const value of named) {
        const agent = agents.find(agent => !agent.archivedAt && (agent.id === value || agent.name === value));
        if (!agent) throw new Error('conversation_project_named_agent_unavailable');
        if (agent.id !== poAgent && !members.includes(String(agent.id))) members.push(String(agent.id));
      }
      for (const id of members) if (!agents.some(agent => agent.id === id && !agent.archivedAt)) throw new Error('conversation_project_member_unavailable');
      operation.proposal ??= { ...proposal };
      this.save(operation);

      const expectedWorkers = Math.max(count, members.length, 1);
      for (let slot = 0; members.length < expectedWorkers; slot++) {
        const suffix = createHash('sha256').update(`${operation.clientRequestKey}:worker:${slot}`).digest('hex').slice(0, 12);
        const id = `xiaok-worker-${suffix}`;
        if (members.includes(id)) continue;
        const existing = agents.find(agent => agent.id === id && !agent.archivedAt);
        if (existing) {
          const provenance = record(existing.provisioning) ? existing.provisioning : {};
          if (provenance.operationId !== operation.clientRequestKey || provenance.roleKey !== `worker:${slot}`) throw new Error('conversation_project_worker_identity_conflict');
        } else {
          const created = await this.request('/agents', { id, name: `${name} · worker ${slot + 1} (${suffix.slice(0, 6)})`,
            runtimeType: 'xiaok', runtimeSource: 'desktop-agent-runtime', roles: ['worker'],
            provisioning: { operationId: operation.clientRequestKey, roleKey: `worker:${slot}` } }, signal);
          if (!record(created.agent) || created.agent.id !== id) throw new Error('conversation_project_worker_creation_invalid');
          agents.push(created.agent);
        }
        members.push(id);
      }

      signal?.throwIfAborted();
      if (!operation.roomId) {
        const created = await this.roomClient.createRoom({ title: name, description: goal,
          memberAgentIds: [poAgent, ...members], clientRequestKey: `${operation.clientRequestKey}:room` }, this.actor());
        if (!record(created) || created.ok === false || !record(created.room) || !text(created.room.roomId)) throw new Error(record(created) ? text(created.code) || 'conversation_project_room_creation_failed' : 'conversation_project_room_creation_failed');
        operation.roomId = text(created.room.roomId); this.save(operation);
      }
      signal?.throwIfAborted();
      if (!operation.sourceMessageId) {
        // Recording provenance must not dispatch a second discussion worker.
        const sent = await this.roomClient.sendRoomMessage({ roomId: operation.roomId, text: operation.prompt,
          mentions: [], responsePolicy: 'mentioned', idempotencyKey: `${operation.clientRequestKey}:source` }, this.actor());
        if (!record(sent) || sent.ok === false || !record(sent.message) || !text(sent.message.messageId)) throw new Error(record(sent) ? text(sent.code) || 'conversation_project_source_record_failed' : 'conversation_project_source_record_failed');
        operation.sourceMessageId = text(sent.message.messageId); this.save(operation);
      }
      signal?.throwIfAborted();
      const snapshot = await this.roomClient.getRoomSnapshot(operation.roomId);
      if (!record(snapshot) || snapshot.ok === false) throw new Error('conversation_project_room_snapshot_unavailable');
      const room = record(snapshot.room) ? snapshot.room : {};
      const payload: RecordValue = { name, goal, requirements: text(proposal.requirements), planningGuidance: text(proposal.planningGuidance),
        poAgent, members, executionMode: proposal.executionMode, requestedStartPolicy: operation.startPolicy,
        agentSelection: { poAgent: { agentId: poAgent, source: 'room_selection' }, members: members.map(agentId => ({ agentId, source: 'room_selection' })) },
        primaryRoomId: operation.roomId, sourceMessageIds: [operation.sourceMessageId], clientRequestKey: operation.clientRequestKey,
        expectedRoomRevision: room.revision, requestSource: 'user', ...(workFolder ? { workFolder } : {}),
        ...(operation.initialPlanProducer?{initialPlanProducer:operation.initialPlanProducer}:{}),
        ...((snapshot.requiredProtocol ?? room.requiredProtocol) === 'room_workspace_v1' ? { requiredProtocol: 'room_workspace_v1' } : {}) };
      operation.creationAttempt = 'sent_unknown';
      this.save(operation); // Durable before the first possible network effect.
      try {
        return this.receipt(operation, await this.request('/projects/room-first', payload, signal));
      } catch (error) {
        // An unknown POST result can already have committed. Query first; never
        // blindly repeat project creation or its initial dispatch.
        const known = await this.request('/projects').catch(() => undefined);
        const project = known && Array.isArray(known.projects) ? known.projects.find(project => record(project) && project.clientRequestKey === operation.clientRequestKey) : undefined;
        if (record(project)) return this.receipt(operation, { ok: true, project, reused: true,
          planningStart: { sent: false, reason: 'creation_response_lost_start_unverified' } });
        throw error;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return { ok: false, error: error instanceof Error ? error.message : 'conversation_project_creation_failed',
        ...(operation.roomId ? { roomId: operation.roomId } : {}) };
    }
  }
}
