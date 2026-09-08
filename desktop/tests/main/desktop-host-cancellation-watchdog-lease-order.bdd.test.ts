// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

describe('BDD: real main watchdog and lease expiry keep whichever legal terminal wins first', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  it.each(['watchdog-terminal', 'watchdog-signal', 'lease'] as const)('C20 %s wins without inventing a cancellation writer for signal-only abort', async first => {
    const f = await authorizationFixture(cleanup);
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const entered = deferred(), release = deferred(); cleanup.push(async () => { release.resolve(); await host.drain(); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let models = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      models++; entered.resolve(); await release.promise; yield { type: 'text', delta: 'Late model output must not revive execution.' };
    });
    const task = await f.services.createTask({ prompt: 'Wait for explicit cancellation.', materials: [], watchdogMs: 60_000,
      context: { threadId: `watchdog-lease-${first}` }, permissionMode: 'auto' });
    await entered.promise;
    const binding = f.store.getRootBinding(task.taskId)!;
    const groups = (f.boundary.service as unknown as { groups: Map<string, { root?: { context?: DesktopAgentExecutionContext } }> }).groups;
    const context = groups.get(binding.groupId)?.root?.context!;
    expect(context).toBeDefined();
    let aborts = 0; context.signal.addEventListener('abort', () => { aborts++; });
    const ticket = context.memberTicket;
    const decide = vi.spyOn(f.boundary.service, 'decideHostCancellation');
    const cold = () => new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    const expire = async () => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(ticket.deadlineAt! + 1);
      try { await f.boundary.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: ticket.epoch }); }
      finally { clock.mockRestore(); }
    };
    if (first !== 'lease') {
      await vi.advanceTimersByTimeAsync(60_000);
      while (!context.signal.aborted) await turn();
      if (first === 'watchdog-terminal') { release.resolve(); await host.drain(); expect((await cold())?.status).toBe('failed'); }
      await expire();
    } else {
      await expire();
      expect((await cold())?.status).toBe('cancelled');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(decide.mock.calls.some(([, reason]) => reason === 'task_watchdog_timeout')).toBe(true);
    expect(aborts).toBe(1);
    if (first !== 'watchdog-terminal') { expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false); }
    release.resolve(); await host.drain();
    const snapshot = (await cold())!;
    console.log('CANCELLATION_REAL_WATCHDOG_LEASE_ORDER', { first, status: snapshot.status, events: snapshot.events.map(event => event.type),
      decisions: await Promise.all(decide.mock.results.map(result => result.value)), aborts, models, released: ticket.released });
    expect(snapshot.status).toBe(first === 'watchdog-terminal' ? 'failed' : 'cancelled');
    expect(snapshot.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(snapshot.events.filter(event => event.type === 'salvage')).toHaveLength(first === 'watchdog-terminal' ? 0 : 1);
    expect(models).toBe(1); expect(ticket.released).toBe(true);
  });
});
