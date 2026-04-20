import { FileMemoryStore } from '../memory/store.js';
import { assembleSystemPrompt, type AssemblerOptions } from './assembler.js';
import type { PromptSnapshot } from './types.js';

export interface PromptBuilderInput extends AssemblerOptions {
  channel: 'chat' | 'yzj';
}

export class PromptBuilder {
  constructor(private readonly deps: { memoryStore?: FileMemoryStore } = {}) {}

  async build(input: PromptBuilderInput): Promise<PromptSnapshot> {
    const memoryStore = this.deps.memoryStore ?? new FileMemoryStore();
    const memories = await memoryStore.listRelevant({
      cwd: input.cwd,
      query: input.cwd,
    });

    // Inject memories into assembler options for per-turn memory injection
    const assemblerOpts: AssemblerOptions = {
      ...input,
      memories: memories.length > 0 ? memories.slice(0, 10) : undefined,
    };

    const assembled = await assembleSystemPrompt(assemblerOpts);

    return {
      id: `prompt_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      cwd: input.cwd,
      channel: input.channel,
      rendered: assembled.rendered,
      segments: assembled.segments,
      memoryRefs: memories.map((record) => record.id),
    };
  }
}
