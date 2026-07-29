import { describe, it, expect } from 'vitest';
import type { ModelAdapter, Message, StreamChunk } from '../../../src/types.js';
import { CompactRunner } from '../../../src/ai/runtime/compact-runner.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import { buildSynthesizedProviderContext } from '../../../src/ai/runtime/provider-private-projection.js';

async function* textStream(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'text', delta: text };
  yield { type: 'done' };
}

describe('CompactRunner', () => {
  it('calls adapter with NO_TOOLS_PREAMBLE and returns summary text', async () => {
    const captured: string[] = [];
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, systemPrompt) => {
        captured.push(systemPrompt);
        return textStream('This is the compact summary.');
      },
    };

    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ];

    const runner = new CompactRunner(adapter);
    const summary = await runner.run(messages);

    expect(summary).toBe('This is the compact summary.');
    expect(captured[0]).toContain('TEXT ONLY');
    expect(captured[0]).toContain('Do NOT call any tools');
  });

  it('passes empty tools list to prevent tool calls', async () => {
    let capturedTools: unknown;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, tools) => {
        capturedTools = tools;
        return textStream('summary');
      },
    };

    const runner = new CompactRunner(adapter);
    await runner.run([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);

    expect(capturedTools).toEqual([]);
  });

  it('passes the exact stream options object through to adapter', async () => {
    let capturedOptions: StreamOptions | undefined;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: (_messages, _tools, _systemPrompt, options) => {
        capturedOptions = options;
        return textStream('summary');
      },
    };

    const controller = new AbortController();
    const streamOptions: StreamOptions = {
      signal: controller.signal,
      cacheKey: `pc1_${'a'.repeat(64)}`,
    };
    const runner = new CompactRunner(adapter);
    const run = runner.run.bind(runner) as (
      messages: Message[],
      options?: StreamOptions,
    ) => Promise<string>;
    await run(
      [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      streamOptions,
    );

    expect(capturedOptions).toBe(streamOptions);
  });

  it('drains usage and rethrows the same pending adapter error', async () => {
    const sentinel = new Error('compact pending error');
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: async function* () {
        yield {
          type: 'usage',
          usage: { inputTokens: 9, outputTokens: 2 },
        };
        throw sentinel;
      },
    };
    const runner = new CompactRunner(adapter);

    await expect(runner.run([
      { role: 'user', content: [{ type: 'text', text: 'summarize me' }] },
    ])).rejects.toBe(sentinel);
  });

  it('projects strict K3 parent history into one synthesized user envelope', () => {
    const envelopeText = buildSynthesizedProviderContext('compaction', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'visible question' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'provider-private-image-data',
            },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'provider-private-reasoning',
            reasoningProvenance: {
              captureVersion: 1,
              source: 'reasoning_content',
              fieldPresence: 'present',
            },
          },
          { type: 'text', text: 'visible answer' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'read',
            input: { file: 'provider-private-tool-input.ts' },
          },
        ],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: 'provider-private-tool-result',
        }],
      },
    ]);

    const serialized = envelopeText;
    expect(serialized).toContain('visible question');
    expect(serialized).toContain('visible answer');
    expect(serialized).toContain('xiaok.synthesized-compaction-context');
    expect(serialized).not.toContain('provider-private-reasoning');
    expect(serialized).not.toContain('provider-private-image-data');
    expect(serialized).not.toContain('provider-private-tool-input');
    expect(serialized).not.toContain('provider-private-tool-result');
    expect(serialized).not.toContain('tool_call_summary');
    expect(serialized).not.toContain('tool_result_summary');
    const envelope = JSON.parse(envelopeText) as {
      records: Array<{
        role: string;
        content: Array<{ type: string; text: string }>;
      }>;
    };
    expect(envelope.records).toEqual([
      {
        ordinal: 0,
        role: 'user',
        content: [{ type: 'text', text: 'visible question' }],
      },
      {
        ordinal: 1,
        role: 'assistant',
        content: [{ type: 'text', text: 'visible answer' }],
      },
    ]);
  });

  it.each([
    {
      label: 'unknown discriminant',
      block: { type: 'future_provider_block' },
    },
    {
      label: 'text extra field',
      block: { type: 'text', text: 'visible', private: 'forged' },
    },
    {
      label: 'image extra field',
      block: {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'provider-private-image',
        },
        private: 'forged',
      },
    },
    {
      label: 'tool_use extra field',
      block: {
        type: 'tool_use',
        id: 'tool-1',
        name: 'read',
        input: {},
        private: 'forged',
      },
    },
    {
      label: 'tool_result extra field',
      block: {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'provider-private-result',
        private: 'forged',
      },
    },
    {
      label: 'thinking extra field',
      block: {
        type: 'thinking',
        thinking: 'provider-private-reasoning',
        private: 'forged',
      },
    },
    {
      label: 'non-string text payload',
      block: { type: 'text', text: 42 },
    },
  ])('rejects a synthesized context block with $label before discarding it', ({ block }) => {
    expect(() => buildSynthesizedProviderContext('compaction', [{
      role: 'assistant',
      content: [block as never],
    }])).toThrow('KIMI_STRICT_TOOL_CONTEXT_REJECTED');
  });
});
