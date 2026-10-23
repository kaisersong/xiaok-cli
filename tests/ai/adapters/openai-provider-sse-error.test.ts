import { createServer } from 'node:http';
import OpenAI from 'openai';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../../src/utils/logger.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';

const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'fictional test' }] }];
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const text = (content: string, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta: { content }, finish_reason }] });
const tool = (id: string) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'effect', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
async function fixture(run: (adapter: OpenAIAdapter, calls: unknown[]) => Promise<void>, body: (request: number) => string | null | undefined) {
  const calls: unknown[] = [];
  const server = createServer(async (request, response) => {
    let payload = ''; for await (const part of request) payload += part;
    calls.push(JSON.parse(payload));
    const responseBody = body(calls.length);
    if (responseBody === null) { request.socket.destroy(); return; }
    if (responseBody === undefined) return;
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-request-id': 'PRIVATE_CANARY_HEADER' });
    response.end(responseBody + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const adapter = new OpenAIAdapter({ apiKey: 'fictional', harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: `http://127.0.0.1:${port}/v1`, wireModel: 'fixture', capabilities: ['tools'] },
    flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  try { await run(adapter, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
async function consume(adapter: OpenAIAdapter) { const chunks = []; for await (const chunk of adapter.stream(messages, [], '')) chunks.push(chunk); return chunks; }
afterEach(() => vi.unstubAllEnvs());
describe('real SDK status-less provider SSE errors', () => {
  it('retries NoRoom before output and completes', async () => {
    await fixture(async (adapter, calls) => {
      const chunks = await consume(adapter);
      expect(calls).toHaveLength(2);
      expect(chunks).toContainEqual({ type: 'text', delta: 'recovered' });
      expect(chunks.at(-1)?.type).toBe('done');
    }, count => count === 1 ? frame({ error: { type: 'server_error', message: 'NoRoom' } }) : frame(text('recovered', 'stop')));
  });
  it.each([false, true])('also retries named SSE errors (nested=%s)', async nested => {
    await fixture(async (adapter, calls) => {
      expect(await consume(adapter)).toContainEqual({ type: 'text', delta: 'recovered' });
      expect(calls).toHaveLength(2);
    }, count => count === 1 ? 'event: error\n' + frame(nested ? { error: { type: 'server_error', message: 'NoRoom' } } : { type: 'server_error', message: 'NoRoom' }) : frame(text('recovered', 'stop')));
  });
  it('reports sticky CUDA failure as a nonretryable model error', async () => {
    await fixture(async (adapter, calls) => {
      const error = await consume(adapter).catch(error => error);
      expect(calls).toHaveLength(1);
      expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false });
      expect(error.message).toContain('CudaFailed');
      expect(error.message).toContain('OPENAI_PROVIDER_STREAM_ERROR');
    }, () => frame({ error: { type: 'server_error', message: 'CudaFailed' } }));
  });
  it.each(['authentication_error', 'insufficient_quota', 'invalid_request_error', 'unknown_private_type'])(
    'sanitizes %s without retaining arbitrary SDK body fields', async type => {
      await fixture(async (adapter, calls) => {
        const error = await consume(adapter).catch(error => error);
        expect(calls).toHaveLength(1);
        expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false });
        const diagnostic = JSON.stringify(Object.getOwnPropertyNames(error).map(key => [key, error[key]]));
        expect(diagnostic).not.toContain('PRIVATE_CANARY');
        expect(diagnostic).not.toContain('unknown_private_type');
        expect(error.cause).toBeUndefined(); expect(error.error).toBeUndefined(); expect(error.headers).toBeUndefined();
      }, () => frame({ error: { type, code: type, message: 'PRIVATE_CANARY reasoning and authentication body', extra: 'PRIVATE_CANARY' } }));
    });
  it('gives quota a permanent verdict even inside server_error/NoRoom', async () => {
    await fixture(async (adapter, calls) => {
      const error = await consume(adapter).catch(error => error);
      expect(calls).toHaveLength(1);
      expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false });
      expect(error.message).toContain('insufficient_quota');
    }, () => frame({ error: { type: 'server_error', code: 'insufficient_quota', message: 'NoRoom' } }));
  });
  it('recovers a partial stream through the runtime without replaying completed effects', async () => {
    vi.stubEnv('XIAOK_MODEL_RECOVERY_WINDOW_MS', '10000');
    await fixture(async (adapter, calls) => {
      let effects = 0;
      const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'effect', description: 'fictional', inputSchema: { type: 'object', properties: {} } }, execute: async () => { effects++; return 'COMPLETED_EFFECT'; } }]);
      const runtime = new AgentRuntime({ adapter, registry, session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: '' });
      const events: Array<{ type: string }> = [];
      await runtime.run('fictional test', event => events.push(event));
      expect(calls).toHaveLength(3); expect(effects).toBe(1);
      expect(JSON.stringify(calls[2])).toContain('COMPLETED_EFFECT');
      expect(JSON.stringify(calls[2])).not.toContain('UNCOMMITTED');
      expect(events).toContainEqual(expect.objectContaining({ type: 'model_recovery' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'run_completed' }));
    }, count => count === 1 ? frame(tool('COMMITTED')) : count === 2
      ? frame(text('partial')) + frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'UNCOMMITTED', type: 'function', function: { name: 'effect', arguments: '{}' } }] }, finish_reason: null }] }) + frame({ error: { type: 'server_error', message: 'NoRoom' } })
      : frame(text('finished', 'stop')));
  });
  it('classifies exhausted NoRoom recovery as a model failure', async () => {
    vi.stubEnv('XIAOK_MODEL_RECOVERY_WINDOW_MS', '20');
    await fixture(async adapter => {
      const runtime = new AgentRuntime({ adapter, registry: new ToolRegistry({ autoMode: true }, []), session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: '' });
      const error = await runtime.run('fictional', () => {}).catch(error => error);
      expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', retryable: false });
      expect(error.message).toContain('恢复窗口');
    }, () => frame(text('partial')) + frame({ error: { type: 'server_error', message: 'NoRoom' } }));
  });
  it.each([new OpenAI.APIUserAbortError(), new OpenAI.APIConnectionError({ cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) }), new OpenAI.APIConnectionTimeoutError()])('does not replace transport/abort subclasses: %s', async error => {
    await fixture(async adapter => {
      // Preserve the actual SDK class identity and cause at the adapter boundary.
      (adapter as unknown as { client: unknown }).client = { chat: { completions: { create: async () => { throw error; } } } };
      await expect(consume(adapter)).rejects.toBe(error);
    }, () => '');
  });
  it.each(['stream', 'retry'] as const)('preserves caller cancellation during %s', async phase => {
    const controller = new AbortController();
    const reason = new DOMException('caller cancellation', 'AbortError');
    await fixture(async (adapter, calls) => {
      const read = async () => {
        for await (const chunk of recoverModelStream({ signal: controller.signal, open: signal => adapter.stream(messages, [], '', { signal }), policy: { windowMs: 1000, idleMs: 1000, initialDelayMs: 1000, maxDelayMs: 1000 }, onRetry: () => controller.abort(reason) })) {
          if (phase === 'stream' && chunk.type === 'text') controller.abort(reason);
        }
      };
      await expect(read()).rejects.toBe(reason);
      expect(calls).toHaveLength(1);
    }, () => frame(text('partial')) + frame({ error: { type: 'server_error', message: 'NoRoom' } }));
  });
  it('preserves caller cancellation before response headers', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancel before headers', 'AbortError');
    await fixture(async (adapter, calls) => {
      const read = async () => { for await (const _ of adapter.stream(messages, [], '', { signal: controller.signal })) { /* consume */ } };
      await expect(read()).rejects.toBe(reason); expect(calls).toHaveLength(1);
    }, () => { controller.abort(reason); return ''; });
  });
  it('keeps real SDK disconnects recoverable', async () => {
    await fixture(async (adapter, calls) => {
      const client = (adapter as unknown as { client: OpenAI }).client;
      client.maxRetries = 0; // Exercise the production recovery owner, not SDK-internal HTTP retries.
      const retry = vi.fn(() => { client.timeout = 1000; });
      const values = [];
      for await (const chunk of recoverModelStream({ signal: new AbortController().signal, open: signal => adapter.stream(messages, [], '', { signal }), policy: { windowMs: 1000, idleMs: 2000, initialDelayMs: 1, maxDelayMs: 1 }, onRetry: retry })) values.push(chunk);
      expect(calls).toHaveLength(2); expect(retry).toHaveBeenCalledTimes(1);
      expect(values).toContainEqual({ type: 'text', delta: 'recovered' });
    }, count => count === 1 ? null : frame(text('recovered', 'stop')));
  });
  it('preserves a real SDK timeout and its internal abort cause', async () => {
    await fixture(async (adapter, calls) => {
      const client = (adapter as unknown as { client: OpenAI }).client;
      client.maxRetries = 0; client.timeout = 100;
      const error = await consume(adapter).catch(error => error);
      expect(calls).toHaveLength(1);
      expect(error.constructor).toBe(OpenAI.APIConnectionTimeoutError);
      expect(error.cause).toMatchObject({ name: 'AbortError' });
      expect(error.code).not.toBe('OPENAI_PROVIDER_STREAM_ERROR');
    }, () => undefined);
  });
  it('keeps arbitrary provider body and headers out of runtime events and the logger sink', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xiaok-sse-private-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', directory);
    try {
      await fixture(async adapter => {
        const events: unknown[] = [];
        const runtime = new AgentRuntime({ adapter, registry: new ToolRegistry({ autoMode: true }, []), session: new AgentSessionState(), controller: new AgentRunController(), systemPrompt: '' });
        const error = await runtime.run('fictional', event => events.push(event)).catch(error => error);
        createLogger('stream-test', { stderr: false }).error(error);
        const normalized = normalizeRuntimeError(error);
        const sink = JSON.stringify(events) + JSON.stringify(normalized) + readFileSync(join(directory, 'logs', 'xiaok.log'), 'utf8');
        expect(normalized.code).toBe('model_failed'); expect(sink).not.toContain('PRIVATE_CANARY');
      }, () => frame({ error: { type: 'PRIVATE_CANARY_TYPE', code: 'PRIVATE_CANARY_CODE', message: 'PRIVATE_CANARY_BODY' } }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('leaves unrelated tool errors alone', () => {
    expect(normalizeRuntimeError(new Error('NoRoom'))).toEqual({ code: 'tool_failed', message: 'NoRoom', retryable: false });
  });
  it('does not recover terminal CUDA errors in the outer model owner', async () => {
    await fixture(async adapter => {
      const retry = vi.fn();
      const result = async () => { for await (const _ of recoverModelStream({ signal: new AbortController().signal, open: signal => adapter.stream(messages, [], '', { signal }), policy: { windowMs: 20, idleMs: 1000, initialDelayMs: 1, maxDelayMs: 1 }, onRetry: retry })) { /* consume */ } };
      await expect(result()).rejects.toMatchObject({ retryable: false });
      expect(retry).not.toHaveBeenCalled();
    }, () => frame({ error: { type: 'server_error', message: 'CudaFailed' } }));
  });
});
