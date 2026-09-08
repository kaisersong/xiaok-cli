// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

const methods = ['createTask', 'createTaskWithFiles', 'createGoal', 'resumeGoal', 'replaceGoal', 'ackGoalTaskAttached'] as const;
describe('factory local Chat/Goal entrypoints share the existing startup receipt', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it.each(methods.flatMap(method => [false, true].map(failed => ({ method, failed }))))('$method waits before Goal admission when recovery failure=$failed', async ({ method, failed }) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-admission-ready-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = DesktopMultiAgentService.prototype.initialize;
    const reason = new Error('original_recovery_failed');
    vi.spyOn(DesktopMultiAgentService.prototype, 'initialize').mockImplementation(function(this: DesktopMultiAgentService, host) {
      return original.call(this, host).then(async () => { await gate; if (failed) throw reason; });
    });
    const goalMethod = method === 'createTask' || method === 'createTaskWithFiles' ? 'admitUserTask' : method;
    // This double measures the factory routing boundary only. Real model and
    // Goal behavior is exercised by the unchanged MCP/Goal adjacent suites.
    const admission = vi.spyOn(DesktopGoalCoordinator.prototype, goalMethod).mockResolvedValue(undefined as never);
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
      getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {},
      getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }),
    } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), workspaceRoot: root,
      pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService });
    cleanup.push(() => services.disposeMultiAgent()); cleanup.push(release);
    const invoke = (): Promise<unknown> => method === 'createTask' ? services.createTask({ prompt: 'fixture', materials: [], context: { threadId: 'thread' } })
      : method === 'createTaskWithFiles' ? services.createTaskWithFiles({ prompt: 'fixture', filePaths: [], context: { threadId: 'thread' } })
      : method === 'resumeGoal' ? services.resumeGoal({ threadId: 'thread' })
      : method === 'ackGoalTaskAttached' ? services.ackGoalTaskAttached({ threadId: 'thread', attachmentId: 'attachment' })
      : services[method]({ threadId: 'thread', objective: 'fixture', expectedEvidenceKinds: ['answer'], turnLimit: 2 });
    const result = Promise.resolve().then(invoke).then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setImmediate(resolve));
    expect.soft(admission).not.toHaveBeenCalled();
    release();
    if (failed) { expect(await result).toEqual({ error: reason }); expect(admission).not.toHaveBeenCalled(); }
    else { expect(await result).toEqual({ value: undefined }); expect(admission).toHaveBeenCalledOnce(); }
  });
});
