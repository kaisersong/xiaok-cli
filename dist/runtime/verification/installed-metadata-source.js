import { readNativeSqliteCensus, readNativeEnrollmentCensus, canonicalNativeCensusPopulation } from './native-sqlite-census.js';
import { captureOwnerBindingBatch } from './owner-binding-batch-input.js';
import { isDeepStrictEqual as initialIsDeepStrictEqual } from 'node:util';
const isDeepStrictEqual = initialIsDeepStrictEqual;
import { isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { readKSwarmEnrollmentReceipt } from './kswarm-enrollment-store.js';
import { assertStorageOwnerSchema } from './storage-owner-schema.js';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { parseOwnerEnrollmentRegistration } from './owner-enrollment-review.js';
const hash = (v) => createHash('sha256').update(json(v)).digest('hex');
const required = ['verification_profiles', 'verification_registered_owners', 'verification_registered_invocations', 'owner_enrollment_invocation_receipts', 'owner_enrollment_goal_sessions', 'owner_enrollment_intents'];
const sources = new WeakMap(), owners = new WeakMap();
function identifier(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('metadata_source_identity'); }
function parsed(text) { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value) || json(value) !== text)
    throw Error('metadata_source_record'); return value; }
function inventory(s) {
    // One SQLite snapshot, including when nested in the original capacity write
    // transaction. A physical identity check alone cannot prevent mixed reads.
    return s.database.transaction(() => inventorySnapshot(s)).deferred();
}
function inventorySnapshot(s) {
    s.current();
    const db = s.database;
    for (const name of required)
        if (!db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?").get(name))
            throw Error('metadata_source_mapping_missing');
    const enrollmentPopulation = readNativeEnrollmentCensus(db);
    // Validate actual rows in this same snapshot: an absent/damaged UNIQUE
    // constraint must not let a scalar receipt read silently omit another row.
    const uniqueKeys = [['verification_profiles', 'uid'], ['verification_profiles', 'account_id'], ['verification_profiles', 'profile_id'], ['verification_registered_owners', 'owner_key'], ['verification_registered_invocations', 'profile_id,invocation_json'], ['owner_enrollment_invocation_receipts', 'owner_key,invocation_json'], ['owner_enrollment_goal_sessions', 'logical_owner_key'], ['owner_enrollment_goal_sessions', 'owner_key'], ['owner_enrollment_intents', 'logical_owner_key']];
    for (const [table, columns] of uniqueKeys)
        if (db.prepare(`SELECT 1 FROM main.${table} GROUP BY ${columns} HAVING COUNT(*)>1 LIMIT 1`).get())
            throw Error('metadata_source_duplicate');
    const profiles = db.prepare('SELECT uid,account_id,profile_id,state FROM main.verification_profiles ORDER BY uid').all();
    const sessions = new Map(), records = [], ownerSessions = [];
    const registeredLogicalOwners = new Set();
    for (const profile of profiles) {
        if (profile.state !== 'active' || !Number.isSafeInteger(profile.uid) || profile.uid < 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(profile.account_id))
            throw Error('metadata_source_profile_unknown');
        identifier(profile.profile_id);
        const add = (sessionIdentity) => { identifier(sessionIdentity); const sessionKey = hash({ authorityId: s.authorityId, profileId: profile.profile_id, accountId: profile.account_id, sessionIdentity }); sessions.set(sessionKey, Object.freeze({ sessionKey, producerKey: 'installed-controller-metadata' })); };
        const registered = db.prepare('SELECT owner_key,state FROM main.verification_registered_owners WHERE uid=? ORDER BY owner_key').all(profile.uid);
        for (const owner of registered) {
            const o = parsed(owner.owner_key);
            if (Object.keys(o).sort().join(',') !== 'ownerId,ownerKind,profileId' || owner.state !== 'active' || o.profileId !== profile.profile_id || !(['task', 'goal', 'intent', 'loop', 'project'].includes(o.ownerKind) || isKSwarmOwnerIdentity(o)))
                throw Error('metadata_source_owner_unknown');
            identifier(o.ownerId);
            const ownerSessionIds = new Set();
            const collect = (identity) => { identifier(identity); add(identity); ownerSessionIds.add(identity); };
            const logical = json({ uid: profile.uid, accountGeneration: profile.account_id.toUpperCase(), ownerKind: o.ownerKind, ownerId: o.ownerId });
            registeredLogicalOwners.add(logical);
            const intent = db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical);
            if (!intent || intent.committed !== 1)
                throw Error('metadata_source_registration_unknown');
            const registration = parseOwnerEnrollmentRegistration(parsed(intent.registration_json));
            const validateReceipt = (receipt) => { if (!receipt || receipt.logical_owner_key !== logical)
                throw Error('metadata_source_receipt_missing'); const original = parseOwnerEnrollmentRegistration(parsed(receipt.registration_json)); if (original.migrationEpoch !== registration.migrationEpoch || json(original.source) !== json(registration.source) || original.obligations.length > registration.obligations.length || json(original.obligations) !== json(registration.obligations.slice(0, original.obligations.length)))
                throw Error('metadata_source_receipt_changed'); };
            const invocations = db.prepare('SELECT profile_id,invocation_json,state FROM main.verification_registered_invocations WHERE owner_key=? ORDER BY invocation_json').all(owner.owner_key);
            for (const r of invocations) {
                if (r.profile_id !== profile.profile_id || r.state !== 'active')
                    throw Error('metadata_source_invocation_unknown');
                const invocation = parsed(r.invocation_json);
                if (Object.keys(invocation).sort().join(',') !== 'compoundOperationId,sessionIdentity,validationInvocationId')
                    throw Error('metadata_source_invocation');
                Object.values(invocation).forEach(identifier);
                const receipt = db.prepare('SELECT logical_owner_key,registration_json FROM main.owner_enrollment_invocation_receipts WHERE owner_key=? AND invocation_json=?').get(owner.owner_key, r.invocation_json);
                validateReceipt(receipt);
                collect(invocation.sessionIdentity);
                records.push({ profile, owner, invocation, receipt });
            }
            const goal = db.prepare('SELECT logical_owner_key,goal_session_id,registration_json FROM main.owner_enrollment_goal_sessions WHERE owner_key=?').get(owner.owner_key);
            if (goal) {
                if (o.ownerKind !== 'goal')
                    throw Error('metadata_source_goal');
                validateReceipt(goal);
                collect(goal.goal_session_id);
                records.push({ profile, owner, goal });
            }
            ownerSessions.push(Object.freeze({ uid: profile.uid, accountId: profile.account_id, profileId: profile.profile_id, ownerKind: o.ownerKind, ownerId: o.ownerId, sessionIdentities: Object.freeze([...ownerSessionIds].sort()) }));
            if (o.ownerKind === 'kswarm') {
                const receipt = readKSwarmEnrollmentReceipt(db, o);
                records.push({ profile, owner, kswarm: receipt });
            }
            records.push({ profile, owner, intent });
        }
    }
    if (db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='owner_enrollment_kswarm_subjects'").get()) {
        const originalReceiptCensus = readNativeSqliteCensus(db, 'owner_enrollment_kswarm_subjects');
        if (!originalReceiptCensus.present)
            throw Error('metadata_source_mapping_missing');
        const receipts = originalReceiptCensus.rows;
        for (const row of receipts) {
            if (row.committed !== 1 || !row.owner_key)
                throw Error('metadata_source_kswarm_pending');
            const owner = parsed(row.owner_key);
            if (!isKSwarmOwnerIdentity(owner))
                throw Error('metadata_source_kswarm_owner');
            readKSwarmEnrollmentReceipt(db, owner);
        }
        records.push({ kswarmReceipts: receipts, storageFeatures: readNativeSqliteCensus(db, 'verification_storage_features') });
    }
    // Orphan rows must not silently disappear through the joins above.
    const orphan = db.prepare('SELECT 1 FROM main.verification_registered_invocations i LEFT JOIN main.verification_registered_owners o ON o.owner_key=i.owner_key LEFT JOIN main.verification_profiles p ON p.profile_id=i.profile_id WHERE o.owner_key IS NULL OR p.profile_id IS NULL OR o.uid<>p.uid LIMIT 1').get();
    if (orphan || db.prepare('SELECT 1 FROM main.owner_enrollment_invocation_receipts r LEFT JOIN main.verification_registered_invocations i ON i.owner_key=r.owner_key AND i.invocation_json=r.invocation_json WHERE i.owner_key IS NULL LIMIT 1').get() || db.prepare('SELECT 1 FROM main.verification_registered_owners o LEFT JOIN main.verification_profiles p ON p.uid=o.uid WHERE p.uid IS NULL LIMIT 1').get() || db.prepare('SELECT 1 FROM main.owner_enrollment_goal_sessions g LEFT JOIN main.verification_registered_owners o ON o.owner_key=g.owner_key WHERE o.owner_key IS NULL LIMIT 1').get())
        throw Error('metadata_source_orphan'); // Retain all original enrollment rows and columns, including failed rows
    // committed before registry.enroll and optional subject/contract payloads.
    // Only fixed producer tables enter this census, never caller SQL or the
    // capacity/replacement tables changed by this controller's own preparation.
    const intents = enrollmentPopulation.find(table => table.table === 'owner_enrollment_intents');
    if (!intents?.present)
        throw Error('metadata_source_mapping_missing');
    const unresolvedEnrollments = Object.freeze(intents.rows.filter(row => !registeredLogicalOwners.has(String(row.logical_owner_key))).map(row => Object.freeze(row)));
    s.current();
    return { sessions: [...sessions.values()].sort((a, b) => a.sessionKey.localeCompare(b.sessionKey)), censusHash: createHash('sha256').update('{"enrollmentPopulation":' + canonicalNativeCensusPopulation(enrollmentPopulation) + ',"profiles":' + json(profiles) + ',"records":' + json(records) + '}').digest('hex'), enrollmentPopulation, unresolvedEnrollments, profiles: Object.freeze(profiles.map(profile => Object.freeze({ uid: profile.uid, accountId: profile.account_id, profileId: profile.profile_id, state: 'active' }))), ownerSessions: Object.freeze(ownerSessions) };
}
/** Actual controller lifetime is the sole issuer; no caller-provided path/session/partition. */
export function createInstalledControllerMetadataSource(lifetime) {
    assertInstalledControllerLifetime(lifetime);
    const database = lifetime.database, authorityId = lifetime.manifest.authorityId, path = join(lifetime.state, 'authority.sqlite');
    if (realpathSync(database.name) !== realpathSync(path))
        throw Error('metadata_source_database');
    const identity = () => { const stat = lstatSync(path, { bigint: true }); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
        throw Error('metadata_source_file'); return json({ dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid) }); };
    const physicalIdentity = identity(), writerGeneration = lifetime.serviceEpoch;
    identifier(writerGeneration);
    const source = { lifetime, database, authorityId, physicalIdentity, writerGeneration, resourceId: 'metadata-controller-' + hash({ authorityId, physicalIdentity }), current() { assertInstalledControllerLifetime(lifetime); assertStorageOwnerSchema(database, lifetime.manifest); if (lifetime.database !== database || identity() !== physicalIdentity)
            throw Error('metadata_source_changed'); } };
    const handle = Object.freeze({});
    sources.set(handle, source);
    return handle;
}
export function readInstalledMetadataSource(handle, database, authorityId) { const source = sources.get(handle); if (!source || source.database !== database || source.authorityId !== authorityId)
    throw Error('metadata_source_brand'); const facts = inventory(source); const bind = (identity) => { const value = Object.freeze({}); owners.set(value, { source, identity, censusHash: facts.censusHash }); return value; }; return Object.freeze({ kind: 'controller', writerGeneration: source.writerGeneration, resourceId: source.resourceId, physicalIdentity: source.physicalIdentity, beneficiaryCensusHash: facts.censusHash, owner: bind(Object.freeze({ sessionKey: hash({ authorityId, component: 'controller-metadata' }), producerKey: 'installed-controller-metadata' })), beneficiaries: Object.freeze(facts.sessions.map(bind)), pageSize: database.pragma('page_size', { simple: true }), pageCount: database.pragma('page_count', { simple: true }) }); }
export function readInstalledMetadataOwner(handle, database, authorityId) { const value = owners.get(handle); if (!value || value.source.database !== database || value.source.authorityId !== authorityId)
    throw Error('metadata_owner_brand'); if (inventory(value.source).censusHash !== value.censusHash)
    throw Error('metadata_owner_census_changed'); return value.identity; }
/** Fresh full Source census at one checkpoint, never a cross-call facts cache. */
export function readInstalledMetadataOwners(handles, database, authorityId) {
    if (arguments.length !== 3)
        throw Error('metadata_owner_arguments');
    const entries = captureOwnerBindingBatch(handles).map(handle => { const value = owners.get(handle); if (!value || value.source.database !== database || value.source.authorityId !== authorityId)
        throw Error('metadata_owner_brand'); return value; });
    return database.transaction(() => {
        const stamp = () => json([database.pragma('main.schema_version', { simple: true }), String(database.prepare('SELECT total_changes() AS n').safeIntegers(true).get().n)]), before = stamp(), current = new Map();
        for (const entry of entries)
            if (!current.has(entry.source))
                current.set(entry.source, inventory(entry.source));
        // No Source/lifetime/authority callback runs after this closing census.
        const closing = readNativeEnrollmentCensus(database);
        if (stamp() !== before)
            throw Error('metadata_owner_census_changed');
        for (const facts of current.values())
            if (!isDeepStrictEqual(facts.enrollmentPopulation, closing))
                throw Error('metadata_owner_census_changed');
        return Object.freeze(entries.map(entry => { if (current.get(entry.source).censusHash !== entry.censusHash)
            throw Error('metadata_owner_census_changed'); return entry.identity; }));
    }).deferred();
}
/** Snapshot facts only: these objects are never accepted as capacity owners.
 * Empty owner sessions remain unresolved until the full source collector has
 * joined original ordinary sources and retained historical associations. */
export function readInstalledMetadataSessions(handle, database, authorityId) {
    const source = sources.get(handle);
    if (!source || source.database !== database || source.authorityId !== authorityId)
        throw Error('metadata_source_brand');
    const facts = inventory(source);
    return Object.freeze({ version: 1, sourceCensusHash: facts.censusHash, ownerSessions: facts.ownerSessions });
}
/** Original native facts only. No caller DB/session DTO, capacity owner, drain,
 * retirement approval, legacy completeness or target write permission. */
export function readInstalledMetadataSessionFacts(lifetime, handle) {
    if (arguments.length !== 2)
        throw Error('metadata_source_arguments');
    const source = sources.get(handle);
    if (!source || source.lifetime !== lifetime)
        throw Error('metadata_source_brand');
    const facts = inventory(source);
    return Object.freeze({ version: 1, authorityId: source.authorityId, resourceId: source.resourceId, physicalIdentity: source.physicalIdentity, writerGeneration: source.writerGeneration, sourceCensusHash: facts.censusHash, profiles: facts.profiles, enrollmentPopulation: facts.enrollmentPopulation, unresolvedEnrollments: facts.unresolvedEnrollments, ownerSessions: facts.ownerSessions });
}
