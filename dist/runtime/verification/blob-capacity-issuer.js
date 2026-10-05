import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
const hash = (value) => createHash('sha256').update(json(value)).digest('hex');
/** Read-only original resource census. This does not mint a component or deletion receipt. */
export function inspectBlobCapacityIssuer(database, p) {
    const matches = [];
    const exists = (table) => !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    function add(kind, id, allocation, lineage) {
        if (json(allocation) !== json(p) || typeof id !== 'string' || !id)
            throw Error('blob_issuer_original_tuple');
        matches.push({ version: 1, resourceId: p.resourceId, allocationHash: hash(p), ownerKey: p.ownerKey, scopeDigest: p.scopeDigest, bytes: p.bytes, issuerKind: kind, producerResourceId: id, producerLineageHash: hash(lineage) });
    }
    if (exists('broker_staging_intents'))
        for (const row of database.prepare('SELECT resource_id,record_json FROM broker_staging_intents WHERE resource_id=?').iterate(p.resourceId)) {
            const r = JSON.parse(row.record_json);
            add('material', row.resource_id, r.allocation, { manifest: r.manifest, factsHash: r.factsHash });
        }
    if (exists('docker_runner_resources'))
        for (const row of database.prepare("SELECT execution_id,resources_json FROM docker_runner_resources WHERE json_extract(resources_json,'$.inputAllocation.resourceId')=? OR json_extract(resources_json,'$.outputAllocation.resourceId')=?").iterate(p.resourceId, p.resourceId)) {
            const r = JSON.parse(row.resources_json);
            if (row.execution_id !== r.expected.executionIdentity)
                throw Error('blob_issuer_original_tuple');
            for (const allocation of [r.inputAllocation, r.outputAllocation])
                if (allocation.resourceId === p.resourceId)
                    add(r.ownerKey === 'private-engine-qualification' ? 'qualification-mounted' : 'raw', row.execution_id, allocation, { ownerKey: r.ownerKey, expected: r.expected, engine: r.engine, imageId: r.imageId, holderAttempt: r.holderAttempt, workerAttempt: r.workerAttempt, input: r.input, output: r.output });
        }
    if (exists('verification_engine_qualification'))
        for (const row of database.prepare("SELECT record_json FROM verification_engine_qualification WHERE json_extract(record_json,'$.allocation.resourceId')=?").iterate(p.resourceId)) {
            const r = JSON.parse(row.record_json);
            add('qualification-probe', r.expected.executionIdentity, r.allocation, { expected: r.expected, engineHash: r.engineHash, challenge: r.challenge });
        }
    if (exists('verification_execution_transcripts'))
        for (const row of database.prepare('SELECT execution_id,allocation_json,manifest_json FROM verification_execution_transcripts WHERE resource_id=?').iterate(p.resourceId)) {
            const m = JSON.parse(row.manifest_json);
            if (row.execution_id !== m.expected.executionIdentity)
                throw Error('blob_issuer_original_tuple');
            add('transcript', row.execution_id, JSON.parse(row.allocation_json), { ownerKey: m.ownerKey, expected: m.expected, engine: m.engine });
        }
    if (exists('verification_protected_runs'))
        for (const row of database.prepare('SELECT source_run_id,run_nonce,owner_key,invocation_json,allocation_json FROM verification_protected_runs WHERE source_run_id=? AND allocation_json IS NOT NULL').iterate(p.resourceId)) {
            add('run', row.source_run_id, JSON.parse(row.allocation_json), { runNonce: row.run_nonce, ownerKey: row.owner_key, invocation: JSON.parse(row.invocation_json) });
        }
    if (exists('verification_artifact_batches'))
        for (const row of database.prepare('SELECT resource_id,manifest_json FROM verification_artifact_batches WHERE resource_id=?').iterate(p.resourceId)) {
            const r = JSON.parse(row.manifest_json);
            add('artifact-batch', row.resource_id, r.reservation, r.facts);
        }
    if (matches.length !== 1)
        throw Error('blob_issuer_population');
    return Object.freeze(matches[0]);
}
export function readBlobCapacityIssuer(database, p) {
    const row = database.prepare('SELECT allocation_hash,record_json,record_hash FROM shared_blob_issuers WHERE resource_id=?').get(p.resourceId);
    if (!row || row.allocation_hash !== hash(p))
        throw Error('blob_issuer_missing');
    const actual = inspectBlobCapacityIssuer(database, p);
    if (row.record_json !== json(actual) || row.record_hash !== hash(actual))
        throw Error('blob_issuer_changed');
    return actual;
}
