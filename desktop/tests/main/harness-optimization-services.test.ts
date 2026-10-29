// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

describe.skipIf(process.platform !== 'darwin')('real Desktop services D0 ownership', () => {
  it('denies a forged actor before lazy initialization and binds the trusted main actor once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-desktop-services-'));
    const actor = Object.freeze({ requestSource: 'user', principalId: 'desktop-main-window' });
    const kswarm = { start: async () => {}, stop: async () => {}, restart: async () => {},
      getStatus: () => ({ running: false, port: 4400, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'synthetic-token',
      request: async () => new Response('{}', { status: 501 }) } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: root, workspaceRoot: root, kswarmService: kswarm,
      harnessOptimizationUserActor: actor, runner: async () => ({ reply: 'synthetic', totalToolCalls: 0 }) });
    try {
      await expect(services.saveHarnessOptimizationConfig({ mode: 'probe' }, { ...actor })).rejects.toThrow('actor_forbidden');
      expect(existsSync(join(root, 'harness-optimization-owner.json'))).toBe(false);
      const [first, second] = await Promise.all([services.getHarnessOptimizationConfig(), services.getHarnessOptimizationConfig()]);
      expect(first.status).toBe('ready'); expect(second.ownerId).toBe(first.ownerId);
      expect(await services.saveHarnessOptimizationConfig({ mode: 'probe' }, actor)).toMatchObject({ config: { mode: 'probe', enabled: false } });
      await expect(services.setHarnessOptimizationEnabled(true, actor)).rejects.toThrow('public_unavailable');
    } finally { await services.disposeMultiAgent(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
});
