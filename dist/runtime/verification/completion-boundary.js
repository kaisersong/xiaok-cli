import { readKSwarmEnrollmentSnapshot } from './kswarm-enrollment-store.js';
import { isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createVerificationAuthority } from './proof-authority.js';
import { openPrivateVerificationDatabase } from './private-database.js';
import { canonicalVerificationJson, hashVerificationTuple, parseVerificationTuple } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
function clone(value) { const json = canonicalVerificationJson(value); if (Buffer.byteLength(json) > 1024 ** 2)
    throw Error('completion_payload_limit'); return JSON.parse(json); }
function shape(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('completion_shape'); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function principal(raw) { const p = clone(raw); shape(p, ['uid', 'gid', 'auditSessionId']); if (![p.uid, p.gid, p.auditSessionId].every(x => Number.isSafeInteger(x) && x >= 0) || p.auditSessionId === 0)
    throw Error('completion_kernel_peer'); return `kernel-session:v1:${p.uid}:${p.gid}:${p.auditSessionId}`; }
function ownerKey(owner) { shape(owner, ['profileId', 'ownerKind', 'ownerId']); if (!(['task', 'intent', 'goal', 'loop', 'project'].includes(owner.ownerKind) || isKSwarmOwnerIdentity(owner)) || [owner.profileId, owner.ownerId].some(x => typeof x !== 'string' || !x || Buffer.byteLength(x) > 160 || /[\x00-\x1f\x7f]/.test(x)))
    throw Error('completion_owner'); return canonicalVerificationJson(owner); }
function synchronous(value) { if (value !== undefined) {
    void Promise.resolve(value).catch(() => { });
    throw Error('completion_authority_sync');
} }
/** Installed controller composition only. host issuance requires the broker's native
 * authorization before calling; none of host or authority is a public RPC handler.
 * A kernel peer is supplied exclusively by the accepted socket, never request JSON.
 */
export function createCompletionBoundary(input) {
    const root = input.root, options = input.authority, { serviceEpoch, clock, assertQualified, receiverVerifier } = options;
    const verifyReply = receiverVerifier.verify.bind(receiverVerifier);
    const ownsDatabase = !input.database, db = input.database ?? openPrivateVerificationDatabase(root);
    let authority;
    try {
        authority = createVerificationAuthority({ ...options, root, database: db });
        db.exec(`CREATE TABLE IF NOT EXISTS completion_scope_epochs(owner_key TEXT NOT NULL,principal TEXT NOT NULL,epoch INTEGER NOT NULL,PRIMARY KEY(owner_key,principal));
   CREATE TABLE IF NOT EXISTS completion_access_grants(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,owner_key TEXT NOT NULL,principal TEXT NOT NULL,scope_epoch INTEGER NOT NULL,migration_epoch INTEGER NOT NULL,service_epoch TEXT NOT NULL,expires_at INTEGER NOT NULL,method TEXT NOT NULL,payload_hash TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS completion_access_audit(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,principal TEXT NOT NULL,method TEXT NOT NULL,payload_hash TEXT NOT NULL,source TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS completion_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_lower INTEGER NOT NULL);`);
    }
    catch (error) {
        if (ownsDatabase)
            db.close();
        throw error;
    }
    let closed = false;
    // Private, service-epoch-local provenance. SQL rows alone never issue a handle.
    const issued = new Map();
    const encodeRows = (rows) => canonicalVerificationJson(rows.map(canonicalVerificationJson).sort());
    function accessRows() { return { grants: db.prepare('SELECT * FROM completion_access_grants').all(), audit: db.prepare('SELECT * FROM completion_access_audit').all(), epochs: db.prepare('SELECT * FROM completion_scope_epochs').all() }; }
    function assertAccessRows(expected) { const actual = accessRows(); if (encodeRows(actual.grants) !== encodeRows(expected.grants) || encodeRows(actual.audit) !== encodeRows(expected.audit) || encodeRows(actual.epochs) !== encodeRows(expected.epochs))
        throw Error('completion_scope_write'); }
    function kswarmFence(owner) { const before = owner.ownerKind === 'kswarm' ? readKSwarmEnrollmentSnapshot(db, owner) : undefined; return () => { if (before !== undefined && readKSwarmEnrollmentSnapshot(db, owner) !== before)
        throw Error('completion_scope_owner_changed'); }; }
    function assertIssued(value) { const original = issued.get(value.id); if (!original || canonicalVerificationJson(original) !== canonicalVerificationJson(value))
        throw Error('completion_scope_issuer'); }
    function current() {
        if (closed)
            throw Error('completion_closed');
        synchronous(assertQualified());
        const c = clone(clock());
        if (!c || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.lowerBound < 0 || c.upperBound < c.lowerBound || !Number.isSafeInteger(c.qualificationEpoch) || c.qualificationEpoch < 0 || typeof c.domainId !== 'string' || !c.domainId || !/^[a-f0-9]{64}$/.test(c.evidenceHash))
            throw Error('completion_clock');
        const prior = db.prepare('SELECT last_lower FROM completion_clock WHERE id=1').get();
        if (prior && c.lowerBound < prior.last_lower)
            throw Error('completion_clock_regressed');
        db.prepare('INSERT INTO completion_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_lower=excluded.last_lower').run(c.lowerBound);
        return c;
    }
    function epoch(key, p) { return db.prepare('SELECT epoch FROM completion_scope_epochs WHERE owner_key=? AND principal=?').get(key, p)?.epoch ?? 0; }
    function state(owner) { const result = authority.service.inspectOwner(owner); if (!result)
        throw Error('completion_owner_unknown'); return result; }
    function issue(raw, method, payloadHash, source) {
        const p = clone(raw), key = ownerKey(p.owner), identity = principal(p.peer);
        let actual;
        const result = runVerificationTransaction(db, () => {
            const before = accessRows(), fence = kswarmFence(p.owner), c = current(), s = state(p.owner);
            if (!Number.isSafeInteger(p.expiresAt) || p.expiresAt <= c.upperBound || p.expiresAt - c.lowerBound > 300000)
                throw Error('completion_scope_expiry');
            const retiring = before.grants.filter(row => row.expires_at <= c.lowerBound || row.service_epoch !== serviceEpoch);
            const auditRows = retiring.filter(row => row.method !== 'completion.inspect').map(({ id, owner_key, principal, method, payload_hash, source, expires_at, state }) => ({ id, owner_key, principal, method, payload_hash, source, expires_at, state }));
            assertVerificationDatabaseBudget(db, { additionalBytes: auditRows.length * 1024 });
            db.prepare("INSERT INTO completion_access_audit SELECT id,owner_key,principal,method,payload_hash,source,expires_at,state FROM completion_access_grants WHERE (expires_at<=? OR service_epoch<>?) AND method<>'completion.inspect'").run(c.lowerBound, serviceEpoch);
            db.prepare('DELETE FROM completion_access_grants WHERE expires_at<=? OR service_epoch<>?').run(c.lowerBound, serviceEpoch);
            const remaining = before.grants.filter(row => !retiring.includes(row));
            if (remaining.length >= 4096)
                throw Error('completion_scope_capacity');
            assertVerificationDatabaseBudget(db, { additionalBytes: 4096 });
            const id = randomUUID(), secret = randomBytes(32).toString('hex');
            actual = { id, secret_hash: hash(secret), owner_key: key, principal: identity, scope_epoch: before.epochs.find(row => row.owner_key === key && row.principal === identity)?.epoch ?? 0, migration_epoch: s.migrationEpoch, service_epoch: serviceEpoch, expires_at: p.expiresAt, method, payload_hash: payloadHash, source, state: 'issued' };
            db.prepare("INSERT INTO completion_access_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,'issued')").run(id, actual.secret_hash, key, identity, actual.scope_epoch, s.migrationEpoch, serviceEpoch, p.expiresAt, method, payloadHash, source);
            assertAccessRows({ grants: [...remaining, actual], audit: [...before.audit, ...auditRows], epochs: before.epochs });
            fence();
            return Object.freeze({ id, secret });
        });
        // A surrounding rollback leaves no DB row, so any retained private entry is
        // unusable. Reconcile absent/retired entries at the next successful issuance.
        const live = new Set(db.prepare('SELECT id FROM completion_access_grants').all().map(row => row.id));
        for (const id of issued.keys())
            if (!live.has(id))
                issued.delete(id);
        issued.set(actual.id, Object.freeze({ ...actual }));
        return result;
    }
    function row(handle) { shape(handle, ['id', 'secret']); if (typeof handle.id !== 'string' || typeof handle.secret !== 'string' || !/^[a-f0-9]{64}$/.test(handle.secret))
        throw Error('completion_scope'); const r = db.prepare('SELECT * FROM completion_access_grants WHERE id=?').get(handle.id); if (!r || !timingSafeEqual(Buffer.from(r.secret_hash, 'hex'), Buffer.from(hash(handle.secret), 'hex')))
        throw Error('completion_scope'); assertIssued(r); return r; }
    function check(r, owner, p, expectedState, method, payloadHash, source) {
        assertIssued(r);
        const fence = kswarmFence(owner), key = ownerKey(owner);
        if (r.owner_key !== key || r.principal !== p)
            throw Error('completion_scope');
        const s = state(owner), c = current();
        const live = db.prepare('SELECT * FROM completion_access_grants WHERE id=?').get(r.id);
        if (!live || live.secret_hash !== r.secret_hash)
            throw Error('completion_scope');
        assertIssued(live);
        r = live;
        if (r.owner_key !== key || r.principal !== p || r.service_epoch !== serviceEpoch || r.scope_epoch !== epoch(key, p) || r.expires_at <= c.upperBound || r.state !== expectedState || r.method !== method || r.payload_hash !== payloadHash || r.source !== source)
            throw Error('completion_scope');
        if (s.migrationEpoch !== r.migration_epoch)
            throw Error('completion_scope_migration');
        fence();
        return { clock: c, state: s };
    }
    function tuplePayload(raw) { const p = clone(raw); shape(p, ['owner', 'tuple', 'authorization', 'requestSource']); ownerKey(p.owner); const tuple = parseVerificationTuple(p.tuple); if (canonicalVerificationJson(p.owner) !== canonicalVerificationJson({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }) || !['user', 'agent', 'scheduler'].includes(p.requestSource))
        throw Error('completion_tuple_binding'); return { ...p, tuple }; }
    function challenge(tuple) { const r = db.prepare('SELECT tuple_hash,challenge FROM publication_journal WHERE operation_id=?').get(tuple.operationId); if (!r || r.tuple_hash !== hashVerificationTuple(tuple) || !r.challenge)
        throw Error('completion_challenge_missing'); return Object.freeze({ fullTupleHash: r.tuple_hash, challenge: r.challenge }); }
    const host = Object.freeze({
        assertDatabaseConnection(connection) { if (closed || connection !== db)
            throw Error('completion_database_binding'); },
        issueReadScope(raw) { return issue(raw, 'completion.inspect', '', ''); },
        issueMutation(raw) {
            const p = clone(raw);
            if (!['completion.settle', 'completion.authorize'].includes(p.method))
                throw Error('completion_method');
            const parsed = tuplePayload({ owner: p.owner, tuple: p.tuple, requestSource: p.requestSource, authorization: { id: 'unused', secret: '0'.repeat(64) } });
            return issue({ owner: p.owner, peer: p.peer, expiresAt: p.expiresAt }, p.method, hash(canonicalVerificationJson({ owner: parsed.owner, tuple: parsed.tuple, requestSource: parsed.requestSource })), p.requestSource);
        },
        revokeOwnerPrincipal(raw) { const p = clone(raw), key = ownerKey(p.owner), identity = principal(p.peer); runVerificationTransaction(db, () => { const before = accessRows(), fence = kswarmFence(p.owner); current(); state(p.owner); assertVerificationDatabaseBudget(db, { additionalBytes: 1024 }); const old = before.epochs.find(row => row.owner_key === key && row.principal === identity), next = { owner_key: key, principal: identity, epoch: (old?.epoch ?? 0) + 1 }; db.prepare('INSERT INTO completion_scope_epochs VALUES(?,?,1) ON CONFLICT(owner_key,principal) DO UPDATE SET epoch=epoch+1').run(key, identity); assertAccessRows({ ...before, epochs: [...before.epochs.filter(row => row !== old), next] }); fence(); }); for (const [id, row] of issued)
            if (row.owner_key === key && row.principal === identity)
                issued.delete(id); },
    });
    return Object.freeze({ authority, host,
        invoke(method, raw, kernelPeer) {
            // All untrusted values are detached before invoking qualified-clock or policy code.
            const p = clone(raw), identity = principal(kernelPeer);
            if (method === 'completion.inspect') {
                shape(p, ['owner', 'readGrant']);
                ownerKey(p.owner);
                return runVerificationTransaction(db, () => { const result = check(row(p.readGrant), p.owner, identity, 'issued', 'completion.inspect', '', ''); return Object.freeze({ owner: p.owner, ...result.state }); });
            }
            if (method === 'completion.settle' || method === 'completion.authorize') {
                // Consumption must survive a later proof failure; an outer owner transaction would undo it.
                if (db.inTransaction)
                    throw Error('completion_outer_transaction');
                const request = tuplePayload(p), payloadHash = hash(canonicalVerificationJson({ owner: request.owner, tuple: request.tuple, requestSource: request.requestSource }));
                // Deliberately commit consumption before entering the proof transaction.
                const consumed = runVerificationTransaction(db, () => { const before = accessRows(), r = row(request.authorization); check(r, request.owner, identity, 'issued', method, payloadHash, request.requestSource); const expected = { ...r, state: 'consumed' }; if (db.prepare("UPDATE completion_access_grants SET state='consumed' WHERE id=? AND state='issued'").run(r.id).changes !== 1)
                    throw Error('completion_scope_write'); assertAccessRows({ ...before, grants: before.grants.map(value => value.id === r.id ? expected : value) }); return expected; });
                issued.set(consumed.id, Object.freeze(consumed));
                return runVerificationTransaction(db, () => {
                    const r = db.prepare('SELECT * FROM completion_access_grants WHERE id=?').get(consumed.id);
                    check(r, request.owner, identity, 'consumed', method, payloadHash, request.requestSource);
                    const internalMethod = method === 'completion.settle' ? 'prepareSettlement' : 'authorizePublication';
                    const authorization = authority.host.issueAuthorization({ owner: request.owner, method: internalMethod, payload: { owner: request.owner, tuple: request.tuple }, requestSource: request.requestSource, principalId: identity, expiresAt: r.expires_at });
                    // Native policy callbacks may revoke while issuing: recheck in the same commit.
                    check(r, request.owner, identity, 'consumed', method, payloadHash, request.requestSource);
                    authority.service[internalMethod](request.tuple, { requestSource: request.requestSource, authorization });
                    check(r, request.owner, identity, 'consumed', method, payloadHash, request.requestSource);
                    if (method === 'completion.settle') {
                        const existing = db.prepare('SELECT challenge FROM publication_journal WHERE operation_id=?').get(request.tuple.operationId);
                        if (!existing.challenge)
                            authority.host.issueReceiverChallenge(request.tuple);
                        return Object.freeze({ owner: request.owner, operationId: request.tuple.operationId, fullTupleHash: hashVerificationTuple(request.tuple), committedBusinessRevision: request.tuple.expectedBusinessRevision + 1, state: 'committed' });
                    }
                    return Object.freeze({ operationId: request.tuple.operationId, fullTupleHash: hashVerificationTuple(request.tuple), reservation: 'commit_authorized' });
                });
            }
            if (method === 'completion.receiver-challenge' || method === 'completion.receiver-reply') {
                if (method === 'completion.receiver-reply' && db.inTransaction)
                    throw Error('completion_outer_transaction');
                shape(p, method === 'completion.receiver-challenge' ? ['owner', 'tuple', 'readGrant'] : ['owner', 'tuple', 'readGrant', 'reply']);
                ownerKey(p.owner);
                const tuple = parseVerificationTuple(p.tuple);
                if (ownerKey(p.owner) !== ownerKey({ profileId: tuple.profileId, ownerKind: tuple.ownerKind, ownerId: tuple.ownerId }))
                    throw Error('completion_tuple_binding');
                return runVerificationTransaction(db, () => {
                    const original = row(p.readGrant), fence = kswarmFence(p.owner);
                    check(original, p.owner, identity, 'issued', 'completion.inspect', '', '');
                    const binding = challenge(tuple);
                    if (method === 'completion.receiver-challenge') {
                        check(original, p.owner, identity, 'issued', 'completion.inspect', '', '');
                        fence();
                        return binding;
                    }
                    const authenticated = verifyReply(p.reply, binding);
                    authority.host.acceptReceiverReply(tuple, authenticated);
                    check(original, p.owner, identity, 'issued', 'completion.inspect', '', '');
                    fence();
                    return Object.freeze({ accepted: true });
                });
            }
            throw Error('completion_method');
        },
        close() { if (!closed) {
            closed = true;
            issued.clear();
            try {
                authority.service.close();
            }
            finally {
                if (ownsDatabase)
                    db.close();
            }
        } }, });
}
