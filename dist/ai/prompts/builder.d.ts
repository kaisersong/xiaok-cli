import { type MemoryStore } from '../memory/store.js';
import { type AssemblerOptions } from './assembler.js';
import type { PromptSnapshot } from './types.js';
export interface PromptBuilderInput extends AssemblerOptions {
    channel: 'chat' | 'yzj';
}
export declare class PromptBuilder {
    private readonly deps;
    constructor(deps?: {
        memoryStore?: MemoryStore;
    });
    build(input: PromptBuilderInput): Promise<PromptSnapshot>;
}
