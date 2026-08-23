import { describe, expect, it } from 'vitest';
import { ComponentEffectScope, EffectScopeContractViolation } from '../../../src/platform/provider-runtime/effect-scope.js';
import { componentInstanceKeyOf, type EffectHandle } from '../../../src/platform/provider-runtime/types.js';

const OWNER = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-1');

function handle(
  resourceId: string,
  onDispose: () => void | Promise<void>,
  owner = OWNER,
  kind = 'mcp-connection',
): EffectHandle {
  return { owner, kind, resourceId, dispose: onDispose };
}

describe('ComponentEffectScope (design §3.3)', () => {
  it('releases handles in LIFO order', async () => {
    const order: string[] = [];
    const scope = new ComponentEffectScope(OWNER);
    scope.register(handle('a', () => { order.push('a'); }));
    scope.register(handle('b', () => { order.push('b'); }));
    scope.register(handle('c', () => { order.push('c'); }));

    const result = await scope.dispose();

    expect(order).toEqual(['c', 'b', 'a']);
    expect(result.disposed).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it('is idempotent at scope and handle level', async () => {
    let calls = 0;
    const scope = new ComponentEffectScope(OWNER);
    const registered = scope.register(handle('a', () => { calls += 1; }));

    await registered.dispose();
    await registered.dispose();
    const first = await scope.dispose();
    const second = await scope.dispose();

    expect(calls).toBe(1);
    expect(first).toBe(second);
    // The handle disposed itself, so the scope has nothing left to release.
    expect(first.disposed).toBe(0);
  });

  it('keeps releasing after a disposer throws and aggregates the failure', async () => {
    const order: string[] = [];
    const scope = new ComponentEffectScope(OWNER);
    scope.register(handle('first', () => { order.push('first'); }));
    scope.register(handle('boom', () => { throw new Error('close failed'); }, OWNER, 'child-process'));
    scope.register(handle('last', () => { order.push('last'); }));

    const result = await scope.dispose();

    expect(order).toEqual(['last', 'first']);
    expect(result.disposed).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ kind: 'child-process', resourceId: 'boom' });
    expect(result.failures[0].error.message).toBe('close failed');
  });

  it('awaits async disposers before reporting completion', async () => {
    let released = false;
    const scope = new ComponentEffectScope(OWNER);
    scope.register(handle('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      released = true;
    }));

    await scope.dispose();

    expect(released).toBe(true);
  });

  it('refuses handles owned by another generation', () => {
    const scope = new ComponentEffectScope(OWNER);
    const other = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-2');

    expect(() => scope.register(handle('a', () => {}, other)))
      .toThrow(EffectScopeContractViolation);
  });

  it('refuses registration into a disposed scope instead of leaking', async () => {
    const scope = new ComponentEffectScope(OWNER);
    await scope.dispose();

    expect(() => scope.register(handle('late', () => {})))
      .toThrow(EffectScopeContractViolation);
  });

  it('reports a duration measured by the injected clock', async () => {
    let now = 1_000;
    const scope = new ComponentEffectScope(OWNER, () => now);
    scope.register(handle('a', () => { now += 40; }));

    const result = await scope.dispose();

    expect(result.durationMs).toBe(40);
  });
});
