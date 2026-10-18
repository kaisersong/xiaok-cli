import {createHash} from 'node:crypto';
import type {OrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
export function discoveryData(count: number, version: 1 | 2 = 1): OrdinaryProfileSources {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {version, uid: 1, generation: '7', legacyInventoryRequired: true,
    sources: Array.from({length: count}, (_, index) => {
      // Logical codec data, not physical ownership, a grant, or an executed producer.
      const directory = {canonicalPath: '/owned-codec-data/' + index + '/' + 'x'.repeat(180), device: '1', inode: String(index + 1)};
      return {kind: 'session-root' as const, directory, snapshotFormat: 'session-root-v1',
        sourceId: digest(['session-root', directory.device, directory.inode, null]),
        namespaceId: digest([directory.canonicalPath, 'session-root', null])};
    })};
}
