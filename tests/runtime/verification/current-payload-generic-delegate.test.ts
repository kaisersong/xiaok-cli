import { expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// These scripted transport/route observations are DATA test dependencies.
// They confer no Native, installed-root or local-write qualification.
const route = vi.hoisted(() => ({ current: {} as any, calls: [] as string[],
  changedAfterObserve: false, disposed: 0, body: Buffer.from('installed-payload') }));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({ readInstalledCurrentOwner: () => route.current }));
vi.mock('../../../src/runtime/verification/controller-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/runtime/verification/controller-client.js')>(),
  createInstalledVerificationClient: () => ({ dispose: () => { route.disposed++; }, publicationTransport: {
    async call(method: string) {
      route.calls.push(method);
      const owner = route.current.owner;
      if (method === 'publication.observeOwner') {
        if (route.changedAfterObserve) route.current = { kind: 'unavailable' };
        return { owner, businessRevision: 1, currentVerification: 'valid',
          publication: { status: 'committed', current: true, operationId: 'operation', fullTupleHash: 'a'.repeat(64) } };
      }
      if (method !== 'publication.readOwnerPayload') throw new Error('unexpected-write-or-fused-rpc');
      return { owner, businessRevision: 1, operationId: 'operation', fullTupleHash: 'a'.repeat(64),
        payloadHash: createHash('sha256').update(route.body).digest('hex'), totalBytes: route.body.length,
        offset: 0, bytes: route.body.toString('base64'), eof: true };
    },
  } }),
}));
import { createPublicationClient } from '../../../src/runtime/verification/publication-client.js';
import { createInstalledCompletionPublisher } from '../../../src/runtime/verification/installed-completion-publication.js';

const owner = { profileId: 'profile', ownerKind: 'loop' as const, ownerId: 'loop' };
function observed(publication: unknown = { status: 'committed', current: true, operationId: 'operation', fullTupleHash: 'a'.repeat(64) }, verification = 'valid') {
  return { owner, businessRevision: 1, currentVerification: verification, publication };
}
function fixture(options: { observation?: unknown; error?: { value: unknown }; corruptHash?: boolean; abortAfterObserve?: AbortController } = {}) {
  const body = Buffer.alloc(300 * 1024, 97), hash = createHash('sha256').update(body).digest('hex');
  const calls: string[] = [];
  const client = createPublicationClient({ owner, requestSource: 'agent', transport: { async call(method, payload) {
    calls.push(method);
    if (options.error) throw options.error.value;
    if (method === 'publication.observeOwner') {
      options.abortAfterObserve?.abort(new Error('aborted-after-observation'));
      return options.observation ?? observed();
    }
    expect(method).toBe('publication.readOwnerPayload');
    const input = payload as { offset: number; maxBytes: number };
    expect(input.maxBytes).toBe(262144); // Unbranded legacy transport retains its original bound.
    const bytes = body.subarray(input.offset, input.offset + input.maxBytes);
    return { owner, businessRevision: 1, operationId: 'operation', fullTupleHash: 'a'.repeat(64),
      payloadHash: options.corruptHash ? 'b'.repeat(64) : hash, totalBytes: body.length,
      offset: input.offset, bytes: bytes.toString('base64'), eof: input.offset + bytes.length === body.length };
  } } });
  return { client, calls, body, hash };
}

it('composes the original observation and complete guarded legacy reader without the old fused RPC', async () => {
  const f = fixture(), value = await f.client.readCurrentPayload();
  expect(value.observation).toEqual(observed());
  expect(value.payload?.bytes).toEqual(f.body); expect(value.payload?.payloadHash).toBe(f.hash);
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.observation)).toBe(true);
  expect(f.calls).toEqual(['publication.observeOwner', 'publication.readOwnerPayload', 'publication.readOwnerPayload']);
});
it.each([
  observed({ status: 'absent' }),
  observed({ status: 'committed', current: false, operationId: 'operation', fullTupleHash: 'a'.repeat(64) }),
  observed({ status: 'unknown', current: false, operationId: 'operation', fullTupleHash: 'a'.repeat(64) }, 'unavailable'),
])('returns no payload for an original non-current observation: %s', async observation => {
  const f = fixture({ observation }), result = await f.client.readCurrentPayload();
  expect(result).toEqual({ observation, payload: null }); expect(f.calls).toEqual(['publication.observeOwner']);
});
it('rejects non-loop owners before any transport call', async () => {
  let calls = 0;
  const client = createPublicationClient({ owner: { ...owner, ownerKind: 'task' }, requestSource: 'user',
    transport: { async call() { calls++; throw new Error('should-not-enter'); } } });
  await expect(client.readCurrentPayload()).rejects.toThrow('publication_client_owner'); expect(calls).toBe(0);
});
it('rejects cancellation before observe and after observe without dispatching a payload read', async () => {
  const before = new AbortController(); before.abort(new Error('before-observation'));
  const first = fixture(); await expect(first.client.readCurrentPayload(before.signal)).rejects.toThrow('before-observation');
  expect(first.calls).toEqual([]);
  const after = new AbortController(), second = fixture({ abortAfterObserve: after });
  await expect(second.client.readCurrentPayload(after.signal)).rejects.toThrow('aborted-after-observation');
  expect(second.calls).toEqual(['publication.observeOwner']);
});
it('retains the original full-body hash rejection', async () => {
  const f = fixture({ corruptHash: true }); await expect(f.client.readCurrentPayload()).rejects.toThrow('publication_client_payload_hash');
  expect(f.calls).toHaveLength(3);
});
it.each([new Error('original-observe-error'), undefined])('preserves original transport rejection presence: %s', async primary => {
  const f = fixture({ error: { value: primary } }), [result] = await Promise.allSettled([f.client.readCurrentPayload()]);
  expect(result).toEqual({ status: 'rejected', reason: primary });
});

beforeEach(() => {
  route.current = { kind: 'protected-unregistered', authorityId: 'authority', owner };
  route.calls = []; route.changedAfterObserve = false; route.disposed = 0;
});
it('keeps the installed route cut between observe and original payload read', async () => {
  const publisher = createInstalledCompletionPublisher({ ownerKind: 'loop', ownerId: owner.ownerId }, 'agent');
  try {
    const result = await publisher.readCurrentPayload(); expect(result.payload?.bytes).toEqual(route.body);
    expect(route.calls).toEqual(['publication.observeOwner', 'publication.readOwnerPayload']);
  } finally { publisher.dispose(); }
  expect(route.disposed).toBe(1);
});
it('rejects an installed route change before dispatching the payload and preserves closure denial', async () => {
  const publisher = createInstalledCompletionPublisher({ ownerKind: 'loop', ownerId: owner.ownerId }, 'agent'); route.changedAfterObserve = true;
  try {
    await expect(publisher.readCurrentPayload()).rejects.toThrow('publication_installed_owner_changed');
    expect(route.calls).toEqual(['publication.observeOwner']);
  } finally { publisher.dispose(); }
  await expect(publisher.readCurrentPayload()).rejects.toThrow('publication_installed_owner_changed');
  expect(route.calls).toEqual(['publication.observeOwner']);
});
