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

    const allSections = await renderPromptSections(input);

    // First section is static role definition (no cwd/enterprise).
    // Remaining sections contain dynamic info (cwd, enterprise, autoContext, etc.).
    const [firstSection, ...restSections] = allSections;
    const staticText = firstSection ?? '';
    const dynamicText = restSections.filter(Boolean).join('\n\n');

    const memoryText = memories.length > 0
      ? memories.map((record) => `- ${record.title}: ${record.summary}`).join('\n')
      : '';

    const segments: PromptSegment[] = [
      {
        key: 'static_identity',
        title: 'Static Identity',
        text: staticText,
        cacheable: true,
      },
    ];

    if (dynamicText) {
      segments.push({
        key: 'dynamic_context',
        title: 'Dynamic Context',
        text: dynamicText,
        cacheable: false,
      });
    }

    if (memoryText) {
      segments.push({
        key: 'memory_summary',
        title: 'Memory Summary',
        text: memoryText,
        cacheable: false,
      });
    }

    const rendered = [staticText, dynamicText, memoryText].filter(Boolean).join('\n\n');

    return {
      id: `prompt_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      cwd: input.cwd,
      channel: input.channel,
      rendered,
      segments,
      memoryRefs: memories.map((record) => record.id),
    };
  }
}
