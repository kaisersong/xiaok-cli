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
  const loadConfig = vi.fn().mockResolvedValue(config);
  const createAdapter = vi.fn(() => ({ getModelName: () => 'Selected', stream: open }));
  const onRecovery = vi.fn();
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig, createAdapter });
  // Make failure-time configuration differ from the initial selected binding.
  if (bindingChanged) {
    changedConfig.models = { ...config.models, selected: { ...config.models.selected!, model: 'changed-wire-model' } };
    loadConfig.mockResolvedValue(changedConfig);
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
});
