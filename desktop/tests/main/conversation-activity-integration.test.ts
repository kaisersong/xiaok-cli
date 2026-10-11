// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { createCollaborationRoomBrokerClient } from '../../electron/collaboration-room-broker-client.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { createHub } from '../../../../kswarm/src/core/hub.js';
import { createBrokerClient } from '../../../../kswarm/src/net/broker-client.js';
import { createBrokerService } from '../../../../intent-broker/src/broker/service.js';
import { createServer } from '../../../../intent-broker/src/http/server.js';

vi.mock('node:worker_threads', async importActual => {
  const native = await importActual<typeof import('node:worker_threads')>();
  return { ...native, Worker: class extends native.Worker {
    constructor(script: string | URL, options?: import('node:worker_threads').WorkerOptions) {
      super(String(script).endsWith('/delivery-verifier-worker.js') ? new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js', import.meta.url) : script, options);
    }
  } };
});

describe('user project to original conversation activity', () => {
  it('uses the production task/project admission, real broker HTTP and durable Hub without a polling model turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-conversation-chain-'));
    const config = join(root, 'config'); mkdirSync(config);
    const previous = process.env.XIAOK_CONFIG_DIR, plugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    process.env.XIAOK_CONFIG_DIR = config; process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
    writeFileSync(join(config, 'config.json'), JSON.stringify({ schemaVersion: 1, defaultModel: 'custom',
      models: { custom: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only', model: 'fixture' } }, defaultMode: 'interactive', channels: {} }));
    const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') });
    const server = createServer({ broker, roomService: broker.room, roomDesktopToken: 'desktop-fixture', roomKSwarmToken: 'kswarm-fixture' });
    await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    const hub = createHub({ silent: true, dataDir: { backend: 'sqlite', filePath: join(root, 'state.sqlite'), legacyJsonPath: join(root, 'state.json') },
      brokerClient: createBrokerClient({ brokerUrl: base, participantId: 'kswarm', roomSystemToken: 'kswarm-fixture' }) });
    const agents: Array<Record<string, unknown>> = [{ id: 'xiaok-po', roles: ['po'], status: 'active' }, { id: 'xiaok-worker', roles: ['worker'], status: 'active' }];
    const gateway = {
      getDesktopMutationToken: () => 'host-fixture', getStatus: () => ({ running: true }), onStatusChange: () => () => {},
      request: async (path: string, init?: RequestInit) => {
        if (path === '/agents' && !init?.method) return Response.json({ agents });
        if (path === '/agents') { const agent = JSON.parse(String(init?.body)); agents.push(agent); return Response.json({ ok: true, agent }); }
        if (path === '/projects') return Response.json({ projects: hub.listProjects() });
        if (path === '/projects/room-first') {
          const project = await hub.createProject({ ...JSON.parse(String(init?.body)), id: 'watched-project', autoAssignPo: false }, { requestSource: 'user', actor: { kind: 'user', userId: 'user.local' } });
          return Response.json({ ok: true, project });
        }
        if (path === '/projects/watched-project/activity-identity') {
          expect(new Headers(init?.headers).get('x-kswarm-mutation-token')).toBe('host-fixture');
          return Response.json(hub.getProjectActivityIdentity('watched-project'));
        }
        if (path.startsWith('/projects/watched-project/activity')) {
          expect(new Headers(init?.headers).get('x-kswarm-mutation-token')).toBe('host-fixture');
          const after = Number(new URL(path, 'http://fixture').searchParams.get('after'));
          return Response.json(hub.getProjectActivity('watched-project', { after }));
        }
        if (path === '/projects/watched-project') return Response.json({ project: hub.getProject('watched-project') });
        return Response.json({ ok: false }, { status: 404 });
      },
    };
    const services = createDesktopServices({ dataRoot: join(root, 'data'), workspaceRoot: join(root, 'workspace'), knowledgeDbPath: join(root, 'knowledge.sqlite'), kswarmService: gateway as never });
    services.bindConversationProjectRoomClient(createCollaborationRoomBrokerClient({ token: 'desktop-fixture',
      fetchImpl: (url, init) => fetch(String(url).replace(/^http:\/\/(?:127\.0\.0\.1|localhost):4318/, base), init) }));
    let modelCalls = 0;
    const model = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
      modelCalls++;
      if (messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('BACKGROUND_ACTIVITY_SENTINEL')))) {
        yield { type: 'text', delta: '42' }; yield { type: 'done' }; return;
      }
      if (!messages.some(message => message.content.some(block => block.type === 'tool_result'))) yield { type: 'tool_use', id: 'create', name: 'create_project', input: { name: 'Watched project', goal: 'Build a report', memberCount: 1 } };
      else yield { type: 'text', delta: 'Created.' };
      yield { type: 'done' };
    });
    try {
      const task = await services.createTask({ prompt: '创建一个项目，用于持续跟进报告进展', materials: [], context: { threadId: 'original-thread' } });
      await vi.waitFor(async () => expect(['completed','failed','cancelled']).toContain((await services.recoverTask(task.taskId)).snapshot.status), { timeout: 10000 });
      const snapshot = (await services.recoverTask(task.taskId)).snapshot;
      expect(snapshot.events.filter(event => event.type === 'error')).toEqual([]);
      expect(snapshot.status).toBe('completed');
      const actor = { requestSource: 'user' as const, actorId: `desktop-user:${services.multiAgent!.profileId}` };
      const activities = await services.conversationActivity!.list('original-thread', actor);
      expect(activities.length).toBeGreaterThan(0);
      expect(activities.every(item => item.threadId === 'original-thread')).toBe(true);
      const before = modelCalls;
      hub.updateProjectExecutionMode('watched-project', 'workflow_preferred');
      await services.conversationActivity!.projectChanged('watched-project');
      expect(modelCalls).toBe(before);
      expect(hub.listProjects()).toHaveLength(1);
      const final = await services.conversationActivity!.list('original-thread', actor);
      expect(final.at(-1)!.projection.executionState).not.toBe('completed');
      const background = await services.createBackgroundTask({ prompt: 'BACKGROUND_ACTIVITY_SENTINEL 17+25', materials: [],
        scheduledOrigin: { actionId: 'schedule', runId: 'run-1', createdByTaskId: task.taskId } });
      await vi.waitFor(async () => {
        const work = await services.conversationActivity!.getWork(`task:${background.taskId}`, actor) as any;
        expect(work.projection.executionState).toBe('completed');
        expect(work.watch.origin.threadId).toBe('original-thread');
        expect(work.watch.actualExecutionThreadId).not.toBe('original-thread');
      }, { timeout: 10000 });

      const boundary = services.multiAgent!;
      const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: actor.actorId,
        threadId: 'original-thread', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
      const deletion = boundary.service.readThreadDeletion({ access });
      await boundary.service.deleteThread({ access, requestSource: 'user', operationId: `delete:${deletion.threadRevision}:activity_e2e`,
        expectedThreadRevision: deletion.threadRevision, confirmTerminate: true });
      hub.updateProjectExecutionMode('watched-project', 'direct');
      await services.conversationActivity!.projectChanged('watched-project');
      await expect(services.conversationActivity!.list('original-thread', actor)).rejects.toThrow('activity_thread_deleted');
      expect(hub.listProjects()).toHaveLength(1); // Deleting the conversation did not cancel/delete the source project.

    } finally {
      model.mockRestore(); await services.disposeMultiAgent(); hub.closePersistence(); await server.close(); broker.close();
      if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
      if (plugins === undefined) delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS; else process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = plugins;
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
