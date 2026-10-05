import { assertNativeSqliteProducerTableKinds, assertNativeSqliteStoredProducerColumns } from './native-sqlite-census.js';
import { captureKSwarmEnrollmentData } from './kswarm-enrollment-data.js';
import { parseKSwarmHostSubject, kswarmHostSubjectOwner, isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { assertIntentContractEnrollmentInput } from './intent-contract-enrollment.js';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { assertVerificationDatabaseBudget, runVerificationTransaction } from './storage-budget.js';
import { parseIntentContractEnrollment } from './intent-contract-enrollment.js';
import { intentHostSubjectOwner } from './intent-host-subject.js';
import { parseLoopHostSubject, loopHostSubjectOwner } from './loop-host-subject.js';
const capacityBindings = new WeakMap();
export function readProfileCapacityOwnerBinding(binding, database) { const entry = capacityBindings.get(binding); if (!entry || entry.database !== database)
    throw Error('profile_capacity_binding'); entry.assertCurrent(); return entry.facts; }
const identifier = (x) => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 160 && !/[\x00-\x1f\x7f]/.test(x);
function clone(raw) { const text = json(raw); if (Buffer.byteLength(text) > 1024 ** 2)
    throw Error('profile_registry_limit'); return JSON.parse(text); }
function shape(raw, fields) { if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== fields.sort().join(','))
    throw Error('profile_registry_shape'); }
function sync(value) { if (value !== undefined) {
    void Promise.resolve(value).catch(() => { });
    throw Error('profile_registry_sync');
} }
function peerValue(raw) { const p = clone(raw); shape(p, ['uid', 'gid', 'auditSessionId']); if (![p.uid, p.gid, p.auditSessionId].every(x => Number.isSafeInteger(x) && x >= 0 && x <= 0xffffffff) || p.uid === 0 || p.auditSessionId === 0)
    throw Error('profile_registry_peer'); return Object.freeze(p); }
function invocationValue(raw) { const p = clone(raw); shape(p, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId']); if (!Object.values(p).every(identifier))
    throw Error('profile_registry_invocation'); return Object.freeze(p); }
export function parseOwnerEnrollment(raw) {
    raw = captureKSwarmEnrollmentData(raw);
    assertIntentContractEnrollmentInput(raw);
    const proposal = clone(raw), sessionOnly = Object.hasOwn(proposal, 'goalSessionId'), loopOnly = Object.hasOwn(proposal, 'loopSubject'), intentOnly = Object.hasOwn(proposal, 'intentContract'), kswarmOnly = Object.hasOwn(proposal, 'kswarmSubject');
    shape(proposal, ['ownerKind', 'ownerId', 'invocations', ...(sessionOnly ? ['goalSessionId'] : []), ...(loopOnly ? ['loopSubject'] : []), ...(intentOnly ? ['intentContract'] : []), ...(kswarmOnly ? ['kswarmSubject'] : [])]);
    if (!(['task', 'intent', 'goal', 'loop', 'project'].includes(proposal.ownerKind) || isKSwarmOwnerIdentity(proposal)) || !identifier(proposal.ownerId) || !Array.isArray(proposal.invocations) || proposal.invocations.length > 256
        || [sessionOnly, loopOnly, intentOnly, kswarmOnly].filter(Boolean).length > 1 || (sessionOnly ? (proposal.ownerKind !== 'goal' || !identifier(proposal.goalSessionId) || proposal.invocations.length !== 0) : kswarmOnly ? false : loopOnly || intentOnly ? proposal.invocations.length !== 0 : !proposal.invocations.length))
        throw Error('profile_registry_enrollment');
    if (proposal.ownerKind === 'kswarm' && !kswarmOnly)
        throw Error('profile_registry_kswarm_subject');
    if (kswarmOnly) {
        const subject = parseKSwarmHostSubject(proposal.kswarmSubject), owner = kswarmHostSubjectOwner(subject);
        if (proposal.ownerKind !== owner.ownerKind || proposal.ownerId !== owner.ownerId)
            throw Error('profile_registry_kswarm_subject');
        proposal.kswarmSubject = subject;
    }
    if (loopOnly) {
        const subject = parseLoopHostSubject(proposal.loopSubject), owner = loopHostSubjectOwner(subject);
        if (proposal.ownerKind !== owner.ownerKind || proposal.ownerId !== owner.ownerId)
            throw Error('profile_registry_loop_subject');
        proposal.loopSubject = subject;
    }
    if (intentOnly) {
        const binding = parseIntentContractEnrollment(proposal.intentContract), owner = intentHostSubjectOwner(binding.subject);
        if (proposal.ownerKind !== owner.ownerKind || proposal.ownerId !== owner.ownerId)
            throw Error('profile_registry_intent_subject');
        proposal.intentContract = binding;
    }
    const invocations = proposal.invocations.map(invocationValue), encoded = invocations.map(json);
    if (new Set(encoded).size !== encoded.length)
        throw Error('profile_registry_invocation_duplicate');
    return Object.freeze({ ...proposal, invocations: Object.freeze(invocations) });
}
/** Private service composition only. Native OS identity, authorization and fixed-path
 * durable publication ports must be supplied by the installed authority. */
export function createProfileOwnerRegistry(options) {
    const { database: db, authorityId, resolvePrincipal, assertEnrollmentAuthorization, assertEnrollmentCurrent, publishProfile, assertProfilePublished, commitEnrollment, assertInvocationCommitted, assertEnrollmentFinal } = options;
    if (!identifier(authorityId))
        throw Error('profile_registry_authority');
    db.exec(`CREATE TABLE IF NOT EXISTS verification_profiles(uid INTEGER PRIMARY KEY,account_id TEXT UNIQUE NOT NULL,profile_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_registered_owners(owner_key TEXT PRIMARY KEY,uid INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS verification_registered_invocations(profile_id TEXT NOT NULL,invocation_json TEXT NOT NULL,owner_key TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(profile_id,invocation_json));`);
    let busy = false;
    function exclusive(work) { if (busy)
        throw Error('profile_registry_reentrant'); busy = true; try {
        return work();
    }
    finally {
        busy = false;
    } }
    function identity(peer) { const p = clone(resolvePrincipal(peer)); shape(p, ['uid', 'accountId']); if (p.uid !== peer.uid || typeof p.accountId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.accountId))
        throw Error('profile_registry_identity'); return Object.freeze(p); }
    function same(peer, p) { if (json(identity(peer)) !== json(p))
        throw Error('profile_registry_identity_changed'); }
    function profile(p) { assertNativeSqliteProducerTableKinds(db); for (const table of ['verification_profiles', 'verification_registered_owners', 'verification_registered_invocations'])
        assertNativeSqliteStoredProducerColumns(db, table); const r = db.prepare('SELECT * FROM main.verification_profiles WHERE uid=?').get(p.uid); if (r && r.account_id !== p.accountId)
        throw Error('profile_registry_identity_changed'); return r; }
    function index(r) { return Object.freeze({ version: 1, authorityId, uid: r.uid, accountId: r.account_id, profileId: r.profile_id }); }
    function liveProfile(peer) { const p = identity(peer), r = profile(p); if (!r)
        throw Error('profile_registry_unregistered'); if (r.state !== 'active')
        throw Error('profile_registry_pending'); sync(assertProfilePublished(index(r))); same(peer, p); return r; }
    const api = Object.freeze({
        enroll(raw, rawContext) {
            return exclusive(() => {
                if (db.inTransaction)
                    throw Error('profile_registry_outer_transaction');
                shape(rawContext, ['peer', 'requestSource', 'authorization']);
                for (const d of Object.values(Object.getOwnPropertyDescriptors(rawContext)))
                    if (!('value' in d))
                        throw Error('profile_registry_accessor');
                const peer = peerValue(rawContext.peer), source = rawContext.requestSource, authorization = rawContext.authorization;
                if (source !== 'user')
                    throw Error('profile_registry_source');
                if (!authorization || typeof authorization !== 'object')
                    throw Error('profile_registry_authorization');
                const frozen = parseOwnerEnrollment(raw), proposal = frozen, invocations = frozen.invocations, encoded = invocations.map(json), principal = identity(peer);
                // Consumed outside all SQLite work. Failed publication never restores approval.
                const context = Object.freeze({ peer, requestSource: source, authorization }), check = () => { sync(assertEnrollmentCurrent(frozen, context)); same(peer, principal); };
                sync(assertEnrollmentAuthorization(frozen, context));
                check();
                const owner = runVerificationTransaction(db, () => {
                    check();
                    let r = profile(principal);
                    assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(frozen)) + 16384 });
                    if (!r) {
                        if (db.prepare('SELECT COUNT(*) n FROM main.verification_profiles').get().n >= 64)
                            throw Error('profile_registry_capacity');
                        r = { uid: principal.uid, account_id: principal.accountId, profile_id: randomUUID(), state: 'pending' };
                        db.prepare('INSERT INTO main.verification_profiles VALUES(?,?,?,?)').run(r.uid, r.account_id, r.profile_id, r.state);
                    }
                    const owner = Object.freeze({ profileId: r.profile_id, ownerKind: proposal.ownerKind, ownerId: proposal.ownerId }), key = json(owner);
                    const prior = db.prepare('SELECT uid FROM main.verification_registered_owners WHERE owner_key=?').get(key);
                    if (prior && prior.uid !== peer.uid)
                        throw Error('profile_registry_owner_binding');
                    if (!prior) {
                        if (db.prepare('SELECT COUNT(*) n FROM main.verification_registered_owners').get().n >= 4096)
                            throw Error('profile_registry_capacity');
                        db.prepare("INSERT INTO main.verification_registered_owners VALUES(?,?,'pending')").run(key, peer.uid);
                    }
                    for (const value of encoded) {
                        const old = db.prepare('SELECT owner_key FROM main.verification_registered_invocations WHERE profile_id=? AND invocation_json=?').get(r.profile_id, value);
                        if (old && old.owner_key !== key)
                            throw Error('profile_registry_invocation_binding');
                        if (!old) {
                            if (db.prepare('SELECT COUNT(*) n FROM main.verification_registered_invocations').get().n >= 131072)
                                throw Error('profile_registry_capacity');
                            db.prepare("INSERT INTO main.verification_registered_invocations VALUES(?,?,?,'pending')").run(r.profile_id, value, key);
                        }
                    }
                    check();
                    return owner;
                });
                check();
                const record = profile(principal);
                sync(publishProfile(index(record)));
                sync(assertProfilePublished(index(record)));
                runVerificationTransaction(db, () => {
                    check();
                    const current = profile(principal);
                    if (!current || current.profile_id !== owner.profileId)
                        throw Error('profile_registry_identity_changed');
                    sync(assertProfilePublished(index(current)));
                    const key = json(owner);
                    if (!(db.prepare('SELECT 1 FROM main.verification_registered_owners WHERE owner_key=? AND uid=?').get(key, peer.uid)))
                        throw Error('profile_registry_owner_binding');
                    for (const value of encoded) {
                        const bound = db.prepare('SELECT owner_key FROM main.verification_registered_invocations WHERE profile_id=? AND invocation_json=?').get(owner.profileId, value);
                        if (bound?.owner_key !== key)
                            throw Error('profile_registry_invocation_binding');
                    }
                    // Completion registration and source activation share this exact final transaction.
                    sync(commitEnrollment?.(owner, frozen, context));
                    db.prepare("UPDATE main.verification_profiles SET state='active' WHERE uid=?").run(peer.uid);
                    db.prepare("UPDATE main.verification_registered_owners SET state='active' WHERE owner_key=?").run(key);
                    for (const value of encoded)
                        db.prepare("UPDATE main.verification_registered_invocations SET state='active' WHERE profile_id=? AND invocation_json=?").run(owner.profileId, value);
                    check();
                    sync(assertEnrollmentFinal?.(owner, frozen, context));
                });
                return owner;
            });
        },
        createCapacityOwnerBinding(rawPeer, rawInvocation) {
            const peer = peerValue(rawPeer), invocation = invocationValue(rawInvocation), profile = api.getProfile(peer), ownerKey = api.resolveOwnerKey(peer, invocation);
            const facts = Object.freeze({ authorityId, profileId: profile.profileId, ownerKey, sessionKey: createHash('sha256').update(json({ authorityId, profileId: profile.profileId, accountId: profile.accountId, sessionIdentity: invocation.sessionIdentity })).digest('hex'), invocation });
            const binding = Object.freeze({});
            capacityBindings.set(binding, { database: db, facts, assertCurrent() { if (json(api.getProfile(peer)) !== json(profile) || api.resolveOwnerKey(peer, invocation) !== ownerKey)
                    throw Error('profile_capacity_changed'); } });
            return binding;
        },
        resolveOwnerKey(rawPeer, rawInvocation) {
            return exclusive(() => {
                const peer = peerValue(rawPeer), invocation = invocationValue(rawInvocation);
                return runVerificationTransaction(db, () => {
                    const r = liveProfile(peer), bound = db.prepare('SELECT owner_key,state FROM main.verification_registered_invocations WHERE profile_id=? AND invocation_json=?').get(r.profile_id, json(invocation));
                    if (!bound)
                        throw Error('profile_registry_invocation');
                    if (bound.state !== 'active')
                        throw Error('profile_registry_pending');
                    const owner = db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(bound.owner_key);
                    if (!owner || owner.uid !== peer.uid || owner.state !== 'active')
                        throw Error('profile_registry_owner_binding');
                    const fence = assertInvocationCommitted?.(JSON.parse(bound.owner_key), invocation, peer);
                    if (fence !== undefined && typeof fence !== 'function') {
                        sync(fence);
                        throw Error('profile_registry_fence');
                    }
                    liveProfile(peer);
                    fence?.();
                    return bound.owner_key;
                });
            });
        },
        resolveOwner(rawPeer, raw) {
            return exclusive(() => {
                const peer = peerValue(rawPeer), value = clone(raw);
                shape(value, ['ownerKind', 'ownerId']);
                if (!(['task', 'intent', 'goal', 'loop', 'project'].includes(value.ownerKind) || isKSwarmOwnerIdentity(value)) || !identifier(value.ownerId))
                    throw Error('profile_registry_owner_binding');
                return runVerificationTransaction(db, () => {
                    const r = liveProfile(peer), owner = Object.freeze({ profileId: r.profile_id, ownerKind: value.ownerKind, ownerId: value.ownerId });
                    const row = db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(json(owner));
                    if (!row || row.uid !== peer.uid || row.state !== 'active')
                        throw Error('profile_registry_owner_binding');
                    liveProfile(peer);
                    return owner;
                });
            });
        },
        getProfile(rawPeer) { return exclusive(() => { const peer = peerValue(rawPeer); return runVerificationTransaction(db, () => index(liveProfile(peer))); }); },
    });
    return api;
}
