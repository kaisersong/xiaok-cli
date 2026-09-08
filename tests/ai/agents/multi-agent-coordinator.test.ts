import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMultiAgentCoordinator,
  type ManagedAgentSession,
} from '../../../src/ai/agents/multi-agent-coordinator.js';
import { runCleanupWithTimeout } from '../../../src/commands/chat-runtime-config.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeSession(run: ManagedAgentSession['run']): ManagedAgentSession {
  return {
    run,
    dispose: vi.fn(async () => undefined),
  };
}

function waitForAbort(_message: string, signal?: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

describe('multi-agent coordinator', () => {
  afterEach(() => vi.useRealTimers());

  it('spawns multiple agents without waiting for either task to finish', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let ordinal = 0;
    const coordinator = createMultiAgentCoordinator({
      maxResidentAgents: 4,
      idGenerator: () => `agent_${++ordinal}`,
    });

    const one = await coordinator.spawn({
      requestSource: 'agent',
      callerId: 'main',
      taskName: 'research',
      message: 'research',
      createSession: async () => fakeSession(() => first.promise),
    });
    const two = await coordinator.spawn({
      requestSource: 'agent',
      callerId: 'main',
      taskName: 'review',
      message: 'review',
      createSession: async () => fakeSession(() => second.promise),
    });

    expect(one).toMatchObject({ id: 'agent_1', canonicalName: '/root/research' });
    expect(two).toMatchObject({ id: 'agent_2', canonicalName: '/root/review' });
    await vi.waitFor(() => expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'agent_1', status: 'running' }),
        expect.objectContaining({ id: 'agent_2', status: 'running' }),
      ])));

    first.resolve('research done');
    second.resolve('review done');
    await vi.waitFor(() => expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' })
      .filter((agent) => agent.id !== 'main').every((agent) => agent.status === 'completed')).toBe(true));
    const update = await coordinator.waitForUpdate({
      requestSource: 'agent',
      callerId: 'main',
      targets: [one.id, two.id],
      timeoutMs: 0,
    });
    expect(update.timedOut).toBe(false);

    await coordinator.dispose();
  });

  it('delivers messages in both directions through the production mailbox', async () => {
    const running = deferred<string>();
    const coordinator = createMultiAgentCoordinator({ idGenerator: () => 'agent_child' });
    const child = await coordinator.spawn({
      requestSource: 'agent',
      callerId: 'main',
      taskName: 'child',
      message: 'start',
      createSession: async () => fakeSession(() => running.promise),
    });

    coordinator.sendMessage({
      requestSource: 'agent',
      callerId: 'main',
      target: child.id,
      message: 'main to child',
    });
    const childUpdate = await coordinator.waitForUpdate({
      requestSource: 'agent',
      callerId: child.id,
      targets: ['main'],
      timeoutMs: 20,
    });
    expect(childUpdate.messages).toEqual([
      expect.objectContaining({ senderId: 'main', receiverId: child.id, text: 'main to child' }),
    ]);

    coordinator.sendMessage({
      requestSource: 'agent',
      callerId: child.id,
      target: 'main',
      message: 'child to main',
    });
    const mainUpdate = await coordinator.waitForUpdate({
      requestSource: 'agent',
      callerId: 'main',
      targets: [child.id],
      timeoutMs: 20,
    });
    expect(mainUpdate.messages).toEqual([
      expect.objectContaining({ senderId: child.id, receiverId: 'main', text: 'child to main' }),
    ]);

    running.resolve('done');
    await coordinator.dispose();
  });

  it('runs follow-up work on the same persistent session', async () => {
    const run = vi.fn(async (message: string) => `reply:${message}`);
    const session = fakeSession(run);
    const coordinator = createMultiAgentCoordinator({ idGenerator: () => 'agent_reusable' });
    const child = await coordinator.spawn({
      requestSource: 'agent',
      callerId: 'main',
      taskName: 'reusable',
      message: 'first',
      createSession: async () => session,
    });
    await coordinator.waitForUpdate({
      requestSource: 'agent',
      callerId: 'main',
      targets: [child.id],
      timeoutMs: 100,
    });

    coordinator.followupTask({
      requestSource: 'agent',
      callerId: 'main',
      target: child.id,
      message: 'second',
    });
    await coordinator.waitForUpdate({
      requestSource: 'agent',
      callerId: 'main',
      targets: [child.id],
      timeoutMs: 100,
    });

    const runContext = expect.objectContaining({ onActivity: expect.any(Function), takePendingInput: expect.any(Function) });
    expect(run).toHaveBeenNthCalledWith(1, 'first', expect.any(AbortSignal), runContext);
    expect(run).toHaveBeenNthCalledWith(2, 'second', expect.any(AbortSignal), runContext);
    expect(run).toHaveBeenCalledTimes(2);
    await coordinator.dispose();
  });

  it('rejects an agent interrupting root, ancestors, siblings, or itself', async () => {
    let ordinal = 0;
    const coordinator = createMultiAgentCoordinator({
      idGenerator: () => `agent_${++ordinal}`,
    });
    const parent = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'parent', message: 'run',
      createSession: async () => fakeSession(waitForAbort),
    });
    const sibling = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'sibling', message: 'run',
      createSession: async () => fakeSession(waitForAbort),
    });

    expect(() => coordinator.interruptAgent({
      requestSource: 'agent', callerId: parent.id, target: 'main',
    })).toThrow('not permitted');
    expect(() => coordinator.interruptAgent({
      requestSource: 'agent', callerId: parent.id, target: sibling.id,
    })).toThrow('not permitted');
    expect(() => coordinator.interruptAgent({
      requestSource: 'agent', callerId: parent.id, target: parent.id,
    })).toThrow('not permitted');
    await expect(coordinator.closeAgent({
      requestSource: 'agent', callerId: parent.id, target: 'main',
    })).rejects.toThrow('not permitted');
    await expect(coordinator.closeAgent({
      requestSource: 'agent', callerId: parent.id, target: sibling.id,
    })).rejects.toThrow('not permitted');
    expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: parent.id, status: 'running' }),
        expect.objectContaining({ id: sibling.id, status: 'running' }),
      ]));

    await coordinator.dispose();
  });

  it('allows only descendants to be interrupted or closed and releases the resident slot', async () => {
    let ordinal = 0;
    const disposed = vi.fn(async () => undefined);
    const coordinator = createMultiAgentCoordinator({
      maxResidentAgents: 2,
      idGenerator: () => `agent_${++ordinal}`,
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'one', message: 'run',
      createSession: async () => ({ run: waitForAbort, dispose: disposed }),
    });

    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'two', message: 'run',
      createSession: async () => fakeSession(async () => 'done'),
    })).rejects.toThrow('capacity');

    await coordinator.closeAgent({ requestSource: 'agent', callerId: 'main', target: child.id });
    expect(disposed).toHaveBeenCalledOnce();
    expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toContainEqual(expect.objectContaining({ id: child.id, status: 'closed' }));

    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'two', message: 'run',
      createSession: async () => fakeSession(async () => 'done'),
    })).resolves.toMatchObject({ canonicalName: '/root/two' });
    await coordinator.dispose();
  });

  it('fails closed for scheduler mutations, depth overflow, duplicate names, and oversized messages', async () => {
    const coordinator = createMultiAgentCoordinator({
      maxDepth: 1,
      maxMessageChars: 8,
      idGenerator: (() => {
        let ordinal = 0;
        return () => `agent_${++ordinal}`;
      })(),
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'child', message: 'start',
      createSession: async () => fakeSession(async () => 'done'),
    });

    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: child.id, taskName: 'too_deep', message: 'start',
      createSession: async () => fakeSession(async () => 'done'),
    })).rejects.toThrow('depth');
    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'child', message: 'start',
      createSession: async () => fakeSession(async () => 'done'),
    })).rejects.toThrow('already exists');
    expect(() => coordinator.sendMessage({
      requestSource: 'agent', callerId: 'main', target: child.id, message: '123456789',
    })).toThrow('too long');
    expect(() => coordinator.sendMessage({
      requestSource: 'scheduler', callerId: 'main', target: child.id, message: 'hello',
    })).toThrow('not permitted');

    await coordinator.dispose();
  });

  it('closes a descendant subtree from leaves to parent', async () => {
    let ordinal = 0;
    const coordinator = createMultiAgentCoordinator({
      idGenerator: () => `agent_${++ordinal}`,
    });
    const parent = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'parent', message: 'start',
      createSession: async () => fakeSession(async () => 'parent done'),
    });
    await coordinator.waitForUpdate({
      requestSource: 'agent', callerId: 'main', targets: [parent.id], timeoutMs: 100,
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: parent.id, taskName: 'child', message: 'start',
      createSession: async () => fakeSession(async () => 'child done'),
    });
    await coordinator.waitForUpdate({
      requestSource: 'agent', callerId: parent.id, targets: [child.id], timeoutMs: 100,
    });

    await coordinator.closeAgent({ requestSource: 'agent', callerId: 'main', target: parent.id });

    const snapshots = coordinator.listAgents({ requestSource: 'agent', callerId: 'main' });
    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: parent.id, status: 'closed' }),
      expect.objectContaining({ id: child.id, status: 'closed' }),
    ]));
    await coordinator.dispose();
  });

  it('rejects inbox overflow and aborts a pending wait without changing agent state', async () => {
    const sessionGate = deferred<ManagedAgentSession>();
    const coordinator = createMultiAgentCoordinator({
      maxInboxMessages: 1,
      idGenerator: () => 'agent_waiting',
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'waiting', message: 'start',
      createSession: () => sessionGate.promise,
    });
    coordinator.sendMessage({
      requestSource: 'agent', callerId: 'main', target: child.id, message: 'first',
    });
    expect(() => coordinator.sendMessage({
      requestSource: 'agent', callerId: 'main', target: child.id, message: 'second',
    })).toThrow('inbox is full');

    const controller = new AbortController();
    const wait = coordinator.waitForUpdate({
      requestSource: 'agent', callerId: 'main', targets: [child.id], timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toContainEqual(expect.objectContaining({ id: child.id, status: 'pending' }));
    sessionGate.resolve(fakeSession(waitForAbort));
    await coordinator.dispose();
  });

  it('freezes a closing subtree before awaiting settlement so late spawn cannot create an orphan', async () => {
    let ordinal = 0;
    const childGate = deferred<string>();
    const coordinator = createMultiAgentCoordinator({
      maxResidentAgents: 4,
      idGenerator: () => `agent_${++ordinal}`,
    });
    const parent = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'parent', message: 'run',
      createSession: async () => fakeSession(waitForAbort),
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: parent.id, taskName: 'child', message: 'run',
      createSession: async () => fakeSession(() => childGate.promise),
    });
    await vi.waitFor(() => expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: parent.id, status: 'running' }),
        expect.objectContaining({ id: child.id, status: 'running' }),
      ])));

    const closing = coordinator.closeAgent({
      requestSource: 'agent', callerId: 'main', target: parent.id,
    });
    const lateSpawn = await coordinator.spawn({
      requestSource: 'agent', callerId: parent.id, taskName: 'late', message: 'run',
      createSession: async () => fakeSession(waitForAbort),
    }).then(
      (agent) => ({ accepted: true as const, agent }),
      (error) => ({ accepted: false as const, error }),
    );

    childGate.resolve('done');
    await closing;
    const snapshots = coordinator.listAgents({ requestSource: 'agent', callerId: 'main' });
    await coordinator.dispose();

    expect(lateSpawn.accepted).toBe(false);
    if (!lateSpawn.accepted) expect(String(lateSpawn.error)).toContain('closing');
    expect(snapshots).not.toContainEqual(expect.objectContaining({ canonicalName: '/root/parent/late' }));
  });

  it('interrupts a pending task before session creation can enter run', async () => {
    const sessionGate = deferred<ManagedAgentSession>();
    const run = vi.fn(async () => 'must not run');
    const coordinator = createMultiAgentCoordinator({ idGenerator: () => 'agent_pending' });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'pending', message: 'run',
      createSession: () => sessionGate.promise,
    });
    const interrupted = coordinator.interruptAgent({
      requestSource: 'agent', callerId: 'main', target: child.id,
    });
    sessionGate.resolve(fakeSession(run));
    await vi.waitFor(() => expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toContainEqual(expect.objectContaining({ id: child.id, executionActive: false })));

    expect(interrupted).toEqual({ interrupted: true });
    expect(run).not.toHaveBeenCalled();
    expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toContainEqual(expect.objectContaining({ id: child.id, status: 'interrupted' }));
    await coordinator.dispose();
  });

  it('bounds abort-insensitive shutdown so later cleanup runs, then disposes after settlement', async () => {
    const runGate = deferred<string>();
    const deactivateSession = vi.fn(async () => undefined);
    const disposeSession = vi.fn(async () => undefined);
    const run = vi.fn(() => runGate.promise);
    const coordinator = createMultiAgentCoordinator({
      closeSettlementTimeoutMs: 20,
      idGenerator: () => 'agent_stubborn',
    });
    await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'stubborn', message: 'run',
      createSession: async () => ({
        run,
        deactivate: deactivateSession,
        dispose: disposeSession,
      }),
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    vi.useFakeTimers();

    let coordinatorDispose: Promise<void> | undefined;
    let laterCleanupRan = false;
    const cleanup = runCleanupWithTimeout([
      () => {
        coordinatorDispose = coordinator.dispose();
        return coordinatorDispose;
      },
      () => { laterCleanupRan = true; },
    ], 100);
    await vi.advanceTimersByTimeAsync(21);
    await cleanup;

    expect(laterCleanupRan).toBe(true);
    expect(deactivateSession).toHaveBeenCalledOnce();
    expect(disposeSession).not.toHaveBeenCalled();
    runGate.resolve('late completion');
    await coordinatorDispose;
    await vi.waitFor(() => expect(disposeSession).toHaveBeenCalledOnce());
  });

  it('keeps an abort-insensitive closing session in resident capacity until cleanup settles', async () => {
    const runGate = deferred<string>();
    const run = vi.fn(() => runGate.promise);
    const disposeSession = vi.fn(async () => undefined);
    let ordinal = 0;
    const coordinator = createMultiAgentCoordinator({
      maxResidentAgents: 2,
      closeSettlementTimeoutMs: 5,
      idGenerator: () => `agent_${++ordinal}`,
    });
    const child = await coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'stubborn', message: 'run',
      createSession: async () => ({ run, dispose: disposeSession }),
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    vi.useFakeTimers();

    const closing = coordinator.closeAgent({ requestSource: 'agent', callerId: 'main', target: child.id });
    await vi.advanceTimersByTimeAsync(6);
    await closing;
    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'replacement', message: 'run',
      createSession: async () => fakeSession(async () => 'done'),
    })).rejects.toThrow('capacity');

    runGate.resolve('late completion');
    await vi.waitFor(() => expect(coordinator.listAgents({ requestSource: 'agent', callerId: 'main' }))
      .toContainEqual(expect.objectContaining({ id: child.id, resourcesReleased: true })));
    expect(disposeSession).toHaveBeenCalledOnce();
    await expect(coordinator.spawn({
      requestSource: 'agent', callerId: 'main', taskName: 'replacement', message: 'run',
      createSession: async () => fakeSession(async () => 'done'),
    })).resolves.toMatchObject({ canonicalName: '/root/replacement' });
    await coordinator.dispose();
  });
});
