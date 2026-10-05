import { readNativeKSwarmCensus } from './native-sqlite-census.js';
import { assertKSwarmSqlIntegrity } from './kswarm-sql-integrity.js';
import { parseOwnerEnrollmentRegistration } from './owner-enrollment-review.js';
import { kswarmHostSubjectOwner, parseKSwarmHostSubject } from './kswarm-host-subject.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { recordKSwarmStorageFeature, prepareStorageOwnerSchema } from './storage-owner-schema.js';
import { assertVerificationDatabaseBudget } from './storage-budget.js';
const TABLE = 'owner_enrollment_kswarm_subjects';
function roster(raw) {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 131072)
        throw Error('enrollment_kswarm_roster');
    const values = rows.map(value => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'compoundOperationId,sessionIdentity,validationInvocationId' || Object.values(value).some(id => typeof id !== 'string' || !id || Buffer.byteLength(id) > 160 || /[\x00-\x1f\x7f]/.test(id)))
        throw Error('enrollment_kswarm_roster'); return json(value); });
    if (new Set(values).size !== values.length || json(values.map(value => JSON.parse(value))) !== raw || json([...values].sort()) !== json(values))
        throw Error('enrollment_kswarm_roster');
    return values;
}
function appendedRoster(before, review) { const rows = [...new Set([...roster(before), ...review.enrollment.invocations.map(json)])].sort(); if (rows.length > 131072)
    throw Error('enrollment_kswarm_roster'); return json(rows.map(value => JSON.parse(value))); }
const SQL = `CREATE TABLE ${TABLE}(logical_owner_key TEXT PRIMARY KEY NOT NULL,owner_key TEXT UNIQUE,subject_json TEXT NOT NULL,registration_json TEXT NOT NULL,invocations_json TEXT NOT NULL,committed INTEGER NOT NULL CHECK(committed IN (0,1)),CHECK(committed=0 OR owner_key IS NOT NULL))`;
function extendsRegistration(before, after) {
    return before.migrationEpoch === after.migrationEpoch && json(before.source) === json(after.source) && before.obligations.length <= after.obligations.length && json(before.obligations) === json(after.obligations.slice(0, before.obligations.length));
}
/** Fixed SQL implementation. Its rows are receipts, never caller capabilities. */
export function createKSwarmEnrollmentStore(db, initialize = true) {
    if (initialize) {
        const definition = db.prepare("SELECT sql FROM main.sqlite_master WHERE type='table' AND name=?").get(TABLE);
        if (definition) {
            if (definition.sql !== SQL || db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='trigger' AND tbl_name=?").get(TABLE))
                throw Error('enrollment_kswarm_schema');
        }
        else
            db.exec(SQL);
        prepareStorageOwnerSchema(db);
    }
    const read = (key) => db.prepare(`SELECT * FROM main.${TABLE} WHERE logical_owner_key=?`).get(key);
    const logical = (principal, kind, id) => json({ uid: principal.uid, accountGeneration: principal.accountGeneration, ownerKind: kind, ownerId: id });
    function profile(principal) {
        const p = db.prepare('SELECT uid,account_id,profile_id,state FROM main.verification_profiles WHERE uid=?').get(principal.uid);
        if (p && p.account_id !== principal.accountGeneration.toLowerCase())
            throw Error('enrollment_kswarm_principal');
        return p;
    }
    function validate(row, owner) {
        if (typeof row.logical_owner_key !== 'string' || typeof row.subject_json !== 'string' || typeof row.registration_json !== 'string' || typeof row.invocations_json !== 'string' || ![0, 1].includes(row.committed) || (row.committed === 1 && typeof row.owner_key !== 'string'))
            throw Error('enrollment_kswarm_receipt');
        const subject = parseKSwarmHostSubject(JSON.parse(row.subject_json)), mapped = kswarmHostSubjectOwner(subject), registration = parseOwnerEnrollmentRegistration(JSON.parse(row.registration_json));
        if (json(subject) !== row.subject_json || json(registration) !== row.registration_json || owner && (owner.ownerKind !== mapped.ownerKind || owner.ownerId !== mapped.ownerId || row.owner_key !== null && row.owner_key !== json(owner)))
            throw Error('enrollment_kswarm_receipt');
        const invocations = roster(row.invocations_json);
        if (row.committed === 0 && invocations.length)
            throw Error('enrollment_kswarm_roster');
        return { subject, mapped, registration, invocations };
    }
    function exists(table, column, value) { return !!db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?").get(table) && !!db.prepare(`SELECT 1 FROM main.${table} WHERE ${column}=?`).get(value); }
    function assertProposal(review) {
        if (review.enrollment.ownerKind !== 'kswarm')
            return;
        const subject = parseKSwarmHostSubject(review.enrollment.kswarmSubject), mapped = kswarmHostSubjectOwner(subject), key = logical(review.principal, mapped.ownerKind, mapped.ownerId), row = read(key), p = profile(review.principal), owner = p ? { ...mapped, profileId: p.profile_id } : undefined;
        if (mapped.ownerId !== review.enrollment.ownerId)
            throw Error('enrollment_kswarm_subject');
        const intent = db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(key);
        if (!row) {
            if (intent)
                throw Error('enrollment_kswarm_legacy');
            if (owner) {
                const k = json(owner);
                for (const table of ['verification_registered_owners', 'verification_owners', 'mandatory_observation_checks', 'verification_registered_invocations', 'owner_enrollment_invocation_receipts', 'verification_application_pointers', 'verification_application_transitions'])
                    if (exists(table, 'owner_key', k))
                        throw Error('enrollment_kswarm_legacy');
            }
            assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(appendedRoster('[]', review)) + 4096 });
            return;
        }
        const original = validate(row, owner);
        if (row.subject_json !== json(subject) || !intent || intent.committed !== row.committed || intent.registration_json !== row.registration_json)
            throw Error('enrollment_kswarm_receipt');
        if (!extendsRegistration(original.registration, review.registration) || row.committed === 0 && row.registration_json !== json(review.registration))
            throw Error('enrollment_kswarm_registration');
        if (row.owner_key !== null && !owner)
            throw Error('enrollment_kswarm_principal');
        if (row.committed === 0 && owner) {
            const registered = db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(json(owner));
            if (registered && (registered.uid !== p.uid || registered.state !== 'pending'))
                throw Error('enrollment_kswarm_uncommitted');
            for (const table of ['verification_owners', 'mandatory_observation_checks', 'owner_enrollment_invocation_receipts', 'verification_application_pointers', 'verification_application_transitions'])
                if (exists(table, 'owner_key', json(owner)))
                    throw Error('enrollment_kswarm_uncommitted');
        }
        const nextRoster = appendedRoster(row.invocations_json, review);
        assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(nextRoster) + 4096 });
        return row;
    }
    function stage(review) {
        if (review.enrollment.ownerKind !== 'kswarm')
            return;
        if (!db.inTransaction)
            throw Error('enrollment_kswarm_transaction');
        recordKSwarmStorageFeature(db);
        const key = logical(review.principal, 'kswarm', review.enrollment.ownerId), prior = read(key);
        if (prior) {
            assertProposal(review);
            return;
        }
        // The original intent has just been inserted in this same transaction.
        const p = profile(review.principal), row = { logical_owner_key: key, owner_key: p ? json({ profileId: p.profile_id, ownerKind: 'kswarm', ownerId: review.enrollment.ownerId }) : null, subject_json: json(parseKSwarmHostSubject(review.enrollment.kswarmSubject)), registration_json: json(review.registration), invocations_json: '[]', committed: 0 };
        assertVerificationDatabaseBudget(db, { additionalBytes: Buffer.byteLength(json(row)) + 4096 });
        if (db.prepare(`INSERT INTO main.${TABLE} VALUES(?,?,?,?,?,?)`).run(row.logical_owner_key, row.owner_key, row.subject_json, row.registration_json, row.invocations_json, 0).changes !== 1 || json(read(key)) !== json(row))
            throw Error('enrollment_kswarm_receipt');
    }
    function commit(owner, review) {
        if (owner.ownerKind !== 'kswarm')
            return;
        if (!db.inTransaction)
            throw Error('enrollment_kswarm_transaction');
        const key = logical(review.principal, 'kswarm', owner.ownerId), prior = read(key);
        if (!prior)
            throw Error('enrollment_kswarm_receipt');
        const original = validate(prior, owner), subject = parseKSwarmHostSubject(review.enrollment.kswarmSubject);
        if (json(subject) !== prior.subject_json || !extendsRegistration(original.registration, review.registration))
            throw Error('enrollment_kswarm_registration');
        const actual = { ...prior, owner_key: json(owner), registration_json: json(review.registration), invocations_json: appendedRoster(prior.invocations_json, review), committed: 1 };
        if (db.prepare(`UPDATE main.${TABLE} SET owner_key=?,registration_json=?,invocations_json=?,committed=1 WHERE logical_owner_key=? AND owner_key IS ? AND subject_json=? AND registration_json=? AND invocations_json=? AND committed=?`).run(actual.owner_key, actual.registration_json, actual.invocations_json, key, prior.owner_key, prior.subject_json, prior.registration_json, prior.invocations_json, prior.committed).changes !== 1 || json(read(key)) !== json(actual))
            throw Error('enrollment_kswarm_receipt');
        recordKSwarmStorageFeature(db);
    }
    function ready(owner, allowPending = false) {
        if (owner.ownerKind !== 'kswarm')
            return;
        assertKSwarmSqlIntegrity(db);
        const p = db.prepare('SELECT uid,account_id,profile_id,state FROM main.verification_profiles WHERE profile_id=?').get(owner.profileId);
        if (!p || !allowPending && p.state !== 'active')
            throw Error('enrollment_kswarm_principal');
        const key = logical({ uid: p.uid, accountGeneration: p.account_id.toUpperCase(), auditSessionId: 1 }, 'kswarm', owner.ownerId), row = read(key);
        if (!row || row.committed !== 1 || row.owner_key !== json(owner))
            throw Error('enrollment_kswarm_receipt');
        const facts = validate(row, owner);
        const registered = db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(json(owner));
        const intent = db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(key);
        const core = db.prepare('SELECT migration_epoch,pending FROM main.verification_owners WHERE owner_key=?').get(json(owner));
        const mandatory = db.prepare('SELECT obligation_id,definition_json FROM main.mandatory_observation_checks WHERE owner_key=?').all(json(owner));
        if (!registered || registered.uid !== p.uid || !allowPending && registered.state !== 'active' || !intent || intent.committed !== 1 || intent.registration_json !== row.registration_json || !core || core.pending !== 0 || core.migration_epoch !== facts.registration.migrationEpoch || mandatory.length !== facts.registration.obligations.length || facts.registration.obligations.some(entry => mandatory.find(r => r.obligation_id === entry.obligation.obligationId)?.definition_json !== json(entry.obligation)))
            throw Error('enrollment_kswarm_registration');
        const active = db.prepare("SELECT profile_id,invocation_json FROM main.verification_registered_invocations WHERE owner_key=? AND state='active'").all(json(owner));
        const receipts = db.prepare('SELECT invocation_json,logical_owner_key,registration_json FROM main.owner_enrollment_invocation_receipts WHERE owner_key=?').all(json(owner));
        const expected = facts.invocations;
        if (json(receipts.map(row => row.invocation_json).sort()) !== json(expected) || receipts.some(row => row.logical_owner_key !== key || !expected.includes(row.invocation_json) || !extendsRegistration(parseOwnerEnrollmentRegistration(JSON.parse(row.registration_json)), facts.registration)))
            throw Error('enrollment_kswarm_roster');
        if (!allowPending && (json(active.map(row => row.invocation_json).sort()) !== json(expected) || active.some(row => row.profile_id !== owner.profileId || !expected.includes(row.invocation_json))))
            throw Error('enrollment_kswarm_roster');
        const feature = db.prepare('SELECT minimum_schema FROM main.verification_storage_features WHERE feature=?').get('kswarm-owner');
        if (feature?.minimum_schema !== 2)
            throw Error('enrollment_kswarm_schema');
        assertKSwarmSqlIntegrity(db);
        return facts;
    }
    return Object.freeze({ assertProposal, stage, commit, ready });
}
export function readKSwarmEnrollmentReceipt(database, owner) { return createKSwarmEnrollmentStore(database, false).ready(owner); }
/** Full original facts around qualified callbacks; never a grant or cached authority. */
export function readKSwarmEnrollmentSnapshot(database, owner) {
    const receipt = readKSwarmEnrollmentReceipt(database, owner), key = json(owner);
    return json({ receipt, ...readNativeKSwarmCensus(database, key, owner.profileId) });
}
