import { createServer } from 'node:http';
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { expect, it, vi } from 'vitest';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { createTaskSessionEndpointId } from '@modelcontextprotocol/ext-tasks/client';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { ActivityOwnerMcp } from '../../../src/runtime/conversation-activity/owner-mcp.js';
import type { McpServerConfig } from '../../../src/platform/mcp/types.js';
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
function hostOptions(root: string) {
  // Plain fixture identity data, no producer/task authority: all authority checks deny.
  return { dataRoot: root, profileId: 'r237-owned-observer', actorId: 'r237-local-observer',
    getThread: () => null, canObserveWork: () => false, authorizeProducer: () => false };
}
function removeOwnedRoot(root: string, host: ConversationActivityOwnerHost | undefined): void {
  // The production address creates a separate hash-bound directory under tmpdir.
  // Only remove that exact empty directory after successful actual host.stop.
  if (host && process.platform !== 'win32') {
    const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
    if (dirname(host.address.socketPath) !== expected) throw Error('owned_socket_directory_mismatch');
    rmdirSync(expected);
  }
  rmSync(root, { recursive: true });
}
async function attemptAll(steps: Array<() => void | Promise<unknown>>): Promise<unknown[]> {
  const outcomes = await Promise.allSettled(steps.map(step => {
    try { return Promise.resolve(step()); } catch (error) { return Promise.reject(error); }
  }));
  return outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
}
const checkpoint = () => new Promise<void>(resolve => setTimeout(resolve, 100));

it('PUBLIC BEFORE/POST: host.stop cannot finish while an actually admitted authenticated request is pending', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r237-host-'));
  const gate = deferred<void>(); let entered = false, backendFinished = false, stopped = false;
  let host: ConversationActivityOwnerHost | undefined, client: ConversationActivityOwnerClient | undefined;
  let request: Promise<unknown> | undefined, stopping: Promise<void> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    // Existing public delegate contract. This callback is a controlled external input,
    // not an SDK double, fake native factory, authority producer or quiescent ACK.
    host = new ConversationActivityOwnerHost({ ...hostOptions(root), async mcpRequest(method) {
      expect(method).toBe('mcpInputs'); entered = true;
      await gate.promise; backendFinished = true; return null;
    } });
    client = new ConversationActivityOwnerClient(root, 'user');
    await host.start(); await client.request('status');
    request = client.request('mcpInputs', { watchId: 'owned-local-lifecycle-control' });
    const requestObserved = Promise.allSettled([request]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    stopping = host.stop(); const observed = stopping.then(() => { stopped = true; });
    const stopObserved = Promise.allSettled([observed]);
    await checkpoint();
    expect(backendFinished).toBe(false); expect(stopped).toBe(false);
    gate.resolve(); await observed; await requestObserved; await stopObserved;
    expect(backendFinished).toBe(true); expect(stopped).toBe(true);
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.resolve();
    // Socket-close rejection of the admitted RPC is expected; backend completion is
    // independently owned by real host.stop, never mistaken for that RPC result.
    const failures = await attemptAll([() => client?.dispose(),
      () => Promise.allSettled([request, stopping]), () => host?.stop()]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'owned host cleanup failed; root retained');
    removeOwnedRoot(root, host);
  }
}, 15000);

it('PUBLIC BEFORE/POST: ActivityOwnerMcp.close awaits real late HTTP Client creation and actual Client.close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r237-mcp-http-'));
  const gate = deferred<void>(); let entered = false, closed = false, requests = 0;
  const routeErrors: unknown[] = [], routeWork: Promise<void>[] = [];
  let host: ConversationActivityOwnerHost | undefined, owner: ActivityOwnerMcp | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let handler: ReturnType<typeof createMcpHandler> | undefined;
  let registration: Promise<void> | undefined, closing: Promise<void> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    handler = createMcpHandler(() => new Server({ name: 'r237-owned-public-mcp', version: '1.0.0' }, { capabilities: {} }));
    const route = toNodeHandler(handler);
    server = createServer((request, response) => {
      entered = true; requests++;
      const work = gate.promise.then(() => route(request, response)).then(() => undefined);
      routeWork.push(work);
      void work.catch(error => { routeErrors.push(error); response.statusCode = 500; response.end(); });
    });
    host = new ConversationActivityOwnerHost(hostOptions(root));
    owner = new ActivityOwnerMcp({ root, store: host.store, service: host.service, actorId: 'r237-local-observer' });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject); server!.listen(0, '127.0.0.1', () => { server!.off('error', reject); resolve(); });
    });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('owned_http_port_missing');
    const config: McpServerConfig = { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`,
      protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000 } };
    const name = 'r237-owned-public-mcp';
    const endpointId = await createTaskSessionEndpointId('xiaok-mcp', { serverName: name, config });
    registration = owner.register({ endpointId, name, config }, 'owned-observer-client');
    const registrationObserved = Promise.allSettled([registration]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    closing = owner.close(); const observed = closing.then(() => { closed = true; });
    const closeObserved = Promise.allSettled([observed]);
    await checkpoint(); expect(closed).toBe(false);
    gate.resolve(); await observed; await registrationObserved; await closeObserved;
    expect(closed).toBe(true); expect(routeErrors).toEqual([]);
    // Existing public register: closing forbids both disk mutation and new SDK start.
    const countBefore = requests;
    await expect(owner.register({ endpointId, name, config }, 'owned-observer-client')).rejects.toThrow('activity_mcp_closing');
    expect(requests).toBe(countBefore);
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.resolve();
    const failures = await attemptAll([() => owner?.close(), () => Promise.allSettled([registration, closing]),
      () => host?.stop(), () => handler?.close(), () => new Promise<void>((resolve, reject) => {
        if (!server?.listening) { resolve(); return; }
        server.close(error => error ? reject(error) : resolve());
      }), () => Promise.all(routeWork)]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'owned public MCP cleanup failed; root retained');
    removeOwnedRoot(root, host);
  }
}, 15000);

it('POST contract: real host stop memoizes and waits the actual disconnect callback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r237-disconnect-'));
  const gate = deferred<void>(); let entered = false, done = false;
  let host: ConversationActivityOwnerHost | undefined, client: ConversationActivityOwnerClient | undefined;
  let closing: Promise<void> | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    host = new ConversationActivityOwnerHost({ ...hostOptions(root), async disconnected() { entered = true; await gate.promise; } });
    client = new ConversationActivityOwnerClient(root, 'user'); await host.start(); await client.request('status');
    closing = host.stop(); const observed = closing.then(() => { done = true; });
    const settled = Promise.allSettled([observed]);
    expect(host.stop()).toBe(closing);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    await checkpoint(); expect(done).toBe(false);
    gate.resolve(); await observed; await settled; expect(done).toBe(true);
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.resolve();
    const failures = await attemptAll([() => client?.dispose(), () => host?.stop()]);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'owned disconnect cleanup failed; root retained');
    removeOwnedRoot(root, host);
  }
}, 15000);


it('POST contract: real public SDK connect rejection remains the same failed connection inside memoized owner.close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r237-mcp-reject-'));
  const gate = deferred<void>(); let entered = false;
  let host: ConversationActivityOwnerHost | undefined, owner: ActivityOwnerMcp | undefined;
  let server: ReturnType<typeof createServer> | undefined, handler: ReturnType<typeof createMcpHandler> | undefined;
  let registration: Promise<void> | undefined, closing: Promise<void> | undefined;
  let expectedCloseFailure: unknown, originalFailure: unknown; let failed = false;
  const routeWork: Promise<void>[] = [];
  try {
    // The real public handler catches a real server-factory exception; no hand-written
    // MCP messages, Client stand-in, native authority or fake rejected SDK are used.
    handler = createMcpHandler(() => { throw Error('r237-owned-server-factory-rejected'); });
    const route = toNodeHandler(handler);
    server = createServer((request, response) => {
      entered = true; const work = gate.promise.then(() => route(request, response)).then(() => undefined);
      routeWork.push(work); void work.catch(() => { response.statusCode = 500; response.end(); });
    });
    host = new ConversationActivityOwnerHost(hostOptions(root));
    owner = new ActivityOwnerMcp({ root, store: host.store, service: host.service, actorId: 'r237-local-observer' });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject); server!.listen(0, '127.0.0.1', () => { server!.off('error', reject); resolve(); });
    });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('owned_http_port_missing');
    const name = 'r237-owned-rejection';
    const config: McpServerConfig = { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`,
      protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000 } };
    const endpointId = await createTaskSessionEndpointId('xiaok-mcp', { serverName: name, config });
    registration = owner.register({ endpointId, name, config }, 'owned-observer-client');
    const registered = Promise.allSettled([registration]);
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
    closing = owner.close(); const closed = Promise.allSettled([closing]);
    expect(owner.close()).toBe(closing); gate.resolve();
    const [registrationResult] = await registered, [closeResult] = await closed;
    expect(registrationResult.status).toBe('rejected'); expect(closeResult.status).toBe('rejected');
    if (registrationResult.status !== 'rejected' || closeResult.status !== 'rejected') throw Error('actual_sdk_rejection_missing');
    expectedCloseFailure = closeResult.reason;
    expect(expectedCloseFailure).toBeInstanceOf(AggregateError);
    if (!(expectedCloseFailure instanceof AggregateError)) throw Error('actual_owner_rejection_missing');
    expect(expectedCloseFailure.errors).toContain(registrationResult.reason);
    expect(owner.close()).toBe(closing);
    // A rejected drain is NOT a successful root cleanup certificate.
    writeFileSync(join(root, 'expected-close-rejection.json'), JSON.stringify({ expected: true, cleanupClaimed: false }), { mode: 0o600 });
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    gate.resolve();
    const failures = await attemptAll([() => owner?.close(), () => Promise.allSettled([registration, closing]),
      () => host?.stop(), () => handler?.close(), () => Promise.all(routeWork),
      () => new Promise<void>((resolve, reject) => {
        if (!server?.listening) { resolve(); return; } server.close(error => error ? reject(error) : resolve());
      })]);
    const unexpected = failures.filter(error => error !== expectedCloseFailure);
    // Always retain this diagnostic root on the intentional close failure; do not
    // manufacture a quiescent ACK, force-close live resources or remove evidence.
    if (unexpected.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...unexpected], 'owned rejected MCP cleanup incomplete; root retained');
  }
}, 15000);
