import { Worker } from 'node:worker_threads';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
const execute = promisify(execFile);
const ps = async (pid, field) => (await execute('ps', ['-p', String(pid), '-o', `${field}=`], { timeout: 1000, maxBuffer: 256 * 1024 })).stdout.trim();
/** Isolate synchronous SQLite work so even a blocked read has a hard deadline. */
export async function readPendingTasks(dataRoot) {
    return new Promise(resolve => {
        const worker = new Worker(new URL('./owner-pending-reader.js', import.meta.url), { workerData: { dataRoot } });
        let finished = false;
        const finish = (result) => { if (finished)
            return; finished = true; clearTimeout(timer); resolve(result); void worker.terminate(); };
        const timer = setTimeout(() => finish('unknown'), 5000);
        worker.once('message', result => finish(result === 'none' || result === 'pending' ? result : 'unknown'));
        worker.once('error', () => finish('unknown'));
        worker.once('exit', () => finish('unknown'));
    }).catch(() => 'unknown');
}
async function boundedTaskRead(read) {
    let timer;
    try {
        return await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => resolve('unknown'), 5000); })]);
    }
    catch {
        return 'unknown';
    }
    finally {
        clearTimeout(timer);
    }
}
function defaults() {
    return {
        readPendingTasks, platform: process.platform, currentPid: process.pid, currentUid: process.getuid?.(),
        readStatusFile: async (path) => JSON.parse(await readFile(path, 'utf8')),
        readCmdline: async (pid) => process.platform === 'linux' ? (await readFile(join('/proc', String(pid), 'cmdline'), 'utf8')).split('\0').filter(Boolean) : ps(pid, 'command'),
        readUid: async (pid) => {
            if (process.platform === 'linux')
                return (await stat(join('/proc', String(pid)))).uid;
            const uid = await ps(pid, 'uid');
            return /^\d+$/.test(uid) ? Number(uid) : NaN;
        },
        kill: (pid, signal) => { process.kill(pid, signal); },
        isAlive: async (pid) => { try {
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            if (error.code === 'ESRCH')
                return false;
            throw error;
        } },
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    };
}
function matchesCommand(command, configPath) {
    if (Array.isArray(command))
        return command.some(arg => arg.includes('owner-entry')) && command.includes(configPath);
    // ps renders argv as a single string; require complete argument boundaries.
    const escaped = configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return command.includes('owner-entry') && new RegExp(`(?:^|\\s)(?:${escaped}|"${escaped}"|'${escaped}')(?:\\s|$)`).test(command);
}
/** Retire only an authenticated, independently verified owner; never its children. */
export async function retireOutdatedOwner(dataRoot, status, dependencies = {}) {
    const deps = { ...defaults(), ...dependencies };
    if (!['linux', 'darwin'].includes(deps.platform))
        return 'kept_unverified';
    const pid = status.pid;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || pid === deps.currentPid
        || typeof status.ownerEpoch !== 'string' || !status.ownerEpoch || typeof status.rootHash !== 'string' || !status.rootHash
        || !Number.isSafeInteger(deps.currentUid))
        return 'kept_unverified';
    try {
        const disk = await deps.readStatusFile(join(dataRoot, ACTIVITY_STORAGE_NAMES.status));
        if (disk.pid !== pid || disk.ownerEpoch !== status.ownerEpoch || disk.rootHash !== status.rootHash)
            return 'kept_unverified';
        if (!matchesCommand(await deps.readCmdline(pid), join(dataRoot, ACTIVITY_STORAGE_NAMES.config)))
            return 'kept_unverified';
        if (await deps.readUid(pid) !== deps.currentUid)
            return 'kept_unverified';
        const pending = await boundedTaskRead(() => deps.readPendingTasks(dataRoot));
        if (pending !== 'none')
            return pending === 'pending' ? 'kept_pending' : 'kept_unknown';
        try {
            deps.kill(pid, 'SIGTERM');
        }
        catch (error) {
            return error.code === 'ESRCH' ? 'retired' : 'kept_unverified';
        }
        for (let elapsed = 0; elapsed < 3000; elapsed += 50) {
            if (!await deps.isAlive(pid))
                return 'retired';
            await deps.sleep(50);
        }
        return !await deps.isAlive(pid) ? 'retired' : 'kept_unverified';
    }
    catch {
        return 'kept_unverified';
    }
}
