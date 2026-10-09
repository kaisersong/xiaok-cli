import './owner-entry.js';
import { spawn } from 'node:child_process';
import { writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ConversationActivityOwnerClient } from './owner-client.js';
import { activityOwnerAddress } from './owner-protocol.js';
import { activityOwnerConfigDigest } from './owner-runtime.js';
/** Only operational environment is inherited by the long-lived owner. */
export function buildActivityOwnerEnv(parent, platform = process.platform) {
    const allowed = new Set(['PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'TZ', 'LANG', 'LANGUAGE',
        'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
        'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']);
    if (platform === 'win32')
        for (const name of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'HOMEDRIVE', 'HOMEPATH'])
            allowed.add(name);
    return Object.fromEntries(Object.entries(parent).filter(([name, value]) => value !== undefined && (allowed.has(name) || name.startsWith('LC_') || name.startsWith('XIAOK_') && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name))));
}
/** Native callers attach instead of competing for a writer. No RPC mutation
 * is retried; startup probes are read-only and do not unlink an active socket. */
export async function ensureConversationActivityOwner(config, options = {}) {
    const address = activityOwnerAddress(config.dataRoot);
    const normalized = { ...config, dataRoot: address.dataRoot };
    const expectedDigest = activityOwnerConfigDigest(normalized);
    const attach = async () => {
        const client = new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId);
        try {
            const status = await client.request('status');
            if (status.profileId !== config.profileId)
                throw new Error('activity_owner_profile_mismatch');
            if (status.configDigest !== expectedDigest)
                throw new Error('activity_owner_config_mismatch');
            if (status.ready === false)
                throw new Error('activity_owner_initializing');
            return client;
        }
        catch (error) {
            client.dispose();
            throw error;
        }
    };
    try {
        return await attach();
    }
    catch (error) {
        if (error instanceof Error && ['activity_owner_profile_mismatch', 'activity_owner_config_mismatch'].includes(error.message))
            throw error;
    }
    const configFile = join(address.dataRoot, 'activity-owner.config.json');
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(normalized), { mode: 0o600 });
    renameSync(temporary, configFile);
    const logFile = openSync(join(address.dataRoot, 'activity-owner.log'), 'a', 0o600);
    let child;
    try {
        child = (options.spawn ?? spawn)(options.executable ?? process.execPath, [options.entryPath ?? fileURLToPath(new URL('./owner-entry.js', import.meta.url)), configFile], {
            detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true, env: { ...buildActivityOwnerEnv(process.env), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        });
    }
    finally {
        closeSync(logFile);
    }
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.unref();
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    let lastError;
    while (Date.now() < deadline) {
        if (spawnError)
            throw spawnError;
        try {
            return await attach();
        }
        catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw lastError instanceof Error ? lastError : new Error('activity_owner_start_timeout');
}
