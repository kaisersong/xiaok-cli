import { expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Socket } from 'node:net';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { ConversationActivityAttachedService } from '../../../src/runtime/conversation-activity/owner-service.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

it('drains the real admitted list RPC before disposing its authenticated client', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'activity-attached-rpc-drain-')));
  const profileId = 'owned-ordinary-profile', actorId = 'owned-local-user', threadId = 'owned-thread';
  const release = deferred<void>();
  let entered = false;
  let host: ConversationActivityOwnerHost | undefined;
  let client: ConversationActivityOwnerClient | undefined;
  let service: ConversationActivityAttachedService | undefined;
  let list: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  let socketClosed: Promise<void> | undefined;
  let original: { error: unknown } | undefined;
  let listSpy: { mockRestore(): void } | undefined;
  try {
    host = new ConversationActivityOwnerHost({ dataRoot: root, profileId, actorId,
      getThread: id => id === threadId ? { threadId, profileId, workspaceId: root, deleteState: 'none' } : null,
      canObserveWork: () => false, authorizeProducer: () => false });
    await host.start();
    client = new ConversationActivityOwnerClient(root, 'user');
    await client.connect();
    // Observe the socket made by this actual client, solely for negative cleanup.
    // Neither this private field nor its event is an SDK/Native authority proof.
    const socket = (client as unknown as { socket: Socket }).socket;
    socketClosed = new Promise<void>(resolve => socket.once('close', resolve));
    service = new ConversationActivityAttachedService(client, actorId);
    const actualList = host.service.listActivities;
    listSpy = vi.spyOn(host.service, 'listActivities').mockImplementation(async function (...args) {
      entered = true;
      await release.promise;
      return Reflect.apply(actualList, this, args);
    });
    list = service.listActivities(threadId, { requestSource: 'user', actorId });
    const listOutcome = Promise.allSettled([list]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 3000 });
    closing = service.close();
    const closeOutcome = Promise.allSettled([closing]);
    let terminal = false;
    void closing.then(() => { terminal = true; }, () => { terminal = true; });
    await turn();
    expect(terminal).toBe(false);
    release.resolve();
    expect(await list).toEqual([]);
    await closing;
    expect(await listOutcome).toEqual([{ status: 'fulfilled', value: [] }]);
    expect(await closeOutcome).toEqual([{ status: 'fulfilled', value: undefined }]);
    expect(service.close()).toBe(closing);
  } catch (error) {
    original = { error };
  } finally {
    release.resolve();
    const failures: unknown[] = [];
    for (const operation of [
      () => Promise.allSettled([list, closing]),
      () => service?.close(),
      () => client?.dispose(),
      () => socketClosed,
      () => host?.stop(),
    ]) {
      try { await operation(); } catch (error) { failures.push(error); }
    }
    listSpy?.mockRestore();
    if (!failures.length) {
      if (host && process.platform !== 'win32') {
        const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
        expect(dirname(host.address.socketPath)).toBe(expected);
        rmdirSync(expected);
      }
      rmSync(root, { recursive: true });
    }
    if (failures.length) throw new AggregateError([...(original ? [original.error] : []), ...failures],
      'owned attached RPC cleanup unconfirmed; root retained', { cause: original?.error });
  }
  if (original) throw original.error;
});
