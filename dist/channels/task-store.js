import { InMemoryTaskStore as SharedInMemoryTaskStore } from '../runtime/tasking/store.js';
export class InMemoryTaskStore extends SharedInMemoryTaskStore {
    constructor() {
        super((taskId, now, input) => ({
            taskId,
            sessionId: input.sessionId,
            channel: 'yzj',
            status: 'queued',
            prompt: input.prompt,
            replyTarget: input.replyTarget,
            createdAt: now,
            updatedAt: now,
            cwd: input.cwd,
            repoRoot: input.repoRoot,
            branch: input.branch,
        }));
    }
}
