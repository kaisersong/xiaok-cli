import { join } from 'node:path';
import { recoverTaskSnapshotSync } from '../task-host/snapshot-store.js';
/** Final disclosure reads current durable identity, including the journal.
 * Async observer/executor caches cannot certify this later send boundary. */
export function readCurrentActivityTask(dataRoot, watch) {
    try {
        if (watch.source !== 'task_host' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(watch.workId))
            throw new Error();
        const actual = recoverTaskSnapshotSync(join(dataRoot, 'tasks'), watch.workId);
        if (!actual || actual.taskId !== watch.workId || actual.sessionId !== watch.sourceDataEpoch
            || actual.context?.threadId !== (watch.actualExecutionThreadId ?? watch.origin.threadId))
            throw new Error();
        return actual;
    }
    catch {
        throw new Error('activity_source_forbidden');
    }
}
