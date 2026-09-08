// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

const methods = ['createGoal', 'replaceGoal', 'resumeGoal'] as const;
const originalId = '1e46092d-627b-4ee3-8e4a-70c1bc17497e';
const laterId = '1e46092d-627b-4ee3-8e4a-70c1bc17497f';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('W2-P3 factory captures request identity before its existing recovery await', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  function setup(method: typeof methods[number]) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-source-capture-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const initialize = DesktopMultiAgentService.prototype.initialize;
    vi.spyOn(DesktopMultiAgentService.prototype, 'initialize').mockImplementation(function (this: DesktopMultiAgentService, host) {
      return initialize.call(this, host).then(() => gate);
    });
    // Only the downstream coordinator is replaced to observe this factory
    // boundary. P1/P4 separately exercise real Goal persistence/admission.
    const captured: unknown[] = [];
    const admission = vi.spyOn(DesktopGoalCoordinator.prototype, method).mockImplementation(async input => {
      captured.push((input as typeof input & { requestId?: unknown }).requestId);
      return undefined as never;
    });
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
      getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture',
      request: async () => new Response('{}', { status: 503 }),
    } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
      workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService });
    cleanup.push(() => services.disposeMultiAgent()); cleanup.push(release);
    // Forward the exact caller object. Copying it here would falsely test the
    // fixture's own capture instead of the production service's await boundary.
    const invoke = (input: { threadId: string; requestId?: unknown }) => (
      services[method] as (value: typeof input) => Promise<unknown>
    )(input);
    const inputFor = (id?: string) => ({ threadId: 'thread',
      ...(method === 'resumeGoal' ? {} : { objective: 'answer', expectedEvidenceKinds: ['answer'] }),
      ...(id === undefined ? {} : { requestId: id }),
    });
    return { captured, admission, invoke, release, inputFor };
  }

  it.each(methods)('%s retains the original id while recovery is physically pending', async method => {
    const f = setup(method), input = f.inputFor(originalId);
    const outcome = f.invoke(input);
    input.requestId = laterId;
    await tick(); expect(f.admission).not.toHaveBeenCalled();
    f.release(); await outcome;
    expect(f.captured).toEqual([originalId]);
  });

  it.each(methods)('%s preserves omitted legacy identity instead of reading a later added id', async method => {
    const f = setup(method), input = f.inputFor();
    const outcome = f.invoke(input); input.requestId = laterId;
    await tick(); expect(f.admission).not.toHaveBeenCalled();
    f.release(); await outcome;
    expect(f.captured).toEqual([undefined]);
  });

  it.each(methods)('%s rejects malformed identity without waiting for recovery or entering Goal', async method => {
    const f = setup(method);
    let settled = false;
    const outcome = Promise.resolve().then(() => f.invoke({ ...f.inputFor(), requestId: null }))
      .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await tick();
    expect.soft(settled).toBe(true);
    expect.soft(f.admission).not.toHaveBeenCalled();
    f.release();
    expect(await outcome).toEqual({ error: expect.objectContaining({ message: 'invalid_goal_request_id' }) });
    expect(f.admission).not.toHaveBeenCalled();
  });
});
