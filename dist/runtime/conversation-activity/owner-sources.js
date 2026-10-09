import { createPrivateActivityDirectory } from './storage-permissions.js';
import { join } from 'node:path';
import { watch as watchFiles } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { FileTaskSnapshotStore } from '../task-host/snapshot-store.js';
/** One filesystem hint owner; authoritative facts remain native snapshot files. */
export class ActivityTaskSnapshotReader {
    root;
    generation = 0;
    waiters = new Set();
    watchers;
    constructor(root) {
        this.root = root;
        createPrivateActivityDirectory(root);
        createPrivateActivityDirectory(join(root, 'snapshots'));
        const changed = () => { this.generation++; for (const wake of [...this.waiters])
            wake(); };
        this.watchers = [watchFiles(root, changed), watchFiles(join(root, 'snapshots'), changed)];
        for (const watcher of this.watchers)
            watcher.unref();
    }
    snapshot(taskId) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(taskId))
            return Promise.reject(new Error('invalid_activity_task_id'));
        // The executor's store cache is process-local. Each external read verifies
        // the actual current file, not an old snapshot cached by this observer.
        return new FileTaskSnapshotStore(this.root).recoverTask(taskId);
    }
    host() { return { subscribeTaskRecords: this.records.bind(this) }; }
    async *records(taskId, options = {}) {
        let next = options.sinceIndex ?? 0;
        if (!Number.isSafeInteger(next) || next < 0)
            throw new Error('task_event_cursor_invalid');
        while (!options.signal?.aborted) {
            const generation = this.generation;
            const snapshot = await this.snapshot(taskId);
            if (!snapshot)
                throw new Error('activity_task_snapshot_missing');
            if (next > snapshot.events.length)
                throw new Error('task_event_cursor_gap');
            while (next < snapshot.events.length) {
                options.signal?.throwIfAborted();
                const eventIndex = next++;
                yield { taskId, sourceDataEpoch: snapshot.sessionId, eventIndex, event: snapshot.events[eventIndex] };
            }
            if (snapshot.events.some(event => event.type === 'task_terminal'))
                return;
            if (this.generation !== generation)
                continue;
            await new Promise((resolve, reject) => {
                const cleanup = () => { clearTimeout(timer); this.waiters.delete(wake); options.signal?.removeEventListener('abort', abort); };
                const wake = () => { cleanup(); resolve(); };
                const abort = () => { cleanup(); reject(options.signal?.reason); };
                const timer = setTimeout(wake, 30_000);
                timer.unref();
                this.waiters.add(wake);
                options.signal?.addEventListener('abort', abort, { once: true });
                if (options.signal?.aborted)
                    abort();
                else if (this.generation !== generation)
                    wake();
            });
        }
        options.signal?.throwIfAborted();
    }
    close() { for (const watcher of this.watchers)
        watcher.close(); for (const wake of [...this.waiters])
        wake(); }
}
/** Reads the original native journal. It never claims executor boot ownership. */
export class ActivityNativeGroupReader {
    db;
    constructor(file) { this.db = new DatabaseSync(file, { readOnly: true }); }
    groupThread(groupId) {
        const row = this.db.prepare('SELECT data_json FROM groups WHERE group_id=?').get(groupId);
        return row ? JSON.parse(row.data_json).threadId : null;
    }
    events(groupId, after) {
        return this.db.prepare('SELECT data_json FROM events WHERE group_id=? AND seq>? ORDER BY seq LIMIT 100').all(groupId, after)
            .map(row => JSON.parse(row.data_json));
    }
    members(runId) {
        return this.db.prepare('SELECT data_json FROM activity_members WHERE run_id=? ORDER BY rowid').all(runId).map(row => JSON.parse(row.data_json));
    }
    close() { this.db.close(); }
}
