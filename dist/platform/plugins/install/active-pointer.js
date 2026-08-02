import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync, } from 'node:fs';
import { join, relative, sep } from 'node:path';
const POINTER_VERSION = 1;
const DIGEST_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCK_STALE_MS = 15 * 60 * 1000;
export function activePointerPath(paths, name) {
    assertValidPluginName(name);
    return join(paths.activeDir, `${name}.json`);
}
export function assertValidPluginName(name) {
    if (!PLUGIN_NAME.test(name)) {
        throw new Error(`Invalid plugin name "${name}"`);
    }
}
function toPluginsRelative(paths, absolute) {
    const rel = relative(paths.pluginsDir, absolute);
    if (!rel || rel.startsWith('..')) {
        throw new Error(`Path "${absolute}" is outside the plugins directory`);
    }
    return rel.split(sep).join('/');
}
function fromPluginsRelative(paths, value, label) {
    if (typeof value !== 'string' || !value) {
        throw new Error(`Plugin pointer field "${label}" is missing`);
    }
    if (value.split('/').includes('..')) {
        throw new Error(`Plugin pointer field "${label}" escapes the plugins directory`);
    }
    return join(paths.pluginsDir, ...value.split('/'));
}
export async function switchActivePluginPointer(paths, input, now = () => new Date()) {
    const pointerFile = activePointerPath(paths, input.name);
    mkdirSync(paths.activeDir, { recursive: true });
    let previous = null;
    if (existsSync(pointerFile)) {
        try {
            previous = readActivePluginPointer(paths, input.name);
        }
        catch {
            previous = null;
        }
    }
    const document = {
        pointerVersion: POINTER_VERSION,
        name: input.name,
        version: input.version,
        digest: input.digest,
        commit: input.commit,
        versionDir: toPluginsRelative(paths, input.versionDir),
        pluginDir: toPluginsRelative(paths, input.pluginDir),
        ...(input.pythonRuntimeDir ? { pythonRuntimeDir: toPluginsRelative(paths, input.pythonRuntimeDir) } : {}),
        registryUrl: input.registryUrl,
        installedAt: now().toISOString(),
        probe: input.probe,
        ...(input.previousDigest ? { previousDigest: input.previousDigest } : {}),
    };
    const tempFile = join(paths.activeDir, `.${input.name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    const handle = openSync(tempFile, 'wx', 0o600);
    try {
        writeSync(handle, `${JSON.stringify(document, null, 2)}\n`);
        fsyncSync(handle);
    }
    finally {
        closeSync(handle);
    }
    try {
        renameSync(tempFile, pointerFile);
    }
    catch (error) {
        rmSync(tempFile, { force: true });
        throw error;
    }
    flushDirectory(paths.activeDir);
    return { previous };
}
function flushDirectory(dir) {
    if (process.platform === 'win32')
        return;
    let handle;
    try {
        handle = openSync(dir, 'r');
        fsyncSync(handle);
    }
    catch {
        // Directory fsync is a durability nicety; the rename itself is atomic.
    }
    finally {
        if (handle !== undefined)
            closeSync(handle);
    }
}
export function readActivePluginPointer(paths, name) {
    const pointerFile = activePointerPath(paths, name);
    let raw;
    try {
        raw = JSON.parse(readFileSync(pointerFile, 'utf8'));
    }
    catch (error) {
        throw new Error(`Plugin pointer ${pointerFile} is unreadable: ${error.message}`);
    }
    if (raw.pointerVersion !== POINTER_VERSION) {
        throw new Error(`Plugin pointer ${pointerFile} has an unsupported pointerVersion ${String(raw.pointerVersion)}`);
    }
    if (raw.name !== name) {
        throw new Error(`Plugin pointer ${pointerFile} declares name "${String(raw.name)}"`);
    }
    if (typeof raw.digest !== 'string' || !DIGEST_HEX.test(raw.digest)) {
        throw new Error(`Plugin pointer ${pointerFile} has an invalid digest`);
    }
    if (typeof raw.commit !== 'string' || !COMMIT_HEX.test(raw.commit)) {
        throw new Error(`Plugin pointer ${pointerFile} has an invalid commit`);
    }
    const versionDir = fromPluginsRelative(paths, raw.versionDir, 'versionDir');
    const pluginDir = fromPluginsRelative(paths, raw.pluginDir, 'pluginDir');
    const expectedVersionDir = join(paths.managedDir, name, raw.digest);
    if (versionDir !== expectedVersionDir) {
        throw new Error(`Plugin pointer ${pointerFile} does not reference its managed version directory`);
    }
    const insideVersionDir = relative(versionDir, pluginDir);
    if (insideVersionDir.startsWith('..') || !insideVersionDir.startsWith(`repo${sep}`)) {
        throw new Error(`Plugin pointer ${pointerFile} escapes its managed version directory`);
    }
    if (!existsSync(join(pluginDir, 'plugin.json'))) {
        throw new Error(`Plugin pointer ${pointerFile} references a missing plugin.json`);
    }
    let pythonRuntimeDir;
    if (raw.pythonRuntimeDir !== undefined) {
        pythonRuntimeDir = fromPluginsRelative(paths, raw.pythonRuntimeDir, 'pythonRuntimeDir');
        const expectedRuntimeDir = join(paths.runtimesDir, name, raw.digest);
        if (pythonRuntimeDir !== expectedRuntimeDir) {
            throw new Error(`Plugin pointer ${pointerFile} does not reference its digest-isolated Python runtime`);
        }
        if (!existsSync(pythonRuntimeDir)) {
            throw new Error(`Plugin pointer ${pointerFile} references a missing Python runtime`);
        }
    }
    const probe = raw.probe;
    return {
        pointerVersion: POINTER_VERSION,
        name,
        version: typeof raw.version === 'string' ? raw.version : '',
        digest: raw.digest,
        commit: raw.commit,
        versionDir,
        pluginDir,
        ...(pythonRuntimeDir ? { pythonRuntimeDir } : {}),
        registryUrl: typeof raw.registryUrl === 'string' ? raw.registryUrl : '',
        installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : '',
        probe: probe && (probe.status === 'verified' || probe.status === 'unverified')
            ? { status: probe.status, outcomes: Array.isArray(probe.outcomes) ? probe.outcomes : [] }
            : { status: 'unverified', outcomes: [] },
        ...(typeof raw.previousDigest === 'string' ? { previousDigest: raw.previousDigest } : {}),
    };
}
export function resolveManagedPlugins(pluginsDir) {
    const paths = {
        pluginsDir,
        managedDir: join(pluginsDir, '.managed'),
        activeDir: join(pluginsDir, '.active'),
        locksDir: join(pluginsDir, '.locks'),
        runtimesDir: join(pluginsDir, '.runtimes'),
    };
    const entries = [];
    const invalid = [];
    if (!existsSync(paths.activeDir))
        return { entries, invalid };
    for (const file of readdirSync(paths.activeDir).sort()) {
        if (!file.endsWith('.json') || file.startsWith('.'))
            continue;
        const name = file.slice(0, -'.json'.length);
        if (!PLUGIN_NAME.test(name)) {
            invalid.push({ name, reason: 'invalid pointer file name' });
            continue;
        }
        try {
            entries.push({ name, pointer: readActivePluginPointer(paths, name) });
        }
        catch (error) {
            invalid.push({ name, reason: error.message });
        }
    }
    return { entries, invalid };
}
export function removeActivePluginPointer(paths, name) {
    const pointerFile = activePointerPath(paths, name);
    if (!existsSync(pointerFile))
        return false;
    unlinkSync(pointerFile);
    flushDirectory(paths.activeDir);
    return true;
}
export function pruneManagedVersions(paths, name, keepDigests) {
    return pruneDigestDirectories(join(paths.managedDir, name), keepDigests);
}
export function prunePluginRuntimeVersions(paths, name, keepDigests) {
    return pruneDigestDirectories(join(paths.runtimesDir, name), keepDigests);
}
function pruneDigestDirectories(rootDir, keepDigests) {
    if (!existsSync(rootDir))
        return [];
    const keep = new Set(keepDigests.filter((digest) => DIGEST_HEX.test(digest)));
    const removed = [];
    for (const entry of readdirSync(rootDir).sort()) {
        if (keep.has(entry))
            continue;
        const target = join(rootDir, entry);
        rmSync(target, { recursive: true, force: true });
        removed.push(target);
    }
    return removed;
}
function defaultIsProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
export async function acquirePluginLock(paths, name, options = {}) {
    assertValidPluginName(name);
    const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_MS;
    const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    mkdirSync(paths.locksDir, { recursive: true });
    const lockFile = join(paths.locksDir, `${name}.lock`);
    const token = randomBytes(12).toString('hex');
    const claim = () => {
        let handle;
        try {
            handle = openSync(lockFile, 'wx', 0o600);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                return null;
            throw error;
        }
        try {
            writeSync(handle, `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`);
            fsyncSync(handle);
        }
        finally {
            closeSync(handle);
        }
        return {
            async release() {
                try {
                    const held = JSON.parse(readFileSync(lockFile, 'utf8'));
                    if (held.token !== token)
                        return;
                }
                catch {
                    return;
                }
                rmSync(lockFile, { force: true });
            },
        };
    };
    const first = claim();
    if (first)
        return first;
    let held;
    try {
        held = JSON.parse(readFileSync(lockFile, 'utf8'));
    }
    catch {
        throw new Error(`Plugin "${name}" has an unreadable install lock at ${lockFile}. Remove it manually after confirming no install is running.`);
    }
    const pid = typeof held.pid === 'number' ? held.pid : null;
    const createdAt = typeof held.createdAt === 'string' ? Date.parse(held.createdAt) : NaN;
    const age = Number.isFinite(createdAt) ? Date.now() - createdAt : NaN;
    if (pid === null || !Number.isFinite(age)) {
        throw new Error(`Plugin "${name}" install is locked by an unrecognizable owner at ${lockFile}`);
    }
    if (isProcessAlive(pid)) {
        throw new Error(`Another install of plugin "${name}" is in progress (pid ${pid})`);
    }
    if (age < staleAfterMs) {
        throw new Error(`Another install of plugin "${name}" is in progress (lock from pid ${pid} is ${Math.max(0, Math.round(age / 1000))}s old)`);
    }
    rmSync(lockFile, { force: true });
    const reclaimed = claim();
    if (!reclaimed) {
        throw new Error(`Another install of plugin "${name}" is in progress`);
    }
    return reclaimed;
}
