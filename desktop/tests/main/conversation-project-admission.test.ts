// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildProjectCardMessageFromToolResult } from '../../renderer/src/components/chatToolResultMessages';
import { createDesktopServices } from '../../electron/desktop-services.js';
import {ConversationProjectService} from '../../electron/conversation-project-service.js';

// Vitest loads TS source, whose relative .js Worker URL has no source-tree
// counterpart. Use the committed production JS Worker, retaining the real
// worker_threads implementation, protocol and completion/evidence checks.
vi.mock('node:worker_threads', async importActual => {
  const {preserveNativeWorkerGetters}=await import('../support/native-worker-fixture.js');

  const native = await importActual<typeof import('node:worker_threads')>();
  return { ...native, Worker: preserveNativeWorkerGetters(native.Worker,class extends native.Worker {
    constructor(script: string | URL, options?: import('node:worker_threads').WorkerOptions) {
      super(String(script).endsWith('/delivery-verifier-worker.js')
        ? new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js', import.meta.url) : script, options);
    }
  }) };
});

describe('Desktop user task project admission', () => {
  it.each(['user', 'background', 'plan','refused_source','url_root','exact_folder','only_plan','no_auto','negated_workflow','negated_new_project','negated_folder'] as const)('uses the actual %s task entry and cannot inherit another lane grant', async kind => {
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
    const scope={profileId:createHash('sha256').update(join(root,'data')).digest('hex'),workspaceId:createHash('sha256').update(join(root,'workspace')).digest('hex')};
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if(path==='/desktop/project-protocol')return Response.json({ok:true,protocol:'ordinary_initial_plan_v1',producer:'desktop_main_v1',scope});
      if(path==='/projects/proj-user-entry/initial-plan-inputs')return Response.json({ok:true,startPolicy:projects[0].requestedStartPolicy,ownerBinding:{protocol:'ordinary_initial_plan_v1',projectId:'proj-user-entry',...scope,canonicalCreateOperationId:projects[0].clientRequestKey,canonicalCreateDigest:'c'.repeat(64),enqueueKey:'initial-plan:'+'d'.repeat(64),planGeneration:1},planInputRevision:0});
      if(path.endsWith('/initial-plan-inputs/claim'))return Response.json({ok:false,error:'fixture_planning_not_run'},{status:409});
      if (path === '/agents') return Response.json({ agents: [
        { id: 'xiaok-po', name: 'PO', roles: ['po'], status: 'active' },
        { id: 'xiaok-worker', name: 'Worker', roles: ['worker'], status: 'active' },
      ] });
      if (path === '/projects/room-first') {
        const project = { ...JSON.parse(String(init?.body)), id: 'proj-user-entry', status: 'planning', requirements: 'large-production-project'.repeat(1500) };
        projects.push(project);
        return Response.json({ ok: true, project, preparation: { state: 'ready' }, planningStart: { sent: true } });
      }
      if (path === '/projects') return Response.json({ projects });
      return Response.json({ ok: false, error: 'fixture_route_unavailable' }, { status: 404 });
    });
    const services = createDesktopServices({ dataRoot: join(root, 'data'), workspaceRoot: join(root, 'workspace'), knowledgeDbPath: join(root, 'knowledge.db'),
      kswarmService: { request, getDesktopMutationToken: () => 'fixture-token', getStatus: () => ({ running: true }), onStatusChange: () => () => {} } as never });
    const createRoom=vi.fn(async () => ({ ok: true, room: { roomId: 'room-user-entry', revision: 1 } }));
    services.bindConversationProjectRoomClient({
      createRoom,
      sendRoomMessage: async () => ({ ok: true, message: { messageId: 'source-user-entry' } }),
      getRoomSnapshot: async () => ({ ok: true, room: { roomId: 'room-user-entry', revision: 2 } }),
    });
    const stream = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
      if (!messages.some(message => message.content.some(block => block.type === 'tool_result'))) {
        yield { type: 'tool_use', id: 'project-create', name: 'create_project', input: { name: '实际入口项目', goal: '完成 HTML 报告',
          ...(kind==='url_root'?{workFolder:'/'}:kind==='exact_folder'?{workFolder:join(root,'requested-workspace')}:kind==='negated_folder'?{workFolder:join(root,'denied-workspace')}:{}) } };
      } else {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result');
        const receipt = result?.type === 'tool_result' ? JSON.parse(result.content) : {};
        yield { type: 'text', delta: receipt.projectId
          ? `正式项目已创建，项目编号 ${receipt.projectId}，已进入初始规划并将按用户要求自动派发。项目可以在 Xiaok 项目列表持续跟进。`
          : '当前仅生成项目提案，尚未创建正式项目；此运行来源没有正式项目创建授权，未创建项目或启动智能体。' };
      }
      yield { type: 'done' };
    });
    const refusedSource=kind==='refused_source'?vi.spyOn(ConversationProjectService.prototype,'recordPreparedUserTask').mockReturnValue(false):undefined;
    try {
      const shouldCreate=['user','exact_folder','only_plan','no_auto'].includes(kind);
      const prompt=kind==='negated_folder'?`创建一个项目，不要保存到 \`${join(root,'denied-workspace')}\`，保存到 \`${join(root,'requested-workspace')}\``:kind==='url_root'?'创建一个项目并交付报告，参考 https://example.com':kind==='exact_folder'?`创建一个项目，工作目录为 \`${join(root,'requested-workspace')}\``:kind==='only_plan'?'创建一个项目，只做计划':kind==='no_auto'?'创建一个项目，不要自动执行':kind==='negated_workflow'?'设计一个工作流并交付报告，先不建项目':kind==='negated_new_project'?'设计一个工作流并交付报告，不要新建项目':'创建xiaok项目，要在项目列表能持续跟进';
      const input = { prompt, materials: [] };
      // User gestures enter the real canonical submission owner. Keep the
      // explicit refused legacy-source case on its original admission entry.
      const taskInput={...input,...(kind==='plan'?{permissionMode:'plan' as const}:{})};
      const created = kind === 'background' ? await services.createBackgroundTask(input)
        : kind==='refused_source' ? await services.createTask(taskInput)
        : await services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',...taskInput}},
          {requestSource:'user',actorId:'desktop-user:'+services.multiAgent!.profileId});
      const deadline = Date.now() + 10000;
      let snapshot: any;
      do {
        snapshot = (await services.recoverTask(created.taskId)).snapshot;
        if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      expect(projects).toHaveLength(shouldCreate ? 1 : 0);
      if(shouldCreate)expect(projects[0].requestedStartPolicy).toBe(['only_plan','no_auto'].includes(kind)?'plan_only':'activate_and_dispatch_after_plan');
      else expect(createRoom).not.toHaveBeenCalled();
      if (shouldCreate) {
        const event = snapshot.events.find((e: any) => e.type === 'canvas_tool_result' && e.toolName === 'create_project');
        expect(buildProjectCardMessageFromToolResult(event.response)?.projectData?.projectId).toBe('proj-user-entry');
        const journal=join(root,'data','conversation-projects');
        const operations=readdirSync(journal).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(journal,name),'utf8'))).filter(record=>record.result?.projectId==='proj-user-entry');
        expect(operations).toHaveLength(1);
        const full=operations[0].result;
        expect(JSON.stringify(full).length).toBeGreaterThan(10000);
        const path = join(root, 'data', 'tasks', 'snapshots', `${created.taskId}.json`);
        const persisted = JSON.parse(readFileSync(path, 'utf8'));
        persisted.events = persisted.events.map((item: any) => item === undefined ? item : item.type === 'canvas_tool_result' && item.toolName === 'create_project' ? { ...item, response: JSON.stringify(full).slice(0, 10000) } : item);
        const originalBytes = JSON.stringify(persisted);
        writeFileSync(path, originalBytes);
        const restored = (await services.recoverTask(created.taskId)).snapshot.events.find((item: any) => item.type === 'canvas_tool_result' && item.toolName === 'create_project');
        expect(buildProjectCardMessageFromToolResult(restored!.response)?.projectData?.projectId).toBe('proj-user-entry');
        expect(readFileSync(path, 'utf8')).toBe(originalBytes);
        expect(projects).toHaveLength(1);
      }
      if (shouldCreate) expect(snapshot.status, JSON.stringify(snapshot.events.filter((event: any) => /error|fail|terminal/.test(event.type)))).toBe('completed');
      else expect(['completed', 'failed']).toContain(snapshot.status);
      const toolResult = snapshot.events.find((event: any) => event.type === 'canvas_tool_result' && event.toolName === 'create_project');
      expect(toolResult).toBeDefined();
      if (shouldCreate) expect(JSON.parse(toolResult.response)).toMatchObject({ ok: true, projectId: 'proj-user-entry', planningStart: { sent: false } });
      else if(['url_root','negated_folder'].includes(kind))expect(JSON.parse(toolResult.response)).toMatchObject({ok:false,error:'conversation_project_workfolder_not_authorized'});
      else expect(JSON.parse(toolResult.response)).toHaveProperty('proposal');
    } finally {
      refusedSource?.mockRestore();stream.mockRestore(); await services.disposeMultiAgent(); vi.unstubAllGlobals();
      if (previousConfig === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previousConfig;
      if (previousPlugins === undefined) delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS; else process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = previousPlugins;
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
