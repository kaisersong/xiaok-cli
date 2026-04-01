import { FileMemoryStore } from '../memory/store.js';
import { type ContextOptions } from '../context/yzj-context.js';
import type { PromptSnapshot } from './types.js';
export interface PromptBuilderInput extends ContextOptions {
    channel: 'chat' | 'yzj';
}
export declare class PromptBuilder {
    private readonly deps;
    constructor(deps?: {
        memoryStore?: FileMemoryStore;
    });
    build(input: PromptBuilderInput): Promise<PromptSnapshot>;
}
