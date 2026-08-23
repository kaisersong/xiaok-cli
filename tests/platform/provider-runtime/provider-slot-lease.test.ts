import { describe, expect, it, vi } from 'vitest';
import { ProviderSlotDirectory } from '../../../src/platform/provider-runtime/provider-slot-directory.js';
import {
  componentInstanceKeyOf,
  ProviderUnavailableRetryError,
  type EffectHandle,
} from '../../../src/platform/provider-runtime/types.js';

const KEY = 'mcp:slide-renderer';
const GEN1 = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-1');
const GEN2 = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-2');
const BUDGET = { executingMs: 30_000, finalizingMs: 34_000 };

function commit(dir: ProviderSlotDirectory, gen = GEN1, value: unknown = { render: true }, closeOnce?: () => Promise<void>) {
  dir.prepare({ capabilityKey: KEY, provider: gen, resourceMode: 'parallel-generation', value, closeOnce });
  dir.commit(KEY, gen);
}

describe('ProviderSlotDirectory lease grant (design §3.4)', () => {
  it('grants leases only from a committed generation', () => {
    const dir = new ProviderSlotDirectory();
    dir.prepare({ capabilityKey: KEY, provider: GEN1, resourceMode: 'parallel-generation', value: {} });

    expect(() => dir.acquire(KEY, { budget: BUDGET })).toThrow(ProviderUnavailableRetryError);

    dir.commit(KEY, GEN1);
    const lease = dir.acquire<{ render?: boolean }>(KEY, { budget: BUDGET });

    expect(lease.generationId).toBe('gen-1');
    expect(dir.activeLeaseCount(KEY)).toBe(1);
  });

  it('stops granting from a retiring generation while draining it', async () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const inFlight = dir.acquire(KEY, { budget: BUDGET });
    commit(dir, GEN2);

    expect(dir.stateOf(KEY, 'gen-1')).toBe('retiring');
    expect(dir.acquire(KEY, { budget: BUDGET }).generationId).toBe('gen-2');

    const retired = dir.retire(KEY, 'gen-1');
    inFlight.release();
    await expect(retired).resolves.toEqual({ drained: true });
  });

  it('keeps the ledger keyed by leaseId and never double-decrements', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const a = dir.acquire(KEY, { budget: BUDGET });
    const b = dir.acquire(KEY, { budget: BUDGET });
    expect(dir.activeLeaseCount(KEY)).toBe(2);

    a.release();
    a.release();
    a.release();

    expect(dir.activeLeaseCount(KEY)).toBe(1);
    b.release();
    expect(dir.activeLeaseCount(KEY)).toBe(0);
  });

  it('bumps projection revision monotonically on commit and retire', async () => {
    const dir = new ProviderSlotDirectory();
    const start = dir.revision;
    commit(dir);
    commit(dir, GEN2);
    await dir.retire(KEY, 'gen-1');

    expect(dir.revision).toBeGreaterThan(start);
  });
});

describe('lease abort source freezing (design §3.4)', () => {
  it('freezes caller-first and ignores a later runtime abort', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const caller = new AbortController();
    const lease = dir.acquire(KEY, { budget: BUDGET, callerSignal: caller.signal });

    caller.abort();
    dir.abortNonProtected();

    expect(lease.abortSource).toBe('caller');
    expect(lease.signal.aborted).toBe(true);
  });

  it('freezes runtime-first and ignores a later caller abort', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const caller = new AbortController();
    const lease = dir.acquire(KEY, { budget: BUDGET, callerSignal: caller.signal });

    dir.abortNonProtected();
    caller.abort();

    expect(lease.abortSource).toBe('runtime');
  });

  it('reports an already-aborted caller signal at acquire time', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const caller = new AbortController();
    caller.abort();

    const lease = dir.acquire(KEY, { budget: BUDGET, callerSignal: caller.signal });

    expect(lease.abortSource).toBe('caller');
  });
});

describe('runtime deadline, settle grace and force revoke (design §3.4)', () => {
  it('aborts at the deadline, then force-closes invocation handles after the grace', async () => {
    vi.useFakeTimers();
    try {
      const dir = new ProviderSlotDirectory({ abortSettleGraceMs: 1_000 });
      commit(dir);
      const lease = dir.acquire(KEY, { budget: { executingMs: 5_000, finalizingMs: 1_000 } });
      const closed: string[] = [];
      const handle: EffectHandle = {
        owner: GEN1,
        kind: 'mcp-connection',
        resourceId: 'child-1',
        dispose: () => { closed.push('child-1'); },
      };
      lease.registerInvocationHandle(handle);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(lease.abortSource).toBe('runtime');
      expect(closed).toEqual([]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(closed).toEqual(['child-1']);
      expect(dir.activeLeaseCount(KEY)).toBe(0);

      // A late finally-release must not disturb the ledger any further.
      lease.release();
      expect(dir.activeLeaseCount(KEY)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not force-revoke a lease that settles inside the grace window', async () => {
    vi.useFakeTimers();
    try {
      const dir = new ProviderSlotDirectory({ abortSettleGraceMs: 1_000 });
      commit(dir);
      const lease = dir.acquire(KEY, { budget: { executingMs: 5_000, finalizingMs: 1_000 } });
      const closed: string[] = [];
      lease.registerInvocationHandle({
        owner: GEN1, kind: 'mcp-connection', resourceId: 'child-2', dispose: () => { closed.push('x'); },
      });

      await vi.advanceTimersByTimeAsync(5_000);
      lease.release();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(closed).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('revoking one lease leaves a sibling lease intact', async () => {
    vi.useFakeTimers();
    try {
      const dir = new ProviderSlotDirectory({ abortSettleGraceMs: 500 });
      commit(dir);
      const doomed = dir.acquire(KEY, { budget: { executingMs: 1_000, finalizingMs: 1_000 } });
      const healthy = dir.acquire(KEY, { budget: { executingMs: 60_000, finalizingMs: 1_000 } });

      await vi.advanceTimersByTimeAsync(1_500);

      expect(doomed.abortSource).toBe('runtime');
      expect(healthy.abortSource).toBe('none');
      expect(healthy.signal.aborted).toBe(false);
      expect(dir.activeLeaseCount(KEY, 'gen-1')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('protected finalization (design §3.4, §5.5)', () => {
  it('protects a finalizing lease from runtime abort', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const lease = dir.acquire(KEY, { budget: BUDGET });

    expect(lease.beginFinalizing()).toBe(true);
    expect(lease.phase).toBe('finalizing');

    dir.abortNonProtected();

    expect(lease.signal.aborted).toBe(false);
    expect(lease.abortSource).toBe('none');
  });

  it('beginShutdown freezes the protected set and refuses later transitions', () => {
    const dir = new ProviderSlotDirectory();
    commit(dir);
    const parsed = dir.acquire(KEY, { budget: BUDGET });
    const racing = dir.acquire(KEY, { budget: BUDGET });
    parsed.beginFinalizing();

    const drain = dir.beginShutdown();

    expect(drain.leases.map((l) => l.leaseId)).toEqual([parsed.leaseId]);
    expect(drain.generationDependencies.get('gen-1')?.protectedLeaseIds).toEqual([parsed.leaseId]);
    // Shutdown won the race for this one: it can no longer become protected.
    expect(racing.beginFinalizing()).toBe(false);
    expect(racing.phase).toBe('executing');
  });

  it('closes a shared generation child once, only after the whole group settles', async () => {
    let closes = 0;
    const dir = new ProviderSlotDirectory();
    commit(dir, GEN1, { render: true }, async () => { closes += 1; });
    const l1 = dir.acquire(KEY, { budget: BUDGET });
    const l2 = dir.acquire(KEY, { budget: BUDGET });
    l1.beginFinalizing();
    l2.beginFinalizing();

    // The grouped close is a retire/shutdown behaviour: during normal operation a
    // parallel-generation child must stay ready after a promotion settles
    // (design R43-03), so shutdown has to freeze the set first.
    dir.beginShutdown();

    l1.release();
    expect(closes).toBe(0);
    expect(dir.closeOnceInvoked(KEY, 'gen-1')).toBe(false);

    l2.release();
    await Promise.resolve();

    expect(closes).toBe(1);
    expect(dir.closeOnceInvoked(KEY, 'gen-1')).toBe(true);
  });
});
