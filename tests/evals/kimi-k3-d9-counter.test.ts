import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function loadCounterModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/counter-store.mjs',
  )).href);
}

describe('Kimi K3 D9 counter namespaces', () => {
  it('derives the frozen canonical key and rejects replay or overflow', async () => {
    const { InvocationCounterStore, deriveCounterNamespaceKey } = await loadCounterModule();
    const identity = {
      armNonceHex: 'ab'.repeat(32),
      sessionInvocationUuid: '00000000-0000-4000-8000-000000000001',
      invocationIndex: 0n,
    };
    const key = deriveCounterNamespaceKey(identity);

    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(key).toBe(deriveCounterNamespaceKey({ ...identity }));
    expect(() => deriveCounterNamespaceKey({
      ...identity,
      invocationIndex: 18_446_744_073_709_551_616n,
    })).toThrow('KIMI_D9_COUNTER_INDEX_OVERFLOW');

    const store = new InvocationCounterStore();
    store.accept(key);
    expect(() => store.accept(key)).toThrow('KIMI_D9_COUNTER_REPLAY');
  });

  it('keeps concurrent invocation namespaces disjoint', async () => {
    const { InvocationCounterStore, deriveCounterNamespaceKey } = await loadCounterModule();
    const armNonceHex = 'cd'.repeat(32);
    const keys = Array.from({ length: 32 }, (_, invocationIndex) =>
      deriveCounterNamespaceKey({
        armNonceHex,
        sessionInvocationUuid: randomUUID(),
        invocationIndex: BigInt(invocationIndex),
      }));

    expect(new Set(keys).size).toBe(keys.length);
    const store = new InvocationCounterStore();
    await Promise.all(keys.map(async (key: string) => {
      store.accept(key);
      store.increment(key, 'fixtureMcpInvocation');
    }));
    expect(keys.every((key: string) =>
      store.snapshot(key).fixtureMcpInvocation === 1)).toBe(true);
  });
});
