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

async function withActualClient(
  run: (client: ConversationActivityOwnerClient, service: ConversationActivityAttachedService,
    observeSocket: () => Socket, rememberCloseFailure: (error: unknown) => void) => Promise<void>,
  mcpRequest?: (method: string, params: Record<string, unknown>, clientId: string) => Promise<unknown>,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'activity-client-drain-')));
  const host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'local-observer', actorId: 'local-user',
    getThread: () => null, canObserveWork: () => false, authorizeProducer: () => false, mcpRequest });
  let client: ConversationActivityOwnerClient | undefined;
  let service: ConversationActivityAttachedService | undefined;
  let socket: Socket | undefined, socketClosed: Promise<void> | undefined;
  let original: { error: unknown } | undefined;
  const expectedCloseFailures = new Set<unknown>();
  try {
    await host.start();
    client = new ConversationActivityOwnerClient(root, 'user');
    service = new ConversationActivityAttachedService(client, 'local-user');
    const observeSocket = () => {
      if (!socket) {
        socket = (client as unknown as { socket: Socket }).socket;
        expect(socket).toBeDefined();
        socketClosed = new Promise<void>(resolve => socket!.once('close', resolve));
      }
      return socket;
    };
    await run(client, service, observeSocket, error => { expectedCloseFailures.add(error); });
  } catch (error) { original = { error }; }
  finally {
    const failures: unknown[] = [];
    // Cases explicitly observe their expected close rejection. Physical cleanup
    // still requires the actual socket event and the original host stop.
    try {
      const [result] = await Promise.allSettled([client?.close()]);
      if (result.status === 'rejected' && !expectedCloseFailures.has(result.reason)) failures.push(result.reason);
    } catch (error) { failures.push(error); }
    try { await socketClosed; } catch (error) { failures.push(error); }
    try { await host.stop(); } catch (error) { failures.push(error); }
    if (!failures.length) {
      if (process.platform !== 'win32') {
        const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
        expect(dirname(host.address.socketPath)).toBe(expected);
        rmdirSync(expected);
      }
      rmSync(root, { recursive: true });
    }
    if (failures.length) throw new AggregateError([...(original ? [original.error] : []), ...failures],
      'actual client cleanup unconfirmed; root retained', { cause: original?.error });
  }
  if (original) throw original.error;
}

it('includes a direct real MCP request in the service close cut and refuses new RPCs', async () => {
  const release = deferred<void>();
  let calls = 0;
  await withActualClient(async (client, service, observeSocket) => {
    await client.connect(); observeSocket();
    const request = client.request('mcpInputs', { watchId: 'watched' });
    const outcome = Promise.allSettled([request]);
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 3000 });
    const closing = service.close(), closed = Promise.allSettled([closing]);
    let terminal = false;
    void closing.then(() => { terminal = true; }, () => { terminal = true; });
    try {
      await turn(); expect(terminal).toBe(false);
      await expect(client.request('mcpInputs', { watchId: 'late' })).rejects.toThrow('activity_client_disposed');
      await expect(client.connect()).rejects.toThrow('activity_client_disposed');
      expect(calls).toBe(1);
    } finally { release.resolve(); }
    expect(await outcome).toEqual([{ status: 'fulfilled', value: ['original-result'] }]);
    expect(await closed).toEqual([{ status: 'fulfilled', value: undefined }]);
  }, async () => { calls++; await release.promise; return ['original-result']; });
});

it('owns a request before authentication when the pending wire Map is still empty', async () => {
  await withActualClient(async (client, _service, observeSocket) => {
    const request = client.request<{ ownerEpoch: string }>('status');
    const socket = observeSocket();
    expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
    const closing = client.close();
    const outcome = await Promise.allSettled([request, closing]);
    expect(outcome[0]).toMatchObject({ status: 'fulfilled', value: { ownerEpoch: expect.any(String) } });
    expect(outcome[1]).toEqual({ status: 'fulfilled', value: undefined });
    expect(socket.closed).toBe(true);
    expect(client.close()).toBe(closing);
  });
});

it.each([new Error('original-write-error'), undefined])('preserves the original write rejection including undefined: %s', async primary => {
  await withActualClient(async (client, _service, observeSocket, rememberCloseFailure) => {
    await client.connect(); const socket = observeSocket();
    const write = vi.spyOn(socket, 'write').mockImplementationOnce(() => { throw primary; });
    try {
      const request = client.request('status');
      const closing = client.close();
      const [rpc, close] = await Promise.allSettled([request, closing]);
      expect(rpc).toEqual({ status: 'rejected', reason: primary });
      expect(close.status).toBe('rejected');
      if (close.status !== 'rejected') throw new Error('expected_close_failure');
      expect(close.reason).toBeInstanceOf(AggregateError);
      expect(close.reason.errors).toContain(primary);
      rememberCloseFailure(close.reason);
      expect(client.close()).toBe(closing);
      expect(socket.closed).toBe(true);
    } finally { write.mockRestore(); }
  });
});

it('registers the request before an actual write reenters close', async () => {
  await withActualClient(async (client, _service, observeSocket) => {
    await client.connect(); const socket = observeSocket(), originalWrite = socket.write;
    let closing: Promise<void> | undefined;
    const write = vi.spyOn(socket, 'write').mockImplementationOnce(function (...args) {
      closing = client.close();
      return Reflect.apply(originalWrite, this, args);
    });
    try {
      const request = client.request<{ ownerEpoch: string }>('status');
      expect(await request).toMatchObject({ ownerEpoch: expect.any(String) });
      expect(closing).toBeDefined(); await closing;
      expect(socket.closed).toBe(true);
    } finally { write.mockRestore(); }
  });
});

it('does not acknowledge a failed destroy as socket closed or wash its undefined first cause', async () => {
  await withActualClient(async (client, _service, observeSocket, rememberCloseFailure) => {
    await client.connect(); const socket = observeSocket(), originalDestroy = socket.destroy;
    let observed = false; socket.once('close', () => { observed = true; });
    const destroy = vi.spyOn(socket, 'destroy').mockImplementationOnce(() => { throw undefined; });
    let closing: Promise<void> | undefined;
    try {
      closing = client.close();
      const [result] = await Promise.allSettled([closing]);
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('expected_destroy_failure');
      expect(result.reason.errors).toContain(undefined);
      rememberCloseFailure(result.reason);
      expect(observed).toBe(false);
      expect(client.close()).toBe(closing);
    } finally {
      destroy.mockRestore();
      Reflect.apply(originalDestroy, socket, []);
      await turn();
    }
    // An eventual actual close cannot rewrite the memoized failure to success.
    expect(client.close()).toBe(closing);
    expect((await Promise.allSettled([client.close()]))[0].status).toBe('rejected');
  });
});

it('keeps the original service work cut when dispose precedes close and its RPC tail rejects', async () => {
  await withActualClient(async (client, service, observeSocket) => {
    await client.connect(); observeSocket();
    const entered = deferred<void>(), release = deferred<void>(), originalRequest = client.request;
    // Keep the actual RPC result/rejection unchanged. This test-only finally
    // tail exercises Service.getWork's existing caller inventory, not Native authority.
    const request = vi.spyOn(client, 'request').mockImplementation(function (method, params) {
      return Reflect.apply(originalRequest, this, [method, params]).finally(async () => {
        if (method === 'work') { entered.resolve(); await release.promise; }
      });
    });
    let work: Promise<unknown> | undefined;
    try {
      work = service.getWork('absent-watch', { requestSource: 'user', actorId: 'local-user' });
      const outcome = Promise.allSettled([work]);
      await entered.promise;
      await turn();
      service.dispose();
      release.resolve();
      const [actual] = await outcome;
      expect(actual.status).toBe('rejected');
      if (actual.status !== 'rejected') throw new Error('expected_original_missing_watch_rejection');
      await turn();
      const closing = service.close();
      const [result] = await Promise.allSettled([closing]);
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('expected_original_service_tail_failure');
      expect(result.reason.errors).toContain(actual.reason);
      expect(service.close()).toBe(closing);
    } finally {
      release.resolve(); await Promise.allSettled([work]); request.mockRestore();
    }
  });
});

it('waits for an earlier actual socket after reconnect, even with no pending wire request', async () => {
  await withActualClient(async (client, _service, observeSocket) => {
    await client.connect(); const previous = observeSocket(), originalDestroy = previous.destroy;
    const heldDestroy = vi.spyOn(previous, 'destroy').mockImplementation(() => previous);
    let closing: Promise<void> | undefined;
    try {
      previous.emit('error', new Error('controlled old connection loss'));
      expect(await client.request('status')).toMatchObject({ ownerEpoch: expect.any(String) });
      const current = (client as unknown as { socket: Socket }).socket;
      expect(current).not.toBe(previous);
      expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
      closing = client.close();
      let terminal = false;
      void closing.then(() => { terminal = true; }, () => { terminal = true; });
      await turn();
      expect(terminal).toBe(false);
      expect(previous.closed).toBe(false);
    } finally {
      heldDestroy.mockRestore();
      Reflect.apply(originalDestroy, previous, []);
    }
    await closing;
    expect(previous.closed).toBe(true);
  });
});
