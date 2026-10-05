import type { Tool, ToolDefinition, ToolExecutionContext, ToolPermissionGrant } from '../../types.js';
import { PermissionManager } from '../permissions/manager.js';
import { type HooksRunner } from '../../runtime/hooks-runner.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import type { GuardDecision } from '../../runtime/guards/policy.js';
import { type WorkspaceToolOptions } from './read.js';
export declare function buildToolList(skillTool?: Tool, workspace?: WorkspaceToolOptions, extraTools?: Tool[]): Tool[];
/** Host-owned routing boundary. It is not a model parameter or permission grant. */
export interface CompoundRegistryExecutionPort {
    publishCurrentHistory?(): Promise<void>;
    describeTool?(tool: Tool): ToolDefinition;
    execute(input: {
        name: string;
        input: Readonly<Record<string, unknown>>;
        context?: ToolExecutionContext;
        /** Actual host registration; never a tool-provided readOnly claim. */
        tool?: Tool;
        native: {
            registeredTool(name: string): Tool | undefined;
            prepare(name: string, input: Record<string, unknown>, phase?: Pick<ToolExecutionContext, 'toolInvocationId' | 'compoundPhase' | 'signal'>): Promise<ToolPreparationResult>;
            execute(invocation: PreparedToolInvocation, projectResult?: (nativeResult: string) => Promise<string>): Promise<string>;
        };
    }): Promise<string>;
}
export interface RegistryOptions {
    compoundExecution?: CompoundRegistryExecutionPort;
    toolIdleTimeoutMs?: number;
    capabilityRegistry?: CapabilityRegistry;
    /** Child discovery must not advertise tools owned only by other registries. */
    capabilitySearch?: boolean;
    permissionManager?: PermissionManager;
    autoMode?: boolean;
    dryRun?: boolean;
    onPrompt?: (toolName: string, input: Record<string, unknown>, invocation?: {
        tool: Tool;
        context?: ToolExecutionContext;
    }) => Promise<boolean | ToolPermissionGrant>;
    hooksRunner?: HooksRunner;
    agentId?: string;
    onToolObserved?: (event: ToolObservation) => Promise<void> | void;
    protectedOutputGuard?: {
        getProtectedArtifacts(): Array<{
            artifactId: string;
            path: string;
        }>;
        onDecision?: (decision: GuardDecision) => Promise<void> | void;
    };
}
export interface ToolObservation {
    phase: 'after';
    agentId: string;
    toolName: string;
    input: Record<string, unknown>;
    result: string;
    ok: boolean;
}
export interface PreparedToolInvocation {
    readonly toolName: string;
    readonly input: Readonly<Record<string, unknown>>;
}
export type ToolPreparationStopReason = 'denied' | 'cancelled' | 'invalid' | 'invalidated' | 'blocked' | 'handled';
export type ToolPreparationResult = {
    readonly kind: 'prepared';
    readonly invocation: PreparedToolInvocation;
} | {
    readonly kind: 'not_started';
    readonly reason: ToolPreparationStopReason;
    readonly message: string;
};
export declare class ToolRegistry {
    private executionBoundaryUsed;
    private compoundInstallationPending;
    private readonly preparedInvocations;
    private tools;
    private deferredTools;
    private canonicalToolNames;
    private permissionManager;
    private options;
    private allowedToolsFilter;
    private disposed;
    private parentAuthorityChanged?;
    private filterGeneration;
    private readonly toolGenerations;
    private readonly toolIdleTimeoutMs;
    setAllowedTools(names: string[] | null): void;
    constructor(options: RegistryOptions, tools?: Tool[]);
    /** Main/CLI bootstrap only; never a model tool. No owner swap after preparation. */
    installCompoundExecutionPort<T extends CompoundRegistryExecutionPort>(factory: (tools: readonly Tool[]) => T): T;
    publishCompoundHistory(): Promise<void>;
    /** Read-only host port for synchronous observation revocation; no permission mutation API. */
    getObservationPermissionRevisionPort(): Readonly<{
        authority: object;
        getRevision: () => number;
        onRevisionChanged: (listener: (revision: number) => void) => () => void;
    }>;
    /** Original host read-only rejection guard; cannot authorize a tool or provider. */
    captureObservationRegistryCurrent(): () => void;
    /** Host-only isolated registry. It shares permission authority, never grants permission. */
    forkForObservation(extraTools: Tool[], nativeNames: string[], task?: {
        mode: import('../permissions/manager.js').PermissionMode;
        onPrompt: RegistryOptions['onPrompt'];
    }): ToolRegistry;
    /** Host-only child bootstrap. It cannot execute until its own coordinator is installed. */
    forkForCompoundObservation(extraTools: Tool[], nativeNames: string[], task?: {
        mode: import('../permissions/manager.js').PermissionMode;
        onPrompt: RegistryOptions['onPrompt'];
    }): ToolRegistry;
    private createObservationFork;
    getToolDefinitions(): ToolDefinition[];
    registerTool(tool: Tool): void;
    registerDeferredTool(definition: ToolDefinition): void;
    dispose(): void;
    getRegisteredTool(name: string): Tool | undefined;
    unregisterTool(name: string, expected?: Tool): void;
    registerDeferredTools(definitions: ToolDefinition[]): void;
    searchDeferredTools(query: string): ToolDefinition[];
    searchTools(query: string): ToolDefinition[];
    executeTool(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
    private executeThroughCompoundPort;
    executePreparedTool(prepared: PreparedToolInvocation): Promise<string>;
    private consumePreparedTool;
    /** Host-only split phase: performs the existing approval/hook contract without native effects. */
    prepareToolInvocation(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<string | PreparedToolInvocation>;
    prepareToolInvocationDetailed(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolPreparationResult>;
    private prepareToolInvocationDetailedInternal;
    private prepareRegisteredToolInvocation;
    private evaluateProtectedOutputGuard;
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode(): void;
}
/** Fixed host producer admission, captured before handing raw input to Registry.
 * Capture never throws: Registry retains its original invalid-data result.
 * Approved private input is admitted once, before any prepared native effect. */
export declare function createToolInputAdmissionGuard(rawInput: Record<string, unknown>): () => void;
/** Runtime shape check: literal true plus both grant methods are required;
 * synchronous returns are checked when consumed. Objects are never truthy allow. */
export declare function isToolPermissionGrant(value: unknown): value is ToolPermissionGrant;
/** Capture the approved functions before yielding to hooks or journal writes.
 * Mutating the issuer's object must not replace an already issued guard. */
export declare function snapshotToolPermissionGrant(value: unknown): ToolPermissionGrant | undefined;
export declare const TOOL_CANCELLED_PREFIX = "\uFF08\u5DF2\u53D6\u6D88: ";
/**
 * Model-facing verdict: may this result be replayed to the model, and to the
 * event stream, as a success?
 *
 * Deliberately separate from `isSuccessfulToolResult` above, which feeds
 * `onToolObserved` (skill evidence) and keeps its narrower `Error:` rule.
 * Widening that one has a much larger blast radius and no test reachability,
 * so it is tracked as follow-up work rather than folded in here.
 */
export declare function isSuccessfulModelToolResult(result: string): boolean;
