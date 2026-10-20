import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import './owner-entry.js';
import { spawn } from 'node:child_process';
import { writeFileSync, renameSync, openSync, closeSync, readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ConversationActivityOwnerClient } from './owner-client.js';
import { retireOutdatedOwner } from './owner-retire.js';
import { ACTIVITY_OWNER_GENERATION, activityOwnerAddress } from './owner-protocol.js';
import { activityOwnerConfigDigest } from './owner-runtime.js';
import { loadContinuityProfile, resolveDesktopProfile } from '../context-continuity/profile.js';
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
/** Native callers attach instead of competing for a writer. An outdated owner
 * may be retired after identity checks; RPC mutations are never retried. */
export async function ensureConversationActivityOwner(config, options = {}) {
    let legacyProfileId;
    if (config.identity.kind === 'desktop') {
        if (loadContinuityProfile(config.dataRoot, { requireExisting: true }) !== config.profileId)
            throw new Error('activity_owner_profile_mismatch');
        const identity = resolveDesktopProfile(config.dataRoot);
        if (identity.profileId !== config.profileId)
            throw new Error('activity_owner_profile_mismatch');
        legacyProfileId = identity.legacyProfileId;
    }
    const address = activityOwnerAddress(config.dataRoot);
    const normalized = { ...config, dataRoot: address.dataRoot };
    const expectedDigest = activityOwnerConfigDigest(normalized);
    const terminal = (error) => error instanceof Error && ['activity_owner_profile_mismatch', 'activity_owner_config_mismatch', 'activity_profile_migration_blocked', 'activity_owner_policy_upgrade_blocked', 'activity_owner_generation_unsupported', 'activity_owner_qualification_unavailable'].includes(error.message);
    const attach = async () => {
        let client = new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId, { statusOnly: true });
        try {
            const status = await client.request('status');
            if (status.profileId !== config.profileId) {
                if (!legacyProfileId || status.profileId !== legacyProfileId || status.rootHash !== address.rootHash || typeof status.ownerEpoch !== 'string' || !status.ownerEpoch)
                    throw new Error('activity_owner_profile_mismatch');
                try {
                    const file = join(address.dataRoot, ACTIVITY_STORAGE_NAMES.config), stat = lstatSync(file);
                    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 || process.platform === 'win32' || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
                        throw new Error();
                    const old = JSON.parse(readFileSync(file, 'utf8'));
                    if (old.schemaVersion !== 1 || old.profileId !== legacyProfileId || old.actorId !== `desktop-user:${legacyProfileId}` || resolve(old.dataRoot) !== address.dataRoot || old.identity?.kind !== 'desktop' || resolve(old.identity.path) !== resolve(config.identity.path) || status.configDigest !== activityOwnerConfigDigest(old))
                        throw new Error();
                }
                catch {
                    throw new Error('activity_owner_profile_mismatch');
                }
                if (await (options.retire ?? retireOutdatedOwner)(address.dataRoot, status) !== 'retired')
                    throw new Error('activity_profile_migration_blocked');
                throw new Error('activity_owner_retired');
            }
            if (typeof status.generation !== 'number' || status.generation < ACTIVITY_OWNER_GENERATION) {
                const outcome = await (options.retire ?? retireOutdatedOwner)(address.dataRoot, status);
                if (outcome === 'retired') {
                    options.onLegacyOwner?.('replaced');
                    throw new Error('activity_owner_retired');
                }
                if (config.identity.kind === 'desktop')
                    throw new Error('activity_owner_policy_upgrade_blocked');
                if (outcome === 'kept_pending')
                    options.onLegacyOwner?.('reused_pending');
                client.dispose();
                return new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId);
            }
            if (config.identity.kind === 'desktop' && status.generation !== ACTIVITY_OWNER_GENERATION)
                throw new Error('activity_owner_generation_unsupported');
            if (status.configDigest !== expectedDigest)
                throw new Error('activity_owner_config_mismatch');
            if (status.ready === false)
                throw new Error('activity_owner_initializing');
            if (config.identity.kind === 'desktop') {
                if (status.ready !== true || status.ownerEpoch !== client.ownerEpoch || status.rootHash !== address.rootHash)
                    throw new Error('activity_owner_qualification_unavailable');
                client.dispose();
                client = new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId, { qualification: { profileId: config.profileId, configDigest: expectedDigest, generation: ACTIVITY_OWNER_GENERATION } });
                await client.connect();
                return client;
            }
            client.dispose();
            client = new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId);
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
        if (terminal(error) || error instanceof Error && error.message === 'activity_owner_initializing')
            throw error;
    }
    const configFile = join(address.dataRoot, ACTIVITY_STORAGE_NAMES.config);
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(normalized), { mode: 0o600 });
    chmodPrivateActivityFile(temporary);
    renameSync(temporary, configFile);
    const logFile = openSync(join(address.dataRoot, ACTIVITY_STORAGE_NAMES.log), 'a', 0o600);
    chmodPrivateActivityFile(join(address.dataRoot, ACTIVITY_STORAGE_NAMES.log));
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
    let exitedAt;
    child.once('exit', () => { exitedAt = Date.now(); });
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
            if (terminal(error))
                throw error;
            lastError = error;
        }
        if (spawnError)
            throw spawnError;
        if (exitedAt !== undefined && Date.now() - exitedAt >= 500)
            throw new Error('activity_owner_exited');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw lastError instanceof Error ? lastError : new Error('activity_owner_start_timeout');
}
