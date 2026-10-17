import { pathToFileURL } from 'node:url';
import { chmodPrivateActivityFile, createPrivateActivityDirectory } from './storage-permissions.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
const REPORT_INTERVAL = 5 * 60_000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const KINDS = new Set(['accepted', 'started', 'heartbeat', 'progress', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const CRITICAL = new Set(['accepted', 'started', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const encode = (value) => JSON.stringify(value);
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const digest = (value) => createHash('sha256').update(encode(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
/** Single host owner. IPC and source admission belong to the service above this store. */
export class ConversationActivityStore {
    db;
    owner;
    readOnly;
    now;
    maxSourceEvents;
    closed = false;
    file;
    secureSidecars() {
        if (this.readOnly)
            return;
        for (const base of [this.file, `${this.file}.owner.sqlite`])
            for (const suffix of ['', '-wal', '-shm', '-journal']) {
                const path = base + suffix;
                if (existsSync(path))
                    chmodPrivateActivityFile(path);
            }
    }
    constructor(file, options = {}) {
        this.readOnly = options.readOnly ?? false;
        this.now = options.now ?? Date.now;
        this.maxSourceEvents = options.maxSourceEvents ?? 100_000;
        if (!Number.isSafeInteger(this.maxSourceEvents) || this.maxSourceEvents < 1)
            throw new Error('invalid_activity_capacity');
        const maximumBytes = options.maxDatabaseBytes ?? 256 * 1024 * 1024;
        if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 * 1024)
            throw new Error('invalid_activity_capacity');
        if (!this.readOnly)
            createPrivateActivityDirectory(dirname(file));
        file = existsSync(file) ? realpathSync(file) : join(realpathSync(dirname(resolve(file))), basename(file));
        this.file = file;
        if (this.readOnly) {
            // SQLite may create missing WAL sidecars even for a read-only connection.
            // An offline database needs immutable mode; a live WAL requires both existing
            // sidecars so this reader never creates files in the owner's storage.
            const hasWal = existsSync(`${file}-wal`);
            if (hasWal && !existsSync(`${file}-shm`))
                throw new Error('conversation_activity_readonly_sidecars_missing');
            this.db = new DatabaseSync(hasWal ? file : `${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
            try {
                const version = this.db.prepare('PRAGMA user_version').get().user_version;
                if (version !== 4)
                    throw new Error('conversation_activity_schema_unsupported');
            }
            catch (error) {
                this.db.close();
                throw error;
            }
            return;
        }
        try {
            for (const target of [file, `${file}.owner.sqlite`]) {
                if (!existsSync(target))
                    closeSync(openSync(target, 'a', 0o600));
                if (process.platform !== 'win32')
                    chmodSync(target, 0o600);
            }
        }
        catch {
            throw new Error('activity_storage_not_private');
        }
        this.owner = new DatabaseSync(`${file}.owner.sqlite`);
        try {
            // A separate rollback-journal database supplies an OS-managed exclusive lock.
            // It is held for this owner's lifetime and released by process exit, never mtime.
            this.owner.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
            this.secureSidecars();
        }
        catch {
            this.owner.close();
            throw new Error('conversation_activity_owner_held');
        }
        let opened;
        try {
            this.db = opened = new DatabaseSync(file);
            this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
            try {
                if (process.platform !== 'win32')
                    for (const suffix of ['', '-wal', '-shm'])
                        if (existsSync(file + suffix))
                            chmodSync(file + suffix, 0o600);
            }
            catch {
                throw new Error('activity_storage_not_private');
            }
            const pageSize = this.db.prepare('PRAGMA page_size').get().page_size;
            this.db.exec(`PRAGMA max_page_count=${Math.floor(maximumBytes / pageSize)}`);
            const version = this.db.prepare('PRAGMA user_version').get();
            if (version.user_version > 4)
                throw new Error('conversation_activity_schema_unsupported');
            this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS association_operations(operation_id TEXT PRIMARY KEY, creation_key TEXT NOT NULL UNIQUE, data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_watches(watch_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES association_operations(operation_id), profile_id TEXT NOT NULL, thread_id TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_bindings(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS work_projections(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_events(event_key TEXT PRIMARY KEY, watch_id TEXT NOT NULL REFERENCES work_watches(watch_id), content_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS source_event_watch ON source_events(watch_id);
        CREATE TABLE IF NOT EXISTS source_event_retention(event_key TEXT PRIMARY KEY REFERENCES source_events(event_key) ON DELETE CASCADE, received_at INTEGER NOT NULL,kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS watch_event_receipts(watch_id TEXT NOT NULL REFERENCES work_watches(watch_id),event_key TEXT NOT NULL,PRIMARY KEY(watch_id,event_key));
        CREATE TABLE IF NOT EXISTS source_cursors(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id), sequence INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_activities(local_seq INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL UNIQUE, watch_id TEXT NOT NULL REFERENCES work_watches(watch_id), profile_id TEXT NOT NULL, thread_id TEXT NOT NULL, data_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS activity_thread_page ON conversation_activities(profile_id,thread_id,local_seq);
        CREATE TABLE IF NOT EXISTS quarantined_events(event_key TEXT PRIMARY KEY, watch_id TEXT NOT NULL, error_code TEXT NOT NULL, source_sequence INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS conversation_reads(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(profile_id,thread_id));
        CREATE TABLE IF NOT EXISTS thread_tombstones(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(profile_id,thread_id));
        CREATE TABLE IF NOT EXISTS notification_attempts(activity_id TEXT PRIMARY KEY,status TEXT NOT NULL,attempted_at INTEGER);
        CREATE TABLE IF NOT EXISTS model_wakes(wake_id TEXT PRIMARY KEY,watch_id TEXT NOT NULL,permission_revision INTEGER NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mcp_task_references(watch_id TEXT PRIMARY KEY REFERENCES work_watches(watch_id),data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS activity_presentations(profile_id TEXT NOT NULL,thread_id TEXT NOT NULL,medium TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(profile_id,thread_id,medium));
        PRAGMA user_version=4;
        COMMIT;
      `);
            this.db.prepare(`INSERT OR IGNORE INTO source_event_retention SELECT event_key,COALESCE(json_extract(content_json,'$.occurredAt'),?),json_extract(content_json,'$.kind') FROM source_events`).run(this.now());
            this.secureSidecars();
        }
        catch (error) {
            opened?.close();
            this.owner.close();
            throw error;
        }
    }
    transaction(fn) {
        if (this.readOnly)
            throw new Error('conversation_activity_readonly');
        if (this.closed)
            throw new Error('conversation_activity_store_closed');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        finally {
            this.secureSidecars();
        }
    }
    prepareAssociation(input) {
        if (![input.operationId, input.creationIdempotencyKey, ...Object.values(input.origin)].every(id))
            throw new Error('invalid_activity_association');
        this.transaction(() => {
            if (this.deleted(input.origin.profileId, input.origin.threadId))
                throw new Error('activity_thread_deleted');
            const existing = this.getAssociation(input.operationId);
            if (existing) {
                if (encode(canonical(existing)) !== encode(canonical(input)))
                    throw new Error('activity_association_conflict');
                return;
            }
            this.db.prepare('INSERT INTO association_operations VALUES(?,?,?)').run(input.operationId, input.creationIdempotencyKey, encode(input));
        });
    }
    getAssociation(operationId) {
        const row = this.db.prepare('SELECT data_json FROM association_operations WHERE operation_id=?').get(operationId);
        return row ? JSON.parse(row.data_json) : null;
    }
    forgetUnboundAssociation(operationId) {
        this.transaction(() => this.db.prepare('DELETE FROM association_operations WHERE operation_id=? AND NOT EXISTS(SELECT 1 FROM work_watches WHERE operation_id=?)').run(operationId, operationId));
    }
    getPresentationCursor(profileId, threadId, medium) {
        return this.db.prepare('SELECT sequence FROM activity_presentations WHERE profile_id=? AND thread_id=? AND medium=?').get(profileId, threadId, medium)?.sequence ?? 0;
    }
    markPresented(profileId, threadId, medium, through) {
        if (!Number.isSafeInteger(through) || through < 0 || !id(medium))
            throw new Error('invalid_activity_presentation_cursor');
        this.transaction(() => this.db.prepare('INSERT INTO activity_presentations VALUES(?,?,?,?) ON CONFLICT(profile_id,thread_id,medium) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(profileId, threadId, medium, through));
    }
    bindWork(binding, mcpReference) {
        return this.transaction(() => {
            const operation = this.getAssociation(binding.operationId);
            if (!operation)
                throw new Error('activity_association_missing');
            if (this.deleted(operation.origin.profileId, operation.origin.threadId))
                throw new Error('activity_thread_deleted');
            if (![binding.watchId, binding.workId, binding.logicalSourceId, binding.sourceDataEpoch].every(id))
                throw new Error('invalid_work_binding');
            const existing = this.getWatch(binding.watchId);
            if (existing) {
                for (const key of ['operationId', 'source', 'logicalSourceId', 'sourceDataEpoch', 'workId', 'runId']) {
                    if ((existing[key] ?? '') !== (binding[key] ?? ''))
                        throw new Error('activity_binding_conflict');
                }
                if (mcpReference && encode(this.getMcpReference(binding.watchId)) !== encode(mcpReference))
                    throw new Error('activity_mcp_reference_conflict');
                return existing;
            }
            const watch = { ...binding, runId: binding.runId ?? '', origin: operation.origin, status: 'active',
                generation: 0, preference: 'normal', policyRevision: 0, nextReportDueAt: this.now() + REPORT_INTERVAL };
            this.db.prepare('INSERT INTO work_watches VALUES(?,?,?,?,?)').run(watch.watchId, watch.operationId, watch.origin.profileId, watch.origin.threadId, encode(watch));
            this.db.prepare('INSERT INTO work_bindings VALUES(?,?)').run(watch.watchId, encode(binding));
            if (mcpReference) {
                if (binding.source !== 'mcp' || mcpReference.endpointId !== binding.logicalSourceId || mcpReference.taskId !== binding.workId
                    || !['v1', 'v2'].includes(mcpReference.generation) || mcpReference.originalOperation !== 'tools/call')
                    throw new Error('invalid_activity_mcp_reference');
                this.db.prepare('INSERT INTO mcp_task_references VALUES(?,?)').run(watch.watchId, encode(mcpReference));
            }
            const projection = { watchId: watch.watchId, executionState: 'accepted', businessOutcome: 'unknown',
                freshness: 'fresh', sourceSequence: 0, revision: 0, lastProgressAt: null, lastHeartbeatAt: null, lastReportAt: null, evidenceRefs: [] };
            this.saveProjection(projection);
            this.addActivity(watch, projection, 'accepted', `created:${watch.watchId}`);
            return watch;
        });
    }
    getWatch(watchId) {
        const row = this.db.prepare('SELECT data_json FROM work_watches WHERE watch_id=?').get(watchId);
        return row ? JSON.parse(row.data_json) : null;
    }
    getMcpReference(watchId) {
        const row = this.db.prepare('SELECT data_json FROM mcp_task_references WHERE watch_id=?').get(watchId);
        return row ? JSON.parse(row.data_json) : null;
    }
    listWatches() {
        return this.db.prepare('SELECT data_json FROM work_watches').all().map(row => JSON.parse(row.data_json));
    }
    getProjection(watchId) {
        const row = this.db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watchId);
        return row ? JSON.parse(row.data_json) : null;
    }
    saveProjection(projection) {
        this.db.prepare('INSERT INTO work_projections VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET data_json=excluded.data_json').run(projection.watchId, encode(projection));
    }
    saveWatch(watch) {
        this.db.prepare('UPDATE work_watches SET data_json=? WHERE watch_id=?').run(encode(watch), watch.watchId);
    }
    addActivity(watch, projection, kind, activityId) {
        const data = { activityId, watchId: watch.watchId, threadId: watch.origin.threadId, kind, at: this.now(), projection };
        if (kind === 'progress') {
            const prior = this.db.prepare('SELECT 1 FROM conversation_activities WHERE activity_id=?').get(activityId);
            if (prior) {
                this.db.prepare('UPDATE conversation_activities SET local_seq=(SELECT COALESCE(MAX(local_seq),0)+1 FROM conversation_activities),data_json=? WHERE activity_id=?').run(encode(data), activityId);
                return;
            }
        }
        this.db.prepare('INSERT OR IGNORE INTO conversation_activities(activity_id,watch_id,profile_id,thread_id,data_json) VALUES(?,?,?,?,?)')
            .run(activityId, watch.watchId, watch.origin.profileId, watch.origin.threadId, encode(data));
    }
    refreshCard(watch, projection) {
        const key = `created:${watch.watchId}`;
        const row = this.db.prepare('SELECT data_json FROM conversation_activities WHERE activity_id=?').get(key);
        if (!row)
            return;
        const data = { ...JSON.parse(row.data_json), projection };
        this.db.prepare('UPDATE conversation_activities SET data_json=? WHERE activity_id=?').run(encode(data), key);
    }
    ingest(watchId, raw) {
        return this.transaction(() => this.ingestLocked(watchId, raw));
    }
    ingestLocked(watchId, raw) {
        const watch = this.getWatch(watchId);
        if (!watch)
            throw new Error('activity_watch_not_found');
        if (watch.status === 'stopped' || this.deleted(watch.origin.profileId, watch.origin.threadId))
            return { acknowledge: true };
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('activity_event_identity_missing');
        const event = raw;
        if (!id(event.eventId))
            throw new Error('activity_event_identity_missing');
        for (const field of ['source', 'logicalSourceId', 'sourceDataEpoch', 'workId', 'runId']) {
            if ((event[field] ?? '') !== (watch[field] ?? ''))
                throw new Error('activity_source_mismatch');
        }
        const eventKey = digest([event.source, event.logicalSourceId, event.sourceDataEpoch, event.workId, event.runId ?? '', event.eventId]);
        if (this.db.prepare('SELECT 1 FROM quarantined_events WHERE event_key=?').get(`${watchId}:${eventKey}`))
            return { acknowledge: true, quarantined: true, duplicate: true };
        const { receivedAt: _received, transportGeneration: _generation, ...stable } = event;
        const content = encode(canonical(stable));
        const prior = this.db.prepare('SELECT content_json FROM source_events WHERE event_key=?').get(eventKey);
        if (prior) {
            if (prior.content_json !== content)
                throw new Error('activity_event_conflict');
            if (this.db.prepare('SELECT 1 FROM watch_event_receipts WHERE watch_id=? AND event_key=?').get(watchId, eventKey))
                return { acknowledge: true, duplicate: true };
        }
        const projection = this.getProjection(watchId);
        const sequence = event.sourceSequence ?? projection.sourceSequence + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 0)
            throw new Error('invalid_activity_sequence');
        if (event.sourceSequence !== undefined && sequence > projection.sourceSequence + 1)
            throw new Error('activity_source_gap');
        // A compacted native sequence is already covered by the durable cursor.
        // Never reinterpret it as a new fact after retention removed its detail.
        if (!prior && event.sourceSequence !== undefined && sequence <= projection.sourceSequence)
            return { acknowledge: true, duplicate: true };
        const valid = event.schemaVersion === 1 && KINDS.has(event.kind) && (event.occurredAt === undefined || Number.isSafeInteger(event.occurredAt) && event.occurredAt >= 0)
            && Array.isArray(event.evidenceRefs) && event.evidenceRefs.length <= 64 && event.evidenceRefs.every(id)
            && (event.businessOutcome === undefined || ['unknown', 'success', 'error', 'cancelled'].includes(event.businessOutcome))
            && Number.isSafeInteger(event.receivedAt) && event.receivedAt >= 0
            && (event.summary === undefined || typeof event.summary === 'string') && Buffer.byteLength(content) <= 16 * 1024;
        if (!valid) {
            this.db.prepare('INSERT OR IGNORE INTO quarantined_events VALUES(?,?,?,?)').run(`${watchId}:${eventKey}`, watchId, 'activity_schema_invalid', sequence);
            projection.sourceSequence = Math.max(projection.sourceSequence, sequence);
            projection.freshness = 'stale';
            projection.errorCode = 'activity_schema_invalid';
            projection.revision++;
            this.addActivity(watch, projection, 'diagnostic', `quarantine:${eventKey}`);
            this.saveProjection(projection);
            this.refreshCard(watch, projection);
            this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, sequence);
            return { acknowledge: true, quarantined: true };
        }
        if (!prior) {
            this.compactSourceProgress(watchId, event.kind === 'progress' || event.kind === 'heartbeat' ? 255 : 256);
            const total = this.db.prepare('SELECT COUNT(*) AS count FROM source_events').get().count;
            if (total >= this.maxSourceEvents)
                throw new Error('activity_capacity_exceeded');
            this.db.prepare('INSERT INTO source_events VALUES(?,?,?)').run(eventKey, watchId, content);
            this.db.prepare('INSERT INTO source_event_retention VALUES(?,?,?)').run(eventKey, this.now(), event.kind);
        }
        this.db.prepare('INSERT INTO watch_event_receipts VALUES(?,?)').run(watchId, eventKey);
        if (sequence > projection.sourceSequence) {
            projection.sourceSequence = sequence;
            projection.revision++;
            projection.freshness = 'fresh';
            if (!TERMINAL.has(projection.executionState)) {
                if (event.kind !== 'progress' && event.kind !== 'artifact_available' && event.kind !== 'heartbeat')
                    projection.executionState = event.kind === 'started' ? 'running' : event.kind;
                if (watch.source === 'mcp' && event.kind === 'progress' && ['accepted', 'input_required', 'blocked'].includes(projection.executionState))
                    projection.executionState = 'running';
                if (watch.source === 'kswarm' && event.executionStarted === true && projection.executionState === 'accepted')
                    projection.executionState = 'running';
                projection.businessOutcome = event.kind === 'completed' ? event.businessOutcome ?? 'success' : event.kind === 'failed' ? 'error' : event.kind === 'cancelled' ? 'cancelled' : 'unknown';
                if (event.kind !== 'heartbeat') {
                    projection.summary = event.summary ?? projection.summary;
                    projection.evidenceRefs = [...new Set([...projection.evidenceRefs, ...event.evidenceRefs])].slice(-64);
                }
                if (event.kind === 'heartbeat')
                    projection.lastHeartbeatAt = this.now();
                if (event.kind === 'progress' || event.kind === 'artifact_available')
                    projection.lastProgressAt = this.now();
                if (CRITICAL.has(event.kind) || event.kind === 'progress') {
                    this.addActivity(watch, projection, event.kind, event.kind === 'progress' ? `progress:${watchId}` : `${watchId}:${eventKey}`);
                }
            }
        }
        this.saveProjection(projection);
        this.refreshCard(watch, projection);
        this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, sequence);
        return { acknowledge: true };
    }
    compactSourceProgress(watchId, keep) {
        const rows = this.db.prepare(`SELECT event_key FROM source_events WHERE watch_id=? AND json_extract(content_json,'$.kind') IN ('progress','heartbeat')
      ORDER BY json_extract(content_json,'$.sourceSequence') DESC,rowid DESC LIMIT -1 OFFSET ?`).all(watchId, keep);
        for (const row of rows) {
            this.db.prepare('DELETE FROM watch_event_receipts WHERE event_key=?').run(row.event_key);
            this.db.prepare('DELETE FROM source_events WHERE event_key=?').run(row.event_key);
        }
    }
    ingestRetainedPage(watchId, page) {
        this.transaction(() => {
            const watch = this.getWatch(watchId);
            if (!watch || watch.sourceDataEpoch !== page.sourceDataEpoch)
                throw new Error('activity_source_mismatch');
            if (watch.status !== 'active' || this.deleted(watch.origin.profileId, watch.origin.threadId))
                return;
            if (!Number.isSafeInteger(page.coveredThrough) || page.coveredThrough < 0 || page.events.length > 200 || page.gapRanges.length > 201)
                throw new Error('invalid_activity_page');
            let previous = -1;
            for (const range of page.gapRanges) {
                if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.through) || range.from < 1 || range.through < range.from
                    || range.through > page.coveredThrough || range.from <= previous || !['progress_compacted', 'retention_expired', 'mixed_retention_compaction'].includes(range.reason))
                    throw new Error('invalid_activity_gap');
                previous = range.through;
            }
            const cover = (through) => {
                let projection = this.getProjection(watchId);
                while (projection.sourceSequence < through) {
                    const from = projection.sourceSequence + 1;
                    const range = page.gapRanges.find(item => item.from <= from && item.through >= from);
                    if (!range)
                        throw new Error('activity_source_gap');
                    const end = Math.min(range.through, through);
                    projection = { ...projection, sourceSequence: end, revision: projection.revision + 1, errorCode: 'activity_history_gap' };
                    this.saveProjection(projection);
                    this.refreshCard(watch, projection);
                    this.addActivity(watch, projection, 'diagnostic', `gap:${watchId}:${from}:${end}:${range.reason}`);
                    this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(watchId, end);
                }
            };
            let lastSequence = -1;
            for (const raw of page.events) {
                const sequence = raw && typeof raw === 'object' ? raw.sourceSequence : undefined;
                if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= lastSequence || sequence > page.coveredThrough)
                    throw new Error('invalid_activity_sequence');
                lastSequence = sequence;
                if (page.gapRanges.some(range => range.from <= sequence && range.through >= sequence))
                    throw new Error('activity_gap_conflict');
                cover(sequence - 1);
                this.ingestLocked(watchId, raw);
            }
            cover(page.coveredThrough);
        });
    }
    pruneRetention() {
        this.transaction(() => {
            const keys = this.db.prepare(`SELECT r.event_key FROM source_event_retention r JOIN source_events e ON e.event_key=r.event_key
        WHERE r.received_at < ? AND r.kind NOT IN ('input_required','blocked','failed')
        OR r.received_at < ? AND r.kind IN ('progress','heartbeat')`).all(this.now() - 90 * 86400_000, this.now() - 7 * 86400_000);
            for (const row of keys) {
                this.db.prepare('DELETE FROM watch_event_receipts WHERE event_key=?').run(row.event_key);
                this.db.prepare('DELETE FROM source_events WHERE event_key=?').run(row.event_key);
            }
            this.db.prepare(`DELETE FROM notification_attempts WHERE activity_id IN (SELECT activity_id FROM conversation_activities
        WHERE json_extract(data_json,'$.at')<? AND json_extract(data_json,'$.kind') NOT IN ('accepted','input_required','blocked','failed'))`).run(this.now() - 90 * 86400_000);
            this.db.prepare(`DELETE FROM conversation_activities WHERE json_extract(data_json,'$.at')<?
        AND json_extract(data_json,'$.kind') NOT IN ('accepted','input_required','blocked','failed')`).run(this.now() - 90 * 86400_000);
        });
    }
    listActivities(profileId, threadId, options = {}) {
        const after = options.afterLocalSeq ?? 0, limit = options.limit ?? 100;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
            throw new Error('invalid_activity_page');
        if (this.deleted(profileId, threadId))
            return [];
        return this.db.prepare('SELECT local_seq,data_json FROM conversation_activities WHERE profile_id=? AND thread_id=? AND local_seq>? ORDER BY local_seq LIMIT ?')
            .all(profileId, threadId, after, limit).map(row => ({ ...JSON.parse(row.data_json), localSeq: row.local_seq }));
    }
    getActivity(profileId, threadId, localSeq) {
        const row = this.db.prepare('SELECT local_seq,data_json FROM conversation_activities WHERE profile_id=? AND thread_id=? AND local_seq=?')
            .get(profileId, threadId, localSeq);
        return row ? { ...JSON.parse(row.data_json), localSeq: row.local_seq } : null;
    }
    unreadByWatch(profileId) {
        return this.db.prepare(`SELECT a.thread_id AS threadId,a.watch_id AS watchId,COUNT(*) AS count FROM conversation_activities a
      LEFT JOIN conversation_reads r ON r.profile_id=a.profile_id AND r.thread_id=a.thread_id
      WHERE a.profile_id=? AND a.local_seq>COALESCE(r.sequence,0) AND json_extract(a.data_json,'$.kind') NOT IN ('accepted','progress')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      GROUP BY a.thread_id,a.watch_id`).all(profileId).map(row => ({ ...row }));
    }
    dueWatches() {
        return this.listWatches().filter(watch => watch.status === 'active' && watch.preference === 'normal'
            && watch.nextReportDueAt <= this.now() && !TERMINAL.has(this.getProjection(watch.watchId).executionState)
            && !this.deleted(watch.origin.profileId, watch.origin.threadId));
    }
    reportDue(authorizedWatchIds) {
        return this.transaction(() => {
            const reports = [];
            for (const watch of this.listWatches()) {
                if (authorizedWatchIds && !authorizedWatchIds.has(watch.watchId))
                    continue;
                const projection = this.getProjection(watch.watchId);
                if (watch.status !== 'active' || watch.preference !== 'normal' || TERMINAL.has(projection.executionState)
                    || this.deleted(watch.origin.profileId, watch.origin.threadId) || watch.nextReportDueAt > this.now())
                    continue;
                const key = `report:${watch.watchId}:${watch.policyRevision}:${watch.nextReportDueAt}`;
                projection.lastReportAt = this.now();
                projection.revision++;
                this.addActivity(watch, projection, 'report', key);
                this.saveProjection(projection);
                watch.nextReportDueAt = this.now() + REPORT_INTERVAL;
                this.saveWatch(watch);
                reports.push(watch.watchId);
            }
            return reports;
        });
    }
    updateReporting(profileId, watchId, preference, expectedRevision) {
        if (!['normal', 'critical_only', 'quiet'].includes(preference))
            throw new Error('invalid_activity_preference');
        return this.transaction(() => {
            const watch = this.ownedWatch(profileId, watchId);
            if (watch.policyRevision !== expectedRevision)
                throw new Error('activity_policy_conflict');
            watch.preference = preference;
            watch.policyRevision++;
            watch.nextReportDueAt = this.now() + REPORT_INTERVAL;
            this.saveWatch(watch);
            return watch;
        });
    }
    stopWatch(profileId, watchId, expectedRevision) {
        return this.transaction(() => {
            const watch = this.ownedWatch(profileId, watchId);
            if (watch.policyRevision !== expectedRevision)
                throw new Error('activity_policy_conflict');
            watch.status = 'stopped';
            watch.generation++;
            watch.policyRevision++;
            this.saveWatch(watch);
            return watch;
        });
    }
    ownedWatch(profileId, watchId) {
        const watch = this.getWatch(watchId);
        if (!watch || watch.origin.profileId !== profileId)
            throw new Error('activity_watch_forbidden');
        if (this.deleted(profileId, watch.origin.threadId))
            throw new Error('activity_thread_deleted');
        return watch;
    }
    deleted(profileId, threadId) {
        return Boolean(this.db.prepare('SELECT 1 FROM thread_tombstones WHERE profile_id=? AND thread_id=?').get(profileId, threadId));
    }
    deleteThread(profileId, threadId, operationId) {
        this.transaction(() => {
            this.db.prepare('INSERT OR IGNORE INTO thread_tombstones VALUES(?,?,?)').run(profileId, threadId, operationId);
            for (const watch of this.listWatches())
                if (watch.origin.profileId === profileId && watch.origin.threadId === threadId) {
                    watch.status = 'stopped';
                    watch.generation++;
                    this.saveWatch(watch);
                }
        });
    }
    getDiagnostics() {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM quarantined_events').get();
        return { quarantined: row.count, sourceEvents: this.db.prepare('SELECT COUNT(*) AS count FROM source_events').get().count };
    }
    pendingNotifications(limit = 20) {
        return this.db.prepare(`SELECT a.local_seq,a.data_json FROM conversation_activities a
      LEFT JOIN notification_attempts n ON n.activity_id=a.activity_id
      WHERE n.activity_id IS NULL AND json_extract(a.data_json,'$.kind') IN ('blocked','input_required','completed','failed','cancelled')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      ORDER BY a.local_seq LIMIT ?`).all(limit)
            .map(row => ({ ...JSON.parse(row.data_json), localSeq: row.local_seq }));
    }
    claimNotification(activityId) {
        return this.transaction(() => this.db.prepare('INSERT OR IGNORE INTO notification_attempts VALUES(?,?,?)')
            .run(activityId, 'unknown', this.now()).changes === 1);
    }
    finishNotification(activityId, status) {
        this.transaction(() => { this.db.prepare('UPDATE notification_attempts SET status=? WHERE activity_id=?').run(status, activityId); });
    }
    markRead(profileId, threadId, throughLocalSeq) {
        return this.transaction(() => {
            if (!Number.isSafeInteger(throughLocalSeq) || throughLocalSeq < 0)
                throw new Error('invalid_activity_page');
            const maximum = this.db.prepare('SELECT COALESCE(MAX(local_seq),0) AS maximum FROM conversation_activities WHERE profile_id=? AND thread_id=?').get(profileId, threadId);
            if (throughLocalSeq > maximum.maximum)
                throw new Error('activity_read_cursor_forbidden');
            const current = this.db.prepare('SELECT sequence FROM conversation_reads WHERE profile_id=? AND thread_id=?').get(profileId, threadId);
            if (throughLocalSeq <= (current?.sequence ?? 0))
                return false;
            this.db.prepare('INSERT INTO conversation_reads VALUES(?,?,?) ON CONFLICT(profile_id,thread_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)').run(profileId, threadId, throughLocalSeq);
            return true;
        });
    }
    unreadThreads(profileId) {
        return this.db.prepare(`SELECT a.thread_id AS threadId, COUNT(*) AS count FROM conversation_activities a
      LEFT JOIN conversation_reads r ON r.profile_id=a.profile_id AND r.thread_id=a.thread_id
      WHERE a.profile_id=? AND a.local_seq>COALESCE(r.sequence,0)
      AND json_extract(a.data_json,'$.kind') NOT IN ('accepted','progress')
      AND NOT EXISTS(SELECT 1 FROM thread_tombstones t WHERE t.profile_id=a.profile_id AND t.thread_id=a.thread_id)
      GROUP BY a.thread_id`).all(profileId).map(row => ({ ...row }));
    }
    setFreshness(watchId, freshness, errorCode) {
        this.transaction(() => {
            const watch = this.getWatch(watchId), projection = this.getProjection(watchId);
            if (!watch || !projection || watch.status !== 'active')
                return;
            projection.freshness = freshness;
            if (errorCode !== undefined || projection.errorCode !== 'activity_history_gap')
                projection.errorCode = errorCode;
            projection.revision++;
            if (freshness === 'fresh')
                projection.lastHeartbeatAt = this.now();
            this.saveProjection(projection);
            this.refreshCard(watch, projection);
        });
    }
    reconcileSnapshot(watchId, sourceDataEpoch, sequence, state, historyGap = true) {
        this.transaction(() => {
            const watch = this.getWatch(watchId), projection = this.getProjection(watchId);
            if (!watch || !projection || watch.sourceDataEpoch !== sourceDataEpoch)
                throw new Error('activity_source_mismatch');
            if (!Number.isSafeInteger(sequence) || sequence < projection.sourceSequence)
                throw new Error('activity_source_gap');
            projection.sourceSequence = sequence;
            projection.revision++;
            projection.freshness = 'fresh';
            const changedState = !TERMINAL.has(projection.executionState) && projection.executionState !== state;
            if (!TERMINAL.has(projection.executionState)) {
                projection.executionState = state;
                projection.businessOutcome = state === 'completed' ? 'success' : state === 'failed' ? 'error' : state === 'cancelled' ? 'cancelled' : 'unknown';
            }
            if (historyGap)
                projection.errorCode = 'activity_history_gap';
            this.saveProjection(projection);
            this.refreshCard(watch, projection);
            if (historyGap)
                this.addActivity(watch, projection, 'diagnostic', `gap:${watchId}:${sequence}`);
            else if (changedState && TERMINAL.has(state))
                this.addActivity(watch, projection, state, `snapshot:${watchId}:${sourceDataEpoch}:${sequence}:${state}`);
            this.db.prepare('INSERT INTO source_cursors VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET sequence=excluded.sequence').run(watchId, sequence);
        });
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.db.close();
        this.owner?.close();
    }
}
