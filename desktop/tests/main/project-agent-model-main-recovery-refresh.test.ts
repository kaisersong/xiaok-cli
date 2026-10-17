// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import type { DesktopTaskRequestPreparer } from '../../electron/desktop-task-stream.js';
import { DEFAULT_CONFIG, type Config, type Message, type ModelAdapter, type StreamChunk } from '../../../src/types.js';
const config = (): Config => ({ ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2,
 defaultProvider: 'local', defaultModelId: 'current',
 providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } },
 models: { current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] } },
});
const completed: Message[] = [
 { role: 'assistant', content: [{ type: 'tool_use', id: 'write-once', name: 'write', input: {} }] },
 { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'write-once', content: 'file created once' }] },
];
function request() { return { messages: completed, tools: [], systemPrompt: '', invocationId: 'first',
 deadline: Date.now() + 10_000, options: { signal: new AbortController().signal },
 policy: { windowMs: 100, idleMs: 30, initialDelayMs: 0, maxDelayMs: 0 },
}; }
async function collect(stream: AsyncIterable<StreamChunk>) {
 const chunks: StreamChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks;
}
function model(adapter: ModelAdapter) {
 return createProjectAgentModel({ modelId: null, loadConfig: async () => config(), createAdapter: () => adapter });
}
describe('project current model uses the main task recovery owner', () => {
 it('retries a transient read before visible output and prepares each actual request once', async () => {
  let calls = 0, authority = 0, preparations = 0;
  const ids: string[] = [], seen: Message[][] = [];
  const adapter: ModelAdapter = { getModelName: () => 'current', async *stream(messages) {
   seen.push(messages); if (++calls === 1) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
   yield { type: 'text', delta: 'done' }; yield { type: 'done' };
  } };
  const prepareRequest: DesktopTaskRequestPreparer = async current => { preparations++; return current; };
  const current = await model(adapter);
  expect(await collect(current.stream({ ...request(), beforeRequest: async () => { authority++; }, prepareRequest,
   onInvocation: id => { ids.push(id); },
  }))).toEqual([{ type: 'text', delta: 'done' }, { type: 'done' }]);
  expect(calls).toBe(2); expect(authority).toBe(2); expect(preparations).toBe(2);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe('first'); expect(ids[1]).not.toBe(ids[0]);
  expect(seen).toEqual([completed, completed]);
 });
 it('does not retry a request preparation failure or call the provider', async () => {
  let calls = 0, preparations = 0, authority = 0;
  const adapter: ModelAdapter = { getModelName: () => 'current', async *stream() { calls++; yield { type: 'done' }; } };
  const prepareRequest: DesktopTaskRequestPreparer = async () => { preparations++; throw new Error('workspace_prepare_denied'); };
  const current = await model(adapter);
  await expect(collect(current.stream({ ...request(), beforeRequest: async () => { authority++; }, prepareRequest }))).rejects.toThrow('workspace_prepare_denied');
  expect(calls).toBe(0); expect(authority).toBe(1); expect(preparations).toBe(1);
 });
 it('rechecks authority before retry and sends no request after revocation', async () => {
  let calls = 0, authority = 0, preparations = 0;
  const seen: Message[][] = [];
  const adapter: ModelAdapter = { getModelName: () => 'current', async *stream(messages) {
   calls++; seen.push(messages); throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  } };
  const prepareRequest: DesktopTaskRequestPreparer = async current => { preparations++; return current; };
  const current = await model(adapter);
  await expect(collect(current.stream({ ...request(), beforeRequest: async () => {
   if (++authority === 2) throw new Error('workspace_revoked');
  }, prepareRequest }))).rejects.toThrow('workspace_revoked');
  expect(calls).toBe(1); expect(authority).toBe(2); expect(preparations).toBe(1);
  expect(seen).toEqual([completed]);
 });
});
