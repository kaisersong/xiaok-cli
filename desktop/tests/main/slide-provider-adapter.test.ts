import { describe, expect, it, vi } from 'vitest';
import {
  activateSlideProvider,
  assertDigestOwnedRuntime,
  SlideActivationError,
  type SlideConnection,
  type SlideRuntimeIdentity,
} from '../../electron/provider-gateways/slide-provider-adapter.js';
import { ProviderSlotDirectory } from '../../../src/platform/provider-runtime/provider-slot-directory.js';
import { componentInstanceKeyOf } from '../../../src/platform/provider-runtime/types.js';
import type { RendererProviderValue } from '../../electron/provider-gateways/create-host-gateways.js';

/** Design v58 §4.5 / §6.2 / R43-03 / R46-01. */
const RUNTIME: SlideRuntimeIdentity = {
  pythonCommand: '/home/u/.xiaok/plugins/.provider-store-v2/runtimes/kai-slide-creator/sha256-rt/gen-1/venv/bin/python',
  pythonArgs: ['-I', '-u'],
  runtimeContractDigest: 'sha256-rt',
  runtimeGenerationId: 'gen-1',
  environmentTemplateDigest: 'sha256-env',
};

const ALL_OPS = ['validate_brief', 'render_slide', 'list_presets', 'get_schema'];

function connection(overrides: Partial<SlideConnection> = {}): SlideConnection {
  return {
    listOperations: async () => ALL_OPS,
    call: async () => '{"ok":true}',
    close: async () => {},
    getChildPid: () => 4242,
    ...overrides,
  };
}

describe('slide provider activation', () => {
  it('commits only when the full four-operation set is advertised', async () => {
    const output = await activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection(),
      readinessSmoke: async () => {},
    });

    expect(output.childPid).toBe(4242);
    expect(await output.value.call({ operation: 'render_slide', input: {} }, new AbortController().signal))
      .toBe('{"ok":true}');
  });

  it('fails activation and closes the provisional child when an operation is missing', async () => {
    const close = vi.fn(async () => {});
    await expect(activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection({
        listOperations: async () => ['validate_brief', 'render_slide', 'list_presets'],
        close,
      }),
      readinessSmoke: async () => {},
    })).rejects.toThrow(/missing required operations: get_schema/);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('fails activation when the readiness smoke fails, releasing the child', async () => {
    const close = vi.fn(async () => {});
    await expect(activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection({ close }),
      readinessSmoke: async () => { throw new Error('minimal render failed'); },
    })).rejects.toThrow('minimal render failed');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the generation child exactly once however often closeOnce is called', async () => {
    const close = vi.fn(async () => {});
    const output = await activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection({ close }),
      readinessSmoke: async () => {},
    });

    await Promise.all([output.closeOnce(), output.closeOnce(), output.closeOnce()]);

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('slide runtime must be digest-owned', () => {
  it('rejects a PATH-resolved interpreter', () => {
    expect(() => assertDigestOwnedRuntime({ ...RUNTIME, pythonCommand: 'python3' }))
      .toThrow(/must be absolute/);
  });

  it('rejects the shared mutable venv that the design replaces', () => {
    expect(() => assertDigestOwnedRuntime({
      ...RUNTIME, pythonCommand: '/home/u/.xiaok/runtime/python-env/bin/python3',
    })).toThrow(/v2 runtime generation/);
  });

  it('requires the frozen -I -u argument pair', () => {
    expect(() => assertDigestOwnedRuntime({ ...RUNTIME, pythonArgs: ['-u'] }))
      .toThrow(/frozen as -I -u/);
  });

  it('requires the environment template to be part of the contract', () => {
    expect(() => assertDigestOwnedRuntime({ ...RUNTIME, environmentTemplateDigest: '' }))
      .toThrow(/environmentTemplateDigest/);
  });

  it('refuses to activate at all with a non-digest-owned runtime', async () => {
    await expect(activateSlideProvider({
      runtime: { ...RUNTIME, pythonCommand: 'python3' },
      connect: async () => connection(),
      readinessSmoke: async () => {},
    })).rejects.toThrow(SlideActivationError);
  });
});

describe('slide parallel-generation semantics (R43-03, R46-01)', () => {
  it('keeps the generation child ready across two default-output renders', async () => {
    const closes: number[] = [];
    const dir = new ProviderSlotDirectory();
    const provider = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-1');
    const output = await activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection({ close: async () => { closes.push(Date.now()); } }),
      readinessSmoke: async () => {},
    });
    dir.prepare({
      capabilityKey: 'mcp:slide-renderer',
      provider,
      resourceMode: 'parallel-generation',
      value: output.value,
      closeOnce: output.closeOnce,
    });
    dir.commit('mcp:slide-renderer', provider);

    // Two consecutive renders, each finalising its own promotion.
    for (let i = 0; i < 2; i += 1) {
      const lease = dir.acquire<RendererProviderValue>('mcp:slide-renderer', {
        budget: { executingMs: 61_000, finalizingMs: 34_000 },
      });
      await lease.value.call({ operation: 'render_slide', input: {} }, lease.signal);
      expect(lease.beginFinalizing()).toBe(true);
      lease.release();
      // The child must still be usable: promotion never closes a slide generation.
      expect(closes).toEqual([]);
    }

    expect(dir.closeOnceInvoked('mcp:slide-renderer', 'gen-1')).toBe(false);
  });

  it('closes the shared child once after a concurrent protected group settles', async () => {
    let closeCount = 0;
    const dir = new ProviderSlotDirectory();
    const provider = componentInstanceKeyOf('mcp:slide-renderer-provider', 'gen-1');
    const output = await activateSlideProvider({
      runtime: RUNTIME,
      connect: async () => connection({ close: async () => { closeCount += 1; } }),
      readinessSmoke: async () => {},
    });
    dir.prepare({
      capabilityKey: 'mcp:slide-renderer',
      provider,
      resourceMode: 'parallel-generation',
      value: output.value,
      closeOnce: output.closeOnce,
    });
    dir.commit('mcp:slide-renderer', provider);

    const budget = { executingMs: 61_000, finalizingMs: 34_000 };
    const first = dir.acquire<RendererProviderValue>('mcp:slide-renderer', { budget });
    const second = dir.acquire<RendererProviderValue>('mcp:slide-renderer', { budget });
    first.beginFinalizing();
    second.beginFinalizing();

    // The grouped close only applies once shutdown froze the protected set.
    const drain = dir.beginShutdown();
    expect(drain.generationDependencies.get('gen-1')?.protectedLeaseIds).toHaveLength(2);

    first.release();
    expect(closeCount).toBe(0); // the sibling promotion still needs the PID

    second.release();
    await Promise.resolve();

    expect(closeCount).toBe(1);
  });
});
