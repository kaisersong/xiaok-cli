import { expect, it, vi } from 'vitest';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import { DEFAULT_CONFIG, type Config, type StreamChunk } from '../../../src/types.js';
it.each([false, true])('keeps accepted text without tools or fallback (binding changed=%s)', async bindingChanged => {
  const config: Config = { ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current', providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } }, models: { current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] }, selected: { provider: 'local', model: 'selected', label: 'Selected', capabilities: ['tools'] } } };
  const open = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'text', delta: 'Already accepted partial answer' };
    yield { type: 'tool_use', id: 'discard', name: 'write', input: {} };
    yield { type: 'text', delta: '普通正文重复。'.repeat(100) };
  });
  const changedConfig = { ...config, defaultModelId: 'selected' };
  let availableConfig = config;
  const consultedConfigs: Config[] = [];
  const loadConfig = vi.fn(async () => {
    consultedConfigs.push(availableConfig);
    return availableConfig;
  });
  const createAdapter = vi.fn(() => ({ getModelName: () => 'Selected', stream: open }));
  const onRecovery = vi.fn();
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig, createAdapter });
  // A changed backing config is available at failure time. Repetition must throw
  // at the boundary before loadConfig can read it or activate recovery.
  if (bindingChanged) {
    changedConfig.models = { ...config.models, selected: { ...config.models.selected!, model: 'changed-wire-model' } };
    availableConfig = changedConfig;
  }
  const delivered: StreamChunk[] = [];
  await expect((async () => {
    for await (const chunk of model.stream({ onRecovery, messages: [], tools: [], systemPrompt: 'test', invocationId: 'rep', deadline: Date.now() + 10000, options: { signal: new AbortController().signal } })) delivered.push(chunk);
  })()).rejects.toMatchObject({ code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false });
  expect(delivered).toEqual([{ type: 'text', delta: 'Already accepted partial answer' }]);
  expect(open).toHaveBeenCalledOnce();
  expect(createAdapter).toHaveBeenCalledOnce();
  expect(onRecovery).not.toHaveBeenCalled();
  expect(loadConfig).toHaveBeenCalledOnce();
  await expect(loadConfig.mock.results[0]!.value).resolves.toBe(config);
  // Prove the queued failure-time config really differs, without reading it:
  // the production boundary above must prevent a second loadConfig call.
  expect(consultedConfigs).toEqual([config]);
  if (bindingChanged) {
    expect(availableConfig).toBe(changedConfig);
    expect(availableConfig.models.selected!.model).toBe('changed-wire-model');
  }
});
