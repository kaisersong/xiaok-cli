import {
  createIntrinsicSet,
  settleIntrinsicOperations,
  appendIntrinsic,
  aggregateIntrinsicErrors,
} from '../../src/runtime/verification/intrinsic-async-collection.js';
import { readOptionalOriginalMainAcceptedAdmission } from './main-accepted-root-binding.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { runWithOriginalRootExecutionContext } from '../../src/runtime/verification/original-root-execution-context.js';
import type { OriginalMainAcceptedRootPort,OriginalRoomRootAdmissionPort } from './main-room-root-admission.js';
import {readOptionalOriginalRoomDiscussionAdmission} from './main-room-discussion-binding.js';
import {acceptOriginalRoomRuntimeTurn,readOriginalRoomTurnRunnerPhysicalFate} from './original-room-turn-source.js';
import {
  assertRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
const RoomRuntimeWeakMap = WeakMap,
  roomRuntimeFreeze = Object.freeze,
  roomRuntimeCreate = Object.create;
const RoomRuntimePromise=Promise,roomRuntimeThen=Promise.prototype.then;
const originalRoomRuntimes = new RoomRuntimeWeakMap<
    object,
    OriginalRoomRuntimeAcceptance
  >(),
  roomRuntimeGet = WeakMap.prototype.get,
  roomRuntimeSet = WeakMap.prototype.set,
  roomRuntimeApply = Reflect.apply;
export interface OriginalRoomRuntimeAcceptance {
  readonly runner: Function;
  bind(source: object, context: RoomTurnCustody): void;
  accept(source: object, envelope: CollaborationRoomTurnEnvelope): object;
  read(source: object, proof: object): CollaborationRoomTurnEnvelope;
  current(source: object, proof: object): void;
  physical(source:object,proof:object):Readonly<{waitKnown():Promise<void>;assertKnown():void}>;
  shutdown():Promise<void>;
}
export function readOriginalRoomRuntimeAcceptance(
  runtime: object,
  runner: Function,
): OriginalRoomRuntimeAcceptance {
  const entry = roomRuntimeApply(roomRuntimeGet, originalRoomRuntimes, [
    runtime,
  ]) as OriginalRoomRuntimeAcceptance | undefined;
  if (!entry || entry.runner !== runner)
    throw Error('ROOM_TURN_ORIGINAL_RUNTIME_REQUIRED');
  return entry;
}
import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import { randomUUID } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import type { CollaborationRoomTurnEnvelope } from './collaboration-room-wake-dispatcher.js';
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';
import type {
  RoomWorkspaceExecutionContext,
  RoomWorkspaceRunOptions,
  WorkspaceExecutionPort,
} from './room-workspace-executor.js';
import {
  RoomWorkspaceLocalStore,
  resolveWorkspacePath,
  observeWorkspaceFile,
  workspaceDigest,
  pathWithin,
  type LocalWorkspaceBinding,
} from './room-workspace-local.js';
import type { WorkspaceProjectAdapter } from './room-workspace-project-adapter.js';
import type { KSwarmTaskHandoff } from './kswarm-runtime-bridge.js';
import type {
  RoomExternalDiscussionAdapter,
  RoomExternalDiscussionCapability,
} from '../shared/room-external-discussion.js';
import { buildExternalDiscussionPrompt } from './room-external-discussion-context.js';
import {
  readOriginalKSwarmServiceIdentity,
  readOriginalKSwarmExecutionStartIO,
  type KSwarmService,
  type KSwarmExecutionStartRead,
  type OriginalKSwarmServiceIdentity,
} from './kswarm-service.js';
import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { createRoomTurnCustody } from './original-room-turn-custody.js';
import {
  readKSwarmExecutionStart,
  assertKSwarmExecutionStart,
  type KSwarmExecutionStartContext,
} from './kswarm-execution-start-guard.js';

type PhysicalProof = {
  executorInstanceId: string;
  kind: 'resources-disposed';
  verified: true;
};
const capability = {
  contextVersion: 1,
  resultVersion: 1,
  releaseVersion: 1,
  canSetCwd: true,
  canTrackChildren: true,
  canRelease: true,
};

export interface OriginalRoomProjectRootCandidate {
  readonly kind: 'original_room_project_root_candidate_v1';
  readonly candidateOnly: true;
  readonly scope: Readonly<{ profileId: string; workspaceId: string }>;
  readonly roomId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly claimId: string;
  readonly payloadCanonical: string;
  readonly authorizationRef: string;
}
interface RoomProjectRootSource {
  physical(proof: object): { waitKnown(): Promise<void>; assertKnown(): void };
  service: object;
  read(proof: object): OriginalRoomProjectRootCandidate;
  current(proof: object): void;
  revalidate(proof: object): Promise<void>;
}
const roomProjectSources = new RoomRuntimeWeakMap<
  object,
  RoomProjectRootSource
>();
function projectSource(runtime: unknown): RoomProjectRootSource {
  const row = roomRuntimeApply(roomRuntimeGet, roomProjectSources, [
    runtime,
  ]) as RoomProjectRootSource | undefined;
  if (!row) throw Error('ROOM_PROJECT_ORIGINAL_RUNTIME_REQUIRED');
  return row;
}
export function readOriginalRoomProjectRootBinding(
  runtime: unknown,
  service: unknown,
): void {
  if (projectSource(runtime).service !== service)
    throw Error('ROOM_PROJECT_ORIGINAL_SERVICE_REQUIRED');
}
export function readOriginalRoomProjectRoot(
  runtime: unknown,
  proof: object,
): OriginalRoomProjectRootCandidate {
  return projectSource(runtime).read(proof);
}
export function assertOriginalRoomProjectRootCurrent(
  runtime: unknown,
  proof: object,
): void {
  projectSource(runtime).current(proof);
}
export function revalidateOriginalRoomProjectRoot(
  runtime: unknown,
  proof: object,
): Promise<void> {
  return projectSource(runtime).revalidate(proof);
}
export function readOriginalRoomProjectRootPhysicalFate(
  runtime: unknown,
  proof: object,
): { waitKnown(): Promise<void>; assertKnown(): void } {
  return projectSource(runtime).physical(proof);
}

/** Admission, wake ordering and physical cleanup live in main, never renderer. */
export function createRoomWorkspaceRuntime(options: {
  kswarmService?: KSwarmService;
  store: RoomWorkspaceLocalStore;
  broker: RoomWorkspaceBrokerPort & {
    getInstructions?(
      roomId: string,
      revision: number,
    ): Promise<Record<string, unknown>>;
  };
  wake: {
    claimWake(input: unknown): Promise<unknown>;
    completeWake(input: unknown): Promise<unknown>;
    abandonWake?(input: unknown): Promise<unknown>;
  };
  execute(
    envelope: CollaborationRoomTurnEnvelope,
    claimToken: string,
    workspace?: RoomWorkspaceRunOptions,
    discussionSignal?: AbortSignal,
    beforeEffects?: () => void,
  ): Promise<{ text: string }>;
  ensureProtocol(): Promise<void>;
  flushOutbox?(): Promise<void>;
  projectAdapter?: WorkspaceProjectAdapter;
  externalDiscussion?: {
    resolve(
      logicalAgentId: string,
      beforeEffects?: () => void,
    ): Promise<
      (RoomExternalDiscussionCapability & { logicalAgentId: string }) | null
    >;
    getHostIdentity(roomId: string): Promise<Record<string, unknown>>;
    execute: RoomExternalDiscussionAdapter['execute'];
  };
  executeProject?(input: {
    handoff: KSwarmTaskHandoff;
    workspace: RoomWorkspaceRunOptions;
    targetParticipantId?: string;
    originalRootCandidate?: object;
  }): Promise<unknown>;
  notify?(event: {
    type: 'workspace_changed';
    kind: 'workspace_changed';
    roomId: string;
  }): void;
}) {
  let originalProjectIO:
    | ReturnType<typeof readOriginalKSwarmExecutionStartIO>
    | undefined;
  try {
    originalProjectIO = readOriginalKSwarmExecutionStartIO(
      options.kswarmService,
    );
  } catch {
    /* Ordinary adapters cannot mint an original Root candidate. */
  }
  const projectCustody = createRoomTurnCustody();
  const projectInvocations =
    createIntrinsicSet<ReturnType<typeof createRoomTurnCustody>>();
  const executeOriginalProject = Object.getOwnPropertyDescriptor(
    options,
    'executeProject',
  )?.value;
  const executeOriginalTurn=Object.getOwnPropertyDescriptor(options,'execute')?.value;
  type AcceptedProject = {
    view: OriginalRoomProjectRootCandidate;
    identity: OriginalKSwarmServiceIdentity;
    controller: AbortController;
    currentStart: () => void;
    authorize: () => Promise<void>;
    custody: ReturnType<typeof createRoomTurnCustody>;
    settlement: ReturnType<typeof createRoomTurnCustody>;
    cancellation: ReturnType<typeof createRoomTurnCustody>;
    executorInvoked?: boolean;
    executorFate?: { waitKnown(): Promise<void>; assertKnown(): void };
  };
  const projectRootProofs = new RoomRuntimeWeakMap<object, AcceptedProject>();
  const acceptedProject = (proof: object) => {
    const row = roomRuntimeApply(roomRuntimeGet, projectRootProofs, [proof]) as
      | AcceptedProject
      | undefined;
    if (!row) throw Error('ROOM_PROJECT_ORIGINAL_PROOF_REQUIRED');
    return row;
  };
  const running = new Map<
    string,
    { roomId: string; controller: AbortController }
  >();
  const executions = new Set<Promise<{ ok: boolean }>>();
  const activeRuns = new Map<
    string,
    {
      roomId: string;
      digest: string;
      controller: AbortController;
      promise: Promise<{ ok: boolean }>;
    }
  >();
  const projectPreparations = new Map<
    string,
    {
      roomId: string;
      requestId: string;
      controller: AbortController;
      promise: Promise<Record<string, unknown>>;
    }
  >();
  let shuttingDown = false;
  let turnSource: object | undefined, turnCustody: RoomTurnCustody | undefined;
  interface NativeRoomRun {
    proof?:object;carrier?:object;readonly controller:AbortController;readonly roomId:string;readonly port:OriginalRoomRootAdmissionPort;
    readonly stock:ReturnType<typeof createRoomTurnCustody>;
    readonly runnerFates:Array<Readonly<{waitKnown():Promise<void>;assertKnown():void}>>;
    readonly completion:Promise<void>;finish():void;completed:boolean;externalEntered:boolean;cancelled:boolean;enqueued:boolean;invocationUnknown:boolean;
  }
  const nativeRoomProofs=new RoomRuntimeWeakMap<object,NativeRoomRun>();
  const nativeRoomRuns=new Map<string,{digest:string;promise:Promise<{ok:boolean}>;row:NativeRoomRun}>();
  const acceptedTurns = new RoomRuntimeWeakMap<
      object,
      CollaborationRoomTurnEnvelope
    >(),
    turnGet = WeakMap.prototype.get,
    turnSet = WeakMap.prototype.set;
  const turnCurrent = (source: object, proof: object) => {
    if (
      source !== turnSource ||
      !roomRuntimeApply(turnGet, acceptedTurns, [proof])
    )
      throw Error('ROOM_TURN_ORIGINAL_PROOF_REQUIRED');
    if (shuttingDown) throw Error('workspace_runtime_shutting_down');
    const operation=roomRuntimeApply(turnGet,nativeRoomProofs,[proof]) as NativeRoomRun|undefined;
    if(operation?.completed||operation?.cancelled)throw Error('ROOM_DISCUSSION_SOURCE_CLOSED');
    turnCustody!.accepted();
  };
  const { store, broker } = options;
  const changed = (roomId: string) =>
    options.notify?.({
      type: 'workspace_changed',
      kind: 'workspace_changed',
      roomId,
    });
  async function projectStart(
    projectId: string | undefined,
    signal: AbortSignal,
    custody?: RoomTurnCustody,
  ): Promise<() => void> {
    if (typeof projectId !== 'string' || !projectId.trim())
      throw Error('project_execution_start_project_required');
    const current = (context?: KSwarmExecutionStartContext) => {
      if (shuttingDown) throw Error('workspace_runtime_shutting_down');
      signal.throwIfAborted();
      if (context)
        originalProjectIO
          ? originalProjectIO.assert(projectId, context.receipt)
          : assertKSwarmExecutionStart(options.kswarmService!, context);
    };
    current();
    if (!options.kswarmService)
      throw Error('project_execution_start_reader_unavailable');
    const context = originalProjectIO
      ? {
          projectId,
          receipt: custody
            ? await custody.sdk<KSwarmExecutionStartRead>(
                originalProjectIO.read,
                originalProjectIO,
                [projectId],
              )
            : await originalProjectIO.read(projectId),
        }
      : await readKSwarmExecutionStart(options.kswarmService, projectId);
    const assertCurrent = () => current(context);
    assertCurrent();
    return assertCurrent;
  }
  async function request(
    roomId: string,
    action: string,
    input: Record<string, unknown>,
    custody?: RoomTurnCustody,
  ) {
    const result = custody
      ? await custody.sdk<Record<string, unknown>>(broker.request, broker, [
          roomId,
          action,
          input,
        ])
      : await broker.request(roomId, action, input);
    if (!result.ok)
      throw new Error(String(result.code ?? 'workspace_unavailable'));
    if (!['agent-authorize-read'].includes(action)) changed(roomId);
    return result;
  }
  function bindingFor(context: {
    roomId: string;
    bindingId: string;
    generation: number;
    workspaceId: string;
    originHostId?: string;
  }): LocalWorkspaceBinding {
    const binding = store.getBinding(context.bindingId);
    if (
      !binding ||
      binding.state !== 'active' ||
      binding.roomId !== context.roomId ||
      binding.generation !== context.generation ||
      binding.workspaceId !== context.workspaceId ||
      binding.hostId !== context.originHostId
    )
      throw new Error('workspace_binding_unavailable');
    return binding;
  }
  const echo = (context: RoomWorkspaceExecutionContext) => ({
    claimId: context.claimId,
    logicalAgentId: context.logicalAgentId,
    protocolVersion: context.protocolVersion,
    runId: context.runId,
    executorInstanceId: context.executorInstanceId,
    workspaceId: context.workspaceId,
    originHostId: context.originHostId,
    hostIncarnation: context.hostIncarnation,
    bindingId: context.bindingId,
    generation: context.generation,
    instructionsRevision: context.instructionsRevision,
    ...(context.mappingRevision === undefined
      ? {}
      : { mappingRevision: context.mappingRevision }),
  });
  async function acquire(
    envelope: CollaborationRoomTurnEnvelope,
    parent?: RoomWorkspaceExecutionContext,
    childName?: string,
    signal?: AbortSignal,
    taskId?: string,
    beforeEffects: () => void = () => {},
  ) {
    beforeEffects();
    signal?.throwIfAborted();
    const project =
      envelope.contextScope.kind === 'project'
        ? await options.projectAdapter?.resolve({
            roomId: envelope.roomId,
            projectId: String(envelope.contextScope.projectId),
            logicalAgentId: envelope.logicalAgentId,
            taskId:
              taskId ??
              (typeof parent?.taskId === 'string' ? parent.taskId : undefined),
          })
        : undefined;
    beforeEffects();
    signal?.throwIfAborted();
    if (envelope.contextScope.kind === 'project' && !project?.task)
      throw new Error('workspace_project_task_required');
    const requestKey = workspaceDigest('acquire-request', {
      roomId: envelope.roomId,
      messageId: envelope.roomMessageId,
      logicalAgentId: envelope.logicalAgentId,
      parentClaimId: parent?.claimId ?? null,
      childName: childName ?? null,
    });
    const previousAdmission = store.getRecord<Record<string, unknown>>(
      'admission-request',
      requestKey,
    );
    if (previousAdmission?.request && previousAdmission.state !== 'received')
      throw new Error('workspace_admission_recovery_pending');
    const admission = (previousAdmission?.request as
      | Record<string, unknown>
      | undefined) ??
      previousAdmission ?? {
        runId: randomUUID(),
        executorInstanceId: randomUUID(),
        logicalAgentId: envelope.logicalAgentId,
        taskName: childName ?? envelope.logicalAgentId,
        contextScope: envelope.contextScope,
        capability,
        ...(project
          ? {
              taskId: project.task!.id,
              projectMappingRevision: project.mapping.mappingRevision,
            }
          : {}),
        ...(parent ? { parentClaimId: parent.claimId } : {}),
      };
    const journal = {
      requestKey,
      roomId: envelope.roomId,
      ownerPid: process.pid,
      state: 'requesting',
      request: admission,
    };
    store.saveRecord('admission-request', requestKey, journal);
    let result: Record<string, unknown>;
    try {
      result = await request(envelope.roomId, 'acquire', admission);
    } catch (error) {
      store.saveRecord('admission-request', requestKey, {
        ...journal,
        state: 'no-executor',
      });
      throw error;
    }
    const claim = result.claim as unknown as RoomWorkspaceExecutionContext;
    try {
      store.saveRecord('physical-claim', claim.claimId, {
        claim,
        ownerPid: process.pid,
        kind: 'in-process-tracked',
        released: false,
      });
      store.saveRecord('admission-request', requestKey, {
        ...journal,
        state: 'received',
        claimId: claim.claimId,
      });
      beforeEffects();
      signal?.throwIfAborted();
      const binding = bindingFor(claim);
      let publishedInstructions = parent?.publishedInstructions ?? '';
      if (!parent && claim.instructionsRevision > 0) {
        const snapshot = broker.getInstructions
          ? await broker.getInstructions(
              envelope.roomId,
              claim.instructionsRevision,
            )
          : await broker.get(envelope.roomId);
        beforeEffects();
        const instructions = snapshot.instructions as
          | {
              revision: number;
              publishedText: string;
              description?: string;
              directoryNotes?: unknown;
              snapshotDigest?: string;
            }
          | undefined;
        if (
          !snapshot.ok ||
          !instructions ||
          instructions.revision !== claim.instructionsRevision ||
          instructions.snapshotDigest !== claim.instructionsDigest
        )
          throw new Error('workspace_instructions_unavailable');
        publishedInstructions = [
          instructions.publishedText,
          instructions.description ?? '',
          JSON.stringify(instructions.directoryNotes ?? []),
        ].join('\n');
      }
      const confirmedDecisions =
        parent?.confirmedDecisions ??
        (await broker.get(envelope.roomId)).decisions ??
        [];
      beforeEffects();
      const scoped = (item: Record<string, unknown>) =>
        item.bindingId === claim.bindingId &&
        item.generation === claim.generation &&
        JSON.stringify(item.contextScope) ===
          JSON.stringify(claim.contextScope);
      const effectiveCwd = project
        ? await resolveWorkspacePath(
            binding,
            relative(binding.canonicalRoot, project.mapping.workFolder),
          )
        : await resolveWorkspacePath(binding, '');
      beforeEffects();
      if (
        project &&
        !pathWithin(binding.canonicalRoot, project.mapping.artifactsDir)
      )
        throw new Error('workspace_project_mapping_outside_root');
      const localCommandsAllowed = store.localCommandsAllowed({
        bindingId: binding.bindingId,
        roomId: claim.roomId,
        generation: claim.generation,
      });
      const context: RoomWorkspaceExecutionContext = {
        ...claim,
        effectiveCwd,
        localCommandsAllowed,
        workspaceRoot: {
          canonicalRoot: binding.canonicalRoot,
          identity: binding.identity,
        },
        publishedInstructions,
        confirmedDecisions,
        artifactRefs:
          parent?.artifactRefs ??
          store.listArtifacts(claim.roomId).filter(scoped),
        handoffRefs:
          parent?.handoffRefs ??
          store.listHandoffs(claim.roomId).filter(scoped),
        ...(childName ? { agentName: childName } : {}),
      };
      await request(context.roomId, 'ack', {
        ...echo(context),
        actualCwd: context.effectiveCwd,
        cwdVerified: true,
      });
      beforeEffects();
      signal?.throwIfAborted();
      return context;
    } catch (error) {
      // No executor has been entered. Persist this physical fact even if the
      // remote release fails; it is recoverable, never a fabricated timeout.
      await physicalRelease(claim, {
        executorInstanceId: claim.executorInstanceId,
        kind: 'resources-disposed',
        verified: true,
      }).catch(() => undefined);
      throw error;
    }
  }
  async function physicalRelease(
    context: RoomWorkspaceExecutionContext,
    proof: PhysicalProof,
    custody?: RoomTurnCustody,
  ) {
    store.saveRecord('physical-claim', context.claimId, {
      claim: context,
      ownerPid: process.pid,
      kind: 'in-process-tracked',
      released: false,
      releasePending: proof,
    });
    await request(
      context.roomId,
      'release',
      {
        ...echo(context),
        cleanupOutcome: 'released',
        terminationEvidence: proof,
      },
      custody,
    );
    if (custody) await custody.waitPhysicalKnown();
    store.saveRecord('physical-claim', context.claimId, {
      claim: context,
      ownerPid: process.pid,
      kind: 'in-process-tracked',
      released: true,
    });
  }
  async function executeRun(
    envelope: CollaborationRoomTurnEnvelope,
    controller: AbortController,
    native?:{row:NativeRoomRun;port:OriginalRoomRootAdmissionPort;claim:Readonly<{claimToken:string;claimLeaseUntil:string}>},
  ) {
    if (shuttingDown) throw new Error('workspace_runtime_shutting_down');
    const originalBeforeEffects =
      envelope.contextScope.kind === 'project'
        ? await projectStart(envelope.contextScope.projectId, controller.signal)
        : () => {
            if (shuttingDown) throw Error('workspace_runtime_shutting_down');
            controller.signal.throwIfAborted();
          };
    const beforeEffects=()=>{originalBeforeEffects();if(native){if(native.row.completed||!native.row.proof||!native.row.carrier)throw Error('ROOM_DISCUSSION_SOURCE_CLOSED');native.port.readRoomLaunch(native.row.proof,native.row.carrier);}};
    const invokeRunner=async(...args:Parameters<typeof options.execute>)=>{
      if(!native)return options.execute(...args);
      let raw:unknown;let entered=false;
      const result=native.row.stock.sdk<{text:string}>(()=>{beforeEffects();entered=true;raw=roomRuntimeApply(executeOriginalTurn,undefined,args);return raw;},undefined,[]);
      let first:{raw:unknown}|undefined,value:{text:string}|undefined;
      try{value=await result;}catch(error){first={raw:error};}
      if(entered){
        if(raw===undefined)native.row.invocationUnknown=true;
        else try{const fate=readOriginalRoomTurnRunnerPhysicalFate(turnSource!,originalRuntime,raw,native.row.carrier);appendIntrinsic(native.row.runnerFates,fate);}
        catch(error){native.row.invocationUnknown=true;native.row.stock.inventory(error);if(!first)first={raw:error};}
      }
      if(first)throw first.raw;return value!;
    };
    const roomRequest=(roomId:string,action:string,input:Record<string,unknown>)=>request(roomId,action,input,native?.row.stock);
    const completeWake=(input:unknown)=>{if(native){beforeEffects();return native.row.stock.sdk<unknown>(options.wake.completeWake,options.wake,[input]);}return options.wake.completeWake(input);};
    beforeEffects();
    let heldWakeToken: string | undefined;
    const executeBody = async () => {
      const snapshot = native?await native.row.stock.sdk<Awaited<ReturnType<typeof broker.get>>>(broker.get,broker,[envelope.roomId]):await broker.get(envelope.roomId);
      beforeEffects();
      if (!snapshot.ok)
        throw new Error(String(snapshot.code ?? 'broker_unavailable'));
      const config = snapshot.config as {
        workspaceId?: string;
        phase?: string;
      } | null;
      const external = await options.externalDiscussion?.resolve(
        envelope.logicalAgentId,
        beforeEffects,
      );
      beforeEffects();
      if (external) {
        if(native)native.row.externalEntered=true;
        if (external.logicalAgentId !== envelope.logicalAgentId)
          throw new Error('discussion_identity_mismatch');
        if (
          !external.supported ||
          external.protocol !== 'room_discussion_v1' ||
          !external.proof ||
          [
            'freshSession',
            'toolsDisabled',
            'mcpDisabled',
            'hooksDisabled',
          ].some(
            (key) =>
              external.proof?.[key as keyof typeof external.proof] !== true,
          )
        ) {
          throw new Error(external.reason ?? 'discussion_protocol_unavailable');
        }
        const operationId = workspaceDigest('external-discussion', {
          roomId: envelope.roomId,
          sourceMessageId: envelope.roomMessageId,
          logicalAgentId: envelope.logicalAgentId,
        });
        const prior = store.getRecord<Record<string, unknown>>(
          'external-discussion-operation',
          operationId,
        );
        if (prior?.phase === 'completed') return { ok: true };
        if (prior?.phase === 'abandoned')
          throw new Error('discussion_operation_abandoned');
        if (prior) throw new Error('discussion_cleanup_pending');
        const host = await options.externalDiscussion!.getHostIdentity(
          envelope.roomId,
        );
        beforeEffects();
        if (
          host.ok === false ||
          !host.hostId ||
          host.hostIncarnation === undefined
        )
          throw new Error('discussion_host_identity_unavailable');
        let journal: Record<string, unknown> = {
          operationId,
          roomId: envelope.roomId,
          sourceMessageId: envelope.roomMessageId,
          logicalAgentId: envelope.logicalAgentId,
          contextScope: envelope.contextScope,
          runtime: external.runtime,
          hostId: host.hostId,
          hostIncarnation: host.hostIncarnation,
          ownerPid: process.pid,
          phase: 'claiming',
        };
        const save = () =>
          store.saveRecord(
            'external-discussion-operation',
            operationId,
            journal,
          );
        save();
        const wake = native?{ok:true,...native.claim}:await roomRequest(envelope.roomId, 'claim-wake', {
          roomMessageId: envelope.roomMessageId,
          logicalAgentId: envelope.logicalAgentId,
          hostParticipantId: 'xiaok-desktop',
          discussionOnly: true,
        });
        if (typeof wake.claimToken !== 'string')
          throw new Error('workspace_wake_unavailable');
        heldWakeToken = wake.claimToken;
        journal = { ...journal, claimToken: wake.claimToken, phase: 'claimed' };
        save();
        controller.signal.throwIfAborted();
        const result = await options.externalDiscussion!.execute({
          operationId,
          runtime: external.runtime,
          prompt: buildExternalDiscussionPrompt(
            envelope,
            store
              .listBindings(envelope.roomId)
              .map((binding) => binding.canonicalRoot),
          ),
          signal: controller.signal,
          beforeEffects,
          async onPrepared(record) {
            if (
              record.operationId !== operationId ||
              record.runtime !== external.runtime ||
              journal.phase !== 'claimed' ||
              record.ownerPid !== process.pid
            )
              throw new Error('discussion_owner_mismatch');
            journal = { ...journal, ...record };
            save();
            beforeEffects();
          },
          async onNotSpawned(record) {
            if (
              record.operationId !== operationId ||
              record.runtime !== external.runtime ||
              journal.phase !== 'prepared' ||
              record.phase !== 'not-spawned' ||
              record.noSpawnVerified !== true ||
              'pid' in record ||
              'processGroupId' in record ||
              record.ownerPid !== process.pid ||
              record.ownerPid !== journal.ownerPid ||
              record.neutralRoot !== journal.neutralRoot ||
              journal.pid !== undefined ||
              journal.processGroupId !== undefined
            )
              throw new Error('discussion_no_spawn_evidence_required');
            journal = {
              ...journal,
              phase: 'not-spawned',
              noSpawnVerified: true,
            };
            save();
          },
          async onStarted(record) {
            if (
              record.operationId !== operationId ||
              record.runtime !== external.runtime ||
              journal.phase !== 'prepared' ||
              record.neutralRoot !== journal.neutralRoot ||
              !record.processStartIdentity ||
              record.pid <= 0 ||
              record.processGroupId <= 0
            )
              throw new Error('discussion_owner_mismatch');
            journal = { ...journal, ...record };
            save();
            beforeEffects();
          },
          async onExited(record) {
            if (
              record.operationId !== operationId ||
              record.runtime !== external.runtime ||
              record.groupExitVerified !== true ||
              record.pid !== journal.pid ||
              record.processGroupId !== journal.processGroupId ||
              record.processStartIdentity !== journal.processStartIdentity
            )
              throw new Error('discussion_exit_evidence_required');
            journal = { ...journal, ...record };
            save();
          },
        });
        if (
          result.resourcesReleased !== true ||
          journal.phase !== 'released' ||
          journal.groupExitVerified !== true
        )
          throw new Error('discussion_cleanup_pending');
        controller.signal.throwIfAborted();
        const completed = (await completeWake({
          roomId: envelope.roomId,
          claimToken: wake.claimToken,
          reply: result.text
            ? { kind: 'text', text: result.text }
            : { kind: 'pass' },
        })) as { ok: boolean; code?: string };
        if (!completed.ok)
          throw new Error(completed.code ?? 'workspace_wake_failed');
        heldWakeToken = undefined;
        journal = { ...journal, phase: 'completed' };
        save();
        return { ok: true };
      }
      if (!config?.workspaceId) {
        const wakeInput = {
          roomId: envelope.roomId,
          roomMessageId: envelope.roomMessageId,
          logicalAgentId: envelope.logicalAgentId,
          hostParticipantId: 'xiaok-desktop',
        };
        const wake = (native?{ok:true,...native.claim}:
          snapshot.requiredProtocol === 'room_workspace_v1'
            ? await roomRequest(envelope.roomId, 'claim-wake', {
                ...wakeInput,
                discussionOnly: true,
              })
            : await options.wake.claimWake(wakeInput)
        ) as { ok: boolean; claimToken?: string; code?: string };
        if (!wake.ok || !wake.claimToken)
          throw new Error(wake.code ?? 'workspace_wake_unavailable');
        heldWakeToken = wake.claimToken;
        controller.signal.throwIfAborted();
        beforeEffects();
        // Absence of third argument means explicitly discussion-only registry.
        const result = await invokeRunner(
          envelope,
          wake.claimToken,
          undefined,
          controller.signal,
          beforeEffects,
        );
        const complete = (await completeWake({
          roomId: envelope.roomId,
          claimToken: wake.claimToken,
          reply: result.text
            ? { kind: 'text', text: result.text }
            : { kind: 'pass' },
        })) as { ok: boolean; code?: string };
        if (!complete.ok)
          throw new Error(complete.code ?? 'workspace_wake_failed');
        heldWakeToken = undefined;
        return { ok: true };
      }
      if (envelope.contextScope.kind === 'project') {
        // No task reference is present in Room chat. This is explicitly discussion
        // only: guarded broker transport rechecks current project membership and
        // primary Room, while Broker binds the token to the source message scope.
        // File mapping/phase is irrelevant: no cwd, file claim or acceptance.
        const wake = native?{ok:true,...native.claim}:await roomRequest(envelope.roomId, 'claim-wake', {
          roomMessageId: envelope.roomMessageId,
          logicalAgentId: envelope.logicalAgentId,
          hostParticipantId: 'xiaok-desktop',
          discussionOnly: true,
        });
        if (typeof wake.claimToken !== 'string')
          throw new Error('workspace_wake_unavailable');
        heldWakeToken = wake.claimToken;
        controller.signal.throwIfAborted();
        beforeEffects();
        const result = await invokeRunner(
          envelope,
          wake.claimToken,
          undefined,
          controller.signal,
          beforeEffects,
        );
        const completed = (await completeWake({
          roomId: envelope.roomId,
          claimToken: wake.claimToken,
          reply: { kind: 'text', text: result.text },
        })) as { ok: boolean; code?: string };
        if (!completed.ok)
          throw new Error(completed.code ?? 'workspace_wake_failed');
        heldWakeToken = undefined;
        return { ok: true };
      }
      if (config.phase !== 'active') throw new Error('workspace_not_active');
      if(native)await native.row.stock.sdk(options.ensureProtocol,undefined,[]);else await options.ensureProtocol();
      controller.signal.throwIfAborted();
      const context = await acquire(
        envelope,
        undefined,
        undefined,
        controller.signal,
      );
      running.set(context.claimId, { roomId: context.roomId, controller });
      let rootProof: PhysicalProof | undefined;
      let entered = false;
      const port: WorkspaceExecutionPort = {
        async authorize(current, toolName) {
          controller.signal.throwIfAborted();
          if (toolName === 'bash') {
            if (
              !current.localCommandsAllowed ||
              !store.localCommandsAllowed(current)
            )
              throw new Error('room_command_not_authorized');
          }
          const binding = bindingFor(current);
          await resolveWorkspacePath(binding, '');
          await roomRequest(current.roomId, 'agent-authorize-read', {
            ...echo(current),
            contextScope: current.contextScope,
            relativePath: '',
          });
        },
        async acquireChild(input) {
          await port.authorize(input.parent);
          return acquire(
            {
              ...envelope,
              logicalAgentId: input.parent.logicalAgentId,
              contextScope: input.parent.contextScope,
            },
            input.parent,
            `${input.taskName}:${input.turn}`,
            controller.signal,
          );
        },
        async release(current, proof) {
          if (
            proof.verified !== true ||
            proof.executorInstanceId !== current.executorInstanceId
          )
            throw new Error('workspace_release_evidence_required');
          if (current.claimId === context.claimId) rootProof = proof;
          else await physicalRelease(current, proof);
        },
        async submitManifest(current, manifest) {
          await port.authorize(current);
          const binding = bindingFor(current);
          const artifacts = [];
          for (const artifact of manifest.artifacts) {
            const relativePath = isAbsolute(artifact.path)
              ? relative(binding.canonicalRoot, artifact.path)
              : artifact.path;
            artifacts.push(
              await observeWorkspaceFile(
                binding,
                relativePath.replace(/\\/g, '/'),
              ),
            );
          }
          const submissionId = current.runId;
          const value = {
            roomId: current.roomId,
            workspaceId: current.workspaceId,
            originHostId: current.originHostId,
            bindingId: current.bindingId,
            generation: current.generation,
            workspaceRevision: current.workspaceRevision,
            contextScope: current.contextScope,
            producerType: 'agent',
            producerRunId: current.runId,
            producerClaimId: current.claimId,
            producerAgentId: current.logicalAgentId,
            artifacts,
            handoff: {
              reportedSummary: manifest.summary,
              completionStatus: 'unverified',
              unfinished: null,
              blockers: null,
              sourceMessageIds: envelope.messages.map(
                (message) => message.messageId,
              ),
            },
          };
          const payloadDigest = workspaceDigest('manifest', value);
          const subjectKey = `claim:${current.claimId}`;
          store.prepareSubmission({
            subjectKey,
            submissionId,
            payloadDigest,
            manifest: value,
          });
          const issued = await roomRequest(current.roomId, 'agent-ticket', {
            ...echo(current),
            submissionId,
            payloadDigest,
          });
          store.commitSubmission(
            subjectKey,
            issued.ticket as {
              ticketId: string;
              submissionId: string;
              payloadDigest: string;
              commitSequence: number;
            },
          );
          await options.flushOutbox?.();
          changed(current.roomId);
        },
      };
      try {
        const wake = native?{ok:true,...native.claim}:await roomRequest(envelope.roomId, 'claim-wake', {
          claimId: context.claimId,
          logicalAgentId: envelope.logicalAgentId,
          roomMessageId: envelope.roomMessageId,
          hostParticipantId: 'xiaok-desktop',
        });
        if (typeof wake.claimToken !== 'string')
          throw new Error('workspace_wake_unavailable');
        heldWakeToken = wake.claimToken;
        controller.signal.throwIfAborted();
        entered = true;
        const result = await invokeRunner(
          envelope,
          wake.claimToken,
          { context, port, signal: controller.signal, beforeEffects },
          undefined,
          beforeEffects,
        );
        if (!rootProof) throw new Error('workspace_cleanup_pending');
        const complete = (await completeWake({
          roomId: envelope.roomId,
          claimToken: wake.claimToken,
          reply: result.text
            ? { kind: 'text', text: result.text }
            : { kind: 'pass' },
        })) as { ok: boolean; code?: string };
        if (!complete.ok)
          throw new Error(complete.code ?? 'workspace_wake_failed');
        heldWakeToken = undefined;
        return { ok: true };
      } finally {
        if (!entered)
          rootProof = {
            executorInstanceId: context.executorInstanceId,
            kind: 'resources-disposed',
            verified: true,
          };
        if (rootProof) {
          await physicalRelease(context, rootProof);
          running.delete(context.claimId);
        }
        changed(context.roomId);
      }
    };
    const failures: unknown[] = [];
    let result: { ok: boolean } | undefined;
    try {
      result = await executeBody();
    } catch (error) {
      appendIntrinsic(failures, error);
    }
    try {
      if (heldWakeToken) {
        const cleanup = (await options.wake.abandonWake?.({
          roomId: envelope.roomId,
          claimToken: heldWakeToken,
          reason: 'execution_failed',
        })) as { ok?: boolean; code?: string } | undefined;
        if (cleanup?.ok === false)
          throw new Error(cleanup.code ?? 'workspace_wake_cleanup_pending');
      }
    } catch (error) {
      appendIntrinsic(failures, error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw aggregateIntrinsicErrors(failures, 'workspace_execution_cleanup_failed');
    return result!;
  }
  async function cancelRoom(roomId: string) {
    const nativeCancellations:Promise<unknown>[]=[];
    if(turnSource){
      for(const item of nativeRoomRuns.values())if(item.row.roomId===roomId&&!item.row.completed){
        const row=item.row;row.cancelled=true;
        if(row.proof&&row.enqueued&&!row.carrier)appendIntrinsic(nativeCancellations,row.port.cancelRoomLaunch(row.proof));
      }
    }
    for (const entry of projectPreparations.values())
      if (entry.roomId === roomId)
        entry.controller.abort(
          new DOMException('Project admission cancelled', 'AbortError'),
        );
    for (const entry of activeRuns.values())
      if (entry.roomId === roomId)
        entry.controller.abort(
          new DOMException('Room task cancelled by user', 'AbortError'),
        );
    const nativeOutcomes=await Promise.allSettled(nativeCancellations);
    for(let i=0;i<nativeOutcomes.length;i++)if(nativeOutcomes[i]!.status==='rejected')throw (nativeOutcomes[i] as PromiseRejectedResult).reason;
    const cancellations = [];
    for (const [claimId, entry] of running)
      if (entry.roomId === roomId) {
        entry.controller.abort(
          new DOMException('Room task cancelled by user', 'AbortError'),
        );
        cancellations.push(request(roomId, 'cancel', { claimId }));
      }
    const results = await Promise.allSettled(cancellations);
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('workspace_cancel_sync_pending');
    for (const [claimId, entry] of running) {
      const record = store.getRecord<ProjectRecord>(
        'project-execution',
        claimId,
      );
      if (
        entry.roomId === roomId &&
        record &&
        ['prepared', 'dispatched'].includes(record.status) &&
        !projectExecutions.has(claimId)
      ) {
        store.saveRecord('project-execution', claimId, {
          ...record,
          status: 'cancelled',
        });
        await physicalRelease(record.context, {
          executorInstanceId: record.context.executorInstanceId,
          kind: 'resources-disposed',
          verified: true,
        });
        running.delete(claimId);
      }
    }
  }
  type ProjectRecord = {
    context: RoomWorkspaceExecutionContext;
    taskId: string;
    requestId: string;
    status: 'prepared' | 'dispatched' | 'executing' | 'completed' | 'cancelled';
  };
  const projectExecutions = new Map<
    string,
    Promise<{ ok: true } | { ok: false; error: string }>
  >();
  type ProjectPrepareInput = {
    roomId: string;
    projectId: string;
    taskId: string;
    logicalAgentId: string;
    requestId: string;
  };
  async function executePrepareProjectTask(
    input: ProjectPrepareInput,
    controller: AbortController,
    requestKey: string,
  ): Promise<Record<string, unknown>> {
    if (shuttingDown) throw new Error('workspace_runtime_shutting_down');
    if (!options.projectAdapter || !options.executeProject)
      throw new Error('workspace_project_executor_unavailable');
    if (!input.requestId)
      throw new Error('workspace_project_request_id_required');
    const identityKey = workspaceDigest('project-request-identity', {
      roomId: input.roomId,
      requestId: input.requestId,
    });
    const identity = store.getRecord<{ payloadDigest: string }>(
      'project-request-identity',
      identityKey,
    );
    if (identity && identity.payloadDigest !== requestKey)
      throw new Error('workspace_idempotency_conflict');
    const saved = store.getRecord<{ claimId: string }>(
      'project-request',
      requestKey,
    );
    const previous = saved
      ? store.getRecord<ProjectRecord>('project-execution', saved.claimId)
      : null;
    if (previous?.status === 'completed')
      return {
        ok: true,
        claimId: previous.context.claimId,
        runId: previous.context.runId,
        reused: true,
      };
    if (previous?.status === 'cancelled')
      throw new Error('workspace_project_request_cancelled');
    const beforeEffects = await projectStart(
      input.projectId,
      controller.signal,
    );
    beforeEffects();
    const currentIdentity = store.getRecord<{ payloadDigest: string }>(
      'project-request-identity',
      identityKey,
    );
    if (currentIdentity && currentIdentity.payloadDigest !== requestKey)
      throw Error('workspace_idempotency_conflict');
    store.saveRecord('project-request-identity', identityKey, {
      payloadDigest: requestKey,
    });
    await options.ensureProtocol();
    beforeEffects();
    const envelope: CollaborationRoomTurnEnvelope = {
      roomId: input.roomId,
      roomTitle: 'Project task',
      roomRevision: 0,
      roomMessageId: `project-task:${input.requestId}`,
      logicalAgentId: input.logicalAgentId,
      contextScope: { kind: 'project', projectId: input.projectId },
      messages: [],
      attachmentPaths: [],
      contextWindow: {
        fromSequence: 0,
        toSequence: 0,
        totalMessages: 0,
        isComplete: true,
        snapshotAt: new Date().toISOString(),
      },
    };
    const context =
      previous?.context ??
      (await acquire(
        envelope,
        undefined,
        undefined,
        controller.signal,
        input.taskId,
        beforeEffects,
      ));
    let dispatchAttempted = false;
    try {
      beforeEffects();
      const prior = store.getRecord<ProjectRecord>(
        'project-execution',
        context.claimId,
      );
      if (prior && ['executing', 'completed'].includes(prior.status))
        return {
          ok: true,
          claimId: context.claimId,
          runId: context.runId,
          reused: true,
        };
      const record: ProjectRecord = {
        context,
        taskId: String(context.taskId),
        requestId: input.requestId,
        status: 'prepared',
      };
      store.saveRecord('project-execution', context.claimId, record);
      store.saveRecord('project-request', requestKey, {
        claimId: context.claimId,
      });
      running.set(context.claimId, { roomId: context.roomId, controller });
      // A lost response is not evidence that no handoff was sent. The pending
      // record/claim remains authoritative and can be retried using requestId.
      beforeEffects();
      dispatchAttempted = true;
      const dispatched = await options.projectAdapter.dispatch(
        context,
        record.taskId,
        controller.signal,
        beforeEffects,
      );
      const latest = store.getRecord<ProjectRecord>(
        'project-execution',
        context.claimId,
      )!;
      if (latest.status === 'prepared')
        store.saveRecord('project-execution', context.claimId, {
          ...latest,
          status: 'dispatched',
        });
      changed(context.roomId);
      return {
        ok: true,
        claimId: context.claimId,
        runId: context.runId,
        dispatched,
      };
    } catch (error) {
      // A newly returned local claim has no handoff until dispatch is invoked.
      // Once that call begins, a lost ACK is never evidence of no executor.
      if (!previous && !dispatchAttempted) {
        await physicalRelease(context, {
          executorInstanceId: context.executorInstanceId,
          kind: 'resources-disposed',
          verified: true,
        });
        running.delete(context.claimId);
      }
      throw error;
    }
  }
  function prepareProjectTask(input: ProjectPrepareInput) {
    input = {
      roomId: input.roomId,
      projectId: input.projectId,
      taskId: input.taskId,
      logicalAgentId: input.logicalAgentId,
      requestId: input.requestId,
    };
    const key = workspaceDigest('project-prepare-request', input);
    const prior = projectPreparations.get(key);
    if (prior) return prior.promise;
    if (
      [...projectPreparations.values()].some(
        (value) =>
          value.roomId === input.roomId && value.requestId === input.requestId,
      )
    )
      return Promise.reject(Error('workspace_idempotency_conflict'));
    const controller = new AbortController();
    const promise = executePrepareProjectTask(input, controller, key);
    projectPreparations.set(key, {
      roomId: input.roomId,
      requestId: input.requestId,
      controller,
      promise,
    });
    const tracked = promise.then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    );
    executions.add(tracked);
    void promise
      .finally(() => {
        projectPreparations.delete(key);
        executions.delete(tracked);
      })
      .catch(() => {});
    return promise;
  }
  type ProjectNativeState = {
    proof?: object;
    native?: OriginalMainAcceptedRootPort;
    enqueued?: boolean;
    consumed?: boolean;
    cancel?: Promise<void>;
    settlement: ReturnType<typeof createRoomTurnCustody>;
  };
  function cancelProjectQueued(state: ProjectNativeState): Promise<void> {
    if (state.cancel) return state.cancel;
    const row = acceptedProject(state.proof!);
    state.cancel = row.cancellation.sdk<void>(
      state.native!.cancelQueued,
      state.native,
      [state.proof!],
    );
    void state.cancel.catch(() => {});
    return state.cancel;
  }
  async function executeProjectHandoff(
    input: Parameters<typeof executeProjectHandoffBody>[0],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const custody = createRoomTurnCustody(),
      state: ProjectNativeState = { settlement: createRoomTurnCustody() };
    projectInvocations.add(custody);
    let result: { ok: true } | { ok: false; error: string } | undefined,
      primary: unknown,
      present = false;
    try {
      result = await custody.root(() =>
        executeProjectHandoffBody(input, custody, state),
      );
    } catch (error) {
      primary = error;
      present = true;
      custody.inventory(error);
    }
    if (state.enqueued && !state.consumed)
      try {
        await cancelProjectQueued(state);
      } catch (error) {
        if (!present) {
          primary = error;
          present = true;
        }
      }
    if (state.cancel)
      try {
        await state.cancel;
      } catch (error) {
        if (!present) {
          primary = error;
          present = true;
        }
      }
    let known = true;
    try {
      await custody.waitPhysicalKnown();
      await state.settlement.waitPhysicalKnown();
    } catch (error) {
      known = false;
      if (!present) {
        primary = error;
        present = true;
      }
    }
    if (known && state.native && state.proof && state.consumed) {
      const cleanup = createRoomTurnCustody();
      try {
        await cleanup.sdk(state.native.finish, state.native, [
          state.proof,
          state.proof,
        ]);
      } catch (error) {
        cleanup.inventory(error);
        if (!present) {
          primary = error;
          present = true;
        }
      }
      try {
        await cleanup.waitPhysicalKnown();
      } catch (error) {
        if (!present) {
          primary = error;
          present = true;
        }
      }
    }
    if (present) throw primary;
    return result!;
  }
  async function executeProjectHandoffBody(
    input: {
      handoff: KSwarmTaskHandoff;
      targetParticipantId?: string;
      signal?: AbortSignal;
      beforeEffects?: () => void;
    },
    custody: ReturnType<typeof createRoomTurnCustody>,
    state: ProjectNativeState,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const { handoff } = input,
      claimId = String(handoff.workspaceContext?.claimId ?? '');
    const record = await custody.sdk<ProjectRecord | null>(
      store.getRecord,
      store,
      ['project-execution', claimId],
    );
    if (!record || !options.projectAdapter || !options.executeProject)
      return { ok: false, error: 'workspace_project_admission_required' };
    if (record.status === 'completed') return { ok: true };
    const context = record.context;
    if (
      record.status === 'cancelled' ||
      handoff.runId !== context.runId ||
      handoff.task.id !== record.taskId ||
      handoff.project.id !==
        (context.contextScope.kind === 'project'
          ? context.contextScope.projectId
          : '') ||
      (input.targetParticipantId &&
        input.targetParticipantId !== context.logicalAgentId)
    )
      return { ok: false, error: 'workspace_project_handoff_mismatch' };
    for (const key of [
      'workspaceId',
      'originHostId',
      'hostIncarnation',
      'bindingId',
      'generation',
      'mappingRevision',
      'executorInstanceId',
    ] as const)
      if (handoff.workspaceContext?.[key] !== context[key])
        return { ok: false, error: 'workspace_project_handoff_mismatch' };
    const controller =
      running.get(claimId)?.controller ?? new AbortController();
    const signal = input.signal
      ? AbortSignal.any([controller.signal, input.signal])
      : controller.signal;
    assertBeforeEffects(input.beforeEffects);
    const currentStart = await projectStart(
      handoff.project.id,
      signal,
      custody,
    );
    const beforeEffects = () => {
      assertBeforeEffects(input.beforeEffects);
      currentStart();
    };
    beforeEffects();
    let rootProof: PhysicalProof | undefined,
      entered = false;
    running.set(claimId, { roomId: context.roomId, controller });
    const port: WorkspaceExecutionPort = {
      async authorize(current) {
        beforeEffects();
        const binding = bindingFor(current);
        await resolveWorkspacePath(binding, '');
        beforeEffects();
        await options.projectAdapter!.authorize(current, record.taskId);
        beforeEffects();
        await request(
          current.roomId,
          'agent-authorize-read',
          {
            ...echo(current),
            contextScope: current.contextScope,
            relativePath: '',
          },
          custody,
        );
        beforeEffects();
      },
      async acquireChild(child) {
        await port.authorize(child.parent);
        beforeEffects();
        const childStart = await projectStart(
          handoff.project.id,
          signal,
          custody,
        );
        beforeEffects();
        childStart();
        const envelope: CollaborationRoomTurnEnvelope = {
          roomId: context.roomId,
          roomTitle: 'Project child',
          roomRevision: 0,
          roomMessageId: `project-task:${record.requestId}`,
          logicalAgentId: context.logicalAgentId,
          contextScope: context.contextScope,
          messages: [],
          attachmentPaths: [],
          contextWindow: {
            fromSequence: 0,
            toSequence: 0,
            totalMessages: 0,
            isComplete: true,
            snapshotAt: new Date().toISOString(),
          },
        };
        return acquire(
          envelope,
          child.parent,
          `${child.taskName}:${child.turn}`,
          signal,
          record.taskId,
          () => {
            beforeEffects();
            childStart();
          },
        );
      },
      async release(current, proof) {
        if (
          proof.verified !== true ||
          proof.executorInstanceId !== current.executorInstanceId
        )
          throw new Error('workspace_release_evidence_required');
        if (current.claimId === claimId) rootProof = proof;
        else await physicalRelease(current, proof, state.settlement);
      },
      async submitManifest(current, manifest) {
        if (current.claimId !== claimId)
          throw new Error('workspace_project_root_submission_required');
        const info = await options.projectAdapter!.authorize(
          current,
          record.taskId,
        );
        await port.authorize(current);
        const binding = bindingFor(current),
          artifacts = [];
        for (const artifact of manifest.artifacts) {
          const absolute = isAbsolute(artifact.path)
            ? artifact.path
            : await resolveWorkspacePath(
                binding,
                relative(binding.canonicalRoot, current.effectiveCwd) +
                  '/' +
                  artifact.path,
              );
          if (!pathWithin(info.mapping.artifactsDir, absolute))
            throw new Error('workspace_project_artifact_outside_mapping');
          const observed = await observeWorkspaceFile(
            binding,
            relative(binding.canonicalRoot, absolute).replace(/\\/g, '/'),
          );
          artifacts.push({
            path: absolute,
            kind: artifact.kind ?? 'other',
            label:
              artifact.label ?? relative(info.mapping.artifactsDir, absolute),
            contentHash: observed.contentHash,
            size: observed.size,
          });
        }
        await options.projectAdapter!.submit(current, record.taskId, {
          summary: manifest.summary,
          artifacts,
          workFolder: current.effectiveCwd,
          workspacePath: current.effectiveCwd,
          provenance: {
            runtimeSource: 'desktop-agent-runtime',
            producingAgent: current.logicalAgentId,
            desktopTaskId: current.runId,
          },
        });
      },
    };
    try {
      await port.authorize(context);
      beforeEffects();
      store.saveRecord('project-execution', claimId, {
        ...record,
        status: 'executing',
      });
      let originalRootCandidate: object | undefined;
      const identity = originalProjectIO
        ? readOriginalKSwarmServiceIdentity(options.kswarmService)
        : undefined;
      const native = readOptionalOriginalMainAcceptedAdmission(
        'room_project',
        originalRuntime,
        options.kswarmService,
      );
      if (hasOriginalMainSdkBridgeInstallation() && !native)
        throw Error('ROOT_RESOURCE_ROOM_PROJECT_COMPOSITION_REQUIRED');
      if (native && (!originalProjectIO || !identity?.ownedChild))
        throw Error('ROOM_PROJECT_ORIGINAL_OWNED_SERVICE_REQUIRED');
      if (originalProjectIO && identity?.ownedChild && native) {
        if (!identity.scope)
          throw Error('ROOM_PROJECT_ORIGINAL_SCOPE_REQUIRED');
        await custody.sdk(identity.assertCurrent, identity, []);
        beforeEffects();
        const proof = roomRuntimeFreeze(roomRuntimeCreate(null)),
          closed = captureDispatchBusinessData({
            handoff,
            context,
            requestId: record.requestId,
          });
        const view: OriginalRoomProjectRootCandidate = roomRuntimeFreeze({
          kind: 'original_room_project_root_candidate_v1',
          candidateOnly: true,
          scope: identity.scope,
          roomId: context.roomId,
          projectId: handoff.project.id,
          taskId: record.taskId,
          runId: context.runId,
          claimId,
          payloadCanonical: JSON.stringify(closed),
          authorizationRef: context.claimId,
        });
        roomRuntimeApply(roomRuntimeSet, projectRootProofs, [
          proof,
          {
            view,
            identity,
            controller,
            currentStart,
            authorize: () => port.authorize(context),
            custody,
            settlement: state.settlement,
            cancellation: createRoomTurnCustody(),
          },
        ]);
        originalRootCandidate = proof;
        state.proof = proof;
        state.native = native;
      }
      let carrier: object | undefined;
      if (state.native && originalRootCandidate) {
        await custody.sdk(state.native.enqueue, state.native, [
          originalRootCandidate,
        ]);
        state.enqueued = true;
        const cancel = () => {
          if (!state.consumed) void cancelProjectQueued(state);
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) cancel();
          carrier = await custody.sdk<object>(
            state.native.awaitLaunch,
            state.native,
            [originalRootCandidate],
          );
          state.consumed = true;
          beforeEffects();
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      }
      entered = true;
      if (originalRootCandidate)
        acceptedProject(originalRootCandidate).executorInvoked = true;
      let primary: unknown,
        present = false;
      try {
        const invoke = () =>
          custody.sdk(executeOriginalProject, options, [
            {
              handoff,
              targetParticipantId: input.targetParticipantId,
              workspace: { context, port, signal, beforeEffects },
              originalRootCandidate,
            },
          ]);
        if (carrier) await runWithOriginalRootExecutionContext(carrier, invoke);
        else await invoke();
      } catch (error) {
        primary = error;
        present = true;
        custody.inventory(error);
      }
      if (carrier && originalRootCandidate) {
        const proof = originalRootCandidate,
          row = acceptedProject(proof),
          parent = carrier,
          settlement = row.settlement;
        const consume = async function (
          this: NonNullable<AcceptedProject['executorFate']>,
        ) {
          await settlement.sdk(this.waitKnown, this, []);
          settlement.syncVoid(this.assertKnown, this, []);
        };
        const read = async () => {
          const original = await import('./desktop-services.js');
          const fate = original.readOriginalRoomProjectExecutorPhysicalFate(
            executeOriginalProject,
            proof,
            parent,
          );
          row.executorFate = fate;
          return fate;
        };
        try {
          const fate = await settlement.sdk<
            NonNullable<AcceptedProject['executorFate']>
          >(read, undefined, [], {
            accept: (value) => !!value && value === row.executorFate,
            consumer: consume,
          });
          await settlement.consumeResource(consume, fate, []);
          await settlement.waitPhysicalKnown();
        } catch (error) {
          settlement.inventory(error);
          custody.inventory(error);
          if (!present) {
            primary = error;
            present = true;
          }
        }
      }
      if (present) throw primary;
      if (!rootProof) throw new Error('workspace_cleanup_pending');
      store.saveRecord('project-execution', claimId, {
        ...record,
        status: 'completed',
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (!entered)
        rootProof = {
          executorInstanceId: context.executorInstanceId,
          kind: 'resources-disposed',
          verified: true,
        };
      if (rootProof) {
        await physicalRelease(context, rootProof, state.settlement);
        await state.settlement.waitPhysicalKnown();
        running.delete(claimId);
      }
      changed(context.roomId);
    }
  }
  function runProjectTask(input: {
    handoff: KSwarmTaskHandoff;
    targetParticipantId?: string;
    signal?: AbortSignal;
    beforeEffects?: () => void;
  }) {
    if (shuttingDown)
      return Promise.resolve({
        ok: false as const,
        error: 'workspace_runtime_shutting_down',
      });
    const key = String(input.handoff.workspaceContext?.claimId ?? '');
    const prior = projectExecutions.get(key);
    if (prior) return prior;
    const promise = executeProjectHandoff(input);
    projectExecutions.set(key, promise);
    const tracked = promise.then((result) => ({ ok: result.ok }));
    executions.add(tracked);
    // This derived lifetime promise also owns a rejection. Keep its original
    // outcome for allSettled without orphaning it before shutdown joins it.
    void tracked.catch(() => {});
    void promise
      .finally(() => {
        projectExecutions.delete(key);
        executions.delete(tracked);
      })
      .catch(() => {});
    return promise;
  }
  function run(envelope: CollaborationRoomTurnEnvelope) {
    if(turnSource||hasOriginalMainSdkBridgeInstallation())return runNativeDiscussion(envelope);
    const key = workspaceDigest('run-key', {
      roomId: envelope.roomId,
      messageId: envelope.roomMessageId,
      logicalAgentId: envelope.logicalAgentId,
    });
    const digest = workspaceDigest(
      'envelope',
      JSON.parse(JSON.stringify(envelope)),
    );
    const current = activeRuns.get(key);
    if (current)
      return current.digest === digest
        ? current.promise
        : Promise.reject(new Error('workspace_idempotency_conflict'));
    const controller = new AbortController();
    const execution = executeRun(envelope, controller);
    executions.add(execution);
    activeRuns.set(key, {
      roomId: envelope.roomId,
      digest,
      controller,
      promise: execution,
    });
    void execution
      .finally(() => {
        executions.delete(execution);
        activeRuns.delete(key);
      })
      .catch(() => undefined);
    return execution;
  }
  function runNativeDiscussion(rawEnvelope:CollaborationRoomTurnEnvelope):Promise<{ok:boolean}> {
    if(!turnSource||shuttingDown)return Promise.reject(Error('ROOM_ROOT_ORIGINAL_BINDING_REQUIRED'));
    let envelope:CollaborationRoomTurnEnvelope,port:OriginalRoomRootAdmissionPort,key:string,digest:string;
    try{
      envelope=captureDispatchBusinessData(rawEnvelope) as unknown as CollaborationRoomTurnEnvelope;
      const found=readOptionalOriginalRoomDiscussionAdmission(originalRuntime,turnSource);if(!found)throw Error('ROOM_ROOT_ORIGINAL_BINDING_REQUIRED');port=found;
      key=workspaceDigest('run-key',{roomId:envelope.roomId,messageId:envelope.roomMessageId,logicalAgentId:envelope.logicalAgentId});digest=workspaceDigest('envelope',JSON.parse(JSON.stringify(envelope)));
    }catch(raw){return Promise.reject(raw);}
    const prior=nativeRoomRuns.get(key);if(prior)return prior.digest===digest?prior.promise:Promise.reject(Error('workspace_idempotency_conflict'));
    const controller=new AbortController();let yes!:(value:{ok:boolean})=>void,no!:(raw:unknown)=>void,finish!:()=>void;
    const promise=new RoomRuntimePromise<{ok:boolean}>((resolve,reject)=>{yes=resolve;no=reject;}),completion=new RoomRuntimePromise<void>(resolve=>finish=resolve);
    const row:NativeRoomRun={controller,port,roomId:envelope.roomId,stock:createRoomTurnCustody(),runnerFates:[],completion,finish,completed:false,externalEntered:false,cancelled:false,enqueued:false,invocationUnknown:false};
    // Original replay and cancellation membership precedes every SDK/await.
    nativeRoomRuns.set(key,{digest,promise,row});activeRuns.set(key,{roomId:envelope.roomId,digest,controller,promise});executions.add(promise);
    const operation=(async()=>{
      let first:{raw:unknown}|undefined,result:{ok:boolean}|undefined;
      try{
        const proofs=await row.stock.sdk<readonly object[]>(acceptOriginalRoomRuntimeTurn,undefined,[turnSource,originalRuntime,{roomId:envelope.roomId,roomMessageId:envelope.roomMessageId,logicalAgentIds:[envelope.logicalAgentId]}]);
        if(proofs.length!==1)throw Error('ROOM_TURN_ORIGINAL_PROOF_REQUIRED');
        const proof=proofs[0]!;row.proof=proof;roomRuntimeApply(turnSet,nativeRoomProofs,[proof,row]);
        const actual=acceptedPort.read(turnSource!,proof);if(workspaceDigest('envelope',JSON.parse(JSON.stringify(actual)))!==digest)throw Error('ROOM_TURN_ACCEPTANCE_CONFLICT');
        controller.signal.throwIfAborted();await row.stock.sdk(port.enqueueRoom,port,[proof]);row.enqueued=true;
        row.carrier=await row.stock.sdk<object>(port.awaitRoomLaunch,port,[proof]);
        controller.signal.throwIfAborted();const claim=port.readRoomLaunch(proof,row.carrier);
        // The fixed parser projected data; create ordinary arrays for the
        // existing Services parser without treating this DTO as authorization.
        const input=JSON.parse(JSON.stringify(actual)) as CollaborationRoomTurnEnvelope;
        result=await runWithOriginalRootExecutionContext(row.carrier,()=>row.stock.sdk<{ok:boolean}>(executeRun,undefined,[input,controller,{row,port,claim}]));
      }catch(raw){first={raw};row.stock.inventory(raw);}
      finally{row.completed=true;row.finish();}
      if(row.carrier&&row.proof){try{await port.finishRoom(row.proof);}catch(raw){if(first)throw new AggregateError([first.raw,raw],'ROOM_DISCUSSION_FINISH_UNCONFIRMED',{cause:first.raw});throw raw;}}
      else if(row.proof&&row.enqueued){try{await port.cancelRoomLaunch(row.proof);}catch(raw){if(first)throw new AggregateError([first.raw,raw],'ROOM_DISCUSSION_CANCEL_UNCONFIRMED',{cause:first.raw});throw raw;}}
      if(first)throw first.raw;return result!;
    })();
    roomRuntimeApply(roomRuntimeThen,operation,[(value:{ok:boolean})=>{executions.delete(promise);activeRuns.delete(key);yes(value);},(raw:unknown)=>{executions.delete(promise);activeRuns.delete(key);no(raw);}]);
    return promise;
  }
  let externalRecovery:
    | Promise<{ completed: number; abandoned: number; pending: number }>
    | undefined;
  function recoverExternalDiscussions() {
    if (externalRecovery) return externalRecovery;
    const sweep = async () => {
      const report = { completed: 0, abandoned: 0, pending: 0 };
      const gone = (pid: unknown, group = false) => {
        if (
          !Number.isSafeInteger(pid) ||
          Number(pid) <= 0 ||
          Number(pid) === process.pid
        )
          return false;
        if (group && process.platform === 'win32') return false;
        try {
          process.kill(group ? -Number(pid) : Number(pid), 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      };
      for (let record of store.listRecords<Record<string, unknown>>(
        'external-discussion-operation',
      )) {
        if (['completed', 'abandoned'].includes(String(record.phase))) continue;
        const key = String(record.operationId);
        const persist = (patch: Record<string, unknown>) => {
          record = { ...record, ...patch };
          store.saveRecord('external-discussion-operation', key, record);
        };
        try {
          const activeKey = workspaceDigest('run-key', {
            roomId: record.roomId,
            messageId: record.sourceMessageId,
            logicalAgentId: record.logicalAgentId,
          });
          if (shuttingDown || activeRuns.has(activeKey)) {
            report.pending++;
            continue;
          }
          if (typeof record.claimToken !== 'string') {
            persist({ recoveryState: 'unknown_pending' });
            report.pending++;
            continue;
          }
          // The old journal's parent/group probes are component facts only.
          // Installed Native execution cannot use them as a whole-domain
          // terminal certificate, including a previously recorded "released".
          if (hasOriginalMainSdkBridgeInstallation()) {
            persist({ recoveryState: 'domain_unconfirmed' });
            report.pending++;
            continue;
          }
          let physical =
            (record.phase === 'released' &&
              record.groupExitVerified === true) ||
            (record.phase === 'not-spawned' &&
              record.noSpawnVerified === true &&
              Number.isSafeInteger(record.ownerPid) &&
              Number(record.ownerPid) > 0 &&
              typeof record.neutralRoot === 'string' &&
              record.neutralRoot.length > 0 &&
              record.pid === undefined &&
              record.processGroupId === undefined);
          if (!physical && gone(record.ownerPid)) {
            if (record.phase === 'claimed') physical = true; // adapter entry has not occurred
            if (
              record.phase === 'running' &&
              typeof record.processStartIdentity === 'string' &&
              gone(record.processGroupId, true)
            ) {
              physical = true;
              persist({
                phase: 'released',
                groupExitVerified: true,
                recoveryEvidence: 'owner-and-group-esrch',
              });
            }
          }
          if (!physical) {
            persist({
              recoveryState:
                record.phase === 'prepared'
                  ? 'unknown_pending'
                  : 'cleanup_pending',
            });
            report.pending++;
            continue;
          }
          const response = await broker.request(
            String(record.roomId),
            'recover-wake',
            { claimToken: record.claimToken },
          );
          const wake = response.wake as Record<string, unknown> | undefined;
          if (
            !response.ok ||
            !wake ||
            wake.roomId !== record.roomId ||
            wake.roomMessageId !== record.sourceMessageId ||
            wake.logicalAgentId !== record.logicalAgentId ||
            workspaceDigest('scope', wake.contextScope) !==
              workspaceDigest('scope', record.contextScope)
          )
            throw new Error('discussion_wake_recovery_mismatch');
          if (wake.wakeStatus === 'completed') {
            persist({ phase: 'completed', recoveryState: 'recovered' });
            report.completed++;
            continue;
          }
          if (!['claimed', 'failed'].includes(String(wake.wakeStatus)))
            throw new Error('discussion_wake_recovery_pending');
          const abandoned = (await options.wake.abandonWake?.({
            roomId: record.roomId,
            claimToken: record.claimToken,
            reason: 'execution_failed',
          })) as { ok?: boolean; wakeStatus?: string } | undefined;
          if (!abandoned?.ok)
            throw new Error('discussion_wake_cleanup_pending');
          if (abandoned.wakeStatus === 'completed') {
            persist({ phase: 'completed', recoveryState: 'recovered' });
            report.completed++;
          } else if (abandoned.wakeStatus === 'failed') {
            persist({ phase: 'abandoned', recoveryState: 'recovered' });
            report.abandoned++;
          } else throw new Error('discussion_wake_cleanup_unconfirmed');
        } catch (error) {
          persist({
            recoveryState: 'cleanup_pending',
            recoveryError:
              error instanceof Error ? error.message : String(error),
          });
          report.pending++;
        }
      }
      return report;
    };
    externalRecovery = sweep();
    void externalRecovery
      .finally(() => {
        externalRecovery = undefined;
      })
      .catch(() => {});
    return externalRecovery;
  }
  let originalShutdown:Promise<void>|undefined;
  function shutdown():Promise<void> {
    if(originalShutdown)return originalShutdown;
    let yes!:()=>void,no!:(raw:unknown)=>void;
    originalShutdown=new RoomRuntimePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
    roomRuntimeApply(roomRuntimeThen,closeOriginalRuntime(),[yes,no]);return originalShutdown;
  }
  async function closeOriginalRuntime() {
    shuttingDown = true;
    turnCustody?.seal();
    projectCustody.seal();
    const queued:Promise<unknown>[]=[];
    if(turnSource){
      for(const item of nativeRoomRuns.values())if(!item.row.completed){
        const row=item.row;row.cancelled=true;
        if(row.proof&&row.enqueued&&!row.carrier)appendIntrinsic(queued,row.port.cancelRoomLaunch(row.proof));
      }
    }
    for (const entry of projectPreparations.values())
      entry.controller.abort(
        new DOMException('Workspace owner shutting down', 'AbortError'),
      );
    for (const entry of activeRuns.values())
      entry.controller.abort(
        new DOMException('Workspace owner shutting down', 'AbortError'),
      );
    for (const entry of running.values())
      entry.controller.abort(
        new DOMException('Workspace owner shutting down', 'AbortError'),
      );
    let turnFailure: unknown,
      turnFailed = false;
    const cancelled=await Promise.allSettled(queued);
    for(let i=0;i<cancelled.length;i++)if(cancelled[i]!.status==='rejected'&&!turnFailed){turnFailed=true;turnFailure=(cancelled[i] as PromiseRejectedResult).reason;}
    try {
      await turnCustody?.drain();
    } catch (error) {
      turnFailed = true;
      turnFailure = error;
    }
    await Promise.allSettled([...executions]);
    await projectCustody.drain();
    const projectFates = await settleIntrinsicOperations(
      projectInvocations.snapshot(),
      (fate) => fate.waitPhysicalKnown(),
    );
    for (let i = 0; i < projectFates.length; i++) {
      const fate = projectFates[i]!;
      if (fate.status === 'rejected') throw fate.reason;
    }
    if (externalRecovery) await externalRecovery;
    // The handoff receiver is fenced above and all admissions have settled.
    // Pending dispatch records have never entered a physical runner, so this
    // owner can now prove cancellation instead of abandoning their claims.
    for (const roomId of new Set(
      [...running.values()].map((entry) => entry.roomId),
    ))
      await cancelRoom(roomId);
    if (turnFailed) throw turnFailure;
  }
  const originalRuntime = {
    run,
    cancelRoom,
    shutdown,
    prepareProjectTask,
    runProjectTask,
    recoverExternalDiscussions,
  };
  const acceptedPort: OriginalRoomRuntimeAcceptance = roomRuntimeFreeze({
    shutdown,
    physical(source:object,proof:object){
      const row=roomRuntimeApply(turnGet,nativeRoomProofs,[proof]) as NativeRoomRun|undefined;
      if(source!==turnSource||!row||row.proof!==proof)throw Error('ROOM_DISCUSSION_ORIGINAL_PHYSICAL_REQUIRED');
      const assertKnown=()=>{if(!row.completed||row.externalEntered||row.invocationUnknown)throw Error('ROOM_DISCUSSION_PHYSICAL_UNCONFIRMED');row.stock.assertPhysicalKnown();for(let i=0;i<row.runnerFates.length;i++)row.runnerFates[i]!.assertKnown();};
      return roomRuntimeFreeze({async waitKnown(){await row.completion;await row.stock.waitPhysicalKnown();for(let i=0;i<row.runnerFates.length;i++)await row.runnerFates[i]!.waitKnown();assertKnown();},assertKnown});
    },
    runner: executeOriginalTurn,
    bind(source: object, context: RoomTurnCustody) {
      assertRoomTurnCustody(context);
      if (turnSource || shuttingDown)
        throw Error('ROOM_TURN_SOURCE_ALREADY_BOUND');
      turnSource = source;
      turnCustody = context;
    },
    accept(source: object, envelope: CollaborationRoomTurnEnvelope) {
      if (source !== turnSource || shuttingDown)
        throw Error('ROOM_TURN_SOURCE_CLOSED');
      turnCustody!.current();
      const proof = roomRuntimeFreeze(roomRuntimeCreate(null));
      roomRuntimeApply(turnSet, acceptedTurns, [proof, envelope]);
      return proof;
    },
    read(source: object, proof: object) {
      turnCurrent(source, proof);
      return roomRuntimeApply(turnGet, acceptedTurns, [
        proof,
      ]) as CollaborationRoomTurnEnvelope;
    },
    current: turnCurrent,
  });
  if (originalProjectIO)
    roomRuntimeApply(roomRuntimeSet, roomProjectSources, [
      originalRuntime,
      {
        service: options.kswarmService,
        physical(proof: object) {
          const row = roomRuntimeApply(roomRuntimeGet, projectRootProofs, [
            proof,
          ]) as AcceptedProject | undefined;
          if (!row) throw Error('ROOM_PROJECT_ORIGINAL_PROOF_REQUIRED');
          const assertKnown = () => {
            row.custody.assertPhysicalKnown();
            row.settlement.assertPhysicalKnown();
            row.cancellation.assertPhysicalKnown();
            if (row.executorInvoked) {
              if (!row.executorFate)
                throw Error('ROOM_PROJECT_EXECUTOR_PHYSICAL_UNCONFIRMED');
              row.executorFate.assertKnown();
            }
          };
          return roomRuntimeFreeze({
            async waitKnown() {
              await row.custody.waitPhysicalKnown();
              await row.settlement.waitPhysicalKnown();
              await row.cancellation.waitPhysicalKnown();
              if (row.executorInvoked) {
                if (!row.executorFate)
                  throw Error('ROOM_PROJECT_EXECUTOR_PHYSICAL_UNCONFIRMED');
                await row.executorFate.waitKnown();
              }
              assertKnown();
            },
            assertKnown,
          });
        },
        read(proof: object) {
          const row = acceptedProject(proof);
          if (
            shuttingDown ||
            running.get(row.view.claimId)?.controller !== row.controller ||
            row.controller.signal.aborted ||
            !projectExecutions.has(row.view.claimId)
          )
            throw Error('ROOM_PROJECT_ROOT_NOT_CURRENT');
          row.identity.assertLocal();
          return row.view;
        },
        current(proof: object) {
          const row = acceptedProject(proof);
          row.identity.assertCurrent();
          row.currentStart();
          if (
            shuttingDown ||
            running.get(row.view.claimId)?.controller !== row.controller ||
            row.controller.signal.aborted ||
            !projectExecutions.has(row.view.claimId)
          )
            throw Error('ROOM_PROJECT_ROOT_NOT_CURRENT');
          row.identity.assertLocal();
        },
        revalidate(proof: object) {
          const row = acceptedProject(proof);
          return row.custody.root(async () => {
            await row.custody.sdk(row.identity.assertCurrent, row.identity, []);
            await row.custody.sdk(row.currentStart, undefined, []);
            await row.custody.sdk(row.authorize, undefined, []);
            if (
              shuttingDown ||
              running.get(row.view.claimId)?.controller !== row.controller ||
              row.controller.signal.aborted ||
              !projectExecutions.has(row.view.claimId)
            )
              throw Error('ROOM_PROJECT_ROOT_NOT_CURRENT');
            row.identity.assertLocal();
          });
        },
      },
    ]);
  roomRuntimeApply(roomRuntimeSet, originalRoomRuntimes, [
    originalRuntime,
    acceptedPort,
  ]);
  return originalRuntime;
}
