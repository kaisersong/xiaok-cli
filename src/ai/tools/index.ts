import type { Tool, ToolDefinition, ToolExecutionContext } from '../../types.js';
import { PermissionManager } from '../permissions/manager.js';
import type { HooksRunner } from '../../runtime/hooks-runner.js';
import { formatErrorText } from '../../utils/ui.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import { validateToolInput } from './validate-input.js';
import { createReadTool, type WorkspaceToolOptions } from './read.js';
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
import {
  buildCapabilityToolDefinition,
  buildToolSearchEntry,
  dedupeToolSearchEntries,
  getCanonicalToolId,
  selectToolEntries,
  type ToolSearchEntry,
} from './tool-identity.js';

export function buildToolList(
  skillTool?: Tool,
  workspace?: WorkspaceToolOptions,
  extraTools: Tool[] = [],
): Tool[] {
  const tools: Tool[] = [
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
  if (skillTool) tools.push(skillTool);
  return tools;
}

export interface RegistryOptions {
  capabilityRegistry?: CapabilityRegistry;
  permissionManager?: PermissionManager;
  autoMode?: boolean;
  dryRun?: boolean;
  onPrompt?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  hooksRunner?: HooksRunner;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private deferredTools = new Map<string, ToolDefinition>();
  private canonicalToolNames = new Map<string, string>();
  private permissionManager: PermissionManager;
  private options: Required<Pick<RegistryOptions, 'dryRun' | 'onPrompt'>> & RegistryOptions;
  private allowedToolsFilter: Set<string> | null = null;

  setAllowedTools(names: string[] | null): void {
    this.allowedToolsFilter = names ? new Set(names.map((name) => getCanonicalToolId(name))) : null;
  }

  constructor(options: RegistryOptions, tools?: Tool[]) {
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

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
    this.canonicalToolNames.set(getCanonicalToolId(tool.definition.name), tool.definition.name);
    this.options.capabilityRegistry?.register({
      kind: 'tool',
      name: tool.definition.name,
      description: tool.definition.description,
      inputSchema: tool.definition.inputSchema,
      execute: async (input) => tool.execute(input),
    });
  }

  registerDeferredTool(definition: ToolDefinition): void {
    this.deferredTools.set(definition.name, definition);
    this.options.capabilityRegistry?.register({
      kind: 'tool',
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    });
  }

  registerDeferredTools(definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      this.registerDeferredTool(definition);
    }
  }

  searchDeferredTools(query: string): ToolDefinition[] {
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
      return (
        tool.name.toLowerCase().includes(normalizedQuery) ||
        tool.description.toLowerCase().includes(normalizedQuery)
      );
    }));
  }

  searchTools(query: string): ToolDefinition[] {
    const activeTools = this.getToolDefinitions();
    const activeEntries = activeTools.map((tool) => buildToolSearchEntry(tool));
    const deferredEntries = [...this.deferredTools.values()].map((tool) => buildToolSearchEntry(tool));
    const capabilityEntries = (this.options.capabilityRegistry?.search(query.startsWith('select:') ? '' : query) ?? [])
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
        return (
          tool.name.toLowerCase().includes(normalizedQuery) ||
          tool.description.toLowerCase().includes(normalizedQuery)
        );
      })
      : activeEntries;

    const deferredMatches = normalizedQuery
      ? deferredEntries.filter((entry) => {
        const tool = entry.definition;
        return (
          tool.name.toLowerCase().includes(normalizedQuery) ||
          tool.description.toLowerCase().includes(normalizedQuery)
        );
      })
      : deferredEntries;

    return dedupeToolSearchEntries([...matches, ...deferredMatches, ...capabilityEntries]);
  }

  async executeTool(
    name: string,
    rawInput: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> {
    let input = rawInput;
    const canonicalToolId = getCanonicalToolId(name);
    if (this.allowedToolsFilter !== null && !this.allowedToolsFilter.has(canonicalToolId)) {
      return `Error: tool "${name}" is not allowed in current skill context`;
    }

    const registeredName = this.canonicalToolNames.get(canonicalToolId) ?? name;
    const tool = this.tools.get(registeredName);
    if (!tool) return `Error: 未知工具: ${name}`;

    const validation = validateToolInput(tool.definition.inputSchema, input);
    if (!validation.valid) {
      return `Error: 输入校验失败: ${validation.errors.join('; ')}`;
    }

    if (this.options.dryRun) {
      return `[dry-run] ${name}(${JSON.stringify(input)})`;
    }

    const decision = await this.permissionManager.check(tool.definition.name, input);
    if (decision === 'deny') {
      await this.options.hooksRunner?.runHooks('PermissionDenied', {
        tool_name: tool.definition.name,
        input,
        reason: 'policy_denied',
      });
      return `Error: 权限不足: ${name}`;
    }

    if (decision === 'prompt' && tool.permission !== 'safe') {
      const permissionRequest = await this.options.hooksRunner?.runHooks('PermissionRequest', {
        tool_name: tool.definition.name,
        input,
      });
      if (permissionRequest?.decision === 'deny' || permissionRequest?.ok === false) {
        await this.options.hooksRunner?.runHooks('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: permissionRequest?.message ?? 'denied_by_permission_hook',
        });
        return `Error: ${permissionRequest?.message ?? `权限不足: ${name}`}`;
      }
      const approved = permissionRequest?.decision === 'allow'
        ? true
        : await this.options.onPrompt(tool.definition.name, input);
      if (!approved) {
        await this.options.hooksRunner?.runHooks('PermissionDenied', {
          tool_name: tool.definition.name,
          input,
          reason: 'prompt_declined',
        });
        return `（已取消: ${name}）`;
      }
    }

    const preHookResult = await this.options.hooksRunner?.runPreHooks(tool.definition.name, input);
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

      const warnings = await this.options.hooksRunner?.runPostHooks(tool.definition.name, input) ?? [];
      if (warnings.length === 0) {
        return result;
      }
      return `${result}\nWarning: ${warnings.join('\nWarning: ')}`;
    } catch (e) {
      return `Error: ${formatErrorText(String(e))}`;
    }
  }

  /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
  enableAutoMode(): void {
    this.permissionManager.setMode('auto');
  }
}
