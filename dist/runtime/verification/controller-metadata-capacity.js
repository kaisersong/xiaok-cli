import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { canonicalVerificationJson as json, VERIFICATION_BUDGET } from './protocol.js';
import { METADATA_EMERGENCY_BYTES, parseMetadataCapacityPrepare, parseMetadataCapacityConfirm } from './metadata-capacity-protocol.js';
import { readInstalledMetadataSource } from './installed-metadata-source.js';
import { consumeCapacityMetadataContext, assertSharedCapacityLedgerDatabase } from './shared-capacity-ledger.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
const hash = (v) => createHash('sha256').update(json(v)).digest('hex'), BLOCK = 16 * 1024 ** 2;
const metadataPrepareCommands = new WeakMap();
export function inspectMetadataPrepareCommand(command, ledger, database) { const facts = metadataPrepareCommands.get(command); if (!facts)
    return undefined; if (facts.ledger !== ledger || facts.database !== database)
    throw Error('capacity_metadata_command_owner'); return Object.freeze({ entries: facts.entries }); }
export function executeMetadataPrepareCommand(command, context) {
    const f = metadataPrepareCommands.get(command);
    if (!f)
        return false;
    const { database: db, ledger, source: facts, request, blocks } = f, allocations = consumeCapacityMetadataContext(context, ledger, db, command);
    const unchanged = () => { const now = readInstalledMetadataSource(f.handle, db, f.authorityId); if (now.resourceId !== facts.resourceId || now.physicalIdentity !== facts.physicalIdentity || now.beneficiaryCensusHash !== facts.beneficiaryCensusHash || now.pageSize !== facts.pageSize)
        throw Error('metadata_capacity_source_changed'); };
    unchanged();
    const actual = db.prepare('SELECT * FROM controller_metadata_resources WHERE resource_id=?').get(facts.resourceId);
    if (json(actual ?? null) !== json(f.before ?? null))
        throw Error('metadata_capacity_revision');
    const allocationDigest = hash(allocations.map(a => ({ record: a.allocation.record, attributions: a.attributions.map(x => x.record) }))), result = Object.freeze({ resourceId: facts.resourceId, intentId: 'metadata-intent-' + hash({ request, facts: facts.physicalIdentity }), requestId: request.requestId, resourceRevision: request.expectedRevision + 1, writerGeneration: facts.writerGeneration, allocationDigest, beneficiaryCensusHash: facts.beneficiaryCensusHash, pageSize: facts.pageSize, chargedMaximumPageCount: blocks * BLOCK / facts.pageSize, usableMaximumPageCount: (blocks * BLOCK - METADATA_EMERGENCY_BYTES) / facts.pageSize, journalMode: 'delete', synchronous: 'full', state: 'prepared' });
    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(result)) * 2 + Buffer.byteLength(json(request)) + 4096 });
    db.prepare('INSERT INTO controller_metadata_resources VALUES(?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json').run(facts.resourceId, facts.physicalIdentity, result.resourceRevision, json(result));
    db.prepare('INSERT INTO controller_metadata_intents VALUES(?,?,?,?)').run(request.requestId, facts.resourceId, json(request), json(result));
    unchanged();
    const actualPages = db.pragma('page_count', { simple: true });
    if (!Number.isSafeInteger(actualPages) || actualPages < 1)
        throw Error('metadata_capacity_page_count');
    if (actualPages > result.usableMaximumPageCount) {
        f.requiredBlocks = Math.ceil((actualPages * facts.pageSize + METADATA_EMERGENCY_BYTES) / BLOCK);
        throw f.growth;
    }
    f.result = result;
    return true;
}
/** Internal adapter of the original shared ledger. Installed source brands, not
 * requested session lists, provide every owner. Confirmation is factual only. */
export function createControllerMetadataCapacity(input) {
    if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 3 || ['database', 'authorityId', 'ledger'].some(key => { const descriptor = Object.getOwnPropertyDescriptor(input, key); return !descriptor || !('value' in descriptor); }))
        throw Error('metadata_capacity_configuration');
    const { database: db, authorityId, ledger } = input, current = () => assertSharedCapacityLedgerDatabase(ledger, db, authorityId);
    current();
    if (db.inTransaction)
        throw Error('metadata_capacity_outer_transaction');
    db.exec('CREATE TABLE IF NOT EXISTS controller_metadata_resources(resource_id TEXT PRIMARY KEY,physical_identity TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS controller_metadata_intents(request_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,request_json TEXT NOT NULL,record_json TEXT NOT NULL)');
    const source = (handle) => { current(); return readInstalledMetadataSource(handle, db, authorityId); };
    function unchanged(handle, original) { const now = source(handle); if (now.resourceId !== original.resourceId || now.physicalIdentity !== original.physicalIdentity || now.beneficiaryCensusHash !== original.beneficiaryCensusHash || now.pageSize !== original.pageSize)
        throw Error('metadata_capacity_source_changed'); return now; }
    function resource(id) { return db.prepare('SELECT * FROM controller_metadata_resources WHERE resource_id=?').get(id); }
    return Object.freeze({
        recoverPreviousWriter(handle) { const facts = source(handle); if (db.inTransaction)
            throw Error('metadata_capacity_outer_transaction'); const r = resource(facts.resourceId); if (!r)
            return; const old = JSON.parse(r.record_json); if (r.physical_identity !== facts.physicalIdentity)
            throw Error('metadata_capacity_resource'); if (old.state !== 'prepared')
            return; if (old.writerGeneration === facts.writerGeneration)
            throw Error('metadata_capacity_live_preparation'); runVerificationTransaction(db, () => { unchanged(handle, facts); if (json(resource(facts.resourceId)) !== json(r))
            throw Error('metadata_capacity_revision'); db.prepare('UPDATE controller_metadata_resources SET record_json=? WHERE resource_id=?').run(json({ ...old, state: 'unknown' }), facts.resourceId); }); },
        prepare(handle, raw) {
            const request = parseMetadataCapacityPrepare(raw), facts = source(handle);
            if (request.resourceId !== facts.resourceId)
                throw Error('metadata_capacity_resource');
            if (db.inTransaction)
                throw Error('metadata_capacity_outer_transaction');
            const previous = db.prepare('SELECT * FROM controller_metadata_intents WHERE request_id=?').get(request.requestId);
            if (previous) {
                if (previous.resource_id !== facts.resourceId || previous.request_json !== json(request))
                    throw Error('metadata_capacity_intent_conflict');
                const result = JSON.parse(previous.record_json);
                if (result.beneficiaryCensusHash !== facts.beneficiaryCensusHash || result.writerGeneration !== facts.writerGeneration)
                    throw Error('metadata_capacity_source_changed');
                return Object.freeze(result);
            }
            const r = resource(facts.resourceId);
            if ((r?.revision ?? 0) !== request.expectedRevision || r && r.physical_identity !== facts.physicalIdentity)
                throw Error('metadata_capacity_revision');
            if (r && JSON.parse(r.record_json).state === 'prepared')
                throw Error('metadata_capacity_pending');
            if (!Number.isSafeInteger(facts.pageSize) || facts.pageSize < 512 || facts.pageSize > 65536 || (facts.pageSize & (facts.pageSize - 1)))
                throw Error('metadata_capacity_page_size');
            const old = r ? JSON.parse(r.record_json) : undefined, targetBytes = Math.max(facts.pageCount, request.minimumPageCount, old?.usableMaximumPageCount ?? 0) * facts.pageSize + METADATA_EMERGENCY_BYTES, initialBlocks = Math.ceil(targetBytes / BLOCK);
            if (initialBlocks < 1 || initialBlocks * BLOCK > VERIFICATION_BUDGET.controlDatabaseBytes)
                throw Error('metadata_capacity_control_limit');
            const originalCap = db.pragma('max_page_count', { simple: true });
            if (old && (facts.pageCount > old.usableMaximumPageCount || !Number.isSafeInteger(old.chargedMaximumPageCount) || old.chargedMaximumPageCount - old.usableMaximumPageCount !== METADATA_EMERGENCY_BYTES / facts.pageSize))
                throw Error('metadata_capacity_legacy_headroom');
            const owner = ledger.bindOwner(facts.owner), beneficiaries = facts.beneficiaries.map(b => ledger.bindOwner(b));
            let committed = false;
            let settledBodyResult;
            let settledBodyFailure;
            try {
                settledBody: {
                    if (old && db.pragma(`max_page_count=${old.chargedMaximumPageCount}`, { simple: true }) !== old.chargedMaximumPageCount)
                        throw Error('metadata_capacity_emergency_cap');
                    for (let blocks = initialBlocks; blocks <= VERIFICATION_BUDGET.controlDatabaseBytes / BLOCK;) {
                        const entries = [], growth = Object.freeze({});
                        let requiredBlocks = blocks;
                        for (let index = 0; index < blocks; index++)
                            for (const partition of ['control', 'rollback']) {
                                const binding = { authorityId, resourceId: facts.resourceId, physicalIdentity: facts.physicalIdentity, index, partition, bytes: BLOCK }, identity = hash(binding);
                                entries.push({ owner, beneficiaries, proposal: { operationId: 'metadata-' + identity, resourceId: 'metadata-' + identity, generation: 1, partition, bytes: BLOCK, bindingHash: identity } });
                            }
                        const command = Object.freeze({}), commandFacts = { database: db, ledger, authorityId, handle, source: facts, request, before: r, entries, blocks, growth, requiredBlocks };
                        metadataPrepareCommands.set(command, commandFacts);
                        try {
                            ledger.reserveMetadataCommand(command);
                            const result = commandFacts.result;
                            if (!result)
                                throw Error('metadata_capacity_command_result');
                            committed = true;
                            if (db.pragma(`max_page_count=${result.usableMaximumPageCount}`, { simple: true }) !== result.usableMaximumPageCount)
                                throw Error('metadata_capacity_apply');
                            {
                                settledBodyResult = result;
                                break settledBody;
                            }
                        }
                        catch (error) {
                            if (error !== growth)
                                throw error;
                            if (db.inTransaction)
                                throw Error('metadata_capacity_rollback');
                            requiredBlocks = commandFacts.requiredBlocks;
                            if (requiredBlocks <= blocks)
                                throw Error('metadata_capacity_growth');
                            blocks = requiredBlocks;
                        }
                        finally {
                            metadataPrepareCommands.delete(command);
                        }
                    }
                    throw Error('metadata_capacity_control_limit');
                }
            }
            catch (error) {
                settledBodyFailure = { error };
            }
            {
                if (!committed && db.pragma(`max_page_count=${old?.usableMaximumPageCount ?? originalCap}`, { simple: true }) !== (old?.usableMaximumPageCount ?? originalCap))
                    throw Error('metadata_capacity_cap_restore');
            }
            if (settledBodyFailure)
                throw settledBodyFailure.error;
            return settledBodyResult;
        },
        apply(handle, raw) {
            const request = parseMetadataCapacityConfirm(raw), facts = source(handle);
            if (db.inTransaction)
                throw Error('metadata_capacity_outer_transaction');
            const row = db.prepare('SELECT * FROM controller_metadata_intents WHERE request_id=?').get(request.requestId);
            if (!row || row.resource_id !== facts.resourceId || request.resourceId !== facts.resourceId)
                throw Error('metadata_capacity_intent');
            const value = JSON.parse(row.record_json);
            if (value.writerGeneration !== facts.writerGeneration || value.intentId !== request.intentId || value.allocationDigest !== request.allocationDigest || value.beneficiaryCensusHash !== facts.beneficiaryCensusHash || resource(facts.resourceId)?.revision !== value.resourceRevision)
                throw Error('metadata_capacity_intent');
            // The actual controller connection is fixed; caller-reported PRAGMA values are never used.
            if (db.pragma('journal_mode', { simple: true }) !== 'delete' || db.pragma('synchronous', { simple: true }) !== 2)
                throw Error('metadata_capacity_database_mode');
            if (db.pragma(`max_page_count=${value.usableMaximumPageCount}`, { simple: true }) !== value.usableMaximumPageCount || db.pragma('page_count', { simple: true }) > value.usableMaximumPageCount)
                throw Error('metadata_capacity_apply');
            unchanged(handle, facts);
            return runVerificationTransaction(db, () => { unchanged(handle, facts); const confirmed = Object.freeze({ ...value, state: 'confirmed' }); db.prepare('UPDATE controller_metadata_intents SET record_json=? WHERE request_id=?').run(json(confirmed), request.requestId); db.prepare('UPDATE controller_metadata_resources SET record_json=? WHERE resource_id=? AND revision=?').run(json(confirmed), facts.resourceId, value.resourceRevision); unchanged(handle, facts); return confirmed; });
        },
    });
}
