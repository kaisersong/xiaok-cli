import { createServer, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';
import type { StreamChunk } from '../../../src/types.js';

async function fixture(run: (adapter: OpenAIAdapter, open: Set<ServerResponse>, counts: { requests: number }, signal: AbortSignal) => Promise<void>, finished = true) {
  const open = new Set<ServerResponse>();
  const counts = { requests: 0 };
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* Consume the actual SDK's request. */ }
    counts.requests++;
    open.add(response);
    response.on('close', () => open.delete(response));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'example', object: 'chat.completion.chunk', created: 1, model: 'example',
      choices: [{ index: 0, delta: { content: '已完成示例操作' }, finish_reason: finished ? 'stop' : null }] })}\n\n`);
    // A semantic completion is not HTTP EOF. The adapter must cancel this body.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture port');
  const adapter = new OpenAIAdapter({ apiKey: 'fixture', harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy',
      canonicalBaseUrl: `http://127.0.0.1:${address.port}/v1`, wireModel: 'example', capabilities: ['tools'] },
    flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  try { await run(adapter, open, counts, controller.signal); }
  finally {
    controller.abort();
    for (const response of open) response.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: '示例'.repeat(32_000) }] }];

describe('actual SDK response body ownership', () => {
  it('closes completed bodies across repeated requests without cancelling the task', async () => {
    await fixture(async (adapter, open, counts, signal) => {
      for (let index = 0; index < 30; index++) {
        const chunks: StreamChunk[] = [];
        for await (const chunk of adapter.stream(messages, [], '', { signal })) chunks.push(chunk);
        expect(chunks.at(-1)).toEqual({ type: 'done' });
      }
      await expect.poll(() => open.size, { timeout: 1000 }).toBe(0);
      expect(counts.requests).toBe(30);
      expect(signal.aborted).toBe(false);
    });
  });
  it.each(['break', 'throw'] as const)('closes an unfinished HTTP body when its consumer exits by %s', async exit => {
    await fixture(async (adapter, open, counts, signal) => {
      const consume = async () => {
        for await (const chunk of adapter.stream(messages, [], '', { signal })) {
          if (chunk.type === 'text') {
            if (exit === 'throw') throw new Error('consumer_exit');
            break;
          }
        }
      };
      if (exit === 'throw') await expect(consume()).rejects.toThrow('consumer_exit');
      else await consume();
      await expect.poll(() => open.size, { timeout: 1000 }).toBe(0);
      expect(counts.requests).toBe(1);
      expect(signal.aborted).toBe(false);
    }, false);
  });
  it('also releases a successful recovery attempt and leaves its external task signal live', async () => {
    const task = new AbortController();
    const signals: AbortSignal[] = [];
    const chunks: StreamChunk[] = [];
    for await (const chunk of recoverModelStream({ signal: task.signal, open: signal => (async function* () {
      signals.push(signal);
      yield { type: 'text' as const, delta: 'complete' };
      yield { type: 'done' as const };
    })() })) chunks.push(chunk);
    await delay(0);
    expect(chunks.map(chunk => chunk.type)).toEqual(['text', 'done']);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(task.signal.aborted).toBe(false);
  });
});


describe('cleanup cannot change provider or consumer outcomes', () => {
  it.each(['success', 'provider-error', 'consumer-error'] as const)('preserves %s when iterator cleanup rejects', async outcome => {
    const sourceError = new Error('fixture_permanent_failure');
    const owner = new AbortController();
    let returned = 0;
    const iterator = {
      async next() {
        if (outcome === 'provider-error') throw sourceError;
        return { done: false as const, value: { choices: [{ delta: { content: 'complete' }, finish_reason: outcome === 'success' ? 'stop' : null }] } };
      },
      async return() { returned++; throw new Error('cleanup_failure'); },
    };
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', harnessContext: buildOpenAIHarnessContext({
      identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', wireModel: 'example', capabilities: [] }, flags: resolveKimiHarnessFeatureFlags({}),
    }) });
    (adapter as unknown as { client: unknown }).client = { chat: { completions: { create: async () => ({ controller: owner, [Symbol.asyncIterator]: () => iterator }) } } };
    const consume = async () => { for await (const chunk of adapter.stream(messages, [], '')) {
      if (outcome === 'consumer-error' && chunk.type === 'text') throw sourceError;
    } };
    if (outcome === 'success') await consume();
    else await expect(consume()).rejects.toBe(sourceError);
    expect(returned).toBe(1); expect(owner.signal.aborted).toBe(true);
  });
});
