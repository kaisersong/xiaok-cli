import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { createMcpHandler, ProtocolError, Server } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as transport from '../../../src/platform/mcp/transport.js';

type Invocation = (client: Pick<Client, 'callTool'>, params: Parameters<Client['callTool']>[0], options?: Parameters<Client['callTool']>[1]) => ReturnType<Client['callTool']>;
function invoke(): Invocation {
  // New, approved production export; deliberately no test-side cancellation implementation.
  const helper = (transport as unknown as { callMcpToolWithSignal?: Invocation }).callMcpToolWithSignal;
  expect(helper, 'R1 §3.2 fixed production SDK leaf adapter must exist').toBeTypeOf('function');
  return helper!;
}
function barrier() { let release!: () => void; return { wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
const schema = { name: 'probe', description: 'controlled MCP cancellation fixture', inputSchema: { type: 'object' as const },
  outputSchema: { type: 'object' as const, properties: { value: { type: 'string' } }, required: ['value'] } };

describe('M2/M11 per-call cancellation at actual MCP SDK v2 transport', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

  async function fixture(era: 'modern' | 'legacy') {
    const entered = barrier(); const held = barrier(); const effect = barrier();
    let calls = 0; let effects = 0; let remoteSignal: AbortSignal | undefined; let cancellationNotifications = 0;
    async function call(input: Record<string, unknown> = {}, signal?: AbortSignal) {
      calls++;
      if (input.value === 'A') { remoteSignal = signal; entered.release(); await held.wait; effects++; effect.release(); }
      return { content: [{ type: 'text' as const, text: String(input.value ?? '') }], structuredContent: { value: input.invalid ? 1 : String(input.value ?? '') } };
    }
    const modern = createMcpHandler(() => {
      const server = new Server({ name: 'cancellation-fixture', version: '1' }, { capabilities: { tools: {} } });
      server.setRequestHandler('tools/list', async () => ({ tools: [schema] }));
      server.setRequestHandler('tools/call', (request, context) => call(request.params.arguments, context.mcpReq.signal));
      return server;
    });
    const server = era === 'modern' ? createServer(toNodeHandler(modern)) : createServer(async (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = ''; for await (const chunk of req) body += chunk;
      const message = JSON.parse(body) as { id?: number | string; method: string; params?: { arguments?: Record<string, unknown> } };
      res.setHeader('content-type', 'application/json');
      if (message.method === 'notifications/cancelled') cancellationNotifications++;
      if (message.id === undefined) { res.statusCode = 202; res.end(); return; }
      let result: unknown;
      if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'legacy-cancel', version: '1' } };
      else if (message.method === 'tools/list') result = { tools: [schema] };
      else if (message.method === 'tools/call') result = await call(message.params?.arguments);
      else { res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })); return; }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { held.release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture not listening');
    const connection = await transport.createMcpClientConnection('cancel-fixture', { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`,
      protocol: era === 'modern' ? { mode: 'modern', version: '2026-07-28' } : { mode: 'legacy' },
    });
    cleanup.push(async () => { held.release(); await connection.close(); });
    await connection.client.listTools();
    return { connection, entered, held, effect, counts: () => ({ calls, effects, remoteSignal, cancellationNotifications }) };
  }

  it.each(['modern', 'legacy'] as const)('%s preabort preserves exact ordinary Error reason and sends zero tools/call', async era => {
    const f = await fixture(era); const controller = new AbortController(); const reason = new Error('caller stopped'); controller.abort(reason);
    expect(f.connection.protocolEra).toBe(era);
    // Establish the actual installed SDK baseline before checking the new adapter.
    const rawError = await f.connection.client.callTool({ name: 'probe', arguments: { value: 'pre' } }, { signal: controller.signal }).catch(error => error);
    expect(rawError).toMatchObject({ name: 'SdkError', code: 'REQUEST_TIMEOUT' }); expect(f.counts().calls).toBe(0);
    await expect(invoke()(f.connection.client, { name: 'probe', arguments: { value: 'pre' } }, { signal: controller.signal })).rejects.toBe(reason);
    expect(f.counts().calls).toBe(0);
  });

  it.each(['modern', 'legacy'] as const)('%s cancels A locally without closing shared B or pretending ignored remote effect has stopped', async era => {
    const f = await fixture(era); const call = invoke(); const close = vi.spyOn(f.connection.client, 'close');
    const controller = new AbortController(); const reason = new Error('cancel A');
    const a = call(f.connection.client, { name: 'probe', arguments: { value: 'A' } }, { signal: controller.signal, timeout: 1000 }).then(value => ({ value }), error => ({ error }));
    try {
      await f.entered.wait; controller.abort(reason);
      expect(await a).toEqual({ error: reason });
      await expect(call(f.connection.client, { name: 'probe', arguments: { value: 'B' } }, { timeout: 1000 })).resolves.toMatchObject({ content: [{ text: 'B' }] });
      expect(close).not.toHaveBeenCalled(); expect(f.counts().effects).toBe(0);
      await vi.waitFor(() => era === 'modern' ? expect(f.counts().remoteSignal?.aborted).toBe(true) : expect(f.counts().cancellationNotifications).toBeGreaterThan(0));
      f.held.release(); await f.effect.wait; expect(f.counts().effects).toBe(1);
    } finally { f.held.release(); await a; }
  });

  it('M2 leaves an SDK timeout unchanged when the caller signal was never aborted', async () => {
    const f = await fixture('modern'); const controller = new AbortController(); const call = invoke();
    const outcome = call(f.connection.client, { name: 'probe', arguments: { value: 'A' } }, { signal: controller.signal, timeout: 35 }).catch(error => error);
    try { await f.entered.wait; expect(await outcome).toMatchObject({ name: 'SdkError', code: 'REQUEST_TIMEOUT' }); expect(controller.signal.aborted).toBe(false); }
    finally { f.held.release(); await outcome; }
  });

  it('M11 uses actual default SDK cache/output validation and forwards original options without toolDefinition or a retry wrapper', async () => {
    const f = await fixture('modern'); const call = invoke(); const receiver = vi.spyOn(f.connection.client, 'callTool');
    const options = { signal: new AbortController().signal, timeout: 1000, resetTimeoutOnProgress: true };
    await expect(call(f.connection.client, { name: 'probe', arguments: { value: 'valid' } }, options)).resolves.toMatchObject({ structuredContent: { value: 'valid' } });
    expect(receiver).toHaveBeenLastCalledWith({ name: 'probe', arguments: { value: 'valid' } }, options);
    expect(receiver.mock.calls[0]?.[1]).not.toHaveProperty('toolDefinition');
    await expect(call(f.connection.client, { name: 'probe', arguments: { invalid: true } }, options)).rejects.toThrow();
    expect(f.counts().calls).toBe(2);
  });

  it('M6/M11 retains actual modern Mcp-Param mirroring and the SDK-owned header-mismatch catalog refresh/retry', async () => {
    let updated = false; let calls = 0; let catalogs = 0; const headers: Array<{ old?: string | string[]; next?: string | string[] }> = [];
    const handler = createMcpHandler(() => {
      const server = new Server({ name: 'header-refresh-fixture', version: '1' }, { capabilities: { tools: {} } });
      server.setRequestHandler('tools/list', async () => { catalogs++; return { tools: [{ ...schema, inputSchema: { type: 'object' as const, properties: { value: { type: 'string', 'x-mcp-header': updated ? 'Next' : 'Old' } } } }] }; });
      server.setRequestHandler('tools/call', async () => {
        calls++; if (!updated) { updated = true; throw new ProtocolError(-32020, 'controlled catalog header mismatch'); }
        return { content: [{ type: 'text', text: 'ok' }], structuredContent: { value: 'ok' } };
      });
      return server;
    });
    const nodeHandler = toNodeHandler(handler);
    const http = createServer((req, res) => {
      if (req.headers['mcp-param-old'] || req.headers['mcp-param-next']) headers.push({ old: req.headers['mcp-param-old'], next: req.headers['mcp-param-next'] });
      return nodeHandler(req, res);
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('fixture not listening');
    const connection = await transport.createMcpClientConnection('header-refresh', { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, protocol: { mode: 'modern', version: '2026-07-28' } }); cleanup.push(() => connection.close());
    await connection.client.listTools();
    // Verify fixture against unwrapped installed SDK first, so the missing-helper red cannot hide a bogus wire expectation.
    await connection.client.callTool({ name: 'probe', arguments: { value: 'alpha' } }, { timeout: 1000 });
    expect(calls).toBe(2); expect(catalogs).toBeGreaterThanOrEqual(2);
    expect(headers).toEqual([{ old: 'alpha', next: undefined }, { old: undefined, next: 'alpha' }]);
    updated = false; calls = 0; catalogs = 0; headers.splice(0);
    await connection.client.listTools(undefined, { cacheMode: 'refresh' });
    const receiver = vi.spyOn(connection.client, 'callTool');
    await invoke()(connection.client, { name: 'probe', arguments: { value: 'alpha' } }, { timeout: 1000, signal: new AbortController().signal });
    expect(receiver).toHaveBeenCalledTimes(1); expect(calls).toBe(2); expect(catalogs).toBeGreaterThanOrEqual(2);
    expect(headers).toEqual([{ old: 'alpha', next: undefined }, { old: undefined, next: 'alpha' }]);
  });

  it.each(['success', 'failure'] as const)('M3 rejects original reason for late %s at the adapter continuation', async ending => {
    const call = invoke(); const entered = barrier(); const held = barrier(); const controller = new AbortController(); const reason = 'caller string reason';
    const client = { async callTool() { entered.release(); await held.wait; if (ending === 'failure') throw new Error('remote failed'); return { content: [{ type: 'text', text: 'late' }] }; } } as Pick<Client, 'callTool'>;
    const outcome = call(client, { name: 'probe' }, { signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    try { await entered.wait; controller.abort(reason); held.release(); expect(await outcome).toEqual({ error: reason }); }
    finally { held.release(); await outcome; }
  });

  it('M11 does not race a non-settling backend into fake local completion', async () => {
    const call = invoke(); const entered = barrier(); const held = barrier(); const controller = new AbortController(); const reason = new Error('caller cancelled');
    const client = { async callTool() { entered.release(); await held.wait; return { content: [] }; } } as Pick<Client, 'callTool'>;
    let settled = false;
    const outcome = call(client, { name: 'probe' }, { signal: controller.signal }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    try { await entered.wait; controller.abort(reason); await new Promise(resolve => setTimeout(resolve, 25)); expect(settled).toBe(false); }
    finally { held.release(); await outcome; }
  });
});
