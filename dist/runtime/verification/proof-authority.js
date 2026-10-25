import { withIntentSqlParsingContext } from './intent-sql-parsing-context.js';
import { isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { readKSwarmEnrollmentSnapshot } from './kswarm-enrollment-store.js';
import { assertApprovedOperationScopeGuard } from './approved-verification-operation.js';
import { parseIntentContractRegistrationObservation, intentContractDependencies } from './intent-contract-enrollment.js';
import { intentHostSubjectOwner } from './intent-host-subject.js';
import { parseBusinessApplicationBinding, businessApplicationBindingHash, businessApplicationOwner, businessApplicationEpoch, sameBusinessApplicationSubject, parseActiveBusinessApplicationBinding } from './business-application-binding.js';
import { createOwnerDependencyGraph } from './owner-dependency-graph.js';
import { createHash, randomUUID, sign } from 'node:crypto';
import { openPrivateVerificationDatabase } from './private-database.js';
import { canonicalVerificationJson, parseVerificationTuple, compareVerificationDependencies, VERIFICATION_BUDGET } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
import { VerificationPublicationJournal } from './publication-journal.js';
const digest = (value) => createHash('sha256').update(canonicalVerificationJson(value)).digest('hex');
function snapshot(input) {
    const s = canonicalVerificationJson(input);
    if (Buffer.byteLength(s) > VERIFICATION_BUDGET.rpcBytes)
        throw Error('verification_rpc_limit');
    return JSON.parse(s);
}
function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw Error('verification_record_fields');
}
function id(x) {
    if (typeof x !== 'string' || !x.length || Buffer.byteLength(x) > 160 || /[\x00-\x1f\x7f]/.test(x))
        throw Error('verification_invalid_id');
}
function hash(x) {
    if (typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x))
        throw Error('verification_invalid_hash');
}
function integer(x) {
    if (!Number.isSafeInteger(x) || x < 0)
        throw Error('verification_invalid_revision');
}
function ownerKey(owner) {
    const v = snapshot(owner);
    if (Object.keys(v).sort().join(',') !== 'ownerId,ownerKind,profileId' || !(['task', 'intent', 'goal', 'loop', 'project'].includes(v.ownerKind) || isKSwarmOwnerIdentity(v)))
        throw Error('verification_owner');
    id(v.profileId);
    id(v.ownerId);
    return canonicalVerificationJson(v);
}
/** System-controller composition root only. Neither `host` nor its issuance methods may be registered as RPC.
 * Instantiating this database never qualifies its OS identity, staging, runner or verifier recipes.
 */
export function createVerificationAuthority(input) {
    const { root, receiverVerifier, issuerId, verifierHash, keyId, serviceEpoch, privateKey, clock: readClock, assertQualified } = input;
    [issuerId, keyId, serviceEpoch].forEach(id);
    hash(verifierHash);
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519')
        throw Error('verification_signing_key');
    const assertVerifiedPayload = input.assertVerifiedPayload ?? (() => { throw Error('verification_publication_payload_unavailable'); });
    const assertPhysical = input.quiescence.assertQuiescent.bind(input.quiescence);
    const ownsDatabase = !input.database;
    const db = input.database ?? openPrivateVerificationDatabase(root), authorizations = new WeakMap();
    let closed = false;
    db.exec(`CREATE TABLE IF NOT EXISTS verification_owners(owner_key TEXT PRIMARY KEY,migration_epoch INTEGER NOT NULL,business_revision INTEGER NOT NULL,set_revision INTEGER NOT NULL,epoch INTEGER NOT NULL,pending INTEGER NOT NULL,current_subject TEXT);
 CREATE TABLE IF NOT EXISTS mandatory_observation_checks(owner_key TEXT NOT NULL,obligation_id TEXT NOT NULL,definition_json TEXT NOT NULL,active_attempt TEXT,attempt_epoch INTEGER NOT NULL,PRIMARY KEY(owner_key,obligation_id));
 CREATE TABLE IF NOT EXISTS obligation_attempts(attempt_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,obligation_id TEXT NOT NULL,epoch INTEGER NOT NULL,facts_json TEXT NOT NULL,state TEXT NOT NULL,core_json TEXT,proof_json TEXT,execution_json TEXT);
 CREATE TABLE IF NOT EXISTS execution_facts_revisions(attempt_id TEXT NOT NULL,revision INTEGER NOT NULL,core_json TEXT NOT NULL,PRIMARY KEY(attempt_id,revision));
 CREATE TABLE IF NOT EXISTS verifier_proofs(proof_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,revision INTEGER NOT NULL,proof_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS proof_dependencies(proof_id TEXT NOT NULL,dependency_kind TEXT NOT NULL,dependency_id TEXT NOT NULL,PRIMARY KEY(proof_id,dependency_kind,dependency_id));
 CREATE TABLE IF NOT EXISTS verification_scopes(owner_key TEXT NOT NULL,scope_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_key,scope_id));
 CREATE TABLE IF NOT EXISTS verification_scope_guards(owner_key TEXT NOT NULL,scope_id TEXT NOT NULL,revision INTEGER NOT NULL,guard_id TEXT NOT NULL,service_epoch TEXT NOT NULL,PRIMARY KEY(owner_key,scope_id));
 CREATE TABLE IF NOT EXISTS verification_subjects(subject_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,manifest_json TEXT NOT NULL,content_root TEXT NOT NULL,scope_id TEXT NOT NULL,scope_revision INTEGER NOT NULL,service_epoch TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_audit(id INTEGER PRIMARY KEY,owner_key TEXT NOT NULL,method TEXT NOT NULL,principal TEXT NOT NULL,payload_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settlement_decisions(operation_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,tuple_hash TEXT NOT NULL,tuple_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_application_pointers(owner_key TEXT PRIMARY KEY,current_json TEXT,pending_id TEXT);
 CREATE TABLE IF NOT EXISTS verification_application_history(owner_key TEXT NOT NULL,revision INTEGER NOT NULL,binding_hash TEXT NOT NULL,binding_json TEXT NOT NULL,registration_hash TEXT NOT NULL,PRIMARY KEY(owner_key,revision),UNIQUE(owner_key,binding_hash));
 CREATE TABLE IF NOT EXISTS verification_application_transitions(transition_id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,previous_hash TEXT,binding_json TEXT NOT NULL,registration_hash TEXT NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_lower INTEGER NOT NULL);`);
    if (!db.prepare('PRAGMA table_info(verification_owners)').all().some(x => x.name === 'current_subject'))
        db.exec('ALTER TABLE verification_owners ADD COLUMN current_subject TEXT');
    if (!db.prepare('PRAGMA table_info(obligation_attempts)').all().some(x => x.name === 'execution_json'))
        db.exec('ALTER TABLE obligation_attempts ADD COLUMN execution_json TEXT');
    // Old scopes have no qualified lifetime; NULL remains unavailable, never infinity.
    const scopeColumns = new Set(db.prepare('PRAGMA table_info(verification_scopes)').all().map(x => x.name));
    for (const [name, type] of [['expires_at', 'INTEGER'], ['not_before', 'INTEGER'], ['clock_domain_id', 'TEXT'], ['clock_qualification_epoch', 'INTEGER']])
        if (!scopeColumns.has(name))
            db.exec(`ALTER TABLE verification_scopes ADD COLUMN ${name} ${type}`);
    const scopeGuards = new Map(), checkingScopeGuards = new Set();
    const graph = createOwnerDependencyGraph(db);
    const journal = new VerificationPublicationJournal({ database: db, receiverVerifier });
    // Pure immutable parsing only, scoped to this synchronous invocation. Every
    // application() call still reads the actual owner and complete pointer row.
    let applicationParses;
    const withApplicationParses = (fn) => {
        const outer = applicationParses;
        applicationParses = new Map();
        try {
            return withIntentSqlParsingContext(db, fn);
        }
        finally {
            applicationParses.clear();
            applicationParses = outer;
        }
    };
    const transact = (fn) => {
        if (checkingScopeGuards.size)
            throw Error('verification_scope_guard_reentrant');
        return withApplicationParses(() => runVerificationTransaction(db, fn));
    };
    function currentClock() {
        if (checkingScopeGuards.size)
            throw Error('verification_scope_guard_reentrant');
        if (closed)
            throw Error('verification_authority_closed');
        const result = assertQualified();
        if (result !== undefined) {
            if (result && typeof result.then === 'function')
                void Promise.resolve(result).catch(() => { });
            throw Error('verification_qualification_must_be_sync');
        }
        const c = snapshot(readClock());
        id(c.domainId);
        integer(c.qualificationEpoch);
        integer(c.lowerBound);
        integer(c.upperBound);
        hash(c.evidenceHash);
        if (c.lowerBound > c.upperBound)
            throw Error('verification_clock');
        const old = db.prepare('SELECT last_lower FROM verification_clock WHERE id=1').get();
        if (old && c.lowerBound < old.last_lower)
            throw Error('verification_clock_regressed');
        db.prepare('INSERT INTO verification_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_lower=excluded.last_lower').run(c.lowerBound);
        return c;
    }
    function ownerRow(key) {
        const row = db.prepare('SELECT * FROM verification_owners WHERE owner_key=?').get(key);
        if (!row)
            throw Error('verification_owner_missing');
        return row;
    }
    function obligations(key) { return db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? ORDER BY obligation_id').all(key); }
    function audit(key, method, payload, principal) { assertVerificationDatabaseBudget(db, { additionalBytes: 1024 }); db.prepare('INSERT INTO verification_audit(owner_key,method,principal,payload_hash) VALUES(?,?,?,?)').run(key, method, principal, digest(payload)); }
    function reservations(key) {
        const owner = JSON.parse(key), o = ownerRow(key);
        return db.prepare('SELECT state_json,tuple_json FROM publication_journal WHERE owner_key=?').all(canonicalVerificationJson([owner.profileId, owner.ownerKind, owner.ownerId, o.migration_epoch])).filter(r => ['pending', 'commit_authorized'].includes(JSON.parse(r.state_json).reservation));
    }
    function application(key) {
        ownerRow(key);
        const r = db.prepare('SELECT current_json,pending_id FROM verification_application_pointers WHERE owner_key=?').get(key);
        let current = null;
        if (r?.current_json) {
            current = applicationParses?.get(r.current_json) ?? parseActiveBusinessApplicationBinding(JSON.parse(r.current_json));
            applicationParses?.set(r.current_json, current);
        }
        return { state: r?.pending_id ? 'pending' : r?.current_json ? 'active' : 'unbound', current, pendingTransitionId: r?.pending_id ?? null };
    }
    function applicationPending(key) { return graph.ancestors(key).some(k => application(k).state === 'pending'); }
    function mutable(key) {
        const o = ownerRow(key);
        for (const affected of graph.ancestors(key)) {
            if (ownerRow(affected).pending || application(affected).state === 'pending')
                throw Error('verification_invalidation_pending');
            if (reservations(affected).length)
                throw Error('verification_reservation_fenced');
        }
        return o;
    }
    function allObligations(key) {
        const result = graph.descendants(key).flatMap(origin => obligations(origin).map(ob => ({ origin, ob })));
        if (result.length > 256)
            throw Error('verification_graph_capacity');
        return result;
    }
    function setRevision(key) { const n = graph.descendants(key).reduce((n, k) => n + ownerRow(k).set_revision, 0); if (!Number.isSafeInteger(n))
        throw Error('verification_graph_revision'); return n; }
    function denyKSwarmBusiness(owner) { if (owner.ownerKind === 'kswarm')
        throw Error('kswarm_business_not_enabled'); }
    function consume(method, payload, context, allowed) {
        if (method !== 'registerObligations')
            denyKSwarmBusiness(payload.owner);
        if (!context || typeof context !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(context)))
            throw Error('verification_context');
        const descriptors = Object.getOwnPropertyDescriptors(context);
        if (Object.keys(descriptors).sort().join(',') !== 'authorization,requestSource' || Object.values(descriptors).some(d => !('value' in d)))
            throw Error('verification_context');
        const token = descriptors.authorization.value, source = descriptors.requestSource.value;
        const auth = token && typeof token === 'object' ? authorizations.get(token) : undefined;
        if (token && typeof token === 'object')
            authorizations.delete(token);
        if (!auth || auth.method !== method || auth.digest !== digest(payload) || auth.ownerKey !== ownerKey(payload.owner) || auth.requestSource !== source)
            throw Error('verification_authorization');
        if (!allowed.includes(source))
            throw Error('verification_request_source');
        if (currentClock().upperBound >= auth.expiresAt)
            throw Error('verification_authorization_expired');
        return auth;
    }
    function scopeRow(key, scopeId) { return db.prepare('SELECT s.owner_key,s.scope_id,s.revision,s.expires_at,s.not_before,s.clock_domain_id,s.clock_qualification_epoch,g.revision AS guard_revision,g.guard_id,g.service_epoch AS guard_epoch FROM verification_scopes s LEFT JOIN verification_scope_guards g ON g.owner_key=s.owner_key AND g.scope_id=s.scope_id WHERE s.owner_key=? AND s.scope_id=?').get(key, scopeId); }
    function admissionContext(key, c) { const owner = ownerRow(key); return { invalidationEpoch: owner.epoch, migrationEpoch: owner.migration_epoch, serviceEpoch, issuerId, keyId, verifierHash, clockDomainId: c.domainId, clockQualificationEpoch: c.qualificationEpoch, application: application(key).current }; }
    function currentAdmission(facts, key, c) { return !applicationPending(key) && facts.authorityContext !== undefined && canonicalVerificationJson(facts.authorityContext) === canonicalVerificationJson(admissionContext(key, c)); }
    function currentScope(scope, revision, c) { return !!scope && scope.revision === revision && Number.isSafeInteger(scope.expires_at) && Number.isSafeInteger(scope.not_before) && scope.not_before !== null && scope.expires_at !== null && scope.not_before <= c.lowerBound && scope.expires_at > c.upperBound && scope.clock_domain_id === c.domainId && scope.clock_qualification_epoch === c.qualificationEpoch && guardCurrent(scope); }
    function guardCurrent(scope) { if (!scope.guard_id)
        return true; if (scope.guard_revision !== scope.revision || scope.guard_epoch !== serviceEpoch || checkingScopeGuards.has(scope.guard_id))
        return false; const guard = scopeGuards.get(scope.guard_id); if (!guard)
        return false; checkingScopeGuards.add(scope.guard_id); try {
        assertApprovedOperationScopeGuard(guard, db, { owner: JSON.parse(scope.owner_key), scopeId: scope.scope_id, revision: scope.revision });
        return true;
    }
    catch {
        return false;
    }
    finally {
        checkingScopeGuards.delete(scope.guard_id);
    } }
    function directDependencies(key, c) {
        const o = ownerRow(key);
        if (o.pending || applicationPending(key))
            throw Error('verification_invalidation_pending');
        return obligations(key).map(ob => {
            const attempt = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(ob.active_attempt);
            if (!attempt || attempt.state !== 'terminal' || !attempt.proof_json || !attempt.core_json)
                throw Error('verification_unsatisfied');
            const proof = JSON.parse(attempt.proof_json), core = JSON.parse(attempt.core_json), facts = JSON.parse(attempt.facts_json), definition = JSON.parse(ob.definition_json);
            if (!currentAdmission(facts, key, c))
                throw Error('verification_not_current');
            if (proof.verifierHash !== verifierHash || proof.verdict !== 'pass' || proof.serviceEpoch !== serviceEpoch || proof.keyId !== keyId || proof.issuerId !== issuerId || proof.invalidationEpoch !== o.epoch || proof.clockDomainId !== c.domainId || proof.clockQualificationEpoch !== c.qualificationEpoch || c.lowerBound < proof.notBefore || c.upperBound >= proof.validUntil || proof.attemptEpoch !== ob.attempt_epoch || (definition.semantics === 'current-subject' && facts.subjectId !== o.current_subject))
                throw Error('verification_not_current');
            const scope = scopeRow(key, facts.requiredScopeId);
            if (!currentScope(scope, facts.scopeRevision, c) || proof.validUntil > scope.expires_at || proof.notBefore < scope.not_before)
                throw Error('verification_not_current');
            return { obligationId: ob.obligation_id, predicateId: definition.predicateId, predicateVersion: definition.predicateVersion, definitionHash: definition.definitionHash, activeAttemptId: attempt.attempt_id, attemptEpoch: attempt.epoch, sourceRunId: facts.sourceRunId, runNonce: facts.runNonce, subjectId: facts.subjectId, contentRoot: facts.contentRoot, coreId: core.coreId, coreHash: digest(core), coreFinalRevision: core.coreFinalRevision, proofId: proof.proofId, proofHash: digest(proof), proofRevision: proof.proofRevision, requiredScopeId: facts.requiredScopeId, scopeRevision: facts.scopeRevision, invalidationEpoch: o.epoch };
        });
    }
    function dependencies(key, c) {
        allObligations(key);
        return graph.descendants(key).flatMap(origin => directDependencies(origin, c).map(dep => origin === key ? dep : { ...dep, kind: 'inherited', originOwner: JSON.parse(origin), originalObligationId: dep.obligationId })).sort(compareVerificationDependencies);
    }
    function setHash(key) {
        const all = allObligations(key);
        if (graph.descendants(key).length === 1)
            return digest(all.map(r => JSON.parse(r.ob.definition_json)));
        return digest(all.map(({ origin, ob }) => ({ origin: JSON.parse(origin), definition: JSON.parse(ob.definition_json) })));
    }
    function checkTupleCurrent(t, c) {
        const key = ownerKey({ profileId: t.profileId, ownerKind: t.ownerKind, ownerId: t.ownerId }), o = ownerRow(key);
        const decision = db.prepare('SELECT tuple_hash FROM settlement_decisions WHERE operation_id=? AND owner_key=?').get(t.operationId, key);
        if (t.migrationEpoch !== o.migration_epoch || t.expectedBusinessRevision + (decision?.tuple_hash === digest(t) ? 1 : 0) !== o.business_revision || t.obligationSetRevision !== setRevision(key) || t.obligationSetHash !== setHash(key) || canonicalVerificationJson(t.obligations) !== canonicalVerificationJson(dependencies(key, c)))
            throw Error('verification_dependency_conflict');
        if (c.domainId !== t.clockDomainId || c.qualificationEpoch !== t.clockQualificationEpoch || c.lowerBound < t.notBefore || c.upperBound >= t.validUntil)
            throw Error('verification_not_current');
        for (const dependency of t.obligations) {
            const attempt = db.prepare('SELECT proof_json FROM obligation_attempts WHERE attempt_id=?').get(dependency.activeAttemptId);
            const proof = JSON.parse(attempt.proof_json), scope = scopeRow(dependency.kind === 'inherited' ? ownerKey(dependency.originOwner) : key, dependency.requiredScopeId);
            if (!currentScope(scope, dependency.scopeRevision, c) || t.notBefore < Math.max(proof.notBefore, scope.not_before) || t.validUntil > Math.min(proof.validUntil, scope.expires_at))
                throw Error('verification_publication_window');
        }
        return key;
    }
    function checkTuple(t, c) {
        const key = checkTupleCurrent(t, c);
        const result = assertVerifiedPayload(t);
        if (result !== undefined) {
            void Promise.resolve(result).catch(() => { });
            throw Error('verification_payload_sync');
        }
        return key;
    }
    function finishInvalidation(key) {
        const o = ownerRow(key);
        if (graph.ancestors(key).some(k => reservations(k).length))
            return 'pending';
        if (o.pending)
            db.prepare('UPDATE verification_owners SET pending=0,epoch=epoch+1 WHERE owner_key=?').run(key);
        return 'invalidated';
    }
    const service = {
        registerOwnerDependency(raw, context) {
            const p = snapshot(raw), auth = consume('registerOwnerDependency', p, context, ['user']);
            fields(p, ['owner', 'child']);
            denyKSwarmBusiness(p.child);
            const parent = auth.ownerKey, child = ownerKey(p.child);
            if (p.owner.profileId !== p.child.profileId)
                throw Error('verification_graph_profile');
            transact(() => {
                mutable(parent);
                mutable(child);
                if (parent === child || graph.descendants(child).includes(parent))
                    throw Error('verification_graph_cycle');
                if (db.prepare('SELECT 1 FROM verification_owner_dependencies WHERE parent_key=? AND child_key=?').get(parent, child))
                    return;
                if (db.prepare('SELECT COUNT(*) n FROM verification_owner_dependencies').get().n >= 65536)
                    throw Error('verification_graph_capacity');
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(parent) + Buffer.byteLength(child) + 1024 });
                db.prepare('INSERT INTO verification_owner_dependencies VALUES(?,?)').run(parent, child);
                for (const ancestor of graph.ancestors(parent))
                    allObligations(ancestor);
                db.prepare('UPDATE verification_owners SET set_revision=set_revision+1 WHERE owner_key=?').run(parent);
                audit(parent, 'registerOwnerDependency', p, auth.principalId);
            });
        },
        registerObligations(raw, context) {
            const p = snapshot(raw), auth = consume('registerObligations', p, context, ['user']);
            fields(p, ['owner', 'migrationEpoch', 'obligations']);
            integer(p.migrationEpoch);
            if (!Array.isArray(p.obligations) || !p.obligations.length || p.obligations.length > 256)
                throw Error('verification_obligation_count');
            const seen = new Set();
            for (const ob of p.obligations) {
                fields(ob, ['obligationId', 'predicateId', 'predicateVersion', 'semantics', 'definitionHash', 'requiredCheckIds']);
                [ob.obligationId, ob.predicateId, ob.predicateVersion].forEach(id);
                hash(ob.definitionHash);
                if (!['current-subject', 'specific-run', 'cumulative'].includes(ob.semantics) || !Array.isArray(ob.requiredCheckIds) || !ob.requiredCheckIds.length || ob.requiredCheckIds.length > 4096 || new Set(ob.requiredCheckIds).size !== ob.requiredCheckIds.length || seen.has(ob.obligationId))
                    throw Error('verification_obligation_definition');
                ob.requiredCheckIds.forEach(id);
                seen.add(ob.obligationId);
            }
            transact(() => {
                const key = auth.ownerKey;
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(p)) + 2048 });
                db.prepare('INSERT OR IGNORE INTO verification_owners VALUES(?,?,0,0,0,0,NULL)').run(key, p.migrationEpoch);
                const o = mutable(key);
                if (o.migration_epoch !== p.migrationEpoch)
                    throw Error('verification_migration_epoch');
                let additions = 0;
                for (const ob of p.obligations) {
                    const json = canonicalVerificationJson(ob), old = db.prepare('SELECT definition_json FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key, ob.obligationId);
                    if (old) {
                        if (old.definition_json !== json)
                            throw Error('verification_obligation_immutable');
                        continue;
                    }
                    db.prepare('INSERT INTO mandatory_observation_checks VALUES(?,?,?,NULL,0)').run(key, ob.obligationId, json);
                    additions++;
                }
                if (obligations(key).length > 256 || db.prepare('SELECT COUNT(*) n FROM mandatory_observation_checks WHERE owner_key IN (SELECT owner_key FROM verification_owners WHERE json_extract(owner_key,\'$.profileId\')=?)').get(p.owner.profileId).n > 4096)
                    throw Error('verification_obligation_limit');
                if (additions)
                    db.prepare('UPDATE verification_owners SET set_revision=set_revision+1 WHERE owner_key=?').run(key);
                for (const ancestor of graph.ancestors(key))
                    allObligations(ancestor);
                audit(key, 'registerObligations', p, auth.principalId);
            });
        },
        requestVerification(raw, context) {
            const p = snapshot(raw), auth = consume('requestVerification', p, context, ['user', 'agent', 'scheduler']);
            fields(p, ['owner', 'obligationId', 'expectedAttemptEpoch', 'sourceRunId', 'runNonce', 'subjectId', 'contentRoot', 'requiredScopeId', 'scopeRevision']);
            [p.obligationId, p.sourceRunId, p.runNonce, p.subjectId, p.requiredScopeId].forEach(id);
            integer(p.expectedAttemptEpoch);
            integer(p.scopeRevision);
            hash(p.contentRoot);
            return transact(() => {
                const key = auth.ownerKey;
                const current = mutable(key);
                const subject = db.prepare('SELECT * FROM verification_subjects WHERE subject_id=? AND owner_key=?').get(p.subjectId, key);
                if (!subject || subject.content_root !== p.contentRoot || subject.scope_id !== p.requiredScopeId || subject.scope_revision !== p.scopeRevision || subject.service_epoch !== serviceEpoch)
                    throw Error('verification_subject');
                const ob = db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key, p.obligationId);
                if (!ob || ob.attempt_epoch !== p.expectedAttemptEpoch)
                    throw Error('verification_attempt_cas');
                const definition = JSON.parse(ob.definition_json);
                if (definition.semantics === 'current-subject' && current.current_subject !== p.subjectId)
                    throw Error('verification_subject');
                if (!currentScope(scopeRow(key, p.requiredScopeId), p.scopeRevision, currentClock()))
                    throw Error('verification_subject_scope');
                if (ob.active_attempt) {
                    const previous = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(ob.active_attempt);
                    const definition = JSON.parse(ob.definition_json);
                    const neverDispatched = previous.state === 'cancelled_before_dispatch' && !previous.execution_json && !previous.core_json && !previous.proof_json;
                    if (!neverDispatched && (previous.state !== 'terminal' || !previous.core_json || !JSON.parse(previous.core_json).quiescent))
                        throw Error('verification_attempt_not_quiescent');
                    const oldFacts = JSON.parse(previous.facts_json);
                    if (['specific-run', 'cumulative'].includes(definition.semantics) && ['sourceRunId', 'runNonce', 'subjectId', 'contentRoot'].some(field => oldFacts[field] !== p[field]))
                        throw Error('verification_original_run_required');
                }
                if (ob.attempt_epoch >= 32 || db.prepare('SELECT COUNT(*) n FROM obligation_attempts').get().n >= VERIFICATION_BUDGET.maximumExecutionAttempts)
                    throw Error('verification_attempt_limit');
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(p)) + 65536 });
                const attemptId = randomUUID(), attemptEpoch = ob.attempt_epoch + 1;
                const facts = { ...p, authorityContext: admissionContext(key, currentClock()) };
                db.prepare("INSERT INTO obligation_attempts VALUES(?,?,?,?,?,'prepared',NULL,NULL,NULL)").run(attemptId, key, p.obligationId, attemptEpoch, canonicalVerificationJson(facts));
                db.prepare('UPDATE mandatory_observation_checks SET active_attempt=?,attempt_epoch=? WHERE owner_key=? AND obligation_id=?').run(attemptId, attemptEpoch, key, p.obligationId);
                audit(key, 'requestVerification', p, auth.principalId);
                return Object.freeze({ attemptId, attemptEpoch });
            });
        },
        inspectOwner(owner) {
            const key = ownerKey(owner);
            if (closed)
                throw Error('verification_authority_closed');
            return transact(() => {
                const kswarmVector = () => readKSwarmEnrollmentSnapshot(db, owner);
                const kswarmBefore = owner.ownerKind === 'kswarm' ? kswarmVector() : undefined;
                const o = db.prepare('SELECT * FROM verification_owners WHERE owner_key=?').get(key);
                if (!o)
                    return undefined;
                let currentVerification = 'needs_revalidation';
                try {
                    const c = currentClock();
                    dependencies(key, c);
                    currentVerification = owner.ownerKind === 'kswarm' ? 'needs_revalidation' : 'valid';
                }
                catch (error) {
                    if (!String(error).match(/unsatisfied|not_current|invalidation_pending/))
                        currentVerification = 'unavailable';
                }
                if (kswarmBefore !== undefined && kswarmVector() !== kswarmBefore)
                    throw Error('enrollment_kswarm_changed');
                return Object.freeze({ migrationEpoch: o.migration_epoch, businessRevision: o.business_revision,
                    obligationSetRevision: setRevision(key), obligationSetHash: setHash(key),
                    obligationCount: allObligations(key).length, currentVerification });
            });
        },
        getCurrentDependencies(owner) { denyKSwarmBusiness(owner); return transact(() => dependencies(ownerKey(owner), currentClock())); },
        prepareSettlement(raw, context) {
            const t = parseVerificationTuple(raw), p = { owner: { profileId: t.profileId, ownerKind: t.ownerKind, ownerId: t.ownerId }, tuple: t };
            const auth = consume('prepareSettlement', p, context, ['user', 'agent', 'scheduler']);
            transact(() => {
                const c = currentClock(), key = checkTuple(t, c), tupleHash = digest(t), old = db.prepare('SELECT tuple_hash FROM settlement_decisions WHERE operation_id=?').get(t.operationId);
                if (old) {
                    if (old.tuple_hash !== tupleHash)
                        throw Error('verification_operation_conflict');
                    return;
                }
                mutable(key);
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(t)) + 4096 });
                db.prepare('INSERT INTO settlement_decisions VALUES(?,?,?,?)').run(t.operationId, key, tupleHash, canonicalVerificationJson(t));
                journal.recordCommittedSettlement(t);
                db.prepare('UPDATE verification_owners SET business_revision=business_revision+1 WHERE owner_key=?').run(key);
                audit(key, 'prepareSettlement', t, auth.principalId);
            });
        },
        authorizePublication(raw, context) { const t = parseVerificationTuple(raw), p = { owner: { profileId: t.profileId, ownerKind: t.ownerKind, ownerId: t.ownerId }, tuple: t }; consume('authorizePublication', p, context, ['user', 'agent', 'scheduler']); transact(() => { const c = currentClock(); checkTuple(t, c); journal.authorizeReservation(t, c); }); },
        invalidate(raw, context) {
            const p = snapshot(raw), auth = consume('invalidate', p, context, ['user']);
            id(p.reason);
            return transact(() => { ownerRow(auth.ownerKey); db.prepare('UPDATE verification_owners SET pending=1 WHERE owner_key=?').run(auth.ownerKey); audit(auth.ownerKey, 'invalidate', p, auth.principalId); return finishInvalidation(auth.ownerKey); });
        },
        close() {
            if (checkingScopeGuards.size)
                throw Error('verification_scope_guard_reentrant');
            if (!closed) {
                closed = true;
                scopeGuards.clear();
                checkingScopeGuards.clear();
                journal.close();
                if (ownsDatabase)
                    db.close();
            }
        },
    };
    function admitSubject(raw, reuseCurrent) {
        const p = snapshot(raw), key = ownerKey(p.owner);
        denyKSwarmBusiness(p.owner);
        fields(p, ['owner', 'requiredScopeId', 'scopeRevision', 'scopeExpiresAt', 'manifest']);
        id(p.requiredScopeId);
        integer(p.scopeRevision);
        integer(p.scopeExpiresAt);
        if (!Array.isArray(p.manifest) || !p.manifest.length || p.manifest.length > 4096)
            throw Error('verification_subject_manifest');
        const names = new Set();
        for (const file of p.manifest) {
            fields(file, ['path', 'sha256', 'size', 'role']);
            hash(file.sha256);
            integer(file.size);
            id(file.role);
            if (typeof file.path !== 'string' || file.path.length > 4096 || file.path.includes('\\') || file.path.split('/').some((x) => !x || x === '.' || x === '..' || /[:\x00-\x1f]/.test(x)) || names.has(file.path.toLowerCase()))
                throw Error('verification_subject_path');
            names.add(file.path.toLowerCase());
        }
        const manifest = [...p.manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const manifestJson = canonicalVerificationJson(manifest), contentRoot = digest(manifest);
        return transact(() => {
            const c = currentClock(), owner = mutable(key);
            if (p.scopeExpiresAt <= c.upperBound)
                throw Error('verification_scope_expired');
            let subjectId = randomUUID();
            let reuse = false;
            if (reuseCurrent && owner.current_subject !== null) {
                const current = db.prepare('SELECT * FROM verification_subjects WHERE subject_id=?').get(owner.current_subject);
                if (!current || current.owner_key !== key || digest(JSON.parse(current.manifest_json)) !== current.content_root)
                    throw Error('verification_current_subject');
                if (current.service_epoch === serviceEpoch && current.manifest_json === manifestJson && current.content_root === contentRoot) {
                    subjectId = current.subject_id;
                    reuse = true;
                }
            }
            const prior = scopeRow(key, p.requiredScopeId);
            if (prior && (p.scopeRevision < prior.revision || (p.scopeRevision === prior.revision && (p.scopeExpiresAt !== prior.expires_at || prior.clock_domain_id !== c.domainId || prior.clock_qualification_epoch !== c.qualificationEpoch))))
                throw Error('verification_scope_revision');
            assertVerificationDatabaseBudget(db, { additionalBytes: (reuse ? 0 : Buffer.byteLength(manifestJson)) + 2048 });
            const changed = reuse
                ? db.prepare('UPDATE verification_subjects SET scope_id=?,scope_revision=?,service_epoch=? WHERE subject_id=? AND owner_key=?').run(p.requiredScopeId, p.scopeRevision, serviceEpoch, subjectId, key)
                : db.prepare('INSERT INTO verification_subjects VALUES(?,?,?,?,?,?,?)').run(subjectId, key, manifestJson, contentRoot, p.requiredScopeId, p.scopeRevision, serviceEpoch);
            if (changed.changes !== 1)
                throw Error('verification_subject_commit');
            const scopeChanged = db.prepare('INSERT INTO verification_scopes(owner_key,scope_id,revision,expires_at,not_before,clock_domain_id,clock_qualification_epoch) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_key,scope_id) DO UPDATE SET revision=excluded.revision,expires_at=excluded.expires_at,not_before=excluded.not_before,clock_domain_id=excluded.clock_domain_id,clock_qualification_epoch=excluded.clock_qualification_epoch').run(key, p.requiredScopeId, p.scopeRevision, p.scopeExpiresAt, prior?.revision === p.scopeRevision ? prior.not_before : c.lowerBound, c.domainId, c.qualificationEpoch);
            const ownerChanged = db.prepare('UPDATE verification_owners SET current_subject=? WHERE owner_key=?').run(subjectId, key);
            if (scopeChanged.changes !== 1 || ownerChanged.changes !== 1)
                throw Error('verification_subject_commit');
            audit(key, reuseCurrent ? 'admitCurrentSubject' : 'registerSubject', { subjectId, contentRoot }, issuerId);
            const saved = db.prepare('SELECT * FROM verification_subjects WHERE subject_id=?').get(subjectId);
            const expected = { subject_id: subjectId, owner_key: key, manifest_json: manifestJson, content_root: contentRoot, scope_id: p.requiredScopeId, scope_revision: p.scopeRevision, service_epoch: serviceEpoch };
            const scope = scopeRow(key, p.requiredScopeId);
            if (canonicalVerificationJson(saved) !== canonicalVerificationJson(expected) || ownerRow(key).current_subject !== subjectId ||
                !scope || scope.revision !== p.scopeRevision || scope.expires_at !== p.scopeExpiresAt || scope.not_before !== (prior?.revision === p.scopeRevision ? prior.not_before : c.lowerBound) || scope.clock_domain_id !== c.domainId || scope.clock_qualification_epoch !== c.qualificationEpoch)
                throw Error('verification_subject_commit');
            return Object.freeze({ subjectId, contentRoot });
        });
    }
    function inspectIntentPublicationSet(raw, includeSelf) {
        if (!db.inTransaction)
            throw Error('verification_intent_set_transaction');
        return withApplicationParses(() => {
            const registration = parseIntentContractRegistrationObservation(raw.registration), dependencies = intentContractDependencies({ subject: registration.subject, contract: registration.contract }).map(owner => ({ ...owner, profileId: registration.owner.profileId })), expected = includeSelf ? [registration.owner, ...dependencies] : dependencies;
            if (!Array.isArray(raw.tuples) || raw.tuples.length !== expected.length)
                throw Error('verification_intent_set_inventory');
            // Each original tuple retains its own protocol limit; never impose
            // Loop's three-member or a new aggregate tuple-population limit.
            const tuples = raw.tuples.map(value => parseVerificationTuple(snapshot(value)));
            const c = currentClock(), version = () => ({ rows: db.prepare('SELECT total_changes() n').get().n, schema: db.pragma('schema_version', { simple: true }) }), before = version();
            const parentSet = includeSelf && registration.subject.stageId === null;
            let parentReferences;
            const currentReferences = [];
            const publications = tuples.map((tuple, i) => {
                const owner = expected[i], key = ownerKey(owner);
                if (ownerKey({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }) !== key || checkTupleCurrent(tuple, c) !== key)
                    throw Error('verification_intent_set_owner');
                const decision = db.prepare('SELECT tuple_hash,tuple_json FROM settlement_decisions WHERE operation_id=? AND owner_key=?').get(tuple.operationId, key);
                const state = journal.get(tuple), active = application(key);
                if (!decision || decision.tuple_hash !== digest(tuple) || decision.tuple_json !== canonicalVerificationJson(tuple) || state?.reservation !== 'consumed' || state.outbox !== 'receiver_committed' || state.revocation !== 'active' || active.state !== 'active' || active.current?.binding.kind !== 'intent')
                    throw Error('verification_intent_set_not_published');
                const binding = active.current.binding;
                if (canonicalVerificationJson(binding.contract) !== canonicalVerificationJson(registration.contract) || binding.contractHash !== registration.contractHash || binding.subject.stageId === null && !(includeSelf && i === 0 && registration.subject.stageId === null) || ownerKey({ ...intentHostSubjectOwner(binding.subject), profileId: owner.profileId }) !== key)
                    throw Error('verification_intent_set_subject');
                const history = db.prepare('SELECT * FROM verification_application_history WHERE owner_key=? AND revision=?').get(key, active.current.revision);
                if (!history || history.binding_hash !== active.current.bindingHash || history.binding_json !== canonicalVerificationJson(binding))
                    throw Error('verification_intent_set_application');
                hash(history.registration_hash);
                const businessRevision = ownerRow(key).business_revision;
                if (parentSet) {
                    if (i === 0) {
                        if (binding.body.kind !== 'intent-parent')
                            throw Error('verification_intent_parent_reference');
                        parentReferences = binding.body.stages;
                    }
                    else
                        currentReferences.push({ subject: binding.subject, candidateId: binding.candidateId, candidateRevision: binding.candidateRevision, bindingHash: active.current.bindingHash, immutablePayloadHash: tuple.immutablePayloadHash, operationId: tuple.operationId, fullTupleHash: decision.tuple_hash, committedBusinessRevision: businessRevision, receiverId: tuple.receiverId, receiverProtocolVersion: tuple.receiverProtocolVersion, receiverInstanceEpoch: tuple.receiverInstanceEpoch });
                }
                return Object.freeze({ owner: Object.freeze(owner), operationId: tuple.operationId, fullTupleHash: decision.tuple_hash, businessRevision, receiverId: tuple.receiverId, receiverProtocolVersion: tuple.receiverProtocolVersion, receiverInstanceEpoch: tuple.receiverInstanceEpoch, immutablePayloadHash: tuple.immutablePayloadHash, bindingHash: active.current.bindingHash, applicationRevision: active.current.revision, candidateRevision: binding.candidateRevision, registrationHash: history.registration_hash });
            });
            if (parentSet && canonicalVerificationJson(parentReferences) !== canonicalVerificationJson(currentReferences))
                throw Error('verification_intent_parent_reference');
            if (canonicalVerificationJson(version()) !== canonicalVerificationJson(before))
                throw Error('verification_intent_set_changed');
            const tail = currentClock(), after = version();
            if (after.rows !== before.rows + 1 || after.schema !== before.schema)
                throw Error('verification_intent_set_changed');
            for (const tuple of tuples)
                if (tail.domainId !== tuple.clockDomainId || tail.qualificationEpoch !== tuple.clockQualificationEpoch || tail.lowerBound < tuple.notBefore || tail.upperBound >= tuple.validUntil)
                    throw Error('verification_not_current');
            return Object.freeze({ ...(includeSelf ? { scope: 'self-and-dependencies' } : {}), subject: registration.subject, owner: registration.owner, contractHash: registration.contractHash, registrationHash: registration.registrationHash, clock: Object.freeze(tail), publications: Object.freeze(publications) });
        });
    }
    const host = {
        /** Original tuple current check for the private payload composition.
         * No public route, mutation authorization or receiver ticket is created. */
        assertPublicationTuplesCurrent(raw) {
            const values = snapshot(raw);
            if (!Array.isArray(values) || values.length < 1 || values.length > 256)
                throw Error('verification_publication_set');
            const tuples = values.map(parseVerificationTuple);
            if (tuples.some(t => t.profileId !== tuples[0].profileId))
                throw Error('verification_publication_set');
            transact(() => {
                const c = currentClock(), version = () => ({ rows: db.prepare('SELECT total_changes() n').get().n, schema: db.pragma('schema_version', { simple: true }) }), before = version();
                for (const tuple of tuples)
                    checkTupleCurrent(tuple, c);
                if (canonicalVerificationJson(version()) !== canonicalVerificationJson(before))
                    throw Error('verification_publication_current_changed');
                // All scope callbacks have completed. The final qualified clock
                // may only perform its original one-row monotonic-clock write.
                const tail = currentClock(), after = version();
                if (after.rows !== before.rows + 1 || after.schema !== before.schema)
                    throw Error('verification_publication_current_changed');
                for (const t of tuples)
                    if (tail.domainId !== t.clockDomainId || tail.qualificationEpoch !== t.clockQualificationEpoch || tail.lowerBound < t.notBefore || tail.upperBound >= t.validUntil)
                        throw Error('verification_not_current');
            });
        },
        /** Private same-clock observation only. Neither a complete Loop inventory,
         * a payload verification, nor a business mutation capability. */
        /** Transaction-local read composed only after actual enrollment read and
         * before its existing full registration fence. No public owner-list API. */
        inspectIntentPublicationDependencies(raw) { return inspectIntentPublicationSet(raw, false); },
        inspectIntentPublicationCompletion(raw) { return inspectIntentPublicationSet(raw, true); },
        inspectLoopPublicationSet(raw) {
            const values = snapshot(raw);
            if (!Array.isArray(values) || values.length < 1 || values.length > 3 || db.inTransaction)
                throw Error('verification_loop_set');
            const tuples = values.map(parseVerificationTuple), keys = tuples.map(t => ownerKey({ profileId: t.profileId, ownerKind: t.ownerKind, ownerId: t.ownerId }));
            if (tuples.some(t => t.ownerKind !== 'loop' || t.profileId !== tuples[0].profileId) || new Set(keys).size !== keys.length)
                throw Error('verification_loop_set');
            return transact(() => {
                const c = currentClock(), changes = () => ({ rows: db.prepare('SELECT total_changes() n').get().n, schema: db.pragma('schema_version', { simple: true }) });
                const before = canonicalVerificationJson(changes());
                let subject;
                const publications = tuples.map((t, i) => {
                    const key = checkTupleCurrent(t, c), decision = db.prepare('SELECT tuple_hash,tuple_json FROM settlement_decisions WHERE operation_id=? AND owner_key=?').get(t.operationId, key);
                    const state = journal.get(t), active = application(key);
                    if (!decision || decision.tuple_hash !== digest(t) || decision.tuple_json !== canonicalVerificationJson(t) || state?.reservation !== 'consumed' || state.outbox !== 'receiver_committed' || state.revocation !== 'active'
                        || active.state !== 'active' || active.current?.binding.kind !== 'loop')
                        throw Error('verification_loop_set_not_published');
                    const binding = active.current.binding, same = canonicalVerificationJson({ loopId: binding.subject.loopId, runId: binding.subject.runId });
                    if (subject !== undefined && subject !== same)
                        throw Error('verification_loop_set_subject');
                    subject = same;
                    const owner = Object.freeze(JSON.parse(keys[i]));
                    if (canonicalVerificationJson(businessApplicationOwner(binding)) !== canonicalVerificationJson({ ownerKind: owner.ownerKind, ownerId: owner.ownerId }))
                        throw Error('verification_loop_set_subject');
                    return Object.freeze({ owner, businessRevision: ownerRow(key).business_revision, operationId: t.operationId, fullTupleHash: decision.tuple_hash, application: active.current });
                });
                // No callbacks after this fence. This detects trusted guard invariant
                // violations, not arbitrary hostile code holding the raw DB handle.
                if (canonicalVerificationJson(changes()) !== before)
                    throw Error('verification_loop_set_changed');
                return Object.freeze({ clock: Object.freeze(c), publications: Object.freeze(publications) });
            });
        },
        inspectApplication(raw) { denyKSwarmBusiness(raw); const key = ownerKey(snapshot(raw)); return transact(() => snapshot(application(key))); },
        beginApplicationTransition(raw) {
            const p = snapshot(raw);
            denyKSwarmBusiness(p.owner);
            fields(p, ['owner', 'transitionId', 'previousBindingHash', 'binding', 'registrationHash']);
            const key = ownerKey(p.owner), binding = parseBusinessApplicationBinding(p.binding);
            id(p.transitionId);
            hash(p.registrationHash);
            if (p.previousBindingHash !== null)
                hash(p.previousBindingHash);
            if (canonicalVerificationJson({ ownerKind: p.owner.ownerKind, ownerId: p.owner.ownerId }) !== canonicalVerificationJson(businessApplicationOwner(binding)))
                throw Error('verification_application_owner');
            transact(() => {
                const a = application(key), previous = a.current?.bindingHash ?? null;
                if (previous !== p.previousBindingHash)
                    throw Error('verification_application_conflict');
                const existing = db.prepare('SELECT * FROM verification_application_transitions WHERE transition_id=?').get(p.transitionId);
                if (existing) {
                    if (existing.owner_key !== key || existing.previous_hash !== previous || existing.binding_json !== canonicalVerificationJson(binding) || existing.registration_hash !== p.registrationHash || existing.state !== 'pending' || a.pendingTransitionId !== p.transitionId)
                        throw Error('verification_application_conflict');
                    return;
                }
                if (a.pendingTransitionId || a.current && (!sameBusinessApplicationSubject(binding, a.current.binding) || businessApplicationEpoch(binding) <= businessApplicationEpoch(a.current.binding)))
                    throw Error('verification_application_conflict');
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(binding)) * 3 + 8192 });
                db.prepare("INSERT INTO verification_application_transitions VALUES(?,?,?,?,?,'pending')").run(p.transitionId, key, previous, canonicalVerificationJson(binding), p.registrationHash);
                db.prepare('INSERT INTO verification_application_pointers VALUES(?,NULL,?) ON CONFLICT(owner_key) DO UPDATE SET pending_id=excluded.pending_id').run(key, p.transitionId);
                db.prepare('UPDATE verification_owners SET pending=1 WHERE owner_key=?').run(key);
                finishInvalidation(key);
            });
        },
        finishApplicationTransition(raw, transitionId, assertNativeCurrent) {
            denyKSwarmBusiness(raw);
            const key = ownerKey(snapshot(raw));
            id(transitionId);
            if (typeof assertNativeCurrent !== 'function')
                throw Error('verification_application_native');
            const check = assertNativeCurrent;
            return transact(() => {
                function approved() { const r = check(); if (r !== undefined) {
                    void Promise.resolve(r).catch(() => { });
                    throw Error('verification_application_sync');
                } }
                approved();
                const a = application(key), r = db.prepare('SELECT * FROM verification_application_transitions WHERE transition_id=?').get(transitionId);
                if (!r || r.owner_key !== key || r.state !== 'pending' || a.pendingTransitionId !== transitionId || (a.current?.bindingHash ?? null) !== r.previous_hash)
                    throw Error('verification_application_conflict');
                if (finishInvalidation(key) === 'pending')
                    return snapshot(a);
                const binding = parseBusinessApplicationBinding(JSON.parse(r.binding_json)), value = { binding, bindingHash: businessApplicationBindingHash(binding), revision: (a.current?.revision ?? 0) + 1 };
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(r.binding_json) * 2 + 4096 });
                approved();
                db.prepare('INSERT INTO verification_application_history VALUES(?,?,?,?,?)').run(key, value.revision, value.bindingHash, r.binding_json, r.registration_hash);
                db.prepare('UPDATE verification_application_pointers SET current_json=?,pending_id=NULL WHERE owner_key=? AND pending_id=?').run(canonicalVerificationJson(value), key, transitionId);
                db.prepare("UPDATE verification_application_transitions SET state='committed' WHERE transition_id=?").run(transitionId);
                approved();
                return snapshot(application(key));
            });
        },
        /** Denial-only source lifecycle check; expiration never retires an active obligation. */
        assertAttemptsUnreferenced(raw) {
            const ids = snapshot(raw);
            if (!Array.isArray(ids) || ids.length > 65536 || new Set(ids).size !== ids.length)
                throw Error('verification_source_attempts');
            ids.forEach(id);
            transact(() => {
                currentClock();
                const selected = new Set(ids), ancestors = new Set();
                for (const attemptId of ids) {
                    const a = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attemptId);
                    if (!a)
                        throw Error('verification_source_attempt_missing');
                    if (a.state === 'cancelled_before_dispatch') {
                        if (a.execution_json || a.core_json || a.proof_json)
                            throw Error('verification_source_attempt_unknown');
                    }
                    else {
                        if (a.state !== 'terminal' || !a.execution_json || !a.core_json)
                            throw Error('verification_source_attempt_unknown');
                        const core = JSON.parse(a.core_json);
                        if (core.quiescent !== true)
                            throw Error('verification_source_attempt_unknown');
                    }
                    if (db.prepare('SELECT 1 FROM mandatory_observation_checks WHERE active_attempt=?').get(attemptId))
                        throw Error('verification_source_attempt_active');
                    for (const key of graph.ancestors(a.owner_key)) {
                        if (ownerRow(key).pending)
                            throw Error('verification_source_invalidation_pending');
                        ancestors.add(key);
                    }
                }
                const rows = db.prepare('SELECT tuple_json,reply_json,challenge FROM publication_journal').all();
                for (const row of rows) {
                    const tuple = parseVerificationTuple(JSON.parse(row.tuple_json)), related = tuple.obligations.some(d => selected.has(d.activeAttemptId)), key = ownerKey({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId });
                    if (!related && !ancestors.has(key))
                        continue;
                    const state = journal.get(tuple);
                    if (!state || !['consumed', 'cancelled'].includes(state.reservation))
                        throw Error('verification_source_publication_pending');
                    if (!row.reply_json || !row.challenge)
                        throw Error('verification_source_publication_receipt');
                    const reply = JSON.parse(row.reply_json), status = state.reservation === 'consumed' ? 'committed' : 'cancelled';
                    if (reply.fullTupleHash !== digest(tuple) || reply.challenge !== row.challenge || reply.receiverId !== tuple.receiverId || reply.receiverInstanceEpoch !== tuple.receiverInstanceEpoch || reply.result?.status !== status || state.outbox !== (status === 'committed' ? 'receiver_committed' : 'cancelled'))
                        throw Error('verification_source_publication_receipt');
                    if (related) {
                        const decision = db.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=?').get(tuple.operationId);
                        if (!decision || decision.tuple_json !== row.tuple_json)
                            throw Error('verification_source_publication_binding');
                    }
                }
                for (const row of db.prepare('SELECT tuple_json FROM settlement_decisions').all()) {
                    const tuple = parseVerificationTuple(JSON.parse(row.tuple_json));
                    if (tuple.obligations.some(d => selected.has(d.activeAttemptId)) && !journal.get(tuple))
                        throw Error('verification_source_publication_missing');
                }
                currentClock();
            });
        },
        /** Additional private denial predicate; durable requirement survives restart. */
        registerScopeGuard(raw, guard) {
            const p = snapshot(raw);
            denyKSwarmBusiness(p.owner);
            fields(p, ['owner', 'scopeId', 'revision']);
            const key = ownerKey(p.owner);
            id(p.scopeId);
            integer(p.revision);
            const verify = () => { if (checkingScopeGuards.size)
                throw Error('verification_scope_guard_reentrant'); checkingScopeGuards.add('registering'); try {
                assertApprovedOperationScopeGuard(guard, db, p);
            }
            finally {
                checkingScopeGuards.delete('registering');
            } };
            verify();
            transact(() => {
                const c = currentClock();
                mutable(key);
                const scope = scopeRow(key, p.scopeId);
                if (!scope || scope.revision !== p.revision || scope.expires_at === null || scope.expires_at <= c.upperBound)
                    throw Error('verification_scope_guard');
                if (scope.guard_revision !== null && scope.guard_revision !== undefined && scope.guard_revision >= p.revision)
                    throw Error('verification_scope_guard_rebind');
                verify();
                for (const guardId of scopeGuards.keys())
                    if (!db.prepare('SELECT 1 FROM verification_scope_guards WHERE guard_id=?').get(guardId))
                        scopeGuards.delete(guardId);
                if (scopeGuards.size >= 4096)
                    throw Error('verification_scope_guard_capacity');
                assertVerificationDatabaseBudget(db, { additionalBytes: 4096 });
                const guardId = randomUUID();
                db.prepare('INSERT INTO verification_scope_guards VALUES(?,?,?,?,?) ON CONFLICT(owner_key,scope_id) DO UPDATE SET revision=excluded.revision,guard_id=excluded.guard_id,service_epoch=excluded.service_epoch').run(key, p.scopeId, p.revision, guardId, serviceEpoch);
                scopeGuards.set(guardId, guard);
                verify();
            });
        },
        /** Current private recipe input facts, never a physical receipt or a public grant. */
        readAdmittedAttempt(raw) {
            const binding = snapshot(raw);
            fields(binding, ['attemptId', 'subjectId', 'runNonce', 'expected']);
            [binding.attemptId, binding.subjectId, binding.runNonce].forEach(id);
            fields(binding.expected, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'executionIdentity', 'scopeDigest']);
            Object.values(binding.expected).forEach(id);
            hash(binding.expected.scopeDigest);
            return transact(() => {
                const c = currentClock(), a = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(binding.attemptId);
                if (!a || !['running', 'terminal'].includes(a.state) || a.execution_json !== canonicalVerificationJson(binding.expected))
                    throw Error('verification_attempt_admission');
                const owner = mutable(a.owner_key), facts = JSON.parse(a.facts_json);
                const ob = db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(a.owner_key, a.obligation_id);
                if (!ob || ob.active_attempt !== a.attempt_id || facts.subjectId !== binding.subjectId || facts.runNonce !== binding.runNonce || !currentAdmission(facts, a.owner_key, c) || !currentScope(scopeRow(a.owner_key, facts.requiredScopeId), facts.scopeRevision, c))
                    throw Error('verification_attempt_admission');
                const definition = JSON.parse(ob.definition_json);
                if (definition.semantics === 'current-subject' && owner.current_subject !== binding.subjectId)
                    throw Error('verification_attempt_admission');
                return Object.freeze({ owner: Object.freeze(JSON.parse(a.owner_key)), migrationEpoch: owner.migration_epoch,
                    obligation: Object.freeze({ ...definition, requiredCheckIds: Object.freeze([...definition.requiredCheckIds]) }), attemptId: a.attempt_id, attemptEpoch: a.epoch,
                    subjectId: facts.subjectId, contentRoot: facts.contentRoot, sourceRunId: facts.sourceRunId, runNonce: facts.runNonce,
                    requiredScopeId: facts.requiredScopeId, scopeRevision: facts.scopeRevision, expected: Object.freeze({ ...binding.expected }) });
            });
        },
        /** No physical execution exists: bind and this cancellation use the same CAS domain. */
        cancelPreparedAttempt(attemptId) {
            id(attemptId);
            transact(() => {
                currentClock();
                const attempt = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attemptId);
                if (!attempt || attempt.state !== 'prepared' || attempt.execution_json || attempt.core_json || attempt.proof_json)
                    throw Error('verification_not_prepared');
                const changed = db.prepare("UPDATE obligation_attempts SET state='cancelled_before_dispatch' WHERE attempt_id=? AND state='prepared' AND execution_json IS NULL AND core_json IS NULL AND proof_json IS NULL").run(attemptId);
                if (changed.changes !== 1)
                    throw Error('verification_not_prepared');
                audit(attempt.owner_key, 'cancelPreparedAttempt', { attemptId }, issuerId);
            });
        },
        getPendingInvalidationPublications(owner) {
            return transact(() => {
                const key = ownerKey(owner);
                if (!ownerRow(key).pending)
                    return [];
                return graph.ancestors(key).flatMap(k => reservations(k).map(r => parseVerificationTuple(JSON.parse(r.tuple_json))));
            });
        },
        issueReceiverChallenge(tuple) { return journal.issueReceiverChallenge(tuple); },
        acceptReceiverReply(raw, reply) { const tuple = parseVerificationTuple(raw); transact(() => { journal.acceptReceiverReply(tuple, reply); const key = ownerKey({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }); for (const source of graph.descendants(key))
            if (ownerRow(source).pending)
                finishInvalidation(source); }); },
        issueAuthorization(raw) {
            const p = snapshot(raw);
            if (p.method !== 'registerObligations')
                denyKSwarmBusiness(p.owner);
            id(p.principalId);
            id(p.method);
            integer(p.expiresAt);
            if (!['user', 'agent', 'scheduler'].includes(p.requestSource))
                throw Error('verification_request_source');
            const c = currentClock();
            if (p.expiresAt <= c.upperBound || p.expiresAt - c.lowerBound > 300000)
                throw Error('verification_authorization_expiry');
            const token = Object.freeze(Object.create(null));
            authorizations.set(token, { ownerKey: ownerKey(p.owner), method: p.method, digest: digest(p.payload), requestSource: p.requestSource, principalId: p.principalId, expiresAt: p.expiresAt });
            return token;
        },
        registerSubject(raw) { return admitSubject(raw, false); },
        /** Fresh native admission may share only the exact current immutable subject.
         * Each attempt retains its own scope and proof lifetime. Historical subjects are never revived. */
        admitCurrentSubject(raw) { return admitSubject(raw, true); },
        /** Installed host only, after fresh native material approval and original-byte verification.
         * Refreshes admission for an immutable old version; never revives its proofs. */
        refreshOriginalSubject(raw) {
            const p = snapshot(raw);
            denyKSwarmBusiness(p.owner);
            fields(p, ['owner', 'subjectId', 'manifest', 'requiredScopeId', 'scopeRevision', 'scopeExpiresAt']);
            const key = ownerKey(p.owner);
            id(p.subjectId);
            id(p.requiredScopeId);
            integer(p.scopeRevision);
            integer(p.scopeExpiresAt);
            return transact(() => {
                const c = currentClock();
                mutable(key);
                const original = db.prepare('SELECT * FROM verification_subjects WHERE subject_id=? AND owner_key=?').get(p.subjectId, key);
                if (!original || !Array.isArray(p.manifest) || canonicalVerificationJson([...p.manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) !== original.manifest_json || digest(JSON.parse(original.manifest_json)) !== original.content_root)
                    throw Error('verification_original_subject');
                const referenced = obligations(key).some(ob => { if (!['specific-run', 'cumulative'].includes(JSON.parse(ob.definition_json).semantics) || !ob.active_attempt)
                    return false; const attempt = db.prepare('SELECT facts_json FROM obligation_attempts WHERE attempt_id=? AND owner_key=?').get(ob.active_attempt, key); return !!attempt && JSON.parse(attempt.facts_json).subjectId === p.subjectId; });
                if (!referenced)
                    throw Error('verification_original_subject');
                if (p.scopeExpiresAt <= c.upperBound)
                    throw Error('verification_scope_expired');
                const prior = scopeRow(key, p.requiredScopeId);
                if (prior && (p.scopeRevision < prior.revision || (p.scopeRevision === prior.revision && (p.scopeExpiresAt !== prior.expires_at || prior.clock_domain_id !== c.domainId || prior.clock_qualification_epoch !== c.qualificationEpoch))))
                    throw Error('verification_scope_revision');
                assertVerificationDatabaseBudget(db, { additionalBytes: 2048 });
                db.prepare('INSERT INTO verification_scopes(owner_key,scope_id,revision,expires_at,not_before,clock_domain_id,clock_qualification_epoch) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_key,scope_id) DO UPDATE SET revision=excluded.revision,expires_at=excluded.expires_at,not_before=excluded.not_before,clock_domain_id=excluded.clock_domain_id,clock_qualification_epoch=excluded.clock_qualification_epoch').run(key, p.requiredScopeId, p.scopeRevision, p.scopeExpiresAt, prior?.revision === p.scopeRevision ? prior.not_before : c.lowerBound, c.domainId, c.qualificationEpoch);
                db.prepare('UPDATE verification_subjects SET scope_id=?,scope_revision=?,service_epoch=? WHERE subject_id=? AND owner_key=?').run(p.requiredScopeId, p.scopeRevision, serviceEpoch, p.subjectId, key);
                audit(key, 'refreshOriginalSubject', { subjectId: p.subjectId, contentRoot: original.content_root, scopeId: p.requiredScopeId, scopeRevision: p.scopeRevision }, issuerId);
                return Object.freeze({ subjectId: p.subjectId, contentRoot: original.content_root });
            });
        },
        bindExecution(attemptId, raw) {
            const expected = snapshot(raw);
            if (Object.keys(expected).sort().join(',') !== 'compoundOperationId,executionIdentity,scopeDigest,sessionIdentity,validationInvocationId')
                throw Error('verification_execution_binding');
            Object.values(expected).forEach(id);
            hash(expected.scopeDigest);
            transact(() => {
                const c = currentClock();
                const a = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attemptId);
                if (!a || a.state !== 'prepared' || a.execution_json)
                    throw Error('verification_execution_binding');
                const owner = mutable(a.owner_key), facts = JSON.parse(a.facts_json);
                const obligation = db.prepare('SELECT definition_json FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(a.owner_key, a.obligation_id);
                if (!obligation || !currentAdmission(facts, a.owner_key, c) || !currentScope(scopeRow(a.owner_key, facts.requiredScopeId), facts.scopeRevision, c) || (JSON.parse(obligation.definition_json).semantics === 'current-subject' && facts.subjectId !== owner.current_subject))
                    throw Error('verification_attempt_admission');
                db.prepare("UPDATE obligation_attempts SET execution_json=?,state='running' WHERE attempt_id=?").run(canonicalVerificationJson(expected), attemptId);
                audit(a.owner_key, 'bindExecution', { attemptId, expected }, issuerId);
            });
        },
        /** Only the protected runner/independent recipe composition owns this port; never accept it from JSON/RPC. */
        recordControllerResult(attemptId, rawCore, rawVerdict, receipt) {
            id(attemptId);
            const core = snapshot(rawCore), verdict = snapshot(rawVerdict);
            fields(core, ['coreId', 'coreFinalRevision', 'exitCode', 'quiescent', 'outputHashes']);
            fields(verdict, ['verifierHash', 'checks', 'validUntil']);
            if (Array.isArray(verdict.checks))
                verdict.checks.forEach(check => fields(check, ['id', 'passed']));
            id(core.coreId);
            integer(core.coreFinalRevision);
            hash(verdict.verifierHash);
            if (verdict.verifierHash !== verifierHash)
                throw Error('verification_verifier_version');
            integer(verdict.validUntil);
            if (typeof core.quiescent !== 'boolean' || (core.exitCode !== null && !Number.isSafeInteger(core.exitCode)) || !Array.isArray(core.outputHashes))
                throw Error('verification_core');
            core.outputHashes.forEach(hash);
            transact(() => {
                const c = currentClock(), a = db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attemptId);
                if (!a)
                    throw Error('verification_attempt_missing');
                const o = mutable(a.owner_key);
                if (!a.execution_json)
                    throw Error('verification_execution_binding');
                if (a.core_json) {
                    const old = JSON.parse(a.core_json);
                    if (!['unknown', 'terminal'].includes(a.state) || core.coreId !== old.coreId || core.coreFinalRevision !== old.coreFinalRevision + 1)
                        throw Error('verification_core_revision');
                }
                if (!a.core_json && core.coreFinalRevision !== 1)
                    throw Error('verification_core_revision');
                if (core.quiescent) {
                    if (!receipt)
                        throw Error('verification_receipt');
                    const checked = assertPhysical(receipt, JSON.parse(a.execution_json));
                    if (checked !== undefined) {
                        void Promise.resolve(checked).catch(() => { });
                        throw Error('verification_receipt_sync');
                    }
                }
                const ob = db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(a.owner_key, a.obligation_id);
                if (ob.active_attempt !== attemptId)
                    throw Error('verification_attempt_superseded');
                const def = JSON.parse(ob.definition_json);
                if (!Array.isArray(verdict.checks) || verdict.checks.length !== def.requiredCheckIds.length || new Set(verdict.checks.map(x => x.id)).size !== verdict.checks.length || verdict.checks.some(x => typeof x.passed !== 'boolean' || !def.requiredCheckIds.includes(x.id)))
                    throw Error('verification_check_set');
                const facts = JSON.parse(a.facts_json), scope = scopeRow(a.owner_key, facts.requiredScopeId);
                const effectiveValidUntil = Math.min(verdict.validUntil, scope?.expires_at ?? 0);
                const proofEligible = currentAdmission(facts, a.owner_key, c) && (def.semantics !== 'current-subject' || facts.subjectId === o.current_subject) && currentScope(scope, facts.scopeRevision, c) && effectiveValidUntil > c.upperBound;
                const proofRevision = db.prepare('SELECT COALESCE(MAX(revision),0) n FROM verifier_proofs WHERE attempt_id=?').get(attemptId).n + 1;
                const boundCore = { ...core, authorityContext: facts.authorityContext ?? null, owner: JSON.parse(a.owner_key), attemptId, attemptEpoch: a.epoch, sourceRunId: facts.sourceRunId, runNonce: facts.runNonce, subjectId: facts.subjectId, contentRoot: facts.contentRoot, execution: JSON.parse(a.execution_json) };
                const unsigned = { proofId: randomUUID(), proofRevision, issuerId, keyId, serviceEpoch, owner: JSON.parse(a.owner_key), attemptId, attemptEpoch: a.epoch, sourceRunId: facts.sourceRunId, runNonce: facts.runNonce, subjectId: facts.subjectId, contentRoot: facts.contentRoot, requiredScopeId: facts.requiredScopeId, scopeRevision: facts.scopeRevision, predicateId: def.predicateId, predicateVersion: def.predicateVersion, definitionHash: def.definitionHash, coreHash: digest(boundCore), coreId: core.coreId, coreFinalRevision: core.coreFinalRevision, verifierHash: verdict.verifierHash, checks: verdict.checks, checkDigest: digest(verdict.checks), verdict: core.quiescent && proofEligible ? (verdict.checks.every(x => x.passed) ? 'pass' : 'fail') : 'unverified', invalidationEpoch: o.epoch, clockDomainId: c.domainId, clockQualificationEpoch: c.qualificationEpoch, notBefore: c.lowerBound, validUntil: effectiveValidUntil, scopeExpiresAt: scope?.expires_at ?? null };
                const proof = { ...unsigned, signature: sign(null, Buffer.from(canonicalVerificationJson(unsigned)), privateKey).toString('base64') };
                assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(canonicalVerificationJson(proof)) + Buffer.byteLength(canonicalVerificationJson(core)) + 2048 });
                if (Buffer.byteLength(canonicalVerificationJson(boundCore)) > 65536 || Buffer.byteLength(canonicalVerificationJson(proof)) > 65536)
                    throw Error('verification_metadata_limit');
                db.prepare('INSERT INTO execution_facts_revisions VALUES(?,?,?)').run(attemptId, core.coreFinalRevision, canonicalVerificationJson(boundCore));
                if (core.quiescent && proofEligible) {
                    db.prepare('INSERT INTO verifier_proofs VALUES(?,?,?,?)').run(proof.proofId, attemptId, proof.proofRevision, canonicalVerificationJson(proof));
                    for (const [kind, dependency] of [['subject', facts.subjectId], ['core', core.coreId + ':' + core.coreFinalRevision], ['scope', facts.requiredScopeId + ':' + facts.scopeRevision], ['predicate', def.definitionHash]])
                        db.prepare('INSERT INTO proof_dependencies VALUES(?,?,?)').run(proof.proofId, kind, dependency);
                }
                db.prepare('UPDATE obligation_attempts SET state=?,core_json=?,proof_json=? WHERE attempt_id=?').run(core.quiescent ? 'terminal' : 'unknown', canonicalVerificationJson(boundCore), core.quiescent && proofEligible ? canonicalVerificationJson(proof) : null, attemptId);
                audit(a.owner_key, 'controllerResult', { attemptId, core, proof: core.quiescent && proofEligible ? proof : null, proofEligible }, issuerId);
            });
        },
    };
    return Object.freeze({ service: Object.freeze(service), host: Object.freeze(host) });
}
