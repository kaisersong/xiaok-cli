import { PermissionManager } from '../permissions/manager.js';
import { formatErrorText } from '../../utils/ui.js';
import { validateToolInput } from './validate-input.js';
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
        ...extraTools,
    ];
    if (skillTool)
        tools.push(skillTool);
    return tools;
}
export class ToolRegistry {
    tools = new Map();
    deferredTools = new Map();
    permissionManager;
    options;
    allowedToolsFilter = null;
    setAllowedTools(names) {
        this.allowedToolsFilter = names ? new Set(names) : null;
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
        this.tools.set(tool.definition.name, tool);
        this.options.capabilityRegistry?.register({
            kind: 'tool',
            name: tool.definition.name,
            description: tool.definition.description,
            inputSchema: tool.definition.inputSchema,
            execute: async (input) => tool.execute(input),
        });
    }
    registerDeferredTool(definition) {
        this.deferredTools.set(definition.name, definition);
        this.options.capabilityRegistry?.register({
            kind: 'tool',
            name: definition.name,
            description: definition.description,
            inputSchema: definition.inputSchema,
        });
    }
    registerDeferredTools(definitions) {
        for (const definition of definitions) {
            this.registerDeferredTool(definition);
        }
    }
    searchDeferredTools(query) {
        if (query.startsWith('select:')) {
            const names = query
                .slice('select:'.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            return names
                .map((name) => this.deferredTools.get(name))
                .filter((tool) => Boolean(tool));
        }
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return [...this.deferredTools.values()];
        }
        return [...this.deferredTools.values()].filter((tool) => {
            return (tool.name.toLowerCase().includes(normalizedQuery) ||
                tool.description.toLowerCase().includes(normalizedQuery));
        });
    }
    searchTools(query) {
        const activeTools = this.getToolDefinitions();
        if (query.startsWith('select:')) {
            const names = query
                .slice('select:'.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            const activeMap = new Map(activeTools.map((tool) => [tool.name, tool]));
            const deferredMap = new Map(this.searchDeferredTools(query).map((tool) => [tool.name, tool]));
            return names
                .map((name) => activeMap.get(name) ?? deferredMap.get(name))
                .filter((tool) => Boolean(tool));
        }
        const normalizedQuery = query.trim().toLowerCase();
        const matches = normalizedQuery
            ? activeTools.filter((tool) => {
                return (tool.name.toLowerCase().includes(normalizedQuery) ||
                    tool.description.toLowerCase().includes(normalizedQuery));
            })
            : activeTools;
        const merged = new Map(matches.map((tool) => [tool.name, tool]));
        for (const tool of this.searchDeferredTools(query)) {
            if (!merged.has(tool.name)) {
                merged.set(tool.name, tool);
            }
        }
        for (const capability of this.options.capabilityRegistry?.search(query) ?? []) {
            if (!merged.has(capability.name)) {
                merged.set(capability.name, {
                    name: capability.name,
                    description: capability.description,
                    inputSchema: capability.inputSchema ?? { type: 'object', properties: {} },
                });
            }
        }
        return [...merged.values()];
    }
    async executeTool(name, rawInput, context) {
        let input = rawInput;
        if (this.allowedToolsFilter !== null && !this.allowedToolsFilter.has(name)) {
            return `Error: tool "${name}" is not allowed in current skill context`;
        }
        const tool = this.tools.get(name);
        if (!tool)
            return `Error: 未知工具: ${name}`;
        const validation = validateToolInput(tool.definition.inputSchema, input);
        if (!validation.valid) {
            return `Error: 输入校验失败: ${validation.errors.join('; ')}`;
        }
        if (this.options.dryRun) {
            return `[dry-run] ${name}(${JSON.stringify(input)})`;
        }
        const decision = await this.permissionManager.check(name, input);
        if (decision === 'deny') {
            return `Error: 权限不足: ${name}`;
        }
        if (decision === 'prompt' && tool.permission !== 'safe') {
            const approved = await this.options.onPrompt(name, input);
            if (!approved)
                return `（已取消: ${name}）`;
        }
        const preHookResult = await this.options.hooksRunner?.runPreHooks(name, input);
        if (preHookResult && !preHookResult.ok) {
            return `Error: ${preHookResult.message ?? `${name} blocked by pre hook`}`;
        }
        // Apply hook-provided input overrides
        if (preHookResult?.updatedInput) {
            input = { ...input, ...preHookResult.updatedInput };
        }
        try {
            let result = await tool.execute(input, context);
            // Append hook-provided additional context
            if (preHookResult?.additionalContext) {
                result = `${result}\n${preHookResult.additionalContext}`;
            }
            if (preHookResult?.preventContinuation) {
                result = `${result}\n[agent loop should stop after this tool]`;
            }
            const warnings = await this.options.hooksRunner?.runPostHooks(name, input) ?? [];
            if (warnings.length === 0) {
                return result;
            }
            return `${result}\nWarning: ${warnings.join('\nWarning: ')}`;
        }
        catch (e) {
            return `Error: ${formatErrorText(String(e))}`;
        }
    }
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode() {
        this.permissionManager.setMode('auto');
    }
}
