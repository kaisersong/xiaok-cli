import { FileMemoryStore } from '../memory/store.js';
import {
  renderPromptSections,
  type ContextOptions,
} from '../context/yzj-context.js';
import type { PromptSegment, PromptSnapshot } from './types.js';

export interface PromptBuilderInput extends ContextOptions {
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
    const promptSections = await renderPromptSections(input);
    const memoryText = memories.length > 0
      ? memories.map((record) => `- ${record.title}: ${record.summary}`).join('\n')
      : '';

    const segments: PromptSegment[] = [
      {
        key: 'core_identity',
        title: 'Core Identity',
        text: promptSections.join('\n\n'),
        cacheable: true,
      },
    ];

    if (memoryText) {
      segments.push({
        key: 'memory_summary',
        title: 'Memory Summary',
        text: memoryText,
        cacheable: false,
      });
    }

    return {
      id: `prompt_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      cwd: input.cwd,
      channel: input.channel,
      rendered: [...promptSections, memoryText].filter(Boolean).join('\n\n'),
      segments,
      memoryRefs: memories.map((record) => record.id),
    };
  }
}
