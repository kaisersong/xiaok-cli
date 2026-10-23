import { decodeOrdinaryProfileSourceStorage, serializeOrdinaryProfileSourceStorage } from './ordinary-profile-source-storage-codec.js';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { acquireSaveLock } from '../../ai/runtime/session-store/mutation-lock.js';
import { writeFileAtomicallySync, syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { readInstalledCurrentProfile } from './migration-markers.js';
const MAX_BYTES = 512 * 1024, U64 = (1n << 64n) - 1n, UNSUPPORTED_DIRECTORY_SYNC = new Set(['EINVAL', 'ENOTSUP', 'EISDIR']);
function fail(reason) { throw Error('profile_source_registry_' + reason); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function decimal(value) { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20 && BigInt(value) <= U64; }
function syncOrdinaryRegistryTree(path) { try {
    syncDirectoryTreeStrict(path);
}
catch (error) {
    const code = error.code;
    if (!code || !UNSUPPORTED_DIRECTORY_SYNC.has(code))
        throw error;
} }
function shape(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    fail('schema'); }
function directory(path) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
        fail('identity');
    const canonicalPath = resolve(path);
    let cursor = canonicalPath;
    for (;;) {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory())
            fail('identity');
        const parent = dirname(cursor);
        if (parent === cursor)
            break;
        cursor = parent;
    }
    if (realpathSync(canonicalPath) !== canonicalPath)
        fail('identity');
    const stat = lstatSync(canonicalPath, { bigint: true });
    return Object.freeze({ canonicalPath, device: String(stat.dev), inode: String(stat.ino) });
}
function location(create) {
    const account = userInfo();
    if (!Number.isSafeInteger(account.uid) || account.uid < 0)
        fail('account');
    const home = directory(account.homedir), base = join(home.canonicalPath, '.xiaok'), root = join(base, 'profile-sources');
    if (create) {
        for (const path of [base, root]) {
            try {
                mkdirSync(path, { mode: 0o700 });
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
            }
            directory(path);
        }
    }
    else {
        try {
            directory(root);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    const original = directory(root), assertCurrent = () => { if (JSON.stringify(directory(root)) !== JSON.stringify(original) || JSON.stringify(directory(account.homedir)) !== JSON.stringify(home))
        fail('identity'); };
    return { uid: account.uid, root, path: join(root, 'registry.json'), assertCurrent };
}
function source(input) {
    const dir = directory(input.directory);
    if (input.kind === 'session-alias-holder' && basename(dir.canonicalPath) !== '.canonical-session-aliases')
        fail('identity');
    let snapshotFormat, database;
    if (input.kind === 'sqlite-db') {
        const name = input.databaseBasename;
        if (typeof name !== 'string' || !name || basename(name) !== name || name.includes('\\') || name.includes('\0') || name === '.' || name === '..')
            fail('identity');
        const stat = lstatSync(join(dir.canonicalPath, name), { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
            fail('identity');
        if (!['session-sqlite-v1', 'loop-sqlite-v1', 'goal-sqlite-v1', 'codex-native-sqlite-v1', 'codex-routes-sqlite-v1', 'artifact-workspace-sqlite-v1', 'kswarm-state-sqlite-v1', 'multi-agent-groups-sqlite-v1'].includes(input.snapshotFormat))
            fail('schema');
        snapshotFormat = input.snapshotFormat;
        database = Object.freeze({ basename: name, device: String(stat.dev), inode: String(stat.ino) });
    }
    else {
        if (!['session-root', 'task-root', 'goal-file-root', 'session-alias-holder'].includes(input.kind))
            fail('schema');
        snapshotFormat = input.kind + '-v1';
    }
    const namespaceId = digest([dir.canonicalPath, input.kind, database?.basename ?? null]);
    const sourceId = digest([input.kind, dir.device, dir.inode, database ?? null]);
    return Object.freeze({ sourceId, namespaceId, kind: input.kind, directory: dir, snapshotFormat, ...(database ? { database } : {}) });
}
function isDeviceRenumbering(prior, observed) {
    if (prior.namespaceId !== observed.namespaceId || prior.kind !== observed.kind || prior.snapshotFormat !== observed.snapshotFormat || prior.directory.canonicalPath !== observed.directory.canonicalPath || prior.directory.inode !== observed.directory.inode || prior.directory.device === observed.directory.device)
        return false;
    if (!prior.database && !observed.database)
        return true;
    if (!prior.database || !observed.database || prior.database.basename !== observed.database.basename || prior.database.inode !== observed.database.inode || prior.database.device === observed.database.device)
        return false;
    return prior.directory.device === prior.database.device && observed.directory.device === observed.database.device;
}
function parseLayout(value) {
    shape(value, ['version', 'components', 'layoutRevision', 'layoutHash']);
    if (value.version !== 1 || !Array.isArray(value.components) || value.components.some(c => !['loop', 'completion', 'artifactScanner', 'healthScanner'].includes(c)) || new Set(value.components).size !== value.components.length || JSON.stringify([...value.components].sort()) !== JSON.stringify(value.components) || value.layoutRevision !== value.components.length || value.layoutHash !== digest({ version: 1, components: value.components, layoutRevision: value.layoutRevision }))
        fail('schema');
    Object.freeze(value.components);
    return Object.freeze(value);
}
function parseComponentHistory(value) {
    shape(value, ['historyUnknown', 'components', 'observations']);
    if (value.historyUnknown !== true || !Array.isArray(value.observations) || !value.observations.length || !Array.isArray(value.components))
        fail('schema');
    const observations = value.observations.map(parseLayout), hashes = observations.map(row => row.layoutHash);
    if (new Set(hashes).size !== hashes.length || JSON.stringify([...hashes].sort()) !== JSON.stringify(hashes) || JSON.stringify([...new Set(observations.flatMap(row => row.components))].sort()) !== JSON.stringify(value.components))
        fail('schema');
    Object.freeze(value.components);
    Object.freeze(value.observations);
    return Object.freeze(value);
}
export function parseOrdinaryProfileSources(raw, uid) {
    return parseExpandedOrdinaryProfileSources(decodeOrdinaryProfileSourceStorage(raw), uid);
}
function parseExpandedOrdinaryProfileSources(raw, uid) {
    shape(raw, ['version', 'uid', 'generation', 'legacyInventoryRequired', 'sources']);
    if (![1, 2].includes(raw.version) || raw.uid !== uid || !decimal(raw.generation) || raw.generation === '0' || raw.legacyInventoryRequired !== true || !Array.isArray(raw.sources) || !raw.sources.length)
        fail('schema');
    const seen = new Set(), names = new Set();
    for (const row of raw.sources) {
        shape(row, ['sourceId', 'namespaceId', 'kind', 'directory', 'snapshotFormat', ...(row?.kind === 'sqlite-db' ? ['database'] : []), ...(row?.componentHistory !== undefined ? ['componentHistory'] : [])]);
        shape(row.directory, ['canonicalPath', 'device', 'inode']);
        const dir = row.directory;
        if (typeof dir.canonicalPath !== 'string' || !isAbsolute(dir.canonicalPath) || resolve(dir.canonicalPath) !== dir.canonicalPath || dir.canonicalPath.includes('\0') || !decimal(dir.device) || !decimal(dir.inode))
            fail('schema');
        let db;
        if (row.kind === 'sqlite-db') {
            shape(row.database, ['basename', 'device', 'inode']);
            db = row.database;
            if (typeof db.basename !== 'string' || !db.basename || basename(db.basename) !== db.basename || db.basename.includes('\\') || db.basename.includes('\0') || ['.', '..'].includes(db.basename) || !decimal(db.device) || !decimal(db.inode) || !['session-sqlite-v1', 'loop-sqlite-v1', 'goal-sqlite-v1', 'codex-native-sqlite-v1', 'codex-routes-sqlite-v1', 'artifact-workspace-sqlite-v1', 'kswarm-state-sqlite-v1', 'multi-agent-groups-sqlite-v1'].includes(row.snapshotFormat))
                fail('schema');
        }
        else if (!['session-root', 'task-root', 'goal-file-root', 'session-alias-holder'].includes(row.kind) || row.snapshotFormat !== row.kind + '-v1')
            fail('schema');
        if (row.kind === 'session-alias-holder' && basename(dir.canonicalPath) !== '.canonical-session-aliases')
            fail('identity');
        if (row.sourceId !== digest([row.kind, dir.device, dir.inode, db ?? null]) || row.namespaceId !== digest([dir.canonicalPath, row.kind, db?.basename ?? null]) || seen.has(row.sourceId) || names.has(row.namespaceId))
            fail('schema');
        if (row.componentHistory !== undefined) {
            if (raw.version !== 2 || row.kind !== 'sqlite-db' || row.snapshotFormat !== 'loop-sqlite-v1')
                fail('schema');
            parseComponentHistory(row.componentHistory);
        }
        seen.add(row.sourceId);
        names.add(row.namespaceId);
        Object.freeze(dir);
        if (db)
            Object.freeze(db);
        Object.freeze(row);
    }
    Object.freeze(raw.sources);
    return Object.freeze(raw);
}
function read(path, uid) {
    let fd;
    try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    try {
        const before = fstatSync(fd, { bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(uid) || before.size > BigInt(MAX_BYTES))
            fail('identity');
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        for (;;) {
            const n = readSync(fd, bytes, length, bytes.length - length, null);
            if (!n)
                break;
            length += n;
            if (length === bytes.length)
                break;
        }
        const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
        if (length !== Number(before.size) || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.size !== before.size || current.dev !== before.dev || current.ino !== before.ino || current.isSymbolicLink())
            fail('identity');
        let raw;
        try {
            raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
        }
        catch {
            fail('schema');
        }
        return parseOrdinaryProfileSources(raw, uid);
    }
    finally {
        closeSync(fd);
    }
}
export function readOrdinaryProfileSources() {
    const loc = location(false);
    if (!loc)
        return undefined;
    const facts = read(loc.path, loc.uid);
    loc.assertCurrent();
    return facts;
}
export function registerOrdinaryProfileSource(input) { registerSource(input); }
/** Discovery observations only: these never clear legacy/unknown history or grant custody. */
export function registerOrdinarySQLiteLayout(input, layout, expectedPhysicalIdentity) {
    if (input.kind !== 'sqlite-db' || input.snapshotFormat !== 'loop-sqlite-v1')
        fail('schema');
    registerSource(input, parseLayout(structuredClone(layout)), expectedPhysicalIdentity);
}
function registerSource(input, layout, expectedPhysicalIdentity) {
    if (readInstalledCurrentProfile().kind !== 'ordinary')
        fail('route');
    const observed = source(input);
    if (expectedPhysicalIdentity !== undefined && (!observed.database || `${observed.database.device}:${observed.database.inode}` !== expectedPhysicalIdentity))
        fail('identity');
    const loc = location(true);
    const release = acquireSaveLock(join(loc.root, '.profile-source-registry.lock'));
    try {
        loc.assertCurrent();
        if (readInstalledCurrentProfile().kind !== 'ordinary')
            fail('route');
        const original = read(loc.path, loc.uid), priorByNamespace = original?.sources.find(row => row.namespaceId === observed.namespaceId), priorBySource = original?.sources.find(row => row.sourceId === observed.sourceId);
        if (priorByNamespace && priorBySource && priorByNamespace !== priorBySource)
            fail('identity');
        const prior = priorByNamespace ?? priorBySource;
        let rebound = false;
        if (prior) {
            const { componentHistory: _, ...identity } = prior;
            if (JSON.stringify(identity) !== JSON.stringify(observed)) {
                if (prior !== priorByNamespace || !isDeviceRenumbering(prior, observed))
                    fail('identity');
                rebound = true;
            }
        }
        let merged = prior ? (rebound ? (prior.componentHistory ? { ...observed, componentHistory: prior.componentHistory } : observed) : prior) : observed;
        if (layout) {
            const observations = [...(prior?.componentHistory?.observations ?? [])];
            if (!observations.some(row => row.layoutHash === layout.layoutHash))
                observations.push(layout);
            observations.sort((a, b) => a.layoutHash.localeCompare(b.layoutHash));
            merged = { ...observed, componentHistory: { historyUnknown: true, components: [...new Set(observations.flatMap(row => row.components))].sort(), observations } };
        }
        if (prior && JSON.stringify(prior) === JSON.stringify(merged)) {
            syncOrdinaryRegistryTree(loc.root);
            loc.assertCurrent();
            return;
        }
        const generation = BigInt(original?.generation ?? '0') + 1n;
        if (generation > U64)
            fail('capacity');
        const next = { version: layout ? 2 : (original?.version ?? 1), uid: loc.uid, generation: String(generation), legacyInventoryRequired: true, sources: prior ? original.sources.map(row => row === prior ? merged : row) : [...(original?.sources ?? []), merged] };
        const validated = parseOrdinaryProfileSources(next, loc.uid);
        const bytes = serializeOrdinaryProfileSourceStorage(validated);
        if (Buffer.byteLength(bytes) > MAX_BYTES)
            fail('capacity');
        loc.assertCurrent();
        if (JSON.stringify(source(input)) !== JSON.stringify(observed))
            fail('identity');
        if (readInstalledCurrentProfile().kind !== 'ordinary')
            fail('route');
        writeFileAtomicallySync(loc.path, bytes);
        syncOrdinaryRegistryTree(loc.root);
        loc.assertCurrent();
    }
    finally {
        loc.assertCurrent();
        release();
    }
}
