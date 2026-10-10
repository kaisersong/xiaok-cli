import { chmodPrivateActivityFile } from './storage-permissions.js';
import { ACTIVITY_STORAGE_NAMES } from './storage-permissions.js';
import './owner-entry.js';
import { spawn } from 'node:child_process';
import { writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ConversationActivityOwnerClient } from './owner-client.js';
import { retireOutdatedOwner, type ActivityOwnerRetirementStatus } from './owner-retire.js';
import { ACTIVITY_OWNER_GENERATION, activityOwnerAddress } from './owner-protocol.js';
import type { ActivityOwnerConfig } from './owner-runtime.js';
import { activityOwnerConfigDigest } from './owner-runtime.js';

/** Only operational environment is inherited by the long-lived owner. */
export function buildActivityOwnerEnv(parent: NodeJS.ProcessEnv, platform = process.platform): Record<string, string> {
  const allowed = new Set(['PATH','Path','HOME','USER','LOGNAME','SHELL','TMPDIR','TEMP','TMP','TZ','LANG','LANGUAGE',
    'DISPLAY','WAYLAND_DISPLAY','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME',
    'NODE_OPTIONS','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy']);
  if (platform === 'win32') for (const name of ['USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','SYSTEMROOT','windir','ComSpec','PATHEXT','HOMEDRIVE','HOMEPATH']) allowed.add(name);
  return Object.fromEntries(Object.entries(parent).filter(([name, value]) => value !== undefined && (allowed.has(name) || name.startsWith('LC_') || name.startsWith('XIAOK_') && !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)))) as Record<string, string>;
}

/** Native callers attach instead of competing for a writer. An outdated owner
 * may be retired after identity checks; RPC mutations are never retried. */
export async function ensureConversationActivityOwner(config: ActivityOwnerConfig, options: { instanceId?: string; executable?: string; entryPath?: string; timeoutMs?: number; spawn?: typeof spawn; retire?: typeof retireOutdatedOwner } = {}): Promise<ConversationActivityOwnerClient> {
  const address = activityOwnerAddress(config.dataRoot);
  const normalized = { ...config, dataRoot: address.dataRoot };
  const expectedDigest = activityOwnerConfigDigest(normalized);
  const attach = async () => {
    const client = new ConversationActivityOwnerClient(address.dataRoot, 'producer', options.instanceId);
    try {
      const status = await client.request<ActivityOwnerRetirementStatus & { profileId: string; generation?: unknown; configDigest?: string; ready?: boolean }>('status');
      if (status.profileId !== config.profileId) throw new Error('activity_owner_profile_mismatch');
      if (typeof status.generation !== 'number' || status.generation < ACTIVITY_OWNER_GENERATION) {
        if (await (options.retire ?? retireOutdatedOwner)(address.dataRoot, status)) {
          throw new Error('activity_owner_retired');
        }
        return client;
      }
      if (status.configDigest !== expectedDigest) throw new Error('activity_owner_config_mismatch');
      if (status.ready === false) throw new Error('activity_owner_initializing');
      return client;
    } catch (error) { client.dispose(); throw error; }
  };
  try { return await attach(); }
  catch (error) { if (error instanceof Error && ['activity_owner_profile_mismatch','activity_owner_config_mismatch'].includes(error.message)) throw error; }
  const configFile = join(address.dataRoot, ACTIVITY_STORAGE_NAMES.config);
  const temporary = `${configFile}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(normalized), { mode: 0o600 }); chmodPrivateActivityFile(temporary); renameSync(temporary, configFile);
  const logFile = openSync(join(address.dataRoot, ACTIVITY_STORAGE_NAMES.log), 'a', 0o600);
  chmodPrivateActivityFile(join(address.dataRoot, ACTIVITY_STORAGE_NAMES.log));
  let child: ReturnType<typeof spawn>;
  try {
    child = (options.spawn ?? spawn)(options.executable ?? process.execPath, [options.entryPath ?? fileURLToPath(new URL('./owner-entry.js', import.meta.url)), configFile], {
      detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true, env: { ...buildActivityOwnerEnv(process.env), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    });
  } finally { closeSync(logFile); }
  let spawnError: unknown; child.once('error', error => { spawnError = error; });
  let exitedAt: number | undefined;
  child.once('exit', () => { exitedAt = Date.now(); });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try { return await attach(); } catch (error) { lastError = error; }
    if (spawnError) throw spawnError;
    if (exitedAt !== undefined && Date.now() - exitedAt >= 500) throw new Error('activity_owner_exited');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error('activity_owner_start_timeout');
}
