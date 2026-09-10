import { isAbsolute, resolve, relative } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRoomLocalCommandTool } from './room-local-command.js';
import { managedWorkspaceWrite, observeWorkspaceFile, resolveWorkspacePath, type WorkspaceRoot } from './room-workspace-local.js';
import fg from 'fast-glob';
import { assertWorkspacePath } from '../../src/ai/permissions/workspace.js';
import { appendPaginationNotice, paginateItems, truncateText } from '../../src/ai/tools/truncation.js';
import { buildToolList, ToolRegistry, isSuccessfulModelToolResult } from '../../src/ai/tools/index.js';
import { MultiAgentCoordinator, type ManagedAgentRunContext } from '../../src/ai/agents/multi-agent-coordinator.js';
import { createMultiAgentTools, MULTI_AGENT_TOOL_NAMES, CHILD_COMMUNICATION_TOOL_NAMES } from '../../src/ai/tools/multi-agent.js';
import type { Tool, ToolExecutionContext } from '../../src/types.js';
import type { TaskRunner, TaskRunnerInput, HistoryMessage } from '../../src/runtime/task-host/task-runtime-host.js';
import type { MaterialRecord } from '../../src/runtime/task-host/types.js';
export interface RoomWorkspaceExecutionContext {
    localCommandsAllowed?: boolean;
    roomId: string;
    logicalAgentId: string;
    claimId: string;
    runId: string;
    executorInstanceId: string;
    workspaceId: string;
    bindingId: string;
    generation: number;
    instructionsRevision: number;
    effectiveCwd: string;
    publishedInstructions: string;
    contextScope: {
        kind: 'room_only';
    } | {
        kind: 'project';
        projectId: string;
    };
    protocolVersion?: number;
    originHostId?: string;
    hostIncarnation?: number;
    workspaceRevision?: number;
    instructionsDigest?: string | null;
    membershipRevision?: number;
    [key: string]: unknown;
}
export interface WorkspaceManifest {
    summary: string;
    artifacts: Array<{
        path: string;
        label?: string;
        kind?: string;
    }>;
}
export interface WorkspaceExecutionPort {
    authorize(context: RoomWorkspaceExecutionContext, toolName?: string): Promise<void>;
    acquireChild(input: {
        parent: RoomWorkspaceExecutionContext;
        agentId: string;
        taskName: string;
        turn: number;
        prompt: string;
    }): Promise<RoomWorkspaceExecutionContext>;
    release(context: RoomWorkspaceExecutionContext, evidence: {
        executorInstanceId: string;
        kind: 'resources-disposed';
        verified: true;
    }): Promise<void>;
    submitManifest(context: RoomWorkspaceExecutionContext, manifest: WorkspaceManifest): Promise<void>;
}
export interface RoomWorkspaceRunOptions {
    context: RoomWorkspaceExecutionContext;
    port: WorkspaceExecutionPort;
    signal?: AbortSignal;
}
export interface RoomRunnerFactoryInput {
    context: RoomWorkspaceExecutionContext;
    registry: ToolRegistry;
    tools: Tool[];
    cwd: string;
    publishedInstructions: string;
    takePendingInput?: () => string | undefined;
    authorize: () => Promise<void>;
}
export const ROOM_UNSUPPORTED_FILE_CAPABILITIES = ['bash', 'grep', 'native coding bridge', 'external MCP', 'untracked background processes'] as const;
export function roomUnsupportedCapabilities(context?:{localCommandsAllowed?:boolean}):readonly string[] {
    return context?.localCommandsAllowed&&process.platform!=='win32'?ROOM_UNSUPPORTED_FILE_CAPABILITIES.filter(name=>name!=='bash'):ROOM_UNSUPPORTED_FILE_CAPABILITIES;
}
const discussionNames = new Set(['web_search', 'web_fetch', 'tool_search', 'get_room_messages_page']);
const workspaceNames = new Set([...discussionNames, 'read', 'write', 'edit', 'read_workspace_material', 'glob', 'skill', 'skillFetchAssets', 'scheduled_task_create', 'scheduled_task_list', 'scheduled_task_cancel', 'skill_bundle_refs', 'report_progress', ...MULTI_AGENT_TOOL_NAMES]);
/** Every additional runner registration passes the same allowlist. Private
 * notebook, global project mutation, shell and external plugin paths cannot
 * quietly reappear through a shared runner's augmentation step. */
class RoomToolRegistry extends ToolRegistry {
    private cleanupPending = false;
    private allowed?: Set<string>;
    private readonly pending = new Set<Promise<unknown>>();
    private readonly observedHashes = new Map<string, string>();
    constructor(private readonly roomOptions: {
        mode: 'discussion' | 'workspace';
        tools: Tool[];
        context?: RoomWorkspaceExecutionContext;
        port?: WorkspaceExecutionPort;
        allowedTools?: string[];
    }) {
        super({ autoMode: true }, []);
        this.allowed = new Set(roomOptions.mode === 'workspace' ? workspaceNames : discussionNames);
        if(roomOptions.mode==='workspace'&&roomOptions.context?.localCommandsAllowed&&process.platform!=='win32')this.allowed.add('bash');
        if (roomOptions.allowedTools !== undefined) {
            const ceiling = new Set([...roomOptions.allowedTools, ...CHILD_COMMUNICATION_TOOL_NAMES, 'tool_search']);
            this.allowed = new Set([...this.allowed].filter(name => ceiling.has(name)));
        }
        for (const tool of roomOptions.tools)
            this.registerTool(tool);
        if(this.allowed.has('bash'))this.registerTool(createRoomLocalCommandTool({cwd:roomOptions.context!.effectiveCwd,onCleanupPending:()=>{this.cleanupPending=true;}}));
    }
    override registerTool(tool: Tool): void {
        // ToolRegistry registers its local search tool inside super().
        if (!this.allowed) {
            if (tool.definition.name === 'tool_search')
                super.registerTool(tool);
            return;
        }
        if (!this.allowed.has(tool.definition.name))
            return;
        if(tool.definition.name==='bash')tool=createRoomLocalCommandTool({cwd:this.roomOptions.context!.effectiveCwd,onCleanupPending:()=>{this.cleanupPending=true;}});
        const definition = ['write','edit'].includes(tool.definition.name) ? { ...tool.definition, inputSchema: { ...tool.definition.inputSchema, properties: { ...(tool.definition.inputSchema.properties as Record<string,unknown>), expectedHash: { type: ['string','null'], description: 'Expected SHA256 of the last observed file; null permits creation only. Omit to use this runner\'s last successful read.' } } } } : tool.definition;
        super.registerTool({ ...tool, definition, execute: (input, context) => {
                const operation = (async () => {
                    const c = this.roomOptions.context;
                    if (c) {
                        await this.roomOptions.port!.authorize(c, tool.definition.name);
                        context?.signal?.throwIfAborted();
                    }
                    let bound = input;
                    if (c && ['read', 'write', 'edit', 'read_workspace_material'].includes(tool.definition.name))
                        bound = { ...input, file_path: assertWorkspacePath(resolve(c.effectiveCwd, String(input.file_path)), c.effectiveCwd, 'write') };
                    if (c && ['read','write','edit','read_workspace_material'].includes(tool.definition.name)) {
                        const root=c.workspaceRoot as WorkspaceRoot | undefined;
                        if(!root?.canonicalRoot||!root.identity)throw new Error('workspace_root_identity_required');
                        const filePath=resolve(await realpath(c.effectiveCwd),relative(c.effectiveCwd,String(bound.file_path))), relativePath=relative(root.canonicalRoot,filePath);
                        const target=await resolveWorkspacePath(root,relativePath,tool.definition.name==='write');
                        const key=process.platform==='win32'?target.toLowerCase():target;
                        if(tool.definition.name==='read'||tool.definition.name==='read_workspace_material') {
                            const before=await observeWorkspaceFile(root,relativePath);
                            const result=await tool.execute(bound,c&&context?{...context,session:{...context.session,cwd:c.effectiveCwd}}:context);
                            const after=await observeWorkspaceFile(root,relativePath);
                            if(before.contentHash!==after.contentHash)throw new Error('workspace_file_changed');
                            if(isSuccessfulModelToolResult(result))this.observedHashes.set(key,after.contentHash);
                            return result;
                        }
                        const expected=Object.hasOwn(input,'expectedHash')?input.expectedHash:this.observedHashes.get(key)??null;
                        if(expected!==null&&(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)))throw new Error('workspace_write_conflict');
                        let content=input.content;
                        if(tool.definition.name==='edit') {
                            const bytes=await readFile(target);
                            if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('workspace_write_conflict');
                            if(typeof input.old_string!=='string'||!input.old_string||typeof input.new_string!=='string')throw new Error('workspace_edit_invalid');
                            const original=bytes.toString('utf8');
                            if(original.split(input.old_string).length!==2)throw new Error('workspace_edit_match_not_unique');
                            content=original.replace(input.old_string,()=>String(input.new_string));
                        }
                        if(typeof content!=='string')throw new Error('workspace_write_content_invalid');
                        context?.signal?.throwIfAborted();
                        await this.roomOptions.port!.authorize(c,tool.definition.name);
                        const written=await managedWorkspaceWrite(root,relativePath,content,expected as string|null);
                        this.observedHashes.set(key,written.contentHash);
                        if(context?.toolInvocationId)context.runtimeFactSink?.emit({invocationId:context.toolInvocationId,toolName:tool.definition.name,factKind:'file_mutation',normalizedFilePaths:[target]});
                        return `Written: ${relativePath} (sha256 ${written.contentHash})`;
                    }
                    if (c && tool.definition.name === 'glob') {
                        const root=c.workspaceRoot as WorkspaceRoot | undefined;
                        if(!root?.canonicalRoot||!root.identity)throw new Error('workspace_root_identity_required');
                        await resolveWorkspacePath(root,relative(root.canonicalRoot,await realpath(c.effectiveCwd)));
                        const pattern = String(input.pattern);
                        if (isAbsolute(pattern) || pattern.replace(/\\/g, '/').split('/').includes('..'))
                            throw new Error('workspace_glob_escape');
                        const cwd = assertWorkspacePath(resolve(c.effectiveCwd, String(input.path || '.')), c.effectiveCwd, 'write');
                        const matches = await fg(pattern, { cwd, absolute: true, stats: true, followSymbolicLinks: false });
                        const paths = matches.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0)).map(item => assertWorkspacePath(item.path, c.effectiveCwd, 'write'));
                        if (!paths.length)
                            return '（无匹配文件）';
                        const page = paginateItems(paths, Number(input.offset ?? 0), Number(input.head_limit ?? 50));
                        return appendPaginationNotice(truncateText(page.items.join('\n'), Number(input.max_chars ?? 12000)).text, page.nextOffset);
                    }
                    return tool.execute(bound, c && context ? { ...context, session: { ...context.session, cwd: c.effectiveCwd } } : context);
                })();
                this.pending.add(operation);
                void operation.finally(() => this.pending.delete(operation)).catch(() => { });
                return operation;
            } });
    }
    override executeTool(name: string, input: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
        const operation = super.executeTool(name, input, context);
        this.pending.add(operation);
        void operation.finally(() => this.pending.delete(operation)).catch(() => { });
        return operation;
    }
    async drain(): Promise<void> { while (this.pending.size)
        await Promise.allSettled([...this.pending]);
        if(this.cleanupPending)throw new Error('room_command_cleanup_pending');
    }
}
export function createRoomToolRegistry(options: ConstructorParameters<typeof RoomToolRegistry>[0]): RoomToolRegistry {
    if (options.mode === 'workspace' && (!options.context || !options.port || !isAbsolute(options.context.effectiveCwd)))
        throw new Error('workspace_execution_context_required');
    return new RoomToolRegistry(options);
}
/** No wall-clock timeout, retry, terminal-status polling or synthetic release.
 * main owns durable claims; this scope only reports facts after real promises. */
export async function runRoomWorkspaceExecutor(options: RoomWorkspaceRunOptions & {
    prompt: string;
    materials?: MaterialRecord[];
    createRunner(input: RoomRunnerFactoryInput): TaskRunner;
    onTaskCreated?: (taskId: string) => void;
}): Promise<{
    text: string;
}> {
    const root = structuredClone(options.context);
    if (!isAbsolute(root.effectiveCwd) || !root.claimId || !root.runId) {
        await options.port.release(root, { executorInstanceId: root.executorInstanceId, kind: 'resources-disposed', verified: true });
        throw new Error('workspace_execution_context_required');
    }
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    const contexts = new Map<string, RoomWorkspaceExecutionContext>([['main', root]]);
    const changed = new Set<() => void>();
    const coordinator = new MultiAgentCoordinator({ onEvent: () => { for (const notify of [...changed])
            notify(); } });
    const waitDescendants = async (agentId: string) => {
        for (;;) {
            const agents = coordinator.listAgents({ requestSource: 'user', callerId: 'main' });
            const descendants = new Set([agentId]);
            for (const agent of agents)
                if (agent.parentId && descendants.has(agent.parentId))
                    descendants.add(agent.id);
            if (!agents.some(agent => agent.id !== agentId && descendants.has(agent.id) && agent.executionActive))
                return;
            await new Promise<void>(done => { const notify = () => { changed.delete(notify); done(); }; changed.add(notify); });
        }
    };
    const onAbort = () => {
        for (const agent of coordinator.listAgents({ requestSource: 'user', callerId: 'main' })) {
            if (agent.id !== 'main')
                coordinator.interruptAgent({ requestSource: 'user', callerId: 'main', target: agent.id });
        }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    async function turn(context: RoomWorkspaceExecutionContext, agentId: string, prompt: string, turnSignal: AbortSignal, history: HistoryMessage[], runContext?: ManagedAgentRunContext, allowedTools?: string[]): Promise<string> {
        const combined = AbortSignal.any([signal, turnSignal]);
        const registry = createRoomToolRegistry({ mode: 'workspace', tools: buildToolList(undefined, { cwd: context.effectiveCwd }), context, port: options.port, allowedTools });
        const tools = createMultiAgentTools({ coordinator, callerId: agentId, agents: [], createSession: async ({ identity, agentDef }) => {
                if (agentDef.model || agentDef.modelCapability || agentDef.isolation === 'worktree')
                    throw new Error('workspace_child_override_unsupported');
                const requested = agentDef.allowedTools?.length ? agentDef.allowedTools : undefined;
                const childAllowed = allowedTools === undefined ? requested : requested === undefined ? allowedTools : requested.filter(name => allowedTools.includes(name) || CHILD_COMMUNICATION_TOOL_NAMES.has(name));
                const history: HistoryMessage[] = [];
                let turnNumber = 0;
                return { run: async (message, childSignal, childRunContext) => {
                        const parent = contexts.get(identity.parentId);
                        if (!parent)
                            throw new Error('workspace_parent_claim_unavailable');
                        const acquired = await options.port.acquireChild({ parent, agentId: identity.id, taskName: identity.taskName, turn: ++turnNumber, prompt: message });
                        // A transport bug cannot silently retarget a child to a different scope.
                        try {
                            for (const key of ['roomId', 'logicalAgentId', 'workspaceId', 'bindingId', 'generation', 'instructionsRevision', 'effectiveCwd', 'protocolVersion', 'originHostId', 'hostIncarnation', 'workspaceRevision', 'instructionsDigest', 'membershipRevision', 'mappingRevision', 'localCommandsAllowed'] as const)
                                if (acquired[key] !== parent[key])
                                    throw new Error('workspace_child_context_mismatch');
                            if ([...contexts.values()].some(active => active.claimId === acquired.claimId || active.runId === acquired.runId))
                                throw new Error('workspace_child_claim_not_independent');
                            if (JSON.stringify(acquired.contextScope) !== JSON.stringify(parent.contextScope) || JSON.stringify(acquired.workspaceRoot) !== JSON.stringify(parent.workspaceRoot) || acquired.publishedInstructions !== parent.publishedInstructions)
                                throw new Error('workspace_child_context_mismatch');
                        }
                        catch (error) {
                            // Never mistake an existing parent's/sibling's claim for
                            // newly acquired, disposable child resources.
                            if (![...contexts.values()].some(active => active.claimId === acquired.claimId))
                                await options.port.release(acquired, { executorInstanceId: acquired.executorInstanceId, kind: 'resources-disposed', verified: true });
                            throw error;
                        }
                        contexts.set(identity.id, acquired);
                        return turn(acquired, identity.id, message, childSignal ?? signal, history, childRunContext, childAllowed);
                    }, dispose: async () => { }, suspend: async () => { } };
            } });
        for (const tool of tools)
            registry.registerTool(tool);
        const manifest: WorkspaceManifest = { summary: '', artifacts: [] };
        let released = false;
        try {
            await options.port.authorize(context);
            combined.throwIfAborted();
            const runner = options.createRunner({ context, registry, tools, cwd: context.effectiveCwd, publishedInstructions: context.publishedInstructions + '\nUse standard spawn_agent/send_message/followup_task/wait_agent for collaboration. The root must actively call wait_agent to receive child messages and results; children receive pending messages at model boundaries. Unsupported: ' + roomUnsupportedCapabilities(context).join(', '),
                authorize: () => options.port.authorize(context), takePendingInput: runContext?.takePendingInput });
            options.onTaskCreated?.(context.runId);
            const input: TaskRunnerInput = { taskId: context.runId, sessionId: `room_${context.roomId}_${agentId}`, prompt, materials: options.materials ?? [],
                understanding: { goal: prompt, deliverable: 'room response', taskType: 'unknown', audience: 'room members', inputs: [], missingInfo: [], assumptions: [], riskLevel: 'low', suggestedPlan: [], nextAction: 'execute' },
                signal: combined, history, permissionMode: 'auto', emitUsage: async () => { },
                emitRuntimeEvent: async (event) => {
                    if (event.type === 'receipt_emitted')
                        manifest.summary = event.note;
                    if (event.type === 'artifact_recorded' && typeof event.path === 'string')
                        manifest.artifacts.push({ path: event.path, label: event.label, kind: event.kind });
                    if (event.type === 'assistant_delta')
                        runContext?.onActivity({ phase: 'model' });
                } };
            await runner(input);
            combined.throwIfAborted();
            history.push({ role: 'user', content: prompt }, { role: 'assistant', content: manifest.summary });
            await registry.drain();
            await waitDescendants(agentId);
            combined.throwIfAborted();
            await options.port.submitManifest(context, manifest);
            return manifest.summary;
        }
        finally {
            await registry.drain();
            await waitDescendants(agentId);
            registry.dispose();
            await options.port.release(context, { executorInstanceId: context.executorInstanceId, kind: 'resources-disposed', verified: true });
            released = true;
            if (released && agentId !== 'main')
                contexts.delete(agentId);
        }
    }
    try {
        return { text: await turn(root, 'main', options.prompt, signal, []) };
    }
    finally {
        signal.removeEventListener('abort', onAbort);
        await coordinator.dispose();
    }
}
