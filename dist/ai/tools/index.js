import { PermissionManager } from '../permissions/manager.js';
import { formatErrorText } from '../../utils/ui.js';
import { isAbortError } from '../runtime/abort-utils.js';
import { validateToolInput } from './validate-input.js';
import { evaluateProtectedOutputGuard } from '../../runtime/guards/protected-output-guard.js';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { bashTool } from './bash.js';
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
import { buildCapabilityToolDefinition, buildToolSearchEntry, dedupeToolSearchEntries, getCanonicalToolId, selectToolEntries, } from './tool-identity.js';
export function buildToolList(skillTool, workspace, extraTools = []) {
    const tools = [
        createReadTool(workspace),
        createWriteTool(workspace),
        createEditTool(workspace),
        bashTool,
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
    if (skillTool) {
        tools.push(skillTool, ...(skillTool.companionTools ?? []));
    }
    return tools;
}
export class ToolRegistry {
    tools = new Map();
    deferredTools = new Map();
    canonicalToolNames = new Map();
    permissionManager;
    options;
    allowedToolsFilter = null;
    disposed = false;
    setAllowedTools(names) {
        this.allowedToolsFilter = names ? new Set(names.map((name) => getCanonicalToolId(name))) : null;
    }
    constructor(options, tools) {
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
        for (const tool of tools ?? buildToolList()) {
            this.registerTool(tool);
        }
        this.registerTool(createToolSearchTool(this));
    }
    getToolDefinitions() {
        return [...this.tools.values()].map((tool) => tool.definition);
    }
    registerTool(tool) {
        if (this.disposed)
            throw new Error('tool registry is disposed');
        this.tools.set(tool.definition.name, tool);
        this.canonicalToolNames.set(getCanonicalToolId(tool.definition.name), tool.definition.name);
        this.options.capabilityRegistry?.register({
            kind: 'tool',
            name: tool.definition.name,
            description: tool.definition.description,
            inputSchema: tool.definition.inputSchema,
            execute: async (input) => this.executeTool(tool.definition.name, input),
        }, this);
        for (const companion of tool.companionTools ?? []) {
            if (!this.tools.has(companion.definition.name)) {
                this.registerTool(companion);
            }
        }
    }
    registerDeferredTool(definition) {
        if (this.disposed)
            throw new Error('tool registry is disposed');
        this.deferredTools.set(definition.name, definition);
        this.options.capabilityRegistry?.register({
            kind: 'tool',
            name: definition.name,
            description: definition.description,
            inputSchema: definition.inputSchema,
        }, this);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.options.capabilityRegistry?.unregisterOwner(this);
        this.tools.clear();
        this.deferredTools.clear();
        this.canonicalToolNames.clear();
        this.allowedToolsFilter = null;
    }
    getRegisteredTool(name) {
        return this.tools.get(name);
    }
    unregisterTool(name, expected) {
        if (expected && this.tools.get(name) !== expected)
            return;
        this.tools.delete(name);
        this.deferredTools.delete(name);
        this.options.capabilityRegistry?.unregister(name, this);
        const canonical = getCanonicalToolId(name);
        if (this.canonicalToolNames.get(canonical) === name) {
            this.canonicalToolNames.delete(canonical);
            for (const candidate of this.tools.keys()) {
                if (getCanonicalToolId(candidate) === canonical)
                    this.canonicalToolNames.set(canonical, candidate);
            }
        }
    }
    registerDeferredTools(definitions) {
        for (const definition of definitions) {
            this.registerDeferredTool(definition);
        }
    }
    searchDeferredTools(query) {
        const deferredEntries = [...this.deferredTools.values()].map((tool) => buildToolSearchEntry(tool));
        if (query.startsWith('select:')) {
            const names = query
                .slice('select:'.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            return selectToolEntries(deferredEntries, names);
        }
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return dedupeToolSearchEntries(deferredEntries);
        }
        return dedupeToolSearchEntries(deferredEntries.filter((entry) => {
            const tool = entry.definition;
            return (tool.name.toLowerCase().includes(normalizedQuery) ||
                tool.description.toLowerCase().includes(normalizedQuery));
        }));
    }
    searchTools(query) {
        if (this.disposed)
            return [];
        const activeTools = this.getToolDefinitions();
        const activeEntries = activeTools.map((tool) => buildToolSearchEntry(tool));
        const deferredEntries = [...this.deferredTools.values()].map((tool) => buildToolSearchEntry(tool));
        const capabilityEntries = (this.options.capabilitySearch === false ? []
            : this.options.capabilityRegistry?.search(query.startsWith('select:') ? '' : query) ?? [])
            .map((capability) => buildToolSearchEntry(buildCapabilityToolDefinition(capability)));
        if (query.startsWith('select:')) {
            const names = query
                .slice('select:'.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            return selectToolEntries([...activeEntries, ...deferredEntries, ...capabilityEntries], names);
        }
        const normalizedQuery = query.trim().toLowerCase();
        const matches = normalizedQuery
            ? activeEntries.filter((entry) => {
                const tool = entry.definition;
                return (tool.name.toLowerCase().includes(normalizedQuery) ||
                    tool.description.toLowerCase().includes(normalizedQuery));
            })
            : activeEntries;
        const deferredMatches = normalizedQuery
            ? deferredEntries.filter((entry) => {
                const tool = entry.definition;
                return (tool.name.toLowerCase().includes(normalizedQuery) ||
                    tool.description.toLowerCase().includes(normalizedQuery));
            })
            : deferredEntries;
        return dedupeToolSearchEntries([...matches, ...deferredMatches, ...capabilityEntries]);
    }
    async executeTool(name, rawInput, context) {
        try {
            const result = await this.executeRegisteredTool(name, rawInput, context);
            context?.signal?.throwIfAborted();
            return result;
        }
        catch (error) {
            // Includes rejecting policy/approval/preflight dependencies, which are
            // deliberately outside ordinary tool-failure normalization below.
            context?.signal?.throwIfAborted();
            throw error;
        }
    }
    async executeRegisteredTool(name, rawInput, context) {
        context?.signal?.throwIfAborted();
        if (this.disposed)
            return 'Error: tool registry is disposed';
        let input = rawInput;
        let permissionGrant;
        const canonicalToolId = getCanonicalToolId(name);
        if (this.allowedToolsFilter !== null && !this.allowedToolsFilter.has(canonicalToolId)) {
            return `Error: tool "${name}" is not allowed in current skill context`;
        }
        const registeredName = this.canonicalToolNames.get(canonicalToolId) ?? name;
        const tool = this.tools.get(registeredName);
        if (!tool)
            return `Error: 未知工具: ${name}`;
        const validation = validateToolInput(tool.definition.inputSchema, input);
        if (!validation.valid) {
            return `Error: 输入校验失败: ${validation.errors.join('; ')}`;
        }
        if (this.options.dryRun) {
            return `[dry-run] ${name}(${JSON.stringify(input)})`;
        }
        const decision = await this.permissionManager.check(tool.definition.name, input);
        context?.signal?.throwIfAborted();
        if (decision === 'deny') {
            await this.options.hooksRunner?.runHooks('PermissionDenied', {
                tool_name: tool.definition.name,
                input,
                reason: 'policy_denied',
            });
            context?.signal?.throwIfAborted();
            return `Error: 权限不足: ${name}`;
        }
        if (decision === 'prompt' && tool.permission !== 'safe') {
            const permissionRequest = await this.options.hooksRunner?.runHooks('PermissionRequest', {
                tool_name: tool.definition.name,
                input,
            });
            context?.signal?.throwIfAborted();
            if (permissionRequest?.decision === 'deny' || permissionRequest?.ok === false) {
                await this.options.hooksRunner?.runHooks('PermissionDenied', {
                    tool_name: tool.definition.name,
                    input,
                    reason: permissionRequest?.message ?? 'denied_by_permission_hook',
                });
                context?.signal?.throwIfAborted();
                return `Error: ${permissionRequest?.message ?? `权限不足: ${name}`}`;
            }
            const approved = permissionRequest?.decision === 'allow'
                ? true
                : await this.options.onPrompt(tool.definition.name, input, { tool, context });
            context?.signal?.throwIfAborted();
            if (isToolPermissionGrant(approved))
                permissionGrant = approved;
            if (approved !== true && !permissionGrant) {
                await this.options.hooksRunner?.runHooks('PermissionDenied', {
                    tool_name: tool.definition.name,
                    input,
                    reason: 'prompt_declined',
                });
                context?.signal?.throwIfAborted();
                return `${TOOL_CANCELLED_PREFIX}${name}）`;
            }
        }
        const preHookResult = await this.options.hooksRunner?.runPreHooks(tool.definition.name, input);
        context?.signal?.throwIfAborted();
        if (preHookResult && !preHookResult.ok) {
            return `Error: ${preHookResult.message ?? `${name} blocked by pre hook`}`;
        }
        // Apply hook-provided input overrides
        if (preHookResult?.updatedInput) {
            input = { ...input, ...preHookResult.updatedInput };
        }
        if (preHookResult?.preventContinuation) {
            const message = preHookResult.additionalContext
                ?? preHookResult.message
                ?? `[${name} handled by pre hook]`;
            return `${message}\n[agent loop should stop after this tool]`;
        }
        const protectedOutputDecision = await this.evaluateProtectedOutputGuard(tool.definition.name, input);
        context?.signal?.throwIfAborted();
        if (protectedOutputDecision && !protectedOutputDecision.ok) {
            return `Error: ${protectedOutputDecision.reason}\n${protectedOutputDecision.action}`;
        }
        // Approval/hooks may finish after a caller interrupt or an agent deadline.
        // Keep cancellation outside failure normalization, and do not start a new operation.
        context?.signal?.throwIfAborted();
        if (this.disposed)
            return 'Error: tool registry is disposed';
        try {
            if (this.tools.get(registeredName) !== tool)
                return `Error: tool ${name} is no longer registered`;
            let invocationContext = context;
            if (permissionGrant) {
                if (!context)
                    throw new Error('approval_context_unavailable');
                const prepared = permissionGrant.prepareInput(input);
                assertSynchronousGrantResult(prepared);
                if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)
                    || ![Object.prototype, null].includes(Object.getPrototypeOf(prepared)))
                    throw new Error('approval_grant_invalid');
                input = prepared;
                const grant = permissionGrant;
                const assertPermissionApproval = () => assertSynchronousGrantResult(grant.assertCurrent());
                assertPermissionApproval();
                invocationContext = { ...context, assertPermissionApproval };
            }
            const rawResult = await tool.execute(input, invocationContext);
            context?.signal?.throwIfAborted();
            // Append hook-provided additional context
            let result = rawResult;
            if (preHookResult?.additionalContext) {
                result = `${result}\n${preHookResult.additionalContext}`;
            }
            const observedOutput = sanitizeToolOutput(rawResult, { cap: false });
            const observedResult = appendToolWarnings(observedOutput.text, observedOutput.warnings);
            await this.options.onToolObserved?.({
                phase: 'after',
                agentId: this.options.agentId ?? 'main',
                toolName: tool.definition.name,
                input,
                result: observedResult,
                ok: isSuccessfulToolResult(observedResult),
            });
            context?.signal?.throwIfAborted();
            const warnings = await this.options.hooksRunner?.runPostHooks(tool.definition.name, input) ?? [];
            context?.signal?.throwIfAborted();
            const modelOutput = sanitizeToolOutput(result);
            return appendToolWarnings(modelOutput.text, [...modelOutput.warnings, ...warnings]);
        }
        catch (e) {
            context?.signal?.throwIfAborted();
            if (isAbortError(e))
                throw e;
            const errorMessage = formatErrorText(String(e));
            await this.options.hooksRunner?.runHooks('PostToolUseFailure', {
                tool_name: tool.definition.name,
                tool_input: input,
                error: errorMessage,
            });
            context?.signal?.throwIfAborted();
            return `Error: ${errorMessage}`;
        }
    }
    async evaluateProtectedOutputGuard(toolName, input) {
        const guard = this.options.protectedOutputGuard;
        if (!guard)
            return null;
        const targetPath = resolveWriteTargetPath(toolName, input);
        if (!targetPath)
            return null;
        const decision = evaluateProtectedOutputGuard({
            operation: 'overwrite',
            targetPath,
            protectedArtifacts: guard.getProtectedArtifacts(),
        });
        await guard.onDecision?.(decision);
        return decision;
    }
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode() {
        this.permissionManager.setMode('auto');
    }
}
/** Runtime shape check: literal true plus both grant methods are required;
 * synchronous returns are checked when consumed. Objects are never truthy allow. */
export function isToolPermissionGrant(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const grant = value;
    return grant.approved === true && typeof grant.prepareInput === 'function' && typeof grant.assertCurrent === 'function';
}
function assertSynchronousGrantResult(value) {
    if (value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function') {
        // Reject async guards without allowing their rejected Promise to escape as
        // an unhandled rejection. This is not an approval wait or a second attempt.
        void Promise.resolve(value).catch(() => undefined);
        throw new Error('approval_grant_invalid');
    }
}
function isSuccessfulToolResult(result) {
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
export function isSuccessfulModelToolResult(result) {
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
function isDomainLevelFailurePayload(normalized) {
    if (!normalized.startsWith('{')) {
        return false;
    }
    let parsed;
    try {
        parsed = JSON.parse(normalized);
    }
    catch {
        return false;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return false;
    }
    const payload = parsed;
    return payload.ok === false || payload.success === false;
}
function appendToolWarnings(result, warnings) {
    const uniqueWarnings = [...new Set(warnings)];
    if (uniqueWarnings.length === 0) {
        return result;
    }
    return `${result}\nWarning: ${uniqueWarnings.join('\nWarning: ')}`;
}
function resolveWriteTargetPath(toolName, input) {
    const normalized = toolName.toLowerCase();
    if (normalized !== 'write' && normalized !== 'edit') {
        return null;
    }
    return typeof input.file_path === 'string' && input.file_path.trim()
        ? input.file_path
        : null;
}
