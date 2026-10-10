import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createMcpClientConnection, type McpClientConnection } from '../../../src/platform/mcp/transport.js';
import { callMcpToolWithTasks } from '../../../src/platform/mcp/tasks.js';

describe('official MCP Tasks extension over real stdio', () => {
  const connections: McpClientConnection[] = [];
  afterEach(async () => { for (const connection of connections.splice(0)) await connection.close(); });
  async function connect() {
    const connection = await createMcpClientConnection('task-fixture', { type: 'stdio', command: process.execPath,
      args: [join(process.cwd(), 'tests/support/mcp-tasks-stdio-server.js')], protocol: { mode: 'modern', version: '2026-07-28' } });
    connections.push(connection); return connection;
  }
  it('negotiates, acknowledges a task subscription and receives completion without waiting for the 10s polling hint', async () => {
    const connection = await connect(), events: unknown[] = [], handles: unknown[] = [];
    const started = Date.now();
    const result = await callMcpToolWithTasks(connection, { name: 'work', arguments: { fail: true } }, {
      observer: { handle: ref => { handles.push(ref); }, event: (_ref, event) => { events.push(event); }, unavailable: () => { throw new Error('task subscription failed'); } }, timeout: 2000 });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'task-1' }] });
    expect(handles).toHaveLength(1); expect(events.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2500);
  });
  it('keeps a concurrent ordinary SDK request in its own response namespace', async () => {
    const connection = await connect();
    const [result, catalog] = await Promise.all([callMcpToolWithTasks(connection, { name: 'work', arguments: {} }), connection.client.listTools()]);
    expect(result.content).toHaveLength(1); expect(catalog.tools[0].name).toBe('work');
  });
  it('does not treat a cancellation ACK as physical settlement', async () => {
    const connection = await connect();
    let afterAck: string | undefined;
    await expect(callMcpToolWithTasks(connection, { name: 'work', arguments: {} }, { timeout: 2000,
      observer: { handle: async reference => {
        await connection.tasks!.cancelTask(reference.taskId);
        afterAck = (await connection.tasks!.task(reference.taskId).snapshot()).status;
      }, event: () => {} },
    })).rejects.toThrow(/cancel/i);
    expect(afterAck).toBe('working');
  });

  it.skipIf(!process.env.XIAOK_TEST_REPORT_TASK_BUNDLE)('runs the real report Plugin bundle as an asynchronous task and preserves its legacy synchronous call', async () => {
    const bundle = process.env.XIAOK_TEST_REPORT_TASK_BUNDLE!;
    const root = mkdtempSync(join(tmpdir(), 'xiaok-plugin-task-'));
    const ir = readFileSync(join(bundle, '..', '..', 'tests', 'fixtures', 'valid-mixed.report.md'), 'utf8');
    const create = async (mode: 'modern' | 'legacy') => {
      const connection = await createMcpClientConnection('report-renderer-integration', { type: 'stdio', command: process.execPath,
        args: [bundle], env: { XIAOK_REPORT_TASKS_ROOT: root }, protocol: mode === 'modern' ? { mode, version: '2026-07-28' } : { mode } });
      connections.push(connection); return connection;
    };
    try {
      const modern = await create('modern'), handles: unknown[] = [];
      const result = await callMcpToolWithTasks(modern, { name: 'render_report', arguments: { ir_content: ir } }, {
        observer: { handle: reference => { handles.push(reference); }, event: () => {} }, timeout: 3000 });
      expect(handles).toHaveLength(1); expect(JSON.parse((result.content[0] as { text: string }).text).success).toBe(true);
      await modern.close();
      const legacy = await create('legacy');
      expect(legacy.tasks?.capabilities.execution).toBe(false);
      const synchronous = await callMcpToolWithTasks(legacy, { name: 'render_report', arguments: { ir_content: ir } });
      expect(JSON.parse((synchronous.content[0] as { text: string }).text).success).toBe(true);
      await legacy.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
