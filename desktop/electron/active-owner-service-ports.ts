import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isDesktopActivityProfile } from '../../src/runtime/conversation-activity/owner-profile-id.js';
import { ConversationActivityOwnerClient } from '../../src/runtime/conversation-activity/owner-client.js';
import { ACTIVITY_OWNER_GENERATION } from '../../src/runtime/conversation-activity/owner-protocol.js';
import { ACTIVITY_STORAGE_NAMES } from '../../src/runtime/conversation-activity/storage-permissions.js';
import { activityOwnerConfigDigest, type ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';
import type { DesktopServicePorts } from './desktop-service-discovery.js';

/** Read endpoints only after the existing profile credential handshake. The
 * ordinary owner attach still verifies current executable paths, hashes and tokens. */
export async function activeOwnerServicePorts(dataRoot: string): Promise<DesktopServicePorts | undefined> {
  // First start: the profile may already exist while no owner was ever
  // configured. Nothing can be discovered then, and the owner client would
  // refuse qualification before probing the socket (1.6.3 blank-config start).
  if (!ownerConfigPresent(dataRoot)) return undefined;
  const client = new ConversationActivityOwnerClient(dataRoot, 'producer');
  try {
    let status: { generation: number; configDigest: string; profileId: string };
    try { status = await client.request('status'); }
    catch (error) {
      if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined;
      throw error;
    }
    const config = JSON.parse(readFileSync(join(client.address.dataRoot, ACTIVITY_STORAGE_NAMES.config), 'utf8')) as ActivityOwnerConfig;
    if (status.generation !== ACTIVITY_OWNER_GENERATION || config.identity.kind !== 'desktop'
      || realpathSync(config.dataRoot) !== client.address.dataRoot
      // Same profile rule as owner qualification: Main's service-scope id, not the continuity UUID.
      || !isDesktopActivityProfile(config) || status.profileId !== config.profileId
      || activityOwnerConfigDigest(config) !== status.configDigest) throw new Error('activity_owner_discovery_mismatch');
    const port = (url: string | undefined) => {
      const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(url ?? '');
      if (!match || Number(match[1]) > 65535) throw new Error('activity_owner_endpoint_invalid');
      return Number(match[1]);
    };
    const ports = { kswarm: port(config.kswarm?.url), broker: port(config.kswarm?.brokerUrl) };
    if (ports.kswarm === ports.broker || config.managedSources?.find(source => source.name === 'kswarm')?.healthUrl !== `${config.kswarm!.url}/health`
      || config.managedSources?.find(source => source.name === 'broker')?.healthUrl !== `${config.kswarm!.brokerUrl}/health`) throw new Error('activity_owner_endpoint_invalid');
    return ports;
  } finally { client.dispose(); }
}

function ownerConfigPresent(dataRoot: string): boolean {
  try { lstatSync(join(realpathSync(dataRoot), ACTIVITY_STORAGE_NAMES.config)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
