import type { Tool, ToolDefinition } from '../../types.js';
import { PermissionManager } from '../permissions/manager.js';
import { createReadTool, type WorkspaceToolOptions } from './read.js';
import { createWriteTool } from './write.js';
import { createEditTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { createToolSearchTool } from './search.js';

export function buildToolList(skillTool?: Tool, workspace?: WorkspaceToolOptions): Tool[] {
  const tools: Tool[] = [
    createReadTool(workspace),
    createWriteTool(workspace),
    createEditTool(workspace),
    bashTool,
    grepTool,
    globTool,
  ];
  if (skillTool) tools.push(skillTool);
  return tools;
}

export interface RegistryOptions {
  permissionManager?: PermissionManager;
  autoMode?: boolean;
  dryRun?: boolean;
  onPrompt?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private deferredTools = new Map<string, ToolDefinition>();
  private permissionManager: PermissionManager;
  private options: Required<Pick<RegistryOptions, 'dryRun' | 'onPrompt'>> & RegistryOptions;

  constructor(options: RegistryOptions, tools?: Tool[]) {
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

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerDeferredTool(definition: ToolDefinition): void {
    this.deferredTools.set(definition.name, definition);
  }

  registerDeferredTools(definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      this.registerDeferredTool(definition);
    }
  }

  searchDeferredTools(query: string): ToolDefinition[] {
    if (query.startsWith('select:')) {
      const names = query
        .slice('select:'.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      return names
        .map((name) => this.deferredTools.get(name))
        .filter((tool): tool is ToolDefinition => Boolean(tool));
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [...this.deferredTools.values()];
    }

    return [...this.deferredTools.values()].filter((tool) => {
      return (
        tool.name.toLowerCase().includes(normalizedQuery) ||
        tool.description.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: 未知工具: ${name}`;

    if (this.options.dryRun) {
      return `[dry-run] ${name}(${JSON.stringify(input)})`;
    }

    const decision = await this.permissionManager.check(name, input);
    if (decision === 'deny') {
      return `Error: 权限不足: ${name}`;
    }

    if (decision === 'prompt') {
      const approved = await this.options.onPrompt(name, input);
      if (!approved) return `（已取消: ${name}）`;
    }

    try {
      return await tool.execute(input);
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  }

  /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
  enableAutoMode(): void {
    this.permissionManager.setMode('auto');
  }
}
