import type { DevAppIdentity } from '../../auth/identity.js';
import type { ToolDefinition } from '../../types.js';
import type { PromptSegment } from './types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { SkillMeta } from '../skills/loader.js';
import type { LoadedContext } from '../runtime/context-loader.js';
import type { MemoryRecord } from '../memory/store.js';
export interface AssemblerOptions {
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
    mcpInstructions?: string;
    memories?: MemoryRecord[];
    currentTokenUsage?: number;
    contextLimit?: number;
    allowedToolsActive?: string[];
    permissionMode?: 'default' | 'auto' | 'plan';
    toolCount?: number;
    lastAssistantMessage?: string;
    lastUserMessage?: string;
}
export interface AssembledPrompt {
    staticText: string;
    dynamicText: string;
    rendered: string;
    segments: PromptSegment[];
}
/**
 * Assemble the system prompt from static sections (cacheable) and dynamic
 * sections (per-turn). Mirrors Claude Code's 7-layer static prefix +
 * dynamic suffix architecture.
 */
export declare function assembleSystemPrompt(opts: AssemblerOptions): Promise<AssembledPrompt>;
