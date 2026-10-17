import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
function fail() { throw Error('shared_capacity_replacement_changed'); }
const hash = (s) => createHash('sha256').update(s).digest('hex');
export function assertMetadataReplacementFees(f) {
    const old = new Map(), next = new Map();
    const add = (m, session, partition, bytes) => { const key = json([session, partition]), value = (m.get(key) ?? 0) + bytes; if (!Number.isSafeInteger(value) || value < 1)
        throw Error('shared_capacity_replacement_fees'); m.set(key, value); };
    for (const item of f.old) {
        add(old, '', item.record.partition, item.record.bytes);
        add(old, item.record.sessionKey, item.record.partition, item.record.bytes);
        for (const a of item.attributions)
            add(old, a.beneficiarySessionKey, item.record.partition, item.record.bytes);
    }
    for (const item of f.targets) {
        add(next, '', item.proposal.partition, item.proposal.bytes);
        for (const s of [item.owner, ...item.beneficiaries])
            add(next, s.sessionKey, item.proposal.partition, item.proposal.bytes);
    }
    if (old.size !== next.size || [...old].some(([k, v]) => next.get(k) !== v))
        throw Error('shared_capacity_replacement_fees');
}
export function capacityRecordTuple(record) { const { state, revision, wasUnknown, ...tuple } = record; void state; void revision; void wasUnknown; return tuple; }
export function capacityAttributionTuple(record) { const { charged, ...tuple } = record; void charged; return tuple; }
export function metadataReplacementResultHash(result) { return hash(json(result)); }
/** Read-only audit of the original ledger, under its caller's one SQL snapshot.
 * No owner/proof issuance and no mutations live in this module. */
export function assertMetadataReplacementLineage(db, poolId, authorityId) {
    const preparations = db.prepare('SELECT * FROM shared_metadata_replacements ORDER BY rowid').all();
    const commits = db.prepare('SELECT * FROM shared_metadata_replacement_commits ORDER BY commit_sequence').all();
    const transfers = db.prepare('SELECT * FROM shared_capacity_transfers ORDER BY operation_id').all();
    const claims = db.prepare('SELECT * FROM shared_metadata_replacement_claims ORDER BY operation_id').all();
    const consumptions = db.prepare('SELECT * FROM shared_metadata_replacement_consumptions ORDER BY operation_id').all();
    const resources = db.prepare('SELECT * FROM shared_metadata_replacement_resource_claims ORDER BY operation_id').all();
    if ([preparations, commits, transfers, claims, consumptions, resources].some(v => v.length > 131072))
        fail();
    const prepared = new Map(), committed = new Map(commits.map(v => [v.replacement_id, v])), incoming = new Map(), outgoing = new Map(consumptions.map(v => [v.operation_id, v])), transfer = new Map(transfers.map(v => [v.operation_id, v])), claim = new Map(claims.map(v => [v.operation_id, v])), resource = new Map(resources.map(v => [v.operation_id, v]));
    for (const p of preparations) {
        let f;
        try {
            f = JSON.parse(p.request_json);
        }
        catch {
            fail();
        }
        if (p.state !== 'prepared' || json(f) !== p.request_json || hash(p.request_json) !== p.request_hash || f.poolId !== poolId || f.authorityId !== authorityId || f.replacementId !== p.replacement_id || f.intentId !== p.intent_id || !Array.isArray(f.old) || !Array.isArray(f.targets) || f.targets.length < 1 || f.targets.length > 16)
            fail();
        assertMetadataReplacementFees(f);
        prepared.set(p.replacement_id, f);
        const seen = new Set();
        for (const old of f.old) {
            const id = old.record.operationId;
            if (seen.has(id) || !['source', 'staging', 'unused'].includes(old.role))
                fail();
            seen.add(id);
            const c = outgoing.get(id);
            if (!c || c.replacement_id !== p.replacement_id || c.role !== old.role)
                fail();
            const initial = claim.get(id);
            if (!initial || !(initial.replacement_id === p.replacement_id && initial.role === old.role || initial.role === 'target' && committed.has(initial.replacement_id)))
                fail();
        }
        for (const t of f.targets) {
            const id = t.proposal.operationId;
            if (seen.has(id) || incoming.has(id))
                fail();
            seen.add(id);
            incoming.set(id, p.replacement_id);
            const c = claim.get(id), r = resource.get(id);
            if (!c || c.replacement_id !== p.replacement_id || c.role !== 'target' || !r || r.replacement_id !== p.replacement_id || r.producer_key !== t.owner.producerKey || r.resource_id !== t.proposal.resourceId || r.generation !== t.proposal.generation)
                fail();
        }
    }
    for (const c of claims) {
        const f = prepared.get(c.replacement_id);
        if (!f || (c.role === 'target' ? !f.targets.some(t => t.proposal.operationId === c.operation_id) : !f.old.some(o => o.record.operationId === c.operation_id && o.role === c.role)))
            fail();
    }
    if (resources.length !== incoming.size || consumptions.length !== [...prepared.values()].reduce((n, f) => n + f.old.length, 0))
        fail();
    const raw = (operationId) => db.prepare('SELECT * FROM shared_capacity_reservations WHERE operation_id=?').get(operationId);
    const attrs = (operationId) => db.prepare('SELECT * FROM shared_capacity_session_attributions WHERE operation_id=? ORDER BY beneficiary_session_key').all(operationId);
    const validateTuple = (r, expected) => {
        if (!r)
            fail();
        const encoded = json(capacityRecordTuple(expected));
        if (r.tuple_json !== encoded || r.tuple_hash !== hash(encoded) || r.operation_id !== expected.operationId || r.session_key !== expected.sessionKey || r.producer_key !== expected.producerKey || r.resource_id !== expected.resourceId || r.generation !== expected.generation || r.partition_name !== expected.partition || r.bytes !== expected.bytes || !Number.isSafeInteger(r.revision) || r.revision < 1 || !['reserved', 'committed', 'release_pending', 'released', 'unknown'].includes(r.state) || ![0, 1].includes(r.was_unknown))
            fail();
        return r;
    };
    const validateAttrs = (r, expected, exact) => {
        const current = attrs(r.operation_id), seen = new Set();
        for (const a of current) {
            let t;
            try {
                t = JSON.parse(a.attribution_json);
            }
            catch {
                fail();
            }
            if (json(t) !== a.attribution_json || hash(a.attribution_json) !== a.attribution_hash || a.operation_id !== r.operation_id || a.physical_tuple_hash !== r.tuple_hash || t.poolId !== poolId || t.operationId !== r.operation_id || t.physicalTupleHash !== r.tuple_hash || t.physicalSessionKey !== r.session_key || t.physicalProducerKey !== r.producer_key || t.bytes !== r.bytes || t.beneficiarySessionKey !== a.beneficiary_session_key || t.beneficiaryProducerKey !== a.beneficiary_producer_key || t.beneficiarySessionKey === r.session_key || seen.has(t.beneficiarySessionKey))
                fail();
            seen.add(t.beneficiarySessionKey);
        }
        if (exact && current.length !== expected.length)
            fail();
        const bySession = new Map(current.map(a => [a.beneficiary_session_key, a]));
        for (const e of expected) {
            const a = bySession.get(e.beneficiarySessionKey);
            if (!a || a.attribution_json !== json(capacityAttributionTuple(e)))
                fail();
        }
    };
    const results = new Map(), preparationRows = new Map(preparations.map(p => [p.replacement_id, p]));
    let previousSequence = 0;
    for (const c of commits) {
        const f = prepared.get(c.replacement_id), p = preparationRows.get(c.replacement_id);
        let result;
        try {
            result = JSON.parse(c.result_json);
        }
        catch {
            fail();
        }
        if (!f || !p || !Number.isSafeInteger(c.commit_sequence) || c.commit_sequence <= previousSequence || c.intent_id !== f.intentId || c.request_hash !== p.request_hash || json(result) !== c.result_json || result.replacementId !== f.replacementId || result.intentId !== f.intentId || result.requestHash !== c.request_hash || result.commitSequence !== c.commit_sequence || result.state !== 'committed' || !Array.isArray(result.old) || !Array.isArray(result.targets) || result.old.length !== f.old.length || result.targets.length !== f.targets.length)
            fail();
        previousSequence = c.commit_sequence;
        const { resultHash, ...core } = result;
        if (resultHash !== c.result_hash || metadataReplacementResultHash(core) !== resultHash)
            fail();
        results.set(c.replacement_id, result);
        for (let i = 0; i < f.old.length; i++) {
            const before = f.old[i], after = result.old[i];
            if (after.role !== before.role || json(capacityRecordTuple(after.record)) !== json(capacityRecordTuple(before.record)) || after.record.state !== (before.role === 'source' ? 'released' : 'transferred') || after.record.revision !== before.record.revision + 1 || after.record.wasUnknown !== before.record.wasUnknown || json(after.attributions) !== json(before.attributions.map(a => ({ ...a, charged: false }))))
                fail();
            const r = validateTuple(raw(before.record.operationId), before.record);
            validateAttrs(r, before.attributions, true);
            if (before.role === 'source') {
                if (r.state !== 'released' || r.revision !== after.record.revision || r.was_unknown !== (before.record.wasUnknown ? 1 : 0) || transfer.has(before.record.operationId))
                    fail();
            }
            else {
                const t = transfer.get(before.record.operationId);
                if (!t || t.state !== 'transferred' || t.replacement_id !== c.replacement_id || t.tuple_hash !== r.tuple_hash || t.revision !== after.record.revision || r.state !== before.record.state || r.revision !== before.record.revision || r.was_unknown !== (before.record.wasUnknown ? 1 : 0))
                    fail();
            }
            const parent = incoming.get(before.record.operationId);
            if (parent) {
                const pc = committed.get(parent);
                if (!pc || pc.commit_sequence >= c.commit_sequence)
                    fail();
            }
        }
        for (let i = 0; i < f.targets.length; i++) {
            const t = f.targets[i], initial = result.targets[i], tuple = { ...t.proposal, poolId, ...t.owner }, expectedState = t.proposal.partition === 'rollback' ? 'reserved' : 'committed';
            if (json(capacityRecordTuple(initial.record)) !== json(tuple) || initial.record.state !== expectedState || initial.record.revision !== (expectedState === 'committed' ? 2 : 1) || initial.record.wasUnknown || initial.attributions.length !== t.beneficiaries.length)
                fail();
            const r = validateTuple(raw(t.proposal.operationId), initial.record);
            if (r.revision < initial.record.revision)
                fail();
            validateAttrs(r, initial.attributions, false);
            for (let j = 0; j < t.beneficiaries.length; j++) {
                const b = t.beneficiaries[j], a = initial.attributions[j];
                if (json(capacityAttributionTuple(a)) !== json({ poolId, operationId: t.proposal.operationId, physicalTupleHash: hash(json(tuple)), physicalSessionKey: t.owner.sessionKey, physicalProducerKey: t.owner.producerKey, beneficiarySessionKey: b.sessionKey, beneficiaryProducerKey: b.producerKey, bytes: t.proposal.bytes }) || !a.charged)
                    fail();
            }
        }
    }
    for (const t of transfers) {
        const f = prepared.get(t.replacement_id);
        if (!committed.has(t.replacement_id) || !f?.old.some(v => v.record.operationId === t.operation_id && v.role !== 'source'))
            fail();
    }
    for (const [id, f] of prepared) {
        if (committed.has(id))
            continue;
        for (const o of f.old) {
            const r = validateTuple(raw(o.record.operationId), o.record);
            if (r.state !== o.record.state || r.revision !== o.record.revision || r.was_unknown !== (o.record.wasUnknown ? 1 : 0) || transfer.has(o.record.operationId))
                fail();
            validateAttrs(r, o.attributions, true);
        }
        for (const t of f.targets)
            if (raw(t.proposal.operationId) || db.prepare('SELECT 1 FROM shared_capacity_reservations WHERE producer_key=? AND resource_id=? AND generation=?').get(t.owner.producerKey, t.proposal.resourceId, t.proposal.generation))
                fail();
    }
    // Audit every edge in reverse commit order. Strictly increasing outgoing
    // sequence numbers are already checked above; this iterative topological pass
    // requires ALL children and has no recursive stack/depth truncation.
    const resolved = new Set();
    for (const c of [...commits].reverse()) {
        const result = results.get(c.replacement_id);
        if (!result)
            fail();
        for (const t of result.targets) {
            const edge = outgoing.get(t.record.operationId);
            if (edge) {
                const next = committed.get(edge.replacement_id);
                if (next && next.commit_sequence <= c.commit_sequence)
                    fail();
            }
            if (transfer.has(t.record.operationId) && !resolved.has(t.record.operationId))
                fail();
        }
        for (const old of result.old)
            if (old.role !== 'source')
                resolved.add(old.record.operationId);
    }
    for (const t of transfers)
        if (!resolved.has(t.operation_id))
            fail();
}
