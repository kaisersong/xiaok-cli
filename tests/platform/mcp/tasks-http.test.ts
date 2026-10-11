import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { CreateTaskResultV2Schema, DetailedTaskV2Schema, GetTaskRequestV2Schema, TaskStatusNotificationV2Schema, hasTaskClientCapabilityV2 } from '@modelcontextprotocol/ext-tasks/core/v2';
import { createMcpClientConnection } from '../../../src/platform/mcp/transport.js';
import { callMcpToolWithTasks } from '../../../src/platform/mcp/tasks.js';

describe('Tasks over authenticated real Streamable HTTP', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
  it('preserves authentication on lifecycle requests and delivers task state on an independently acknowledged stream', async () => {
    const streams = new Map<string | number, ServerResponse>();
    let task: ReturnType<typeof DetailedTaskV2Schema.parse> | undefined, calls = 0, reads = 0;
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer fixture') { response.writeHead(401).end(); return; }
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }).end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString());
      const reply = (result: unknown) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })); };
      if (message.method === 'server/discover') reply({ resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {}, extensions: { 'io.modelcontextprotocol/tasks': {} } }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'task-http', version: '1' } } });
      else if (message.method === 'tools/list') reply({ resultType: 'complete', cacheScope: 'private', ttlMs: 1000, tools: [{ name: 'work', inputSchema: { type: 'object' } }] });
      else if (message.method === 'tools/call') {
        if (!hasTaskClientCapabilityV2(message.params)) throw new Error('missing negotiated task capability');
        calls++; const now = new Date().toISOString();
        task = DetailedTaskV2Schema.parse({ taskId: 'http-task', status: 'working', createdAt: now, lastUpdatedAt: now, ttlMs: 60_000, pollIntervalMs: 10_000 });
        reply(CreateTaskResultV2Schema.parse({ ...task, resultType: 'task' }));
        setTimeout(() => {
          task = DetailedTaskV2Schema.parse({ ...task!, status: 'completed', lastUpdatedAt: new Date().toISOString(), result: { resultType: 'complete', content: [{ type: 'text', text: 'HTTP result' }] } });
          for (const [id, stream] of streams) stream.write(`event: message\ndata: ${JSON.stringify(TaskStatusNotificationV2Schema.parse({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...task, _meta: { 'io.modelcontextprotocol/subscriptionId': id } } }))}\n\n`);
        }, 200);
      } else if (message.method === 'tasks/get') {
        GetTaskRequestV2Schema.parse(message); reads++; reply({ ...task, resultType: 'complete' });
      } else if (message.method === 'subscriptions/listen') {
        response.writeHead(200, { 'content-type': 'text/event-stream' }); streams.set(message.id, response);
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { notifications: { taskIds: ['http-task'] }, _meta: { 'io.modelcontextprotocol/subscriptionId': message.id } } })}\n\n`);
        response.on('close', () => streams.delete(message.id));
      } else if (message.method === 'notifications/cancelled') { streams.get(message.params.requestId)?.end(); streams.delete(message.params.requestId); response.writeHead(202).end(); }
      else { response.writeHead(202).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const connection = await createMcpClientConnection('http-task-test', { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { authorization: 'Bearer fixture' } });
    cleanup.push(() => connection.close());
    const started = Date.now();
    const result = await callMcpToolWithTasks(connection, { name: 'work', arguments: {} }, { timeout: 2000 });
    expect(result.content).toEqual([{ type: 'text', text: 'HTTP result' }]);
    expect(calls).toBe(1); expect(reads).toBeLessThan(4); expect(Date.now() - started).toBeLessThan(2500);
  });
});
