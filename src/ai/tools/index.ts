import { captureDirectHookSlot, assertDirectHookReturn } from './direct-hook-promise-boundary.js';
import { AcceptedHookCalls } from './accepted-hook-calls.js';
import {assertNativeRegistryCheckpointCurrent} from '../../runtime/task-host/workflow-restriction-checkpoint.js';
import {createNativeReadonlyExecutionContext} from './native-readonly-context.js';
import {captureToolDescriptionMetadata,BUILTIN_READ_DESCRIPTION,type ToolDescriptionMetadata,type ToolDiscovery} from '../../shared/tool-description-metadata.js';
import { isIntentProducerTool } from './intent-delegation.js';
import { isObservationDelegationTool } from '../../runtime/sol-pi/delegation-tool-brand.js';
import {registerBuiltinToolIdentity,inheritBuiltinToolIdentity,getBuiltinToolIdentity,isNativeReadonlyExecutionEligible} from './native-tool-identity.js';
import {getCompoundSandboxPreparation,inheritCompoundSandboxPreparation} from '../../platform/sandbox/tool-wrappers.js';
import { IntersectedPermissionManager } from '../permissions/intersection.js';
import { measureToolResult, observationMetricsEnabled } from '../../runtime/trace/observation-metrics.js';
import { isDeepStrictEqual } from 'node:util';
import {resolveExecutionIdleMs} from '../../runtime/execution-health.js';
import { runMonitoredTool } from '../../runtime/tool-execution-health.js';
import type { Tool, ToolDefinition, ToolExecutionContext, ToolPermissionGrant } from '../../types.js';
import { PermissionManager } from '../permissions/manager.js';
import { isEmptyConfiguredHooksRunner, type HooksRunner } from '../../runtime/hooks-runner.js';
import { formatErrorText } from '../../utils/ui.js';
import { isAbortError } from '../runtime/abort-utils.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import { validateToolInput } from './validate-input.js';
import { evaluateProtectedOutputGuard } from '../../runtime/guards/protected-output-guard.js';
import type { GuardDecision } from '../../runtime/guards/policy.js';
import { createReadTool, type WorkspaceToolOptions } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { bashTool, createBashTool, type BashApprovalOptions } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { createToolSearchTool } from './search.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
import { installSkillTool } from './install-skill.js';
import { uninstallSkillTool } from './uninstall-skill.js';
import { validateSkillTool } from './validate-skill.js';
import { createRenderUiTool } from './render-ui.js';
import { sanitizeToolOutput } from '../../shared/stream-safety/redact.js';
import {
  buildCapabilityToolDefinition,
  buildToolSearchEntry,
  dedupeToolSearchEntries,
  dedupeToolSearchCandidates,
  selectToolSearchCandidates,
  getCanonicalToolId,
  selectToolEntries,
  type ToolSearchEntry,
} from './tool-identity.js';

// Capture singleton implementations at module initialization; a later factory call
// cannot re-brand an in-place replacement as an audited native implementation.
registerBuiltinToolIdentity(bashTool,'command');
registerBuiltinToolIdentity(grepTool,'readonly');
registerBuiltinToolIdentity(globTool,'readonly');

export function buildToolList(
  skillTool?: Tool,
  workspace?: WorkspaceToolOptions,
  extraTools: Tool[] = [],
  metadataSink?:Map<Tool,ToolDescriptionMetadata>,
  bashApproval?: BashApprovalOptions,
): Tool[] {
  const readTool=createReadTool(workspace);metadataSink?.set(readTool,BUILTIN_READ_DESCRIPTION);
  const tools: Tool[] = [
    readTool,
    createWriteTool(workspace),
    createEditTool(workspace),
    createBashTool(bashApproval),
    grepTool,
    globTool,
    webFetchTool,
    webSearchTool,
    installSkillTool,
    uninstallSkillTool,
    validateSkillTool,
    createRenderUiTool(workspace),
    ...extraTools,
  ];
  // These positions are constructed above by first-party native factories, before
  // any optional skill/MCP tools; names or plugin readOnly properties cannot mint identity.
  (['readonly','file','file','command','readonly','readonly'] as const).forEach((kind,index)=>registerBuiltinToolIdentity(tools[index],kind));
  if (skillTool) {
    tools.push(skillTool, ...(skillTool.companionTools ?? []));
  }
  return tools;
}

/** Host-owned routing boundary. It is not a model parameter or permission grant. */
export interface CompoundRegistryExecutionPort {
  publishCurrentHistory?():Promise<void>;
  describeTool?(tool:Tool):ToolDefinition;
  execute(input: {
    name: string; input: Readonly<Record<string, unknown>>; context?: ToolExecutionContext;
    /** Actual host registration; never a tool-provided readOnly claim. */
    tool?: Tool;
    native: {
      registeredTool(name:string):Tool|undefined;
      prepare(name: string, input: Record<string, unknown>, phase?: Pick<ToolExecutionContext, 'toolInvocationId' | 'compoundPhase' | 'signal'>): Promise<ToolPreparationResult>;
      execute(invocation: PreparedToolInvocation, projectResult?: (nativeResult:string)=>Promise<string>): Promise<string>;
    };
  }): Promise<string>;
}

export interface RegistryOptions {
  /** Host-only review role; native object identity is the sole admission authority. */
  nativeReadonlyOnly?: boolean;
  compoundExecution?: CompoundRegistryExecutionPort;
  toolIdleTimeoutMs?: number;
  capabilityRegistry?: CapabilityRegistry;
  /** Child discovery must not advertise tools owned only by other registries. */
  capabilitySearch?: boolean;
  permissionManager?: PermissionManager;
  autoMode?: boolean;
  dryRun?: boolean;
  onPrompt?: (toolName: string, input: Record<string, unknown>, invocation?: {
    tool: Tool; context?: ToolExecutionContext;
  }) => Promise<boolean | ToolPermissionGrant>;
  hookInputMode?: 'configured';
  hooksRunner?: HooksRunner;
  agentId?: string;
  onToolObserved?: (event: ToolObservation) => Promise<void> | void;
  protectedOutputGuard?: {
    getProtectedArtifacts(): Array<{ artifactId: string; path: string }>;
    onDecision?: (decision: GuardDecision) => Promise<void> | void;
  };
}

/** Dispatch data only: never producer/permission/physical-release proof. */
export interface DirectHookCallbacks {
  runPreHooks: HooksRunner['runPreHooks'];
  runPostHooks: HooksRunner['runPostHooks'];
  runHooks?: HooksRunner['runHooks'];
}

/** New input shape; the original receiver remains in hooksRunner. */
export interface DirectCallbackRegistryOptions extends Omit<RegistryOptions, 'hooksRunner' | 'hookInputMode'> {
  hookInputMode: 'direct-callback';
  hooksRunner?: DirectHookCallbacks;
}

export type ToolRegistryOptions = RegistryOptions | DirectCallbackRegistryOptions;

export interface ToolObservation {
  phase: 'after';
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  result: string;
  ok: boolean;
}

function freezeObservationDefinition<T>(value:T):T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freezeObservationDefinition(child);Object.freeze(value);}return value;
}

export interface PreparedToolInvocation { readonly toolName: string; readonly input: Readonly<Record<string, unknown>> }
export type ToolPreparationStopReason = 'denied' | 'cancelled' | 'invalid' | 'invalidated' | 'blocked' | 'handled';
export type ToolPreparationResult = {readonly kind:'prepared';readonly invocation:PreparedToolInvocation} | {readonly kind:'not_started';readonly reason:ToolPreparationStopReason;readonly message:string};

const observationPermissionAuthorities = new WeakMap<object, object>();

export class ToolRegistry {
  #nativeReadonlyOnly: boolean;
  get isNativeReadonlyOnly(): boolean { return this.#nativeReadonlyOnly; }

  private admitsNativeReadonly(tool: Tool | undefined): boolean {
    if (!this.#nativeReadonlyOnly) return Boolean(tool);
    if (!tool) return false;
    try { return getBuiltinToolIdentity(tool) === 'readonly' && isNativeReadonlyExecutionEligible(tool); } catch { return false; }
  }

  private assertNativeReadonlyTree(tool: Tool, seen = new Set<Tool>()): void {
    if (seen.has(tool) || !this.admitsNativeReadonly(tool)) throw Error('native_readonly_tool_required');
    seen.add(tool);
    for (const companion of tool.companionTools ?? []) this.assertNativeReadonlyTree(companion, seen);
    seen.delete(tool);
  }
  private executionBoundaryUsed = false;
  private compoundInstallationPending = false;
  private readonly preparedInvocations = new WeakMap<PreparedToolInvocation, { execute(projectResult?: (nativeResult:string)=>Promise<string>): Promise<string>; context?: ToolExecutionContext; name: string }>();
  private tools = new Map<string, Tool>();
  private deferredTools = new Map<string, ToolDefinition>();
  private descriptions=new Map<string,Readonly<ToolDescriptionMetadata>|undefined>();
  private deferredDescriptions=new Map<string,Readonly<ToolDescriptionMetadata>|undefined>();
  private canonicalToolNames = new Map<string, string>();
  private permissionManager: PermissionManager;
  private options: Required<Pick<ToolRegistryOptions, 'dryRun' | 'onPrompt'>> & ToolRegistryOptions;
  private allowedToolsFilter: Set<string> | null = null;
  private disposed = false;
  #acceptedHookCalls?: AcceptedHookCalls;
  private parentAuthorityChanged?: () => boolean;
  private filterGeneration = 0;
  private readonly toolGenerations = new Map<string, number>();
  private readonly toolIdleTimeoutMs: number;

  setAllowedTools(names: string[] | null): void {
    this.filterGeneration++;
    this.allowedToolsFilter = names ? new Set(names.map((name) => getCanonicalToolId(name))) : null;
  }

  constructor(options: ToolRegistryOptions, tools?: Tool[],metadata?:ReadonlyMap<Tool,ToolDescriptionMetadata>) {
    this.#nativeReadonlyOnly = options.nativeReadonlyOnly === true;
    Object.defineProperty(this, 'isNativeReadonlyOnly', { get: () => this.#nativeReadonlyOnly, configurable: false });
    if (this.#nativeReadonlyOnly) {
      if (options.compoundExecution || options.onToolObserved || options.protectedOutputGuard || options.onPrompt) throw Error('native_readonly_external_callback_denied');
      if (options.hooksRunner && (options.hookInputMode === 'direct-callback' || !isEmptyConfiguredHooksRunner(options.hooksRunner))) throw Error('native_readonly_external_callback_denied');
      options = { ...options, hooksRunner: undefined };
      // Validate the complete constructor population before publishing any binding.
      if (tools) for (const tool of tools) this.assertNativeReadonlyTree(tool);
    }
    if (options.compoundExecution && options.hooksRunner) {
      if (options.hookInputMode === 'direct-callback' || !isEmptyConfiguredHooksRunner(options.hooksRunner)) throw Error('compound_unsupervised_hooks');
      // Do not execute even mutable no-op methods: the factory proved absence of hooks.
      options = { ...options, hooksRunner: undefined };
    }
    this.toolIdleTimeoutMs = resolveExecutionIdleMs(options.toolIdleTimeoutMs === undefined ? process.env.XIAOK_TOOL_IDLE_TIMEOUT_MS : String(options.toolIdleTimeoutMs));
    const mode = options.permissionManager
      ? options.permissionManager.getMode()
      : options.autoMode
        ? 'auto'
        : 'default';

    this.permissionManager = options.permissionManager ?? new PermissionManager({ mode });
    this.options = {
      ...options,
      dryRun: options.dryRun ?? false,
      onPrompt: options.onPrompt ?? (async () => false),
      permissionManager: this.permissionManager,
    };
    if (this.#nativeReadonlyOnly) Object.defineProperty(this, 'options', { value: Object.freeze(this.options), writable: false, configurable: false });
    // Requires R16/R17 explicit direct-callback input contract; configured owners are unchanged.
    if (this.options.hookInputMode === 'direct-callback' && !this.#nativeReadonlyOnly && !this.options.compoundExecution) {
      this.#acceptedHookCalls = new AcceptedHookCalls();
    }
    if(!tools){const sink=new Map<Tool,ToolDescriptionMetadata>();tools=buildToolList(undefined,undefined,[],sink,{ isYolo: () => this.permissionManager.getMode() === 'yolo' });metadata=sink;if(this.#nativeReadonlyOnly)tools=tools.filter(tool=>this.admitsNativeReadonly(tool));}
    for (const tool of tools) {
      this.registerTool(tool,metadata?.get(tool));
    }
    if (!this.#nativeReadonlyOnly) this.registerTool(createToolSearchTool(this));
  }

  /** Main/CLI bootstrap only; never a model tool. No owner swap after preparation. */
  installCompoundExecutionPort<T extends CompoundRegistryExecutionPort>(factory: (tools: readonly Tool[]) => T): T {
    if (this.#nativeReadonlyOnly) throw Error('native_readonly_compound_port_denied');
    if (this.disposed || this.executionBoundaryUsed || this.options.compoundExecution) throw Error('compound_registry_not_fresh');
    if (this.options.hooksRunner && (this.options.hookInputMode === 'direct-callback' || !isEmptyConfiguredHooksRunner(this.options.hooksRunner))) throw Error('compound_unsupervised_hooks');
    const port = factory(Object.freeze([...this.tools.values()]));
    if (!port || typeof port.execute !== 'function') throw Error('compound_registry_port_invalid');
    this.options = { ...this.options, hooksRunner: undefined, compoundExecution: port };
    this.compoundInstallationPending = false;
    this.filterGeneration++;
    return port;
  }

  async publishCompoundHistory():Promise<void>{if(this.compoundInstallationPending)throw Error('compound_child_installation_required');await this.options.compoundExecution?.publishCurrentHistory?.();}

  /** Read-only host port for synchronous observation revocation; no permission mutation API. */
  getObservationPermissionRevisionPort() {
    const manager = this.permissionManager;
    let authority = observationPermissionAuthorities.get(manager);
    if (!authority) { authority = Object.freeze({}); observationPermissionAuthorities.set(manager, authority); }
    return Object.freeze({ authority, getRevision: () => manager.getRevision(),
      onRevisionChanged: (listener: (revision: number) => void) => manager.onRevisionChanged(listener) });
  }

  /** Original host read-only rejection guard; cannot authorize a tool or provider. */
  captureObservationRegistryCurrent(): () => void {
    const filter = this.filterGeneration, generations = [...this.toolGenerations], deferred = [...this.deferredTools];
    const current = () => {
      if (this.disposed || this.parentAuthorityChanged?.() || this.filterGeneration !== filter
        || this.toolGenerations.size !== generations.length || generations.some(([name, generation]) => this.toolGenerations.get(name) !== generation)
        || this.deferredTools.size !== deferred.length || deferred.some(([name, definition]) => this.deferredTools.get(name) !== definition))
        throw new Error('observation_registry_changed');
    };
    current(); return current;
  }

  /** Host-only isolated registry. It shares permission authority, never grants permission. */
  forkForObservation(extraTools: Tool[], nativeNames: string[], task?: { mode: import('../permissions/manager.js').PermissionMode; onPrompt: RegistryOptions['onPrompt'] }): ToolRegistry {
    return this.createObservationFork(extraTools,nativeNames,task,false);
  }

  /** Host-only child bootstrap. It cannot execute until its own coordinator is installed. */
  forkForCompoundObservation(extraTools: Tool[], nativeNames: string[], task?: { mode: import('../permissions/manager.js').PermissionMode; onPrompt: RegistryOptions['onPrompt'] }): ToolRegistry {
    if (this.compoundInstallationPending) throw Error('compound_parent_owner_required');
    return this.createObservationFork(extraTools,nativeNames,task,true);
  }

  private createObservationFork(extraTools: Tool[], nativeNames: string[], task: { mode: import('../permissions/manager.js').PermissionMode; onPrompt: RegistryOptions['onPrompt'] }|undefined, pendingCompound: boolean): ToolRegistry {
    if (this.disposed) throw new Error('tool registry is disposed');
    if (this.#nativeReadonlyOnly && (pendingCompound || task?.onPrompt)) throw Error('native_readonly_external_callback_denied');
    const audited = new Set(['read', 'bash', 'edit', 'write', 'glob', 'grep', 'ls']);
    if (nativeNames.some(name => !audited.has(name)) || extraTools.some(tool => tool.definition.name !== 'observation_read' && !isObservationDelegationTool(tool) && !(pendingCompound && isIntentProducerTool(tool))))
      throw new Error('observation registry tool not admitted');
    const filterGeneration = this.filterGeneration;
    const delegatedExtras = extraTools.filter(isObservationDelegationTool);
    const intentExtras = extraTools.filter(isIntentProducerTool);
    const originals = nativeNames.map(name => {
      const registeredName = this.canonicalToolNames.get(getCanonicalToolId(name)) ?? name;
      const tool = this.tools.get(registeredName);
      if (!tool || this.allowedToolsFilter && !this.allowedToolsFilter.has(getCanonicalToolId(name)))
        throw new Error('observation registry native unavailable');
      return { registeredName, tool, execute: tool.execute, permission: tool.permission,
        generation: this.toolGenerations.get(registeredName), schema: cloneToolInput(tool.definition.inputSchema) };
    });
    const forkDescriptions=new Map<Tool,ToolDescriptionMetadata>();
    const fork = new ToolRegistry({ ...this.options, ...(this.#nativeReadonlyOnly ? { onPrompt: undefined, onToolObserved: undefined, protectedOutputGuard: undefined } : {}), ...(pendingCompound ? {compoundExecution:undefined} : {}), capabilityRegistry: undefined, capabilitySearch: false,
      ...(task ? { onPrompt: task.onPrompt } : {}),
      permissionManager: task ? new IntersectedPermissionManager(this.permissionManager, task.mode) : this.permissionManager }, [...originals.map(entry => {const cloned={ ...entry.tool,
        companionTools: undefined, definition: freezeObservationDefinition({ ...entry.tool.definition, inputSchema: cloneToolInput(entry.schema) }) };inheritCompoundSandboxPreparation(entry.tool,cloned);inheritBuiltinToolIdentity(entry.tool,cloned);const metadata=this.descriptions.get(entry.registeredName);if(metadata)forkDescriptions.set(cloned,metadata);return cloned;}), ...extraTools],forkDescriptions);
    fork.compoundInstallationPending = pendingCompound;
    fork.unregisterTool('tool_search');
    fork.setAllowedTools([...nativeNames, ...extraTools.map(tool => tool.definition.name)]);
    fork.parentAuthorityChanged = () => this.disposed || this.filterGeneration !== filterGeneration || delegatedExtras.some(tool => !isObservationDelegationTool(tool)) || intentExtras.some(tool => !isIntentProducerTool(tool)) || originals.some(entry =>
      this.tools.get(entry.registeredName) !== entry.tool || this.canonicalToolNames.get(getCanonicalToolId(entry.registeredName)) !== entry.registeredName || this.toolGenerations.get(entry.registeredName) !== entry.generation
      || entry.tool.execute !== entry.execute || entry.tool.permission !== entry.permission
      || entry.tool.definition.name !== entry.registeredName || !isDeepStrictEqual(entry.tool.definition.inputSchema, entry.schema));
    return fork;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].filter(tool => this.admitsNativeReadonly(tool)).map((tool) => this.options.compoundExecution?.describeTool?.(tool) ?? tool.definition);
  }

  /** Tightening only: seal the actual normalized options owned by this registry. */
  protected sealRegistryOptions(): void {
    Object.defineProperty(this, 'options', { value: Object.freeze(this.options), writable: false, configurable: false });
  }

  /** Subclasses must run complete readonly admission before publishing any state. */
  protected preflightToolRegistration(tool: Tool): void {
    if (this.#nativeReadonlyOnly) {
      if (this.disposed) throw new Error('tool registry is disposed');
      this.assertNativeReadonlyTree(tool);
    }
  }
  registerTool(tool: Tool,description?:ToolDescriptionMetadata): void {
    this.preflightToolRegistration(tool);
    const metadata=captureToolDescriptionMetadata(description);
    if (this.disposed) throw new Error('tool registry is disposed');
    this.toolGenerations.set(tool.definition.name, (this.toolGenerations.get(tool.definition.name) ?? 0) + 1);
    this.tools.set(tool.definition.name, tool);
    this.descriptions.set(tool.definition.name,metadata);
    this.canonicalToolNames.set(getCanonicalToolId(tool.definition.name), tool.definition.name);
    this.options.capabilityRegistry?.register({
      kind: 'tool',
      name: tool.definition.name,
      description: tool.definition.description,
      inputSchema: tool.definition.inputSchema,
      execute: async (input) => this.executeTool(tool.definition.name, input),
    }, this, metadata);
    for (const companion of tool.companionTools ?? []) {
      if (!this.tools.has(companion.definition.name)) {
        this.registerTool(companion);
      }
    }
  }

  registerDeferredTool(definition: ToolDefinition,description?:ToolDescriptionMetadata): void {
    if (this.#nativeReadonlyOnly) throw Error('native_readonly_tool_required');
    const metadata=captureToolDescriptionMetadata(description);
    if (this.disposed) throw new Error('tool registry is disposed');
    this.filterGeneration++;
    this.deferredTools.set(definition.name, definition);
    this.deferredDescriptions.set(definition.name,metadata);
    this.options.capabilityRegistry?.register({
      kind: 'tool',
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    }, this, metadata);
  }

  /** Accepted direct-hook JS calls only; never a physical-release acknowledgement. */
  waitForAcceptedHookCalls(): Promise<void> {
    if (!this.#acceptedHookCalls) throw new Error('hook_callback_join_unavailable');
    return this.#acceptedHookCalls.waitForAcceptedCalls();
  }

  dispose(): void {
    this.#acceptedHookCalls?.sealIngress();
    if (this.disposed) return;
    this.disposed = true;
    this.filterGeneration++;
    this.options.capabilityRegistry?.unregisterOwner(this);
    this.tools.clear();
    this.deferredTools.clear();this.descriptions.clear();this.deferredDescriptions.clear();
    this.canonicalToolNames.clear();
    this.allowedToolsFilter = null;
  }

  getRegisteredTool(name: string): Tool | undefined {
    const tool = this.tools.get(name);
    return this.admitsNativeReadonly(tool) ? tool : undefined;
  }

  unregisterTool(name: string, expected?: Tool): void {
    if (expected && this.tools.get(name) !== expected) return;
    this.toolGenerations.set(name, (this.toolGenerations.get(name) ?? 0) + 1);
    this.tools.delete(name);
    this.deferredTools.delete(name);this.descriptions.delete(name);this.deferredDescriptions.delete(name);
    this.options.capabilityRegistry?.unregister(name, this);
    const canonical = getCanonicalToolId(name);
    if (this.canonicalToolNames.get(canonical) === name) {
      this.canonicalToolNames.delete(canonical);
      for (const candidate of this.tools.keys()) {
        if (getCanonicalToolId(candidate) === canonical) this.canonicalToolNames.set(canonical, candidate);
      }
    }
  }

  registerDeferredTools(definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      this.registerDeferredTool(definition);
    }
  }

  getToolDiscoveries():ToolDiscovery[]{
    return [...this.tools.entries()].filter(([,tool])=>this.admitsNativeReadonly(tool)).map(([name,tool])=>{const coreDefinition=this.options.compoundExecution?.describeTool?.(tool)??tool.definition,metadata=this.descriptions.get(name);return Object.freeze(metadata?{coreDefinition,metadata}:{coreDefinition});});
  }
  /** Host-only description refresh; cannot replace an execution or its authority. */
  updateToolDescription(tool:Tool,description?:ToolDescriptionMetadata):void{
    const metadata=captureToolDescriptionMetadata(description);if(this.disposed||this.tools.get(tool.definition.name)!==tool)throw Error('tool_description_registration_mismatch');this.descriptions.set(tool.definition.name,metadata);
  }
  private deferredDiscoveries():ToolDiscovery[]{return [...this.deferredTools.entries()].map(([name,coreDefinition])=>{const metadata=this.deferredDescriptions.get(name);return Object.freeze(metadata?{coreDefinition,metadata}:{coreDefinition});});}
  private selectDiscoveries(discoveries:ToolDiscovery[],query:string):ToolDiscovery[]{
    const entries=discoveries.map(discovery=>({...buildToolSearchEntry(discovery.coreDefinition),discovery}));
    if(query.startsWith('select:'))return selectToolSearchCandidates(entries,query.slice(7).split(',').map(name=>name.trim()).filter(Boolean)).map(entry=>entry.discovery);
    const normalized=query.trim().toLowerCase();return dedupeToolSearchCandidates(entries.filter(({definition})=>!normalized||definition.name.toLowerCase().includes(normalized)||definition.description.toLowerCase().includes(normalized))).map(entry=>entry.discovery);
  }
  searchDeferredToolDiscoveries(query:string):ToolDiscovery[]{return this.selectDiscoveries(this.deferredDiscoveries(),query);}
  searchDeferredTools(query:string):ToolDefinition[]{return this.searchDeferredToolDiscoveries(query).map(entry=>entry.coreDefinition);}
  searchToolDiscoveries(query:string):ToolDiscovery[]{
    if(this.disposed)return [];
    const capabilities=this.#nativeReadonlyOnly || this.options.capabilitySearch===false?[]:this.options.capabilityRegistry?.searchDiscoveries(query.startsWith('select:')?'':query)??[];
    return this.selectDiscoveries([...this.getToolDiscoveries(),...this.deferredDiscoveries(),...capabilities.map(({coreRecord,metadata})=>{const coreDefinition=buildCapabilityToolDefinition(coreRecord);return Object.freeze(metadata?{coreDefinition,metadata}:{coreDefinition});})],query);
  }
  searchTools(query:string):ToolDefinition[]{return this.searchToolDiscoveries(query).map(entry=>entry.coreDefinition);}

  async executeTool(
    name: string,
    rawInput: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> {
    await assertNativeRegistryCheckpointCurrent(this);
    if(this.compoundInstallationPending)throw Error('compound_child_installation_required');
    this.executionBoundaryUsed = true;
    try {
      if (this.#nativeReadonlyOnly) {
        const registeredName = this.canonicalToolNames.get(getCanonicalToolId(name)) ?? name;
        if (!this.admitsNativeReadonly(this.tools.get(registeredName))) return 'Error: native_readonly_tool_required';
      }
      if (this.options.compoundExecution) return await this.executeThroughCompoundPort(name, rawInput, context);
      const prepared = await this.prepareToolInvocation(name, rawInput, context);
      if (typeof prepared !== 'string') return await this.executePreparedTool(prepared);
      context?.signal?.throwIfAborted();
      measureToolResult('registry_return', context?.toolInvocationId, name, prepared);
      return prepared;
    } catch (error) {
      // Includes rejecting policy/approval/preflight dependencies, which are
      // deliberately outside ordinary tool-failure normalization below.
      context?.signal?.throwIfAborted();
      throw error;
    }
  }

  private async executeThroughCompoundPort(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const port = this.options.compoundExecution!;
    const input = freezeObservationDefinition(cloneToolInput(rawInput));
    const owned = new Set<PreparedToolInvocation>();
    const effects = new Set<Promise<string>>();
    let active = true;
    const current = () => { if (!active || this.disposed) throw Error('compound_native_port_expired'); };
    const native = Object.freeze({
      registeredTool: (toolName:string) => {current();return this.tools.get(this.canonicalToolNames.get(getCanonicalToolId(toolName))??toolName);},
      prepare: async (toolName: string, toolInput: Record<string, unknown>, phase?: Pick<ToolExecutionContext, 'toolInvocationId' | 'compoundPhase' | 'signal'>): Promise<ToolPreparationResult> => {
        current();
        if (phase && !context) throw Error('compound_native_context_required');
        const nativeContext = context ? { ...context, ...phase, compoundPhase:phase?.compoundPhase??{},
          signal: phase?.signal ? AbortSignal.any([context.signal,phase.signal].filter((s):s is AbortSignal=>!!s)) : context.signal } : undefined;
        const result = await this.prepareToolInvocationDetailedInternal(toolName, toolInput, nativeContext);
        if (!active || this.disposed) {
          if (result.kind === 'prepared') this.preparedInvocations.delete(result.invocation);
          throw Error('compound_native_port_expired');
        }
        if (result.kind === 'prepared') {
          if (!toolInputMatchesSnapshot(rawInput, input)) {
            this.preparedInvocations.delete(result.invocation);
            return Object.freeze({ kind: 'not_started', reason: 'invalidated', message: 'Error: ingress input changed; request fresh approval' });
          }
          owned.add(result.invocation);
        }
        return result;
      },
      execute: async (invocation: PreparedToolInvocation, projectResult?: (nativeResult:string)=>Promise<string>): Promise<string> => {
        current();
        if (!owned.delete(invocation)) throw Error('compound_native_token_mismatch');
        const effect = this.consumePreparedTool(invocation, projectResult);
        effects.add(effect);
        try { return await effect; } finally { effects.delete(effect); }
      },
    });
    try {
      const registeredName = this.canonicalToolNames.get(getCanonicalToolId(name)) ?? name;
      const result = await port.execute({ name, input, context, native, tool: this.tools.get(registeredName) });
      context?.signal?.throwIfAborted();
      measureToolResult('registry_return', context?.toolInvocationId, name, result);
      return result;
    } finally {
      active = false;
      for (const invocation of owned) this.preparedInvocations.delete(invocation);
      // A misbehaving host callback cannot return while its native effects are in flight.
      await Promise.allSettled([...effects]);
    }
  }

  async executePreparedTool(prepared: PreparedToolInvocation): Promise<string> {
    await assertNativeRegistryCheckpointCurrent(this);
    if(this.compoundInstallationPending)throw Error('compound_child_installation_required');
    if (this.options.compoundExecution) throw Error('compound_native_port_required');
    return this.consumePreparedTool(prepared);
  }

  private async consumePreparedTool(prepared: PreparedToolInvocation, projectResult?: (nativeResult:string)=>Promise<string>): Promise<string> {
    await assertNativeRegistryCheckpointCurrent(this);
    const record = this.preparedInvocations.get(prepared);
    if (!record) throw new Error('prepared_tool_invocation_invalid_or_consumed');
    this.preparedInvocations.delete(prepared);
    const result = await record.execute(projectResult);
    record.context?.signal?.throwIfAborted();
    measureToolResult('registry_return', record.context?.toolInvocationId, record.name, result);
    return result;
  }

  /** Host-only split phase: performs the existing approval/hook contract without native effects. */
  async prepareToolInvocation(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<string | PreparedToolInvocation> {
    const result = await this.prepareToolInvocationDetailed(name, rawInput, context);
    return result.kind === 'prepared' ? result.invocation : result.message;
  }

  async prepareToolInvocationDetailed(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolPreparationResult> {
    await assertNativeRegistryCheckpointCurrent(this);
    if(this.compoundInstallationPending)throw Error('compound_child_installation_required');
    this.executionBoundaryUsed = true;
    if (this.options.compoundExecution) return Object.freeze({ kind: 'not_started', reason: 'blocked', message: 'Error: compound_native_port_required' });
    return this.prepareToolInvocationDetailedInternal(name, rawInput, context);
  }

  private async prepareToolInvocationDetailedInternal(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolPreparationResult> {
    let reason: ToolPreparationStopReason = 'blocked';
    const result = await this.prepareRegisteredToolInvocation(name, rawInput, context, value => { reason = value; });
    return typeof result === 'string' ? Object.freeze({kind:'not_started', reason, message:result})
      : Object.freeze({kind:'prepared', invocation:result});
  }

  private async prepareRegisteredToolInvocation(
    name: string,
    rawInput: Record<string, unknown>,
    context?: ToolExecutionContext,
    onStop?: (reason: ToolPreparationStopReason) => void,
  ): Promise<string | PreparedToolInvocation> {
    const stop = (message: string, reason: ToolPreparationStopReason): string => { onStop?.(reason); return message; };
    context?.signal?.throwIfAborted();
    if (this.disposed) return stop('Error: tool registry is disposed', 'invalidated');
    let input: Record<string, unknown>;
    try { input = cloneToolInput(rawInput); }
    catch { return stop('Error: invalid tool input snapshot', 'invalid'); }
    let permissionGrant: ToolPermissionGrant | undefined;
    let approvedInput: Record<string, unknown> | undefined;
    const canonicalToolId = getCanonicalToolId(name);
    if (this.allowedToolsFilter !== null && !this.allowedToolsFilter.has(canonicalToolId)) {
      return stop(`Error: tool "${name}" is not allowed in current skill context`, 'denied');
    }

    const registeredName = this.canonicalToolNames.get(canonicalToolId) ?? name;
    const tool = this.tools.get(registeredName);
    if (!tool) return stop(`Error: 未知工具: ${name}`, 'invalid');
    if (!this.admitsNativeReadonly(tool)) return stop('Error: native_readonly_tool_required', 'denied');
    const execute = tool.execute;
    const compoundPreparation = this.options.compoundExecution ? getCompoundSandboxPreparation(tool) : undefined;
    const permission = tool.permission;
    let schema: Record<string, unknown>;
    try { schema = cloneToolInput(tool.definition.inputSchema); }
    catch { return stop('Error: invalid tool schema snapshot', 'invalid'); }
    const toolGeneration = this.toolGenerations.get(registeredName);
    const filterGeneration = this.filterGeneration;
    const authorityChanged = () => !this.admitsNativeReadonly(tool) || this.parentAuthorityChanged?.() === true || this.disposed
      || this.filterGeneration !== filterGeneration
      || this.toolGenerations.get(registeredName) !== toolGeneration
      || this.tools.get(registeredName) !== tool
      || (this.canonicalToolNames.get(canonicalToolId) ?? name) !== registeredName
      || tool.execute !== execute || tool.permission !== permission
      || (this.options.compoundExecution && getCompoundSandboxPreparation(tool) !== compoundPreparation)
      || tool.definition.name !== registeredName
      || !isDeepStrictEqual(tool.definition.inputSchema, schema);
    const changedError = 'Error: tool authorization changed; request fresh authorization';
    if (authorityChanged()) return stop(changedError, 'invalidated');

    const validation = validateToolInput(schema, input);
    if (!validation.valid) {
      return stop(`Error: 输入校验失败: ${validation.errors.join('; ')}`, 'invalid');
    }

    if (this.options.dryRun) {
      return stop(`[dry-run] ${name}(${JSON.stringify(input)})`, 'handled');
    }

    const initialPolicyRevision = this.permissionManager.getRevision();
    let continuationPolicyRevision = initialPolicyRevision;
    const decision = await this.permissionManager.check(registeredName, cloneToolInput(input));
    context?.signal?.throwIfAborted();
    if (authorityChanged() || initialPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
    if (decision === 'deny') {
      if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
        const hookReceiver = this.options.hooksRunner;
        const hookFunction = captureDirectHookSlot(hookReceiver, 'runHooks', true);
        if (hookFunction) {
          const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'generic');
          let hookReturnCaptured = false;
          let hookReturnConfirmed = false;
          try {
            const rawHookReturn = hookReceiver.runHooks!('PermissionDenied', {
        tool_name: tool.definition.name,
        input,
        reason: 'policy_denied',
      });
            this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
            hookReturnCaptured = true;
            assertDirectHookReturn(rawHookReturn);
            hookReturnConfirmed = true;
            await rawHookReturn;
            this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
          } catch (error) {
            if (hookReturnCaptured && !hookReturnConfirmed) {
              this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
            } else {
              this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
            }
            throw error;
          }
        } else {
          await undefined;
        }
      } else if (this.options.hookInputMode !== 'direct-callback') {
        await this.options.hooksRunner?.runHooks('PermissionDenied', {
        tool_name: tool.definition.name,
        input,
        reason: 'policy_denied',
      });
      } else {
        await undefined;
      }
      context?.signal?.throwIfAborted();
      return stop(`Error: 权限不足: ${name}`, 'denied');
    }

    if (decision === 'prompt' && permission !== 'safe') {
      let permissionRequest: Awaited<ReturnType<HooksRunner['runHooks']>> | undefined;
      if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
        const hookReceiver = this.options.hooksRunner;
        const hookFunction = captureDirectHookSlot(hookReceiver, 'runHooks', true);
        if (hookFunction) {
          const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'generic');
          let hookReturnCaptured = false;
          let hookReturnConfirmed = false;
          try {
            const rawHookReturn = hookReceiver.runHooks!('PermissionRequest', {
        tool_name: tool.definition.name,
        input: cloneToolInput(input),
      });
            this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
            hookReturnCaptured = true;
            assertDirectHookReturn(rawHookReturn);
            hookReturnConfirmed = true;
            permissionRequest = await rawHookReturn;
            this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
          } catch (error) {
            if (hookReturnCaptured && !hookReturnConfirmed) {
              this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
            } else {
              this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
            }
            throw error;
          }
        } else {
          permissionRequest = await undefined;
        }
      } else if (this.options.hookInputMode !== 'direct-callback') {
        permissionRequest = await this.options.hooksRunner?.runHooks('PermissionRequest', {
        tool_name: tool.definition.name,
        input: cloneToolInput(input),
      });
      } else {
        permissionRequest = await undefined;
      }
      context?.signal?.throwIfAborted();
      if (authorityChanged() || initialPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
      if (permissionRequest?.decision === 'deny' || permissionRequest?.ok === false) {
        if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
          const hookReceiver = this.options.hooksRunner;
          const hookFunction = captureDirectHookSlot(hookReceiver, 'runHooks', true);
          if (hookFunction) {
            const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'generic');
            let hookReturnCaptured = false;
            let hookReturnConfirmed = false;
            try {
              const rawHookReturn = hookReceiver.runHooks!('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: permissionRequest?.message ?? 'denied_by_permission_hook',
        });
              this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
              hookReturnCaptured = true;
              assertDirectHookReturn(rawHookReturn);
              hookReturnConfirmed = true;
              await rawHookReturn;
              this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
            } catch (error) {
              if (hookReturnCaptured && !hookReturnConfirmed) {
                this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
              } else {
                this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
              }
              throw error;
            }
          } else {
            await undefined;
          }
        } else if (this.options.hookInputMode !== 'direct-callback') {
          await this.options.hooksRunner?.runHooks('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: permissionRequest?.message ?? 'denied_by_permission_hook',
        });
        } else {
          await undefined;
        }
        context?.signal?.throwIfAborted();
        return stop(`Error: ${permissionRequest?.message ?? `权限不足: ${name}`}`, 'denied');
      }
      let approved: boolean | ToolPermissionGrant;
      if (permissionRequest?.decision === 'allow') approved = true;
      else {
        const promptToken = Object.freeze({});
        const result = await this.permissionManager.runPromptAuthorization(promptToken, registeredName, cloneToolInput(input),
          () => this.options.onPrompt(registeredName, cloneToolInput(input), { tool, context }));
        context?.signal?.throwIfAborted();
        if (authorityChanged() || result.continuationRevision === undefined) return stop(changedError, 'invalidated');
        approved = result.value;
        continuationPolicyRevision = result.continuationRevision;
      }
      context?.signal?.throwIfAborted();
      if (authorityChanged() || continuationPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
      permissionGrant = snapshotToolPermissionGrant(approved);
      if (approved !== true && !permissionGrant) {
        if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
          const hookReceiver = this.options.hooksRunner;
          const hookFunction = captureDirectHookSlot(hookReceiver, 'runHooks', true);
          if (hookFunction) {
            const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'generic');
            let hookReturnCaptured = false;
            let hookReturnConfirmed = false;
            try {
              const rawHookReturn = hookReceiver.runHooks!('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: 'prompt_declined',
        });
              this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
              hookReturnCaptured = true;
              assertDirectHookReturn(rawHookReturn);
              hookReturnConfirmed = true;
              await rawHookReturn;
              this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
            } catch (error) {
              if (hookReturnCaptured && !hookReturnConfirmed) {
                this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
              } else {
                this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
              }
              throw error;
            }
          } else {
            await undefined;
          }
        } else if (this.options.hookInputMode !== 'direct-callback') {
          await this.options.hooksRunner?.runHooks('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: 'prompt_declined',
        });
        } else {
          await undefined;
        }
        context?.signal?.throwIfAborted();
        return stop(`${TOOL_CANCELLED_PREFIX}${name}）`, 'cancelled');
      }
      approvedInput = cloneToolInput(input);
    }

    let preHookResult: Awaited<ReturnType<HooksRunner['runPreHooks']>> | undefined;
    if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
      const hookReceiver = this.options.hooksRunner;
      const hookFunction = captureDirectHookSlot(hookReceiver, 'runPreHooks', false);
      if (hookFunction) {
        const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'pre');
        let hookReturnCaptured = false;
        let hookReturnConfirmed = false;
        try {
          const rawHookReturn = hookReceiver.runPreHooks(registeredName, cloneToolInput(input));
          this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
          hookReturnCaptured = true;
          assertDirectHookReturn(rawHookReturn);
          hookReturnConfirmed = true;
          preHookResult = await rawHookReturn;
          this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
        } catch (error) {
          if (hookReturnCaptured && !hookReturnConfirmed) {
            this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
          } else {
            this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
          }
          throw error;
        }
      } else {
        preHookResult = await undefined;
      }
    } else {
      preHookResult = await this.options.hooksRunner?.runPreHooks(registeredName, cloneToolInput(input));
    }
    context?.signal?.throwIfAborted();
    if (authorityChanged() || continuationPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
    if (preHookResult && !preHookResult.ok) {
      return stop(`Error: ${preHookResult.message ?? `${name} blocked by pre hook`}`, 'blocked');
    }

    // Apply hook-provided input overrides
    if (preHookResult?.updatedInput) {
      try { input = cloneToolInput({ ...input, ...preHookResult.updatedInput }); }
      catch { return stop('Error: invalid post-hook input snapshot', 'invalid'); }
    }

    if (preHookResult?.preventContinuation) {
      const message = preHookResult.additionalContext
        ?? preHookResult.message
        ?? `[${name} handled by pre hook]`;
      return stop(`${message}\n[agent loop should stop after this tool]`, 'handled');
    }

    const finalValidation = validateToolInput(schema, input);
    if (!finalValidation.valid) return stop(`Error: 输入校验失败: ${finalValidation.errors.join('; ')}`, 'invalid');
    const finalPolicyRevision = this.permissionManager.getRevision();
    const finalDecision = await this.permissionManager.check(registeredName, cloneToolInput(input));
    context?.signal?.throwIfAborted();
    if (authorityChanged() || finalPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
    if (finalDecision === 'deny') return stop(`Error: 权限不足: ${name}`, 'denied');
    if (approvedInput && !isDeepStrictEqual(approvedInput, input)
      || finalDecision === 'prompt' && permission !== 'safe' && !approvedInput) {
      return stop('Error: final input requires fresh approval', 'invalidated');
    }

    const protectedOutputDecision = await this.evaluateProtectedOutputGuard(registeredName, cloneToolInput(input));
    context?.signal?.throwIfAborted();
    if (authorityChanged() || finalPolicyRevision !== this.permissionManager.getRevision()) return stop(changedError, 'invalidated');
    if (protectedOutputDecision && !protectedOutputDecision.ok) {
      return stop(`Error: ${protectedOutputDecision.reason}\n${protectedOutputDecision.action}`, 'denied');
    }

    // Approval/hooks may finish after a caller interrupt or an agent deadline.
    // Keep cancellation outside failure normalization, and do not start a new operation.
    context?.signal?.throwIfAborted();
    if (this.disposed) return stop('Error: tool registry is disposed', 'invalidated');
    const normalizeFailure = async (e: unknown): Promise<string> => {
      context?.signal?.throwIfAborted();
      if (isAbortError(e) || (e instanceof Error && e.message.startsWith('TOOL_IDLE_TIMEOUT'))) throw e;
      const errorMessage = formatErrorText(String(e));
      if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
        const hookReceiver = this.options.hooksRunner;
        const hookFunction = captureDirectHookSlot(hookReceiver, 'runHooks', true);
        if (hookFunction) {
          const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'generic');
          let hookReturnCaptured = false;
          let hookReturnConfirmed = false;
          try {
            const rawHookReturn = hookReceiver.runHooks!('PostToolUseFailure', {
        tool_name: tool.definition.name,
        tool_input: input,
        error: errorMessage,
      });
            this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
            hookReturnCaptured = true;
            assertDirectHookReturn(rawHookReturn);
            hookReturnConfirmed = true;
            await rawHookReturn;
            this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
          } catch (error) {
            if (hookReturnCaptured && !hookReturnConfirmed) {
              this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
            } else {
              this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
            }
            throw error;
          }
        } else {
          await undefined;
        }
      } else if (this.options.hookInputMode !== 'direct-callback') {
        await this.options.hooksRunner?.runHooks('PostToolUseFailure', {
        tool_name: tool.definition.name,
        tool_input: input,
        error: errorMessage,
      });
      } else {
        await undefined;
      }
      context?.signal?.throwIfAborted();
      return `Error: ${errorMessage}`;
    };
    try {
      if (this.tools.get(registeredName) !== tool) return stop(`Error: tool ${name} is no longer registered`, 'invalidated');
      let invocationContext = context;
      const assertInvocationCurrent = () => {
        context?.signal?.throwIfAborted();
        context?.assertPermissionApproval?.();
        if (permissionGrant) assertSynchronousGrantResult(permissionGrant.assertCurrent());
        context?.signal?.throwIfAborted();
        if (authorityChanged() || finalPolicyRevision !== this.permissionManager.getRevision()) throw new Error('tool authorization changed');
      };
      if (permissionGrant) {
        if (!context) throw new Error('approval_context_unavailable');
        const prepared = permissionGrant.prepareInput(cloneToolInput(input));
        assertSynchronousGrantResult(prepared);
        if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(prepared))) throw new Error('approval_grant_invalid');
        const preparedInput = cloneToolInput(prepared);
        if (!validateToolInput(schema, preparedInput).valid || !isDeepStrictEqual(preparedInput, input)) throw new Error('approval_input_changed');
        input = preparedInput;
        const preparedDecision = await this.permissionManager.check(registeredName, cloneToolInput(input));
        context.signal?.throwIfAborted();
        if (preparedDecision === 'deny' || authorityChanged() || finalPolicyRevision !== this.permissionManager.getRevision()) throw new Error('tool authorization changed');
      }
      assertInvocationCurrent();
      if (approvedInput) context?.assertToolInputApprovalAdmission?.();
      if (compoundPreparation) {
        const sandboxInput = cloneToolInput(input); freezeToolInput(sandboxInput);
        const denial = await compoundPreparation(sandboxInput, context);
        context?.signal?.throwIfAborted(); assertInvocationCurrent();
        if (denial !== undefined) return stop(denial, 'denied');
      }
      // Scoped native wrappers re-enter this guard after their own journal await,
      // including auto/boolean approvals which do not carry a grant object.
      if (context) {
        invocationContext = { ...context, assertPermissionApproval: assertInvocationCurrent };
        if (Object.isFrozen(context)) Object.freeze(invocationContext);
      }
      freezeToolInput(input);
      const executePrepared = async (projectResult?: (nativeResult:string)=>Promise<string>): Promise<string> => {
        try {
      let rawResult = await runMonitoredTool({name,context:invocationContext,
        idleMs:tool.executionPolicy?.idleTimeoutMs ?? this.toolIdleTimeoutMs,
        waitsForUser:tool.executionPolicy?.waitsForUser,
        run: async ctx => {
          await assertNativeRegistryCheckpointCurrent(this);
          ctx?.signal?.throwIfAborted();
          assertInvocationCurrent();
          return execute.call(tool, input, this.#nativeReadonlyOnly ? createNativeReadonlyExecutionContext(ctx) : ctx);
        },
      });
      context?.signal?.throwIfAborted();
      const project = projectResult ?? context?.projectObservationResult;
      if (project) {
        rawResult = await project(rawResult);
        context?.signal?.throwIfAborted();
        if (typeof rawResult !== 'string') throw new Error('observation_projection_invalid');
      }

      // Provenance failures only disable projection; executed tool outcomes are unchanged.
      let provenance: import('../../runtime/sol-pi/observation-provenance.js').NativeObservationProvenancePort | undefined;
      try { provenance = context?.observationProvenance?.(); } catch { /* no eligible receipt */ }
      const recordProvenance = (record: (port: NonNullable<typeof provenance>) => void) => {
        if (!provenance) return;
        try { record(provenance); } catch { try { provenance.invalidate(); } catch { /* host record unavailable */ } provenance = undefined; }
      };

      // Append hook-provided additional context
      let result = rawResult;
      if (preHookResult?.additionalContext) {
        const suffix = `\n${preHookResult.additionalContext}`;
        result += suffix;
        recordProvenance(port => port.appendSuffix(suffix));
      }

      const observedOutput = sanitizeToolOutput(rawResult, { cap: false });
      const observedResult = appendToolWarnings(observedOutput.text, observedOutput.warnings);

      await this.options.onToolObserved?.({
        phase: 'after',
        agentId: this.options.agentId ?? 'main',
        toolName: tool.definition.name,
        input: cloneToolInput(input),
        result: observedResult,
        ok: isSuccessfulToolResult(observedResult),
      });
      context?.signal?.throwIfAborted();

      let warnings: Awaited<ReturnType<HooksRunner['runPostHooks']>>;
      if (this.options.hookInputMode === 'direct-callback' && this.options.hooksRunner) {
        const hookReceiver = this.options.hooksRunner;
        const hookFunction = captureDirectHookSlot(hookReceiver, 'runPostHooks', false);
        if (hookFunction) {
          const acceptedCall = this.#acceptedHookCalls!.reserveOriginalCall(hookReceiver, hookFunction, 'post');
          let hookReturnCaptured = false;
          let hookReturnConfirmed = false;
          try {
            const rawHookReturn = hookReceiver.runPostHooks(tool.definition.name, input);
            this.#acceptedHookCalls!.captureOriginalReturn(acceptedCall, rawHookReturn);
            hookReturnCaptured = true;
            assertDirectHookReturn(rawHookReturn);
            hookReturnConfirmed = true;
            warnings = await rawHookReturn ?? [];
            this.#acceptedHookCalls!.recordOriginalResolution(acceptedCall);
          } catch (error) {
            if (hookReturnCaptured && !hookReturnConfirmed) {
              this.#acceptedHookCalls!.recordUnconfirmedReturn(acceptedCall, error);
            } else {
              this.#acceptedHookCalls!.recordOriginalRejection(acceptedCall, error);
            }
            throw error;
          }
        } else {
          warnings = await undefined ?? [];
        }
      } else {
        warnings = await this.options.hooksRunner?.runPostHooks(tool.definition.name, input) ?? [];
      }
      context?.signal?.throwIfAborted();
      if (observationMetricsEnabled()) {
        measureToolResult('registry_visible', context?.toolInvocationId, tool.definition.name, sanitizeToolOutput(result, { cap: false }).text);
      }
      const modelOutput = sanitizeToolOutput(result);
      recordProvenance(port => port.observeTransform({ before: result, after: modelOutput.text }));
      const finalResult = appendToolWarnings(modelOutput.text, [...modelOutput.warnings, ...warnings], suffix => recordProvenance(port => port.appendSuffix(suffix)));
      recordProvenance(port => port.sealRegistry(finalResult));
      return finalResult;
        } catch (e) { return normalizeFailure(e); }
      };
      const preparedInput = cloneToolInput(input); freezeToolInput(preparedInput);
      const prepared = Object.freeze({ toolName: registeredName, input: preparedInput });
      this.preparedInvocations.set(prepared, { execute: executePrepared, context, name });
      return prepared;
    } catch (e) { return normalizeFailure(e); }
  }

  private async evaluateProtectedOutputGuard(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<GuardDecision | null> {
    const guard = this.options.protectedOutputGuard;
    if (!guard) return null;

    const targetPath = resolveWriteTargetPath(toolName, input);
    if (!targetPath) return null;

    const decision = evaluateProtectedOutputGuard({
      operation: 'overwrite',
      targetPath,
      protectedArtifacts: guard.getProtectedArtifacts(),
    });
    await guard.onDecision?.(decision);
    return decision;
  }

  /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
  enableAutoMode(): void {
    this.permissionManager.setMode('auto');
  }
}

/** Tools accept JSON data; callback-owned objects must never become execution state. */
function cloneToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const seen = new Set<object>();
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('invalid input');
      return value;
    }
    if (seen.has(value)) throw new Error('cyclic input');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('non-JSON input');
    seen.add(value);
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!('value' in descriptor)) throw new Error('accessor input');
      Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(value);
    return result;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('object input required');
  return copy(input) as Record<string, unknown>;
}

/** Compare JSON data without invoking a retained caller's getters. This is
 * only an admission check; a consumed approval executes its private snapshot. */
function toolInputMatchesSnapshot(rawInput: Record<string, unknown>, snapshot: Readonly<Record<string, unknown>>): boolean {
  try { return isDeepStrictEqual(cloneToolInput(rawInput), snapshot); }
  catch { return false; }
}

/** Fixed host producer admission, captured before handing raw input to Registry.
 * Capture never throws: Registry retains its original invalid-data result.
 * Approved private input is admitted once, before any prepared native effect. */
export function createToolInputAdmissionGuard(rawInput: Record<string, unknown>): () => void {
  let snapshot: Record<string, unknown> | undefined;
  try { snapshot = cloneToolInput(rawInput); } catch { /* invalid capture stays denied */ }
  let admitted = false;
  return () => {
    if (admitted) return;
    if (!snapshot || !toolInputMatchesSnapshot(rawInput, snapshot)) {
      throw new Error('ingress input changed; request fresh approval');
    }
    admitted = true;
    snapshot = undefined;
  };
}

function freezeToolInput(input: object): void {
  for (const value of Object.values(input)) if (value && typeof value === 'object') freezeToolInput(value);
  Object.freeze(input);
}

/** Runtime shape check: literal true plus both grant methods are required;
 * synchronous returns are checked when consumed. Objects are never truthy allow. */
export function isToolPermissionGrant(value: unknown): value is ToolPermissionGrant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const grant = value as Partial<ToolPermissionGrant>;
  return grant.approved === true && typeof grant.prepareInput === 'function' && typeof grant.assertCurrent === 'function';
}

/** Capture the approved functions before yielding to hooks or journal writes.
 * Mutating the issuer's object must not replace an already issued guard. */
export function snapshotToolPermissionGrant(value: unknown): ToolPermissionGrant | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const approved = Object.getOwnPropertyDescriptor(value, 'approved');
  const prepare = Object.getOwnPropertyDescriptor(value, 'prepareInput');
  const current = Object.getOwnPropertyDescriptor(value, 'assertCurrent');
  if (!approved || !('value' in approved) || approved.value !== true
    || !prepare || !('value' in prepare) || typeof prepare.value !== 'function'
    || !current || !('value' in current) || typeof current.value !== 'function') return undefined;
  return Object.freeze({ approved: true, prepareInput: prepare.value.bind(value), assertCurrent: current.value.bind(value) });
}

function assertSynchronousGrantResult(value: unknown): void {
  if (value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function') {
    // Reject async guards without allowing their rejected Promise to escape as
    // an unhandled rejection. This is not an approval wait or a second attempt.
    void Promise.resolve(value).catch(() => undefined);
    throw new Error('approval_grant_invalid');
  }
}

function isSuccessfulToolResult(result: string): boolean {
  const normalized = result.trimStart();
  if (normalized.startsWith('Error:')) {
    return false;
  }
  if (normalized.startsWith('（已取消')) {
    return false;
  }
  return true;
}

export const TOOL_CANCELLED_PREFIX = '（已取消: ';

/**
 * Model-facing verdict: may this result be replayed to the model, and to the
 * event stream, as a success?
 *
 * Deliberately separate from `isSuccessfulToolResult` above, which feeds
 * `onToolObserved` (skill evidence) and keeps its narrower `Error:` rule.
 * Widening that one has a much larger blast radius and no test reachability,
 * so it is tracked as follow-up work rather than folded in here.
 */
export function isSuccessfulModelToolResult(result: string): boolean {
  const normalized = result.trimStart();
  // Intentionally not /^Error\b/: `Errors found: 0` must stay a failure here,
  // because relaxing it is the one change that would open a fail-open path.
  if (normalized.startsWith('Error')) {
    return false;
  }
  if (normalized.startsWith(TOOL_CANCELLED_PREFIX)) {
    return false;
  }
  return !isDomainLevelFailurePayload(normalized);
}

/**
 * Desktop serialises operation failures as `JSON.stringify({ok:false, ...})`,
 * which never starts with `Error`. Only the top-level `ok` / `success` booleans
 * count: they carry operation status. A validator's `valid` field is a verdict
 * about the caller's input — the call itself succeeded — so it is excluded.
 */
function isDomainLevelFailurePayload(normalized: string): boolean {
  if (!normalized.startsWith('{')) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const payload = parsed as Record<string, unknown>;
  return payload.ok === false || payload.success === false;
}

function appendToolWarnings(result: string, warnings: string[], onAppend?: (suffix: string) => void): string {
  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length === 0) {
    return result;
  }
  const suffix = `\nWarning: ${uniqueWarnings.join('\nWarning: ')}`;
  onAppend?.(suffix);
  return result + suffix;
}

function resolveWriteTargetPath(toolName: string, input: Record<string, unknown>): string | null {
  const normalized = toolName.toLowerCase();
  if (normalized !== 'write' && normalized !== 'edit') {
    return null;
  }
  return typeof input.file_path === 'string' && input.file_path.trim()
    ? input.file_path
    : null;
}
