import type { ModelAdapter } from '../../types.js';
import type { IntentBoundaryConfig, LlmBoundaryDecision } from './boundary-types.js';
export interface LlmBoundaryPromptInput {
    input: string;
    sessionId: string;
    instanceId: string;
    cwd: string;
    providedSourcePaths: string[];
    ruleDecision: {
        kind: 'ambiguous';
        ambiguityType: string;
        reason: string;
    };
}
export interface LlmBoundaryInvoker {
    invoke(prompt: string): Promise<string>;
    timeoutMs: number;
}
export declare function createAdapterBoundaryInvoker(adapter: ModelAdapter, config: IntentBoundaryConfig): LlmBoundaryInvoker;
export declare function classifyBoundaryWithLlm(input: LlmBoundaryPromptInput, invoker: LlmBoundaryInvoker): Promise<LlmBoundaryDecision>;
