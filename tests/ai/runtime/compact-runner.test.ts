import { describe, it, expect } from 'vitest';
import type { ModelAdapter, Message, StreamChunk } from '../../../src/types.js';
import { CompactRunner } from '../../../src/ai/runtime/compact-runner.js';

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
});
