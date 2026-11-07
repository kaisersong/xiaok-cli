import {hasOriginalMainSdkBridgeInstallation} from '../../src/runtime/verification/original-main-sdk-bridge.js';
import {readOptionalOriginalMainAcceptedAdmission} from './main-accepted-root-binding.js';
import type {OriginalMainAcceptedRootPort} from './main-room-root-admission.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {readOriginalKSwarmServiceIdentity,readOriginalKSwarmExecutionStartIO,readOriginalKSwarmWorkflowControllerIO,type KSwarmService,type KSwarmExecutionStartRead,type OriginalKSwarmServiceIdentity} from './kswarm-service.js';
import {readOptionalOriginalWorkflowScriptChildRoot,readOriginalWorkflowScriptChildView,readOriginalWorkflowScriptChildParent,readOriginalKSwarmWorkflowController,type OriginalWorkflowScriptChildView} from './workflow-script-kswarm-controller.js';
import {readOptionalOriginalMainWorkflowAdmission} from './main-workflow-root-binding.js';
import {runWithOriginalRootExecutionContext} from '../../src/runtime/verification/original-root-execution-context.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {readKSwarmExecutionStart,assertKSwarmExecutionStart,isKSwarmExecutionStartFailure} from './kswarm-execution-start-guard.js';
import { isAbsolute, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isAbortError } from '../../src/ai/runtime/abort-utils.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';

// Reserved runtime preparation messages never inherit legacy execution or
// terminal-result semantics, including versions this binary cannot recognize.
const bridgeStartsWith = Function.prototype.call.bind(String.prototype.startsWith);
function isDefaultDispatchPreparationProtocol(value: unknown): boolean {
  return typeof value === 'string' && bridgeStartsWith(value, 'ordinary_default_dispatch_');
}
class DefaultDispatchPreparationProtocolError extends Error {
  constructor() { super('default_dispatch_protocol_requires_preparation'); }
}

const BridgePromise = Promise;
const bridgeResponseText=Response.prototype.text;
const bridgeResponseJson=Response.prototype.json,bridgeResponseStatus=Object.getOwnPropertyDescriptor(Response.prototype,'status')!.get!,bridgeResponseOk=Object.getOwnPropertyDescriptor(Response.prototype,'ok')!.get!;
const bridgePromiseWitness = new BridgePromise<void>(resolve => resolve());
const bridgeOwnDescriptor = Object.getOwnPropertyDescriptor;
const bridgeGlobalPromiseDescriptor = bridgeOwnDescriptor(globalThis, 'Promise');
const bridgeThenDescriptor = bridgeOwnDescriptor(BridgePromise.prototype, 'then');
function sameBridgeDataDescriptor(current: PropertyDescriptor | undefined, expected: PropertyDescriptor | undefined): boolean {
  return Boolean(current && expected && 'value' in current && 'value' in expected
    && current.value === expected.value && current.writable === expected.writable
    && current.enumerable === expected.enumerable && current.configurable === expected.configurable);
}

export interface KSwarmTaskHandoff {
  kind: 'kswarm_task_handoff_v1';
  runId: string;
  workspaceContext?:Record<string,unknown>;
  project: {
    id: string;
    name: string;
    goal: string;
    requirements?: string;
    workFolder?: string | null;
    artifactsDir?: string | null;
    requiredProtocol?:string;
  };
  task: {
    id: string;
    title: string;
    brief?: string;
    acceptanceCriteria?: string;
    requiredOutputs?: Array<string | { type?: string; format?: string; kind?: string; mimeType?: string; enforcement?: string }>;
    executionContract?: Record<string, unknown> | null;
    evidenceContract?: Record<string, unknown> | null;
    repairInstruction?: string;
  };
}

export interface KSwarmWorkflowNodeHandoff {
  projectId: string;
  workflowRunId: string;
  workflowId: string;
  nodeId: string;
  nodeKind: 'agent_task' | 'review' | 'control' | string;
  nodeTitle: string;
  attempt: number;
  handoffId: string;
  input?: Record<string, unknown> | null;
  handoffPath?: string | null;
  project?: {
    id: string;
    name?: string;
    goal?: string;
    status?: string;
    workFolder?: string | null;
  };
}

export interface KSwarmRuntimeBridgeOptions {
  kswarmService?:KSwarmService;
  runWorkspaceTask?(input:{handoff:KSwarmTaskHandoff;targetParticipantId?:string;signal?:AbortSignal;beforeEffects?:()=>void}):Promise<{ok:true}|{ok:false;error:string}>;
  allowedRoots?: string[];
  runDesktopTask(input: { handoff: KSwarmTaskHandoff; targetParticipantId?: string; signal?: AbortSignal;beforeEffects?:()=>void; onExecutionStarted?: () => Promise<void>; originalRootCandidate?:object }): Promise<{
    summary: string;
    artifacts?: Array<{ path: string; kind: string; label?: string }>;
    provenance?: Record<string, unknown>;
  }>;
  runWorkflowNode?(input: { handoff: KSwarmWorkflowNodeHandoff; targetParticipantId?: string;beforeEffects?:()=>void }): Promise<{
    output?: Record<string, unknown> | null;
    reviewDecision?: { status: string; reason: string; evidenceRefs?: string[] } | null;
  }>;
  submitResult(input: {
    projectId: string;
    taskId: string;
    runId: string;
    targetParticipantId?: string;
    result: Record<string, unknown>;
  }): Promise<Response>;
  submitWorkflowNodeResult?(input: {
    handoff: KSwarmWorkflowNodeHandoff;
    targetParticipantId?: string;
    output?: Record<string, unknown> | null;
    reviewDecision?: { status: string; reason: string; evidenceRefs?: string[] } | null;
  }): Promise<Response>;
}

export interface OriginalKSwarmHandoffRoot {
 readonly kind:'original_kswarm_handoff_root_candidate_v1';readonly candidateOnly:true;
 readonly scope:Readonly<{profileId:string;workspaceId:string}>;
 readonly projectId:string;readonly taskId:string;readonly runId:string;
 readonly payloadCanonical:string;readonly authorizationRef:string;
}
interface DirectRootEntry {physical(proof:object):{waitKnown():Promise<void>;assertKnown():void};read(proof:object):OriginalKSwarmHandoffRoot;current(proof:object):void;revalidate(proof:object):Promise<void>;service:object;runner:Function}
const originalDirectRoots=new WeakMap<object,DirectRootEntry>();
const rootWeakGet=WeakMap.prototype.get,rootWeakSet=WeakMap.prototype.set,rootApply=Reflect.apply,rootFreeze=Object.freeze,rootCreate=Object.create,rootJson=JSON.stringify;
function directEntry(bridge:unknown):DirectRootEntry {
 const row=rootApply(rootWeakGet,originalDirectRoots,[bridge]) as DirectRootEntry|undefined;
 if(!row)throw Error('KSWARM_DIRECT_ORIGINAL_BRIDGE_REQUIRED');return row;
}
/** These readers identify a local accepted candidate, never a capacity grant. */
export function readOriginalKSwarmHandoffRootBinding(bridge:unknown,service:unknown):void {if(directEntry(bridge).service!==service)throw Error('KSWARM_DIRECT_ORIGINAL_SERVICE_REQUIRED');}
/** Fixed producer and exact original Services runner; public method copies do not qualify. */
export function readOriginalKSwarmHandoffRunnerBinding(bridge:unknown,service:unknown,runner:unknown):void {const row=directEntry(bridge);if(row.service!==service||row.runner!==runner)throw Error('KSWARM_DIRECT_ORIGINAL_RUNNER_REQUIRED');}
export function readOriginalKSwarmHandoffRoot(bridge:unknown,proof:object):OriginalKSwarmHandoffRoot{return directEntry(bridge).read(proof);}
export function assertOriginalKSwarmHandoffRootCurrent(bridge:unknown,proof:object):void{directEntry(bridge).current(proof);}
export function revalidateOriginalKSwarmHandoffRoot(bridge:unknown,proof:object):Promise<void>{return directEntry(bridge).revalidate(proof);}
export function readOriginalKSwarmHandoffRootPhysicalFate(bridge:unknown,proof:object):{waitKnown():Promise<void>;assertKnown():void}{return directEntry(bridge).physical(proof);}

interface WorkflowChildExecution {service:unknown;custody:ReturnType<typeof createRoomTurnCustody>;hostInvoked:boolean;hostFate?:{waitKnown():Promise<void>;assertKnown():void}}
const originalWorkflowChildExecutions=new WeakMap<object,ReturnType<typeof createIntrinsicSet<WorkflowChildExecution>>>();
/** Physical-only fixed reader: even a business return does not prove the Host
 * accepted tree closed. Until the fixed services receipt is attached it stays
 * unconfirmed; neither callbacks nor DTO flags can refund N. */
export function readOriginalWorkflowScriptChildrenPhysicalFate(service:unknown,controller:unknown):{waitKnown():Promise<void>;assertKnown():void}{
 readOriginalKSwarmWorkflowController(controller,service);
 const rows=rootApply(rootWeakGet,originalWorkflowChildExecutions,[controller]) as ReturnType<typeof createIntrinsicSet<WorkflowChildExecution>>|undefined;
 return {async waitKnown(){if(rows)for(const row of rows.snapshot()){if(row.service!==service)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');await row.custody.waitPhysicalKnown();if(row.hostInvoked){if(!row.hostFate)throw Error('WORKFLOW_CHILD_HOST_PHYSICAL_UNCONFIRMED');await row.hostFate.waitKnown();row.hostFate.assertKnown();}}},assertKnown(){if(rows)for(const row of rows.snapshot()){if(row.service!==service)throw Error('WORKFLOW_CHILD_ORIGINAL_RELATION_REQUIRED');row.custody.assertPhysicalKnown();if(row.hostInvoked){if(!row.hostFate)throw Error('WORKFLOW_CHILD_HOST_PHYSICAL_UNCONFIRMED');row.hostFate.assertKnown();}}}};
}

export function createKSwarmRuntimeBridge(options: KSwarmRuntimeBridgeOptions) {
  let originalIO:ReturnType<typeof readOriginalKSwarmExecutionStartIO>|undefined;
  try{originalIO=readOriginalKSwarmExecutionStartIO(options.kswarmService);}catch{/* Legacy test adapters never produce an original Native candidate. */}
  const runDirect=bridgeOwnDescriptor(options,'runDesktopTask')?.value;
  const runWorkflow=bridgeOwnDescriptor(options,'runWorkflowNode')?.value,submitWorkflow=bridgeOwnDescriptor(options,'submitWorkflowNodeResult')?.value;
  const workflowHandoffs=new Map<string,{identity:string;promise:Promise<{ok:true}|{ok:false;error:string}>}>();
  type AcceptedRoot={view:OriginalKSwarmHandoffRoot;identity:OriginalKSwarmServiceIdentity;receipt:KSwarmExecutionStartRead;controller:AbortController;handoffPath:string;raw:string;beforeEffects:()=>void;custody:ReturnType<typeof createRoomTurnCustody>;settlement:ReturnType<typeof createRoomTurnCustody>;cancellation:ReturnType<typeof createRoomTurnCustody>;hostFate?:{waitKnown():Promise<void>;assertKnown():void};hostInvoked?:boolean;invalid?:boolean};
  const acceptedRoots=new WeakMap<object,AcceptedRoot>();
  function accepted(proof:object){const row=rootApply(rootWeakGet,acceptedRoots,[proof]) as AcceptedRoot|undefined;if(!row)throw Error('KSWARM_DIRECT_ORIGINAL_PROOF_REQUIRED');if(row.invalid)throw Error('KSWARM_DIRECT_HANDOFF_CHANGED');return row;}
  const activeTaskControllers = new Map<string, AbortController>();
  const activeHandoffs=new Map<string,{identity:string;controller:AbortController;promise:Promise<{ok:true}|{ok:false;error:string}>}>();

  function handleTaskHandoff(input:Parameters<typeof executeTaskHandoff>[0]){
    const identity=JSON.stringify([input.projectId,input.taskId,input.runId,input.handoffPath,input.targetParticipantId??null]);
    const prior=activeHandoffs.get(input.taskId);
    if(prior&&prior.identity!==identity)return Promise.resolve({ok:false as const,error:'task_handoff_conflict'});
    const controller=prior?.controller??new AbortController();
    const abort=()=>controller.abort(input.signal?.reason);
    if(input.signal?.aborted)abort();else input.signal?.addEventListener('abort',abort,{once:true});
    const promise=prior?.promise??BridgePromise.resolve().then(()=>executeTaskHandoff(input,controller));
    if(!prior){
      activeTaskControllers.set(input.taskId,controller);activeHandoffs.set(input.taskId,{identity,controller,promise});
      void promise.finally(()=>{activeTaskControllers.delete(input.taskId);activeHandoffs.delete(input.taskId);}).catch(()=>{});
    }
    void promise.finally(()=>input.signal?.removeEventListener('abort',abort)).catch(()=>{});
    return promise;
  }

  type DirectState = {
    proof?: object;
    native?: OriginalMainAcceptedRootPort;
    consumed?: boolean;
    enqueued?: boolean;
    cancelTask?: Promise<void>;
  };
  function cancelQueued(state: DirectState): Promise<void> {
    if (state.cancelTask) return state.cancelTask;
    const row = accepted(state.proof!);
    state.cancelTask = row.cancellation.root(() =>
      row.cancellation.sdk<void>(state.native!.cancelQueued, state.native, [
        state.proof!,
      ]),
    );
    void state.cancelTask.catch(() => {});
    return state.cancelTask;
  }
  async function executeTaskHandoff(
    input: Parameters<typeof executeTaskHandoffBody>[0],
    controller: AbortController,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const custody = createRoomTurnCustody(),
      state: DirectState = {};
    let value: { ok: true } | { ok: false; error: string } | undefined,
      primary: unknown,
      present = false;
    try {
      value = await custody.root(() =>
        executeTaskHandoffBody(input, controller, custody, state),
      );
    } catch (raw) {
      primary = raw;
      present = true;
      custody.inventory(raw);
    }
    if (state.enqueued && !state.consumed) {
      try {
        await cancelQueued(state);
      } catch (raw) {
        if (!present) {
          primary = raw;
          present = true;
        }
      }
    }
    if (state.cancelTask) {
      try {
        await state.cancelTask;
      } catch (raw) {
        if (!present) {
          primary = raw;
          present = true;
        }
      }
    }
    let known = true;
    try {
      await custody.waitPhysicalKnown();
    } catch (raw) {
      known = false;
      if (!present) {
        primary = raw;
        present = true;
      }
    }
    if (known && state.consumed && state.proof && state.native) {
      const cleanup = createRoomTurnCustody();
      try {
        await cleanup.root(() =>
          cleanup.sdk(state.native!.finish, state.native, [
            state.proof!,
            state.proof!,
          ]),
        );
      } catch (raw) {
        cleanup.inventory(raw);
        if (!present) {
          primary = raw;
          present = true;
        }
      }
      try {
        await cleanup.waitPhysicalKnown();
      } catch (raw) {
        if (!present) {
          primary = raw;
          present = true;
        }
      }
    }
    if (present) throw primary;
    return value!;
  }
  async function executeTaskHandoffBody(
    input: {
      handoffPath: string;
      projectId: string;
      taskId: string;
      runId: string;
      targetParticipantId?: string;
      signal?: AbortSignal;
      beforeEffects?: () => void;
      onExecutionStarted?: () => Promise<void>;
    },
    controller: AbortController,
    custody: ReturnType<typeof createRoomTurnCustody>,
    state: DirectState,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isAllowedPath(input.handoffPath, options.allowedRoots)) {
      return { ok: false, error: 'handoff_path_outside_allowed_roots' };
    }
    controller.signal.throwIfAborted();
    assertBeforeEffects(input.beforeEffects);
    const executionStart = originalIO
      ? {
          projectId: input.projectId,
          receipt: await custody.sdk<KSwarmExecutionStartRead>(
            originalIO!.read,
            originalIO,
            [input.projectId],
          ),
        }
      : await readKSwarmExecutionStart(
          options.kswarmService as KSwarmService,
          input.projectId,
        );
    let guardFailure: { error: unknown } | undefined;
    const beforeEffects = () => {
      controller.signal.throwIfAborted();
      input.signal?.throwIfAborted();
      try {
        assertBeforeEffects(input.beforeEffects);
        originalIO
          ? originalIO.assert(input.projectId, executionStart.receipt)
          : assertKSwarmExecutionStart(
              options.kswarmService as KSwarmService,
              executionStart,
            );
      } catch (error) {
        guardFailure = { error };
        throw error;
      }
    };
    beforeEffects();
    const raw = originalIO
      ? await custody.sdk<string>(readFile, undefined, [
          input.handoffPath,
          'utf-8',
        ])
      : await readFile(input.handoffPath, 'utf-8');
    beforeEffects();
    const handoff = JSON.parse(raw) as KSwarmTaskHandoff;
    if (handoff.kind !== 'kswarm_task_handoff_v1')
      return { ok: false, error: 'invalid_handoff_kind' };
    if (handoff.runId !== input.runId)
      return { ok: false, error: 'run_id_mismatch' };
    if (
      handoff.project.id !== input.projectId ||
      handoff.task.id !== input.taskId
    )
      return { ok: false, error: 'handoff_scope_mismatch' };
    if (isDefaultDispatchPreparationProtocol(handoff.project.requiredProtocol))
      throw new DefaultDispatchPreparationProtocolError();

    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    try {
      if (
        handoff.workspaceContext ||
        handoff.project.requiredProtocol === 'room_workspace_v1'
      ) {
        if (
          handoff.workspaceContext?.protocolVersion !== 1 ||
          !options.runWorkspaceTask
        )
          return { ok: false, error: 'workspace_runtime_protocol_required' };
        beforeEffects();
        await input.onExecutionStarted?.();
        beforeEffects();
        return await options.runWorkspaceTask({
          handoff,
          targetParticipantId: input.targetParticipantId,
          signal,
          beforeEffects,
        });
      }
      let originalRootCandidate: object | undefined;
      const identity = originalIO
        ? readOriginalKSwarmServiceIdentity(options.kswarmService)
        : undefined;
      // Source provenance alone does not activate the Native ABI. A pending,
      // failed or retired genuine installation must never revive legacy.
      const native = readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct', bridge, options.kswarmService,
      );
      if (hasOriginalMainSdkBridgeInstallation() && !native)
        throw Error('ROOT_RESOURCE_DIRECT_COMPOSITION_REQUIRED');
      if (native && (!originalIO || !identity?.ownedChild))
        throw Error('KSWARM_DIRECT_ORIGINAL_OWNED_SERVICE_REQUIRED');
      if (originalIO && identity?.ownedChild && native) {
        const scope = identity.scope;
        if (!scope) throw Error('KSWARM_DIRECT_ORIGINAL_SCOPE_REQUIRED');
        await custody.sdk(identity.assertCurrent, identity, []);
        beforeEffects();
        const closed = captureDispatchBusinessData(handoff),
          proof = rootFreeze(rootCreate(null));
        const view: OriginalKSwarmHandoffRoot = rootFreeze({
          kind: 'original_kswarm_handoff_root_candidate_v1',
          candidateOnly: true,
          scope,
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          payloadCanonical: rootJson(closed),
          authorizationRef: input.runId,
        });
        rootApply(rootWeakSet, acceptedRoots, [
          proof,
          {
            view,
            identity,
            receipt: executionStart.receipt,
            controller,
            handoffPath: input.handoffPath,
            raw,
            beforeEffects,
            custody,
            settlement: createRoomTurnCustody(),
            cancellation: createRoomTurnCustody(),
          },
        ]);
        originalRootCandidate = proof;
        state.proof = proof;
        state.native = native ?? undefined;
        if (!state.native)
          throw Error('ROOT_RESOURCE_DIRECT_COMPOSITION_REQUIRED');
      }
      const onExecutionStarted = input.onExecutionStarted;
      let context: object | undefined;
      if (state.native && originalRootCandidate) {
        await custody.sdk(state.native.enqueue, state.native, [
          originalRootCandidate,
        ]);
        state.enqueued = true;
        const cancel = () => {
          if (!state.consumed) void cancelQueued(state);
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) cancel();
          context = await custody.sdk<object>(
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
      type Executed = Awaited<
        ReturnType<KSwarmRuntimeBridgeOptions['runDesktopTask']>
      >;
      let executed!: Executed,
        primary: unknown,
        present = false;
      try {
        if (originalRootCandidate)
          accepted(originalRootCandidate).hostInvoked = true;
        const invoke = () =>
          custody.sdk<Executed>(runDirect, options, [
            {
              handoff,
              originalRootCandidate,
              targetParticipantId: input.targetParticipantId,
              signal,
              onExecutionStarted: onExecutionStarted
                ? async () => {
                    beforeEffects();
                    await custody.sdk(onExecutionStarted, undefined, []);
                    beforeEffects();
                  }
                : undefined,
              beforeEffects,
            },
          ]);
        executed = context
          ? await runWithOriginalRootExecutionContext(context, invoke)
          : await invoke();
      } catch (raw) {
        present = true;
        primary = raw;
        custody.inventory(raw);
      }
      if (context && originalRootCandidate) {
        const row = accepted(originalRootCandidate),
          proof = originalRootCandidate,
          parentRef = context,
          settlement = row.settlement;
        const consumeHostFate = async function (
          this: NonNullable<AcceptedRoot['hostFate']>,
        ) {
          await settlement.sdk(this.waitKnown, this, []);
          settlement.syncVoid(this.assertKnown, this, []);
        };
        const readHostFate = async () => {
          const original = await import('./desktop-services.js');
          const fate = original.readOriginalKSwarmHandoffPhysicalFate(
            runDirect,
            proof,
            parentRef,
          );
          row.hostFate = fate;
          return fate;
        };
        try {
          await settlement.root(async () => {
            const fate = await settlement.sdk<
              NonNullable<AcceptedRoot['hostFate']>
            >(readHostFate, undefined, [], {
              accept: (value) => !!value && value === row.hostFate,
              consumer: consumeHostFate,
            });
            await settlement.consumeResource(consumeHostFate, fate, []);
          });
          await settlement.waitPhysicalKnown();
        } catch (raw) {
          settlement.inventory(raw);
          custody.inventory(raw);
          if (!present) {
            primary = raw;
            present = true;
          }
        }
      }
      if (present) throw primary;

      const result = {
        summary: executed.summary,
        artifacts: executed.artifacts ?? [],
        ...(handoff.project.workFolder
          ? {
              workFolder: handoff.project.workFolder,
              workspacePath: handoff.project.workFolder,
            }
          : {}),
        provenance: {
          runtimeSource: 'desktop-agent-runtime',
          ...(executed.provenance ?? {}),
        },
      };
      const consumeResponse = async function (this: Response) {
        const ok = rootApply(bridgeResponseOk, this, []) as boolean,
          status = rootApply(bridgeResponseStatus, this, []) as number;
        await custody.sdk(bridgeResponseText, this, []);
        return { ok, status };
      };
      const response = await custody.sdk<Response>(
        options.submitResult,
        options,
        [
          {
            projectId: input.projectId,
            taskId: input.taskId,
            runId: input.runId,
            targetParticipantId: input.targetParticipantId,
            result,
          },
        ],
        {
          accept(value) {
            try {
              rootApply(bridgeResponseStatus, value, []);
              return true;
            } catch {
              return false;
            }
          },
          consumer: consumeResponse,
        },
      );
      const submitted = await custody.consumeResource<{
        ok: boolean;
        status: number;
      }>(consumeResponse, response, []);
      if (!submitted.ok)
        return { ok: false, error: `submit_failed:${submitted.status}` };
      return { ok: true };
    } catch (error) {
      if (guardFailure && Object.is(error, guardFailure.error)) throw error;
      if (!isKSwarmExecutionStartFailure(error) && isAbortError(error)) {
        return { ok: false, error: 'task_cancelled:user_aborted' };
      }
      throw error;
    }
  }
  function handleWorkflowNodeHandoff(input: {
    handoff: KSwarmWorkflowNodeHandoff;
    targetParticipantId?: string;
    beforeEffects?:()=>void;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if(typeof runWorkflow!=='function'||typeof submitWorkflow!=='function')return BridgePromise.resolve({ok:false,error:'workflow_node_handler_missing'});
    const handoff=captureDispatchBusinessData(bridgeOwnDescriptor(input,'handoff')?.value) as unknown as KSwarmWorkflowNodeHandoff;
    const identity=canonicalVerificationJson(handoff),key=canonicalVerificationJson([handoff.projectId,handoff.workflowRunId,handoff.nodeId,handoff.attempt,handoff.handoffId]);
    const prior=workflowHandoffs.get(key);if(prior){if(prior.identity!==identity)return BridgePromise.reject(Error('WORKFLOW_HANDOFF_CONFLICT'));return prior.promise;}
    if(workflowHandoffs.size>=4096)return BridgePromise.reject(Error('WORKFLOW_HANDOFF_CAPACITY'));
    const promise=BridgePromise.resolve().then(()=>executeWorkflowNodeHandoff(input,handoff));workflowHandoffs.set(key,{identity,promise});return promise;
  }

  async function executeWorkflowNodeHandoff(input:{handoff:KSwarmWorkflowNodeHandoff;targetParticipantId?:string;beforeEffects?:()=>void},handoff:KSwarmWorkflowNodeHandoff):Promise<{ok:true}|{ok:false;error:string}>{
    const guard=bridgeOwnDescriptor(input,'beforeEffects')?.value;
    const targetParticipantId=bridgeOwnDescriptor(input,'targetParticipantId')?.value;
    const custody=createRoomTurnCustody();
    let outcome:{ok:true}|{ok:false;error:string}|undefined,primary:unknown,present=false;
    try{outcome=await custody.root(async()=>{
      const service=options.kswarmService;
      const execution=originalIO?await custody.sdk<KSwarmExecutionStartRead>(originalIO.read,originalIO,[handoff.projectId]):await readKSwarmExecutionStart(service as KSwarmService,handoff.projectId);
      const current=()=>{assertBeforeEffects(guard);if(originalIO)originalIO.assert(handoff.projectId,execution as KSwarmExecutionStartRead);else assertKSwarmExecutionStart(service as KSwarmService,execution as Awaited<ReturnType<typeof readKSwarmExecutionStart>>);};
      current();
      const io=originalIO?readOriginalKSwarmWorkflowControllerIO(service,handoff.projectId,handoff.workflowRunId):undefined;
      const readRun=async()=>{
        if(!io)throw Error('WORKFLOW_HANDOFF_CURRENT_UNCONFIRMED');
        const detail=await custody.sdk<{ok:boolean;status:number;body:unknown}>(io.perform,io,[{kind:'read_run'},current]);
        if(!detail.ok)throw Error('WORKFLOW_HANDOFF_CURRENT_UNCONFIRMED');
        const body=captureDispatchBusinessData(detail.body),run=isRecord(body)&&isRecord(body.workflowRun)?body.workflowRun:undefined;
        if(!run||run.id!==handoff.workflowRunId||run.projectId!==handoff.projectId||run.workflowId!==handoff.workflowId||!Array.isArray(run.nodes))throw Error('WORKFLOW_HANDOFF_IDENTITY_MISMATCH');
        let node:Record<string,unknown>|undefined;for(let i=0;i<run.nodes.length;i++){const candidate=run.nodes[i];if(isRecord(candidate)&&candidate.id===handoff.nodeId)node=candidate;}
        if(!node)throw Error('WORKFLOW_HANDOFF_NODE_MISSING');return{run,node};
      };
      const validate=(node:Record<string,unknown>)=>{
        const runtime=isRecord(node.runtime)?node.runtime:{};
        if(node.kind!==handoff.nodeKind||node.attempt!==handoff.attempt||runtime.handoffId!==handoff.handoffId||canonicalVerificationJson(node.input)!==canonicalVerificationJson(handoff.input??null))throw Error('WORKFLOW_HANDOFF_IDENTITY_MISMATCH');
      };
      type Executed=Awaited<ReturnType<NonNullable<KSwarmRuntimeBridgeOptions['runWorkflowNode']>>>;
      let executed:Executed;
      if(io){
        const first=await readRun(),native=readOptionalOriginalMainWorkflowAdmission(service);
        if(first.run.source==='script_generated'&&native){
          const consume=async function(this:object):Promise<Executed>{
            const view=readOriginalWorkflowScriptChildView(service,this),parent=readOriginalWorkflowScriptChildParent(service,this);
            let executions=rootApply(rootWeakGet,originalWorkflowChildExecutions,[parent]) as ReturnType<typeof createIntrinsicSet<WorkflowChildExecution>>|undefined;if(!executions){executions=createIntrinsicSet<WorkflowChildExecution>();rootApply(rootWeakSet,originalWorkflowChildExecutions,[parent,executions]);}const childExecution:WorkflowChildExecution={service,custody,hostInvoked:false};executions.add(childExecution);
            const latest=await readRun();validate(latest.node);
            if(view.nodeId!==handoff.nodeId||view.workflowId!==handoff.workflowId||view.nodeKind!==handoff.nodeKind||view.handoffId!==handoff.handoffId||view.attempt!==handoff.attempt||canonicalVerificationJson(view.ackInput)!==canonicalVerificationJson(latest.node.input))throw Error('WORKFLOW_HANDOFF_PARENT_MISMATCH');
            const beforeEffects=()=>{current();view.assertCurrent();view.assertLocal();};beforeEffects();
            let output:Executed|undefined,primary:unknown,present=false;
            try{childExecution.hostInvoked=true;output=await runWithOriginalRootExecutionContext(view.context,()=>custody.sdk<Executed>(runWorkflow,options,[{handoff,targetParticipantId,beforeEffects}]));}catch(raw){primary=raw;present=true;custody.inventory(raw);}
            // The semantic reader returns only the original private Host fate.
            // A module namespace is not a physical resource/DTO: its live export
            // getters must not be presented as an invented closable handle.
            const readHostFate=async()=>{
              const original=await import('./desktop-services.js');
              const fate=original.readOriginalKSwarmWorkflowNodePhysicalFate(runWorkflow,present?primary:output,view.context);
              childExecution.hostFate=fate;return fate;
            };
            const consumeHostFate=async function(this:NonNullable<WorkflowChildExecution['hostFate']>){await custody.sdk(this.waitKnown,this,[]);custody.syncVoid(this.assertKnown,this,[]);};
            try{const fate=await custody.sdk<NonNullable<WorkflowChildExecution['hostFate']>>(readHostFate,undefined,[],{accept:value=>!!value&&value===childExecution.hostFate,consumer:consumeHostFate});await custody.consumeResource(consumeHostFate,fate,[]);}catch(raw){custody.inventory(raw);if(!present){primary=raw;present=true;}}
            if(present)throw primary;return output!;
          };
          const value=await custody.sdk<OriginalWorkflowScriptChildView|null>(readOptionalOriginalWorkflowScriptChildRoot,undefined,[service,handoff.projectId,handoff.workflowRunId,handoff.nodeId],{accept(raw){if(raw===null)return false;readOriginalWorkflowScriptChildView(service,raw);return true;},consumer:consume});
          if(!value)throw Error('WORKFLOW_HANDOFF_PARENT_REQUIRED');executed=await custody.consumeResource<Executed>(consume,value,[]);
        }else{validate(first.node);current();executed=await custody.sdk<Executed>(runWorkflow,options,[{handoff,targetParticipantId,beforeEffects:current}]);}
      }else{current();executed=await custody.sdk<Executed>(runWorkflow,options,[{handoff,targetParticipantId,beforeEffects:current}]);}
      const consumeResponse=async function(this:Response){
        const ok=rootApply(bridgeResponseOk,this,[]) as boolean,status=rootApply(bridgeResponseStatus,this,[]) as number;
        await custody.sdk(bridgeResponseJson,this,[]);return {ok,status};
      };
      const response=await custody.sdk<Response>(submitWorkflow,options,[{handoff,targetParticipantId,output:executed.output??null,reviewDecision:executed.reviewDecision??null}],{accept(value){try{rootApply(bridgeResponseStatus,value,[]);return true;}catch{return false;}},consumer:consumeResponse});
      const result=await custody.consumeResource<{ok:boolean;status:number}>(consumeResponse,response,[]);
      if(!result.ok)return{ok:false,error:`workflow_submit_failed:${result.status}`};return{ok:true};
    });}catch(raw){present=true;primary=raw;custody.inventory(raw);}
    try{await custody.waitPhysicalKnown();}catch(raw){custody.inventory(raw);if(!present){present=true;primary=raw;}}
    if(present)throw primary;return outcome!;
  }

  function cancelTask(taskId: string): void {
    activeTaskControllers.get(taskId)?.abort();
  }

  const bridge={ handleTaskHandoff, handleWorkflowNodeHandoff, cancelTask, reportsExecutionStart: true as const };
  if(originalIO)rootApply(rootWeakSet,originalDirectRoots,[bridge,{
    service:options.kswarmService,runner:runDirect,
    physical(proof:object){
      const row=rootApply(rootWeakGet,acceptedRoots,[proof]) as AcceptedRoot|undefined;if(!row)throw Error('KSWARM_DIRECT_ORIGINAL_PROOF_REQUIRED');
      const assertKnown=()=>{row.custody.assertPhysicalKnown();row.settlement.assertPhysicalKnown();row.cancellation.assertPhysicalKnown();if(row.hostInvoked){if(!row.hostFate)throw Error('KSWARM_DIRECT_HOST_PHYSICAL_UNCONFIRMED');row.hostFate.assertKnown();}};
      return rootFreeze({async waitKnown(){await row.custody.waitPhysicalKnown();await row.settlement.waitPhysicalKnown();await row.cancellation.waitPhysicalKnown();if(row.hostInvoked){if(!row.hostFate)throw Error('KSWARM_DIRECT_HOST_PHYSICAL_UNCONFIRMED');await row.hostFate.waitKnown();}assertKnown();},assertKnown});
    },
    read(proof:object){const row=accepted(proof);if(activeTaskControllers.get(row.view.taskId)!==row.controller||row.controller.signal.aborted)throw Error('KSWARM_DIRECT_ROOT_NOT_CURRENT');row.identity.assertLocal();return row.view;},
    current(proof:object){const row=accepted(proof);row.identity.assertCurrent();originalIO!.assert(row.view.projectId,row.receipt);row.beforeEffects();if(activeTaskControllers.get(row.view.taskId)!==row.controller||row.controller.signal.aborted)throw Error('KSWARM_DIRECT_ROOT_NOT_CURRENT');row.identity.assertLocal();},
    revalidate(proof:object){const row=accepted(proof);return row.custody.root(async()=>{
      await row.custody.sdk(row.identity.assertCurrent,row.identity,[]);await row.custody.sdk(originalIO!.assert,originalIO,[row.view.projectId,row.receipt]);
      const fresh=await row.custody.sdk<string>(readFile,undefined,[row.handoffPath,'utf-8']);
      if(fresh!==row.raw){row.invalid=true;throw Error('KSWARM_DIRECT_HANDOFF_CHANGED');}
      row.beforeEffects();if(activeTaskControllers.get(row.view.taskId)!==row.controller||row.controller.signal.aborted)throw Error('KSWARM_DIRECT_ROOT_NOT_CURRENT');row.identity.assertLocal();
    });},
  }]);
  return bridge;
}

export interface KSwarmRuntimeBridge {
  reportsExecutionStart?: boolean;
  handleTaskHandoff(input: {
    handoffPath: string;
    projectId: string;
    taskId: string;
    runId: string;
    targetParticipantId?: string;
    signal?: AbortSignal;
    beforeEffects?:()=>void;
    onExecutionStarted?: () => Promise<void>;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  cancelTask?(taskId: string): void;
  handleWorkflowNodeHandoff?(input: {
    handoff: KSwarmWorkflowNodeHandoff;
    targetParticipantId?: string;
    beforeEffects?:()=>void;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleAssignPo?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleReviewSubmission?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handlePlanApproved?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  handleReadinessProbe?(input: {
    payload: Record<string, unknown>;
    targetParticipantId?: string;
  }): Promise<{
    ok: boolean;
    reason?: string;
    error?: string;
    capabilities?: string[];
    taskCapabilities?: string[];
    outputCapabilities?: string[];
  }>;
}

interface BrokerEvent {
  kind?: string;
  fromParticipantId?: string;
  taskId?: string | null;
  threadId?: string | null;
  payload?: Record<string, unknown>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;
type BrokerParticipantKind = 'agent' | 'service' | 'human';

export interface KSwarmRuntimeBridgeBrokerClientOptions {
  kswarmService?:KSwarmService;
  brokerUrl?: string;
  participantId: string;
  participantKind?: BrokerParticipantKind;
  alias?: string;
  roles?: string[];
  capabilities?: string[];
  allowedRoots?: string[];
  bridge: KSwarmRuntimeBridge;
  taskHeartbeatIntervalMs?: number;
  maxConcurrentTasks?: number;
  fetchImpl?: FetchLike;
  WebSocketImpl?: WebSocketConstructor;
}

export interface KSwarmRuntimeResultBrokerInput {
  brokerUrl?: string;
  participantId: string;
  logicalParticipantId?: string;
  projectId: string;
  taskId: string;
  runId: string;
  result: Record<string, unknown>;
  fetchImpl?: FetchLike;
}

export interface KSwarmWorkflowNodeResultBrokerInput {
  brokerUrl?: string;
  participantId: string;
  logicalParticipantId?: string;
  handoff: KSwarmWorkflowNodeHandoff;
  output?: Record<string, unknown> | null;
  reviewDecision?: { status: string; reason: string; evidenceRefs?: string[] } | null;
  fetchImpl?: FetchLike;
}

export async function submitKSwarmRuntimeResultToBroker(input: KSwarmRuntimeResultBrokerInput): Promise<Response> {
  const brokerUrl = normalizeBrokerUrl(input.brokerUrl ?? 'http://127.0.0.1:4318');
  const fetchImpl = input.fetchImpl ?? fetch;
  const logicalParticipantId = asNonEmptyString(input.logicalParticipantId) || input.participantId;
  const isHosted = logicalParticipantId !== input.participantId;
  const payload = {
    ...input.result,
    projectId: input.projectId,
    taskId: input.taskId,
    runId: input.runId,
    participantId: logicalParticipantId,
    ...(isHosted ? { hostParticipantId: input.participantId } : {}),
    provenance: {
      runtimeSource: 'desktop-agent-runtime',
      ...((input.result.provenance && typeof input.result.provenance === 'object')
        ? input.result.provenance as Record<string, unknown>
        : {}),
      participantId: logicalParticipantId,
      ...(isHosted ? { hostParticipantId: input.participantId } : {}),
    },
  };
  return fetchImpl(`${brokerUrl}/intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      intentId: `${input.participantId}-submit_result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'submit_result',
      opaque: true,
      fromParticipantId: input.participantId,
      taskId: input.taskId,
      threadId: `thread-${input.taskId}`,
      to: { mode: 'participant', participants: ['kswarm-hub'] },
      payload,
    }),
  });
}

export async function submitKSwarmWorkflowNodeResultToBroker(input: KSwarmWorkflowNodeResultBrokerInput): Promise<Response> {
  const brokerUrl = normalizeBrokerUrl(input.brokerUrl ?? 'http://127.0.0.1:4318');
  const fetchImpl = input.fetchImpl ?? fetch;
  const logicalParticipantId = asNonEmptyString(input.logicalParticipantId) || input.participantId;
  const isHosted = logicalParticipantId !== input.participantId;
  const payload = {
    projectId: input.handoff.projectId,
    workflowRunId: input.handoff.workflowRunId,
    workflowId: input.handoff.workflowId,
    nodeId: input.handoff.nodeId,
    attempt: input.handoff.attempt,
    handoffId: input.handoff.handoffId,
    output: input.output ?? null,
    ...(input.reviewDecision ? { reviewDecision: input.reviewDecision } : {}),
    participantId: logicalParticipantId,
    ...(isHosted ? { hostParticipantId: input.participantId } : {}),
    provenance: {
      runtimeSource: 'desktop-agent-runtime',
      participantId: logicalParticipantId,
      ...(isHosted ? { hostParticipantId: input.participantId } : {}),
      producedAt: Date.now(),
    },
  };
  return fetchImpl(`${brokerUrl}/intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      intentId: `${input.participantId}-workflow_node_result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'workflow_node_result',
      opaque: true,
      fromParticipantId: input.participantId,
      taskId: input.handoff.workflowRunId,
      threadId: `thread-${input.handoff.workflowRunId}`,
      to: { mode: 'participant', participants: ['kswarm-hub'] },
      payload,
    }),
  });
}

export function createKSwarmRuntimeBridgeBrokerClient(options: KSwarmRuntimeBridgeBrokerClientOptions) {
  const brokerUrl = normalizeBrokerUrl(options.brokerUrl ?? 'http://127.0.0.1:4318');
  const fetchImpl = options.fetchImpl ?? fetch;
  const WebSocketImpl = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketConstructor | undefined);
  let socket: WebSocketLike | null = null;
  let stopped = false;
  const bridgeStopped=new DOMException('Runtime bridge stopped','AbortError');
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const maxConcurrentTasks = options.maxConcurrentTasks ?? 3;
  let activeTaskCount = 0;
  const activeTaskControllers = new Map<string, AbortController>();
  const activeTaskRequests=new Map<string,{identity:string;promise:Promise<void>}>();
  const activeWork = new Set<Promise<void>>();
  type SocketOwner = { socket?: WebSocketLike; closed: Promise<void>; resolveClosed(): void; rejectClosed(error: unknown): void; requested: boolean; issued: boolean };
  const sockets = new Set<SocketOwner>();
  type Closing = { promise: Promise<void>; state: 'pending' | 'fulfilled' | 'rejected'; failures: unknown[]; error?: unknown };
  let closing: Closing | undefined;
  function assertPromiseRealm(): void {
    // FIRST: the existing native witness rejects species/constructor mutation without invoking it.
    assertStandardIpcPromise(bridgePromiseWitness, 'runtime_bridge_promise_unavailable');
    // Descriptor-only checks never read an ambient Promise/then accessor.
    if (!sameBridgeDataDescriptor(bridgeOwnDescriptor(globalThis, 'Promise'), bridgeGlobalPromiseDescriptor)
      || !sameBridgeDataDescriptor(bridgeOwnDescriptor(BridgePromise.prototype, 'then'), bridgeThenDescriptor)) {
      throw Error('runtime_bridge_promise_unavailable');
    }
  }
  // All begin sites are this module's private native async bodies. Arbitrary
  // foreign thenables/hostile raw.constructor mutations are not this contract.
  function ownWork<T>(begin: () => Promise<T>): Promise<T> {
    assertPromiseRealm();
    let complete!: () => void, fail!: (reason: unknown) => void;
    const reservation = new BridgePromise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    activeWork.add(reservation);
    void (async () => { try { await reservation; } catch {} })();
    const failed = (error: unknown) => { activeWork.delete(reservation); if (closing?.state === 'pending') closing.failures.push(error); fail(error); };
    try {
      const raw = begin();
      void (async () => { try { await raw; activeWork.delete(reservation); complete(); } catch (error) { failed(error); } })();
      return raw;
    } catch (error) { failed(error); return BridgePromise.reject(error); }
  }
  function newSocketOwner(): SocketOwner {
    let complete!: () => void, fail!: (error: unknown) => void;
    const closed = new BridgePromise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const owner: SocketOwner = { closed, resolveClosed: complete, rejectClosed: fail, requested: false, issued: false };
    sockets.add(owner);
    void (async () => { try { await closed; } catch {} })();
    return owner;
  }
  function requestSocketClose(owner: SocketOwner): void {
    owner.requested = true;
    if (!owner.socket || owner.issued) return;
    owner.issued = true;
    owner.socket.close(); // Same original receiver and zero arguments, synchronously.
  }
  function start(): Promise<void> {
    assertPromiseRealm();
    if (closing?.state === 'pending') return BridgePromise.reject(new Error('runtime_bridge_stop_in_progress'));
    if (closing?.state === 'rejected') return BridgePromise.reject(closing.error);
    if (closing?.state === 'fulfilled') closing = undefined; // explicit new generation only after actual retirement
    if (socket) return BridgePromise.resolve();
    return ownWork(async () => {
      stopped = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (!WebSocketImpl) throw new Error('websocket_unavailable');
      // Reserve before constructor invocation; a reentrant stop can mark the
      // still-arriving socket for immediate close after its genuine publication.
      const owner = newSocketOwner();
      let opened: WebSocketLike | undefined;
      try {
        opened = new WebSocketImpl(`${brokerUrl.replace(/^http/, 'ws')}/ws?participantId=${encodeURIComponent(options.participantId)}`);
        owner.socket = opened; socket = opened;
        const actual = opened;
        actual.onmessage = event => { void (async () => { try { await handleSocketMessage(event.data); } catch {} })(); };
        actual.onerror = () => {};
        actual.onclose = () => {
          if (socket === actual) socket = null;
          owner.resolveClosed(); sockets.delete(owner);
          if (!stopped) scheduleReconnect();
        };
        if (stopped || owner.requested) { requestSocketClose(owner); return; }
        await waitForSocketOpen(actual);
        if (stopped) return; // stop must not create a new registration after open
        await postJson('/participants/register', {
          participantId: options.participantId,
          kind: options.participantKind ?? 'agent',
          alias: options.alias ?? options.participantId,
          roles: options.roles ?? [],
          capabilities: options.capabilities ?? [],
          inboxMode: 'realtime',
          context: { runtimeSource: 'desktop-agent-runtime' },
        });
      } catch (error) {
        if (!opened) {
          // A native constructor that returns no handle owns its pre-return
          // failure. Not a claim about arbitrary injected constructor resources.
          owner.rejectClosed(error); sockets.delete(owner);
        } else {
          if (socket === opened) socket = null;
          try { requestSocketClose(owner); }
          catch (closeError) { throw new AggregateError([error, closeError], 'runtime_bridge_start_and_close_failed'); }
        }
        if (!stopped) scheduleReconnect();
        throw error;
      }
    });
  }

  function stop(): Promise<void> {
    if (closing) return closing.promise;
    assertPromiseRealm();
    let complete!: () => void, fail!: (error: unknown) => void;
    const promise = new BridgePromise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const state: Closing = { promise, state: 'pending', failures: [] };
    closing = state; // Memoize before close callbacks can synchronously reenter.
    void (async () => { try { await promise; } catch {} })();
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const admitted = [...activeWork];
    const ownedSockets = [...sockets];
    for (const owner of ownedSockets) { try { requestSocketClose(owner); } catch (error) { state.failures.push(error); } }
    socket = null;
    void (async () => {
      const seen = new Set<Promise<void>>();
      let batch = [...admitted, ...ownedSockets.map(owner => owner.closed)];
      for (;;) {
        // A sealed handler may naturally start another required HTTP completion.
        // Wait real settlement, never a tick, timeout, synthetic ACK or cancel.
        for (const raw of batch) {
          if (seen.has(raw)) continue;
          seen.add(raw);
          try { await raw; } catch (error) { state.failures.push(error); }
        }
        batch = [...activeWork, ...[...sockets].map(owner => owner.closed)].filter(raw => !seen.has(raw));
        if (!batch.length) break;
      }
      if (state.failures.length) {
        state.error = new AggregateError([...new Set(state.failures)], 'runtime_bridge_stop_unconfirmed');
        state.state = 'rejected'; fail(state.error);
      } else { state.state = 'fulfilled'; complete(); }
    })();
    return promise;
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || stopped) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch(() => scheduleReconnect());
    }, 2_000);
  }

  function handleSocketMessage(data: unknown): Promise<void> {
    if (stopped) return BridgePromise.resolve();
    return ownWork(() => dispatchSocketMessage(data));
  }
  async function dispatchSocketMessage(data: unknown): Promise<void> {
    if (stopped) return;
    const message = parseBrokerMessage(data);
    if (message?.type !== 'new_intent') return;
    const event = message.event as BrokerEvent | undefined;
    if (event?.kind === 'request_task') {
      await handleRequestTask(event);
      return;
    }
    if (event?.kind === 'cancel_task') {
      handleCancelTask(event);
      return;
    }
    if (event?.kind === 'workflow_node_handoff') {
      await handleWorkflowNodeHandoff(event);
      return;
    }
    if (event?.kind === 'readiness_probe') {
      await handleReadinessProbe(event);
      return;
    }
    if (event?.kind === 'assign_po' && typeof options.bridge.handleAssignPo === 'function') {
      const payload = event.payload ?? {};
      await options.bridge.handleAssignPo({
        payload,
        targetParticipantId: resolveEventTargetParticipantId(event, payload),
      });
      return;
    }
    if (event?.kind === 'review_submission' && typeof options.bridge.handleReviewSubmission === 'function') {
      const payload = event.payload ?? {};
      await options.bridge.handleReviewSubmission({
        payload,
        targetParticipantId: resolveEventTargetParticipantId(event, payload),
      });
      return;
    }
    if ((event?.kind === 'respond_approval' || event?.kind === 'plan_approved') && typeof options.bridge.handlePlanApproved === 'function') {
      const payload = event.payload ?? {};
      await options.bridge.handlePlanApproved({
        payload,
        targetParticipantId: resolveEventTargetParticipantId(event, payload),
      });
    }
  }

  async function handleReadinessProbe(event: BrokerEvent): Promise<void> {
    const payload = event.payload ?? {};
    const targetParticipantId = resolveEventTargetParticipantId(event, payload);
    const probeId = asNonEmptyString(payload.probeId) || asNonEmptyString(event.taskId) || `probe-${Date.now()}`;
    const agentId = asNonEmptyString(payload.agentId) || targetParticipantId;
    let probeResult: Awaited<ReturnType<NonNullable<KSwarmRuntimeBridge['handleReadinessProbe']>>>;
    if (typeof options.bridge.handleReadinessProbe === 'function') {
      try {
        probeResult = await options.bridge.handleReadinessProbe({
          payload,
          targetParticipantId,
        });
      } catch (error) {
        probeResult = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      probeResult = {
        ok: true,
        capabilities: options.capabilities ?? [],
        outputCapabilities: [],
      };
    }

    await sendIntent('readiness_probe_result', event, {
      probeId,
      agentId,
      ok: Boolean(probeResult.ok),
      ...(probeResult.ok ? {} : { reason: probeResult.reason || probeResult.error || 'readiness_probe_failed' }),
      runtimeSource: 'desktop-agent-runtime',
      capabilities: probeResult.capabilities ?? probeResult.taskCapabilities ?? [],
      outputCapabilities: probeResult.outputCapabilities ?? [],
      checkedAt: Date.now(),
    });
  }

  function handleRequestTask(event:BrokerEvent):Promise<void>{
    const payload=event.payload??{};
    if(isDefaultDispatchPreparationProtocol(payload.requiredProtocol))throw new DefaultDispatchPreparationProtocolError();
    const taskId=asNonEmptyString(payload.taskId)||asNonEmptyString(event.taskId);
    if(!taskId)return executeRequestTask(event,new AbortController());
    const identity=JSON.stringify([payload.projectId,payload.runId,payload.handoffPath,resolveEventTargetParticipantId(event,payload)]);
    const prior=activeTaskRequests.get(taskId);
    if(prior){
      if(prior.identity===identity)return prior.promise;
      return sendTaskFailed(event,{projectId:asNonEmptyString(payload.projectId),taskId,runId:asNonEmptyString(payload.runId),failureReason:'task_handoff_conflict',errorMessage:'An unsettled task handoff already owns this task'},resolveEventTargetParticipantId(event,payload));
    }
    const controller=new AbortController();activeTaskControllers.set(taskId,controller);
    const promise=BridgePromise.resolve().then(()=>executeRequestTask(event,controller)).finally(()=>{
      if(activeTaskRequests.get(taskId)?.promise===promise)activeTaskRequests.delete(taskId);
      if(activeTaskControllers.get(taskId)===controller)activeTaskControllers.delete(taskId);
    });
    activeTaskRequests.set(taskId,{identity,promise});return promise;
  }
  async function executeRequestTask(event:BrokerEvent,controller:AbortController):Promise<void>{
    const payload=event.payload??{},targetParticipantId=resolveEventTargetParticipantId(event,payload);
    const projectId=asNonEmptyString(payload.projectId),taskId=asNonEmptyString(payload.taskId)||asNonEmptyString(event.taskId),runId=asNonEmptyString(payload.runId),handoffPath=asNonEmptyString(payload.handoffPath);
    if(!projectId||!taskId||!runId||!handoffPath){await sendTaskFailed(event,{projectId,taskId,runId,failureReason:'handoff_missing',errorMessage:'request_task_missing_file_handoff'},targetParticipantId);return;}
    let counted=false,stopHeartbeat=()=>{},reading=false,guardFailure:{error:unknown}|undefined;
    try{
      controller.signal.throwIfAborted();if(stopped)throw bridgeStopped;
      reading=true;const executionStart=await readKSwarmExecutionStart(options.kswarmService as KSwarmService,projectId);reading=false;
      const beforeEffects=()=>{controller.signal.throwIfAborted();if(stopped)throw bridgeStopped;try{assertKSwarmExecutionStart(options.kswarmService as KSwarmService,executionStart);}catch(error){guardFailure={error};throw error;}};
      beforeEffects();
      if(activeTaskCount>=maxConcurrentTasks){await sendTaskFailed(event,{projectId,taskId,runId,failureReason:'desktop_capacity_full',errorMessage:`desktop runtime at capacity (${maxConcurrentTasks} concurrent tasks)`},targetParticipantId);return;}
      activeTaskCount++;counted=true;
      await sendIntent('accept_task',event,{projectId,taskId,runId},targetParticipantId,beforeEffects);
      let executing=!options.bridge.reportsExecutionStart;
      const onExecutionStarted=async()=>{beforeEffects();if(executing)return;await sendIntent('report_progress',event,{projectId,taskId,runId,stage:'started',telemetry:{executionState:'running',lastHeartbeatAt:Date.now()}},targetParticipantId,beforeEffects);executing=true;};
      await sendIntent('report_progress',event,{projectId,taskId,runId,stage:executing?'started':'queued',telemetry:{executionState:executing?'running':'queued',lastHeartbeatAt:Date.now()}},targetParticipantId,beforeEffects);
      beforeEffects();stopHeartbeat=startTaskHeartbeat(event,{projectId,taskId,runId},targetParticipantId,()=>executing,beforeEffects);
      beforeEffects();const result=await options.bridge.handleTaskHandoff({handoffPath,projectId,taskId,runId,targetParticipantId,signal:controller.signal,onExecutionStarted,beforeEffects});
      if(!result.ok){if(isTaskCancelledResult(result.error))await sendTaskCancelled(event,{projectId,taskId,runId,reason:getTaskCancelledReason(result.error)},targetParticipantId);else await sendTaskFailed(event,{projectId,taskId,runId,failureReason:result.error||'desktop_runtime_failed',errorMessage:result.error||'desktop_runtime_failed'},targetParticipantId);}
    }catch(error){
      if(error instanceof DefaultDispatchPreparationProtocolError)throw error;
      const cancelled=error===bridgeStopped||(!isKSwarmExecutionStartFailure(error)&&controller.signal.aborted&&isAbortError(error));
      const sourceFailure=reading||Boolean(guardFailure&&Object.is(error,guardFailure.error))||!cancelled;
      try{
        if(!sourceFailure&&isAbortError(error))await sendTaskCancelled(event,{projectId,taskId,runId,reason:'user_aborted'},targetParticipantId);
        else await sendTaskFailed(event,{projectId,taskId,runId,failureReason:'desktop_runtime_error',errorMessage:error instanceof Error?error.message:String(error)},targetParticipantId);
      }catch(settlement){throw new AggregateError([error,settlement],'runtime_bridge_failure_settlement_failed',{cause:error});}
      if(sourceFailure)throw error;
    }finally{if(counted)activeTaskCount--;stopHeartbeat();}
  }

  function handleCancelTask(event: BrokerEvent): void {
    const payload = event.payload ?? {};
    const taskId = asNonEmptyString(payload.taskId) || asNonEmptyString(event.taskId);
    if (!taskId) return;
    activeTaskControllers.get(taskId)?.abort();
    options.bridge.cancelTask?.(taskId);
  }

  async function handleWorkflowNodeHandoff(event: BrokerEvent): Promise<void> {
    const payload = event.payload ?? {};
    const targetParticipantId = resolveEventTargetParticipantId(event, payload);
    let handoff: KSwarmWorkflowNodeHandoff | null = null,beforeEffects:()=>void=()=>{throw Error('workflow_start_unprepared');};
    try {
      if(stopped)throw bridgeStopped;
      const projectId=asNonEmptyString(payload.projectId);if(!projectId)throw Error('workflow_handoff_project_required');
      const executionStart=await readKSwarmExecutionStart(options.kswarmService as KSwarmService,projectId);
      beforeEffects=()=>{if(stopped)throw bridgeStopped;assertKSwarmExecutionStart(options.kswarmService as KSwarmService,executionStart);};
      beforeEffects();handoff = await resolveWorkflowNodeHandoff(payload,options.allowedRoots);beforeEffects();
      if(handoff&&handoff.projectId!==projectId)throw Error('workflow_handoff_project_mismatch');
    } catch (error) {
      try{await sendIntent('workflow_node_failed', event, {
        projectId: asNonEmptyString(payload.projectId),
        workflowRunId: asNonEmptyString(payload.workflowRunId),
        nodeId: asNonEmptyString(payload.nodeId),
        attempt: payload.attempt,
        handoffId: asNonEmptyString(payload.handoffId),
        failureReason: getWorkflowNodeFailureReason(error),
        errorMessage: getWorkflowNodeFailureReason(error),
      }, targetParticipantId);}catch(settlement){throw new AggregateError([error,settlement],'runtime_bridge_workflow_failure_settlement_failed',{cause:error});}
      if(error!==bridgeStopped)throw error;
      return;
    }
    if (!handoff) {
      await sendIntent('workflow_node_failed', event, {
        projectId: asNonEmptyString(payload.projectId),
        workflowRunId: asNonEmptyString(payload.workflowRunId),
        nodeId: asNonEmptyString(payload.nodeId),
        attempt: payload.attempt,
        handoffId: asNonEmptyString(payload.handoffId),
        failureReason: 'workflow_handoff_missing',
        errorMessage: 'workflow_node_handoff_missing_identity',
      });
      return;
    }

    try{
    beforeEffects();await sendIntent('workflow_node_progress', event, {
      projectId: handoff.projectId,
      workflowRunId: handoff.workflowRunId,
      nodeId: handoff.nodeId,
      attempt: handoff.attempt,
      handoffId: handoff.handoffId,
      stage: 'started',
    }, targetParticipantId,beforeEffects);

    if (typeof options.bridge.handleWorkflowNodeHandoff !== 'function') {
      await sendIntent('workflow_node_failed', event, {
        projectId: handoff.projectId,
        workflowRunId: handoff.workflowRunId,
        nodeId: handoff.nodeId,
        attempt: handoff.attempt,
          handoffId: handoff.handoffId,
          failureReason: 'workflow_node_handler_missing',
          errorMessage: 'workflow_node_handler_missing',
      }, targetParticipantId);
      return;
    }

      beforeEffects();const result = await options.bridge.handleWorkflowNodeHandoff({
        handoff,
        targetParticipantId,beforeEffects,
      });
      if (!result.ok) {
        await sendIntent('workflow_node_failed', event, {
          projectId: handoff.projectId,
          workflowRunId: handoff.workflowRunId,
          nodeId: handoff.nodeId,
          attempt: handoff.attempt,
          handoffId: handoff.handoffId,
          failureReason: result.error || 'workflow_node_failed',
          errorMessage: result.error || 'workflow_node_failed',
        }, targetParticipantId);
      }
    } catch (error) {
      const failureReason = getWorkflowNodeFailureReason(error);
      try{await sendIntent('workflow_node_failed', event, {
        projectId: handoff.projectId,
        workflowRunId: handoff.workflowRunId,
        nodeId: handoff.nodeId,
        attempt: handoff.attempt,
        handoffId: handoff.handoffId,
        failureReason,
        errorMessage: failureReason,
      }, targetParticipantId);}catch(settlement){throw new AggregateError([error,settlement],'runtime_bridge_workflow_failure_settlement_failed',{cause:error});}
      if(error!==bridgeStopped)throw error;
    }
  }

  function startTaskHeartbeat(event: BrokerEvent, payload: { projectId: string; taskId: string; runId: string }, targetParticipantId: string, isExecuting: () => boolean = () => true,beforeEffects?:()=>void): () => void {
    const intervalMs = options.taskHeartbeatIntervalMs ?? 30_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
    const timer = setInterval(() => {
      if(stopped){clearInterval(timer);return;}
      sendIntent('report_progress', event, {
        ...payload,
        stage: isExecuting() ? 'running' : 'queued',
        telemetry: { executionState: isExecuting() ? 'running' : 'queued', lastHeartbeatAt: Date.now() },
      }, targetParticipantId,beforeEffects).catch(() => {clearInterval(timer);});
    }, intervalMs);
    return () => clearInterval(timer);
  }

  async function sendTaskFailed(
    event: BrokerEvent,
    payload: Record<string, unknown>,
    targetParticipantId: string,
  ): Promise<void> {
    await sendIntent('task_failed', event, payload, targetParticipantId);
  }

  async function sendTaskCancelled(
    event: BrokerEvent,
    payload: Record<string, unknown>,
    targetParticipantId: string,
  ): Promise<void> {
    await sendIntent('task_cancelled', event, payload, targetParticipantId);
  }

  async function sendIntent(
    kind: string,
    event: BrokerEvent,
    payload: Record<string, unknown>,
    targetParticipantId = resolveEventTargetParticipantId(event, payload),
    beforeEffects?:()=>void,
  ): Promise<Response> {
    return postJson('/intents', {
      intentId: `${options.participantId}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      opaque: true,
      fromParticipantId: options.participantId,
      taskId: asNonEmptyString(event.taskId) || asNonEmptyString(payload.taskId) || null,
      threadId: asNonEmptyString(event.threadId) || null,
      to: { mode: 'participant', participants: [event.fromParticipantId || 'kswarm-hub'] },
      payload: withRuntimeParticipantPayload(payload, targetParticipantId),
    },beforeEffects);
  }

  function resolveEventTargetParticipantId(event: BrokerEvent, payload: Record<string, unknown> = event.payload ?? {}): string {
    return asNonEmptyString(payload.targetAgentId)
      || asNonEmptyString(payload.participantId)
      || asNonEmptyString(payload.agentId)
      || options.participantId;
  }

  function withRuntimeParticipantPayload(payload: Record<string, unknown>, targetParticipantId: string): Record<string, unknown> {
    const cleanPayload = { ...payload };
    delete cleanPayload.hostParticipantId;
    return {
      ...cleanPayload,
      participantId: targetParticipantId,
      ...(targetParticipantId !== options.participantId ? { hostParticipantId: options.participantId } : {}),
    };
  }

  function postJson(path: string, body: Record<string, unknown>,beforeEffects?:()=>void): Promise<Response> {
    return ownWork(async () => {
      assertBeforeEffects(beforeEffects);
      const response = await fetchImpl(`${brokerUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Preserve the original headers/status ACK while separately owning the
      // actual HTTP body EOF. Internal callers never expose or read this body.
      const bodyDrain = ownWork(async () => {
        const body = response.body;
        if (body) {
          const reader = body.getReader();
          try { for (;;) { if ((await reader.read()).done) break; } }
          finally { reader.releaseLock(); }
        }
      });
      void (async () => { try { await bodyDrain; } catch {} })();
      if (!response.ok) throw new Error(`broker_http_${response.status}`);
      return response;
    });
  }

  return { start, stop, handleSocketMessage };
}

function isAllowedPath(filePath: string, allowedRoots: string[] | undefined): boolean {
  if (!allowedRoots || allowedRoots.length === 0) return true;
  const resolvedFile = resolve(filePath);
  return allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    if (resolvedFile === resolvedRoot) return true;
    // Use path.relative for containment instead of a hardcoded `/` prefix,
    // which never matched on Windows (separator is `\`) and rejected valid
    // in-root handoff paths.
    const rel = relative(resolvedRoot, resolvedFile);
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
  });
}

function normalizeBrokerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function getWorkflowNodeFailureReason(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error ?? '');
  const firstLine = raw.split(/\r?\n/)[0]?.trim() || 'workflow_node_error';
  return firstLine.length > 500 ? `${firstLine.slice(0, 497)}...` : firstLine;
}

function isTaskCancelledResult(error: string | undefined): boolean {
  return error === 'task_cancelled' || Boolean(error?.startsWith('task_cancelled:'));
}

function getTaskCancelledReason(error: string | undefined): string {
  if (!error) return 'user_aborted';
  const [, reason] = error.split(':', 2);
  return reason || 'user_aborted';
}

function parseBrokerMessage(data: unknown): { type?: string; event?: unknown } | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as { type?: string; event?: unknown };
    if (data instanceof Buffer) return JSON.parse(data.toString('utf-8')) as { type?: string; event?: unknown };
  } catch {
    return null;
  }
  return null;
}

async function resolveWorkflowNodeHandoff(payload: Record<string, unknown>, allowedRoots?: string[]): Promise<KSwarmWorkflowNodeHandoff | null> {
  const compact = normalizeWorkflowNodeHandoff(payload);
  const handoffPath = asNonEmptyString(payload.handoffPath);
  if (!handoffPath) return compact;
  if (!isAllowedPath(handoffPath, allowedRoots)) {
    throw new Error('workflow_handoff_path_outside_allowed_roots');
  }
  const raw = await readFile(handoffPath, 'utf-8');
  const fromFile = JSON.parse(raw) as unknown;
  if (!isRecord(fromFile)) throw new Error('workflow_handoff_file_invalid');
  const handoff = normalizeWorkflowNodeHandoff(fromFile);
  if (!handoff) return null;
  if (compact && !sameWorkflowNodeHandoffIdentity(compact, handoff)) {
    throw new Error('workflow_handoff_file_identity_mismatch');
  }
  return {
    ...handoff,
    handoffPath,
  };
}

function sameWorkflowNodeHandoffIdentity(a: KSwarmWorkflowNodeHandoff, b: KSwarmWorkflowNodeHandoff): boolean {
  return a.projectId === b.projectId
    && a.workflowRunId === b.workflowRunId
    && a.nodeId === b.nodeId
    && a.handoffId === b.handoffId
    && Number(a.attempt) === Number(b.attempt);
}

function normalizeWorkflowNodeHandoff(payload: Record<string, unknown>): KSwarmWorkflowNodeHandoff | null {
  const projectId = asNonEmptyString(payload.projectId);
  const workflowRunId = asNonEmptyString(payload.workflowRunId);
  const workflowId = asNonEmptyString(payload.workflowId);
  const nodeId = asNonEmptyString(payload.nodeId);
  const nodeTitle = asNonEmptyString(payload.nodeTitle) || nodeId;
  const nodeKind = asNonEmptyString(payload.nodeKind) || 'agent_task';
  const handoffId = asNonEmptyString(payload.handoffId);
  const attempt = Number(payload.attempt);
  if (!projectId || !workflowRunId || !workflowId || !nodeId || !handoffId || !Number.isFinite(attempt)) return null;
  return {
    projectId,
    workflowRunId,
    workflowId,
    nodeId,
    nodeKind,
    nodeTitle,
    attempt,
    handoffId,
    input: isRecord(payload.input) ? payload.input : null,
    handoffPath: asNonEmptyString(payload.handoffPath) || null,
    project: isRecord(payload.project) ? {
      id: asNonEmptyString(payload.project.id) || projectId,
      name: asNonEmptyString(payload.project.name),
      goal: asNonEmptyString(payload.project.goal),
      status: asNonEmptyString(payload.project.status),
      workFolder: asNonEmptyString(payload.project.workFolder) || null,
    } : { id: projectId },
  };
}

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function waitForSocketOpen(socket: WebSocketLike): Promise<void> {
  return new BridgePromise<void>((resolve, reject) => {
    const previousError = socket.onerror;
    const previousClose = socket.onclose;
    const timer = setTimeout(() => {
      restore();
      reject(new Error('websocket_open_timeout'));
    }, 5_000);
    const restore = () => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = previousError;
      socket.onclose = previousClose;
    };
    socket.onopen = () => {
      restore();
      resolve();
    };
    socket.onerror = () => {
      previousError?.();
      restore();
      reject(new Error('websocket_error'));
    };
    socket.onclose = () => {
      previousClose?.();
      restore();
      reject(new Error('websocket_closed'));
    };
  });
}
