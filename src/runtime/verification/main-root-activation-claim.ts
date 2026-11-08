import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { canonicalVerificationJson as json, VERIFICATION_BUDGET } from './protocol.js';
import { assertVerificationDatabaseBudget } from './storage-budget.js';
import { parseMainRootFamilyEnrollmentRecord, parseMainRootFamilyPrincipal, mainRootFamilyReviewHash, type MainRootFamilyPrincipal } from './main-root-family-enrollment-data.js';
import { decodeMainRootAcceptedProjection, mainRootActivationClaimCoreHash } from './main-root-enrollment-codec.js';
const bufferFrom = Buffer.from, byteLength = Buffer.byteLength;
const parse = JSON.parse, freeze = Object.freeze, keys = Object.keys, own = Object.hasOwn;
const nativeHash = createHash, apply = Reflect.apply, hashPrototype = Object.getPrototypeOf(nativeHash('sha256')), update = hashPrototype.update, digest = hashPrototype.digest;
export interface MainRootActivationClaim {
    version: 1;
    purpose: 'main-root-family-activation';
    phase: 'claim_committed';
    authorityId: string;
    activationRequestId: string;
    operationId: string;
    pendingOperationId: string;
    profileId: string;
    principal: Readonly<MainRootFamilyPrincipal>;
    sourceEntryId: string;
    projectionHex: string;
}
interface Row {
    owner_key: string;
    profile_id: string;
    marker_json: string;
    state: string;
    published: number;
    charged_bytes: number;
}
const textFields = ['authorityId', 'activationRequestId', 'operationId', 'pendingOperationId', 'profileId'];
const fields = ['version', 'purpose', 'phase', 'authorityId', 'activationRequestId', 'operationId', 'pendingOperationId', 'profileId', 'principal', 'sourceEntryId', 'projectionHex'];
function invalid(): never { throw Error('main_root_activation_claim'); }
function hash(text: string): string { const h = nativeHash('sha256'); apply(update, h, [text]); return apply(digest, h, ['hex']); }
function text(raw: unknown): asserts raw is string { if (typeof raw !== 'string' || !raw || byteLength(raw) > 160 || /[\x00-\x1f\x7f]/.test(raw))
    invalid(); }
function sameAccount(a: Readonly<MainRootFamilyPrincipal>, b: Readonly<MainRootFamilyPrincipal>) { return a.uid === b.uid && a.accountGeneration === b.accountGeneration; }
function parseClaim(raw: unknown): Readonly<MainRootActivationClaim> {
    let value: any;
    try {
        const encoded = json(raw);
        if (byteLength(encoded) > 16384)
            invalid();
        value = parse(encoded);
        if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value).length !== fields.length)
            invalid();
        for (let i = 0; i < fields.length; i++)
            if (!own(value, fields[i]!))
                invalid();
        if (value.version !== 1 || value.purpose !== 'main-root-family-activation' || value.phase !== 'claim_committed')
            invalid();
        for (let i = 0; i < textFields.length; i++)
            text(value[textFields[i]!]);
        value.principal = parseMainRootFamilyPrincipal(value.principal);
        if (typeof value.sourceEntryId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceEntryId) || /^0{64}$/.test(value.sourceEntryId) || typeof value.projectionHex !== 'string' || !/^[a-f0-9]{4160}$/.test(value.projectionHex))
            invalid();
        const bytes = bufferFrom(value.projectionHex, 'hex'), projection = decodeMainRootAcceptedProjection(bytes);
        if (projection.uid !== value.principal.uid || projection.accountGeneration !== value.principal.accountGeneration || projection.authorityIdHash !== hash(value.authorityId) || projection.profileHash !== hash(value.profileId) || projection.operationHash !== hash(value.operationId) || projection.pendingOperationHash !== hash(value.pendingOperationId) || projection.committedCommandHash !== mainRootActivationClaimCoreHash(bytes))
            invalid();
    }
    catch (error) {
        throw Error('main_root_activation_claim', { cause: error });
    }
    return freeze(value) as Readonly<MainRootActivationClaim>;
}
/** Original journal metadata only. A recorded core/hash/sourceEntryId is NOT a
 * Native approval/Source grant or proof that the caller transaction committed.
 * The fixed root publisher must independently check its private original Entry,
 * final approval and the post-COMMIT signed command before any protected IO. */
export function createMainRootActivationClaimJournal(input: {
    database: Database;
    authorityId: string;
    current(): void;
}) {
    const { database: db, authorityId, current } = input;
    function all(): Row[] { return db.prepare("SELECT * FROM main.migration_publication_intents WHERE owner_key LIKE 'main-root-activation:%' ORDER BY owner_key").all() as Row[]; }
    function key(record: Readonly<MainRootActivationClaim>) { return 'main-root-activation:' + hash(json({ authorityId, uid: record.principal.uid, accountGeneration: record.principal.accountGeneration, activationRequestId: record.activationRequestId })); }
    function decode(row: Row): Readonly<MainRootActivationClaim> {
        const record = parseClaim(parse(row.marker_json));
        if (record.authorityId !== authorityId || row.owner_key !== key(record) || row.profile_id !== record.profileId || row.state !== 'activation_claim' || row.published !== 0 || !Number.isSafeInteger(row.charged_bytes) || row.charged_bytes < 1)
            invalid();
        return record;
    }
    function originalBinding(record: Readonly<MainRootActivationClaim>) {
        const p = record.principal, profile = db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(p.uid) as {
            profile_id: string;
            account_id: string;
        } | undefined;
        if (!profile || profile.profile_id !== record.profileId || profile.account_id !== p.accountGeneration.toLowerCase())
            invalid();
        const rows = db.prepare("SELECT marker_json FROM main.migration_publication_intents WHERE owner_key LIKE 'main-root-family:%'").all() as {
            marker_json: string;
        }[];
        let found = false;
        for (let i = 0; i < rows.length; i++) {
            const pending = parseMainRootFamilyEnrollmentRecord(parse(rows[i]!.marker_json));
            if (pending.review.authorityId === authorityId && pending.review.operationId === record.pendingOperationId && pending.review.profileId === record.profileId && sameAccount(pending.review.principal, p)) {
                if (pending.phase === 'cancelled' || pending.review.principal.auditSessionId !== p.auditSessionId || pending.review.principal.gid !== p.gid)
                    invalid();
                const projection = decodeMainRootAcceptedProjection(bufferFrom(record.projectionHex, 'hex'));
                if (projection.finalReviewHash === mainRootFamilyReviewHash(pending.review))
                    invalid();
                found = true;
            }
        }
        if (!found)
            invalid();
    }
    function readClaims(raw: Readonly<MainRootFamilyPrincipal>) {
        const principal = parseMainRootFamilyPrincipal(raw);
        current();
        const rows = all(), result: Readonly<MainRootActivationClaim>[] = [];
        for (let i = 0; i < rows.length; i++) {
            const record = decode(rows[i]!);
            if (sameAccount(record.principal, principal)) result.push(record);
        }
        current();
        return freeze(result);
    }
    return freeze({
        readMainRootActivationClaims: readClaims,
        assertMainRootFamilyUnclaimed(principal: Readonly<MainRootFamilyPrincipal>) {
            if (readClaims(principal).length) throw Error('main_root_activation_requires_recovery');
        },
        prepareMainRootActivationClaim(raw: unknown) {
            if (!db.inTransaction)
                throw Error('main_root_activation_transaction');
            const record = parseClaim(raw);
            if (record.authorityId !== authorityId)
                invalid();
            current();
            originalBinding(record);
            const rows = all();
            let replay: Readonly<MainRootActivationClaim> | undefined;
            for (let i = 0; i < rows.length; i++) {
                const prior = decode(rows[i]!);
                if (!sameAccount(prior.principal, record.principal))
                    continue;
                if (rows[i]!.owner_key !== key(record) || rows[i]!.marker_json !== json(record))
                    throw Error('main_root_activation_conflict');
                replay = prior;
            }
            if (replay)
                return replay;
            const usage = db.prepare('SELECT COUNT(*) n,COALESCE(SUM(charged_bytes),0) bytes,COUNT(DISTINCT profile_id) profiles FROM main.migration_publication_intents').get() as {
                n: number;
                bytes: number;
                profiles: number;
            };
            const hasProfile = !!db.prepare('SELECT 1 FROM main.migration_publication_intents WHERE profile_id=? LIMIT 1').get(record.profileId), charge = 12288 + (hasProfile ? 0 : 24576), contents = json(record);
            if (usage.n >= 1024 || !hasProfile && usage.profiles >= 64 || usage.bytes + charge > VERIFICATION_BUDGET.auxiliaryBytes)
                throw Error('migration_auxiliary_capacity');
            assertVerificationDatabaseBudget(db, { additionalBytes: byteLength(contents) + 4096 });
            current();
            originalBinding(record);
            // Re-read under this same original BEGIN IMMEDIATE after the last SDK/current
            // boundary. No account-level uniqueness is inferred from request-specific PKs.
            const finalRows = all();
            for (let i = 0; i < finalRows.length; i++)
                if (sameAccount(decode(finalRows[i]!).principal, record.principal))
                    throw Error('main_root_activation_conflict');
            db.prepare('INSERT INTO main.migration_publication_intents VALUES(?,?,?,?,0,?)').run(key(record), record.profileId, contents, 'activation_claim', charge);
            current();
            const final = db.prepare('SELECT * FROM main.migration_publication_intents WHERE owner_key=?').get(key(record)) as Row | undefined;
            if (!final || final.marker_json !== contents)
                invalid();
            decode(final);
            return record;
        },
    });
}
