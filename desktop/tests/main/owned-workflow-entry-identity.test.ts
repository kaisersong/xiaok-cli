// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createOwnedWorkflowNetworkFixture } from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron', () => ({ app: { isPackaged: false } }));

for (const variant of ['source', 'emitted'] as const) {
  it(`${variant} factory binds its private server canonical entry and rejects a different existing entry`, async () => {
    const module = variant === 'source'
      ? await import('../../electron/kswarm-service.js')
      : await import('../../dist/main/desktop/electron/kswarm-service.js');
    const moduleFile = variant === 'source'
      ? resolve(import.meta.dirname, '../../electron/kswarm-service.ts')
      : resolve(import.meta.dirname, '../../dist/main/desktop/electron/kswarm-service.js');
    const fixture = await createOwnedWorkflowNetworkFixture(null);
    const prior = { fetch: globalThis.fetch, entry: process.env.KSWARM_SERVER_PATH };
    const services: Array<ReturnType<typeof module.createKSwarmService>> = [];
    const spawn = vi.fn(() => { throw Error('fixture_foreign_spawn_denied'); });
    const kill = vi.fn(async () => { throw Error('fixture_foreign_kill_denied'); });
    try {
      const entry = realpathSync(resolve(import.meta.dirname, '../../../../kswarm/src/server/index.js'));
      const hash = module.computeKSwarmServiceSourceHash(entry);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      const health = await (await fixture.nativeFetch(`${fixture.base}/health`)).json();
      expect(module.checkKSwarmHealthServiceIdentity(health, entry, hash)).toMatchObject({ compatible: true });
      expect(new URL(fixture.base).port).not.toBe('4400');
      globalThis.fetch = fixture.forwardedFetch;
      process.env.KSWARM_SERVER_PATH = entry;
      const create = () => {
        const service = module.createKSwarmService({ spawnProcess: spawn as never, findPortOwner: async () => null, killStalePortOwner: kill });
        services.push(service); return service;
      };
      const own = create();
      await module.getKSwarmWorkflowReadPort(own);
      expect(own.getStatus().running).toBe(true);
      await module.sealAndDrainKSwarmServiceInstance(own);
      const foreign = join(fixture.root, 'different-entry', 'src', 'server', 'index.js');
      mkdirSync(resolve(foreign, '..'), { recursive: true });
      writeFileSync(foreign, '// Owned existing file; never the private server entry.\n');
      process.env.KSWARM_SERVER_PATH = realpathSync(foreign);
      const other = create();
      await expect(module.getKSwarmWorkflowReadPort(other)).rejects.toThrow('entry_path_mismatch');
      expect(other.getStatus().running).toBe(false);
      expect(spawn).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
      expect(fixture.requestLog.some(row => row.path === '/health' && row.ownedTarget === fixture.base)).toBe(true);
      expect(fixture.requestLog.every(row => row.ownedTarget === fixture.base || row.ownedTarget === fixture.brokerBase)).toBe(true);
      console.info('B_OWNED_ENTRY_IDENTITY', { variant, moduleFile, moduleSHA: createHash('sha256').update(readFileSync(moduleFile)).digest('hex'), privateBase: fixture.base, foreignDenied: true });
    } finally {
      const failures: unknown[] = [];
      for (const service of services) try { await module.sealAndDrainKSwarmServiceInstance(service); } catch (error) { failures.push(error); }
      globalThis.fetch = prior.fetch;
      if (prior.entry === undefined) delete process.env.KSWARM_SERVER_PATH; else process.env.KSWARM_SERVER_PATH = prior.entry;
      try { await fixture.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'owned_entry_identity_cleanup_failed');
    }
  }, 8000);
}
