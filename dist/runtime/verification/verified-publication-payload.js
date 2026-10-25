import { assertIntentParentPublication, intentParentPublicationVector } from './intent-parent-publication.js';
import { assertIntentApplicationArtifacts } from './intent-application-artifacts.js';
import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { parseActiveBusinessApplicationBinding, businessApplicationOwner } from './business-application-binding.js';
import { assertLoopApplicationArtifacts } from './loop-application-artifacts.js';
import { canonicalVerificationJson, parseVerificationTuple, verificationDependencyKey, compareVerificationDependencies, VERIFICATION_BUDGET } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
const json = canonicalVerificationJson, hash = (value) => createHash('sha256').update(value).digest('hex');
function ownerKey(raw) { const value = JSON.parse(json(raw)); if (Object.keys(value).sort().join(',') !== 'ownerId,ownerKind,profileId' || !['task', 'intent', 'goal', 'loop', 'project'].includes(value.ownerKind) || [value.profileId, value.ownerId].some(v => typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v)))
    throw Error('publication_owner'); return json(value); }
/** Private installed-controller composition. References and read results confer no ACL.
 * The exact connection is shared with proof/outbox. No caller bytes are accepted.
 */
export function createVerifiedPublicationPayloads(input) {
    const { database: db, getCurrentDependencies, assertCurrent } = input, exportEvidence = input.recipes.exportVerifiedArtifacts.bind(input.recipes);
    const inspectOwner = input.inspectOwner?.bind(input), assertPublicationTuplesCurrent = input.assertPublicationTuplesCurrent?.bind(input);
    const rawAuthority = input.proofAuthority, proofAuthority = rawAuthority ? Object.freeze({ issuerId: rawAuthority.issuerId, keyId: rawAuthority.keyId, serviceEpoch: rawAuthority.serviceEpoch, verifierHash: rawAuthority.verifierHash, publicKey: createPublicKey({ key: rawAuthority.publicKey.export({ type: 'spki', format: 'der' }), type: 'spki', format: 'der' }) }) : undefined;
    db.exec('CREATE TABLE IF NOT EXISTS verified_publication_payloads(payload_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,payload_hash TEXT NOT NULL,dependencies_json TEXT NOT NULL,payload BLOB NOT NULL,UNIQUE(owner_key,payload_hash));');
    db.exec('CREATE TABLE IF NOT EXISTS verified_evaluation_retentions(attempt_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,bundle_hash TEXT NOT NULL,bundle BLOB NOT NULL)');
    let busy = false;
    function current() { const result = assertCurrent(); if (result !== undefined) {
        void Promise.resolve(result).catch(() => { });
        throw Error('publication_sync_authority');
    } }
    function transaction(work, fence, stable) { if (busy)
        throw Error('publication_reentrant'); busy = true; try {
        return runVerificationTransaction(db, () => { const original = stable?.(); current(); if (stable && stable() !== original)
            throw Error('publication_retention_changed'); const result = work(), vector = fence?.(); current(); if (stable && stable() !== original || fence && fence() !== vector)
            throw Error('publication_retention_changed'); return result; });
    }
    finally {
        busy = false;
    } }
    function dependencies(owner) { const result = JSON.parse(json(getCurrentDependencies(owner))); if (!Array.isArray(result) || !result.length || result.length > 256 || new Set(result.map(verificationDependencyKey)).size !== result.length)
        throw Error('publication_dependency'); return result.sort(compareVerificationDependencies); }
    function application(owner) {
        const r = db.prepare('SELECT current_json,pending_id FROM verification_application_pointers WHERE owner_key=?').get(ownerKey(owner));
        if (r?.pending_id)
            throw Error('publication_application_pending');
        if (!r?.current_json)
            return null;
        const active = parseActiveBusinessApplicationBinding(JSON.parse(r.current_json));
        if (json(businessApplicationOwner(active.binding)) !== json({ ownerKind: owner.ownerKind, ownerId: owner.ownerId }))
            throw Error('publication_application_owner');
        return active;
    }
    function assertApplicationPayload(payload, owner) {
        const body = JSON.parse(payload.toString('utf8'));
        const applications = [{ owner, expected: json(body.application ?? null) }, ...body.evaluations.map((section) => ({
                owner: section.kind === 'inherited' ? JSON.parse(ownerKey(section.originOwner)) : owner, expected: json(section.application ?? null),
            }))];
        const checked = new Map();
        for (const item of applications) {
            const key = ownerKey(item.owner), prior = checked.get(key);
            if (prior !== undefined) {
                if (prior !== item.expected)
                    throw Error('publication_application_changed');
                continue;
            }
            checked.set(key, item.expected);
            const current = application(item.owner);
            if (item.expected !== json(current))
                throw Error('publication_application_changed');
            if (current?.binding.kind === 'loop')
                assertLoopApplicationArtifacts(item.owner, current.binding, owner, body.evaluations);
            if (current?.binding.kind === 'intent') {
                assertIntentApplicationArtifacts(item.owner, current.binding, owner, body.evaluations);
                assertIntentParentPublication({ database: db, owner: item.owner, binding: current.binding, payloadOwner: owner, sections: body.evaluations, inspectOwner, getCurrentDependencies, assertPublicationTuplesCurrent });
            }
        }
        return applications.filter((item, index) => applications.findIndex(other => ownerKey(other.owner) === ownerKey(item.owner)) === index);
    }
    function parentVector(owner) { const active = application(owner); return active?.binding.kind === 'intent' ? intentParentPublicationVector(db, owner, active.binding) : '[]'; }
    function readRow(id, owner) { if (typeof id !== 'string' || id.length > 160)
        throw Error('publication_payload'); const r = db.prepare('SELECT * FROM verified_publication_payloads WHERE payload_id=?').get(id); if (!r)
        throw Error('publication_payload'); if (r.owner_key !== ownerKey(owner))
        throw Error('publication_owner'); if (hash(r.payload) !== r.payload_hash)
        throw Error('publication_payload_corrupt'); if (r.dependencies_json !== json(dependencies(owner)))
        throw Error('publication_dependency'); const applications = assertApplicationPayload(r.payload, owner); return { ...r, applications }; }
    const tokens = new WeakMap();
    function trust() { if (!proofAuthority)
        throw Error('publication_retention_authority'); return proofAuthority; }
    function bundle(evidence) { return Buffer.from(json({ version: 1, definitionHash: evidence.definitionHash, binding: evidence.binding, evaluation: evidence.evaluation, artifacts: evidence.artifacts.map(a => ({ path: a.path, sha256: hash(a.bytes), size: a.bytes.length, bytesBase64: a.bytes.toString('base64') })) })); }
    function shape(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.sort().join(','))
        throw Error('publication_retention_bundle'); }
    function digest(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
        throw Error('publication_retention_bundle'); }
    function id(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
        throw Error('publication_retention_bundle'); }
    function decode(body) {
        if (body.length > VERIFICATION_BUDGET.outboxPayloadBytes)
            throw Error('publication_payload_capacity');
        const v = JSON.parse(body.toString('utf8'));
        if (!Buffer.from(json(v)).equals(body))
            throw Error('publication_retention_bundle');
        shape(v, ['version', 'definitionHash', 'binding', 'evaluation', 'artifacts']);
        if (v.version !== 1)
            throw Error('publication_retention_bundle');
        digest(v.definitionHash);
        shape(v.binding, ['attemptId', 'subjectId', 'runNonce', 'expected']);
        [v.binding.attemptId, v.binding.subjectId, v.binding.runNonce].forEach(id);
        shape(v.binding.expected, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'executionIdentity', 'scopeDigest']);
        Object.values(v.binding.expected).forEach(id);
        digest(v.binding.expected.scopeDigest);
        shape(v.evaluation, ['verifierHash', 'checks']);
        digest(v.evaluation.verifierHash);
        if (!Array.isArray(v.evaluation.checks) || !v.evaluation.checks.length || v.evaluation.checks.length > VERIFICATION_BUDGET.maximumChecks || new Set(v.evaluation.checks.map((c) => c.id)).size !== v.evaluation.checks.length)
            throw Error('publication_retention_bundle');
        for (const c of v.evaluation.checks) {
            shape(c, ['id', 'passed']);
            id(c.id);
            if (c.passed !== true)
                throw Error('publication_retention_bundle');
        }
        if (!Array.isArray(v.artifacts) || v.artifacts.length > VERIFICATION_BUDGET.maximumChecks)
            throw Error('publication_retention_bundle');
        const artifacts = v.artifacts.map((a) => { shape(a, ['path', 'sha256', 'size', 'bytesBase64']); if (typeof a.path !== 'string' || !a.path || a.path.length > 4096 || /[:\x00-\x1f]/.test(a.path) || a.path.startsWith('/') || a.path.includes('\\') || a.path.split('/').some((p) => !p || p === '.' || p === '..') || typeof a.bytesBase64 !== 'string' || !Number.isSafeInteger(a.size) || a.size < 0)
            throw Error('publication_retention_bundle'); digest(a.sha256); const bytes = Buffer.from(a.bytesBase64, 'base64'); if (bytes.toString('base64') !== a.bytesBase64 || bytes.length !== a.size || hash(bytes) !== a.sha256)
            throw Error('publication_retention_bundle'); return { path: a.path, bytes }; });
        return { definitionHash: v.definitionHash, binding: v.binding, evaluation: v.evaluation, artifacts };
    }
    function evidenceProof(e, bundleHash, allowNull = false) {
        const authority = trust(), attempt = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(e.binding.attemptId);
        if (!attempt || attempt.state !== 'terminal' || attempt.execution_json !== json(e.binding.expected) || !attempt.core_json)
            throw Error('publication_retention_proof');
        const core = JSON.parse(attempt.core_json), facts = JSON.parse(attempt.facts_json);
        if (core.attemptId !== e.binding.attemptId || json(core.owner) !== attempt.owner_key || core.subjectId !== e.binding.subjectId || core.runNonce !== e.binding.runNonce || json(core.execution) !== json(e.binding.expected) || core.quiescent !== true || !Array.isArray(core.outputHashes) || core.outputHashes.length !== 3 || core.outputHashes[2] !== bundleHash || facts.subjectId !== e.binding.subjectId || facts.runNonce !== e.binding.runNonce)
            throw Error('publication_retention_core');
        const historical = db.prepare('SELECT core_json FROM execution_facts_revisions WHERE attempt_id=? AND revision=?').get(e.binding.attemptId, core.coreFinalRevision);
        if (historical?.core_json !== attempt.core_json)
            throw Error('publication_retention_core');
        if (!attempt.proof_json) {
            if (allowNull)
                return null;
            throw Error('publication_retention_proof');
        }
        const proof = JSON.parse(attempt.proof_json), { signature, ...unsigned } = proof, proofRow = db.prepare('SELECT attempt_id,proof_json FROM verifier_proofs WHERE proof_id=?').get(proof.proofId);
        if (proofRow?.attempt_id !== e.binding.attemptId || proofRow.proof_json !== attempt.proof_json || typeof signature !== 'string' || !verify(null, Buffer.from(json(unsigned)), authority.publicKey, Buffer.from(signature, 'base64')) || proof.issuerId !== authority.issuerId || proof.keyId !== authority.keyId || proof.serviceEpoch !== authority.serviceEpoch || proof.verifierHash !== authority.verifierHash || proof.verifierHash !== e.evaluation.verifierHash || proof.verdict !== 'pass' || proof.coreHash !== hash(attempt.core_json) || proof.coreFinalRevision !== core.coreFinalRevision || proof.attemptId !== e.binding.attemptId || json(proof.owner) !== attempt.owner_key || proof.definitionHash !== e.definitionHash || proof.subjectId !== e.binding.subjectId || proof.runNonce !== e.binding.runNonce || proof.checkDigest !== hash(json(e.evaluation.checks)) || json(proof.checks) !== json(e.evaluation.checks))
            throw Error('publication_retention_proof');
        return { attempt, core, proof };
    }
    function retainedUsage() { return db.prepare('SELECT COALESCE(SUM(LENGTH(bundle)),0) bytes,COUNT(*) n FROM verified_evaluation_retentions').get(); }
    function combinedUsage() { const p = db.prepare('SELECT COALESCE(SUM(LENGTH(payload)),0) bytes,COUNT(*) n FROM verified_publication_payloads').get(), r = retainedUsage(); return { bytes: p.bytes + r.bytes, n: p.n + r.n }; }
    function proofVector(ids) { return json(ids.map(attemptId => { const attempt = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attemptId); return { attemptId, attempt: attempt ?? null, proofs: db.prepare('SELECT * FROM verifier_proofs WHERE attempt_id=? ORDER BY proof_id').all(attemptId), cores: db.prepare('SELECT * FROM execution_facts_revisions WHERE attempt_id=? ORDER BY revision').all(attemptId), application: attempt ? db.prepare('SELECT * FROM verification_application_pointers WHERE owner_key=?').get(attempt.owner_key) ?? null : null }; })); }
    function relatedPayloads(ids) { const found = new Map(); for (const id of ids)
        for (const row of db.prepare("SELECT * FROM verified_publication_payloads WHERE EXISTS(SELECT 1 FROM json_each(dependencies_json) WHERE json_extract(value,'$.activeAttemptId')=?) ORDER BY payload_id").all(id))
            found.set(row.payload_id, row); return [...found.values()].sort((a, b) => a.payload_id.localeCompare(b.payload_id)); }
    function retentionVector(ids) { return json({ proof: proofVector(ids), payloads: relatedPayloads(ids).map(r => ({ ...r, payload: hash(r.payload) })), retained: ids.map(id => { const row = db.prepare('SELECT * FROM verified_evaluation_retentions WHERE attempt_id=?').get(id); return row ? { ...row, bundle: hash(row.bundle) } : null; }) }); }
    function prepareRetention(evaluation) { trust(); current(); const evidence = exportEvidence(evaluation), body = bundle(evidence); decode(body); const token = Object.freeze({}), bundleHash = hash(body); tokens.set(token, { body: Buffer.from(body), bundleHash }); return Object.freeze({ token, bundleHash }); }
    function commitRetention(token) {
        const known = tokens.get(token);
        tokens.delete(token);
        if (!known)
            throw Error('publication_retention_token');
        if (!db.inTransaction || busy)
            throw Error('publication_retention_transaction');
        busy = true;
        try {
            const evidence = decode(known.body), ids = [evidence.binding.attemptId];
            const before = retentionVector(ids);
            current();
            if (retentionVector(ids) !== before)
                throw Error('publication_retention_changed');
            const proof = evidenceProof(evidence, known.bundleHash, true);
            if (!proof)
                return;
            const old = db.prepare('SELECT * FROM verified_evaluation_retentions WHERE attempt_id=?').get(evidence.binding.attemptId);
            if (old) {
                if (old.owner_key !== proof.attempt.owner_key || old.bundle_hash !== known.bundleHash || !old.bundle.equals(known.body))
                    throw Error('publication_retention_changed');
                return;
            }
            const usage = combinedUsage();
            if (usage.bytes + known.body.length > VERIFICATION_BUDGET.outboxPayloadBytes || usage.n >= VERIFICATION_BUDGET.maximumOutboxRecords)
                throw Error('publication_payload_capacity');
            assertVerificationDatabaseBudget(db, { additionalBytes: known.body.length + 2048 });
            const originalProof = proofVector(ids);
            const row = { attempt_id: evidence.binding.attemptId, owner_key: proof.attempt.owner_key, bundle_hash: known.bundleHash, bundle: known.body };
            const inserted = db.prepare('INSERT INTO verified_evaluation_retentions VALUES(?,?,?,?)').run(row.attempt_id, row.owner_key, row.bundle_hash, row.bundle);
            const saved = db.prepare('SELECT * FROM verified_evaluation_retentions WHERE attempt_id=?').get(row.attempt_id);
            if (inserted.changes !== 1 || !saved || saved.attempt_id !== row.attempt_id || saved.owner_key !== row.owner_key || saved.bundle_hash !== row.bundle_hash || !Buffer.isBuffer(saved.bundle) || !saved.bundle.equals(row.bundle))
                throw Error('publication_retention_commit');
            if (proofVector(ids) !== originalProof)
                throw Error('publication_retention_changed');
            const after = retentionVector(ids);
            current();
            if (retentionVector(ids) !== after)
                throw Error('publication_retention_changed');
            evidenceProof(evidence, known.bundleHash);
            assertVerificationDatabaseBudget(db, { additionalBytes: 0 });
        }
        finally {
            busy = false;
        }
    }
    function retainedEvidence(dep) {
        trust();
        const row = db.prepare('SELECT * FROM verified_evaluation_retentions WHERE attempt_id=?').get(dep.activeAttemptId);
        let body;
        if (row) {
            if (hash(row.bundle) !== row.bundle_hash)
                throw Error('publication_retention_bundle');
            body = Buffer.from(row.bundle);
        }
        else {
            for (const payload of relatedPayloads([dep.activeAttemptId])) {
                if (hash(payload.payload) !== payload.payload_hash)
                    throw Error('publication_payload_corrupt');
                const parsed = JSON.parse(payload.payload.toString());
                if (!Buffer.from(json(parsed)).equals(payload.payload) || !Array.isArray(parsed.evaluations))
                    throw Error('publication_payload_corrupt');
                for (const section of parsed.evaluations) {
                    if (section?.binding?.attemptId !== dep.activeAttemptId)
                        continue;
                    const candidate = Buffer.from(json({ version: 1, definitionHash: section.definitionHash, binding: section.binding, evaluation: section.evaluation, artifacts: section.artifacts }));
                    if (body && !body.equals(candidate))
                        throw Error('publication_retention_ambiguous');
                    body = candidate;
                }
            }
        }
        if (!body)
            throw Error('publication_retention_missing');
        const evidence = decode(body), proof = evidenceProof(evidence, hash(body));
        if (!proof || evidence.binding.attemptId !== dep.activeAttemptId || row && row.owner_key !== proof.attempt.owner_key)
            throw Error('publication_retention_proof');
        return evidence;
    }
    function stage(raw, retained = false) {
        // Snapshot identity list without serializing the unforgeable evaluation references.
        const key = ownerKey(raw.owner), owner = JSON.parse(key);
        if (!Array.isArray(raw.evaluations) || raw.evaluations.length > 256)
            throw Error('publication_dependency');
        const evaluations = [...raw.evaluations];
        let ids = [];
        return transaction(() => {
            const deps = dependencies(owner);
            ids = deps.map(d => d.activeAttemptId);
            const originalVector = retentionVector(ids), originalParents = parentVector(owner), ownerApplication = application(owner);
            if (!retained && evaluations.length !== deps.length)
                throw Error('publication_dependency');
            const seen = new Set(), sections = [];
            let encodedArtifactBytes = 0;
            for (const evidence of (retained ? deps.map(retainedEvidence) : evaluations.map(exportEvidence))) {
                const dep = deps.find(d => d.activeAttemptId === evidence.binding.attemptId);
                if (!dep || seen.has(verificationDependencyKey(dep)))
                    throw Error('publication_dependency');
                seen.add(verificationDependencyKey(dep));
                const attempt = db.prepare('SELECT owner_key,facts_json,execution_json,proof_json FROM obligation_attempts WHERE attempt_id=?').get(dep.activeAttemptId);
                const historical = db.prepare('SELECT proof_json FROM verifier_proofs WHERE proof_id=?').get(dep.proofId);
                if (!attempt || attempt.owner_key !== (dep.kind === 'inherited' ? ownerKey(dep.originOwner) : key) || !attempt.proof_json || !historical || historical.proof_json !== attempt.proof_json || hash(attempt.proof_json) !== dep.proofHash)
                    throw Error('publication_proof');
                const proof = JSON.parse(attempt.proof_json), facts = JSON.parse(attempt.facts_json);
                const sectionApplication = application(dep.kind === 'inherited' ? dep.originOwner : owner);
                if (json(facts.authorityContext?.application ?? null) !== json(sectionApplication))
                    throw Error('publication_application_attempt');
                if (evidence.definitionHash !== dep.definitionHash || evidence.evaluation.verifierHash !== proof.verifierHash || hash(json(evidence.evaluation.checks)) !== proof.checkDigest || evidence.binding.subjectId !== dep.subjectId || evidence.binding.runNonce !== dep.runNonce || facts.subjectId !== dep.subjectId || facts.runNonce !== dep.runNonce || json(evidence.binding.expected) !== attempt.execution_json)
                    throw Error('publication_proof_binding');
                for (const artifact of evidence.artifacts) {
                    encodedArtifactBytes += 4 * Math.ceil(artifact.bytes.length / 3);
                    if (encodedArtifactBytes > VERIFICATION_BUDGET.outboxPayloadBytes)
                        throw Error('publication_payload_capacity');
                }
                sections.push({ ...(dep.kind === 'inherited' ? { kind: dep.kind, originOwner: dep.originOwner, originalObligationId: dep.originalObligationId } : {}), ...(sectionApplication ? { application: sectionApplication } : {}), obligationId: dep.obligationId, definitionHash: evidence.definitionHash, binding: evidence.binding, evaluation: evidence.evaluation, artifacts: evidence.artifacts.map(a => ({ path: a.path, sha256: hash(a.bytes), size: a.bytes.length, bytesBase64: a.bytes.toString('base64') })) });
            }
            sections.sort((a, b) => compareVerificationDependencies(a, b));
            const dependenciesJson = json(deps), payload = Buffer.from(json({ version: 1, owner, ...(ownerApplication ? { application: ownerApplication } : {}), dependencies: deps, evaluations: sections })), payloadHash = hash(payload);
            if (payload.length > VERIFICATION_BUDGET.outboxPayloadBytes)
                throw Error('publication_payload_capacity');
            // Callbacks may have invalidated proof facts while resolving evidence.
            if (json(dependencies(owner)) !== dependenciesJson)
                throw Error('publication_dependency');
            assertApplicationPayload(payload, owner);
            if (retentionVector(ids) !== originalVector)
                throw Error('publication_retention_changed');
            const originalProof = proofVector(ids);
            const existing = db.prepare('SELECT payload_id,payload FROM verified_publication_payloads WHERE owner_key=? AND payload_hash=?').get(key, payloadHash);
            if (existing && !existing.payload.equals(payload))
                throw Error('publication_payload_corrupt');
            const migrated = [];
            for (const section of sections) {
                const row = db.prepare('SELECT attempt_id,bundle_hash,bundle FROM verified_evaluation_retentions WHERE attempt_id=?').get(section.binding.attemptId);
                if (!row)
                    continue;
                const body = Buffer.from(json({ version: 1, definitionHash: section.definitionHash, binding: section.binding, evaluation: section.evaluation, artifacts: section.artifacts }));
                if (hash(row.bundle) !== row.bundle_hash || !body.equals(row.bundle))
                    throw Error('publication_retention_changed');
                migrated.push(row);
            }
            const usage = combinedUsage(), released = migrated.reduce((n, r) => n + r.bundle.length, 0);
            if (usage.bytes + (existing ? 0 : payload.length) - released > VERIFICATION_BUDGET.outboxPayloadBytes || usage.n + (existing ? 0 : 1) - migrated.length > VERIFICATION_BUDGET.maximumOutboxRecords)
                throw Error('publication_payload_capacity');
            // The common transaction owns both writes; a failed insertion/deletion restores all bundles.
            assertVerificationDatabaseBudget(db, { additionalBytes: existing ? 0 : payload.length + Buffer.byteLength(dependenciesJson) + 2048 });
            const payloadId = existing?.payload_id ?? randomUUID();
            if (!existing) {
                const written = db.prepare('INSERT INTO verified_publication_payloads VALUES(?,?,?,?,?)').run(payloadId, key, payloadHash, dependenciesJson, payload);
                if (written.changes !== 1)
                    throw Error('publication_retention_commit');
            }
            for (const row of migrated) {
                if (db.prepare('DELETE FROM verified_evaluation_retentions WHERE attempt_id=? AND bundle_hash=?').run(row.attempt_id, row.bundle_hash).changes !== 1)
                    throw Error('publication_retention_commit');
            }
            const saved = db.prepare('SELECT * FROM verified_publication_payloads WHERE payload_id=?').get(payloadId);
            if (!saved || saved.owner_key !== key || saved.payload_hash !== payloadHash || saved.dependencies_json !== dependenciesJson || !saved.payload.equals(payload) || combinedUsage().bytes > VERIFICATION_BUDGET.outboxPayloadBytes || migrated.some(r => db.prepare('SELECT 1 FROM verified_evaluation_retentions WHERE attempt_id=?').get(r.attempt_id)))
                throw Error('publication_retention_commit');
            if (proofVector(ids) !== originalProof || parentVector(owner) !== originalParents)
                throw Error('publication_retention_changed');
            return Object.freeze({ payloadId, immutablePayloadHash: payloadHash, byteLength: payload.length });
        }, () => json({ evidence: retentionVector(ids), application: db.prepare('SELECT * FROM verification_application_pointers WHERE owner_key=?').get(key) ?? null, parent: parentVector(owner) }), () => parentVector(owner));
    }
    return Object.freeze({ prepareRetention, commitRetention, stage(raw) { return stage(raw); }, stageRetained(owner) { return stage({ owner, evaluations: [] }, true); },
        capture(payloadId, rawOwner) {
            const owner = JSON.parse(ownerKey(rawOwner));
            return transaction(() => {
                const row = readRow(payloadId, owner), body = Buffer.from(row.payload), applications = row.applications;
                const expected = { ownerKey: row.owner_key, hash: row.payload_hash, dependencies: row.dependencies_json, length: body.length };
                const assertCurrent = () => transaction(() => {
                    const actual = db.prepare('SELECT owner_key,payload_hash,dependencies_json,LENGTH(payload) byte_length FROM verified_publication_payloads WHERE payload_id=?').get(payloadId);
                    if (!actual || actual.owner_key !== expected.ownerKey || actual.payload_hash !== expected.hash || actual.dependencies_json !== expected.dependencies || actual.byte_length !== expected.length)
                        throw Error('publication_payload_changed');
                    if (json(dependencies(owner)) !== expected.dependencies)
                        throw Error('publication_dependency');
                    assertApplicationPayload(body, owner);
                    for (const item of applications)
                        if (json(application(item.owner)) !== item.expected)
                            throw Error('publication_application_changed');
                }, () => parentVector(owner), () => parentVector(owner));
                // Only detached copies leave this operation-local snapshot. A later disk
                // change cannot substitute bytes already selected for this publication.
                return Object.freeze({ readBytes: () => { assertCurrent(); return Buffer.from(body); }, assertCurrent });
            }, () => parentVector(owner), () => parentVector(owner));
        },
        read(payloadId, rawOwner) { const owner = JSON.parse(ownerKey(rawOwner)); return transaction(() => Buffer.from(readRow(payloadId, owner).payload), () => parentVector(owner), () => parentVector(owner)); },
        assertTuple(raw) {
            if (!db.inTransaction)
                throw Error('publication_transaction_required');
            const tuple = parseVerificationTuple(raw), owner = { profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }, key = ownerKey(owner);
            transaction(() => {
                if (json(tuple.obligations) !== json(dependencies(owner)))
                    throw Error('publication_dependency');
                const row = db.prepare('SELECT * FROM verified_publication_payloads WHERE owner_key=? AND payload_hash=?').get(key, tuple.immutablePayloadHash);
                if (!row)
                    throw Error('publication_payload');
                readRow(row.payload_id, owner);
            }, () => parentVector(owner), () => parentVector(owner));
        },
    });
}
