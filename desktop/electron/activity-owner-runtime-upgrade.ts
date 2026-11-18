import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activityOwnerConfigDigest } from '../../src/runtime/conversation-activity/owner-config.js';
import type { ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';
import { ACTIVITY_STORAGE_NAMES } from '../../src/runtime/conversation-activity/storage-permissions.js';

export const ACTIVITY_OWNER_RUNTIME_UPGRADE_REQUIRED = 'activity_owner_config_mismatch:runtime_upgrade_required';

const nodeVersion = 'service.runtime.node';
const sqliteVersion = 'service.runtime.sqlite';
const executableHash = 'service.runtime.executableSha256';

export function isActivityOwnerRuntimeUpgrade(
  current: ActivityOwnerConfig,
  previous: ActivityOwnerConfig,
  authenticatedDigest: string | undefined,
): boolean {
  if (current.identity.kind !== 'desktop' || previous.identity.kind !== 'desktop'
    || !authenticatedDigest || activityOwnerConfigDigest(previous) !== authenticatedDigest) return false;

  const previousBroker = previous.managedSources?.find(source => source.name === 'broker');
  const currentBroker = current.managedSources?.find(source => source.name === 'broker');
  const prior = previousBroker?.expectedHealth;
  const next = currentBroker?.expectedHealth;
  if (!prior || !next || prior[nodeVersion] !== '24.19.0' || prior[sqliteVersion] !== '3.53.3'
    || next[nodeVersion] !== '24.22.3' || next[sqliteVersion] !== '3.54.1') return false;

  const oldHash = prior[executableHash];
  const newHash = next[executableHash];
  if (typeof oldHash !== 'string' || typeof newHash !== 'string' || oldHash === newHash
    || !/^[a-f0-9]{64}$/.test(oldHash) || !/^[a-f0-9]{64}$/.test(newHash)) return false;

  const previousWithNewPin = {
    ...previous,
    managedSources: previous.managedSources?.map(source => source === previousBroker ? {
      ...source,
      expectedHealth: { ...source.expectedHealth, [nodeVersion]: next[nodeVersion],
        [sqliteVersion]: next[sqliteVersion], [executableHash]: newHash },
    } : source),
  };
  return activityOwnerConfigDigest(previousWithNewPin) === activityOwnerConfigDigest(current);
}

/** This file is only diagnostic evidence. A mismatch never grants launch or stop authority. */
export function activityOwnerRuntimeUpgradeRequired(
  current: ActivityOwnerConfig, authenticatedDigest: string | undefined,
): boolean {
  try {
    const file = join(current.dataRoot, ACTIVITY_STORAGE_NAMES.config);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024) return false;
    if (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) return false;
    return isActivityOwnerRuntimeUpgrade(current, JSON.parse(readFileSync(file, 'utf8')), authenticatedDigest);
  } catch {
    return false;
  }
}
