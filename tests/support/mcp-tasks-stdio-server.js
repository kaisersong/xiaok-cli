import { createInterface } from 'node:readline';
import { CreateTaskResultV2Schema, DetailedTaskV2Schema, GetTaskRequestV2Schema, CancelTaskRequestV2Schema, hasTaskClientCapabilityV2 } from '@modelcontextprotocol/ext-tasks/core/v2';

const tasks = new Map(), subscriptions = new Map();
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const result = (request, value) => send({ jsonrpc: '2.0', id: request.id, result: value });
let count = 0, updates = 0, cancels = 0, listens = 0;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === 'server/discover') result(request, { resultType: 'complete', supportedVersions: ['2026-07-28'],
    capabilities: { tools: {}, extensions: { 'io.modelcontextprotocol/tasks': {} } },
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'task-fixture', version: '1' } } });
  else if (request.method === 'tools/list') result(request, { resultType: 'complete', cacheScope: 'private', ttlMs: 60_000, tools: [{ name: 'work', inputSchema: { type: 'object' } }] });
  else if (request.method === 'tools/call' && request.params.name === 'stats') result(request, { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify({ calls: count, updates, cancels, ...(process.env.XIAOK_TEST_STREAM_DROP === '1' ? { listens } : {}) }) }] });
  else if (request.method === 'tools/call') {
    if (!hasTaskClientCapabilityV2(request.params)) throw new Error('missing task capability');
    const now = new Date().toISOString(), taskId = `task-${++count}`;
    const task = DetailedTaskV2Schema.parse({ taskId, status: 'working', createdAt: now, lastUpdatedAt: now, ttlMs: 60_000, pollIntervalMs: 10_000 });
    tasks.set(taskId, task);
    result(request, CreateTaskResultV2Schema.parse({ ...task, resultType: 'task' }));
    setTimeout(() => {
      if (tasks.get(taskId).status !== 'working') return;
      if (request.params.arguments?.ask) {
        const input = DetailedTaskV2Schema.parse({ ...task, status: 'input_required', lastUpdatedAt: new Date().toISOString(), inputRequests: { format: { method: 'elicitation/create', params: { mode: 'form', message: '选择报告格式', requestedSchema: { type: 'object', properties: { format: { type: 'string', enum: ['html','pdf'] }, count: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['format','count'] } } } } });
        tasks.set(taskId, input); for (const [subscriptionId, ids] of subscriptions) if (ids.includes(taskId)) send({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...input, _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId } } }); return;
      }
      const done = DetailedTaskV2Schema.parse({ ...task, status: 'completed', lastUpdatedAt: new Date().toISOString(), result: { resultType: 'complete', content: [{ type: 'text', text: taskId }], isError: request.params.arguments?.fail === true } });
      tasks.set(taskId, done);
      for (const [subscriptionId, ids] of subscriptions) if (ids.includes(taskId)) send({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...done, _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId } } });
    }, Number(process.env.XIAOK_TEST_TASK_DELAY_MS || 300));
  } else if (request.method === 'tasks/get') {
    GetTaskRequestV2Schema.parse(request);
    result(request, { ...tasks.get(request.params.taskId), resultType: 'complete' });
  } else if (request.method === 'tasks/update') {
    updates++;
    const task = tasks.get(request.params.taskId), input = request.params.inputResponses?.format;
    if (!input) throw new Error('missing input response');
    const done = DetailedTaskV2Schema.parse({ taskId: task.taskId, createdAt: task.createdAt, ttlMs: task.ttlMs, status: input.action === 'accept' ? 'completed' : 'cancelled', lastUpdatedAt: new Date().toISOString(), ...(input.action === 'accept' ? { result: { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(input.content) }] } } : {}) });
    tasks.set(task.taskId, done); result(request, { resultType: 'complete' });
    for (const [subscriptionId, ids] of subscriptions) if (ids.includes(task.taskId)) send({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...done, _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId } } });
  } else if (request.method === 'tasks/cancel') {
    cancels++;
    CancelTaskRequestV2Schema.parse(request);
    const task = tasks.get(request.params.taskId);
    // ACK precedes physical completion; cancellation remains observational.
    result(request, { resultType: 'complete' });
    setTimeout(() => {
      const done = DetailedTaskV2Schema.parse({ ...task, status: 'cancelled', lastUpdatedAt: new Date().toISOString() }); tasks.set(task.taskId, done);
      for (const [subscriptionId, ids] of subscriptions) if (ids.includes(task.taskId)) send({ jsonrpc: '2.0', method: 'notifications/tasks', params: { ...done, _meta: { 'io.modelcontextprotocol/subscriptionId': subscriptionId } } });
    }, 50);
  } else if (request.method === 'subscriptions/listen') {
    const ids = request.params.notifications.taskIds ?? [];
    subscriptions.set(request.id, ids); listens++;
    if (process.env.XIAOK_TEST_STREAM_DROP === '1' && listens === 1) setTimeout(() => { subscriptions.delete(request.id); result(request, { resultType: 'complete' }); }, 30);
    send({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { notifications: { taskIds: ids }, _meta: { 'io.modelcontextprotocol/subscriptionId': request.id } } });
  } else if (request.method === 'notifications/cancelled') subscriptions.delete(request.params.requestId);
  else if ('id' in request) send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'not supported' } });
}
