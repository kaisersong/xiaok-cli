import { readContinuityProfile } from './profile-identity.js';
export { readContinuityProfile } from './profile-identity.js';
import { closeSync, constants, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
/** Read all authority stores before issuing an identity; a missing continuity DB proves nothing. */
export function resolveDesktopProfile(dataRoot) {
    const legacy = createHash('sha256').update(resolve(dataRoot)).digest('hex');
    const domains = new Set();
    let migrated = false;
    const aliasFile = join(dataRoot, 'continuity-profile-migration.json');
    const secure = (file) => {
        const s = lstatSync(file);
        if (!s.isFile() || s.isSymbolicLink() || typeof process.getuid === 'function' && s.uid !== process.getuid())
            throw new Error();
    };
    const probes = [
        ['multi-agent/groups.sqlite', [1, 2, 3, 4], [['thread_bindings', 'profile_id'], ['workspace_execution_authorizations', 'profile_id']]],
        ['codex-native.sqlite', [0], [['codex_native_sessions', 'owner']]],
        ['conversation-activity.sqlite', [4], [['work_watches', 'profile_id'], ['association_operations', "json_extract(data_json,'$.origin.profileId')"], ['conversation_activities', 'profile_id'], ['conversation_reads', 'profile_id'], ['activity_presentations', 'profile_id'], ['thread_tombstones', 'profile_id']]],
    ];
    try {
        if (existsSync(dataRoot)) {
            const s = lstatSync(dataRoot);
            if (!s.isDirectory() || s.isSymbolicLink() || typeof process.getuid === 'function' && s.uid !== process.getuid())
                throw new Error();
        }
        let alias;
        if (existsSync(aliasFile)) {
            secure(aliasFile);
            const before = lstatSync(aliasFile);
            if (before.size > 4096)
                throw new Error();
            const fd = openSync(aliasFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
                const opened = fstatSync(fd);
                if (opened.dev !== before.dev || opened.ino !== before.ino)
                    throw new Error();
                alias = JSON.parse(readFileSync(fd, 'utf8'));
                if (alias?.version !== 1 || !/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/.test(alias.profileId) || !/^[a-f0-9]{64}$/.test(alias.legacyProfileId) || alias.osOwner !== String(userInfo().uid))
                    throw new Error();
            }
            finally {
                closeSync(fd);
            }
        }
        for (const [relative, versions, tables] of probes) {
            const file = join(dataRoot, relative);
            if (!existsSync(file))
                continue;
            if (dirname(file) !== dataRoot) {
                const s = lstatSync(dirname(file));
                if (!s.isDirectory() || s.isSymbolicLink() || typeof process.getuid === 'function' && s.uid !== process.getuid())
                    throw new Error();
            }
            secure(file);
            for (const suffix of ['-wal', '-shm', '-journal'])
                if (existsSync(file + suffix))
                    secure(file + suffix);
            const wal = existsSync(file + '-wal');
            if (wal && !existsSync(file + '-shm'))
                throw new Error();
            // Immutable is safe only when no committed WAL exists. A live reader needs existing sidecars.
            const db = new DatabaseSync(wal ? file : `${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
            try {
                db.exec('BEGIN');
                if (!versions.includes(Number(db.prepare('PRAGMA user_version').get().user_version)))
                    throw new Error();
                const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)));
                if (names.has('profile_identity_migrations'))
                    migrated = true;
                for (const [table, column] of tables)
                    if (names.has(table))
                        for (const row of db.prepare(`SELECT DISTINCT ${column} AS profile FROM ${table}`).all()) {
                            if (typeof row.profile !== 'string')
                                throw new Error();
                            domains.add(row.profile.replace(/^desktop-user:/, ''));
                        }
                if (!tables.some(([table]) => names.has(table)) && !migrated)
                    throw new Error();
            }
            finally {
                db.close();
            }
        }
        const legacyProfileId = alias?.legacyProfileId ?? legacy;
        const requireExisting = !!alias || migrated || existsSync(join(dataRoot, 'continuity.sqlite')) || [...domains].some(id => id !== legacyProfileId);
        if (process.platform === 'win32' && domains.has(legacyProfileId))
            throw new Error(); // Legacy adoption needs SID/ACL proof, not username equality.
        const profileId = loadContinuityProfile(dataRoot, { requireExisting });
        if (alias && alias.profileId !== profileId || [...domains].some(id => id !== legacyProfileId && id !== profileId))
            throw new Error();
        if (!alias && domains.has(legacy)) {
            const fd = openSync(aliasFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
            try {
                writeFileSync(fd, JSON.stringify({ version: 1, profileId, legacyProfileId: legacy, osOwner: String(userInfo().uid) }));
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
        }
        return { profileId, ...(domains.has(legacyProfileId) ? { legacyProfileId } : {}) };
    }
    catch {
        throw new Error('profile_identity_unavailable');
    }
}
/** A moved data root retains identity. Corruption/symlinks never cause silent adoption. */
export function loadContinuityProfile(dataRoot, options) {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    const path = join(dataRoot, 'continuity-profile.json');
    const info = userInfo(), osOwner = process.platform === 'win32' ? info.username : String(info.uid);
    if (!options?.requireExisting)
        try {
            const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
            try {
                writeFileSync(fd, JSON.stringify({ version: 1, profileId: randomUUID(), osOwner }));
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw new Error('profile_identity_unavailable');
        }
    return readContinuityProfile(dataRoot);
}
