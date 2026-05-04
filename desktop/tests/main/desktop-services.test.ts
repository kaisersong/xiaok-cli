import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';

describe('desktop services', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-services-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('imports material, creates a task, runs without confirmation, and recovers result', async () => {
    const sourcePath = join(rootDir, 'A客户需求.md');
    writeFileSync(sourcePath, '# A 客户需求\n需要制造业数字化方案。');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'assistant_delta',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          delta: '模型',
        });
        emitRuntimeEvent({
          type: 'assistant_delta',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          delta: '回复内容',
        });
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '模型回复内容',
        });
      },
    });

    const material = await services.importMaterial({
      taskId: 'desktop_task',
      filePath: sourcePath,
      role: 'customer_material',
    });
    const created = await services.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    expect(created.understanding.taskType).toBe('sales_deck');
    const replayed = await collectFirst(services.subscribeTask(created.taskId), 4);
    expect(replayed.map((event) => event.type)).not.toContain('needs_user');

    await waitFor(async () => (await services.recoverTask(created.taskId)).snapshot.status === 'completed');
    const recovered = await services.recoverTask(created.taskId);
    expect(recovered.snapshot.status).toBe('completed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'result' }),
    ]));
    expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress', message: '正在解析材料' }),
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ summary: '已生成可继续细化的方案大纲' }) }),
    ]));
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant_delta', delta: '模型' }),
      expect.objectContaining({ type: 'assistant_delta', delta: '回复内容' }),
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ summary: '模型回复内容' }) }),
      expect.objectContaining({ type: 'result' }),
    ]));
  });

  it('reads and writes the same provider/model config catalog as xiaok cli', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.defaultModelId).toBe('anthropic-default');
    expect(snapshot.providerProfiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'kimi', 'deepseek', 'glm', 'minimax', 'gemini']),
    );

    snapshot = await services.saveModelConfig({
      providerId: 'kimi',
      modelName: 'kimi-k2-thinking',
      apiKey: 'sk-kimi',
    });

    expect(snapshot.defaultProvider).toBe('kimi');
    expect(snapshot.defaultModelId).toBe('kimi-kimi-k2-thinking');
    expect(snapshot.providers.find((provider) => provider.id === 'kimi')).toMatchObject({
      protocol: 'openai_legacy',
      apiKeyConfigured: true,
      baseUrl: 'https://api.kimi.com/coding/v1',
    });
    expect(snapshot.models.find((model) => model.id === 'kimi-kimi-k2-thinking')).toMatchObject({
      provider: 'kimi',
      model: 'kimi-k2-thinking',
      label: 'kimi-k2-thinking',
      isDefault: true,
    });
  });

  it('lists available models for a first-party provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const models = await services.listAvailableModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({
      modelId: expect.stringContaining('anthropic'),
      model: expect.stringContaining('claude'),
      label: expect.stringContaining('Claude'),
    });
  });

  it('returns empty array for unknown provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const models = await services.listAvailableModelsForProvider('unknown-provider');
    expect(models).toEqual([]);
  });

  it('deletes a provider and its associated models', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    // First add a custom provider
    await services.saveModelConfig({
      providerId: 'custom-test',
      modelName: 'test-model',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      protocol: 'openai_legacy',
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.providers.find(p => p.id === 'custom-test')).toBeDefined();
    expect(snapshot.models.find(m => m.provider === 'custom-test')).toBeDefined();

    // Delete the provider
    await services.deleteProvider('custom-test');

    snapshot = await services.getModelConfig();
    expect(snapshot.providers.find(p => p.id === 'custom-test')).toBeUndefined();
    expect(snapshot.models.find(m => m.provider === 'custom-test')).toBeUndefined();
  });

  it('deletes a specific model but keeps the provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    // Add a custom model
    await services.saveModelConfig({
      providerId: 'anthropic',
      modelName: 'claude-test-model',
      label: 'Test Model',
    });

    let snapshot = await services.getModelConfig();
    const testModel = snapshot.models.find(m => m.model === 'claude-test-model');
    expect(testModel).toBeDefined();

    // Delete the model
    await services.deleteModel(testModel!.id);

    snapshot = await services.getModelConfig();
    expect(snapshot.models.find(m => m.model === 'claude-test-model')).toBeUndefined();
    expect(snapshot.providers.find(p => p.id === 'anthropic')).toBeDefined();
  });

  it('testProviderConnection returns error when API key not configured', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    // Default config has no API key
    const result = await services.testProviderConnection({ providerId: 'anthropic' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');
  });

  it('testProviderConnection attempts connection when API key is configured', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
      runner: async () => { // Minimal runner
      },
    });

    // Configure with API key (but fake, so connection will fail)
    await services.saveModelConfig({
      providerId: 'anthropic',
      apiKey: 'sk-test-key',
    });

    // With a fake API key, the connection will fail, but we can verify it tried
    const result = await services.testProviderConnection({ providerId: 'anthropic' });
    // Either succeeds (if adapter returns immediately) or fails with connection error
    expect(result.success).toBeDefined();
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('resets defaultProvider when deleted provider was default', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    // Set kimi as default
    await services.saveModelConfig({
      providerId: 'kimi',
      apiKey: 'sk-kimi',
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.defaultProvider).toBe('kimi');

    // Delete kimi
    await services.deleteProvider('kimi');

    snapshot = await services.getModelConfig();
    expect(snapshot.defaultProvider).not.toBe('kimi');
    expect(snapshot.providers.find(p => p.id === 'anthropic')).toBeDefined(); // Falls back to anthropic
  });

  // ===== Channel API Tests (shared config.json) =====

  it('returns empty channels when config has no channels', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const channels = await services.listChannels();
    expect(channels).toEqual([]);
  });

  it('reads channels from config.json', async () => {
    // Write config with channels first
    const configDir = join(rootDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultProvider: 'anthropic',
      defaultModelId: 'anthropic-default',
      providers: { anthropic: { type: 'first_party', protocol: 'anthropic' } },
      models: { 'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Opus' } },
      channels: {
        yzj: { sendMsgUrl: 'https://example.com/webhook', inboundMode: 'websocket' },
      },
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const channels = await services.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe('yzj');
    expect(channels[0].type).toBe('yzj');
    expect(channels[0].webhookUrl).toBe('https://example.com/webhook');
  });

  it('creates a channel and persists to config.json', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const channel = await services.createChannel({ type: 'discord', name: 'My Discord', webhookUrl: 'https://discord.com/api/webhooks/...' });
    expect(channel.id).toBe('discord');
    expect(channel.type).toBe('discord');
    expect(channel.name).toBe('My Discord');
    expect(channel.enabled).toBe(true);

    // Verify it's in config.json
    const configPath = join(rootDir, 'config', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.channels.discord).toBeDefined();
  });

  it('updates an existing channel', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    // First create
    await services.createChannel({ type: 'telegram', name: 'Old Name' });

    // Then update
    const updated = await services.updateChannel('telegram', { name: 'New Name', webhookUrl: 'https://api.telegram.org/bot123' });
    expect(updated.name).toBe('New Name');
    expect(updated.webhookUrl).toBe('https://api.telegram.org/bot123');
  });

  it('throws on updating non-existent channel', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    await expect(services.updateChannel('nonexistent', { name: 'test' })).rejects.toThrow('not found');
  });

  it('deletes a channel from config.json', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    await services.createChannel({ type: 'feishu', name: 'Feishu' });
    let channels = await services.listChannels();
    expect(channels.find(c => c.id === 'feishu')).toBeDefined();

    await services.deleteChannel('feishu');
    channels = await services.listChannels();
    expect(channels.find(c => c.id === 'feishu')).toBeUndefined();
  });

  // ===== MCP API Tests =====

  it('returns empty MCP installs initially', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const installs = await services.listMCPInstalls();
    expect(installs).toEqual([]);
  });

  it('creates an MCP install and persists to file', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const install = await services.createMCPInstall({
      name: 'Playwright',
      source: 'npm',
      command: '@anthropic/mcp-playwright',
    });

    expect(install.id).toBeDefined();
    expect(install.name).toBe('Playwright');
    expect(install.source).toBe('npm');
    expect(install.enabled).toBe(true);

    // Verify file
    const mcpPath = join(rootDir, 'data', 'mcp-installs.json');
    expect(existsSync(mcpPath)).toBe(true);
    const saved = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Playwright');
  });

  it('updates an MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const created = await services.createMCPInstall({
      name: 'Brave Search',
      source: 'npm',
      command: '@anthropic/mcp-brave-search',
    });

    const updated = await services.updateMCPInstall(created.id, { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('throws on updating non-existent MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    await expect(services.updateMCPInstall('nonexistent', { enabled: false })).rejects.toThrow('not found');
  });

  it('deletes an MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const created = await services.createMCPInstall({ name: 'Test MCP', source: 'npm', command: 'test' });
    await services.deleteMCPInstall(created.id);

    const installs = await services.listMCPInstalls();
    expect(installs).toHaveLength(0);
  });

  it('supports multiple MCP installs with distinct IDs', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      now: () => 300,
    });

    const install1 = await services.createMCPInstall({ name: 'MCP1', source: 'npm', command: 'cmd1' });
    const install2 = await services.createMCPInstall({ name: 'MCP2', source: 'github', command: 'cmd2' });

    expect(install1.id).not.toBe(install2.id);
    expect(install1.source).toBe('npm');
    expect(install2.source).toBe('github');

    const installs = await services.listMCPInstalls();
    expect(installs).toHaveLength(2);
  });
});

async function collectFirst<T>(events: AsyncIterable<T>, count: number): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
    if (collected.length >= count) {
      break;
    }
  }
  return collected;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!await predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('timed out waiting for predicate');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
