import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { canonicalVerificationJson as json } from './protocol.js';
import { readOrdinaryProfileSources } from './ordinary-profile-source-registry.js';
const MAX_BYTES = 512 * 1024;
// Actual unknown closes retain their descriptors and original identity. This is
// ordinary cooperative bookkeeping, never native closed/writer authority.
const unknownOwners = new Set();
function fail(reason) { throw Error('known_writer_fence_' + reason); }
function missing(error) { return error?.code === 'ENOENT'; }
function identity(stat) { return json({ device: String(stat.dev), inode: String(stat.ino), uid: String(stat.uid), directory: stat.isDirectory() }); }
function supported() { if (!['darwin', 'linux'].includes(process.platform))
    fail('platform'); }
function directory(path, uid, mode) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== resolve(path))
        fail('directory');
    if (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o022) !== 0))
        fail('directory');
    if (mode !== undefined && (stat.mode & 0o777) !== mode)
        fail('directory');
    return stat;
}
function chain(path) { for (let current = path;; current = dirname(current)) {
    directory(current);
    if (dirname(current) === current)
        break;
} }
function canonical(path) {
    const absolute = resolve(path);
    try {
        return realpathSync(absolute);
    }
    catch (error) {
        if (!missing(error))
            throw error;
        const parent = dirname(absolute);
        if (parent === absolute)
            throw error;
        return join(canonical(parent), basename(absolute));
    }
}
/** No directory or registry creation on the ordinary admission read path. */
function location() {
    const account = userInfo(), uid = process.getuid?.();
    if (!uid || uid !== process.geteuid?.() || account.uid !== uid)
        fail('user');
    const home = resolve(account.homedir);
    chain(home);
    const original = directory(home, uid), paths = [join(home, '.xiaok'), join(home, '.xiaok', 'profile-sources'), join(home, '.xiaok', 'profile-sources', 'writer-fences')];
    const observed = [];
    let absent = false;
    for (let i = 0; i < paths.length; i++) {
        try {
            const stat = directory(paths[i], uid, i === 2 ? 0o700 : undefined);
            observed.push({ path: paths[i], identity: identity(stat), mode: stat.mode });
        }
        catch (error) {
            if (!missing(error))
                throw error;
            absent = true;
            break;
        }
    }
    function current() { if (identity(directory(home, uid)) !== identity(original))
        fail('directory_changed'); for (const item of observed) {
        const stat = directory(item.path, uid, item.path === paths[2] ? 0o700 : undefined);
        if (identity(stat) !== item.identity || stat.mode !== item.mode)
            fail('directory_changed');
    } }
    current();
    return { uid, home, root: paths[2], parent: paths[1], absent, current };
}
/** Fixed ordinary namespace denial only. It issues no custody, completeness,
 * ownership, capacity, all-writer drain or post-seal capability. */
export function createKnownDirectoryWriterFence(rootDir, kind) {
    const originalRoot = resolve(rootDir), held = new Set();
    let owner;
    function closeActual(item) { const stat = fstatSync(item.fd); if (identity(stat) !== item.identity || stat.isDirectory() !== item.directory)
        fail('close_identity'); closeSync(item.fd); held.delete(item); }
    function use(path, flags, work, mode) {
        const fd = openSync(path, flags, mode), item = { fd, identity: identity(fstatSync(fd)), directory: fstatSync(fd).isDirectory() };
        held.add(item);
        let result, error, failed = false;
        try {
            result = work(fd);
        }
        catch (value) {
            error = value;
            failed = true;
        }
        try {
            closeActual(item);
        }
        catch (cleanup) {
            unknownOwners.add(owner);
            if (failed)
                throw new AggregateError([error, cleanup], 'known_writer_fence_close_unknown', { cause: error });
            throw cleanup;
        }
        if (failed)
            throw error;
        return result;
    }
    function key(path, uid) { return createHash('sha256').update(json([uid, path])).digest('hex'); }
    function bytes(path, uid) {
        return use(path, constants.O_RDONLY | constants.O_NOFOLLOW, fd => {
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > MAX_BYTES)
                fail('record');
            const data = Buffer.alloc(stat.size + 1);
            let offset = 0;
            for (;;) {
                const n = readSync(fd, data, offset, data.length - offset, offset);
                if (!n)
                    break;
                offset += n;
                if (offset === data.length)
                    break;
            }
            const after = fstatSync(fd), current = lstatSync(path);
            if (offset !== stat.size || identity(after) !== identity(stat) || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || current.isSymbolicLink() || identity(current) !== identity(stat))
                fail('record_changed');
            return data.subarray(0, offset);
        });
    }
    function scope(loc) {
        const path = canonical(originalRoot), stat = directory(path, loc.uid), registry = readOrdinaryProfileSources();
        if (!registry || registry.uid !== loc.uid)
            fail('unregistered');
        const matches = registry.sources.filter(source => source.directory.canonicalPath === path);
        if (!matches.some(source => source.kind === kind) || matches.some(source => source.directory.device !== String(stat.dev) || source.directory.inode !== String(stat.ino)))
            fail('source_changed');
        const record = { version: 1, state: 'known-writer-fenced', uid: loc.uid, directory: { canonicalPath: path, device: String(stat.dev), inode: String(stat.ino) }, sourceIds: matches.map(source => source.sourceId).sort() };
        const encoded = Buffer.from(json(record));
        if (encoded.length > MAX_BYTES)
            fail('capacity');
        return { path, encoded, name: key(path, loc.uid) };
    }
    owner = Object.freeze({
        assertOpen() {
            if (process.platform === 'win32')
                return;
            supported();
            const loc = location();
            if (loc.absent)
                return;
            const name = key(canonical(originalRoot), loc.uid), target = join(loc.root, name + '.json');
            try {
                lstatSync(target);
                fail('fenced');
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
            // A partially written or unknown publication is still a durable denial.
            if (readdirSync(loc.root).some(nameOnDisk => nameOnDisk.startsWith('.' + name + '.') && nameOnDisk.endsWith('.tmp')))
                fail('pending');
            loc.current();
        },
        persist() {
            supported();
            for (const item of held)
                closeActual(item);
            unknownOwners.delete(owner);
            let loc = location();
            const before = scope(loc);
            if (loc.absent) {
                directory(loc.parent, loc.uid);
                try {
                    mkdirSync(loc.root, { mode: 0o700 });
                }
                catch (error) {
                    if (error.code !== 'EEXIST')
                        throw error;
                }
                loc = location();
            }
            const target = join(loc.root, before.name + '.json');
            function check() { loc.current(); if (!scope(loc).encoded.equals(before.encoded))
                fail('source_changed'); }
            function syncParent() { use(loc.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW, fd => { check(); fsyncSync(fd); check(); }); }
            try {
                const old = bytes(target, loc.uid);
                if (!old.equals(before.encoded))
                    fail('record_conflict');
                syncParent();
                check();
                return;
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
            const temporary = join(loc.root, '.' + before.name + '.' + randomUUID() + '.tmp');
            check();
            let temporaryIdentity;
            use(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, fd => {
                const stat = fstatSync(fd);
                if (!stat.isFile() || stat.uid !== loc.uid || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
                    fail('record');
                temporaryIdentity = identity(stat);
                let offset = 0;
                while (offset < before.encoded.length) {
                    const n = writeSync(fd, before.encoded, offset, before.encoded.length - offset);
                    if (n < 1)
                        fail('partial');
                    offset += n;
                }
                fsyncSync(fd);
                check();
            }, 0o600);
            const beforeLink = lstatSync(temporary);
            if (beforeLink.isSymbolicLink() || identity(beforeLink) !== temporaryIdentity)
                fail('temporary_changed');
            try {
                linkSync(temporary, target);
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                const old = bytes(target, loc.uid);
                if (!old.equals(before.encoded))
                    fail('record_conflict');
            }
            const own = lstatSync(temporary);
            if (own.isSymbolicLink() || identity(own) !== temporaryIdentity)
                fail('temporary_changed');
            unlinkSync(temporary);
            syncParent();
            if (!bytes(target, loc.uid).equals(before.encoded))
                fail('record_changed');
            check();
        },
    });
    return owner;
}
