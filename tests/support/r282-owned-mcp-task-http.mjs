import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { Server, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { CreateTaskResultV2Schema, GetTaskResultV2Schema, CallToolResultV2Schema } from '@modelcontextprotocol/ext-tasks/core/v2';
const root = process.env.R282_ROOT, nonce = process.env.R282_NONCE;
if (!root || !nonce || !process.send) throw Error('owned_node_ipc_required');
const tasks = new Map(); let gets = 0, created = 0, toolLists = 0;
const handler = createMcpHandler(() => {
  const server = new Server({ name: 'r282-owned-mcp-task-server', version: '1.0.0' }, { capabilities: { tools: {}, extensions: { 'io.modelcontextprotocol/tasks': {} } } });
  server.setRequestHandler('tools/list', () => { toolLists++; return { tools: [{ name: 'r282-owned-task', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }; });
  server.setRequestHandler('tools/call', { params: z.object({ name: z.literal('r282-owned-task'), arguments: z.record(z.string(), z.unknown()).optional() }).passthrough(), result: CreateTaskResultV2Schema }, async () => {
    // This official public Server owns and creates WIRE DATA. The genuine Client
    // parses it and creates its SDK execution/ref; no test consumer forges brands.
    const taskId = randomUUID(), time = new Date().toISOString(); created++;
    const task = { taskId, status: 'working', createdAt: time, lastUpdatedAt: time, ttlMs: 60000, pollIntervalMs: 1000 };
    tasks.set(taskId, task); return CreateTaskResultV2Schema.parse({ ...task, resultType: 'task' });
  });
  server.setRequestHandler('tasks/get', { params: z.object({ taskId: z.string() }), result: GetTaskResultV2Schema }, async ({ taskId }) => {
    gets++; const task = tasks.get(taskId); if (!task) throw Error('unknown_owned_task'); return GetTaskResultV2Schema.parse({ ...task, resultType: 'complete' });
  });
  return server;
});
const route = toNodeHandler(handler), routes = new Set();
const http = createServer((request, response) => {
  const work = route(request, response); routes.add(work);
  void work.then(() => routes.delete(work), () => routes.delete(work));
});
process.on('message', message => {
  if (!message || message.nonce !== nonce || typeof message.id !== 'string') return;
  const reply = data => process.send?.({ type: 'reply', id: message.id, data });
  const fail = error => process.send?.({ type: 'reply', id: message.id, error: error instanceof Error ? error.message : 'owned_command_failed' });
  if (message.command === 'stats') { reply({ gets, created, toolLists, active: [...tasks.values()].filter(task => task.status === 'working').length }); return; }
  if (message.command === 'finish') {
    for (const [id, task] of tasks) if (task.status === 'working') tasks.set(id, { ...task, status: 'completed', lastUpdatedAt: new Date().toISOString(),
      result: CallToolResultV2Schema.parse({ resultType: 'complete', content: [{ type: 'text', text: `own task completed:${id}` }] }) });
    reply({ finished: true }); return;
  }
  if (message.command === 'shutdown') {
    if ([...tasks.values()].some(task => task.status === 'working')) { fail(Error('own_tasks_still_active')); return; }
    void (async () => {
      await handler.close(); await Promise.allSettled([...routes]);
      await new Promise((yes, no) => http.close(error => error ? no(error) : yes()));
      writeFileSync(join(root, 'server-closed.json'), JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600, flag: 'wx' });
      process.send?.({ type: 'reply', id: message.id, data: { closed: true } }, error => { if (error) process.exitCode = 1; if (process.connected) process.disconnect(); });
    })().catch(fail);
  }
});
http.listen(0, '127.0.0.1', () => { const address = http.address(); if (!address || typeof address === 'string') throw Error('own_port_missing'); process.send({ type: 'ready', port: address.port, pid: process.pid, nonce }); });
process.once('exit', code => writeFileSync(join(root, 'exited.json'), JSON.stringify({ pid: process.pid, nonce, code }), { mode: 0o600, flag: 'wx' }));
