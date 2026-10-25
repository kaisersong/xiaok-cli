import { expect, it, vi } from 'vitest';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import { DEFAULT_CONFIG, type Config, type StreamChunk } from '../../../src/types.js';
it('keeps accepted text on repetition without replaying tools or falling back', async () => {
  const config: Config = { ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current', providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } }, models: { current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] }, selected: { provider: 'local', model: 'selected', label: 'Selected', capabilities: ['tools'] } } };
  const open = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'text', delta: 'Already accepted partial answer' };
    yield { type: 'tool_use', id: 'discard', name: 'write', input: {} };
    yield { type: 'text', delta: '普通正文重复。'.repeat(100) };
  });
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config, createAdapter: () => ({ getModelName: () => 'Selected', stream: open }) });
  const delivered: StreamChunk[] = [];
  await expect((async () => {
    for await (const chunk of model.stream({ messages: [], tools: [], systemPrompt: 'test', invocationId: 'rep', deadline: Date.now() + 10000, options: { signal: new AbortController().signal } })) delivered.push(chunk);
  })()).rejects.toMatchObject({ code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false });
  expect(delivered).toEqual([{ type: 'text', delta: 'Already accepted partial answer' }]);
  expect(open).toHaveBeenCalledOnce();
});
