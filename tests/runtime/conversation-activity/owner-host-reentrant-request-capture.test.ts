import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';

it('PUBLIC BEFORE/POST: synchronous mcpRequest -> host.stop owns the still-pending raw request before closing its real store', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r249-host-reentrant-'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false, bodyFinished = false, stopped = false;
  let host: ConversationActivityOwnerHost | undefined, client: ConversationActivityOwnerClient | undefined;
  let request: Promise<unknown> | undefined, rawCallback: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined, closeObserved: Promise<PromiseSettledResult<void>[]> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'r249-local-observer', actorId: 'r249-user',
      getThread: () => null, canObserveWork: () => false, authorizeProducer: () => false,
      mcpRequest(method) {
        expect(method).toBe('mcpInputs'); entered = true;
        // Deliberate synchronous reentry, before returning this real native Promise.
        closing = host!.stop();
        closeObserved = Promise.allSettled([closing.then(() => { stopped = true; })]);
        rawCallback = gate.then(() => {
          // Real SQLite access must remain legal until this admitted body finishes.
          const rows = host!.store.listWatches(); bodyFinished = true; return rows;
        });
        void Promise.allSettled([rawCallback]);
        return rawCallback;
      } });
    client = new ConversationActivityOwnerClient(root, 'user');
    await host.start(); await client.request('status');
    request = client.request('mcpInputs', { watchId: 'owned-reentrant-lifecycle-control' });
    const requestObserved = Promise.allSettled([request]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    expect(bodyFinished).toBe(false); expect(stopped).toBe(false);
    expect(host.store.listWatches()).toEqual([]);
    release(); await rawCallback; await closing; await closeObserved; await requestObserved;
    expect(bodyFinished).toBe(true); expect(stopped).toBe(true);
    expect(() => host!.store.listWatches()).toThrow();
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    release();
    const tasks = [() => client?.dispose(), () => Promise.allSettled([request, rawCallback, closing, closeObserved]), () => host?.stop()];
    const outcomes = await Promise.allSettled(tasks.map(run => {
      try { return Promise.resolve(run()); } catch (error) { return Promise.reject(error); }
    }));
    const errors = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...errors], 'r249 cleanup failed; actual root retained');
    if (host && process.platform !== 'win32') {
      const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
      if (dirname(host.address.socketPath) !== expected) throw Error('owned_socket_directory_mismatch');
      rmdirSync(expected);
    }
    rmSync(root, { recursive: true });
  }
}, 15000);
