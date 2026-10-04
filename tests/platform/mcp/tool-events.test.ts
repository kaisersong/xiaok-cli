import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpClientConnection, callMcpToolWithSignal } from '../../../src/platform/mcp/transport.js';
import { startMcpToolSubscription } from '../../../src/platform/mcp/tool-events.js';

describe('MCP tool event subscriptions', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

  it('isolates real concurrent progress streams when one call is cancelled', async () => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'concurrent-progress', version: '1' });
      server.registerTool('work', { inputSchema: fromJsonSchema<{ base: number }>({ type: 'object', properties: { base: { type: 'number' } }, required: ['base'] }) }, async (args, ctx) => {
        const base = args.base;
        for (const progress of [base, base + 1]) {
          await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: ctx.mcpReq._meta!.progressToken!, progress } });
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        return { content: [{ type: 'text', text: 'done' }] };
      });
      return server;
    });
    const http = createServer(toNodeHandler(handler));
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const connection = await createMcpClientConnection('concurrent', { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` });
    cleanup.push(() => connection.close());
    const controller = new AbortController();
    const reason = new Error('cancel A');
    const a: number[] = []; const b: number[] = [];
    const first = callMcpToolWithSignal(connection.client, { name: 'work', arguments: { base: 1 } }, {
      signal: controller.signal, onprogress: value => { a.push(value.progress); controller.abort(reason); },
    }).catch(error => error);
    const second = callMcpToolWithSignal(connection.client, { name: 'work', arguments: { base: 100 } }, { onprogress: value => b.push(value.progress) });
    expect(await first).toBe(reason); await second;
    expect(a).toEqual([1]); expect(b).toEqual([100, 101]);
  });

  it('receives modern HTTP list changes and closes independently of the connection', async () => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'events', version: '1' });
      server.registerTool('ping', { inputSchema: {} }, async () => ({ content: [] }));
      return server;
    });
    const http = createServer(toNodeHandler(handler));
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const connection = await createMcpClientConnection('events', { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` });
    cleanup.push(() => connection.close());
    const changed = vi.fn();
    connection.client.setNotificationHandler('notifications/tools/list_changed', changed);
    const closed = vi.fn();
    const subscription = await startMcpToolSubscription(connection, { timeout: 2000, onClosed: closed });
    expect(subscription?.honoredFilter.toolsListChanged).toBe(true);
    await handler.notify.toolsChanged();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    await subscription!.close();
    expect(await subscription!.closed).toBe('local');
    expect(closed).not.toHaveBeenCalled();
    await handler.notify.toolsChanged();
    await new Promise(resolve => setImmediate(resolve));
    expect(changed).toHaveBeenCalledOnce();
    expect((await connection.client.listTools()).tools[0]?.name).toBe('ping');
  });

  it('never listens on legacy or unadvertised connections', async () => {
    const listen = vi.fn();
    const client = { getServerCapabilities: () => ({ tools: {} }), listen };
    expect(await startMcpToolSubscription({ client, protocolEra: 'legacy' } as any)).toBeUndefined();
    expect(await startMcpToolSubscription({ client, protocolEra: 'modern' } as any)).toBeUndefined();
    expect(listen).not.toHaveBeenCalled();
  });

  it('rejects refused filters, propagates ACK timeouts, and observes stream termination', async () => {
    const close = vi.fn();
    const client = { getServerCapabilities: () => ({ tools: { listChanged: true } }), listen: vi.fn().mockResolvedValue({ honoredFilter: {}, close }) };
    const connection = { client, protocolEra: 'modern' } as any;
    await expect(startMcpToolSubscription(connection, { timeout: 30 })).rejects.toThrow('toolsListChanged');
    expect(close).toHaveBeenCalledOnce();
    client.listen.mockRejectedValueOnce(new Error('ACK timeout'));
    await expect(startMcpToolSubscription(connection)).rejects.toThrow('ACK timeout');
    const onClosed = vi.fn();
    client.listen.mockResolvedValueOnce({ honoredFilter: { toolsListChanged: true }, close, closed: Promise.resolve('remote') });
    await startMcpToolSubscription(connection, { onClosed });
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith('remote'));
  });
});

describe('MCP progress lifetime', () => {
  it('forwards valid monotonic progress only while its call is active', async () => {
    let notify!: (progress: any) => void;
    let resolve!: (value: any) => void;
    const client = { callTool: vi.fn((_params, options) => { notify = options.onprogress; return new Promise<any>(yes => { resolve = yes; }); }) };
    const onprogress = vi.fn();
    const pending = callMcpToolWithSignal(client as any, { name: 'render' }, { onprogress, timeout: 100 });
    notify({ progress: 1, total: 3 });
    notify({ progress: 1 }); notify({ progress: 0 }); notify({ progress: NaN }); notify({ progress: 2, total: Infinity });
    notify({ progress: 2, total: 3 });
    resolve({ content: [] }); await pending;
    notify({ progress: 3, total: 3 });
    expect(onprogress.mock.calls.map(([value]) => value.progress)).toEqual([1, 2]);
  });

  it('ignores progress after per-call cancellation and preserves its reason', async () => {
    const controller = new AbortController();
    let notify!: (progress: any) => void;
    let reject!: (error: Error) => void;
    const client = { callTool: vi.fn((_params, options) => { notify = options.onprogress; return new Promise<any>((_yes, no) => { reject = no; }); }) };
    const onprogress = vi.fn();
    const pending = callMcpToolWithSignal(client as any, { name: 'render' }, { onprogress, signal: controller.signal });
    const reason = new Error('user cancelled'); controller.abort(reason);
    notify({ progress: 1 }); reject(new Error('SDK timeout'));
    await expect(pending).rejects.toBe(reason);
    expect(onprogress).not.toHaveBeenCalled();
  });
});
