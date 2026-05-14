import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that ChatShell's subscription logic prevents duplicate IPC listeners
 * under React StrictMode double-mount scenarios.
 *
 * Root cause of the "text repeated 2x/4x" bug:
 * - StrictMode unmounts/remounts the component
 * - The first mount's async `.then()` resolves AFTER cleanup, registering a stale listener
 * - The second mount registers its own listener
 * - Both listeners fire on every event → duplicated output
 *
 * The fix uses a monotonically increasing `mountGen` counter. All async callbacks
 * check `mountGenRef.current !== gen` before subscribing.
 */

// Minimal simulation of the ChatShell subscription logic (extracted from component)
function createChatShellSubscriptionLogic() {
  let mountGen = 0;
  let unsubFn: (() => void) | null = null;
  const activeListeners: Array<{ taskId: string; gen: number }> = [];

  // Simulates api.subscribeTask registering a listener
  function subscribe(taskId: string, gen: number) {
    activeListeners.push({ taskId, gen });
    return () => {
      const idx = activeListeners.findIndex(l => l.taskId === taskId && l.gen === gen);
      if (idx >= 0) activeListeners.splice(idx, 1);
    };
  }

  // Simulates the useEffect body
  async function mountEffect(taskId: string, asyncDelay: number) {
    const gen = ++mountGen;

    // Cleanup previous
    unsubFn?.();
    unsubFn = null;

    // Simulate async api.getThread().then(...)
    await new Promise(resolve => setTimeout(resolve, asyncDelay));

    // Guard: if a newer mount happened, abort
    if (mountGen !== gen) return;

    unsubFn = subscribe(taskId, gen);
  }

  // Simulates the useEffect cleanup
  function cleanupEffect() {
    mountGen++; // Invalidate in-flight async from previous effect run
    unsubFn?.();
    unsubFn = null;
  }

  return { mountEffect, cleanupEffect, getActiveListeners: () => activeListeners, getMountGen: () => mountGen };
}

describe('ChatShell subscribe dedup (StrictMode double-mount)', () => {
  it('normal mount: exactly one listener', async () => {
    const logic = createChatShellSubscriptionLogic();

    await logic.mountEffect('task-1', 10);

    expect(logic.getActiveListeners()).toHaveLength(1);
    expect(logic.getActiveListeners()[0].taskId).toBe('task-1');
  });

  it('StrictMode scenario: first mount async resolves after cleanup + remount → only one listener', async () => {
    const logic = createChatShellSubscriptionLogic();

    // First mount starts (slow async)
    const mount1 = logic.mountEffect('task-1', 50);

    // StrictMode immediately cleans up and remounts (fast async)
    logic.cleanupEffect();
    const mount2 = logic.mountEffect('task-1', 10);

    // Second mount completes first
    await mount2;
    expect(logic.getActiveListeners()).toHaveLength(1);

    // First mount's async finally resolves — should NOT add another listener
    await mount1;
    expect(logic.getActiveListeners()).toHaveLength(1);
    expect(logic.getActiveListeners()[0].gen).toBe(3); // Only the second mount's listener
  });

  it('rapid re-mounts with same taskId: only last mount wins', async () => {
    const logic = createChatShellSubscriptionLogic();

    // Simulate 4 rapid mount/cleanup cycles (worst case observed: 4x repetition)
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      logic.cleanupEffect();
      promises.push(logic.mountEffect('task-1', 5 + i * 2));
    }

    await Promise.all(promises);
    expect(logic.getActiveListeners()).toHaveLength(1);
    expect(logic.getActiveListeners()[0].gen).toBe(8);
  });

  it('different taskId: previous listener cleaned up, new one registered', async () => {
    const logic = createChatShellSubscriptionLogic();

    await logic.mountEffect('task-1', 5);
    expect(logic.getActiveListeners()).toHaveLength(1);

    // Navigate to different task
    logic.cleanupEffect();
    await logic.mountEffect('task-2', 5);

    expect(logic.getActiveListeners()).toHaveLength(1);
    expect(logic.getActiveListeners()[0].taskId).toBe('task-2');
  });

  it('cleanup before async resolves: no listener registered at all', async () => {
    const logic = createChatShellSubscriptionLogic();

    const mount1 = logic.mountEffect('task-1', 50);

    // Cleanup happens immediately (component unmounts entirely)
    logic.cleanupEffect();
    // Bump gen to simulate no remount (just unmount)
    // In real code the gen stays incremented from mountEffect

    await mount1;

    // The stale mount should not have registered
    expect(logic.getActiveListeners()).toHaveLength(0);
  });
});

describe('ChatShell handleEvent stale rejection', () => {
  it('events for stale taskId are ignored', () => {
    // Simulates handleEvent's currentLoadIdRef check
    let currentLoadId: string | null = 'task-2';
    const processedEvents: string[] = [];

    function handleEvent(eventTaskId: string, payload: string) {
      if (currentLoadId !== eventTaskId) return; // stale check
      processedEvents.push(payload);
    }

    handleEvent('task-1', 'stale-event');
    handleEvent('task-2', 'valid-event');

    expect(processedEvents).toEqual(['valid-event']);
  });
});
