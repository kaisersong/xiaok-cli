import { createTransportAuthorizationError } from '../../runtime/sol-pi/transport-lease.js';
import { consumeDelegatedObservationExecutionPlan, suspendDelegatedObservationOwner, resumeDelegatedObservationOwner, type DelegatedObservationExecutionPlan } from '../../runtime/sol-pi/delegated-session-owner.js';
import { type ObservationSessionOwner } from '../../runtime/sol-pi/observation-session-owner.js';
import { Agent } from '../agent.js';
import { SubAgentRunReporter, type SubAgentProgressEvent } from './subagent-presentation.js';
import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { AgentSessionSnapshot } from '../runtime/session.js';
import type { WorktreeAllocationRecord } from '../../platform/worktrees/manager.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
import { ManagedAgentSessionCreationError, type ManagedAgentRunContext } from './multi-agent-coordinator.js';
import {
  buildSynthesizedProviderContext,
  isStrictKimiK3Adapter,
} from '../runtime/provider-private-projection.js';

interface ModelClonableAdapter extends ModelAdapter {
  cloneWithModel(model: string): ModelAdapter;
}

/** Fork consumption only; not a host-context or authorization producer. */
type SubAgentForkControls = Pick<ToolExecutionContext, 'signal' | 'settingsStore'>;

type SubAgentForkHistory = Pick<ToolExecutionContext, 'session' | 'messages'>;

/** Full snapshots retain their protected closure; history fields are paired.
 * A signal in forkContext is consumed by the one-shot wrapper only.
 * Preserve the complete host shape for existing inline callers without weakening it.
 */
export type SubAgentForkContext = ToolExecutionContext | (SubAgentForkControls & (
  | SubAgentForkHistory
  | { session?: undefined; messages?: undefined }
));

export interface ExecuteNamedSubAgentOptions {
  observationExecutionPlan?: DelegatedObservationExecutionPlan;
  onSubAgentEvent?: (event: SubAgentProgressEvent) => void;
  onCompleted?: () => void;
  onObservationOwnerReady?: (owner: ObservationSessionOwner) => void;
  taskDescription?: string;
  agentDef: CustomAgentDef;
  prompt: string;
  sessionId: string;
  cwd?: string;
  adapter: () => ModelAdapter;
  createRegistry(
    cwd: string,
    allowedTools?: string[],
    agentId?: string,
    opts?: { parentDepth?: number },
  ): ToolRegistry;
  buildSystemPrompt(cwd: string): Promise<string>;
  worktreeManager?: WorktreeManager;
  forkContext?: SubAgentForkContext;
  parentDepth?: number;
  runtimeAgentId?: string;
  collaborationPrompt?: string;
  releaseRegistry?: (registry: ToolRegistry) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface NamedSubAgentSession {
  run(prompt: string, signal?: AbortSignal, context?: ManagedAgentRunContext): Promise<string>;
  suspend(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createNamedSubAgentSession(
  options: Omit<ExecuteNamedSubAgentOptions, 'prompt'>,
): Promise<NamedSubAgentSession> {
  options.signal?.throwIfAborted();
  const resolved = await resolveSubAgentCwd(
    options.worktreeManager,
    options.agentDef,
    options.sessionId,
    options.cwd,
    options.runtimeAgentId,
  );
  const cwd = resolved.cwd;
  let registry: ToolRegistry | undefined;
  let agent: Agent | undefined;
  let checkpoint: AgentSessionSnapshot | undefined;
  let observationOwner: ObservationSessionOwner | undefined;
  let observationExecution: Awaited<ReturnType<typeof consumeDelegatedObservationExecutionPlan>>['execution'];
  let observationRotation: object | undefined;
  const reporter = new SubAgentRunReporter(options.agentDef.name, options.runtimeAgentId, options.onSubAgentEvent);
  let deactivated = false;
  let deactivatePromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let suspending=false,suspension:Promise<void>|undefined,runTail:Promise<void>|undefined;
  const suspensionFailures:unknown[]=[];
  const deactivate = (): Promise<void> => {
    deactivated = true;
    if (!registry) return Promise.resolve();
    const currentRegistry = registry;
    deactivatePromise ??= Promise.resolve().then(() => options.releaseRegistry
      ? options.releaseRegistry(currentRegistry) : currentRegistry.dispose());
    return deactivatePromise;
  };
  const disposeResources = (): Promise<void> => {
    if(disposePromise)return disposePromise;
    deactivated=true;
    const currentAgent=agent;currentAgent?.stopNewRuns();
    disposePromise=(async()=>{
      const blockers=await Promise.allSettled([deactivate(),currentAgent?.waitForStoppedResources(),runTail,suspension]);
      const errors=[...suspensionFailures,...blockers.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason)];
      // A run's final delegated publication still owns the execution port.
      // Only close that port after all admitted producers have ended.
      const execution=await Promise.allSettled([Promise.resolve().then(()=>observationExecution?.dispose())]);
      for(const result of execution)if(result.status==='rejected')errors.push(result.reason);
      if(!errors.length&&resolved.allocation?.cleanup==='delete'){
        try{await options.worktreeManager?.release(resolved.allocation.path);}catch(error){errors.push(error);}
      }
      // Settled cleanup failures must not leave usable execution authority.
      // Revocation is a control tombstone, never proof of physical release.
      try{observationOwner?.dispose();}catch(error){errors.push(error);}
      if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'subagent_physical_cleanup_unconfirmed');
      currentAgent?.dispose();await currentAgent?.waitForDisposedResources();
      agent=undefined;checkpoint=undefined;
    })();
    return disposePromise;
  };

  try {
    options.signal?.throwIfAborted();
    const systemPromptBase = await options.buildSystemPrompt(cwd);
    options.signal?.throwIfAborted();
    registry = options.createRegistry(
      cwd,
      options.agentDef.allowedTools,
      options.runtimeAgentId ?? options.agentDef.name,
      { parentDepth: options.parentDepth },
    );
    const systemPrompt = [
      systemPromptBase,
      options.agentDef.systemPrompt,
      options.collaborationPrompt,
    ].filter(Boolean).join('\n\n');
    const baseAdapter = options.adapter();
    const strictK3Parent = isStrictKimiK3Adapter(baseAdapter);
    const adapter = resolveSubAgentAdapter(baseAdapter, options.agentDef.model, options.agentDef.modelCapability, options.forkContext);
    const delegated = options.observationExecutionPlan === undefined ? undefined
      : await consumeDelegatedObservationExecutionPlan(options.observationExecutionPlan, registry);
    observationOwner = delegated?.owner; observationExecution = delegated?.execution;
    if (delegated) { options.onObservationOwnerReady?.(delegated.owner); }
    const sourceSnapshot = delegated?.source ?? options.forkContext?.session;
    const sourceMessages = delegated?.source.messages ?? options.forkContext?.messages;
    let runContext: ManagedAgentRunContext | undefined;
    let running = false;
    const createAgent = () => new Agent(adapter, registry!, systemPrompt, {
      maxIterations: options.agentDef.maxIterations,
      providerSurfaceKind: 'cli-subagent',
      ...(delegated ? { initialSession: delegated.session, observationOwner: delegated.owner } : {}),
      onActivity: (activity) => {
        reporter.activity(activity);
        runContext?.onActivity(activity);
      },
      takePendingInput: () => runContext?.takePendingInput(),
    });
    agent = createAgent();

    const strictK3 = isStrictKimiK3Adapter(adapter);
    if (delegated && !strictK3Parent && !strictK3) {
      delegated.session.replaceMessages(completedForkSnapshot(delegated.source).messages);
    } else if (sourceSnapshot && !strictK3Parent && !strictK3) {
      agent.restoreSession(completedForkSnapshot(sourceSnapshot));
    } else if (options.forkContext?.session?.protectedObservationClosure) {
      // Synthesized strict-provider history is still derived from protected bytes.
      // Keep its host-only closure so the child cannot send without reauthorization.
      agent.getSessionState().addProtectedObservationReferences(options.forkContext.session.protectedObservationClosure.observations);
    }
    let firstRun = true;

    return {
      async run(prompt, signal, context) {
        if (disposePromise) throw new Error(`subagent session is disposed: ${options.runtimeAgentId ?? options.agentDef.name}`);
        if (deactivated) throw new Error(`subagent session is deactivated: ${options.runtimeAgentId ?? options.agentDef.name}`);
        if (running) throw new Error('subagent session already has an active run');
        if(suspending)throw Error('subagent session is suspending');
        const runPrompt = firstRun && (strictK3Parent || strictK3) && sourceMessages
          ? `${buildSynthesizedProviderContext('subagent', sourceMessages)}\n\n`
            + `Current child task:\n${prompt}`
          : prompt;
        const displayTask = firstRun && options.taskDescription?.trim() ? options.taskDescription : prompt;
        firstRun = false;
        running = true;
        runContext = context;
        let finishRun!:()=>void;runTail=new Promise<void>(resolve=>{finishRun=resolve;});
        const chunks: string[] = [];
        let finalResponse = '';
        let iterationLimitReached = false;
        let publicationAttempted = false;
        let failedBinding: {error:unknown}|undefined;
        let settledBodyResult!: string;
        let settledBodyFailure: {
            error: unknown;
        } | undefined;
        try {
            try {
                reporter.start(displayTask);
                if (deactivated || disposePromise)
                    throw Error('subagent session is deactivated');
                if (!agent) {
                    registry = options.createRegistry(cwd, options.agentDef.allowedTools, options.runtimeAgentId ?? options.agentDef.name, { parentDepth: options.parentDepth });
                    if (delegated) {
                        if (!observationRotation)
                            throw new Error('SOL_PI_DELEGATED_ROTATION_REQUIRED');
                        registry.registerTool(delegated.recallTool);
                        try {
                            await observationExecution?.bindRegistry(registry);
                        }
                        catch (error) {
                            deactivated = true;
                            failedBinding = { error };
                            throw error;
                        }
                        if (deactivated || disposePromise)
                            throw Error('subagent session is deactivated');
                        resumeDelegatedObservationOwner(observationRotation, registry);
                        observationRotation = undefined;
                    }
                    if (deactivated || disposePromise)
                        throw Error('subagent session is deactivated');
                    agent = createAgent();
                    if (checkpoint)
                        agent.restoreSession(checkpoint);
                    checkpoint = undefined;
                }
                if (deactivated || disposePromise)
                    throw Error('subagent session is deactivated');
                await agent.runTurn(runPrompt, (chunk) => {
                    if (chunk.type === 'text') {
                        chunks.push(chunk.delta);
                        finalResponse += chunk.delta;
                    }
                }, signal, undefined, (event) => {
                    if (event.type === 'max_iterations_reached')
                        iterationLimitReached = true;
                    if (event.type === 'tool_started')
                        finalResponse = '';
                    if (event.type === 'tool_finished')
                        reporter.toolFinished(event.toolName, event.ok);
                });
                if (iterationLimitReached)
                    throw new Error('SUBAGENT_ITERATION_LIMIT: task did not finish within its iteration budget');
                let result = chunks.join('').trim();
                if (delegated) {
                    publicationAttempted = true;
                    result = await delegated.complete(result);
                }
                if (!signal?.aborted)
                    options.onCompleted?.();
                reporter.finish(signal?.aborted ? 'interrupted' : 'completed', signal?.aborted ? undefined : finalResponse.trim());
                {
                    settledBodyResult = result;
                }
            }
            catch (error) {
                if (delegated && !publicationAttempted) {
                    try {
                        publicationAttempted = true;
                        await delegated.complete('');
                    }
                    catch {
                        throw createTransportAuthorizationError();
                    }
                }
                reporter.finish(signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'interrupted' : 'failed');
                throw error;
            }
        }
        catch (error) {
            settledBodyFailure = { error };
        }
        {
            runContext = undefined;
            running = false;
            finishRun();
            runTail = undefined;
            // The cleanup waits the original run admission. Finish it first;
            // never await our own physical disposal from inside that admission.
            if (failedBinding) {
                try {
                    await disposeResources();
                }
                catch (cleanupError) {
                    throw new AggregateError([failedBinding.error, cleanupError], 'subagent_registry_binding_cleanup_unconfirmed');
                }
            }
        }
        if (settledBodyFailure)
            throw settledBodyFailure.error;
        return settledBodyResult;
      },
      async suspend() {
        if(running)throw Error('cannot suspend an active subagent run');
        if(deactivated||disposePromise)return;
        if(suspension)return suspension;
        suspending=true;
        const work=(async()=>{
          await agent?.waitForIdleResources();
          if(deactivated||disposePromise)return;
          if(observationOwner&&registry)observationRotation=await suspendDelegatedObservationOwner(observationOwner,registry);
          else if(agent)checkpoint=agent.exportSession();
          if(deactivated||disposePromise)return;
          if(registry){
            const currentRegistry=registry;
            deactivatePromise??=Promise.resolve().then(()=>options.releaseRegistry?options.releaseRegistry(currentRegistry):currentRegistry.dispose());
            await deactivatePromise;
          }
          if(deactivated||disposePromise)return;
          agent=undefined;registry=undefined;deactivatePromise=undefined;
        })();suspension=work;
        try{await work;}catch(error){deactivated=true;suspensionFailures.push(error);throw error;}
        finally{suspending=false;if(suspension===work)suspension=undefined;}
      },
      deactivate,
      dispose: disposeResources,
    };
  } catch (error) {
    try {
      await disposeResources();
    } catch (cleanupError) {
      throw new ManagedAgentSessionCreationError(error, cleanupError);
    }
    throw error;
  }
}

function completedForkSnapshot(snapshot: AgentSessionSnapshot): AgentSessionSnapshot {
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message.role !== 'assistant') continue;
    const calls = message.content.filter((block) => block.type === 'tool_use');
    if (calls.length === 0) continue;
    const next = snapshot.messages[index + 1];
    const results = next?.role === 'user'
      ? next.content.filter((block) => block.type === 'tool_result')
      : [];
    const resultIds = new Set(results.map((block) => block.tool_use_id));
    if (results.length !== calls.length || resultIds.size !== calls.length
      || calls.some((call) => !resultIds.has(call.id))) {
      // Tools fork while their parent's current batch is still in flight.
      // Inherit only committed exchanges; never fabricate results or mutate
      // the parent, which will append its real results after this tool returns.
      return { ...snapshot, messages: snapshot.messages.slice(0, index) };
    }
  }
  return snapshot;
}

export async function executeNamedSubAgent(options: ExecuteNamedSubAgentOptions): Promise<string> {
  const signals = [
    ...(options.signal ? [options.signal] : []),
    ...(options.forkContext?.signal ? [options.forkContext.signal] : []),
  ];
  const childSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  const session = await createNamedSubAgentSession({ ...options, signal: childSignal });

  try {
    return await session.run(options.prompt, childSignal);
  } finally {
    await session.dispose();
  }
}

function resolveSubAgentAdapter(
  adapter: ModelAdapter,
  modelOverride?: string,
  capabilityOverride?: string,
  ctx?: SubAgentForkContext,
): ModelAdapter {
  if (modelOverride && capabilityOverride) {
    throw new Error('model and modelCapability are mutually exclusive');
  }
  if (modelOverride) {
    if (!supportsModelClone(adapter)) return adapter;
    return adapter.cloneWithModel(modelOverride);
  }
  if (capabilityOverride) {
    if (!ctx?.settingsStore) throw new Error('settings context required for capability routing');
    const resolved = resolveCapability(capabilityOverride, ctx);
    if (!resolved) throw new Error(`unknown capability: ${capabilityOverride}`);
    if (!supportsModelClone(adapter)) throw new Error('model clone required for capability routing');
    return adapter.cloneWithModel(resolved);
  }
  return adapter;
}

function resolveCapability(capability: string, ctx: SubAgentForkContext): string | null {
  const settings = ctx.settingsStore?.getSettings();
  return settings?.modelCapabilities?.[capability] || null;
}

function supportsModelClone(adapter: ModelAdapter): adapter is ModelClonableAdapter {
  return typeof (adapter as Partial<ModelClonableAdapter>).cloneWithModel === 'function';
}

export async function resolveSubAgentCwd(
  manager: WorktreeManager | undefined,
  agent: CustomAgentDef,
  sessionId: string,
  cwd = process.cwd(),
  runtimeAgentId?: string,
): Promise<{ cwd: string; allocation?: WorktreeAllocationRecord }> {
  if (agent.isolation !== 'worktree') {
    return { cwd };
  }
  if (!manager) {
    throw new Error(`worktree manager is required for isolated agent ${agent.name}`);
  }

  const allocationId = runtimeAgentId ?? sessionId;
  const branch = `${agent.name}-${allocationId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const allocation = await manager.allocate({
    owner: agent.name,
    taskId: allocationId,
    branch,
    cleanup: agent.cleanup ?? 'keep',
  });
  return {
    cwd: allocation.path,
    allocation,
  };
}
