import { type MemoryStore } from '../memory/store.js';
import { type AssemblerOptions } from './assembler.js';
import type { PromptSnapshot } from './types.js';
import type { HarnessMemoryRecord, HarnessMemoryScope } from '../../runtime/harness-memory/types.js';
export interface PromptBuilderInput extends AssemblerOptions {
    channel: 'chat' | 'yzj';
}
export interface HarnessMemoryReadable {
    listActive(scope: HarnessMemoryScope): HarnessMemoryRecord[];
}
export declare class PromptBuilder {
    private readonly deps;
    constructor(deps?: {
        memoryStore?: MemoryStore;
        harnessMemoryStore?: HarnessMemoryReadable;
    });
    build(input: PromptBuilderInput): Promise<PromptSnapshot>;
}
