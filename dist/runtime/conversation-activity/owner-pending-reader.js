import { parentPort, workerData } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
/** Runs only in the bounded retirement reader worker; never acquires a writer. */
async function read() {
    const file = join(workerData.dataRoot, ACTIVITY_STORAGE_NAMES.database);
    let store;
    let result = 'unknown';
    try {
        if (!existsSync(file))
            return 'unknown';
        const hadWal = existsSync(`${file}-wal`);
        const { ConversationActivityStore } = await import('./store.js');
        store = new ConversationActivityStore(file, { readOnly: true });
        result = store.listWatches().some(watch => watch.status === 'active'
            && !['completed', 'failed', 'cancelled'].includes(store.getProjection(watch.watchId)?.executionState ?? '')) ? 'pending' : 'none';
        // An immutable offline read must not miss a writer that appeared meanwhile.
        if (!hadWal && existsSync(`${file}-wal`))
            result = 'unknown';
    }
    catch {
        result = 'unknown';
    }
    finally {
        try {
            store?.close();
        }
        catch {
            result = 'unknown';
        }
    }
    return result;
}
void read().then(result => parentPort?.postMessage(result));
