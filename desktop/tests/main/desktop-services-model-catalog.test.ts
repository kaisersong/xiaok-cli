// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { mockKSwarmService } from '../support/desktop-services-fixtures.js';

describe('desktop services model catalog', () => {
  let rootDir: string;
  let previousConfigDir: string | undefined;

  beforeEach(() => {
    // mkdtemp atomically creates an exclusive directory; never reuse a prior run.
    rootDir = mkdtempSync(join(tmpdir(), 'xiaok-desktop-model-catalog-'));
    previousConfigDir = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } finally {
      if (previousConfigDir === undefined) delete process.env.XIAOK_CONFIG_DIR;
      else process.env.XIAOK_CONFIG_DIR = previousConfigDir;
    }
  });

  it.each(['k3.1-pro', 'k3.1-pro-highspeed', 'kimi-for-coding'])('persists %s catalog capabilities and native runtime choices', async modelName => {
    const services = createDesktopServices({ dataRoot: join(rootDir, 'data'), kswarmService: mockKSwarmService(), now: () => 300 });
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
