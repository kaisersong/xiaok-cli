import { randomUUID } from 'node:crypto';
import type { CustomAgentDef } from '../../src/ai/agents/loader.js';
import type { Message, ModelAdapter, ToolExecutionContext } from '../../src/types.js';
import type { RegistryOptions } from '../../src/ai/tools/index.js';
import type { MaterialRegistry } from '../../src/runtime/task-host/material-registry.js';
import type { MaterialRecord } from '../../src/runtime/task-host/types.js';
import type { TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import type { SkillCatalog } from '../../src/ai/skills/loader.js';
import { MULTI_AGENT_TOOL_NAMES, CHILD_COMMUNICATION_TOOL_NAMES } from '../../src/ai/tools/multi-agent.js';
import type { DesktopCapabilityCatalog, DesktopCapabilityPolicy, DesktopScopedRegistry } from './desktop-multi-agent-capabilities.js';
import type { DesktopAgentActor, DesktopAgentExecutionContext, DesktopAgentSessionSeed, DesktopMultiAgentService, DesktopMultiAgentServiceOptions } from './desktop-multi-agent-service.js';
import { createDesktopMultiAgentTools } from './desktop-multi-agent-tools.js';
import { DesktopManagedAgentSession } from './desktop-managed-agent-session.js';
import type { DesktopMultiAgentWorktrees, DesktopWorktreeAllocation } from './desktop-multi-agent-worktrees.js';
import type { DesktopMultiAgentApprovalTransport } from './desktop-multi-agent-approval-transport.js';

export interface DesktopAgentRuntimeBinding {
  adapter: Pick<ModelAdapter, 'stream'>;
  systemPrompt: string; catalog: DesktopCapabilityCatalog; policy: DesktopCapabilityPolicy;
  workspaceId: string; materialIds: readonly string[];
  /** @deprecated Compatibility input only; each scope uses its service context. */
  permissionRevision?: number;
  registryOptions: RegistryOptions; materials: MaterialRecord[]; materialRegistry?: MaterialRegistry;
  skillCatalog: SkillCatalog; dataRoot: string; agents: CustomAgentDef[];
  emitRuntimeEvent: TaskRunnerInput['emitRuntimeEvent'];
  onUsage?(inputTokens: number, outputTokens: number): void;
  maxIterations?: number;
}
interface RuntimeState extends DesktopAgentRuntimeBinding { controls: readonly string[] }
interface SeedState {
  parent: DesktopAgentActor; runtime: RuntimeState; agentDef: CustomAgentDef;
  messages: Message[]; forkContext: boolean;
}

/** Main-only bridge: model input cannot fabricate a runtime, policy or seed. */
export class DesktopMultiAgentRuntime {
  private readonly runtimes = new WeakMap<DesktopAgentActor, RuntimeState>();
  private readonly seeds = new WeakMap<DesktopAgentSessionSeed, SeedState>();
  private readonly seedIds = new WeakMap<DesktopAgentActor, Map<string, { seedId: string; fingerprint: string }>>();

  constructor(private readonly options: { service: DesktopMultiAgentService; worktrees?: DesktopMultiAgentWorktrees;
    approvals?: Pick<DesktopMultiAgentApprovalTransport, 'requestApproval'>;
  }) {}

  bindRoot(context: DesktopAgentExecutionContext, binding: DesktopAgentRuntimeBinding): DesktopScopedRegistry {
    if (this.runtimes.has(context.actor)) throw new Error('Desktop root runtime already bound');
    const runtime = { ...binding, controls: [...MULTI_AGENT_TOOL_NAMES] };
    const scope = this.scope(context, runtime);
    this.runtimes.set(context.actor, runtime);
    return scope;
  }

  async createSession(input: Parameters<DesktopMultiAgentServiceOptions['createSession']>[0]): Promise<DesktopManagedAgentSession> {
    input.signal.throwIfAborted();
    const seed = input.sessionSeed && this.seeds.get(input.sessionSeed);
    if (!seed || seed.parent !== input.parent.actor) throw new Error('invalid Desktop child seed authority');
    this.seeds.delete(input.sessionSeed!);
    if (seed.agentDef.model !== undefined || seed.agentDef.modelCapability !== undefined) throw new Error('desktop_multi_agent_model_override_unsupported');
    let allocation: DesktopWorktreeAllocation | undefined;
    if (seed.agentDef.isolation === 'worktree') {
      if (!this.options.worktrees || !input.bindWorkingDirectory) throw new Error('desktop_multi_agent_worktree_allocator_not_bound');
      allocation = await this.options.worktrees.allocate({ groupId: input.groupId, agentId: input.identity.id, cwd: input.parent.cwd,
        cleanupPolicy: seed.agentDef.cleanup ?? 'keep', signal: input.signal });
      try { input.signal.throwIfAborted(); input.bindWorkingDirectory(allocation.cwd); }
      catch (error) { await allocation.release(); throw error; }
    }
    const runtime: RuntimeState = { ...seed.runtime,
      systemPrompt: `${seed.runtime.systemPrompt}\n\nAssigned Desktop agent: ${input.identity.canonicalName}\n${seed.agentDef.systemPrompt}`,
      maxIterations: seed.agentDef.maxIterations ?? seed.runtime.maxIterations,
    };
    try { return new DesktopManagedAgentSession({ adapter: runtime.adapter, systemPrompt: runtime.systemPrompt,
      parentMessages: seed.messages, forkContext: seed.forkContext, getTurnContext: input.getTurnContext,
      createRegistry: (context, signal) => { this.runtimes.set(context.actor, runtime); return this.scope(context, runtime, signal); },
      dataRoot: runtime.dataRoot, materials: runtime.materials, materialRegistry: runtime.materialRegistry,
      skillCatalog: runtime.skillCatalog, maxIterations: runtime.maxIterations,
      // Child output must not masquerade as the parent's task event stream.
      emitRuntimeEvent: (event, context) => this.options.service.recordRuntimeEvent(context, event),
      onToolFinished: (context, fact) => this.options.service.recordToolFinished(context, fact),
      onUsage: (incoming, outgoing, usageId, context) => this.options.service.recordUsage(context, {
        usageId: usageId ?? randomUUID(), inputTokens: incoming, outputTokens: outgoing,
      }),
      releaseResources: allocation?.releaseSessionResources,
    }); } catch (error) { await allocation?.release(); throw error; }
  }

  private scope(context: DesktopAgentExecutionContext, runtime: RuntimeState, runSignal?: AbortSignal): DesktopScopedRegistry {
    const signal = runSignal ? AbortSignal.any([context.signal, runSignal]) : context.signal;
    signal.throwIfAborted();
    this.options.service.assertInvocation(context.actor, context);
    const scope = runtime.catalog.createScopedRegistry(runtime.policy, {
      groupId: context.groupId, agentId: context.agentId, turnId: context.turnId, cwd: context.cwd,
      workspaceId: runtime.workspaceId, materialIds: runtime.materialIds, permissionRevision: context.permissionRevision,
      signal, deadlineAt: context.effectiveDeadline,
      getApprovalDeadline: () => this.options.service.getApprovalDeadline(context.actor),
      assertCurrent: () => this.options.service.assertInvocation(context.actor, context),
      beforeOpaqueInvocation: () => this.options.worktrees?.beforeOpaqueInvocation(context.groupId, context.agentId, context.cwd),
      ...(this.options.approvals ? { requestApproval: invocation => this.options.approvals!.requestApproval({ context, invocation }) } : {}),
    }, runtime.registryOptions);
    for (const tool of createDesktopMultiAgentTools({ service: this.options.service, context, agents: runtime.agents,
      allowedControls: runtime.controls,
      createSeed: (input, toolContext) => this.createSeed(context, runtime, input, toolContext),
    })) scope.registry.registerTool({ ...tool, execute: async (input, toolContext) => {
      // The service keeps its original context identity. Session/scope lifetime
      // is a separate restriction, including callers holding a retained Tool.
      scope.authority.signal.throwIfAborted();
      this.options.service.assertInvocation(context.actor, context);
      toolContext?.onToolInvocationStarted?.();
      return tool.execute(input, toolContext);
    } });
    return scope;
  }

  private createSeed(context: DesktopAgentExecutionContext, parent: RuntimeState,
    input: { agentDef: CustomAgentDef; forkContext: boolean }, toolContext?: ToolExecutionContext): DesktopAgentSessionSeed {
    this.options.service.assertInvocation(context.actor, context);
    if (input.agentDef.model !== undefined || input.agentDef.modelCapability !== undefined) throw new Error('desktop_multi_agent_model_override_unsupported');
    const agentDef = structuredClone(input.agentDef);
    const fingerprint = JSON.stringify({ agentDef, forkContext: input.forkContext });
    const invocation = toolContext?.toolInvocationId;
    let seedId: string = randomUUID();
    if (invocation) {
      const remembered = this.seedIds.get(context.actor) ?? new Map<string, { seedId: string; fingerprint: string }>();
      const previous = remembered.get(invocation);
      if (previous && previous.fingerprint !== fingerprint) throw new Error('operation_id_conflict');
      seedId = previous?.seedId ?? seedId;
      remembered.set(invocation, { seedId, fingerprint }); this.seedIds.set(context.actor, remembered);
    }
    const selected = agentDef.allowedTools;
    const runtime: RuntimeState = { ...parent,
      policy: parent.catalog.forkPolicy(parent.policy, selected),
      controls: parent.controls.filter(name => CHILD_COMMUNICATION_TOOL_NAMES.has(name) || selected === undefined || selected.includes(name)),
    };
    // Cache only the small identity/fingerprint, not every rejected fork's full
    // history. A retried operation keeps identity even after its seed is consumed.
    const seed = Object.freeze({ seedId });
    this.seeds.set(seed, { parent: context.actor, runtime, agentDef, forkContext: input.forkContext,
      messages: input.forkContext ? structuredClone(toolContext?.messages ?? []) : [],
    });
    return seed;
  }
}
