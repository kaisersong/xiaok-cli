import { inspectBlobCapacityIssuer, readBlobCapacityIssuer } from './blob-capacity-issuer.js';
import { readInstalledCapacityAuthority, claimInstalledCapacityLayer, finishInstalledCapacityLayer, failInstalledCapacityLayer } from './installed-controller.js';
import { assertInstalledCapacityDeleted } from './installed-shared-capacity.js';
import { inspectBlobSharedWholeCommand, executeBlobSharedWholeCommand, inspectBlobSharedBatchCommand, executeBlobSharedBatchCommand, inspectBlobSharedReserveCommand, executeBlobSharedReserveCommand } from './blob-budget.js';
import { consumeSharedCapacityCommandContext } from './shared-capacity-ledger.js';
import { readInstalledMetadataOwner, readInstalledMetadataOwners } from './installed-metadata-source.js';
import { captureOwnerBindingBatch } from './owner-binding-batch-input.js';
import { createControllerMetadataCapacity } from './controller-metadata-capacity.js';
import { readApprovedBlackboxCapacityLineage } from './approved-blackbox-stager.js';
import { inspectLegacyBlobInventory } from './shared-blob-migration.js';
import { assertInstalledMacEngineHandle, assertInstalledEngineDatabase } from './installed-engine.js';
import { readMountedProbeCapacityPlan } from '../isolated-execution/mounted-engine-probe.js';
import { readProtectedRunCapacityBinding } from './protected-run-ledger.js';
import { readDockerCapacityExecution, readDockerArchiveCapacitySource } from '../isolated-execution/docker-runner.js';
import { readBrokerStagingCapacitySource } from '../isolated-execution/broker-staging.js';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { createSharedCapacityLedger } from './shared-capacity-ledger.js';
import { readProfileCapacityOwnerBinding } from './profile-owner-registry.js';
import { readMaterialAuthorityCapacityFacts } from './material-authority.js';
import { assertVerificationDatabaseBudget } from './storage-budget.js';
const hash = (value) => createHash('sha256').update(json(value)).digest('hex');
const grants = new WeakMap();
/** Only actual same-database registry and material authority objects can issue this binding. */
export function createMaterialCapacityBinding(input) {
    const { database, authority, grant, ownerBinding } = input;
    function read() { const owner = readProfileCapacityOwnerBinding(ownerBinding, database), material = readMaterialAuthorityCapacityFacts(authority, grant, database); if (owner.ownerKey !== material.ownerKey || json(owner.invocation) !== json(material.review.invocation))
        throw Error('shared_blob_material_binding'); return Object.freeze({ sessionKey: owner.sessionKey, producerKey: 'installed-material-staging', ownerKey: owner.ownerKey, scopeDigest: material.review.scopeDigest, authorityId: owner.authorityId, bytes: material.review.materials.reduce((total, file) => total + file.size, 0), engineBinding: Object.freeze({ ...material.review.engineBinding }) }); }
    const original = read(), token = Object.freeze({});
    grants.set(token, { database, read() { const current = read(); if (json(current) !== json(original))
            throw Error('shared_blob_material_changed'); return current; } });
    return token;
}
const archiveBindings = new WeakMap();
export function createExecutionTranscriptCapacityBinding(input) {
    const { database, raw } = input, expected = JSON.parse(json(input.expected)), allocation = JSON.parse(json(input.allocation));
    const read = () => readDockerArchiveCapacitySource(raw, database, expected), source = read();
    if (allocation.ownerKey !== source.ownerKey || allocation.scopeDigest !== source.scopeDigest || allocation.kind !== 'host-export')
        throw Error('shared_blob_transcript_binding');
    const token = Object.freeze({});
    archiveBindings.set(token, { database, allocationHash: hash(allocation), read() { const current = read(); if (hash(current) !== hash(source))
            throw Error('shared_blob_transcript_changed'); return current; } });
    return token;
}
const artifactBindings = new WeakMap();
/** In-memory anchor minted by the artifact exporter for the exact allocation it
 * is about to reserve; the durable batch row is written by the same command. */
export function createArtifactCapacityBinding(input) {
    const { database, allocation } = input, allocationHash = hash(allocation), token = Object.freeze({});
    artifactBindings.set(token, { database, allocationHash });
    return token;
}
const engineCapacityOwners = new WeakMap(), engineAllocations = new WeakMap();
export function createEngineQualificationCapacityOwner(engine, database) { assertInstalledMacEngineHandle(engine); assertInstalledEngineDatabase(engine, database); const owner = Object.freeze({}); engineCapacityOwners.set(owner, { database, current() { assertInstalledMacEngineHandle(engine); assertInstalledEngineDatabase(engine, database); } }); return owner; }
export function createEngineQualificationAllocation(owner, allocation) { const known = engineCapacityOwners.get(owner); if (!known)
    throw Error('shared_blob_engine_owner'); known.current(); if (allocation.ownerKey !== 'private-engine-qualification' || allocation.kind !== 'guest-output' || allocation.bytes !== 32 * 1024 ** 2 || !allocation.resourceId.startsWith('qualification-'))
    throw Error('shared_blob_engine_allocation'); const token = Object.freeze({}); engineAllocations.set(token, { owner, allocationHash: hash(allocation) }); return token; }
const sharedImportCommands = new WeakMap();
const sharedWholeCommands = new WeakMap();
const sharedBatchCommands = new WeakMap();
const sharedWholeContexts = new WeakMap();
export function consumeSharedBlobWholeContext(context, port, database, blobCommand) { const fact = sharedWholeContexts.get(context); if (!fact || fact.used || fact.port !== port || fact.database !== database || fact.blobCommand !== blobCommand || !database.inTransaction)
    throw Error('shared_blob_command_context'); fact.used = true; }
const sharedLedgerCommands = new WeakMap();
const sharedReserveContexts = new WeakMap();
export function consumeSharedBlobReserveContext(context, port, database, blobCommand) { const fact = sharedReserveContexts.get(context); if (!fact || fact.used || fact.port !== port || fact.database !== database || fact.blobCommand !== blobCommand || !database.inTransaction)
    throw Error('shared_blob_command_context'); fact.used = true; }
export function inspectSharedBlobLedgerCommand(command, ledger, database) { const imported = sharedImportCommands.get(command); if (imported) {
    if (imported.ledger !== ledger || imported.database !== database)
        throw Error('shared_blob_ledger_owner');
    return Object.freeze({ kind: 'import', entries: imported.entries.filter(e => e.allocation.bytes > 0).map(e => ({ owner: e.owner, proposal: e.proposal })) });
} const whole = sharedWholeCommands.get(command); if (whole) {
    if (whole.ledger !== ledger || whole.database !== database)
        throw Error('shared_blob_ledger_owner');
    return Object.freeze({ kind: 'transaction' });
} const batch = sharedBatchCommands.get(command); if (batch) {
    if (batch.ledger !== ledger || batch.database !== database)
        throw Error('shared_blob_ledger_owner');
    return Object.freeze({ kind: 'batch', entries: batch.entries });
} const fact = sharedLedgerCommands.get(command); if (!fact)
    return undefined; if (fact.ledger !== ledger || fact.database !== database)
    throw Error('shared_blob_ledger_owner'); return Object.freeze({ owner: fact.owner, proposal: fact.proposal, kind: fact.kind, receipt: fact.receipt }); }
export function executeSharedBlobLedgerCommand(command, context) { const imported = sharedImportCommands.get(command); if (imported) {
    imported.port.commitLedgerImportCommand(command, context);
    return true;
} const whole = sharedWholeCommands.get(command); if (whole) {
    whole.port.commitLedgerWholeCommand(command, context);
    return true;
} const batch = sharedBatchCommands.get(command); if (batch) {
    batch.port.commitLedgerBatchCommand(command, context);
    return true;
} const fact = sharedLedgerCommands.get(command); if (!fact)
    return false; fact.port.commitLedgerReserveCommand(command, context); return true; }
const sharedAuthorityContexts = new WeakMap();
export function readSharedCapacityOwner(authority, binding) { const context = sharedAuthorityContexts.get(authority); if (!context)
    throw Error('capacity_authority_configuration'); const actual = readInstalledCapacityAuthority(authority); if (actual.database !== context.database || actual.authorityId !== context.authorityId)
    throw Error('shared_blob_database'); const value = context.bindings.get(binding); return value ? { sessionKey: value.sessionKey, producerKey: value.producerKey } : readInstalledMetadataOwner(binding, context.database, context.authorityId); }
export function readSharedCapacityOwners(authority, bindings) {
    if (arguments.length !== 2)
        throw Error('capacity_authority_configuration');
    const context = sharedAuthorityContexts.get(authority);
    if (!context)
        throw Error('capacity_authority_configuration');
    const captured = captureOwnerBindingBatch(bindings), missing = [], known = captured.map(binding => {
        const actual = readInstalledCapacityAuthority(authority);
        if (actual.database !== context.database || actual.authorityId !== context.authorityId)
            throw Error('shared_blob_database');
        const value = context.bindings.get(binding);
        if (!value)
            missing.push(binding);
        return value;
    });
    const native = missing.length ? readInstalledMetadataOwners(missing, context.database, context.authorityId) : [];
    let index = 0;
    return Object.freeze(known.map(value => value ? Object.freeze({ sessionKey: value.sessionKey, producerKey: value.producerKey }) : native[index++]));
}
export function assertSharedCapacityReleased(authority, receipt, record) { const context = sharedAuthorityContexts.get(authority); if (!context)
    throw Error('capacity_authority_configuration'); const p = context.releaseProofs.get(receipt); if (!p || 'blob-' + hash({ authorityId: context.authorityId, resourceId: p.resourceId, allocation: p }) !== record.operationId || hash(p) !== record.bindingHash)
    throw Error('shared_blob_deletion'); assertInstalledCapacityDeleted(authority, receipt, p); }
const ports = new WeakMap();
export function assertSharedBlobCapacityAuthority(port, authority) { const fact = ports.get(port); if (!fact || fact.authority !== authority || fact.state.closed)
    throw Error('shared_blob_database'); }
export function assertSharedBlobCapacityDatabase(port, database, authorityId) { const known = ports.get(port); if (known?.database !== database || authorityId !== undefined && known.authorityId !== authorityId)
    throw Error('shared_blob_database'); }
export function createSharedBlobCapacity(authority) {
    if (arguments.length !== 1)
        throw Error('capacity_authority_configuration');
    const { database: db, authorityId } = claimInstalledCapacityLayer(authority, 'shared');
    const bindings = new WeakMap(), owners = new Map(), releaseProofs = new WeakMap(), state = { closed: false };
    const assertCurrent = () => { if (state.closed)
        throw Error('shared_blob_closed'); const current = readInstalledCapacityAuthority(authority); if (current.database !== db || current.authorityId !== authorityId)
        throw Error('shared_blob_database'); }, assertDeleted = (proof, proposal) => assertInstalledCapacityDeleted(authority, proof, proposal);
    sharedAuthorityContexts.set(authority, { database: db, authorityId, bindings, releaseProofs });
    try {
        const ledger = createSharedCapacityLedger(authority);
        db.exec('CREATE TABLE IF NOT EXISTS shared_blob_issuers(resource_id TEXT PRIMARY KEY,allocation_hash TEXT NOT NULL,record_json TEXT NOT NULL,record_hash TEXT NOT NULL)');
        db.exec('CREATE TABLE IF NOT EXISTS shared_blob_bindings(resource_id TEXT PRIMARY KEY,allocation_hash TEXT NOT NULL,binding_json TEXT NOT NULL)');
        function operation(p) { return 'blob-' + hash({ authorityId, resourceId: p.resourceId, allocation: p }); }
        function owner(binding) { const key = json(binding); let known = owners.get(key); if (!known) {
            const opaque = {};
            bindings.set(opaque, binding);
            known = ledger.bindOwner(opaque);
            owners.set(key, known);
        } return known; }
        function stored(p) { readBlobCapacityIssuer(db, p); const row = db.prepare('SELECT allocation_hash,binding_json FROM shared_blob_bindings WHERE resource_id=?').get(p.resourceId); if (!row || row.allocation_hash !== hash(p))
            throw Error('shared_blob_missing_binding'); const binding = JSON.parse(row.binding_json); if (binding.authorityId !== authorityId || binding.ownerKey !== p.ownerKey || binding.scopeDigest !== p.scopeDigest)
            throw Error('shared_blob_binding'); return binding; }
        function legacy() {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_blob_reservations'").get())
                return [];
            return db.prepare("SELECT b.resource_id,b.tuple_hash,b.tuple_json FROM verification_blob_reservations b LEFT JOIN shared_blob_bindings s ON s.resource_id=b.resource_id WHERE b.state='reserved' AND s.resource_id IS NULL ORDER BY b.resource_id").all();
        }
        function unregisteredExisting(p) { const rows = legacy().filter(r => r.resource_id === p.resourceId); if (rows.length !== 1 || rows[0].tuple_hash !== hash(p) || rows[0].tuple_json !== json(p))
            throw Error('shared_blob_legacy_binding'); return true; }
        function engineBinding(owner, p) { const known = engineCapacityOwners.get(owner); if (!known || known.database !== db || p.ownerKey !== 'private-engine-qualification' || !p.engineBinding)
            throw Error('shared_blob_engine_owner'); known.current(); return { authorityId, sessionKey: hash({ authorityId, component: 'engine-qualification' }), producerKey: 'installed-engine-qualification', ownerKey: p.ownerKey, scopeDigest: p.scopeDigest, bytes: p.bytes, engineBinding: { ...p.engineBinding } }; }
        function resolveBatch(proposals, capacityBinding, retained) {
            if (capacityBinding && legacy().length)
                throw Error('shared_blob_migration_required');
            let source, sourceHash = '', anchors = [];
            if (capacityBinding && engineAllocations.has(capacityBinding)) {
                const entry = engineAllocations.get(capacityBinding);
                if (proposals.length !== 1 || entry.allocationHash !== hash(proposals[0]))
                    throw Error('shared_blob_engine_allocation');
                source = engineBinding(entry.owner, proposals[0]);
                anchors = [entry.owner];
                sourceHash = entry.allocationHash;
            }
            else if (capacityBinding) {
                const plan = retained?.anchors[0] ?? readDockerCapacityExecution(capacityBinding, db, proposals), probe = readMountedProbeCapacityPlan(plan, db);
                if (probe) {
                    source = engineBinding(probe, proposals[0]);
                    anchors = [plan, probe];
                    sourceHash = hash(source);
                }
                else {
                    const lineage = readApprovedBlackboxCapacityLineage(plan), sourcePlan = lineage?.originalPlan ?? plan, allocation = readBrokerStagingCapacitySource(sourcePlan, db);
                    source = stored(allocation);
                    if (lineage)
                        source = { ...source, scopeDigest: lineage.scopeDigest };
                    anchors = [plan, sourcePlan];
                    sourceHash = hash({ allocation, lineage: lineage?.scopeDigest ?? null });
                }
            }
            const result = proposals.map(p => { if (!source)
                return stored(p); if (p.ownerKey !== source.ownerKey || p.scopeDigest !== source.scopeDigest || json(p.engineBinding) !== json(source.engineBinding) || !['guest-input', 'guest-output'].includes(p.kind))
                throw Error('shared_blob_execution_binding'); return { ...source, producerKey: 'installed-execution-' + p.kind, bytes: p.bytes }; });
            return { bindings: result, anchors, sourceHash };
        }
        function assertBatch(proposals, capacityBinding, source) { for (const p of proposals)
            readBlobCapacityIssuer(db, p); const now = resolveBatch(proposals, capacityBinding, source); if (json(now.bindings) !== json(source.bindings) || now.sourceHash !== source.sourceHash || now.anchors.length !== source.anchors.length || now.anchors.some((v, i) => v !== source.anchors[i]))
            throw Error('shared_blob_execution_changed'); }
        function assertMigration(inventory, entries) {
            if (inspectLegacyBlobInventory(db, authorityId).digest !== inventory.digest)
                throw Error('shared_blob_migration_changed');
            for (const entry of entries) {
                const old = db.prepare('SELECT allocation_hash,binding_json FROM shared_blob_bindings WHERE resource_id=?').get(entry.allocation.resourceId);
                if (old && (old.allocation_hash !== hash(entry.allocation) || old.binding_json !== json(entry.binding)))
                    throw Error('shared_blob_migration_binding_conflict');
                const reservation = ledger.query(entry.owner, entry.proposal.operationId);
                if (reservation?.state === 'released')
                    throw Error('shared_blob_migration_state_conflict');
            }
            const ownedRows = db.prepare("SELECT operation_id,resource_id,binding_hash FROM (SELECT operation_id,resource_id,json_extract(tuple_json,'$.bindingHash') binding_hash,state FROM shared_capacity_reservations) WHERE operation_id LIKE 'blob-%'").all();
            for (const row of ownedRows) {
                const active = entries.find(e => e.proposal.operationId === row.operation_id);
                if (active)
                    continue;
                const released = inventory.released.find(r => r.resourceId === row.resource_id && r.allocationHash === row.binding_hash);
                if (!released)
                    throw Error('shared_blob_migration_orphan');
                const saved = db.prepare('SELECT state FROM shared_capacity_reservations WHERE operation_id=?').get(row.operation_id);
                if (saved.state !== 'released')
                    throw Error('shared_blob_migration_state_conflict');
            }
        }
        const metadata = createControllerMetadataCapacity({ database: db, authorityId, ledger });
        const api = Object.freeze({
            reserveCommand(blobCommand) {
                if (arguments.length !== 1)
                    throw Error('shared_blob_command_shape');
                const source = inspectBlobSharedReserveCommand(blobCommand, api, db);
                if (!source || source.kind !== 'reserve')
                    throw Error('shared_blob_command_brand');
                const p = source.proposal, grant = source.capacityBinding;
                let binding;
                if (grant && legacy().length)
                    throw Error('shared_blob_migration_required');
                if (grant && engineAllocations.has(grant)) {
                    const entry = engineAllocations.get(grant);
                    if (entry.allocationHash !== hash(p))
                        throw Error('shared_blob_engine_allocation');
                    binding = engineBinding(entry.owner, p);
                }
                else if (grant) {
                    const runBinding = !archiveBindings.has(grant) && !grants.has(grant) && !artifactBindings.has(grant) ? readProtectedRunCapacityBinding(grant, db) : undefined;
                    if (runBinding) {
                        if (hash(runBinding.allocation) !== hash(p))
                            throw Error('shared_blob_run_binding');
                        const source = readDockerArchiveCapacitySource(runBinding.raw, db, runBinding.expected), original = stored(source);
                        if (original.ownerKey !== p.ownerKey)
                            throw Error('shared_blob_run_owner');
                        binding = { ...original, producerKey: 'installed-protected-run', scopeDigest: p.scopeDigest, bytes: p.bytes };
                    }
                    else {
                        const derived = archiveBindings.get(grant);
                        if (derived) {
                            if (derived.database !== db || derived.allocationHash !== hash(p))
                                throw Error('shared_blob_transcript_binding');
                            binding = { ...stored(derived.read()), producerKey: 'installed-execution-transcript', bytes: p.bytes };
                        }
                        else if (artifactBindings.has(grant)) {
                            const artifact = artifactBindings.get(grant);
                            if (artifact.database !== db || artifact.allocationHash !== hash(p) || p.kind !== 'host-export')
                                throw Error('shared_blob_artifact_binding');
                            binding = { sessionKey: hash({ authorityId, component: 'artifact-export' }), producerKey: 'installed-artifact-export', ownerKey: p.ownerKey, scopeDigest: p.scopeDigest, authorityId, bytes: p.bytes, ...(p.engineBinding === undefined ? {} : { engineBinding: { ...p.engineBinding } }) };
                        }
                        else {
                            const known = grants.get(grant);
                            if (!known || known.database !== db)
                                throw Error('shared_blob_grant');
                            binding = known.read();
                            if (binding.authorityId !== authorityId || binding.ownerKey !== p.ownerKey || binding.scopeDigest !== p.scopeDigest || p.kind !== 'host-staging' || p.bytes !== binding.bytes || json(p.engineBinding) !== json(binding.engineBinding))
                                throw Error('shared_blob_binding');
                        }
                    }
                }
                else
                    binding = stored(p);
                const command = Object.freeze({}), fact = { port: api, database: db, ledger, blobCommand, allocation: p, kind: 'reserve', grant, binding, owner: owner(binding), proposal: { operationId: operation(p), resourceId: p.resourceId, generation: 1, partition: 'archive', bytes: p.bytes, bindingHash: hash(p) } };
                sharedLedgerCommands.set(command, fact);
                try {
                    ledger.reserveCommand(command);
                }
                finally {
                    sharedLedgerCommands.delete(command);
                }
            },
            commitLedgerReserveCommand(command, ledgerContext) {
                const fact = sharedLedgerCommands.get(command);
                if (!fact || fact.port !== api)
                    throw Error('shared_blob_ledger_owner');
                consumeSharedCapacityCommandContext(ledgerContext, ledger, db, command);
                const p = fact.allocation, grant = fact.grant, binding = fact.binding;
                if (fact.kind !== 'reserve') {
                    if (fact.kind === 'unallocated-release') {
                        unregisteredExisting(p);
                        const result = assertDeleted(fact.receipt, p);
                        if (result !== undefined)
                            throw Error('shared_blob_sync');
                    }
                    else
                        stored(p);
                    const context = Object.freeze({}), entry = { port: api, database: db, blobCommand: fact.blobCommand, used: false };
                    sharedReserveContexts.set(context, entry);
                    try {
                        executeBlobSharedReserveCommand(fact.blobCommand, context);
                        if (!entry.used)
                            throw Error('shared_blob_command_context');
                    }
                    finally {
                        sharedReserveContexts.delete(context);
                    }
                    return;
                }
                const old = db.prepare('SELECT allocation_hash,binding_json FROM shared_blob_bindings WHERE resource_id=?').get(p.resourceId);
                if (old && (old.allocation_hash !== hash(p) || old.binding_json !== json(binding)))
                    throw Error('shared_blob_binding');
                if (!old) {
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(binding)) + 4096 });
                    db.prepare('INSERT INTO shared_blob_bindings VALUES(?,?,?)').run(p.resourceId, hash(p), json(binding));
                }
                const context = Object.freeze({}), entry = { port: api, database: db, blobCommand: fact.blobCommand, used: false };
                sharedReserveContexts.set(context, entry);
                try {
                    executeBlobSharedReserveCommand(fact.blobCommand, context);
                    if (!entry.used)
                        throw Error('shared_blob_command_context');
                }
                finally {
                    sharedReserveContexts.delete(context);
                }
                readBlobCapacityIssuer(db, p);
                if (grant && engineAllocations.has(grant)) {
                    engineBinding(engineAllocations.get(grant).owner, p);
                }
                else if (grant) {
                    const derived = archiveBindings.get(grant);
                    if (derived)
                        derived.read();
                    else if (grants.has(grant)) {
                        if (json(grants.get(grant).read()) !== json(binding))
                            throw Error('shared_blob_material_changed');
                    }
                    else if (artifactBindings.has(grant)) {
                        const artifact = artifactBindings.get(grant);
                        if (artifact.database !== db || artifact.allocationHash !== hash(p))
                            throw Error('shared_blob_artifact_binding');
                    }
                    else {
                        const run = readProtectedRunCapacityBinding(grant, db);
                        if (hash(run.allocation) !== hash(p))
                            throw Error('shared_blob_run_binding');
                        readDockerArchiveCapacitySource(run.raw, db, run.expected);
                    }
                }
            },
            prepareControllerMetadata: metadata.prepare,
            recoverControllerMetadata: metadata.recoverPreviousWriter,
            applyControllerMetadata: metadata.apply,
            executeTransactionCommand(blobCommand) { if (arguments.length !== 1 || !inspectBlobSharedWholeCommand(blobCommand, api, db))
                throw Error('shared_blob_command_brand'); const command = Object.freeze({}); sharedWholeCommands.set(command, { port: api, database: db, ledger, blobCommand }); try {
                ledger.reserveCommand(command);
            }
            finally {
                sharedWholeCommands.delete(command);
            } },
            commitLedgerWholeCommand(command, ledgerContext) { const fact = sharedWholeCommands.get(command); if (!fact || fact.port !== api)
                throw Error('shared_blob_ledger_owner'); consumeSharedCapacityCommandContext(ledgerContext, ledger, db, command); const context = Object.freeze({}), entry = { port: api, database: db, blobCommand: fact.blobCommand, ledgerContext, used: false, checks: [] }; sharedWholeContexts.set(context, entry); try {
                executeBlobSharedWholeCommand(fact.blobCommand, context);
                if (!entry.used)
                    throw Error('shared_blob_command_context');
                for (const check of entry.checks)
                    assertBatch(check.proposals, check.capacityBinding, check.source);
            }
            finally {
                sharedWholeContexts.delete(context);
            } },
            reserveBatchCommand(blobCommand, parent) { const outer = sharedWholeContexts.get(parent); if (!outer || outer.port !== api || outer.database !== db || !outer.used || !db.inTransaction)
                throw Error('shared_blob_transaction'); const input = inspectBlobSharedBatchCommand(blobCommand, api, db); if (!input)
                throw Error('shared_blob_command_brand'); const { proposals, capacityBinding } = input, source = resolveBatch(proposals, capacityBinding), entries = proposals.map((p, i) => ({ owner: owner(source.bindings[i]), proposal: { operationId: operation(p), resourceId: p.resourceId, generation: 1, partition: 'archive', bytes: p.bytes, bindingHash: hash(p) } })), command = Object.freeze({}); sharedBatchCommands.set(command, { port: api, database: db, ledger, blobCommand, proposals, capacityBinding, source, entries }); try {
                ledger.reserveBatchCommand(command, outer.ledgerContext);
                outer.checks.push({ proposals, capacityBinding, source });
            }
            finally {
                sharedBatchCommands.delete(command);
            } },
            commitLedgerBatchCommand(command, ledgerContext) { const fact = sharedBatchCommands.get(command); if (!fact || fact.port !== api)
                throw Error('shared_blob_ledger_owner'); consumeSharedCapacityCommandContext(ledgerContext, ledger, db, command); fact.proposals.forEach((p, i) => { const binding = fact.source.bindings[i], old = db.prepare('SELECT allocation_hash,binding_json FROM shared_blob_bindings WHERE resource_id=?').get(p.resourceId); if (old && (old.allocation_hash !== hash(p) || old.binding_json !== json(binding)))
                throw Error('shared_blob_binding'); if (!old) {
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(binding)) + 4096 });
                db.prepare('INSERT INTO shared_blob_bindings VALUES(?,?,?)').run(p.resourceId, hash(p), json(binding));
            } }); const context = Object.freeze({}), entry = { port: api, database: db, blobCommand: fact.blobCommand, used: false }; sharedReserveContexts.set(context, entry); try {
                executeBlobSharedBatchCommand(fact.blobCommand, context);
                if (!entry.used)
                    throw Error('shared_blob_command_context');
            }
            finally {
                sharedReserveContexts.delete(context);
            } assertBatch(fact.proposals, fact.capacityBinding, fact.source); },
            migrateLegacy() {
                const inventory = inspectLegacyBlobInventory(db, authorityId), entries = inventory.entries.map(({ allocation: p, binding }) => ({ allocation: p, binding, owner: owner(binding), proposal: { operationId: operation(p), resourceId: p.resourceId, generation: 1, partition: 'archive', bytes: p.bytes, bindingHash: hash(p) } }));
                assertMigration(inventory, entries);
                const command = Object.freeze({});
                sharedImportCommands.set(command, { port: api, database: db, ledger, inventory, entries });
                try {
                    ledger.reserveCommand(command);
                }
                finally {
                    sharedImportCommands.delete(command);
                }
                return Object.freeze({ inventoryDigest: inventory.digest, chargedResources: entries.length, releasedResources: inventory.released.length });
            },
            commitLedgerImportCommand(command, context) { const fact = sharedImportCommands.get(command); if (!fact || fact.port !== api)
                throw Error('shared_blob_ledger_owner'); consumeSharedCapacityCommandContext(context, ledger, db, command); assertMigration(fact.inventory, fact.entries); for (const e of fact.entries) {
                if (!db.prepare('SELECT 1 FROM shared_blob_bindings WHERE resource_id=?').get(e.allocation.resourceId)) {
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(e.binding)) + 4096 });
                    db.prepare('INSERT INTO shared_blob_bindings VALUES(?,?,?)').run(e.allocation.resourceId, hash(e.allocation), json(e.binding));
                }
                const issuer = inspectBlobCapacityIssuer(db, e.allocation), encoded = json(issuer);
                if (!db.prepare('SELECT 1 FROM shared_blob_issuers WHERE resource_id=?').get(e.allocation.resourceId)) {
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + 4096 });
                    db.prepare('INSERT INTO shared_blob_issuers VALUES(?,?,?,?)').run(e.allocation.resourceId, hash(e.allocation), encoded, hash(issuer));
                }
                readBlobCapacityIssuer(db, e.allocation);
            } assertMigration(fact.inventory, fact.entries); },
            diagnoseLegacy() { return Object.freeze(legacy().map(r => Object.freeze({ resourceId: r.resource_id, allocationHash: r.tuple_hash }))); },
            recoverUnregisteredReservation(p) { const registered = db.prepare('SELECT 1 FROM shared_blob_bindings WHERE resource_id=?').get(p.resourceId); return registered ? false : unregisteredExisting(p); },
            releaseCommand(blobCommand) {
                if (arguments.length !== 1)
                    throw Error('shared_blob_command_shape');
                const source = inspectBlobSharedReserveCommand(blobCommand, api, db);
                if (!source || source.kind !== 'release' || !source.proof)
                    throw Error('shared_blob_command_brand');
                const p = source.proposal, proof = source.proof, registered = !!db.prepare('SELECT 1 FROM shared_blob_bindings WHERE resource_id=?').get(p.resourceId);
                if (!registered)
                    unregisteredExisting(p);
                const deleted = assertDeleted(proof, p);
                if (deleted !== undefined)
                    throw Error('shared_blob_sync');
                const binding = registered ? stored(p) : undefined, token = binding ? owner(binding) : undefined, id = operation(p);
                if (registered && p.bytes > 0) {
                    releaseProofs.set(proof, p);
                    ledger.requestRelease(token, id);
                }
                const command = Object.freeze({}), fact = { port: api, database: db, ledger, blobCommand, allocation: p, kind: (registered ? 'release' : 'unallocated-release'), receipt: proof, binding: binding, owner: token, proposal: { operationId: id, resourceId: p.resourceId, generation: 1, partition: 'archive', bytes: p.bytes, bindingHash: hash(p) } };
                sharedLedgerCommands.set(command, fact);
                try {
                    ledger.reserveCommand(command);
                }
                finally {
                    sharedLedgerCommands.delete(command);
                }
            },
            usage: ledger.usage, close() { ledger.close(); ports.delete(api); },
        });
        ports.set(api, { database: db, authorityId, authority, state });
        finishInstalledCapacityLayer(authority, 'shared', api);
        return api;
    }
    catch (error) {
        failInstalledCapacityLayer(authority, 'shared');
        throw error;
    }
}
