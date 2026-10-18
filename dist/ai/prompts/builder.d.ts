import { type MemoryStore } from '../memory/store.js';
import { type AssemblerOptions, type LegacyAssemblerInput } from './assembler.js';
import type { PromptSnapshot } from './types.js';
import type { HarnessMemoryRecord, HarnessMemoryScope } from '../../runtime/harness-memory/types.js';
export interface PromptBuilderInput extends AssemblerOptions {
    channel: 'chat' | 'yzj';
}
export interface LegacyPromptBuilderInput extends LegacyAssemblerInput {
    channel: 'chat' | 'yzj';
}
export interface HarnessMemoryReadable {
    listActive(scope: HarnessMemoryScope): HarnessMemoryRecord[];
}
export type PromptMemoryReadable = Pick<MemoryStore, 'listRelevant' | 'search'> & Partial<Omit<MemoryStore, 'listRelevant' | 'search'>>;
export declare class PromptBuilder {
    private readonly deps;
    constructor(deps?: {
        memoryStore?: PromptMemoryReadable;
        harnessMemoryStore?: HarnessMemoryReadable;
    });
    build(input: PromptBuilderInput | LegacyPromptBuilderInput): Promise<PromptSnapshot>;
}
