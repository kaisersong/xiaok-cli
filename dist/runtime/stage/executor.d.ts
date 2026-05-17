/**
 * Stage executor — analyzes intent, checks context, triggers subagents.
 *
 * Core flow:
 * 1. Analyze user intent → list of stages (reuses IntentPlanner)
 * 2. For each stage: check context → subagent if tight, inline if sufficient
 * 3. Subagent gets forkContext: undefined for clean context
 * 4. Collect debug events with timing for each phase
 */
import type { SkillMeta } from '../../ai/skills/loader.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import type { ModelAdapter } from '../../types.js';
import type { StageDef, StageOutput } from './types.js';
export interface StageExecutorDeps {
    adapter: () => ModelAdapter;
    createRegistry: (cwd: string, allowedTools?: string[], agentId?: string) => ToolRegistry;
    buildSystemPrompt: (cwd: string) => Promise<string>;
    skills: SkillMeta[];
    sessionId: string;
    cwd: string;
    contextLimit: number;
    currentTokens: number;
}
export declare function executeStagedSkill(userInput: string, deps: StageExecutorDeps): Promise<StageOutput>;
export declare function shouldUseSubagent(currentTokens: number, maxTokens: number, skillContentSize: number, skillRefsSize: number): boolean;
/**
 * Analyze user intent to determine stages.
 * Uses rule-based matching on keywords — fast, no LLM call needed.
 */
export declare function analyzeIntent(userInput: string, skills: SkillMeta[], cwd: string): StageDef[];
export declare function formatDebugOutput(result: StageOutput): string;
export type { StageDef, StageTiming, DebugEvent, StageResult, StageOutput } from "./types.js";
