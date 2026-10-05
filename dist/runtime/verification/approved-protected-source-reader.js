import { types } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
import { assertVerificationCompletionDatabase } from './completion-composition.js';
import { assertApprovedSourceCapabilitiesDatabase } from './approved-source-capabilities.js';
import { assertProtectedRunLedgerDatabase } from './protected-run-ledger.js';
import { canonicalVerificationJson as json } from './protocol.js';
const hash = (value) => createHash('sha256').update(json(value)).digest('hex');
const clone = (v) => JSON.parse(json(v));
const actualReaders = new WeakMap(), actualSubjects = new WeakMap();
function readerCurrent(state) { if (state.closed)
    throw Error('protected_source_reader_closed'); assertVerificationCompletionDatabase(state.completion, state.database); assertApprovedSourceCapabilitiesDatabase(state.capabilities, state.database); assertProtectedRunLedgerDatabase(state.runs, state.database); }
export function assertApprovedProtectedSourceReaderDatabase(reader, database, expected) { const state = actualReaders.get(reader); if (!state)
    throw Error('protected_source_reader_brand'); if (state.database !== database || expected && (state.completion !== expected.completion || state.capabilities !== expected.capabilities || state.runs !== expected.runs))
    throw Error('protected_source_reader_database'); readerCurrent(state); }
export function assertPreparedProtectedSourceOwner(subject, database, owner) { const record = preparedSource(subject, database); if (json(record.owner) !== json(owner))
    throw Error('protected_source_subject_owner'); assertPreparedState(record); }
function preparedSource(subject, database) { const state = actualSubjects.get(subject); if (!state)
    throw Error('protected_source_subject_brand'); if (state.reader.database !== database)
    throw Error('protected_source_subject_database'); return state; }
function assertPreparedState(record) { readerCurrent(record.reader); for (const item of record.items)
    if (json(record.reader.runs.describeSource(item.expected, item.cap)) !== json(item.facts))
        throw Error('protected_source_changed'); }
export function assertPreparedProtectedSourceCurrent(subject, database) { assertPreparedState(preparedSource(subject, database)); }
export function readPreparedProtectedSource(subject, database) { const record = preparedSource(subject, database); assertPreparedState(record); return Object.freeze({ manifest: record.manifest, sourceRunId: record.sourceRunId, runNonce: record.runNonce, expiresAt: record.expiresAt }); }
export function bindPreparedProtectedSourceAttempt(subject, database, bindingInput) {
    const record = preparedSource(subject, database), binding = clone(bindingInput);
    assertPreparedState(record);
    const { reader: state, owner, obligationId, recipe, contentRoot, sourceRunId, runNonce } = record, { database: db, completion: host, prepared } = state;
    const actual = host.readApprovedRecipeBinding(binding), k = json(binding);
    if (json(actual.attempt.owner) !== json(owner) || actual.attempt.obligation.obligationId !== obligationId || json(actual.recipe) !== json(recipe) || actual.attempt.contentRoot !== contentRoot || actual.attempt.sourceRunId !== sourceRunId || actual.attempt.runNonce !== runNonce)
        throw Error('protected_source_attempt_binding');
    runVerificationTransaction(db, () => {
        const old = db.prepare('SELECT binding_json,source_record_id FROM verification_source_bindings WHERE attempt_id=?').get(binding.attemptId);
        if (old && (old.binding_json !== k || old.source_record_id !== record.id))
            throw Error('protected_source_attempt_rebind');
        if (!old) {
            if (db.prepare('SELECT COUNT(*) n FROM verification_source_bindings').get().n >= 4096)
                throw Error('protected_source_capacity');
            assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(k) + 512 });
            db.prepare('INSERT INTO verification_source_bindings VALUES(?,?,?)').run(binding.attemptId, k, record.id);
        }
        assertPreparedState(record);
        for (const [key, cached] of prepared) {
            const marker = db.prepare('SELECT 1 FROM verification_source_bindings WHERE binding_json=? AND source_record_id=?').get(key, cached.id);
            if (!marker)
                prepared.delete(key);
        }
        if (!prepared.has(k) && prepared.size >= 4096)
            throw Error('protected_source_capacity');
        prepared.set(k, record);
    });
}
/** Installed private reader of native-approved original protected run archives.
 * Aggregate subject identifiers never substitute for per-source physical receipts. */
export function createApprovedProtectedSourceReader(input) {
    if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 4 || ['database', 'completion', 'capabilities', 'runs'].some(key => { const descriptor = Object.getOwnPropertyDescriptor(input, key); return !descriptor || !('value' in descriptor); }))
        throw Error('protected_source_reader_input');
    const { database: db, completion: host, capabilities: caps, runs } = input, state = { database: db, completion: host, capabilities: caps, runs, closed: false, prepared: new Map() };
    function current() { readerCurrent(state); }
    current();
    if (db.inTransaction)
        throw Error('protected_source_initialization_transaction');
    assertVerificationDatabaseBudget(db, { additionalBytes: 4096 });
    db.exec('CREATE TABLE IF NOT EXISTS verification_source_bindings(attempt_id TEXT PRIMARY KEY,binding_json TEXT NOT NULL,source_record_id TEXT NOT NULL)');
    const prepared = state.prepared;
    function assertBound(binding, record) {
        current();
        const row = db.prepare('SELECT binding_json,source_record_id FROM verification_source_bindings WHERE attempt_id=?').get(binding.attemptId);
        if (!row || row.binding_json !== json(binding) || row.source_record_id !== record.id)
            throw Error('protected_source_unprepared');
    }
    const reader = Object.freeze({
        prepareSubject(ownerInput, recipeInput, deadline, obligationId) {
            current();
            const owner = clone(ownerInput), recipe = clone(recipeInput), approved = host.enrollment.readApprovedRecipe(owner, obligationId);
            if (recipe.kind !== 'diagnostic-coverage' || json(recipe) !== json(approved))
                throw Error('protected_source_recipe');
            const { kind: _kind, ...single } = recipe, sources = 'sources' in recipe ? recipe.sources : [single], seen = new Set();
            let total = 0;
            const items = sources.map(source => {
                if (source.sourceScope !== 'protected-execution-run')
                    throw Error('protected_source_scope');
                const tuple = json({ sourceRunId: source.sourceRunId, runNonce: source.runNonce });
                if (seen.has(tuple))
                    throw Error('protected_source_duplicate');
                seen.add(tuple);
                const expected = { sourceRunId: source.sourceRunId, runNonce: source.runNonce, archiveHash: source.archiveHash, scope: source.sourceScope }, cap = caps.issueRead({ owner, obligationId, source, deadline }), facts = runs.describeSource(expected, cap);
                total += facts.archiveBytes;
                if (total > 256 * 1024 ** 2)
                    throw Error('protected_source_total_limit');
                return { source, expected, cap, facts };
            });
            const manifest = items.map(item => ({ path: hash(item.expected) + '.ndjson', sha256: item.facts.archiveHash, size: item.facts.archiveBytes, role: 'original-source' }));
            const aggregate = hash({ domain: 'xiaok-original-protected-source-set-v1', sources: items.map((item, index) => ({ expected: item.expected, manifest: manifest[index] })).sort((a, b) => json(a).localeCompare(json(b))) });
            const sourceRunId = items.length === 1 ? items[0].expected.sourceRunId : aggregate, runNonce = items.length === 1 ? items[0].expected.runNonce : hash({ domain: 'xiaok-original-protected-source-set-nonce-v1', aggregate });
            const contentRoot = hash([...manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
            const record = { reader: state, id: randomUUID(), owner, obligationId, recipe, items, manifest: Object.freeze(manifest.map(item => Object.freeze(item))), sourceRunId, runNonce, expiresAt: deadline.continuousExpiresAt, contentRoot };
            assertPreparedState(record);
            const subject = Object.freeze({ manifest: record.manifest, sourceRunId, runNonce, expiresAt: record.expiresAt });
            actualSubjects.set(subject, record);
            return subject;
        },
        async readFailedRun(request) {
            current();
            const value = clone(request), approved = host.readApprovedRecipeBinding(value.binding), record = prepared.get(json(value.binding));
            if (!record || json(record.recipe) !== json(approved.recipe))
                throw Error('protected_source_unprepared');
            assertBound(value.binding, record);
            assertPreparedState(record);
            const item = record.items.find(item => item.expected.sourceRunId === value.sourceRunId && item.expected.runNonce === value.runNonce && item.expected.archiveHash === value.archiveHash && item.expected.scope === value.sourceScope);
            if (!item)
                throw Error('protected_source_binding');
            const limit = value.maxBytes ?? 16 * 1024 ** 2;
            if (!Number.isSafeInteger(limit) || limit < 0 || limit > 16 * 1024 ** 2 || item.facts.archiveBytes > limit)
                throw Error('protected_source_read_limit');
            const completed = await runs.complete(item.expected.sourceRunId);
            current();
            assertBound(value.binding, record);
            assertPreparedState(record);
            if (json(host.readApprovedRecipeBinding(value.binding)) !== json(approved))
                throw Error('protected_source_attempt_changed');
            runs.assertComplete(completed.receipt, item.expected);
            const original = runs.readOriginalSource(item.expected, item.cap, { maxBytes: limit });
            assertBound(value.binding, record);
            assertPreparedState(record);
            runs.assertComplete(completed.receipt, item.expected);
            return Object.freeze({ scope: 'protected-execution-run', bytes: original.bytes, exitCode: original.exitCode, receipt: completed.receipt, sourceRunId: original.sourceRunId, runNonce: original.runNonce });
        },
        close() { state.closed = true; prepared.clear(); },
    });
    actualReaders.set(reader, state);
    return reader;
}
