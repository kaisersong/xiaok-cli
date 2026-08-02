import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
export const GIT_MODE_REGULAR = '100644';
export const GIT_MODE_EXECUTABLE = '100755';
export const GIT_MODE_SYMLINK = '120000';
export const GIT_MODE_GITLINK = '160000';
const SUPPORTED_MODES = new Set([GIT_MODE_REGULAR, GIT_MODE_EXECUTABLE, GIT_MODE_SYMLINK]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
export function sha256Hex(input) {
    return createHash('sha256').update(input).digest('hex');
}
export function isSupportedGitMode(mode) {
    return SUPPORTED_MODES.has(mode);
}
export function computeGitTreeSha256(entries) {
    const seen = new Set();
    const records = [];
    const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
    for (const entry of sorted) {
        if (entry.mode === GIT_MODE_GITLINK) {
            throw new Error(`Refusing gitlink/submodule entry "${entry.path}"`);
        }
        if (!isSupportedGitMode(entry.mode)) {
            throw new Error(`Unsupported git mode "${entry.mode}" for "${entry.path}"`);
        }
        if (!SHA256_HEX.test(entry.contentSha256)) {
            throw new Error(`Entry "${entry.path}" has an invalid content SHA-256`);
        }
        if (seen.has(entry.path)) {
            throw new Error(`Duplicate entry path "${entry.path}"`);
        }
        seen.add(entry.path);
        records.push(Buffer.from(`${entry.mode} ${entry.contentSha256}\t${entry.path}\0`, 'utf8'));
    }
    return sha256Hex(Buffer.concat(records));
}
/**
 * Case-insensitive filesystems and Unicode normalization both let two distinct
 * Git entries land on one file, so a verified digest could describe bytes that
 * were never written to disk.
 */
export function detectPathConflicts(paths) {
    const buckets = new Map();
    for (const path of paths) {
        const key = path.normalize('NFC').toLowerCase();
        const bucket = buckets.get(key);
        if (bucket)
            bucket.push(path);
        else
            buckets.set(key, [path]);
    }
    return [...buckets.values()].filter((bucket) => bucket.length > 1).map((bucket) => bucket.join(' <-> '));
}
export function assertSafeRelativePath(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a non-empty relative path`);
    }
    if (value.includes('\0') || /[\u0001-\u001f\u007f]/.test(value)) {
        throw new Error(`${label} contains invalid control characters`);
    }
    if (value.includes('\\')) {
        throw new Error(`${label} must use POSIX separators`);
    }
    if (value.startsWith('-')) {
        throw new Error(`${label} must not look like a command-line option`);
    }
    if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error(`${label} must not be an absolute path`);
    }
    if (value !== value.normalize('NFC')) {
        throw new Error(`${label} must be Unicode NFC normalized`);
    }
    if (value !== '.' && (value.endsWith('/') || value.includes('//'))) {
        throw new Error(`${label} must be a normalized relative path`);
    }
    const segments = value.split('/');
    for (const segment of segments) {
        if (segment === '..') {
            throw new Error(`${label} must not contain ".." segments that escape the root`);
        }
        if (value !== '.' && (segment === '' || segment === '.')) {
            throw new Error(`${label} must not contain relative segments`);
        }
        if (segment.startsWith('-')) {
            throw new Error(`${label} must not contain option-like segments`);
        }
    }
    return value;
}
export function assertPluginRelativePath(root, value, label = 'path') {
    assertSafeRelativePath(value, label);
    const resolved = value === '.' ? root : join(root, value);
    const rel = relative(root, resolved);
    if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
        throw new Error(`${label} "${value}" escapes the plugin root`);
    }
    return resolved;
}
