import { describe, expect, it } from 'vitest';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';

describe('bounded project worker admission', () => {
  it('admits three project workers and bounds the fourth independently of other lanes', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1, projectControlCapacity: 1, projectWorkerCapacity: 3 });
    const fg = await c.acquireLease({ policy: 'ordinary', lane: 'foreground' });
    const bg = await c.acquireLease({ policy: 'ordinary', lane: 'background' });
    const po = await c.acquireLease({ policy: 'ordinary', lane: 'project_control' });
    const workers = [0, 1, 2].map(() => c.acquireLease({ policy: 'ordinary', lane: 'project_worker' }));
    workers.forEach(worker => { void worker.catch(() => undefined); });
    workers.forEach(worker => expect(worker.ticket).toBeDefined());
    const fourth = c.acquireLease({ policy: 'ordinary', lane: 'project_worker' });
    void fourth.catch(() => undefined);
    expect(fourth.ticket).toBeUndefined();
    expect(c.snapshot()).toEqual({ active: 6, waiting: 1, capacity: 6 });
    const leases = await Promise.all(workers);
    leases[0].release(); (await fourth).release();
    leases[1].release(); leases[2].release(); fg.release(); bg.release(); po.release();
    expect(c.snapshot().active).toBe(0);
  });
});

describe('foreground/background execution isolation', () => {
  it('admits foreground and children while background remains held, without admitting a second background', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1 });
    const bg = await c.acquireLease({ groupId: 'daily', policy: 'multiAgent', lane: 'background' });
    const queued = c.acquireLease({ groupId: 'daily2', policy: 'multiAgent', lane: 'background' });
    const fgRequest = c.acquireLease({ groupId: 'chat', policy: 'multiAgent' });
    expect(fgRequest.ticket).toBeDefined();
    expect(queued.ticket).toBeUndefined();
    const fg = await fgRequest;
    const a = await c.joinOrEnqueue('chat', fg.epoch, 'agent_work');
    const b = fg.retain();
    expect(a.lane).toBe('foreground');
    fg.release(); a.release(); b.release();
    expect(bg.released).toBe(false);
    expect(c.snapshot().active).toBe(1);
    bg.release(); (await queued).release();
    expect(c.snapshot().active).toBe(0);
  });

  it('does not let a blocked foreground group prevent the other lane, nor overlap group epochs', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1 });
    const first = await c.acquireLease({ groupId: 'g', policy: 'multiAgent' });
    const next = c.enqueueGroupTurn('g');
    const bg = c.acquireLease({ groupId: 'b', policy: 'multiAgent', lane: 'background' });
    expect(bg.ticket).toBeDefined();
    expect(next.ticket).toBeUndefined();
    first.release();
    (await next).release(); (await bg).release();
  });

  it('retains background lane even when the joining caller is foreground', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1 });
    const bg = await c.acquireLease({ groupId: 'b', policy: 'multiAgent', lane: 'background' });
    const child = await c.joinOrEnqueue('b', bg.epoch, 'agent_work');
    expect(child.lane).toBe('background');
    bg.release(); expect(c.snapshot().active).toBe(1);
    child.release(); expect(c.snapshot().active).toBe(0);
  });

  it('aborts queued background work without releasing the live lease', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1 });
    const bg = await c.acquireLease({ policy: 'ordinary', lane: 'background' });
    const ctl = new AbortController();
    const queued = c.acquireLease({ policy: 'ordinary', lane: 'background', signal: ctl.signal });
    const rejected = expect(queued).rejects.toThrow('cancel');
    ctl.abort(new Error('cancel')); await rejected;
    expect(bg.released).toBe(false);
    expect(c.snapshot().waiting).toBe(0);
    bg.release();
  });

  it('rejects invalid lane and disabled background capacity', async () => {
    const c = new DesktopExecutionCoordinator();
    await expect(c.acquireLease({ policy: 'ordinary', lane: 'background' })).rejects.toThrow(/lane|capacity/);
    await expect(c.acquireLease({ policy: 'ordinary', lane: 'bad' as any })).rejects.toThrow(/lane/);
  });
});

describe('project control admission', () => {
  it('runs PO control while foreground and a worker are occupied, still bounding the second control', async () => {
    const c = new DesktopExecutionCoordinator({ backgroundCapacity: 1, projectControlCapacity: 1 });
    const fg = await c.acquireLease({ policy: 'ordinary', lane: 'foreground' });
    const worker = await c.acquireLease({ policy: 'ordinary', lane: 'background' });
    const request = c.acquireLease({ policy: 'ordinary', lane: 'project_control' });
    expect(request.ticket).toBeDefined();
    const po = await request;
    const another = c.acquireLease({ policy: 'ordinary', lane: 'project_control' });
    expect(another.ticket).toBeUndefined();
    expect(c.snapshot().active).toBe(3);
    po.release(); (await another).release(); fg.release(); worker.release();
    expect(c.snapshot().active).toBe(0);
  });
});
