import { describe, expect, it, vi } from 'vitest';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';
import type { StreamChunk } from '../../../src/types.js';
const phrase = '我将查看示例页面的状态。我需要先确认示例窗口的结构。';
const policy = { windowMs: 100, idleMs: 1000, initialDelayMs: 0, maxDelayMs: 0 };
const collect = async (stream: AsyncIterable<StreamChunk>) => {
  const values: StreamChunk[] = [];
  for await (const value of stream) values.push(value);
  return values;
};
describe('visible model text repetition protection', () => {
  it.each([1, 7, 131, 100_000])('rejects looping text for chunk size %s', async size => {
    const text = '示例检查开始。' + phrase.repeat(180) + '正常结尾不能掩盖前面的复读。';
    let owned!: AbortSignal;
    let closed = false;
    const retry = vi.fn(), shouldRetry = vi.fn(() => true);
    const delivered: StreamChunk[] = [];
    const open = vi.fn(async function* (signal: AbortSignal): AsyncGenerator<StreamChunk> {
      owned = signal;
      try {
        for (let i = 0; i < text.length; i += size) {
          yield { type: 'text', delta: text.slice(i, i + size) };
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        }
        yield { type: 'done' };
      } finally { closed = true; }
    });
    let failure: unknown;
    try { for await (const c of recoverModelStream({ open, signal: new AbortController().signal, policy, onRetry: retry, shouldRetry })) delivered.push(c); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false });
    expect(normalizeRuntimeError(failure)).toMatchObject({ code: 'model_failed', retryable: false });
    expect(String(failure)).not.toContain(phrase);
    expect(delivered.some(c => c.type === 'done')).toBe(false);
    expect(delivered.filter(c => c.type === 'text').map(c => c.delta).join('').length).toBeLessThan(1100);
    expect(open).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled(); expect(shouldRetry).not.toHaveBeenCalled();
    expect(owned.aborted).toBe(true); expect(closed).toBe(true);
  });
  it.each(['好。', 'Check the example panel before continuing. ', '示例状态等待确认。'.repeat(48)])('detects short and long repeated prose periods', async unit => {
    await expect(collect(recoverModelStream({ signal: new AbortController().signal, policy,
      open: async function* () { yield { type: 'text', delta: unit.repeat(400) }; yield { type: 'done' }; },
    }))).rejects.toMatchObject({ code: 'MODEL_TEXT_REPETITION_DETECTED' });
  });
  it('preserves numbered lists, code, separators and sparse quotes', async () => {
    const text = Array.from({ length: 400 }, (_, i) => `${i}: const result${i} = inspect(${i});\n${phrase}\n当前编号 ${i} 已完成\n`).join('') + '-'.repeat(9000) + '0'.repeat(9000);
    const out = await collect(recoverModelStream({ signal: new AbortController().signal, policy,
      open: async function* () {
        for (let i = 0; i < text.length; i += 137) yield { type: 'text', delta: text.slice(i, i + 137) };
        yield { type: 'done' };
      },
    }));
    expect(out.filter(c => c.type === 'text').map(c => c.delta).join('')).toBe(text);
    expect(out.at(-1)?.type).toBe('done');
  });
  it('does not accumulate thinking or tool arguments as visible text', async () => {
    const chunks: StreamChunk[] = [{ type: 'thinking', delta: phrase.repeat(100) },
      { type: 'tool_use', id: 'one', name: 'inspect', input: { sample: phrase.repeat(100) } },
      { type: 'text', delta: '本次操作仍须等待真实工具结果。' }, { type: 'done' }];
    expect(await collect(recoverModelStream({ signal: new AbortController().signal, policy,
      open: async function* () { yield* chunks; },
    }))).toEqual(chunks);
  });
  it('starts a fresh detector per recovered request', async () => {
    let calls = 0;
    const prefix = phrase.repeat(10);
    const out = await collect(recoverModelStream({ signal: new AbortController().signal, policy,
      open: async function* () {
        yield { type: 'text', delta: prefix };
        if (++calls === 1) throw new Error('terminated');
        yield { type: 'done' };
      },
    }));
    expect(calls).toBe(2);
    expect(out.filter(c => c.type === 'text').map(c => c.delta).join('')).toBe(prefix + prefix);
  });
  it('keeps the caller signal separate from the failed provider attempt', async () => {
    const controller = new AbortController();
    await expect(collect(recoverModelStream({ signal: controller.signal, policy,
      open: async function* () { yield { type: 'text', delta: phrase.repeat(30) }; },
    }))).rejects.toMatchObject({ message: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false });
    expect(controller.signal.aborted).toBe(false);
  });
});
