import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
import type { LoadedContext } from '../runtime/context-loader.js';
export interface ContextOptions {
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
export declare function renderPromptSections(opts: ContextOptions): Promise<string[]>;
/**
 * @deprecated Use assembleSystemPrompt from '../prompts/assembler.js' directly.
 */
export declare function buildSystemPrompt(opts: ContextOptions): Promise<string>;
