import { createServer } from 'node:http';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { expect, it } from 'vitest';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createTaskSessionEndpointId } from '@modelcontextprotocol/ext-tasks/client';
import { ConversationActivityOwnerHost } from '../../../src/runtime/conversation-activity/owner-host.js';
import { ActivityOwnerMcp } from '../../../src/runtime/conversation-activity/owner-mcp.js';
import type { McpServerConfig } from '../../../src/platform/mcp/types.js';

it('PUBLIC BEFORE/POST: a completed real HTTP SDK factory failure owned by register does not poison a later successful register and close', async () => {
  const root = mkdtempSync(join(tmpdir(), 'r251-mcp-live-'));
  let denyFactory = true;
  let host: ConversationActivityOwnerHost | undefined, owner: ActivityOwnerMcp | undefined;
  let server: ReturnType<typeof createServer> | undefined, handler: ReturnType<typeof createMcpHandler> | undefined;
  let closing: Promise<void> | undefined, registration: Promise<void> | undefined;
  const routes: Promise<void>[] = [];
  let originalFailure: unknown; let failed = false;
  try {
    handler = createMcpHandler(() => {
      if (denyFactory) throw Error('r251-owned-real-public-factory-failure');
      return new Server({ name: 'r251-owned-real-public-server', version: '1.0.0' }, { capabilities: {} });
    });
    const route = toNodeHandler(handler);
    server = createServer((request, response) => { const work = route(request, response); routes.push(work); void work.catch(() => { response.statusCode = 500; response.end(); }); });
    await new Promise<void>((yes, no) => { server!.once('error', no); server!.listen(0, '127.0.0.1', () => { server!.off('error', no); yes(); }); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('own_http_port_missing');
    host = new ConversationActivityOwnerHost({ dataRoot: root, profileId: 'r251-own-profile', actorId: 'r251-own-user',
      getThread: () => null, canObserveWork: () => false, authorizeProducer: () => false });
    owner = new ActivityOwnerMcp({ root, store: host.store, service: host.service, actorId: 'r251-own-user' });
    const name = 'r251-owned-real-public-server';
    const config: McpServerConfig = { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`,
      protocol: { mode: 'modern', version: '2026-07-28' }, timeout: { startup: 5000 } };
    const endpointId = await createTaskSessionEndpointId('xiaok-mcp', { serverName: name, config });
    const first = owner.register({ endpointId, name, config }, 'r251-own-observer');
    const [failedFactory] = await Promise.allSettled([first]);
    expect(failedFactory.status).toBe('rejected');
    // Same original endpoint/config/caller, no rename/readmission or SDK mock.
    // Only this owned public protocol server is now available.
    denyFactory = false; registration = owner.register({ endpointId, name, config }, 'r251-own-observer'); await registration;
    closing = owner.close(); const [closed] = await Promise.allSettled([closing]); expect(closed.status).toBe('fulfilled');
    expect(owner.close()).toBe(closing);
  } catch (error) { failed = true; originalFailure = error; throw error; } finally {
    const steps = [() => owner?.close(), () => Promise.allSettled([registration, closing]), () => host?.stop(),
      () => handler?.close(), () => Promise.all(routes), () => new Promise<void>((yes, no) => {
        if (!server?.listening) { yes(); return; } server.close(error => error ? no(error) : yes());
      })];
    const outcomes = await Promise.allSettled(steps.map(run => { try { return Promise.resolve(run()); } catch (error) { return Promise.reject(error); } }));
    const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError([...(failed ? [originalFailure] : []), ...failures], 'r251 actual close failed; root retained');
    if (!host && failed) throw new AggregateError([originalFailure], 'host construction ownership unknown; root retained');
    if (host && process.platform !== 'win32') {
      const expected = join(tmpdir(), `xa-${process.getuid?.() ?? 'windows-user'}-${host.address.rootHash.slice(0, 12)}`);
      if (dirname(host.address.socketPath) !== expected) throw Error('own_socket_dir_mismatch'); rmdirSync(expected);
    }
    rmSync(root, { recursive: true });
  }
}, 15000);
