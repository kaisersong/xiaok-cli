import { describe, expect, it } from 'vitest';
import {
  BlockedManifestError,
  LifecycleReconciler,
  type ActivationResult,
  type ComponentActivationContext,
  type PluginComponentSpec,
} from '../../../src/platform/provider-runtime/lifecycle-reconciler.js';
import { ProviderSlotDirectory } from '../../../src/platform/provider-runtime/provider-slot-directory.js';
import { ProviderUnavailableRetryError } from '../../../src/platform/provider-runtime/types.js';

const KEY = 'mcp:cua-driver';
const BUDGET = { executingMs: 120_000, finalizingMs: 1_000 };

function spec(overrides: Partial<PluginComponentSpec> & { activate: PluginComponentSpec['activate'] }): PluginComponentSpec {
  return {
    id: 'mcp:cua-driver-provider',
    pluginName: 'cua-computer-use',
    version: '0.2.1',
    activation: 'user',
    resourceMode: 'shared-host',
    provides: KEY,
    ...overrides,
  };
}

function okActivate(value: unknown = { call: true }): PluginComponentSpec['activate'] {
  return async () => ({ value } satisfies ActivationResult);
}

describe('LifecycleReconciler activation (design §5.2)', () => {
  it('activates a user component only after an explicit user enable', async () => {
    const dir = new ProviderSlotDirectory();
    const r = new LifecycleReconciler(dir);
    r.register(spec({ activate: okActivate() }));

    expect(r.projection('mcp:cua-driver-provider').runtimeState).toBe('inactive');
    expect(() => dir.acquire(KEY, { budget: BUDGET })).toThrow(ProviderUnavailableRetryError);

    await r.setDesiredActive('mcp:cua-driver-provider', true, 'user');

    const p = r.projection('mcp:cua-driver-provider');
    expect(p.runtimeState).toBe('active');
    expect(p.ready).toBe(true);
    expect(p.committedGeneration).toBe('gen-1');
    expect(dir.acquire(KEY, { budget: BUDGET }).generationId).toBe('gen-1');
  });

  it('startup components converge from persisted state without a mutation call', async () => {
    const r = new LifecycleReconciler();
    r.register(spec({ id: 'mcp:slide', activation: 'startup', provides: 'mcp:slide-renderer', activate: okActivate() }));

    await r.reconcileFromPersistedState({ 'mcp:slide': true });

    expect(r.projection('mcp:slide').runtimeState).toBe('active');
  });

  it('rolls back the provisional scope when desired revision moves mid-activation', async () => {
    const disposed: string[] = [];
    const r = new LifecycleReconciler();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    r.register(spec({
      activate: async (ctx: ComponentActivationContext) => {
        ctx.scope.register({
          owner: ctx.provider, kind: 'mcp-connection', resourceId: 'child',
          dispose: () => { disposed.push('child'); },
        });
        await gate;
        return { value: { call: true } };
      },
    }));

    const enabling = r.setDesiredActive('mcp:cua-driver-provider', true, 'user');
    await Promise.resolve();
    // User disables while activation is still awaiting its external step.
    const disabling = r.setDesiredActive('mcp:cua-driver-provider', false, 'user');
    release?.();
    await Promise.all([enabling, disabling]);

    expect(disposed).toEqual(['child']);
    const p = r.projection('mcp:cua-driver-provider');
    expect(p.committedGeneration).toBeNull();
    expect(p.runtimeState).toBe('inactive');
  });

  it('keeps the old generation serving when a replacement activation fails', async () => {
    const dir = new ProviderSlotDirectory();
    const r = new LifecycleReconciler(dir);
    let attempt = 0;
    r.register(spec({
      activate: async () => {
        attempt += 1;
        if (attempt === 1) return { value: { generation: 1 } };
        throw new Error('readiness smoke failed');
      },
    }));

    await r.setDesiredActive('mcp:cua-driver-provider', true, 'user');
    expect(r.projection('mcp:cua-driver-provider').committedGeneration).toBe('gen-1');

    const outcome = await r.replaceGeneration('mcp:cua-driver-provider');

    expect(outcome).toEqual({ replaced: false });
    const p = r.projection('mcp:cua-driver-provider');
    expect(p.runtimeState).toBe('active_degraded');
    expect(p.ready).toBe(true);
    expect(p.committedGeneration).toBe('gen-1');
    expect(p.lastError).toBe('readiness smoke failed');

    const lease = dir.acquire<{ generation: number }>(KEY, { budget: BUDGET });
    expect(lease.value.generation).toBe(1);
    lease.release();
  });

  it('maps an unresolvable manifest to blocked_manifest, not failed', async () => {
    const r = new LifecycleReconciler();
    r.register(spec({ activate: async () => { throw new BlockedManifestError('active pointer invalid'); } }));

    await r.setDesiredActive('mcp:cua-driver-provider', true, 'user');

    const p = r.projection('mcp:cua-driver-provider');
    expect(p.runtimeState).toBe('blocked_manifest');
    expect(p.blockedBy).toBe('active pointer invalid');
    expect(p.ready).toBe(false);
  });
});

describe('LifecycleReconciler replacement (design §5.3)', () => {
  it('swaps generations without a window where callers get unavailable', async () => {
    const dir = new ProviderSlotDirectory();
    const r = new LifecycleReconciler(dir);
    let generation = 0;
    r.register(spec({ activate: async () => { generation += 1; return { value: { generation } }; } }));
    await r.setDesiredActive('mcp:cua-driver-provider', true, 'user');

    const before = dir.acquire<{ generation: number }>(KEY, { budget: BUDGET });
    const outcome = await r.replaceGeneration('mcp:cua-driver-provider');
    const after = dir.acquire<{ generation: number }>(KEY, { budget: BUDGET });

    expect(outcome).toEqual({ replaced: true });
    // The in-flight lease keeps its own generation; new callers get the new one.
    expect(before.value.generation).toBe(1);
    expect(after.value.generation).toBe(2);
    before.release();
    after.release();
  });
});

describe('LifecycleReconciler single-flight and convergence (design §4.1)', () => {
  it('never runs two activations concurrently for one component', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const r = new LifecycleReconciler();
    r.register(spec({
      activate: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
        return { value: {} };
      },
    }));

    await Promise.all([
      r.setDesiredActive('mcp:cua-driver-provider', true, 'user'),
      r.retry('mcp:cua-driver-provider', 'user'),
      r.retry('mcp:cua-driver-provider', 'user'),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(r.projection('mcp:cua-driver-provider').runtimeState).toBe('active');
  });

  it('converges to the final desired state after rapid enable/disable churn', async () => {
    const r = new LifecycleReconciler();
    r.register(spec({ activate: okActivate() }));
    const id = 'mcp:cua-driver-provider';

    await Promise.all([
      r.setDesiredActive(id, true, 'user'),
      r.setDesiredActive(id, false, 'user'),
      r.setDesiredActive(id, true, 'user'),
    ]);

    const p = r.projection(id);
    expect(p.desiredActive).toBe(true);
    expect(p.runtimeState).toBe('active');
    expect(p.committedGeneration).not.toBeNull();
  });

  it('retry does not activate a disabled component and does not write desired state', async () => {
    let activations = 0;
    const r = new LifecycleReconciler();
    r.register(spec({ activate: async () => { activations += 1; return { value: {} }; } }));

    await r.retry('mcp:cua-driver-provider', 'user');

    expect(activations).toBe(0);
    expect(r.projection('mcp:cua-driver-provider').desiredActive).toBe(false);
  });

  it('rejects desired-state mutation without an explicit user request source', async () => {
    const r = new LifecycleReconciler();
    r.register(spec({ activate: okActivate() }));

    // @ts-expect-error contract: only 'user' is accepted
    await expect(r.setDesiredActive('mcp:cua-driver-provider', true, 'agent')).rejects.toThrow(/requestSource/);
  });

  it('one component failing does not block reconciliation of a sibling', async () => {
    const r = new LifecycleReconciler();
    r.register(spec({ activate: async () => { throw new Error('boom'); } }));
    r.register(spec({
      id: 'mcp:report', provides: 'mcp:report-renderer', resourceMode: 'invocation-scoped', activate: okActivate(),
    }));

    await Promise.all([
      r.setDesiredActive('mcp:cua-driver-provider', true, 'user'),
      r.setDesiredActive('mcp:report', true, 'user'),
    ]);

    expect(r.projection('mcp:cua-driver-provider').runtimeState).toBe('failed');
    expect(r.projection('mcp:report').runtimeState).toBe('active');
  });
});

describe('LifecycleReconciler health signals (design §5.4)', () => {
  it('archives only persistent failure codes and clears them on a successful commit', async () => {
    const archived: string[] = [];
    const cleared: string[] = [];
    const r = new LifecycleReconciler(new ProviderSlotDirectory(), {
      onArchivePersistentFailure: (s) => archived.push(s.failureCode),
      onClearPersistentFailure: (id) => cleared.push(id),
    });
    const id = 'mcp:cua-driver-provider';
    r.register(spec({ activate: okActivate() }));
    await r.setDesiredActive(id, true, 'user');

    r.submitHealthSignal({
      componentId: id, generationId: 'gen-1', failureCode: 'COMPUTER_USE_NEEDS_ACCESSIBILITY', persistent: true,
    });
    r.submitHealthSignal({
      componentId: id, generationId: 'gen-1', failureCode: 'connect_timeout', persistent: false,
    });
    await r.applyPendingHealthSignals(id);

    expect(archived).toEqual(['COMPUTER_USE_NEEDS_ACCESSIBILITY']);
    // Recovery re-activated the component, so the persistent flag is cleared.
    expect(cleared).toContain(id);
    expect(r.projection(id).committedGeneration).toBe('gen-2');
  });

  it('ignores a health signal that names an already-replaced generation', async () => {
    const archived: string[] = [];
    const r = new LifecycleReconciler(new ProviderSlotDirectory(), {
      onArchivePersistentFailure: (s) => archived.push(s.failureCode),
    });
    const id = 'mcp:cua-driver-provider';
    r.register(spec({ activate: okActivate() }));
    await r.setDesiredActive(id, true, 'user');

    r.submitHealthSignal({ componentId: id, generationId: 'gen-999', failureCode: 'DRIVER_MISSING', persistent: true });
    await r.applyPendingHealthSignals(id);

    expect(archived).toEqual([]);
    expect(r.projection(id).committedGeneration).toBe('gen-1');
  });
});
