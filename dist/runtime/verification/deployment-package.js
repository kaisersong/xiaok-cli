import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
const maximumFiles = 16384;
const maximumBytes = 8 * 1024 ** 3;
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
/** Packaging census only. A matching hash never establishes protected OS ownership or engine qualification. */
export function snapshotDeploymentPackage(inputRoot) {
    const root = resolve(inputRoot);
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
        throw Error('deployment_package_link');
    const canonicalRoot = realpathSync(root);
    const files = [];
    const names = new Set();
    let total = 0;
    let entries = 0;
    function visit(directory, prefix, depth) {
        if (depth > 32)
            throw Error('deployment_package_limit');
        for (const name of readdirSync(directory).sort()) {
            if (++entries > maximumFiles)
                throw Error('deployment_package_limit');
            // Restricted portable names also make generated shell checksum ledgers unambiguous.
            if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,159}$/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
                throw Error('deployment_package_path');
            const relative = prefix ? prefix + '/' + name : name;
            const folded = relative.toLowerCase();
            if (names.has(folded))
                throw Error('deployment_package_path');
            names.add(folded);
            const path = join(directory, name);
            const stat = lstatSync(path);
            if (stat.isSymbolicLink())
                throw Error('deployment_package_link');
            if (stat.isDirectory()) {
                visit(path, relative, depth + 1);
                continue;
            }
            if (!stat.isFile() || stat.nlink !== 1)
                throw Error('deployment_package_link');
            if (!Number.isSafeInteger(stat.size) || stat.size < 0 || (total += stat.size) > maximumBytes)
                throw Error('deployment_package_limit');
            const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
                const opened = fstatSync(fd);
                if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size)
                    throw Error('deployment_package_changed');
                const hash = createHash('sha256');
                const buffer = Buffer.allocUnsafe(65536);
                let count = 0;
                let read;
                while ((read = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
                    count += read;
                    if (count > stat.size)
                        throw Error('deployment_package_changed');
                    hash.update(buffer.subarray(0, read));
                }
                const after = fstatSync(fd);
                const pathAfter = lstatSync(path);
                if (count !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.isSymbolicLink() || pathAfter.ino !== opened.ino || pathAfter.dev !== opened.dev)
                    throw Error('deployment_package_changed');
                files.push(Object.freeze({ path: relative, size: count, sha256: hash.digest('hex'), executable: (opened.mode & 0o111) !== 0 }));
            }
            finally {
                closeSync(fd);
            }
        }
    }
    visit(canonicalRoot, '', 0);
    if (!files.length)
        throw Error('deployment_package_empty');
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return Object.freeze({ schemaVersion: 1, files: Object.freeze(files), packageHash: digest(JSON.stringify(files)) });
}
export function parseDeploymentPackageInventory(inventory) {
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
        throw Error('deployment_package_manifest');
    const descriptors = Object.getOwnPropertyDescriptors(inventory);
    if (Object.keys(descriptors).sort().join(',') !== 'files,packageHash,schemaVersion' || Object.values(descriptors).some(d => !('value' in d)))
        throw Error('deployment_package_manifest');
    const value = inventory;
    if (value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length > maximumFiles || !/^[a-f0-9]{64}$/.test(value.packageHash))
        throw Error('deployment_package_manifest');
    for (const file of value.files) {
        if (!file || typeof file !== 'object' || Array.isArray(file))
            throw Error('deployment_package_manifest');
        const fields = Object.getOwnPropertyDescriptors(file);
        if (Object.keys(fields).sort().join(',') !== 'executable,path,sha256,size' || Object.values(fields).some(d => !('value' in d)))
            throw Error('deployment_package_manifest');
        if (typeof file.path !== 'string' || typeof file.executable !== 'boolean' || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
            throw Error('deployment_package_manifest');
    }
    const files = value.files.map(file => {
        if (!file.path.split('/').every((part) => /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,159}$/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
            throw Error('deployment_package_path');
        return Object.freeze({ path: file.path, size: file.size, sha256: file.sha256, executable: file.executable });
    });
    if (!files.length || new Set(files.map(f => f.path.toLowerCase())).size !== files.length || files.reduce((sum, f) => sum + f.size, 0) > maximumBytes)
        throw Error('deployment_package_manifest');
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (digest(JSON.stringify(files)) !== value.packageHash)
        throw Error('deployment_package_changed');
    return Object.freeze({ schemaVersion: 1, files: Object.freeze(files), packageHash: value.packageHash });
}
export function verifyDeploymentPackage(root, inventory) {
    const value = parseDeploymentPackageInventory(inventory);
    const actual = snapshotDeploymentPackage(root);
    if (actual.packageHash !== value.packageHash || JSON.stringify(actual.files) !== JSON.stringify(value.files))
        throw Error('deployment_package_changed');
}
