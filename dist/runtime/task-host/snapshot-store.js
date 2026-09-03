import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const CHECKPOINT_META_KEY = '__xiaokJournal';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
/**
 * A legacy-readable checkpoint plus an append-only mutation journal.
 *
 * Running tasks append only the event suffix and changed top-level fields.
 * Terminal transitions materialize the complete historical TaskSnapshot so
 * older readers keep seeing completed tasks without understanding journals.
 */
export class FileTaskSnapshotStore {
    rootDir;
    diagnostics;
    indexWriteQueue = Promise.resolve();
    taskWriteQueues = new Map();
    cache = new Map();
    constructor(rootDir, diagnostics = {}) {
        this.rootDir = rootDir;
        this.diagnostics = diagnostics;
    }
    async save(snapshot, expectedPrevious) {
        const previous = this.taskWriteQueues.get(snapshot.taskId) ?? Promise.resolve();
        const run = previous.catch(() => undefined).then(() => this.saveSerial(snapshot, expectedPrevious));
        const tracked = run.catch(() => undefined);
        this.taskWriteQueues.set(snapshot.taskId, tracked);
        try {
            await run;
        }
        finally {
            if (this.taskWriteQueues.get(snapshot.taskId) === tracked) {
                this.taskWriteQueues.delete(snapshot.taskId);
            }
        }
    }
    async getActiveTasks() {
        const index = await this.loadIndex();
        return index.activeTaskIds.map(taskId => ({ taskId }));
    }
    /** @deprecated Use getActiveTasks() — kept for backward compat */
    async getActiveTask() {
        const tasks = await this.getActiveTasks();
        return tasks[0] ?? null;
    }
    async recoverTask(taskId) {
        const pendingWrite = this.taskWriteQueues.get(taskId);
        if (pendingWrite)
            await pendingWrite;
        const cached = this.cache.get(taskId);
        if (cached)
            return cached.snapshot;
        const loaded = await this.loadSnapshotState(taskId);
        if (!loaded)
            return null;
        this.cache.set(taskId, loaded);
        return loaded.snapshot;
    }
    async clearActiveTask(taskId) {
        await this.updateIndex(index => {
            const ids = new Set(index.activeTaskIds);
            ids.delete(taskId);
            return { activeTaskIds: [...ids] };
        });
    }
    async saveSerial(snapshot, expectedPrevious) {
        await mkdir(this.snapshotDir(), { recursive: true });
        const current = this.cache.get(snapshot.taskId) ?? await this.loadSnapshotState(snapshot.taskId);
        if (!current) {
            await this.writeCheckpoint(snapshot, 0);
            this.cache.set(snapshot.taskId, { snapshot, sequence: 0, checkpointEventCount: snapshot.events.length, sealed: true });
            await this.syncIndexForTransition(undefined, snapshot);
            return;
        }
        assertAppendOnlyEvents(current.snapshot, snapshot, expectedPrevious);
        if (!current.sealed) {
            // A journal must never coexist with an unsealed legacy checkpoint. Seal
            // the exact base aggregate first so an unsupported old-binary rewrite is
            // detected instead of replaying duplicate events.
            await this.writeCheckpoint(current.snapshot, current.sequence);
            current.sealed = true;
        }
        const sequence = current.sequence + 1;
        const payload = buildJournalPayload(current, snapshot, sequence);
        if (payload.events.length === 0 && Object.keys(payload.patch).length === 0 && payload.removed.length === 0) {
            return;
        }
        const record = { ...payload, checksum: checksumJournalPayload(payload) };
        const encodedRecord = `${JSON.stringify(record)}\n`;
        try {
            if (current.journalRepairOffset !== undefined) {
                await truncate(this.journalPath(snapshot.taskId), current.journalRepairOffset);
            }
            await appendFile(this.journalPath(snapshot.taskId), encodedRecord, 'utf8');
        }
        catch (error) {
            // A failed append may still leave a partial frame on disk. Force the next
            // operation to replay and truncate the tail instead of trusting memory.
            this.cache.delete(snapshot.taskId);
            throw error;
        }
        this.diagnostics.onWrite?.('journal', Buffer.byteLength(encodedRecord, 'utf8'));
        this.cache.set(snapshot.taskId, {
            snapshot,
            sequence,
            checkpointEventCount: current.checkpointEventCount,
            sealed: true,
        });
        if (TERMINAL_STATUSES.has(snapshot.status) || shouldWriteInterimCheckpoint(current, snapshot, encodedRecord)) {
            // Checkpoint first, journal cleanup second. If cleanup is interrupted,
            // lastSequence makes replay ignore records already folded into checkpoint.
            await this.writeCheckpoint(snapshot, sequence);
            await unlink(this.journalPath(snapshot.taskId)).catch((error) => {
                if (!isNodeErrorCode(error, 'ENOENT'))
                    throw error;
            });
            this.cache.set(snapshot.taskId, {
                snapshot,
                sequence,
                checkpointEventCount: snapshot.events.length,
                sealed: true,
            });
        }
        await this.syncIndexForTransition(current.snapshot, snapshot);
    }
    async loadSnapshotState(taskId) {
        let raw;
        try {
            raw = await readFile(this.snapshotPath(taskId), 'utf8');
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT'))
                return null;
            throw error;
        }
        const checkpoint = parseCheckpoint(raw);
        let journalRaw;
        try {
            journalRaw = await readFile(this.journalPath(taskId), 'utf8');
        }
        catch (error) {
            if (isNodeErrorCode(error, 'ENOENT'))
                return checkpoint;
            throw error;
        }
        return replayJournal(checkpoint, journalRaw, taskId);
    }
    async writeCheckpoint(snapshot, lastSequence) {
        const target = this.snapshotPath(snapshot.taskId);
        const tmp = this.tempPath(target);
        const checkpoint = {
            ...snapshot,
            [CHECKPOINT_META_KEY]: {
                version: 1,
                lastSequence,
                checkpointEventCount: snapshot.events.length,
            },
        };
        const encoded = JSON.stringify(checkpoint, null, 2);
        await writeFile(tmp, encoded, 'utf8');
        await rename(tmp, target);
        this.diagnostics.onWrite?.('checkpoint', Buffer.byteLength(encoded, 'utf8'));
    }
    async syncIndexForTransition(previous, next) {
        const wasActive = previous ? !TERMINAL_STATUSES.has(previous.status) : undefined;
        const isActive = !TERMINAL_STATUSES.has(next.status);
        if (wasActive === isActive)
            return;
        await this.updateIndex(index => {
            const ids = new Set(index.activeTaskIds);
            if (isActive)
                ids.add(next.taskId);
            else
                ids.delete(next.taskId);
            return { activeTaskIds: [...ids] };
        });
    }
    async updateIndex(mutator) {
        const run = this.indexWriteQueue.then(async () => {
            const index = await this.loadIndex();
            await this.saveIndex(mutator(index));
        });
        this.indexWriteQueue = run.catch(() => undefined);
        return run;
    }
    async loadIndex() {
        try {
            const raw = await readFile(this.indexPath(), 'utf8');
            const parsed = JSON.parse(raw);
            if ('activeTaskId' in parsed && !('activeTaskIds' in parsed)) {
                const old = parsed.activeTaskId;
                return { activeTaskIds: old ? [old] : [] };
            }
            const ids = parsed.activeTaskIds;
            return { activeTaskIds: Array.isArray(ids) ? ids : [] };
        }
        catch {
            return { activeTaskIds: [] };
        }
    }
    async saveIndex(index) {
        await mkdir(this.rootDir, { recursive: true });
        const target = this.indexPath();
        const tmp = this.tempPath(target);
        const encoded = JSON.stringify(index, null, 2);
        await writeFile(tmp, encoded, 'utf8');
        await rename(tmp, target);
        this.diagnostics.onWrite?.('index', Buffer.byteLength(encoded, 'utf8'));
    }
    snapshotDir() { return join(this.rootDir, 'snapshots'); }
    snapshotPath(taskId) { return join(this.snapshotDir(), `${taskId}.json`); }
    journalPath(taskId) { return join(this.snapshotDir(), `${taskId}.journal.jsonl`); }
    indexPath() { return join(this.rootDir, 'active-task.json'); }
    tempPath(target) {
        return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    }
}
/**
 * Compatibility reader for synchronous call sites that previously parsed the
 * checkpoint JSON directly. New runtime paths should prefer recoverTask().
 */
export function recoverTaskSnapshotSync(rootDir, taskId) {
    let checkpointRaw;
    try {
        checkpointRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.json`), 'utf8');
    }
    catch (error) {
        if (isNodeErrorCode(error, 'ENOENT'))
            return null;
        throw error;
    }
    const checkpoint = parseCheckpoint(checkpointRaw);
    try {
        const journalRaw = readFileSync(join(rootDir, 'snapshots', `${taskId}.journal.jsonl`), 'utf8');
        if (!checkpoint.sealed && journalRaw.length > 0) {
            throw new Error('unsealed checkpoint has a task journal');
        }
        return replayJournal(checkpoint, journalRaw, taskId).snapshot;
    }
    catch (error) {
        if (isNodeErrorCode(error, 'ENOENT'))
            return checkpoint.snapshot;
        throw error;
    }
}
function buildJournalPayload(current, next, sequence) {
    const patch = {};
    const removed = [];
    const previousRecord = current.snapshot;
    const nextRecord = next;
    const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)]);
    keys.delete('taskId');
    keys.delete('events');
    for (const key of keys) {
        if (!(key in nextRecord)) {
            removed.push(key);
        }
        else if (JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key])) {
            patch[key] = nextRecord[key];
        }
    }
    return {
        version: 1,
        taskId: next.taskId,
        sequence,
        previousSequence: current.sequence,
        events: next.events.slice(current.snapshot.events.length),
        patch,
        removed: removed.sort(),
    };
}
function applyJournalRecord(snapshot, record) {
    const next = {
        ...snapshot,
        ...record.patch,
        events: [...snapshot.events, ...record.events],
    };
    for (const key of record.removed)
        delete next[key];
    return next;
}
function parseCheckpoint(raw) {
    const parsed = JSON.parse(raw);
    const persistence = parsed[CHECKPOINT_META_KEY];
    delete parsed[CHECKPOINT_META_KEY];
    const sealed = persistence?.version === 1
        && Number.isSafeInteger(persistence.lastSequence)
        && persistence.lastSequence >= 0
        && Number.isSafeInteger(persistence.checkpointEventCount)
        && persistence.checkpointEventCount >= 0;
    return {
        snapshot: parsed,
        sequence: sealed
            ? persistence.lastSequence
            : 0,
        checkpointEventCount: sealed
            ? persistence.checkpointEventCount
            : parsed.events.length,
        sealed,
    };
}
function replayJournal(checkpoint, journalRaw, taskId) {
    if (!checkpoint.sealed && journalRaw.length > 0) {
        throw new Error('unsealed checkpoint has a task journal');
    }
    let { snapshot, sequence } = checkpoint;
    const terminated = journalRaw.endsWith('\n');
    const lines = journalRaw.split('\n');
    if (terminated)
        lines.pop();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line)
            continue;
        if (!terminated && index === lines.length - 1) {
            // appendFile only commits newline-terminated frames. A final fragment,
            // even if parseable, is an unacknowledged crash tail.
            break;
        }
        const record = parseJournalRecord(line, taskId, index + 1);
        if (record.sequence <= sequence)
            continue;
        if (record.previousSequence !== sequence || record.sequence !== sequence + 1) {
            throw new Error(`task journal sequence gap at line ${index + 1}`);
        }
        snapshot = applyJournalRecord(snapshot, record);
        sequence = record.sequence;
    }
    return {
        snapshot,
        sequence,
        checkpointEventCount: checkpoint.checkpointEventCount,
        sealed: checkpoint.sealed,
        journalRepairOffset: terminated ? undefined : Math.max(0, journalRaw.lastIndexOf('\n') + 1),
    };
}
function shouldWriteInterimCheckpoint(current, next, encodedRecord) {
    let nextEventThreshold = 256;
    while (nextEventThreshold <= current.checkpointEventCount)
        nextEventThreshold *= 2;
    return next.events.length >= nextEventThreshold || Buffer.byteLength(encodedRecord, 'utf8') >= 1_048_576;
}
function assertAppendOnlyEvents(previous, next, expectedPrevious) {
    if (next.taskId !== previous.taskId || next.events.length < previous.events.length) {
        throw new Error('task events are not append-only');
    }
    if (expectedPrevious === previous
        && (previous.events.length === 0 || next.events[previous.events.length - 1] === previous.events.at(-1))) {
        return;
    }
    for (let index = 0; index < previous.events.length; index += 1) {
        if (JSON.stringify(previous.events[index]) !== JSON.stringify(next.events[index])) {
            throw new Error('task events are not append-only');
        }
    }
}
function checksumJournalPayload(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function parseJournalRecord(line, taskId, lineNumber) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (error) {
        throw new Error(`invalid task journal record at line ${lineNumber}`, { cause: error });
    }
    if (!parsed || typeof parsed !== 'object')
        throw new Error(`invalid task journal record at line ${lineNumber}`);
    const record = parsed;
    const { checksum, ...payload } = record;
    if (record.version !== 1
        || record.taskId !== taskId
        || !Number.isSafeInteger(record.sequence)
        || record.sequence <= 0
        || !Number.isSafeInteger(record.previousSequence)
        || record.previousSequence < 0
        || !Array.isArray(record.events)
        || !record.patch
        || typeof record.patch !== 'object'
        || !Array.isArray(record.removed)
        || record.removed.some(key => typeof key !== 'string' || key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
        || Object.keys(record.patch).some(key => key === 'taskId' || key === 'events' || key === CHECKPOINT_META_KEY)
        || typeof checksum !== 'string'
        || checksum !== checksumJournalPayload(payload)) {
        throw new Error(`invalid task journal record at line ${lineNumber}`);
    }
    return record;
}
function isNodeErrorCode(error, code) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === code;
}
