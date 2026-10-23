import { describe, expect, it, vi } from 'vitest';
import { withObservationExecutionOwner, resolveObservationProviderDisclosure, hasObservationExecutionOwner } from '../../../src/runtime/sol-pi/observation-execution-scope.js';

describe('host observation async execution ownership', () => {
  function owner() {
    const contexts = new WeakSet<object>();
    const prepareProviderDisclosure = vi.fn(() => { const cap = Object.freeze({}) as never; contexts.add(cap); return cap; });
    return { prepareProviderDisclosure, ownsDisclosure: (cap: object) => contexts.has(cap), hasDependencies: () => true };
  }
  it('preserves per-run authority across await without shared adapter state', async () => {
    const a = owner(), b = owner();
    await Promise.all([a, b].map(o => withObservationExecutionOwner(o, async () => {
      await Promise.resolve(); const cap = resolveObservationProviderDisclosure();
      expect(o.ownsDisclosure(cap!)).toBe(true); expect(hasObservationExecutionOwner()).toBe(true);
    })));
    expect(resolveObservationProviderDisclosure()).toBeUndefined(); expect(hasObservationExecutionOwner()).toBe(false);
  });
  it('reuses the explicit owned invocation cap, but not one from another owner', async () => {
    const a = owner(), b = owner(); const foreign = b.prepareProviderDisclosure();
    await withObservationExecutionOwner(a, async () => {
      const cap = resolveObservationProviderDisclosure();
      expect(resolveObservationProviderDisclosure(cap)).toBe(cap); expect(a.prepareProviderDisclosure).toHaveBeenCalledOnce();
      expect(() => resolveObservationProviderDisclosure(foreign)).toThrow(/OWNER/);
    });
  });
  it('does not allow clearing an inherited protected scope for child or side-call', async () => {
    const a = owner();
    await withObservationExecutionOwner(a, async () => {
      expect(() => withObservationExecutionOwner(undefined, () => 'unprotected')).toThrow(/HANDOFF/);
      expect(() => withObservationExecutionOwner(owner(), () => 'other owner')).toThrow(/HANDOFF/);
    });
  });
});
