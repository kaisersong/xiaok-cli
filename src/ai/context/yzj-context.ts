import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
import type { LoadedContext } from '../runtime/context-loader.js';
import { assembleSystemPrompt } from '../prompts/assembler.js';

export interface ContextOptions {
  channel?: 'chat' | 'yzj';
  enterpriseId: string | null;
  devApp: DevAppIdentity | null;
  cwd: string;
  budget: number;
  skills?: SkillMeta[];
  deferredTools?: Array<Pick<ToolDefinition, 'name' | 'description'>>;
  agents?: Array<Pick<CustomAgentDef, 'name' | 'model' | 'allowedTools'>>;
  pluginCommands?: string[];
  lspDiagnostics?: string;
  autoContext?: LoadedContext;
}

/**
 * @deprecated Use assembleSystemPrompt from '../prompts/assembler.js' directly.
 * Kept for backward compatibility with existing callers.
 */
export async function renderPromptSections(opts: ContextOptions): Promise<string[]> {
  const assembled = await assembleSystemPrompt(opts);
  return [assembled.staticText, assembled.dynamicText].filter(Boolean);
}

/**
 * @deprecated Use assembleSystemPrompt from '../prompts/assembler.js' directly.
 */
export async function buildSystemPrompt(opts: ContextOptions): Promise<string> {
  const assembled = await assembleSystemPrompt(opts);
  return assembled.rendered;
}
