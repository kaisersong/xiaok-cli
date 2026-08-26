import { describe, expect, it, vi } from 'vitest';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

describe('DesktopExecutionCoordinator', () => {
  it('serializes sibling model paths with FIFO admission', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1 });
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = coordinator.run(undefined, async () => {
      order.push('renderer:start');
      await firstGate;
      order.push('renderer:end');
    });
    const second = coordinator.run(undefined, async () => { order.push('goal'); });
    const third = coordinator.run(undefined, async () => { order.push('loop'); });
    await vi.waitFor(() => expect(order).toEqual(['renderer:start']));
    releaseFirst();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['renderer:start', 'renderer:end', 'goal', 'loop']);
  });

  it('removes an aborted waiter without leaking capacity', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1 });
    let releaseFirst!: () => void;
    const first = coordinator.run(undefined, async () => new Promise<void>(resolve => { releaseFirst = resolve; }));
    const controller = new AbortController();
    const waiting = coordinator.run(controller.signal, async () => 'never');
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow(/cancelled|abort/i);
    releaseFirst();
    await first;
    await expect(coordinator.run(undefined, async () => 'next')).resolves.toBe('next');
    expect(coordinator.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 });
  });
});
