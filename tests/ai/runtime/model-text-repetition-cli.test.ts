import { expect, it, vi } from 'vitest';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';
import { formatErrorText, writeError } from '../../../src/utils/ui.js';
it('displays repetition failure and manual regeneration hint without automatic retry', () => {
  const error = normalizeRuntimeError(Object.assign(new Error('MODEL_TEXT_REPETITION_DETECTED'), { code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false }));
  expect(error).toMatchObject({ code: 'model_failed', retryable: false });
  const text = formatErrorText(`Error: ${error.code}: ${error.message}`);
  expect(text).toContain('检测到重复输出，已停止');
  expect(text).toContain('重新发送上一条请求以重新生成');
  const sink = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { writeError(`model_failed: ${error.message}`); expect(sink).toHaveBeenCalledWith(expect.stringContaining(text)); }
  finally { sink.mockRestore(); }
});
it('keeps previously emitted CLI text when the next delta fails', async () => {
  const { recoverModelStream } = await import('../../../src/ai/runtime/model-stream-recovery.js');
  const emitted: string[] = [];
  await expect((async () => {
    for await (const chunk of recoverModelStream({ signal: new AbortController().signal, open: async function* () {
      yield { type: 'text', delta: 'already printed text' };
      yield { type: 'text', delta: '普通正文重复。'.repeat(100) };
    } })) if (chunk.type === 'text') emitted.push(chunk.delta);
  })()).rejects.toMatchObject({ retryable: false, code: 'MODEL_TEXT_REPETITION_DETECTED' });
  expect(emitted).toEqual(['already printed text']);
});
