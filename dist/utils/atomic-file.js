import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync, } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
const defaultOperations = {
    mkdirSync,
    openSync,
    writeFileSync,
    fsyncSync,
    closeSync,
    renameSync,
    unlinkSync,
};
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set([
    'EINVAL',
    'ENOTSUP',
    'EISDIR',
]);
export const writeFileAtomicallySync = (targetPath, contents, options = {}) => {
    const platform = options.platform ?? process.platform;
    if (options.requireDirectorySync && platform === 'win32') {
        throw new Error('directory sync durability unsupported on Windows');
    }
    const operations = {
        ...defaultOperations,
        ...options.operations,
    };
    const parentDir = dirname(targetPath);
    const tempPath = join(parentDir, options.tempName
        ?? `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
    operations.mkdirSync(parentDir, { recursive: true });
    let fileDescriptor;
    let renamed = false;
    try {
        fileDescriptor = operations.openSync(tempPath, 'wx', 0o600);
        operations.writeFileSync(fileDescriptor, contents, 'utf8');
        operations.fsyncSync(fileDescriptor);
        operations.closeSync(fileDescriptor);
        fileDescriptor = undefined;
        operations.renameSync(tempPath, targetPath);
        renamed = true;
        if (options.requireDirectorySync)
            syncDirectoryTreeStrict(parentDir, { operations, platform });
        else
            syncDirectory(parentDir, operations, platform);
    }
    catch (error) {
        if (fileDescriptor !== undefined) {
            try {
                operations.closeSync(fileDescriptor);
            }
            catch { }
        }
        if (!renamed) {
            try {
                operations.unlinkSync(tempPath);
            }
            catch { }
        }
        throw error;
    }
};
/** A publication barrier, not a best-effort durability hint. Failures must propagate. */
export function syncDirectoryTreeStrict(directoryPath, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform === 'win32')
        throw new Error('directory sync durability unsupported on Windows');
    const operations = { ...defaultOperations, ...options.operations };
    let directory = resolve(directoryPath);
    for (;;) {
        syncDirectory(directory, operations, platform, true);
        const parent = dirname(directory);
        if (parent === directory)
            return;
        directory = parent;
    }
}
function syncDirectory(directoryPath, operations, platform, required = false) {
    if (platform === 'win32') {
        return;
    }
    let directoryDescriptor;
    try {
        directoryDescriptor = operations.openSync(directoryPath, 'r');
        operations.fsyncSync(directoryDescriptor);
    }
    catch (error) {
        const code = error.code;
        if (required || !code || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) {
            throw error;
        }
    }
    finally {
        if (directoryDescriptor !== undefined) {
            operations.closeSync(directoryDescriptor);
        }
    }
}
