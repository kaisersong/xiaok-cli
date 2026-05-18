import { FileMemoryStore } from '../memory/store.js';
import { assembleSystemPrompt } from './assembler.js';
import { join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
import { JsonHarnessMemoryStore } from '../../runtime/harness-memory/store.js';
export class PromptBuilder {
    deps;
    constructor(deps = {}) {
        this.deps = deps;
    }
    async build(input) {
        const memoryStore = this.deps.memoryStore ?? new FileMemoryStore();
        const harnessMemoryStore = this.deps.harnessMemoryStore ?? new JsonHarnessMemoryStore(join(getConfigDir(), 'harness-memory.json'));
        const memories = memoryStore.search
            ? await memoryStore.search(input.cwd, 10)
            : await memoryStore.listRelevant({ cwd: input.cwd, query: input.cwd });
        const harnessMemories = harnessMemoryStore.listActive({
            repo: input.cwd,
            runtime: input.channel,
        });
        // Inject memories into assembler options for per-turn memory injection
        const assemblerOpts = {
            ...input,
            memories: memories.length > 0 ? memories.slice(0, 10) : undefined,
            harnessMemories: harnessMemories.length > 0 ? harnessMemories.slice(0, 6) : undefined,
        };
        const assembled = await assembleSystemPrompt(assemblerOpts);
        return {
            id: `prompt_${Date.now().toString(36)}`,
            createdAt: Date.now(),
            cwd: input.cwd,
            channel: input.channel,
            rendered: assembled.rendered,
            segments: assembled.segments,
            memoryRefs: [
                ...memories.map((record) => record.id),
                ...harnessMemories.map((record) => `harness:${record.id}`),
            ],
        };
    }
}
