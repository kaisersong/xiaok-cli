import { isKSwarmOwnerIdentity } from './kswarm-host-subject.js';
import { readWindowsInstallationAbsence } from './windows-installation-absence.js';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalVerificationJson } from './protocol.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { parsePublicProfileIndex } from './profile-index-publication.js';
import { parseDeploymentPackageInventory } from './deployment-package.js';
import { assertRootProtectedExecutable, assertRootProtectedFile } from './installed-identity.js';
const id = (x) => typeof x === 'string' && x.length > 0 && Buffer.byteLength(x) <= 160 && !/[\x00-\x1f\x7f]/.test(x);
const hash = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw Error('migration_marker_schema'); }
function copy(raw) { const text = canonicalVerificationJson(raw); if (Buffer.byteLength(text) > 4096)
    throw Error('migration_marker_size'); return JSON.parse(text); }
function owner(raw) { const o = copy(raw); exact(o, ['profileId', 'ownerKind', 'ownerId']); if (!id(o.profileId) || !id(o.ownerId) || !(['task', 'intent', 'goal', 'loop', 'project'].includes(o.ownerKind) || isKSwarmOwnerIdentity(o)))
    throw Error('migration_marker_owner'); return Object.freeze(o); }
export function parseMigrationMarker(raw) {
    const m = copy(raw);
    exact(m, ['version', 'state', 'authorityId', 'profileId', 'ownerKind', 'ownerId', 'migrationId', 'sourceSessionId', 'sourceStoreRevision', 'sourceSnapshotHash', 'migrationEpoch', ...(m?.state === 'migrated' ? ['importReceiptHash'] : [])]);
    owner({ profileId: m.profileId, ownerKind: m.ownerKind, ownerId: m.ownerId });
    if (m.version !== 1 || !['pending', 'migrated'].includes(m.state) || ![m.authorityId, m.migrationId, m.sourceSessionId].every(id) || !hash(m.sourceSnapshotHash) || !Number.isSafeInteger(m.sourceStoreRevision) || m.sourceStoreRevision < 0 || !Number.isSafeInteger(m.migrationEpoch) || m.migrationEpoch < 1 || (m.state === 'migrated' && !hash(m.importReceiptHash)))
        throw Error('migration_marker_schema');
    return Object.freeze(m);
}
function acl(...paths) {
    if (process.platform !== 'darwin')
        return;
    const result = spawnSync('/bin/ls', ['-lde', ...paths], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, shell: false, timeout: 5000, maxBuffer: 65536 });
    if (result.error || result.status !== 0 || result.signal || /^\s*\d+:/m.test(result.stdout))
        throw Error('migration_marker_acl');
}
function rootAncestors(input) {
    const snapshots = [];
    let path = resolve(input);
    for (;;) {
        snapshots.push({ path, stat: rootAncestorStat(path) });
        const parent = dirname(path);
        if (parent === path)
            break;
        path = parent;
    }
    acl(...snapshots.map(row => row.path));
    for (const original of snapshots) {
        const current = rootAncestorStat(original.path);
        if (current.dev !== original.stat.dev || current.ino !== original.stat.ino || current.uid !== original.stat.uid
            || current.mode !== original.stat.mode || current.ctimeNs !== original.stat.ctimeNs)
            throw Error('migration_marker_ancestor_changed');
    }
}
function rootAncestorStat(path) {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || (stat.mode & 18n) !== 0n)
        throw Error('migration_marker_ancestor');
    return stat;
}
/** Actual POSIX ownership/ACL check; a parsed record or caller-supplied uid is not
 * an installed authority. The fixed reader obtains uid from the root-owned manifest.
 */
export function assertServiceProtectedMarkerPath(input, options) {
    if (!['darwin', 'linux'].includes(process.platform) || !Number.isSafeInteger(options.serviceUid) || options.serviceUid < 1)
        throw Error('migration_marker_platform');
    const root = resolve(options.root), target = resolve(input), part = relative(root, target);
    if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep))
        throw Error('migration_marker_path');
    rootAncestors(dirname(root));
    let path = target;
    for (;;) {
        const s = lstatSync(path), file = path === target && options.kind === 'file';
        if (s.isSymbolicLink() || s.uid !== options.serviceUid || (file ? (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o644) : (!s.isDirectory() || (s.mode & 0o777) !== 0o755)))
            throw Error('migration_marker_identity');
        acl(path);
        if (path === root)
            break;
        path = dirname(path);
    }
}
function probe(path) { try {
    return lstatSync(path);
}
catch (error) {
    if (error.code === 'ENOENT')
        return undefined;
    throw error;
} }
function readSmall(path, uid, maximum = 4096) {
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.uid !== uid || before.size > maximum)
        throw Error('migration_marker_identity');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const actual = fstatSync(fd);
        if (actual.dev !== before.dev || actual.ino !== before.ino || actual.nlink !== 1 || actual.uid !== uid || actual.size > maximum)
            throw Error('migration_marker_changed');
        const bytes = readFileSync(fd);
        const after = fstatSync(fd);
        if (bytes.length !== actual.size || after.mtimeMs !== actual.mtimeMs || after.ctimeMs !== actual.ctimeMs || after.size !== actual.size)
            throw Error('migration_marker_changed');
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    finally {
        closeSync(fd);
    }
}
export function migrationOwnerFileName(raw) { return createHash('sha256').update(canonicalVerificationJson(owner(raw))).digest('hex') + '.json'; }
export function migrationProfileDirectoryName(profileId) { if (!id(profileId))
    throw Error('migration_marker_profile'); return createHash('sha256').update(canonicalVerificationJson(profileId)).digest('hex'); }
/** Fresh fixed installation lookup. Pending/incomplete/malformed installs never
 * become ordinary; no endpoint/root/environment override is accepted.
 */
export function readInstalledMigrationOwner(raw) {
    try {
        const o = owner(raw);
        if (!['darwin', 'linux'].includes(process.platform))
            throw Error('migration_marker_platform');
        const base = process.platform === 'darwin' ? '/Library/Application Support/xiaok-verification' : '/var/lib/xiaok-verification';
        if (!probe(base)) {
            rootAncestors(dirname(base));
            return Object.freeze({ kind: 'ordinary' });
        }
        const manifestPath = join(base, 'deployment.json');
        assertRootProtectedFile(manifestPath);
        const manifest = parseInstalledDeploymentManifest(readSmall(manifestPath, 0, 65536));
        const root = join(base, 'migrations');
        assertServiceProtectedMarkerPath(root, { root, serviceUid: manifest.serviceUid, kind: 'directory' });
        const profile = join(root, migrationProfileDirectoryName(o.profileId));
        if (!probe(profile))
            return Object.freeze({ kind: 'ordinary' });
        assertServiceProtectedMarkerPath(profile, { root, serviceUid: manifest.serviceUid, kind: 'directory' });
        const headerPath = join(profile, 'profile.json');
        assertServiceProtectedMarkerPath(headerPath, { root, serviceUid: manifest.serviceUid, kind: 'file' });
        const header = readSmall(headerPath, manifest.serviceUid);
        exact(header, ['version', 'profileId', 'authorityId']);
        if (header.version !== 1 || header.profileId !== o.profileId || header.authorityId !== manifest.authorityId)
            throw Error('migration_marker_profile');
        const owners = join(profile, 'owners');
        assertServiceProtectedMarkerPath(owners, { root, serviceUid: manifest.serviceUid, kind: 'directory' });
        const path = join(owners, migrationOwnerFileName(o));
        if (!probe(path))
            return Object.freeze({ kind: 'protected-unregistered', authorityId: manifest.authorityId });
        assertServiceProtectedMarkerPath(path, { root, serviceUid: manifest.serviceUid, kind: 'file' });
        const marker = parseMigrationMarker(readSmall(path, manifest.serviceUid));
        if (marker.authorityId !== manifest.authorityId || canonicalVerificationJson({ profileId: marker.profileId, ownerKind: marker.ownerKind, ownerId: marker.ownerId }) !== canonicalVerificationJson(o))
            throw Error('migration_marker_binding');
        return Object.freeze({ kind: marker.state, marker });
    }
    catch {
        return Object.freeze({ kind: 'unavailable', reason: 'migration_authority_unavailable' });
    }
}
/** Current OS account only; no model-selected profile, UID, root or helper override. */
export function readInstalledCurrentProfile() {
    try {
        if (process.platform === 'win32') {
            if (readWindowsInstallationAbsence() === 'ordinary')
                return Object.freeze({ kind: 'ordinary' });
            throw Error('profile_installed_windows_unavailable');
        }
        if (!['darwin', 'linux'].includes(process.platform))
            throw Error('profile_installed_platform');
        const base = process.platform === 'darwin' ? '/Library/Application Support/xiaok-verification' : '/var/lib/xiaok-verification';
        if (!probe(base)) {
            rootAncestors(dirname(base));
            return Object.freeze({ kind: 'ordinary' });
        }
        if (process.platform !== 'darwin')
            throw Error('profile_installed_account_adapter_unavailable');
        const uid = process.getuid?.();
        if (!uid || process.geteuid?.() !== uid)
            throw Error('profile_installed_user');
        const manifestPath = join(base, 'deployment.json');
        assertRootProtectedFile(manifestPath);
        const manifest = parseInstalledDeploymentManifest(readSmall(manifestPath, 0, 65536));
        if (!manifest.allowedUserIds.includes(uid))
            throw Error('profile_installed_user');
        const inventoryPath = join(base, 'releases', manifest.packageHash + '.json');
        assertRootProtectedFile(inventoryPath);
        const inventory = parseDeploymentPackageInventory(readSmall(inventoryPath, 0, 8 * 1024 ** 2));
        if (inventory.packageHash !== manifest.packageHash)
            throw Error('profile_installed_package');
        const helper = join(base, 'releases', manifest.packageHash, 'bin', 'account-generation'), entry = inventory.files.find(f => f.path === 'bin/account-generation');
        assertRootProtectedExecutable(helper);
        if (!entry || !entry.executable || lstatSync(helper).size !== entry.size || entry.size > 1024 ** 2 || createHash('sha256').update(readFileSync(helper)).digest('hex') !== entry.sha256)
            throw Error('profile_installed_helper');
        const result = spawnSync(helper, [String(uid)], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 7500, maxBuffer: 4096 });
        if (result.error || result.status !== 0 || result.signal)
            throw Error('profile_installed_identity');
        const identity = JSON.parse(result.stdout.toString('utf8'));
        exact(identity, ['uid', 'accountGeneration', 'source']);
        if (identity.uid !== uid || identity.source !== 'macos-local-generateduid' || typeof identity.accountGeneration !== 'string' || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(identity.accountGeneration))
            throw Error('profile_installed_identity');
        const root = join(base, 'migrations'), target = join(root, 'principals', String(uid) + '.json');
        assertServiceProtectedMarkerPath(target, { root, serviceUid: manifest.serviceUid, kind: 'file' });
        const index = parsePublicProfileIndex(readSmall(target, manifest.serviceUid));
        if (index.uid !== uid || index.accountId !== identity.accountGeneration.toLowerCase() || index.authorityId !== manifest.authorityId)
            throw Error('profile_installed_binding');
        assertRootProtectedFile(manifestPath);
        if (canonicalVerificationJson(parseInstalledDeploymentManifest(readSmall(manifestPath, 0, 65536))) !== canonicalVerificationJson(manifest))
            throw Error('profile_installed_changed');
        return Object.freeze({ kind: 'protected', index });
    }
    catch {
        return Object.freeze({ kind: 'unavailable', reason: 'migration_authority_unavailable' });
    }
}
