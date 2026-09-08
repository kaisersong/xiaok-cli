import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

describe('BDD: desktop execution-group lease', () => {
  const held: Array<{ release(): void }> = [];
  afterEach(() => {
    for (const member of held.splice(0).reverse()) member.release();
    vi.useRealTimers();
  });
  function keep<T extends { release(): void }>(member: T): T { held.push(member); return member; }

  it('A1 Given capacity=1, When two children retain a root lease, Then both start without another top-level acquire', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 1 });
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const first = keep(root.retain());
    const second = keep(root.retain());
    expect(root.refCount).toBe(3);
    expect(coordinator.snapshot()).toEqual({ active: 1, waiting: 0, capacity: 1 });
    root.release();
    expect(root.refCount).toBe(2);
    first.release();
    expect(coordinator.snapshot().active).toBe(1);
    second.release();
    expect(root.released).toBe(true);
    expect(coordinator.snapshot().active).toBe(0);
  });

  it('A16 Given the last member released, When release repeats or retain is attempted, Then no negative count or resurrection occurs', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    root.release();
    root.release();
    expect(root.refCount).toBe(0);
    expect(() => root.retain()).toThrow(/released|stale/i);
    expect(coordinator.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 });
    const next = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    expect(next.epoch).not.toBe(root.epoch);
  });

  it('A28 Given G1 and waiting X, When a ready UI followup U and then Y queue, Then admission is X/U/Y', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const order: string[] = [];
    const x = coordinator.run(undefined, async () => { order.push('X'); });
    const u = coordinator.joinOrEnqueue('g1', root.epoch, 'user_followup').then(member => {
      order.push('U');
      member.release();
    });
    const y = coordinator.run(undefined, async () => { order.push('Y'); });
    expect(coordinator.snapshot().waiting).toBe(3);
    expect(root.refCount).toBe(1);
    root.release();
    await Promise.all([x, u, y]);
    expect(order).toEqual(['X', 'U', 'Y']);
    expect(coordinator.snapshot().active).toBe(0);
  });

  it('A18 Given external X already waits, When a running parent spawns bounded descendant work, Then it retains rather than deadlocking behind X', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    let xRan = false;
    const x = coordinator.run(undefined, async () => { xRan = true; });
    const child = keep(await coordinator.joinOrEnqueue('g1', root.epoch, 'agent_work'));
    expect(root.refCount).toBe(2);
    expect(xRan).toBe(false);
    root.release();
    expect(xRan).toBe(false);
    child.release();
    await x;
    expect(xRan).toBe(true);
  });

  it('A28 Given X/U/Y queued, When U is cancelled, Then exactly U is removed and X/Y keep FIFO order', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const controller = new AbortController();
    const order: string[] = [];
    const x = coordinator.run(undefined, async () => { order.push('X'); });
    const u = coordinator.joinOrEnqueue('g1', root.epoch, 'user_followup', controller.signal);
    const rejected = expect(u).rejects.toThrow(/cancelled|abort/i);
    const y = coordinator.run(undefined, async () => { order.push('Y'); });
    controller.abort(new Error('cancelled'));
    await rejected;
    expect(coordinator.snapshot().waiting).toBe(2);
    root.release();
    await Promise.all([x, y]);
    expect(order).toEqual(['X', 'Y']);
  });

  it('A40 Given an immediate grant before its await continuation, When the signal aborts, Then the granted ticket is owned and can be released once', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const controller = new AbortController();
    const acquisition = coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent', signal: controller.signal });
    expect(coordinator.snapshot().active).toBe(1);
    controller.abort();
    const ticket = keep(await acquisition);
    ticket.release();
    ticket.release();
    expect(coordinator.snapshot()).toEqual({ active: 0, waiting: 0, capacity: 1 });
  });

  it('A16 Given queued ordinary work, When an unsettled group blocks the runtime, Then all waiters fail without releasing the live group', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const action = vi.fn();
    const x = coordinator.run(undefined, action);
    const rejected = expect(x).rejects.toThrow(/runtime_blocked/);
    coordinator.block('runtime_blocked');
    await rejected;
    expect(action).not.toHaveBeenCalled();
    expect(root.refCount).toBe(1);
    expect(coordinator.snapshot().active).toBe(1);
    await expect(coordinator.run(undefined, action)).rejects.toThrow(/runtime_blocked/);
  });

  it('A27 Given ordinary work with its own 40 minute watchdog, When 28 minutes elapse, Then a multi-agent deadline is not imposed', async () => {
    vi.useFakeTimers();
    const coordinator = new DesktopExecutionCoordinator();
    const ordinary = keep(await coordinator.acquireLease({ policy: 'ordinary' }));
    expect(ordinary.deadlineAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(28 * 60_000);
    expect(ordinary.released).toBe(false);
    expect(coordinator.snapshot().active).toBe(1);
  });

  it('A18 Given a live lease near its deadline, When a new root joins, Then the deadline and epoch do not reset', async () => {
    vi.useFakeTimers();
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const deadline = root.deadlineAt;
    await vi.advanceTimersByTimeAsync(27 * 60_000);
    const next = keep(await coordinator.joinOrEnqueue('g1', root.epoch, 'root'));
    expect(next.deadlineAt).toBe(deadline);
    expect(next.epoch).toBe(root.epoch);
  });

  it('A31 Given startup reconciliation is pending, When ordinary work queues, Then no action runs until the readiness gate opens', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    coordinator.setReady(false);
    const action = vi.fn(async () => 'done');
    const work = coordinator.run(undefined, action);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    expect(coordinator.snapshot().active).toBe(0);
    coordinator.setReady(true);
    await expect(work).resolves.toBe('done');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('A28 Given spare capacity behind a same-group FIFO head, When the head is cancelled, Then the next waiter is dispatched immediately', async () => {
    const coordinator = new DesktopExecutionCoordinator({ capacity: 2 });
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    coordinator.setReady(false);
    const controller = new AbortController();
    const u = coordinator.joinOrEnqueue('g1', root.epoch, 'user_followup', controller.signal);
    const rejected = expect(u).rejects.toThrow(/abort/i);
    const action = vi.fn(async () => undefined);
    const next = coordinator.run(undefined, action);
    coordinator.setReady(true);
    expect(action).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
    await Promise.resolve();
    expect(action).toHaveBeenCalledOnce();
    await next;
  });

  it('A18 Given an expired live lease, When another member is requested, Then no work may renew or retain it', async () => {
    vi.useFakeTimers();
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    await vi.advanceTimersByTimeAsync(28 * 60_000);
    expect(() => root.retain()).toThrow(/expired/);
    await expect(coordinator.joinOrEnqueue('g1', root.epoch, 'agent_work')).rejects.toThrow(/expired/);
    expect(root.refCount).toBe(1);
    expect(root.released).toBe(false);
  });

  it('A32 Given old group work still owns a lease, When a busy followup becomes ready, Then its forced admission cannot retain that epoch', async () => {
    const coordinator = new DesktopExecutionCoordinator();
    const root = keep(await coordinator.acquireLease({ groupId: 'g1', policy: 'multiAgent' }));
    const next = coordinator.enqueueGroupTurn('g1');
    expect(next.ticket).toBeUndefined();
    expect(root.refCount).toBe(1);
    expect(coordinator.snapshot().waiting).toBe(1);
    root.release();
    const ticket = keep(await next);
    expect(ticket.epoch).not.toBe(root.epoch);
  });
});
