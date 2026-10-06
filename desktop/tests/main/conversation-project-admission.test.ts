// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createDesktopServices } from '../../electron/desktop-services.js';

// Vitest loads TS source, whose relative .js Worker URL has no source-tree
// counterpart. Use the committed production JS Worker, retaining the real
// worker_threads implementation, protocol and completion/evidence checks.
vi.mock('node:worker_threads', async importActual => {
  const native = await importActual<typeof import('node:worker_threads')>();
  return { ...native, Worker: class extends native.Worker {
    constructor(script: string | URL, options?: import('node:worker_threads').WorkerOptions) {
      super(String(script).endsWith('/delivery-verifier-worker.js')
        ? new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js', import.meta.url) : script, options);
    }
  } };
});

describe('Desktop user task project admission', () => {
  it.each(['user', 'background', 'plan'] as const)('uses the actual %s task entry and cannot inherit another lane grant', async kind => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-project-admission-'));
    const configDir = join(root, 'config'); mkdirSync(configDir);
    const previousConfig = process.env.XIAOK_CONFIG_DIR;
    const previousPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
    vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ schemaVersion: 1, defaultModel: 'custom',
      models: { custom: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-key', model: 'fixture-model' } },
      defaultMode: 'interactive', channels: {}, skillDebug: false }));
    const projects: any[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/agents') return Response.json({ agents: [
        { id: 'xiaok-po', name: 'PO', roles: ['po'], status: 'active' },
        { id: 'xiaok-worker', name: 'Worker', roles: ['worker'], status: 'active' },
      ] });
      if (path === '/projects/room-first') {
        const project = { ...JSON.parse(String(init?.body)), id: 'proj-user-entry', status: 'planning' };
        projects.push(project);
        return Response.json({ ok: true, project, preparation: { state: 'ready' }, planningStart: { sent: true } });
      }
      if (path === '/projects') return Response.json({ projects });
      return Response.json({ ok: false, error: 'fixture_route_unavailable' }, { status: 404 });
    });
    const services = createDesktopServices({ dataRoot: join(root, 'data'), workspaceRoot: join(root, 'workspace'), knowledgeDbPath: join(root, 'knowledge.db'),
      kswarmService: { request, getDesktopMutationToken: () => 'fixture-token', getStatus: () => ({ running: true }), onStatusChange: () => () => {} } as never });
    services.bindConversationProjectRoomClient({
      createRoom: async () => ({ ok: true, room: { roomId: 'room-user-entry', revision: 1 } }),
      sendRoomMessage: async () => ({ ok: true, message: { messageId: 'source-user-entry' } }),
      getRoomSnapshot: async () => ({ ok: true, room: { roomId: 'room-user-entry', revision: 2 } }),
    });
    const stream = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
      if (!messages.some(message => message.content.some(block => block.type === 'tool_result'))) {
        yield { type: 'tool_use', id: 'project-create', name: 'create_project', input: { name: '实际入口项目', goal: '完成 HTML 报告' } };
      } else {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result');
        const receipt = result?.type === 'tool_result' ? JSON.parse(result.content) : {};
        yield { type: 'text', delta: receipt.projectId
          ? `正式项目已创建，项目编号 ${receipt.projectId}，已进入初始规划并将按用户要求自动派发。项目可以在 Xiaok 项目列表持续跟进。`
          : '当前仅生成项目提案，尚未创建正式项目；此运行来源没有正式项目创建授权，未创建项目或启动智能体。' };
      }
      yield { type: 'done' };
    });
    try {
      const input = { prompt: '创建xiaok项目，要在项目列表能持续跟进', materials: [] };
      const created = kind === 'background' ? await services.createBackgroundTask(input)
        : await services.createTask({ ...input, ...(kind === 'plan' ? { permissionMode: 'plan' as const } : {}) });
      const deadline = Date.now() + 10000;
      let snapshot: any;
      do {
        snapshot = (await services.recoverTask(created.taskId)).snapshot;
        if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      expect(projects).toHaveLength(kind === 'user' ? 1 : 0);
      if (kind === 'user') expect(snapshot.status, JSON.stringify(snapshot.events.filter((event: any) => /error|fail|terminal/.test(event.type)))).toBe('completed');
      else expect(['completed', 'failed']).toContain(snapshot.status);
      const toolResult = snapshot.events.find((event: any) => event.type === 'canvas_tool_result' && event.toolName === 'create_project');
      expect(toolResult).toBeDefined();
      if (kind === 'user') expect(JSON.parse(toolResult.response)).toMatchObject({ ok: true, projectId: 'proj-user-entry', planningStart: { sent: true } });
      else expect(JSON.parse(toolResult.response)).toHaveProperty('proposal');
    } finally {
      stream.mockRestore(); await services.disposeMultiAgent(); vi.unstubAllGlobals();
      if (previousConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previousConfig;
      if (previousPlugins === undefined) delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS; else process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = previousPlugins;
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
