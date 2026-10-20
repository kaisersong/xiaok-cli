import {captureInvocationDrain,type DesktopChildInvocationFactory,type DesktopModelInvocation} from './desktop-model-invocation.js';
import {isOwnedNativeModelAdapter} from './context-continuity/native-model-session.js';
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
  authorizeContext?: () => void;
  recordUnprovenEffect?:(context:import('./desktop-multi-agent-service.js').DesktopAgentExecutionContext,id:string,name:string)=>void;
  inheritContext?: (receiverTaskId: string | undefined) => void;
  adapter: Pick<ModelAdapter, 'stream'>;
  openInvocation?:DesktopChildInvocationFactory;
  assertInvocation?:(context:DesktopAgentExecutionContext)=>void;
  assertResult?:(context:DesktopAgentExecutionContext)=>void;
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
  /** Managed worktrees are released by the owning journal, only after settlement. */
  releaseResources?(): Promise<void>;
}

/** A child has its own messages and per-turn registry, but uses Desktop's loop. */
export class DesktopManagedAgentSession implements ManagedAgentSession {
  readonly fork: Readonly<Pick<DesktopAgentFork, 'mode' | 'truncated'>>;
  private messages: Message[];
  private readonly lifetime = new AbortController();
  private running?: Promise<string>;
  private scope?: ReturnType<DesktopManagedAgentSessionOptions['createRegistry']>;
  private disposal?: Promise<void>;
  private closed = false;
  private invocationFailure?:unknown;
  private invocationUncertain=false;
  private lastTurn = 0;
  private lastTurnId?: string;

  constructor(private readonly options: DesktopManagedAgentSessionOptions) {
    if (options.model !== undefined || options.modelCapability !== undefined) throw new Error('desktop_multi_agent_model_override_unsupported');
    const fork = buildDesktopAgentFork(options.adapter, options.parentMessages ?? [], options.forkContext !== false);
    this.fork = Object.freeze({ mode: fork.mode, truncated: fork.truncated });
    this.messages = fork.messages;
  }

  run(message: string, signal?: AbortSignal, activity?: ManagedAgentRunContext): Promise<string> {
    if(this.invocationUncertain)return Promise.reject(this.invocationFailure);
    if (this.closed) return Promise.reject(new Error('desktop_agent_session_closed'));
    if (this.running) return Promise.reject(new Error('desktop_agent_session_busy'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    // Install the execution promise before any provider/registry code can run.
    const execution = Promise.resolve().then(async () => {
      this.lifetime.signal.throwIfAborted();
      const context = this.options.getTurnContext();
      this.options.inheritContext?.(context.sourceTaskId);
      if (context.turn <= this.lastTurn || context.turnId === this.lastTurnId) throw new Error('desktop_agent_turn_already_started');
      this.lastTurn = context.turn; this.lastTurnId = context.turnId;
      const boundSignal = AbortSignal.any([this.lifetime.signal, context.signal, ...(signal ? [signal] : [])]);
      const assertCurrent=()=>{
        boundSignal.throwIfAborted();this.options.authorizeContext?.();this.options.assertInvocation?.(context);
        boundSignal.throwIfAborted();if(Date.now()>=context.effectiveDeadline)throw new Error('desktop_agent_deadline_exceeded');
      };
      const assertResult=()=>{
        boundSignal.throwIfAborted();this.options.authorizeContext?.();
        (this.options.assertResult??this.options.assertInvocation)?.(context);
        boundSignal.throwIfAborted();if(Date.now()>=context.effectiveDeadline)throw new Error('desktop_agent_deadline_exceeded');
      };assertCurrent();
      let reply:string;
      let invocation:DesktopModelInvocation|undefined,drainInvocation:(()=>Promise<void>)|undefined;
      try {
      this.scope = this.options.createRegistry(context, boundSignal);
      this.messages.push({ role: 'user', content: [{ type: 'text', text: message }] });
      const sessionId = `desktop_agent_${context.groupId}_${context.agentId}`;
      const intentId = `${context.turnId}:intent`;
      activity?.onActivity({ phase: 'model' });
        assertCurrent();
        if(this.options.openInvocation){
          try{invocation=await this.options.openInvocation(context,boundSignal);drainInvocation=captureInvocationDrain(invocation);}catch(error){this.invocationUncertain=true;this.invocationFailure=error;throw error;}
          assertCurrent();
          if(invocation.prepareCheckpoint)this.messages=invocation.prepareCheckpoint(this.messages);
        }else if(isOwnedNativeModelAdapter(this.options.adapter))throw new Error('native_child_invocation_factory_unavailable');
        const result = await runDesktopToolLoop({
          authorizeContext: assertCurrent,
          authorizeResult:assertResult,
          requireEffectGuard:!!this.options.recordUnprovenEffect,
          recordUnprovenEffect:this.options.recordUnprovenEffect?(id,name)=>this.options.recordUnprovenEffect!(context,id,name):undefined,
          contextReaderTaskId: context.sourceTaskId,
          adapter: invocation?.adapter ?? this.options.adapter,
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
            if(event.type==='assistant_delta'||event.type==='artifact_recorded')assertResult();
            await this.options.emitRuntimeEvent(event, context);
          },
          strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
            buildApiView: messages => messages, processToolResult: result => result.slice(0, 50_000),
            trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
        });
        reply=result.reply;
      } finally {
        try{this.scope?.dispose();}finally{this.scope=undefined;if(drainInvocation)await this.finishInvocation(drainInvocation);}
      }
      assertResult();return reply;
    });
    this.running = execution;
    void execution.finally(() => { if (this.running === execution) this.running = undefined; }).catch(() => {});
    return execution;
  }

  private async finishInvocation(drain:()=>Promise<void>):Promise<void>{
    try{await drain();}catch(error){this.invocationUncertain=true;this.invocationFailure=error;throw error;}
  }

  async suspend(): Promise<void> {
    if(this.invocationUncertain)throw this.invocationFailure;
    if (this.running) throw new Error('cannot suspend an active Desktop session');
    this.scope?.dispose(); this.scope = undefined;
  }
  async deactivate(): Promise<void> {
    this.closed = true;
    this.lifetime.abort(new DOMException('Desktop session disposed', 'AbortError'));
    this.scope?.dispose(); this.scope = undefined;
  }
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      await this.deactivate();
      // Deliberately remains pending for an uncooperative provider/tool. The
      // service owns bounded close acknowledgement and the global blocked gate.
      await this.running?.catch(() => {});
      if(this.invocationUncertain)throw this.invocationFailure;
      await this.options.releaseResources?.();
      this.messages = [];
    })();
  }
}
