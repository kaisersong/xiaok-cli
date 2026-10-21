import { canonicalVerificationJson as json } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
function clone(value) { return JSON.parse(json(value)); }
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('engine_bootstrap_shape'); }
function proposal(raw) { const p = clone(raw); exact(p, ['deploymentHash', 'configHash', 'creationNonce', 'vmName']); if (p.vmName !== 'xiaok-engine' || ![p.deploymentHash, p.configHash, p.creationNonce].every(x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)))
    throw Error('engine_bootstrap_proposal'); return p; }
/** Private durable intent only. Neither rows nor observations are qualification
 * capabilities. Installed code must collect kernel/VM/engine evidence separately. */
export function createEngineBootstrapJournal(db) {
    function boundary() { if (db.inTransaction)
        throw Error('engine_bootstrap_outer_transaction'); }
    boundary();
    db.exec('CREATE TABLE IF NOT EXISTS verification_engine_bootstrap(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL,state TEXT NOT NULL)');
    // Starting this journal is a new controller lifetime, never a reason to replay creation.
    runVerificationTransaction(db, () => { db.prepare("UPDATE verification_engine_bootstrap SET state='unknown' WHERE state IN ('create_started','observed')").run(); });
    function read() { const row = db.prepare('SELECT record_json,state FROM verification_engine_bootstrap WHERE id=1').get(); if (!row)
        return undefined; if (Buffer.byteLength(row.record_json) > 65536 || !['prepared', 'create_started', 'unknown', 'observed'].includes(row.state))
        throw Error('engine_bootstrap_record'); const record = JSON.parse(row.record_json); proposal(record.proposal); return { ...record, state: row.state }; }
    function same(p) { const row = read(); if (!row || json(row.proposal) !== json(p))
        throw Error('engine_bootstrap_conflict'); return row; }
    return Object.freeze({
        read() { const value = read(); return value ? clone(value) : undefined; },
        prepare(raw) { boundary(); const p = proposal(raw); runVerificationTransaction(db, () => { const row = read(); if (row) {
            if (json(row.proposal) !== json(p))
                throw Error('engine_bootstrap_conflict');
            return;
        } const encoded = json({ proposal: p }); assertVerificationDatabaseBudget(db, { additionalBytes: 65536 + 4096 }); db.prepare("INSERT INTO verification_engine_bootstrap VALUES(1,?,'prepared')").run(encoded); }); },
        beginCreate(raw) { boundary(); const p = proposal(raw); runVerificationTransaction(db, () => { if (same(p).state !== 'prepared')
            throw Error('engine_bootstrap_replay'); db.prepare("UPDATE verification_engine_bootstrap SET state='create_started' WHERE id=1").run(); }); },
        recordVm(raw, input) {
            boundary();
            const p = proposal(raw), vm = clone(input);
            exact(vm, ['machineId', 'bootId', 'effectiveConfigHash', 'creationNonce', 'processUid', 'processStartIdentity']);
            if (vm.effectiveConfigHash !== p.configHash || vm.creationNonce !== p.creationNonce || !Number.isSafeInteger(vm.processUid) || vm.processUid < 1 || ![vm.machineId, vm.bootId, vm.processStartIdentity].every(x => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 256 && !/[\x00-\x1f\x7f]/.test(x)))
                throw Error('engine_vm_observation');
            runVerificationTransaction(db, () => { const row = same(p); const previousVm = row.vm ?? (row.observation ? (({ engineId, ...rest }) => { void engineId; return rest; })(row.observation) : undefined); if (row.state === 'prepared' || previousVm && json(previousVm) !== json(vm))
                throw Error('engine_vm_changed'); const { state, ...saved } = row; void state; db.prepare('UPDATE verification_engine_bootstrap SET record_json=? WHERE id=1').run(json({ ...saved, vm })); });
        },
        phase(raw, name, digest, complete = false) {
            boundary();
            const p = proposal(raw), names = ['copy-engine', 'install-engine', 'load-worker'];
            if (!names.includes(name) || !/^[a-f0-9]{64}$/.test(digest) || typeof complete !== 'boolean')
                throw Error('engine_phase_shape');
            runVerificationTransaction(db, () => { const row = same(p); if (!row.vm || row.state === 'prepared')
                throw Error('engine_phase_vm_required'); const phases = row.phases ?? {}, existing = phases[name]; if (existing && existing.digest !== digest)
                throw Error('engine_phase_conflict'); if (complete && !existing)
                throw Error('engine_phase_not_started'); if (names.slice(0, names.indexOf(name)).some(n => phases[n]?.state !== 'complete'))
                throw Error('engine_phase_order'); const { state, ...saved } = row; void state; const encoded = json({ ...saved, phases: { ...phases, [name]: { digest, state: complete || existing?.state === 'complete' ? 'complete' : 'started' } } }); assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + 4096 }); db.prepare('UPDATE verification_engine_bootstrap SET record_json=? WHERE id=1').run(encoded); });
        },
        recordObservation(raw, input) {
            boundary();
            const p = proposal(raw), o = clone(input);
            exact(o, ['machineId', 'bootId', 'engineId', 'effectiveConfigHash', 'creationNonce', 'processUid', 'processStartIdentity']);
            if (o.effectiveConfigHash !== p.configHash || o.creationNonce !== p.creationNonce || !Number.isSafeInteger(o.processUid) || o.processUid < 1 || o.processUid >= 0xffffffff || ![o.machineId, o.bootId, o.engineId, o.processStartIdentity].every(x => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 256 && !/[\x00-\x1f\x7f]/.test(x)))
                throw Error('engine_bootstrap_observation');
            runVerificationTransaction(db, () => { const row = same(p); const { engineId, ...vm } = o; void engineId; if (row.vm && json(row.vm) !== json(vm))
                throw Error('engine_vm_changed'); if (!['create_started', 'unknown', 'observed'].includes(row.state) || row.observation && json(row.observation) !== json(o))
                throw Error('engine_bootstrap_observation_changed'); const { state: unusedState, ...saved } = row; void unusedState; const encoded = json({ ...saved, proposal: p, observation: o }); if (Buffer.byteLength(encoded) > 65536)
                throw Error('engine_bootstrap_limit'); assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(encoded) + 4096 }); db.prepare("UPDATE verification_engine_bootstrap SET record_json=?,state='observed' WHERE id=1").run(encoded); });
        },
    });
}
/** Read-only maintenance view. Unlike creating the journal, this never changes
 * the original lifetime state or creates a missing table. Not an engine grant. */
export function readExistingEngineBootstrap(db) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='verification_engine_bootstrap'").get())
        throw Error('maintenance_engine_missing');
    const row = db.prepare('SELECT record_json,state FROM verification_engine_bootstrap WHERE id=1').get();
    if (!row)
        throw Error('maintenance_engine_missing');
    if (Buffer.byteLength(row.record_json) > 65536)
        throw Error('engine_bootstrap_record');
    const value = JSON.parse(row.record_json), p = proposal(value.proposal);
    if (!['observed', 'unknown'].includes(row.state) || !value.observation || !value.vm || !value.phases)
        throw Error('maintenance_engine_incomplete');
    exact(value, ['proposal', 'observation', 'vm', 'phases']);
    exact(value.phases, ['copy-engine', 'install-engine', 'load-worker']);
    for (const name of ['copy-engine', 'install-engine', 'load-worker']) {
        const phase = value.phases[name];
        if (!phase)
            throw Error('maintenance_engine_incomplete');
        exact(phase, ['digest', 'state']);
        if (phase.state !== 'complete')
            throw Error('maintenance_engine_incomplete');
        if (!/^[a-f0-9]{64}$/.test(phase.digest))
            throw Error('engine_phase_shape');
    }
    const o = value.observation;
    exact(o, ['machineId', 'bootId', 'engineId', 'effectiveConfigHash', 'creationNonce', 'processUid', 'processStartIdentity']);
    if (o.effectiveConfigHash !== p.configHash || o.creationNonce !== p.creationNonce || !Number.isSafeInteger(o.processUid) || o.processUid < 1 || o.processUid >= 0xffffffff || ![o.machineId, o.bootId, o.engineId, o.processStartIdentity].every(x => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 256 && !/[\x00-\x1f\x7f]/.test(x)))
        throw Error('engine_bootstrap_observation');
    const { engineId, ...vm } = o;
    void engineId;
    if (json(vm) !== json(value.vm))
        throw Error('engine_vm_changed');
    return Object.freeze({ ...clone(value), proposal: p, observation: clone(o), vm: clone(vm), phases: clone(value.phases), state: row.state });
}
