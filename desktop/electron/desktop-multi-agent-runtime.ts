import {getObservationSessionOwnerHostBinding} from '../../src/runtime/sol-pi/observation-session-owner.js';
import {bindManagedCompoundQueryTool,bindManagedCompoundMessageTool,bindManagedCompoundCancellationTool} from '../../src/runtime/sol-pi/compound-managed-control.js';
import {isDeepStrictEqual} from 'node:util';
import {bindManagedCompoundSpawnTool,type ManagedCompoundPreparationFacts} from '../../src/runtime/sol-pi/compound-managed-tool.js';
import type { ObservationMessagePublication } from '../../src/runtime/sol-pi/observation-message-publication.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { DesktopTaskObservationStore, desktopObservationSessionId } from '../../src/runtime/task-host/protected-observation-store.js';
import { requireDesktopProductHost, type DesktopObservationBinding } from './desktop-observation-owner.js';
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
  observation?: { productBinding: DesktopObservationBinding; observationStore: DesktopTaskObservationStore; holdChildPreparation(preparation: import('./desktop-multi-agent-service.js').DesktopObservationChildPreparation):Readonly<{signal:AbortSignal;release():void}>; runChildTurn<T>(context: DesktopAgentExecutionContext, work:(signal:AbortSignal)=>Promise<T>):Promise<T> };

}
interface RuntimeState extends DesktopAgentRuntimeBinding { controls: readonly string[] }
interface SeedState {
  parent: DesktopAgentActor; runtime: RuntimeState; agentDef: CustomAgentDef;
  messages: Message[]; forkContext: boolean; nativeInvocationId?: string;
}

/** Main-only bridge: model input cannot fabricate a runtime, policy or seed. */
export class DesktopMultiAgentRuntime {
  private readonly runtimes = new WeakMap<DesktopAgentActor, RuntimeState>();
  private readonly managedSessions=new WeakMap<AgentSessionState,DesktopManagedAgentSession>();
  private readonly managedPreparationFacts=new WeakMap<object,Readonly<ManagedCompoundPreparationFacts>>();
  private readonly seeds = new WeakMap<DesktopAgentSessionSeed, SeedState>();
  private readonly seedIds = new WeakMap<DesktopAgentActor, Map<string, { seedId: string; fingerprint: string }>>();

  constructor(private readonly options: { service: DesktopMultiAgentService; worktrees?: DesktopMultiAgentWorktrees;
    approvals?: Pick<DesktopMultiAgentApprovalTransport, 'requestApproval'>;
  }) {}

  bindRoot(context: DesktopAgentExecutionContext, binding: DesktopAgentRuntimeBinding): DesktopScopedRegistry {
    if(binding.observation){
      const host=requireDesktopProductHost(binding.observation.productBinding);
      if(!(binding.observation.observationStore instanceof DesktopTaskObservationStore)||this.options.service.getObservationExecutionOwner(context.actor)!==host.product.owner)throw Error('SOL_PI_DESKTOP_GROUP_RUNTIME_MISMATCH');
    }
    if (this.runtimes.has(context.actor)) throw new Error('Desktop root runtime already bound');
    const runtime = { ...binding, controls: [...MULTI_AGENT_TOOL_NAMES] };
    const scope = this.scope(context, runtime);
    this.runtimes.set(context.actor, runtime);
    return scope;
  }

  async prepareObservationFollowup(preparation:object) {
    const facts=this.options.service.inspectManagedFollowupPreparation(preparation),session=this.managedSessions.get(facts.childSession);
    if(!session)throw Error('SOL_PI_DESKTOP_FOLLOWUP_SESSION_REQUIRED');
    return session.prepareObservedFollowup(preparation);
  }

  async prepareObservationMessage(input: Parameters<NonNullable<DesktopMultiAgentServiceOptions['prepareObservationMessage']>>[0]) {
    this.options.service.assertInvocation(input.context.actor,input.context);
    const runtime=this.runtimes.get(input.context.actor);
    if(!runtime?.observation)throw Error('SOL_PI_DESKTOP_MESSAGE_RUNTIME_REQUIRED');
    const host=requireDesktopProductHost(runtime.observation.productBinding);
    return host.product.prepareMessagePublication(input);
  }

  async prepareObservationSession(input: Parameters<NonNullable<DesktopMultiAgentServiceOptions['prepareObservationSession']>>[0]) {
    const facts=this.options.service.assertObservationChildPreparation(input.preparation);
    const seed=input.sessionSeed&&this.seeds.get(input.sessionSeed);
    if(!seed||seed.parent!==input.parent.actor||!seed.runtime.observation)throw Error('SOL_PI_DESKTOP_CHILD_SEED_REQUIRED');
    this.seeds.delete(input.sessionSeed!);
    const observed=seed.runtime.observation,host=requireDesktopProductHost(observed.productBinding);
    if(seed.agentDef.model!==undefined||seed.agentDef.modelCapability!==undefined)throw Error('desktop_multi_agent_model_override_unsupported');
    if(seed.agentDef.isolation==='worktree')throw Error('SOL_PI_DESKTOP_PREPARED_WORKTREE_NOT_READY');

    const ceiling=host.product.summary.ordinaryChildren;if(!ceiling)throw Error('SOL_PI_DESKTOP_CHILD_AUTHORIZATION_REQUIRED');
    const runtime:RuntimeState={...seed.runtime,policy:seed.runtime.catalog.forkPolicy(seed.runtime.policy,ceiling.nativeTools),controls:ceiling.maxDepth>1?[...MULTI_AGENT_TOOL_NAMES]:[...CHILD_COMMUNICATION_TOOL_NAMES],systemPrompt:`${seed.runtime.systemPrompt}\n\nAssigned Desktop agent: ${input.identity.canonicalName}\n${seed.agentDef.systemPrompt}`,
      maxIterations:seed.agentDef.maxIterations??seed.runtime.maxIterations};
    const hold=observed.holdChildPreparation(input.preparation);
    let scope:DesktopScopedRegistry;try{scope=this.scope(input.context,runtime,AbortSignal.any([input.signal,hold.signal]),input.preparation);}catch(error){hold.release();throw error;}
    const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.identity.id),cwd:input.context.cwd});
    if(seed.nativeInvocationId)this.options.service.bindObservationChildRuntime(input.preparation,{session,nativeInvocationId:seed.nativeInvocationId});
    if(seed.nativeInvocationId)this.managedPreparationFacts.set(input.preparation,Object.freeze({groupId:input.context.groupId,agentId:input.identity.id,rootEpoch:input.context.rootEpoch,operationId:input.operationId,nativeInvocationId:seed.nativeInvocationId,childSessionId:session.exportSnapshot().sessionId,childSession:session,childTurnId:input.context.turnId,initialMessage:facts.message,sourceOwner:facts.sourceOwner,ackBytes:facts.ackBytes}));
    const current=()=>this.options.service.getObservationChildContext(input.preparation);
    let managed:import('../../src/runtime/sol-pi/compound-managed-lifecycle.js').PreparedManagedCompoundChild|undefined;
    const assertPersistence=()=>managed?this.options.service.assertObservationChildPersistence(input.preparation,managed.admission):current();
    const persist=async(snapshot:Parameters<DesktopTaskObservationStore['persistSession']>[1])=>{
      assertPersistence();if(managed){await managed.persistence.store.save(snapshot);const durable=await managed.persistence.store.load(snapshot.sessionId);if(!durable||!isDeepStrictEqual(durable.messages,snapshot.messages)||!isDeepStrictEqual(durable.protectedObservationClosure,snapshot.protectedObservationClosure))throw Error('SOL_PI_DESKTOP_CHILD_DURABILITY_REQUIRED');if(!observed.observationStore.publishCanonicalFacts(input.identity.id,durable))throw Error('SOL_PI_DESKTOP_CHILD_ALIAS_REQUIRED');}else await observed.observationStore.persistSession(input.identity.id,snapshot);assertPersistence();
    };
    let prepared:Awaited<ReturnType<typeof DesktopManagedAgentSession.prepareObserved>>|undefined;
    let publication:ObservationMessagePublication|undefined;
    try{
      if(host.product.summary.compoundExecution){
        if(!host.compoundStorage||!host.product.compoundDomain)throw Error('SOL_PI_DESKTOP_CHILD_COMPOUND_ADMISSION_REQUIRED');
        const childPersistence=observed.observationStore.getExecutionPersistence(input.identity.id,assertPersistence).routeCanonical!(host.compoundStorage);
        const parentSession=getObservationSessionOwnerHostBinding(facts.sourceOwner).session;
        const resident=this.managedSessions.get(parentSession);
        if(parentSession!==host.session&&!resident)throw Error('SOL_PI_DESKTOP_CHILD_PARENT_INSTALLATION_REQUIRED');
        const prepareManagedChild=parentSession===host.session?host.prepareManagedChild:(args:Parameters<typeof host.prepareManagedChild>[0])=>resident!.prepareObservedChild(args);
        managed=await prepareManagedChild({preparation:input.preparation,childSession:session,registerPersistence:async({admission,lease})=>{if(!childPersistence.registerManagedAlias)throw Error('SOL_PI_DESKTOP_CHILD_ALIAS_REQUIRED');await childPersistence.registerManagedAlias(admission,host.product.compoundDomain!,lease);}});
        this.options.service.bindManagedObservationAdmission(input.preparation,{admission:managed.admission,onResourcesReleased:managed.onResourcesReleased});
      }
      const plan=host.product.createChildExecutionPlan({parentOwner:facts.sourceOwner,session,persist,surface:'desktop-managed',...(managed?{installChildExecution:managed.installChildExecution}:{})});
      prepared=await DesktopManagedAgentSession.prepareObserved({adapter:runtime.adapter,systemPrompt:runtime.systemPrompt,
        runObservedTurn:work=>observed.runChildTurn(current(),work),
        forkContext:seed.forkContext,getTurnContext:current,createRegistry:(context,signal)=>{this.runtimes.set(context.actor,runtime);return this.scope(context,runtime,signal);},
        dataRoot:runtime.dataRoot,materials:runtime.materials,materialRegistry:runtime.materialRegistry,skillCatalog:runtime.skillCatalog,maxIterations:runtime.maxIterations,
        emitRuntimeEvent:(event,context)=>this.options.service.recordRuntimeEvent(context,event),
        onToolFinished:(context,fact)=>this.options.service.recordToolFinished(context,fact),
        admitUsage:(context,invocationId)=>this.options.service.captureAdmittedUsage(context,invocationId),
      },{plan,scope,service:this.options.service,context:input.context,preparation:input.preparation});
      publication=await host.product.prepareMessagePublication({sourceOwner:facts.sourceOwner,recipientOwner:prepared.owner,
        operationId:input.operationId,text:input.message,assertCurrent:()=>{this.options.service.assertObservationChildPreparation(input.preparation);}});
      const initialBasis=prepared.nativeSession.getPublishedHistoryBasis(),initialSnapshot={...prepared.nativeSession.exportSnapshot(),historyDigest:initialBasis};
      await persist(initialSnapshot);prepared.nativeSession.notePublishedHistory(initialSnapshot,initialBasis);
      await prepared.session.prepareInitialObservedTurn();
      this.managedSessions.set(prepared.nativeSession,prepared.session);
      this.runtimes.set(input.context.actor,runtime);
      return {session:prepared.session,owner:prepared.owner,registry:prepared.registry,publication,observationStore:observed.observationStore,releasePreparation:hold.release};
    }catch(error){publication?.dispose();if(prepared)await prepared.session.dispose();else scope.dispose();hold.release();throw error;}
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
      admitUsage: (context, invocationId) => this.options.service.captureAdmittedUsage(context, invocationId),
      releaseResources: allocation?.releaseSessionResources,
    }); } catch (error) { await allocation?.release(); throw error; }
  }

  private scope(context: DesktopAgentExecutionContext, runtime: RuntimeState, runSignal?: AbortSignal, preparation?: import('./desktop-multi-agent-service.js').DesktopObservationChildPreparation): DesktopScopedRegistry {
    const signal = runSignal ? AbortSignal.any([context.signal, runSignal]) : context.signal;
    signal.throwIfAborted();
    if(preparation){if(this.options.service.assertObservationChildPreparation(preparation).context!==context)throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');}
    else this.options.service.assertInvocation(context.actor, context);
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
    })) { const wrapped: import('../../src/types.js').Tool={ ...tool, execute: async (input, toolContext) => {
      // The service keeps its original context identity. Session/scope lifetime
      // is a separate restriction, including callers holding a retained Tool.
      scope.authority.signal.throwIfAborted();
      this.options.service.assertInvocation(context.actor, context);
      toolContext?.onToolInvocationStarted?.();
      if(tool.definition.name==='followup_task'&&typeof toolContext?.toolInvocationId==='string')return this.options.service.runManagedFollowupInvocation(context,toolContext.toolInvocationId,()=>tool.execute(input,toolContext));
      return tool.execute(input, toolContext);
    } };
      if(tool.definition.name==='spawn_agent')bindManagedCompoundSpawnTool(wrapped,{followup:{inspectPreparation:preparation=>this.options.service.inspectManagedFollowupPreparation(preparation),inspectApplied:receipt=>this.options.service.inspectManagedFollowupApplied(receipt),inspectCancelled:receipt=>this.options.service.inspectManagedFollowupCancelled(receipt)},assertManagedResourceCurrent:admission=>this.options.service.assertManagedResourceCurrent(admission),assertAdmissionCurrent:admission=>this.options.service.assertManagedObservationAdmissionCurrent(admission,context.actor),inspectResourcesReleased:receipt=>this.options.service.inspectManagedResourcesReleased(receipt),inspectPreparation:preparation=>{
        if(!preparation||typeof preparation!=='object')throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
        const stored=this.managedPreparationFacts.get(preparation);
        const actual=this.options.service.assertObservationChildPreparation(preparation as import('./desktop-multi-agent-service.js').DesktopObservationChildPreparation);
        if(!stored||actual.parent.actor!==context.actor||stored.sourceOwner!==actual.sourceOwner||stored.ackBytes!==actual.ackBytes||stored.childTurnId!==actual.context.turnId||stored.initialMessage!==actual.message)throw Error('SOL_PI_DESKTOP_CHILD_PREPARATION_STALE');
        return stored;
      }});
      if(tool.definition.name==='close_agent'||tool.definition.name==='interrupt_agent'){const kind=tool.definition.name==='close_agent'?'close':'interrupt';bindManagedCompoundCancellationTool(wrapped,{assertCurrent:()=>{scope.authority.signal.throwIfAborted();this.options.service.assertInvocation(context.actor,context);},prepareCancellation:input=>this.options.service.prepareManagedCancellation(context,kind,input),runCancellation:(ticket,work)=>this.options.service.runManagedCancellation(ticket,work)});}
      if(tool.definition.name==='followup_task')bindManagedCompoundMessageTool(wrapped,{assertCurrent:()=>{scope.authority.signal.throwIfAborted();this.options.service.assertInvocation(context.actor,context);},inspectCommittedResult:input=>this.options.service.inspectCommittedManagedFollowup(context,input)});
      if(tool.definition.name==='send_message')bindManagedCompoundMessageTool(wrapped,{assertCurrent:()=>{scope.authority.signal.throwIfAborted();this.options.service.assertInvocation(context.actor,context);},inspectCommittedResult:input=>this.options.service.inspectCommittedManagedMessage(context,input)});
      if(tool.definition.name==='wait_agent'||tool.definition.name==='list_agents')bindManagedCompoundQueryTool(wrapped,{assertCurrent:()=>{scope.authority.signal.throwIfAborted();this.options.service.assertInvocation(context.actor,context);}});
      scope.registry.registerTool(wrapped);
    }
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
    this.seeds.set(seed, { parent: context.actor, runtime, agentDef, forkContext: input.forkContext,nativeInvocationId:invocation,
      messages: input.forkContext ? structuredClone(toolContext?.messages ?? []) : [],
    });
    return seed;
  }
}
