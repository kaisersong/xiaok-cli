import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { FileSessionReader } from '../../ai/runtime/session-store/file-session-reader.js';
import { readDesktopTaskProtection } from './protected-observation-reader.js';
try {
    const sessions = new FileSessionReader(join(workerData.root, 'protected-observation-sessions'));
    const protection = await readDesktopTaskProtection(workerData.taskId, {
        loadAlias: (taskId) => new FileSessionReader(workerData.canonicalRoot).loadSessionAliasSync({ holderRoot: workerData.root, holderId: taskId }),
        loadSession: (sessionId) => sessions.load(sessionId),
    });
    parentPort?.postMessage({ taskId: workerData.taskId, protection });
}
catch {
    parentPort?.postMessage({ taskId: workerData.taskId, unavailable: true });
}
finally {
    parentPort?.close();
}
