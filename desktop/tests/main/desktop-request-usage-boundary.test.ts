// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type Config, type ModelAdapter, type StreamChunk } from '../../../src/types.js';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import { admitDesktopModelPhysicalRead, closeDesktopModelPhysicalScope, createDesktopModelPhysicalScope, streamDesktopTaskRecovery } from '../../electron/desktop-task-stream.js';

function config(): Config {
  return { ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current',
    providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } },
    models: {
      current: { provider: 'local', model: 'current', label: 'Current', capabilities: ['tools'] },
      selected: { provider: 'local', model: 'selected', label: 'Selected', capabilities: ['tools'] },
    } };
}
async function collect(stream: AsyncIterable<StreamChunk>) {
  const out: StreamChunk[] = []; for await (const chunk of stream) out.push(chunk); return out;
}
const request = (adapter: ModelAdapter) => ({ adapter, messages: [], tools: [], systemPrompt: '', invocationId: 'original',
  options: { signal: new AbortController().signal }, deadline: Date.now() + 1000,
  policy: { windowMs: 100, idleMs: 30, initialDelayMs: 0, maxDelayMs: 0 } });

for (const mode of ['recovery', 'selected'] as const) {
  it.each([undefined, null, Object.assign(Error('connection reset admission'), { code: 'ECONNRESET' })])(
    `${mode}: admission failure %s preserves the original value and sends no request or fallback`, async failure => {
      const sdk = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'done' }; });
      const adapter: ModelAdapter = { getModelName: () => 'synthetic', stream: sdk };
      const loadConfig = vi.fn(async () => config()), factory = vi.fn(() => adapter);
      const model = await createProjectAgentModel({ modelId: 'selected', loadConfig, createAdapter: factory });
      const scope = createDesktopModelPhysicalScope(), run = admitDesktopModelPhysicalRead(scope);
      const admitUsage = vi.fn(() => { throw failure; }), onRecovery = vi.fn();
      try {
        const input = { ...request(adapter), admitUsage, onRecovery };
        const work = collect(mode === 'recovery' ? streamDesktopTaskRecovery(input, run) : model.stream(input, run));
        const outcome = await work.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
        expect(outcome).toEqual({ ok: false, error: failure });
        if (!outcome.ok) expect(outcome.error).toBe(failure);
        expect(admitUsage).toHaveBeenCalledOnce(); expect(sdk).not.toHaveBeenCalled();
        expect(onRecovery).not.toHaveBeenCalled(); expect(loadConfig).toHaveBeenCalledOnce(); expect(factory).toHaveBeenCalledOnce();
      } finally { run.finish(); await closeDesktopModelPhysicalScope(scope); }
    },
  );

  it(`${mode}: preparation precedes admission for the effective request, and usage/return precede revocation`, async () => {
    const order: string[] = [], usage = { inputTokens: 7, outputTokens: 11 };
    const adapter: ModelAdapter = { getModelName: () => 'synthetic', stream() {
      order.push('sdk'); let read = 0;
      return { [Symbol.asyncIterator]() { return this; },
        next: async () => ++read === 1 ? { done: false as const, value: { type: 'usage' as const, usage } }
          : read === 2 ? { done: false as const, value: { type: 'text' as const, delta: 'answer' } }
          : read === 3 ? { done: false as const, value: { type: 'done' as const } } : { done: true as const, value: undefined },
        return: async () => { order.push('return'); return { done: true as const, value: undefined }; },
      };
    } };
    const model = await createProjectAgentModel({ modelId: 'selected', loadConfig: async () => config(), createAdapter: () => adapter });
    const scope = createDesktopModelPhysicalScope(), run = admitDesktopModelPhysicalRead(scope);
    const commit = vi.fn((incoming: number, outgoing: number) => {
      expect([incoming, outgoing]).toEqual([7, 11]); order.push('commit'); return Promise.resolve();
    }), revoke = vi.fn(() => { order.push('revoke'); });
    const legacy = vi.fn();
    try {
      const input = { ...request(adapter), beforeRequest: async () => { order.push('authorize'); },
        prepareRequest: async (current: ReturnType<typeof request>) => { order.push('prepare'); return { ...current, invocationId: 'effective' }; },
        admitUsage: (invocationId: string) => { run.assertCurrent(); expect(invocationId).toBe('effective'); order.push('admit'); return { commit, revoke }; },
        onUsage: legacy };
      const out = await collect(mode === 'recovery' ? streamDesktopTaskRecovery(input, run) : model.stream(input, run));
      expect(out.some(chunk => chunk.type === 'text' && chunk.delta === 'answer')).toBe(true);
      expect(order).toEqual(['authorize', 'prepare', 'admit', 'sdk', 'commit', 'return', 'revoke']);
      expect(commit).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled();
    } finally { run.finish(); await closeDesktopModelPhysicalScope(scope); }
  });
}

it('selected: a retired claim rejects before receipt or SDK and never falls back', async () => {
  const sdk = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'done' }; });
  const adapter: ModelAdapter = { getModelName: () => 'synthetic', stream: sdk };
  const loadConfig = vi.fn(async () => config());
  const model = await createProjectAgentModel({ modelId: 'selected', loadConfig, createAdapter: () => adapter });
  const scope = createDesktopModelPhysicalScope(), run = admitDesktopModelPhysicalRead(scope); run.finish();
  const admitUsage = vi.fn(() => ({ commit: () => Promise.resolve(), revoke() {} }));
  try {
    await expect(collect(model.stream({ ...request(adapter), admitUsage }, run))).rejects.toThrow('agent_model_claim_retired');
    expect(admitUsage).not.toHaveBeenCalled(); expect(sdk).not.toHaveBeenCalled(); expect(loadConfig).toHaveBeenCalledOnce();
  } finally { await closeDesktopModelPhysicalScope(scope); }
});
