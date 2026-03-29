import type { Tool, ToolDefinition } from '../../types.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';

const BASE_TOOLS: Tool[] = [readTool, writeTool, editTool, bashTool, grepTool, globTool];

export function buildToolList(skillTool?: Tool): Tool[] {
  const tools: Tool[] = [...BASE_TOOLS];
  if (skillTool) tools.push(skillTool);
  return tools;
}

export interface RegistryOptions {
  autoMode: boolean;
  dryRun: boolean;
  onPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

export class ToolRegistry {
  private tools: Tool[];
  private options: RegistryOptions;

  constructor(options: RegistryOptions, tools?: Tool[]) {
    this.options = options;
    this.tools = tools ?? buildToolList();
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.tools.map(t => t.definition);
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.find(t => t.definition.name === name);
    if (!tool) return `Error: 未知工具: ${name}`;

    if (this.options.dryRun) {
      return `[dry-run] ${name}(${JSON.stringify(input)})`;
    }

    const needsConfirm = !this.options.autoMode && tool.permission !== 'safe';
    if (needsConfirm) {
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
    this.options.autoMode = true;
  }
}
