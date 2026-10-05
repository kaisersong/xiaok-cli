import { assertProfileSourceNamespace } from './profile-source-namespace.js';
import { isWriterLockSourceName } from './writer-lock-source-name.js';
import { types } from 'node:util';
import { posix, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
import { PROFILE_DIRECTORY_SOURCE_FORMATS } from './profile-source-descriptor.js';
const LIMIT = 512 * 1024, UINT64 = 18446744073709551615n;
function fields(raw, keys) {
    if (types.isProxy(raw) || !raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).length !== keys.length)
        throw Error('profile_source_review_shape');
    const value = {};
    for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(raw, key);
        if (!d || !('value' in d))
            throw Error('profile_source_review_shape');
        value[key] = d.value;
    }
    return value;
}
function text(raw, limit = 160) { if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > limit || /[\x00-\x1f\x7f]/.test(raw) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(raw))
    throw Error('profile_source_review_string'); }
function integer(raw, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(raw) || raw < min || raw > max)
    throw Error('profile_source_review_number'); }
function decimal(raw, positive = false) { if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(raw) || BigInt(raw) > UINT64 || positive && raw === '0')
    throw Error('profile_source_review_uint64'); }
function digest(raw) { if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
    throw Error('profile_source_review_hash'); }
function path(raw) { text(raw, 4096); const windows = /^[A-Za-z]:/.test(raw) || raw.startsWith('\\\\'); if (windows) {
    if (raw.startsWith('\\\\?\\') || raw.startsWith('\\\\.\\') || raw.includes('/') || !win32.isAbsolute(raw) || win32.normalize(raw) !== raw || raw.split('\\').some(p => p === '.' || p === '..') || raw.slice(/^[A-Za-z]:/.test(raw) ? 2 : 0).includes(':') || raw.length > win32.parse(raw).root.length && raw.endsWith('\\'))
        throw Error('profile_source_review_path');
}
else if (!posix.isAbsolute(raw) || posix.normalize(raw) !== raw || raw.split('/').some(p => p === '.' || p === '..') || raw.length > 1 && raw.endsWith('/'))
    throw Error('profile_source_review_path'); return windows; }
function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} return value; }
/** Pure full-review parser. Neither its output nor any caller-provided hash is
 * a complete source census, native approval, holder or metadata capacity owner. */
export function parseProfileSourceReview(raw) {
    const review = fields(raw, ['version', 'purpose', 'authorityId', 'challengeId', 'principal', 'requestSource', 'sourceSet', 'inventoryHash', 'deadline']);
    if (review.version !== 1 || review.purpose !== 'profile-source-custody' || review.requestSource !== 'user')
        throw Error('profile_source_review_purpose');
    text(review.authorityId);
    text(review.challengeId);
    const principal = fields(review.principal, ['uid', 'accountGeneration', 'auditSessionId']);
    integer(principal.uid, 1, 0xfffffffe);
    integer(principal.auditSessionId, 1, 0xfffffffe);
    if (typeof principal.accountGeneration !== 'string' || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(principal.accountGeneration))
        throw Error('profile_source_review_principal');
    const set = fields(review.sourceSet, ['schemaVersion', 'authorityId', 'profileId', 'uid', 'accountId', 'inventoryGeneration', 'sources']);
    text(set.profileId);
    decimal(set.inventoryGeneration, true);
    if (set.schemaVersion !== 1 || set.authorityId !== review.authorityId || set.uid !== principal.uid || set.accountId !== principal.accountGeneration.toLowerCase())
        throw Error('profile_source_review_principal');
    const sources = set.sources;
    if (types.isProxy(sources) || !Array.isArray(sources) || Object.getPrototypeOf(sources) !== Array.prototype || sources.length === 0 || sources.length > LIMIT || Reflect.ownKeys(sources).length !== sources.length + 1)
        throw Error('profile_source_review_limit');
    const physical = new Set(), namespaces = new Set();
    let last = '', bytes = 0;
    const captured = [];
    for (let index = 0; index < sources.length; index++) {
        const d = Object.getOwnPropertyDescriptor(sources, String(index));
        if (!d || !('value' in d))
            throw Error('profile_source_review_shape');
        const rawSource = d.value;
        const kind = rawSource && !types.isProxy(rawSource) && typeof rawSource === 'object' ? Object.getOwnPropertyDescriptor(rawSource, 'kind') : undefined;
        if (!kind || !('value' in kind))
            throw Error('profile_source_review_shape');
        const source = fields(rawSource, kind.value === 'sqlite-db' ? ['sourceId', 'namespaceId', 'kind', 'snapshotFormat', 'directory', 'reviewedSnapshotSha256', 'database'] : ['sourceId', 'namespaceId', 'kind', 'snapshotFormat', 'directory', 'reviewedSnapshotSha256']);
        text(source.kind);
        text(source.snapshotFormat);
        text(source.sourceId);
        text(source.namespaceId);
        if (source.sourceId <= last)
            throw Error('profile_source_review_order');
        last = source.sourceId;
        digest(source.reviewedSnapshotSha256);
        const dir = fields(source.directory, ['canonicalPath', 'device', 'inode']);
        const windows = path(dir.canonicalPath);
        decimal(dir.device);
        decimal(dir.inode, true);
        source.directory = dir;
        if (source.kind === 'session-alias-holder' && (windows ? win32 : posix).basename(dir.canonicalPath) !== '.canonical-session-aliases')
            throw Error('profile_source_review_path');
        let physicalKey, namespaceKey;
        if (source.kind === 'sqlite-db') {
            if (!['session-sqlite-v1', 'loop-sqlite-v1', 'goal-sqlite-v1', 'writer-lock-sqlite-v1', 'codex-native-sqlite-v1', 'codex-routes-sqlite-v1', 'artifact-workspace-sqlite-v1', 'kswarm-state-sqlite-v1', 'multi-agent-groups-sqlite-v1'].includes(source.snapshotFormat))
                throw Error('profile_source_review_format');
            const database = fields(source.database, ['basename', 'device', 'inode']);
            text(database.basename, 255);
            if ((windows ? /[\\/:]/ : /\//).test(database.basename) || database.basename === '.' || database.basename === '..')
                throw Error('profile_source_review_path');
            if (source.snapshotFormat === 'writer-lock-sqlite-v1' && !isWriterLockSourceName(dir.canonicalPath, database.basename))
                throw Error('profile_source_review_lock_namespace');
            decimal(database.device);
            decimal(database.inode, true);
            source.database = database;
            physicalKey = json(['sqlite-db', database.device, database.inode]);
            namespaceKey = json([source.namespaceId, 'sqlite-db', database.basename]);
        }
        else {
            const formats = PROFILE_DIRECTORY_SOURCE_FORMATS;
            if (!Object.hasOwn(formats, source.kind) || source.snapshotFormat !== formats[source.kind])
                throw Error('profile_source_review_format');
            physicalKey = json(['directory', dir.device, dir.inode]);
            namespaceKey = json([source.namespaceId, source.kind]);
        }
        assertProfileSourceNamespace(source);
        if (physical.has(physicalKey) || namespaces.has(namespaceKey))
            throw Error('profile_source_review_alias');
        physical.add(physicalKey);
        namespaces.add(namespaceKey);
        bytes += Buffer.byteLength(json(source));
        if (bytes > LIMIT)
            throw Error('profile_source_review_limit');
        captured.push(source);
    }
    set.sources = captured;
    review.principal = principal;
    review.sourceSet = set;
    digest(review.inventoryHash);
    if (createHash('sha256').update(json(set)).digest('hex') !== review.inventoryHash)
        throw Error('profile_source_review_hash');
    const deadline = fields(review.deadline, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']);
    text(deadline.domainId);
    integer(deadline.qualificationEpoch);
    integer(deadline.notBefore);
    integer(deadline.validUntil);
    if (deadline.validUntil <= deadline.notBefore || deadline.validUntil - deadline.notBefore > 300000)
        throw Error('profile_source_review_deadline');
    review.deadline = deadline;
    if (Buffer.byteLength(json(review)) > LIMIT)
        throw Error('profile_source_review_limit');
    return freeze(review);
}
/** Native stdin only: canonical UTF-8 review is <=512KiB over the unchanged
 * 1MiB broker RPC; escaped ASCII is <=3MiB and fits the existing 7MiB panel. */
export function profileSourceReviewBytes(raw) { return Buffer.from(json(parseProfileSourceReview(raw)).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))); }
