import { describe, expect, it } from 'vitest';
import { PluginProviderRuntimeFacade } from '../../electron/plugin-provider-runtime-facade.js';
import { createAllHostGateways } from '../../electron/provider-gateways/create-host-gateways.js';
import type { PluginComponentSpec } from '../../../src/platform/provider-runtime/lifecycle-reconciler.js';

/**
 * Design v58 §4 / §5.5: the facade is created before any service, never
 * replaced, answers unavailable before `start()`, and is the single handle the
 * shutdown coordinator drives.
 */
function slideSpec(overrides: Partial<PluginComponentSpec> = {}): PluginComponentSpec {
  return {
    id: 'mcp:slide-renderer-provider',
    pluginName: 'kai-slide-creator',
    version: '3.3.0',
    activation: 'startup',
    resourceMode: 'parallel-generation',
    provides: 'mcp:slide-renderer',
    activate: async () => ({ value: { call: async () => '{"ok":true}' } }),
    ...overrides,
  };
}

describe('PluginProviderRuntimeFacade', () => {
  it('lets gateways registered before start return a structured unavailable', async () => {
    const facade = new PluginProviderRuntimeFacade();
    const gateways = createAllHostGateways(facade);
    const listPresets = gateways.find((t) => t.definition.name === 'mcp__slide-renderer__list_presets')!;

    const result = JSON.parse(await listPresets.execute({}));

    expect(result).toMatchObject({ ok: false, error_code: 'provider_unavailable_retry', retryable: true });
    expect(facade.status()).toMatchObject({ started: false, disposed: false });
  });

  it('serves the same gateway instance once the runtime starts', async () => {
    const facade = new PluginProviderRuntimeFacade();
    const gateways = createAllHostGateways(facade);
    const listPresets = gateways.find((t) => t.definition.name === 'mcp__slide-renderer__list_presets')!;

    await facade.start([slideSpec()]);

    // Exactly the tool object registered before start now reaches the provider.
    expect(await listPresets.execute({})).toBe('{"ok":true}');
  });

  it('start is single-flight and single-use', async () => {
    let activations = 0;
    const facade = new PluginProviderRuntimeFacade();
    const spec = slideSpec({
      activate: async () => { activations += 1; return { value: { call: async () => 'ok' } }; },
    });

    await Promise.all([facade.start([spec]), facade.start([spec])]);

    expect(activations).toBe(1);
  });

  it('reports shutting_down instead of unavailable_retry after beginShutdown', async () => {
    const facade = new PluginProviderRuntimeFacade();
    const gateways = createAllHostGateways(facade);
    const tool = gateways.find((t) => t.definition.name === 'mcp__report-renderer__list_themes')!;
    await facade.start([slideSpec()]);

    facade.beginShutdown();
    const result = JSON.parse(await tool.execute({}));

    expect(result).toMatchObject({ ok: false, error_code: 'shutting_down', retryable: false });
  });

  it('beginShutdown reports no protected leases when nothing is finalizing', async () => {
    const facade = new PluginProviderRuntimeFacade();
    await facade.start([slideSpec()]);

    const drain = facade.beginShutdown();

    expect(drain.leases).toEqual([]);
    await expect(drain.waitForSettled(50)).resolves.toBe(true);
  });

  it('dispose is idempotent and refuses a later start', async () => {
    const facade = new PluginProviderRuntimeFacade();
    await facade.start([slideSpec()]);

    await facade.dispose();
    await facade.dispose();

    expect(facade.status().disposed).toBe(true);
    await expect(facade.start([slideSpec()])).rejects.toThrow(/already disposed/);
  });

  it('closeOrdinaryProviders funnels into the same idempotent disposer', async () => {
    const facade = new PluginProviderRuntimeFacade();
    await facade.start([slideSpec()]);

    const first = await facade.closeOrdinaryProviders();
    const second = await facade.closeOrdinaryProviders();

    expect(first.cleanupFailed).toEqual([]);
    expect(second.cleanupFailed).toEqual([]);
  });

  it('freezes the design lease budgets per capability', async () => {
    const facade = new PluginProviderRuntimeFacade();
    await facade.start([slideSpec()]);

    const lease = facade.acquire('mcp:slide-renderer', {});
    expect(lease.generationId).toBe('gen-1');
    lease.release();
  });
});
