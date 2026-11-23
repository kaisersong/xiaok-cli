// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {ownedProfileTempDir as mkdtempSync} from '../support/profile-storage-fixture.js';
import {cleanupPrivateTestTempDir} from '../../../tests/support/private-temp.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { mockKSwarmService } from '../support/desktop-services-fixtures.js';

describe('desktop services model catalog', () => {
  let rootDir: string;
  let previousConfigDir: string | undefined;
  let services: ReturnType<typeof createDesktopServices> | undefined;

  beforeEach(() => {
    // mkdtemp atomically creates an exclusive directory; never reuse a prior run.
    rootDir = mkdtempSync(join(tmpdir(), 'xiaok-desktop-model-catalog-'));
    previousConfigDir = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(async () => {
    // Close every handle the services API can close before deleting the temp dir.
    if (services) {
      const current = services;
      services = undefined;
      await current.closeTaskSourceWritersForMigration();
      await current.disposeMultiAgent();
    }
    try {
      cleanupPrivateTestTempDir(rootDir);
    } finally {
      if (previousConfigDir === undefined) delete process.env.XIAOK_CONFIG_DIR;
      else process.env.XIAOK_CONFIG_DIR = previousConfigDir;
    }
  });

  it('offers and persists GLM 5.4 from a configured Coding Plan endpoint', async () => {
    services = createDesktopServices({ dataRoot: join(rootDir, 'data'), kswarmService: mockKSwarmService(), now: () => 300 });
    const models = async () => (await services!.getModelConfig()).providerProfiles
      .find(profile => profile.id === 'glm')?.availableModels;
    expect((await models())?.some(model => model.model === 'glm-5.4')).toBe(false);
    const baseUrl = 'https://open.bigmodel.cn/api/coding/paas/v4';
    await services.saveModelConfig({ providerId: 'glm', baseUrl }, undefined, 'user');
    const selected = (await models())!.find(model => model.model === 'glm-5.4')!;
    expect(selected).toMatchObject({ modelId: 'glm-5.4', label: 'GLM 5.4' });
    const snapshot = await services.saveModelConfig({ providerId: 'glm', modelName: selected.model, label: selected.label }, undefined, 'user');
    expect(snapshot.models.find(model => model.isDefault)).toMatchObject({
      model: 'glm-5.4', label: 'GLM 5.4',
      capabilities: ['tools', 'thinking', 'image_in'],
      runtimeOptions: { contextLimit: 1_000_000 },
    });
    expect(snapshot.providers.find(provider => provider.id === 'glm')?.baseUrl).toBe(baseUrl);
  });

  it.each(['k3.1-pro', 'k3.1-pro-highspeed', 'kimi-for-coding'])('persists %s catalog capabilities and native runtime choices', async modelName => {
    services = createDesktopServices({ dataRoot: join(rootDir, 'data'), kswarmService: mockKSwarmService(), now: () => 300 });
    await services.saveModelConfig({ providerId: 'kimi', modelName }, undefined, 'user');
    const before = await services.getModelConfig();
    const model = before.models.find(entry => entry.model === modelName)!;
    expect(model).toBeDefined();
    expect(model.runtimeOptions).toEqual({ contextLimit: modelName === 'kimi-for-coding' ? 1_048_576 : 262_144, reasoningEffort: 'high' });
    expect(model.runtimeConstraints).toEqual({ maxContextLimit: 1_048_576, reasoningEfforts: ['low', 'high', 'max'] });
    const updated = await services.updateModelRuntimeOptions({ modelId: model.id, runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' } }, 'user');
    expect(updated.models.find(entry => entry.id === model.id)?.runtimeOptions).toEqual({ contextLimit: 1_048_576, reasoningEffort: 'max' });
    await expect(services.updateModelRuntimeOptions({ modelId: model.id, runtimeOptions: { reasoningEffort: 'none' } }, 'user')).rejects.toThrow(/reasoningEffort/);
    const persisted = JSON.parse(readFileSync(join(rootDir, 'config', 'config.json'), 'utf8'));
    expect(persisted.models[model.id].capabilities).toEqual(['tools', 'thinking', 'image_in']);
    expect((await services.getModelConfig()).models.find(entry => entry.id === model.id)?.runtimeOptions?.reasoningEffort).toBe('max');
  });
});
