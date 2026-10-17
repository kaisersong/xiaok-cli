import type { ZodTypeAny } from 'zod';
import type { RequestSource, Source } from './kb-types.js';
import { captureIpcData } from './ipc-data-snapshot.js';

export function requireKbRequestSource(source: RequestSource | undefined, allowed: readonly RequestSource[] = ['user', 'agent', 'scheduler']): RequestSource {
  if (source !== 'user' && source !== 'agent' && source !== 'scheduler') throw Error('A valid request source is required to mutate Knowledge');
  if (!allowed.includes(source)) throw Error(`Request source ${source} is not allowed to mutate Knowledge`);
  return source;
}
export function captureKbMutationInput<T>(raw: T, schema: ZodTypeAny): T {
  const snapshot = captureIpcData(raw, 'knowledge_input_invalid');
  if (!schema.safeParse(snapshot).success) throw Error('knowledge_input_invalid');
  return snapshot;
}
export function assertKbPendingSourceOwner(source: Source, requestSource: RequestSource): void {
  if (source.parseStatus !== 'pending' && source.parseStatus !== 'parsing') throw Error(`Source state does not allow parse update: ${source.parseStatus}`);
  if (requestSource !== 'scheduler' && source.metadata.createdBy !== requestSource) throw Error(`Request source ${requestSource} is not allowed to update this source`);
}
export function assertKbAuthorityMetadataUnchanged(source: Source, patch?: Record<string, unknown>): void {
  for (const key of ['createdBy', 'clientRequestKey', 'assistantContentDigest']) {
    if (patch && Object.hasOwn(patch, key) && !Object.is(patch[key], source.metadata[key])) throw Error('knowledge_authority_metadata_immutable');
  }
}
