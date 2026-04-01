import { FileMemoryStore } from '../memory/store.js';
import { renderPromptSections, } from '../context/yzj-context.js';
export class PromptBuilder {
    deps;
    constructor(deps = {}) {
        this.deps = deps;
    }
    async build(input) {
        const memoryStore = this.deps.memoryStore ?? new FileMemoryStore();
        const memories = await memoryStore.listRelevant({
            cwd: input.cwd,
            query: input.cwd,
        });
        const promptSections = await renderPromptSections(input);
        const memoryText = memories.length > 0
            ? memories.map((record) => `- ${record.title}: ${record.summary}`).join('\n')
            : '';
        const segments = [
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
