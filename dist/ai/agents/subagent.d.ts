export interface SubAgentInput {
    prompt: string;
    allowedTools?: string[];
    model?: string;
    maxIterations?: number;
}
export declare function executeSubAgent(input: SubAgentInput): Promise<string>;
