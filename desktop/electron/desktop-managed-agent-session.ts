import { createDesktopModelPhysicalScope, closeDesktopModelPhysicalScope, waitDesktopModelPhysicalIdle, assertDesktopModelPhysicalIdle } from './desktop-task-stream.js';
import { consumeDelegatedObservationExecutionPlan, assertDelegatedObservationPaused, suspendDelegatedObservationOwner, resumeDelegatedObservationOwner, type DelegatedObservationExecutionPlan } from '../../src/runtime/sol-pi/delegated-session-owner.js';
import { bindDesktopDelegatedObservationSession, type DesktopObservationBinding } from './desktop-observation-owner.js';
import type { DesktopMultiAgentService, DesktopObservationChildPreparation } from './desktop-multi-agent-service.js';
import { getObservationSessionOwnerHostBinding, type ObservationSessionOwner } from '../../src/runtime/sol-pi/observation-session-owner.js';
import { projectDesktopToolResultForModel } from './desktop-tool-result.js';
import type { Message, ModelAdapter } from '../../src/types.js';
import type { ManagedAgentRunContext, ManagedAgentSession } from '../../src/ai/agents/multi-agent-coordinator.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';
import type { SkillCatalog } from '../../src/ai/skills/loader.js';
import type { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import type { MaterialRecord } from '../../src/runtime/task-host/types.js';
import type { TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import { buildSynthesizedProviderContext, isStrictKimiK3Adapter, projectProviderPrivateMessages } from '../../src/ai/runtime/provider-private-projection.js';
import { completedForkMessages } from '../../src/ai/agents/completed-fork-messages.js';
import { randomUUID } from 'node:crypto';
import type { DesktopAgentExecutionContext } from './desktop-multi-agent-service.js';
import { runDesktopToolLoop } from './desktop-services.js';
import {bindCompoundFinalPublicationConsumer,runCompoundTurnInput} from '../../src/runtime/sol-pi/compound-publication-producer.js';
import {getCompoundPublicationOwnerBinding} from '../../src/runtime/sol-pi/compound-managed-lifecycle.js';

export interface DesktopAgentFork {
  mode: 'none' | 'completed_prefix' | 'synthesized'; truncated: boolean; messages: Message[];
}

export function buildDesktopAgentFork(adapter: object, parent: readonly Message[], enabled: boolean): DesktopAgentFork {
  if (!enabled) return { mode: 'none', truncated: false, messages: [] };
  const complete = completedForkMessages(parent);
  if (!isStrictKimiK3Adapter(adapter)) return { mode: 'completed_prefix', truncated: complete.length !== parent.length, messages: structuredClone([...complete]) };
  // Use the existing strict schema/visibility projection, never stringify private
  // provider blocks or infer strictness from a caller-controlled model name.
  const visible = projectProviderPrivateMessages(complete);
  const envelope = buildSynthesizedProviderContext('subagent', visible);
  const records = (JSON.parse(envelope) as { records: Array<{ ordinal: number }> }).records;
  const firstVisible = visible.findIndex(message => message.content.length > 0);
  const truncated = complete.length !== parent.length || firstVisible >= 0 && (records.length === 0 || records[0].ordinal > firstVisible);
  return { mode: 'synthesized', truncated, messages: [{ role: 'user', content: [{ type: 'text', text: envelope }] }] };
}

export interface DesktopManagedAgentSessionOptions {
  observationOwner?: ObservationSessionOwner;
  adapter: Pick<ModelAdapter, 'stream'>;
  systemPrompt: string;
  parentMessages?: readonly Message[];
  forkContext?: boolean;
  model?: string;
  modelCapability?: string;
  getTurnContext(): DesktopAgentExecutionContext;
  createRegistry(context: DesktopAgentExecutionContext, signal?: AbortSignal): { registry: ToolRegistry; dispose(): void };
  dataRoot: string;
  materials: MaterialRecord[];
  materialRegistry?: MaterialRegistry;
  skillCatalog: SkillCatalog;
  emitRuntimeEvent(event: Parameters<TaskRunnerInput['emitRuntimeEvent']>[0], context: DesktopAgentExecutionContext): void | Promise<void>;
  onUsage?(inputTokens: number, outputTokens: number, usageId: string | undefined, context: DesktopAgentExecutionContext): void | Promise<void>;
  onToolFinished?(context: DesktopAgentExecutionContext, fact: { executionEventId: string; toolName: string; ok: boolean }): void | Promise<void>;
  maxIterations?: number;
  runObservedTurn?<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>;
  /** Managed worktrees are released by the owning journal, only after settlement. */
  releaseResources?(): Promise<void>;
}

/** A child has its own messages and per-turn registry, but uses Desktop's loop. */
export class DesktopManagedAgentSession implements ManagedAgentSession {
  private readonly modelPhysicalScope = createDesktopModelPhysicalScope(() => { if (this.closed) throw Error('desktop_agent_session_closed'); });
  private deactivation?: Promise<void>;
  readonly fork: Readonly<Pick<DesktopAgentFork, 'mode' | 'truncated'>>;
  private messages: Message[];
  private readonly lifetime = new AbortController();
  private running?: Promise<string>;
  private scope?: ReturnType<DesktopManagedAgentSessionOptions['createRegistry']>;
  private disposal?: Promise<void>;
  private closed = false;
  private observed?: { child: Awaited<ReturnType<typeof consumeDelegatedObservationExecutionPlan>>; service: DesktopMultiAgentService; binding: DesktopObservationBinding;
    host: ReturnType<typeof getObservationSessionOwnerHostBinding>; initialScope?: ReturnType<DesktopManagedAgentSessionOptions['createRegistry']>; rotation?: object };
  static async prepareObserved(options: DesktopManagedAgentSessionOptions, input: { plan: DelegatedObservationExecutionPlan;
    scope: ReturnType<DesktopManagedAgentSessionOptions['createRegistry']>; service: DesktopMultiAgentService;
    context: DesktopAgentExecutionContext; preparation: DesktopObservationChildPreparation }) {
    if (input.service.assertObservationChildPreparation(input.preparation).context !== input.context) throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
    const child = await consumeDelegatedObservationExecutionPlan(input.plan, input.scope.registry);
    try {
      const session = new DesktopManagedAgentSession({ ...options, observationOwner: undefined, parentMessages: child.source.messages });
      child.session.replaceMessages(session.messages);
      child.session.addProtectedObservationReferences([]);
      const binding = bindDesktopDelegatedObservationSession({ service: input.service, context: input.context, preparation: input.preparation,
        owner: child.owner, session: child.session, registry: input.scope.registry });
      session.observed = { child, host: getObservationSessionOwnerHostBinding(child.owner), service: input.service, binding, initialScope: input.scope };
      return Object.freeze({ session, owner: child.owner, nativeSession: child.session, registry: input.scope.registry });
    } catch (error) { try { await child.execution?.dispose(); } finally { child.owner.dispose(); input.scope.dispose(); } throw error; }
  }
  private lastTurn = 0;
  private lastTurnId?: string;

  constructor(private readonly options: DesktopManagedAgentSessionOptions) {
    if (options.model !== undefined || options.modelCapability !== undefined) throw new Error('desktop_multi_agent_model_override_unsupported');
    const fork = buildDesktopAgentFork(options.adapter, options.parentMessages ?? [], options.forkContext !== false);
    this.fork = Object.freeze({ mode: fork.mode, truncated: fork.truncated });
    this.messages = fork.messages;
  }

  /** Actual Runtime calls after the initial complete closure publication, before Main activation. */
  async prepareInitialObservedTurn():Promise<void> {
    if(this.closed||this.running||!this.observed?.initialScope)throw Error('SOL_PI_DESKTOP_INITIAL_TURN_PREPARATION_STALE');
    await this.observed.child.execution?.prepareInitialTurn?.();
    if(this.closed||this.running||!this.observed?.initialScope)throw Error('SOL_PI_DESKTOP_INITIAL_TURN_PREPARATION_STALE');
  }

  /** Native Runtime selects this instance by its actual source session object. */
  prepareObservedChild(input:Parameters<import('../../src/runtime/sol-pi/product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild']>[0]) {
    const observed=this.observed,prepare=observed?.child.execution?.prepareManagedChild;
    if(this.closed||!this.running||!observed||!prepare)throw Error('SOL_PI_DESKTOP_CHILD_INSTALLATION_REQUIRED');
    observed.child.owner.assertSession(observed.child.session);
    return prepare(input);
  }

  /** Main routes only its private prepared operation to this actual resident session. */
  async prepareObservedFollowup(preparation:unknown):Promise<import('../../src/runtime/sol-pi/compound-managed-followup.js').PreparedManagedCompoundFollowup> {
    const observed=this.observed,previousTurnId=this.lastTurnId;
    if(this.closed||!observed||observed.initialScope)throw Error('SOL_PI_DESKTOP_FOLLOWUP_NOT_READY');
    await this.running?.catch(()=>{});
    if(this.closed||this.observed!==observed||this.lastTurnId!==previousTurnId||!observed.rotation)throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
    const facts=observed.service.inspectManagedFollowupPreparation(preparation);
    if(facts.childSession!==observed.child.session||facts.previousTurnId!==previousTurnId)throw Error('SOL_PI_DESKTOP_FOLLOWUP_STALE');
    assertDelegatedObservationPaused(observed.child.owner,observed.rotation);
    const prepare=observed.child.execution?.prepareManagedFollowup;
    if(!prepare)throw Error('SOL_PI_DESKTOP_FOLLOWUP_INSTALLATION_REQUIRED');
    return prepare({preparation,pausedTicket:observed.rotation});
  }

  run(message: string, signal?: AbortSignal, activity?: ManagedAgentRunContext): Promise<string> {
    if (this.options.observationOwner) return Promise.reject(new Error('SOL_PI_DESKTOP_CHILD_OBSERVATION_NOT_READY'));
    if (this.closed) return Promise.reject(new Error('desktop_agent_session_closed'));
    if (this.running) return Promise.reject(new Error('desktop_agent_session_busy'));
    try { assertDesktopModelPhysicalIdle(this.modelPhysicalScope); } catch (error) { return Promise.reject(error); }
    if (signal?.aborted) return Promise.reject(signal.reason);
    // Install the execution promise before any provider/registry code can run.
    const execute = async (groupSignal?:AbortSignal) => {
      const context = this.options.getTurnContext();
      if (context.turn <= this.lastTurn || context.turnId === this.lastTurnId) throw new Error('desktop_agent_turn_already_started');
      this.lastTurn = context.turn; this.lastTurnId = context.turnId;
      const boundSignal = AbortSignal.any([this.lifetime.signal, context.signal, ...(signal ? [signal] : []),...(groupSignal?[groupSignal]:[])]);
      boundSignal.throwIfAborted();
      let modelBodyFailure: { error: unknown } | undefined;
      let modelResult: string | undefined;
      try {
      const initialObservedTurn=!!this.observed?.initialScope;
      if (this.observed?.initialScope) { this.scope = this.observed.initialScope; this.observed.initialScope = undefined; }
      else {
        this.scope = this.options.createRegistry(context, boundSignal);
        if (this.observed) {
          if (!this.observed.rotation) throw Error('SOL_PI_DELEGATED_ROTATION_REQUIRED');
          this.scope.registry.registerTool(this.observed.child.recallTool);
          await this.observed.child.execution?.bindRegistry(this.scope.registry);
          resumeDelegatedObservationOwner(this.observed.rotation, this.scope.registry); this.observed.rotation = undefined;
          this.observed.binding = bindDesktopDelegatedObservationSession({ service: this.observed.service, context,
            owner: this.observed.child.owner, session: this.observed.child.session, registry: this.scope.registry });
        }
      }
      const installTurnInput=async()=>{
      this.messages.push({ role: 'user', content: [{ type: 'text', text: message }] });
      if (this.observed) {
        this.observed.child.session.replaceMessages(this.messages);
        if(initialObservedTurn)await this.observed.child.execution?.activateInitialTurn?.();
        this.observed.child.execution?.assertTurnInput?.();
        await this.observed.child.owner.publishCurrentHistory?.({ strictPrivateProtocol: isStrictKimiK3Adapter(this.options.adapter) });
      }
      };
      if(this.observed)await runCompoundTurnInput(this.observed.child.owner,context.turnId,installTurnInput);else await installTurnInput();
      const sessionId = this.observed?.child.session.exportSnapshot().sessionId ?? `desktop_agent_${context.groupId}_${context.agentId}`;
      const intentId = `${context.turnId}:intent`;
      activity?.onActivity({ phase: 'model' });
      const runScope=this.scope,observed=this.observed;
      const compoundFinal=!!observed&&!!getCompoundPublicationOwnerBinding(observed.child.owner);
      if(observed&&compoundFinal){
        const service=observed.service,inspect=service.inspectManagedFinalPublicationReceipt.bind(service);
        bindCompoundFinalPublicationConsumer(observed.child.owner,context.turnId,{
          register:(ticket,notify)=>service.registerManagedFinalPublication(context,ticket,notify),
          inspectReceipt:inspect,
        });
      }
        const result = await runDesktopToolLoop({
          modelPhysicalScope: this.modelPhysicalScope,
          metricsSurface: 'desktop-child', observationBinding: this.observed?.binding,
          beforeManagedTurnSeal:this.observed?async reply=>{this.observed!.child.session.replaceMessages(this.messages);await this.observed!.child.complete(reply);}:undefined,
          adapter: this.options.adapter,
          systemPrompt: `${this.options.systemPrompt}\n\nAgent context: ${JSON.stringify({ agentId: context.agentId, groupId: context.groupId, cwd: context.cwd, forkMode: this.fork.mode, truncated: this.fork.truncated })}`,
          messages: this.messages, allToolDefs: this.scope.registry.getToolDefinitions(), registry: this.scope.registry,
          signal: boundSignal, taskDeadline: context.effectiveDeadline, sessionId, turnId: context.turnId, intentId, stepId: `${intentId}:reply`, taskId: context.agentId,
          cwd: context.cwd, dataRoot: this.options.dataRoot, taskStartTime: Date.now(),
          materials: this.options.materials, materialRegistry: this.options.materialRegistry,
          skillInvocation: null, skillCatalog: this.options.skillCatalog, maxIterations: this.options.maxIterations,
          mailbox: context.mailbox, onUsage: (incoming, outgoing, usageId) => this.options.onUsage?.(incoming, outgoing, usageId, context),
          onActivity: activity?.onActivity,
          emitRuntimeEvent: async event => {
            if (event.type === 'assistant_delta' || event.type === 'tool_finished' && event.invoked === true) activity?.onActivity({ phase: 'model' });
            if (event.type === 'tool_finished') await this.options.onToolFinished?.(context, {
              executionEventId: randomUUID(), toolName: event.toolName, ok: event.ok,
            });
            await this.options.emitRuntimeEvent(event, context);
          },
          strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
            buildApiView: messages => messages, processToolResult: projectDesktopToolResultForModel,
            trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
        });
        if (observed&&!compoundFinal) {
          boundSignal.throwIfAborted();
          if(this.closed||this.observed!==observed||this.scope!==runScope)throw Error('SOL_PI_DESKTOP_FINAL_PUBLICATION_STALE');
          observed.child.owner.assertSession(observed.child.session);
          observed.child.session.replaceMessages(this.messages);
          await runScope.registry.publishCompoundHistory();
          boundSignal.throwIfAborted();
          if(this.closed||this.observed!==observed||this.scope!==runScope)throw Error('SOL_PI_DESKTOP_FINAL_PUBLICATION_STALE');
          observed.child.owner.assertSession(observed.child.session);
        }
        modelResult = result.reply;
      } catch (error) { modelBodyFailure = { error }; }
      {
        try { await waitDesktopModelPhysicalIdle(this.modelPhysicalScope); }
        catch (physicalError) {
          if (modelBodyFailure && modelBodyFailure.error !== physicalError) throw new AggregateError([modelBodyFailure.error, physicalError], 'desktop_child_business_and_model_cleanup_failed', { cause: modelBodyFailure.error });
          throw physicalError;
        }
        try { if (this.observed && this.scope && !this.closed) this.observed.rotation = await suspendDelegatedObservationOwner(this.observed.child.owner, this.scope.registry); }
        finally { this.scope?.dispose(); this.scope = undefined; }
      }
      if (modelBodyFailure) throw modelBodyFailure.error;
      return modelResult!;
    };
    const execution=Promise.resolve().then(()=>this.observed&&this.options.runObservedTurn?this.options.runObservedTurn(execute):execute());
    this.running = execution;
    void execution.finally(() => { if (this.running === execution) this.running = undefined; }).catch(() => {});
    return execution;
  }

  async suspend(): Promise<void> {
    if (this.running) throw new Error('cannot suspend an active Desktop session');
    await waitDesktopModelPhysicalIdle(this.modelPhysicalScope);
    this.scope?.dispose(); this.scope = undefined;
  }
  deactivate(): Promise<void> {
    if (this.deactivation) return this.deactivation;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.deactivation = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    this.closed = true;
    try {
      // Both original close promises are published before any abort callback.
      closeDesktopModelPhysicalScope(this.modelPhysicalScope, new DOMException('Desktop session disposed', 'AbortError')).catch(() => {});
      this.lifetime.abort(new DOMException('Desktop session disposed', 'AbortError')); resolve();
    } catch (error) { reject(error); }
    return this.deactivation;
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.disposal = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    void this.disposeOwned().then(resolve, reject);
    return this.disposal;
  }
  private async disposeOwned(): Promise<void> {
    await this.deactivate();
    await closeDesktopModelPhysicalScope(this.modelPhysicalScope, this.lifetime.signal.reason);
    await this.running?.catch(() => {});
    this.scope?.dispose(); this.scope = undefined;
    if (this.observed) {
      try { await this.observed.child.execution?.dispose(); await this.observed.host.drainTransport(); }
      finally { this.observed.child.owner.dispose(); this.observed.initialScope?.dispose(); }
    }
    await this.options.releaseResources?.();
    this.messages = [];
  }

}
