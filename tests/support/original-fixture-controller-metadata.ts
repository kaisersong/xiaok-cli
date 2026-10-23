// UNREVIEWED CANDIDATE: only original startup-produced objects from the owned test fixture.
import {randomUUID} from 'node:crypto';
import type {InstalledControllerLifetime} from '../../src/runtime/verification/installed-controller-lifetime.js';
import {assertInstalledSharedCapacity, type createInstalledSharedCapacity} from '../../src/runtime/verification/installed-shared-capacity.js';
import {readInstalledMetadataSource} from '../../src/runtime/verification/installed-metadata-source.js';
import {VERIFICATION_BUDGET} from '../../src/runtime/verification/protocol.js';
import {METADATA_EMERGENCY_BYTES} from '../../src/runtime/verification/metadata-capacity-protocol.js';

export function reserveOriginalFixtureControllerMetadata(
  lifetime: InstalledControllerLifetime,
  shared: ReturnType<typeof createInstalledSharedCapacity>,
  originalSource: object,
  minimumBytes: number,
) {
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes < 1 ||
      minimumBytes > VERIFICATION_BUDGET.controlDatabaseBytes - METADATA_EMERGENCY_BYTES)
    throw Error('fixture_metadata_minimum');
  assertInstalledSharedCapacity(shared, lifetime);
  const db = lifetime.database;
  const facts = readInstalledMetadataSource(originalSource, db, lifetime.manifest.authorityId);
  const row = db.prepare('SELECT revision FROM controller_metadata_resources WHERE resource_id=?')
    .get(facts.resourceId) as {revision: number} | undefined;
  if (!row) throw Error('fixture_original_metadata_missing');
  const prepared = shared.capacity.prepareControllerMetadata(originalSource, {
    requestId: randomUUID(), resourceId: facts.resourceId, expectedRevision: row.revision,
    minimumPageCount: Math.ceil(minimumBytes / facts.pageSize),
  });
  const applied = shared.capacity.applyControllerMetadata(originalSource, {
    requestId: prepared.requestId, resourceId: prepared.resourceId,
    intentId: prepared.intentId, allocationDigest: prepared.allocationDigest,
  });
  if (applied.state !== 'confirmed' || applied.writerGeneration !== lifetime.serviceEpoch ||
      applied.usableMaximumPageCount * applied.pageSize < minimumBytes ||
      db.pragma('max_page_count', {simple: true}) !== applied.usableMaximumPageCount)
    throw Error('fixture_original_metadata_not_confirmed');
  return applied;
}
