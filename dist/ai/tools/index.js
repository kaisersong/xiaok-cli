import { PermissionManager } from '../permissions/manager.js';
import { createReadTool } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { createToolSearchTool } from './search.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
export function buildToolList(skillTool, workspace) {
    const tools = [
        createReadTool(workspace),
        createWriteTool(workspace),
        createEditTool(workspace),
        bashTool,
        grepTool,
        globTool,
        webFetchTool,
        webSearchTool,
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
    constructor(options, tools) {
        const mode = options.permissionManager
            ? options.permissionManager.getMode()
            : options.autoMode
                ? 'auto'
                : 'default';
        this.permissionManager = options.permissionManager ?? new PermissionManager({ mode });
        this.options = {
            dryRun: false,
            onPrompt: async () => false,
            ...options,
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
    }
    registerDeferredTool(definition) {
        this.deferredTools.set(definition.name, definition);
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
    async executeTool(name, input) {
        const tool = this.tools.get(name);
        if (!tool)
            return `Error: 未知工具: ${name}`;
        if (this.options.dryRun) {
            return `[dry-run] ${name}(${JSON.stringify(input)})`;
        }
        const decision = await this.permissionManager.check(name, input);
        if (decision === 'deny') {
            return `Error: 权限不足: ${name}`;
        }
        if (decision === 'prompt') {
            const approved = await this.options.onPrompt(name, input);
            if (!approved)
                return `（已取消: ${name}）`;
        }
        try {
            return await tool.execute(input);
        }
        catch (e) {
            return `Error: ${String(e)}`;
        }
    }
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode() {
        this.permissionManager.setMode('auto');
    }
}
