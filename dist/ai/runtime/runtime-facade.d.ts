import type { Agent } from '../agent.js';
import type { MessageBlock, StreamChunk } from '../../types.js';
import type { PromptBuilder, PromptBuilderInput } from '../prompts/builder.js';
export interface RuntimeTurnRequest {
    sessionId: string;
    cwd: string;
    source: 'chat' | 'yzj';
    input: string | MessageBlock[];
}
export interface SkillEntry {
    name: string;
    listing: string;
}
export interface RuntimeFacadeOptions {
    promptBuilder: Pick<PromptBuilder, 'build'>;
    getPromptInput(cwd: string): Promise<Omit<PromptBuilderInput, 'cwd' | 'channel'>>;
    agent: Pick<Agent, 'getSessionState' | 'setPromptSnapshot' | 'setSystemPrompt' | 'runTurn'>;
    getSkillEntries?(): SkillEntry[];
}
export declare class RuntimeFacade {
    private readonly options;
    private readonly sentSkillNames;
    constructor(options: RuntimeFacadeOptions);
    runTurn(request: RuntimeTurnRequest, onChunk: (chunk: StreamChunk) => void, signal?: AbortSignal): Promise<void>;
    /** Reset deduplication state (e.g. after skill install/uninstall). */
    resetSkillTracking(): void;
    private buildInput;
}
