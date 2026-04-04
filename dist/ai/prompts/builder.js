import { FileMemoryStore } from '../memory/store.js';
import { assembleSystemPrompt } from './assembler.js';
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
        // Inject memories into assembler options for per-turn memory injection
        const assemblerOpts = {
            ...input,
            memories: memories.length > 0 ? memories.slice(0, 10) : undefined,
        };
        const assembled = await assembleSystemPrompt(assemblerOpts);
        const memoryText = memories.length > 0
            ? memories.map((record) => `- ${record.title}: ${record.summary}`).join('\n')
            : '';
        const segments = [
            {
                key: 'static_identity',
                title: 'Static Identity',
                text: assembled.staticText,
                cacheable: true,
            },
        ];
        if (assembled.dynamicText) {
            segments.push({
                key: 'dynamic_context',
                title: 'Dynamic Context',
                text: assembled.dynamicText,
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
        return {
            id: `prompt_${Date.now().toString(36)}`,
            createdAt: Date.now(),
            cwd: input.cwd,
            channel: input.channel,
            rendered: assembled.rendered,
            segments,
            memoryRefs: memories.map((record) => record.id),
        };
    }
}
