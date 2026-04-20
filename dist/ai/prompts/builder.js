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
