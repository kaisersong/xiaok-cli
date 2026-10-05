import { buildDockerWorkerRequest } from '../isolated-execution/docker-request.js';
import { createHash } from 'node:crypto';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { readMaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { assertInstalledSharedCapacity, registerInstalledCapacityIssuer } from './installed-shared-capacity.js';
import { createDockerRunner } from '../isolated-execution/docker-runner.js';
import { DockerEngineTransport } from '../isolated-execution/docker-engine-transport.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { runVerificationTransaction } from './storage-budget.js';
const hash = (x) => createHash('sha256').update(json(x)).digest('hex');
const maintenanceDeletionFacts = new WeakMap();
const instances = new WeakMap();
export function readMaintenanceExecution(value, database) { const known = instances.get(value); if (!known || known.database !== database)
    throw Error('maintenance_execution_identity'); known.current(); return known.binding; }
export function assertMaintenanceProbeDeleted(value, database, proof, proposal) { const known = instances.get(value); if (!known || known.database !== database)
    throw Error('maintenance_execution_identity'); known.current(); const facts = maintenanceDeletionFacts.get(known.binding), allocation = facts?.deleted.get(proof); if (!facts || facts.database !== database || !allocation || hash(allocation) !== hash(proposal))
    throw Error('maintenance_probe_deletion'); }
function build(input) {
    const { lifetime, attachment, sharedCapacity } = input;
    assertInstalledControllerLifetime(lifetime);
    assertInstalledSharedCapacity(sharedCapacity, lifetime);
    const db = lifetime.database, facts = readMaintenanceEngineAttachment(attachment, lifetime), budget = sharedCapacity.budget, inspectAttachment = attachment.inspect.bind(attachment);
    let closed = false, closing = false, pending;
    function current() { if (closed)
        throw Error('maintenance_execution_closed'); assertInstalledControllerLifetime(lifetime); assertInstalledSharedCapacity(sharedCapacity, lifetime); readMaintenanceEngineAttachment(attachment, lifetime); }
    const actualTransport = new DockerEngineTransport({ socketPath: facts.hostSocket }), methods = new Map();
    for (const name of ['inspect', 'isContainerAbsent', 'isVolumeAbsent', 'remove', 'removeVolume', 'kill', 'wait', 'findMountedAttempt', 'inspectVolume']) {
        const call = actualTransport[name].bind(actualTransport);
        methods.set(name, async (...args) => { await inspectAttachment(); current(); const result = await call(...args); await inspectAttachment(); current(); return result; });
    }
    const transport = new Proxy(actualTransport, { get(_target, key) { const method = methods.get(key); if (!method)
            throw Error('maintenance_transport_method'); return method; } }), raw = createDockerRunner({ database: db, budget, engine: transport, engineBinding: facts.engineBinding, imageId: facts.imageDigest, assertCurrent: current, stager: { getManifest() { throw Error('maintenance_execution_no_admission'); }, readFile() { throw Error('maintenance_execution_no_admission'); } }, outputBytes: 16 * 1024 ** 2 }), journal = new ExecutionJournal({ database: db });
    const receipts = new WeakMap(), deleted = new WeakMap();
    function allocationFor(expected) { const proposal = journal.read(expected).proposal; if (proposal.engineBindingId !== facts.engineBinding.engineId || proposal.engineEpoch !== 1 || proposal.imageId !== facts.imageDigest || proposal.materializationDigest !== hash([]) || expected.compoundOperationId !== expected.validationInvocationId)
        throw Error('maintenance_probe_binding'); const rows = db.prepare("SELECT tuple_json,tuple_hash,owner_key,resource_id,bytes,state FROM verification_blob_reservations WHERE resource_id=?").all('qualification-' + expected.executionIdentity); if (rows.length !== 1)
        throw Error('maintenance_probe_unknown'); const allocation = JSON.parse(rows[0].tuple_json); if (rows[0].tuple_hash !== hash(allocation) || rows[0].owner_key !== allocation.ownerKey || rows[0].resource_id !== allocation.resourceId || rows[0].bytes !== allocation.bytes || !['reserved', 'released'].includes(rows[0].state) || allocation.ownerKey !== 'private-engine-qualification' || allocation.resourceId !== 'qualification-' + expected.executionIdentity || allocation.kind !== 'guest-output' || allocation.bytes !== 32 * 1024 ** 2 || allocation.scopeDigest !== expected.scopeDigest || json(allocation.engineBinding) !== json({ engineId: facts.engineBinding.engineId, incarnation: facts.engineBinding.incarnation }) || expected.sessionIdentity !== 'private-engine-qualification')
        throw Error('maintenance_probe_binding'); return { allocation, state: rows[0].state }; }
    function probeRecord(expected) { const row = db.prepare('SELECT record_json FROM verification_engine_qualification WHERE id=1').get(); if (!row)
        return undefined; if (Buffer.byteLength(row.record_json) > 65536)
        throw Error('maintenance_probe_unknown'); const record = JSON.parse(row.record_json); if (json(record.expected) !== json(expected))
        return undefined; if (record.engineHash !== facts.engineBinding.incarnation || hash(record.allocation) !== hash(allocationFor(expected).allocation) || journal.read(expected).proposal.commandDigest !== hash(record.body?.Cmd) || hash(record.body) !== hash(buildDockerWorkerRequest({ imageDigest: facts.imageDigest, argv: record.body.Cmd, attemptId: expected.executionIdentity, scopeDigest: expected.scopeDigest })))
        throw Error('maintenance_probe_binding'); return record; }
    function isRaw(expected) { return !!db.prepare('SELECT 1 FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity); }
    async function inspectExactProbe(record, id) { const actual = await transport.inspect(id); if (actual.Image !== facts.imageDigest || hash(actual.Config.Cmd) !== hash(record.body.Cmd) || hash(actual.Config.Labels) !== hash(record.body.Labels))
        throw Error('maintenance_probe_binding'); for (const [key, value] of Object.entries(record.body.HostConfig)) {
        const found = actual.HostConfig[key];
        if (key === 'RestartPolicy' && hash(found) === hash({ Name: 'no', MaximumRetryCount: 0 }))
            continue;
        if (hash(found) !== hash(value))
            throw Error('maintenance_probe_binding');
    } return actual; }
    async function inspectProbe(expected) {
        const allocation = allocationFor(expected), state = journal.read(expected), record = probeRecord(expected);
        if (allocation.state === 'released') {
            if (state.state !== 'terminal' || !state.containerId && !state.cancelledBeforeStart || state.containerId && !await transport.isContainerAbsent(state.containerId))
                throw Error('maintenance_probe_unknown');
            return;
        }
        if (!record)
            throw Error('maintenance_probe_unknown');
        if (state.cancelledBeforeStart && !state.containerId)
            return;
        if (!state.containerId)
            throw Error('maintenance_probe_unknown');
        if (await transport.isContainerAbsent(state.containerId)) {
            if (state.state !== 'terminal')
                throw Error('maintenance_probe_unknown');
            return;
        }
        const actual = await inspectExactProbe(record, state.containerId);
        if (actual.State.Running || actual.State.Pid !== 0 || actual.State.Status !== 'exited' || !Number.isSafeInteger(actual.State.ExitCode))
            throw Error('maintenance_probe_not_terminal');
        journal.recordPhysicalTerminal(expected, state.containerId, actual.State.ExitCode);
    }
    function serialized(work) { current(); if (closing || pending || db.inTransaction)
        throw Error('maintenance_execution_busy'); const result = Promise.resolve().then(work); pending = result; void result.then(() => { if (pending === result)
        pending = undefined; }, () => { if (pending === result)
        pending = undefined; }); return result; }
    async function inspectFacts(expected) { await inspectAttachment(); current(); if (isRaw(expected)) {
        const row = raw.readExecution(expected);
        if (row.cancelledBeforeStart)
            await raw.inspectCancellationFacts(expected);
        else
            await raw.inspectExecutionFacts(expected);
    }
    else
        await inspectProbe(expected); await inspectAttachment(); current(); if (journal.read(expected).state !== 'terminal')
        throw Error('maintenance_execution_unknown'); const receipt = Object.freeze({}); receipts.set(receipt, { expected, recordHash: hash(journal.read(expected)) }); return receipt; }
    function assertReceipt(receipt, expected) { current(); const known = receipts.get(receipt); if (!known || json(known.expected) !== json(expected) || known.recordHash !== hash(journal.read(expected)) || journal.read(expected).state !== 'terminal')
        throw Error('maintenance_quiescence_receipt'); }
    function inventory() { current(); const rawRows = db.prepare('SELECT execution_id,resources_json FROM docker_runner_resources ORDER BY execution_id').all(), attempts = db.prepare('SELECT * FROM execution_attempts ORDER BY execution_id').all(), ids = new Set(rawRows.map(r => r.execution_id)), expected = []; for (const row of attempts) {
        const p = JSON.parse(row.proposal_json), e = { sessionIdentity: p.sessionIdentity, compoundOperationId: p.compoundOperationId, validationInvocationId: p.validationInvocationId, executionIdentity: row.execution_id, scopeDigest: p.scopeDigest };
        if (row.state !== 'terminal' || p.engineBindingId !== facts.engineBinding.engineId || p.engineEpoch !== 1 || p.imageId !== facts.imageDigest)
            throw Error('maintenance_inventory_unknown');
        if (ids.delete(row.execution_id)) {
            if (json(raw.readExecution(e).expected) !== json(e))
                throw Error('maintenance_inventory_unknown');
        }
        else
            allocationFor(e);
        expected.push(Object.freeze(e));
    } if (ids.size)
        throw Error('maintenance_inventory_unknown'); const probeTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_engine_qualification'").get(), probes = probeTable ? db.prepare('SELECT * FROM verification_engine_qualification ORDER BY id').all() : [], allocations = db.prepare("SELECT resource_id,tuple_json,state FROM verification_blob_reservations WHERE owner_key='private-engine-qualification' ORDER BY resource_id").all(); return { hash: hash({ rawRows, attempts, probes, allocations }), expected }; }
    const api = Object.freeze({ disposeUnstarted() { if (pending)
            throw Error('maintenance_execution_busy'); raw.close(); journal.close(); closed = true; }, assertCurrent: current, raw, inventory, ensureCurrent: inspectAttachment,
        inspectExecution(rawExpected) { const expected = JSON.parse(json(rawExpected)); return serialized(() => inspectFacts(expected)); }, assertQuiescent: assertReceipt,
        cleanupExecution(rawExpected) { const expected = JSON.parse(json(rawExpected)); return serialized(async () => { await inspectAttachment(); current(); if (isRaw(expected)) {
            if (raw.readExecution(expected).state === 'prepared')
                raw.cancelPreparedExecution(expected);
            await raw.cleanupExecution(expected);
        }
        else {
            const { allocation, state } = allocationFor(expected), originalRecord = probeRecord(expected);
            let before = journal.read(expected);
            if (originalRecord && before.state === 'prepared') {
                journal.cancelPrepared(expected);
                before = journal.read(expected);
            }
            if (originalRecord && ['created', 'cancelling-created'].includes(before.state)) {
                if (before.state === 'created')
                    journal.beginCancelCreated(expected, before.containerId);
                const id = before.containerId;
                if (!await transport.isContainerAbsent(id)) {
                    const actual = await inspectExactProbe(originalRecord, id);
                    if (actual.State.Running || actual.State.Pid !== 0 || actual.State.Status !== 'created')
                        throw Error('maintenance_probe_unknown');
                    await transport.remove(id);
                }
                if (!await transport.isContainerAbsent(id))
                    throw Error('maintenance_probe_unknown');
                journal.recordCancelledCreated(expected, id);
            }
            await inspectProbe(expected);
            const record = probeRecord(expected), terminal = journal.read(expected);
            if (state !== 'released') {
                if (!record || terminal.state !== 'terminal')
                    throw Error('maintenance_probe_unknown');
                if (terminal.containerId && !await transport.isContainerAbsent(terminal.containerId))
                    await transport.remove(terminal.containerId);
                if (terminal.containerId && !await transport.isContainerAbsent(terminal.containerId))
                    throw Error('maintenance_probe_unknown');
                await inspectAttachment();
                current();
                record.deleted = true;
                runVerificationTransaction(db, () => { db.prepare('UPDATE verification_engine_qualification SET record_json=? WHERE id=1').run(json(record)); });
                const proof = Object.freeze({});
                deleted.set(proof, allocation);
                budget.release(budget.reserve(allocation).token, proof);
            }
        } await inspectAttachment(); return inspectFacts(expected); }); },
        deletionAuthority: Object.freeze({ assertDeleted(proof, proposal) { current(); const known = deleted.get(proof); if (!known || hash(known) !== hash(proposal))
                throw Error('maintenance_probe_deletion'); } }),
        async close() { closing = true; const work = pending; if (work)
            await work; raw.close(); journal.close(); closed = true; }, });
    maintenanceDeletionFacts.set(api, { database: db, deleted });
    return api;
}
export function createInstalledMaintenanceExecution(input) { const { lifetime, attachment, sharedCapacity } = input; const fixed = Object.freeze({ lifetime, attachment, sharedCapacity }), binding = build(fixed), value = Object.freeze({ inspectExecution: binding.inspectExecution, cleanupExecution: binding.cleanupExecution, assertQuiescent: binding.assertQuiescent, close: binding.close, deletionAuthority: binding.deletionAuthority }); instances.set(value, { database: lifetime.database, current: binding.assertCurrent, binding }); try {
    registerInstalledCapacityIssuer(sharedCapacity, 'execution', binding.raw);
    registerInstalledCapacityIssuer(sharedCapacity, 'maintenance-probe', value);
}
catch (error) {
    try {
        binding.disposeUnstarted();
    }
    catch (cleanup) {
        throw new AggregateError([error, cleanup], 'maintenance_execution_construction_unknown');
    }
    throw error;
} return value; }
