import { describe, expect, it, vi } from 'vitest';
import { runPunctuationWorkerRequest } from '../../electron/meeting-punctuation-worker.js';

describe('meeting punctuation worker', () => {
  it('uses sherpa-onnx OfflinePunctuation with ctTransformer and addPunct', async () => {
    const addPunct = vi.fn((text: string) => `${text}。`);
    const OfflinePunctuation = vi.fn(function OfflinePunctuation(this: { addPunct: typeof addPunct }, config: unknown) {
      expect(config).toEqual({
        model: {
          ctTransformer: '/models/punctuation/model.int8.onnx',
          numThreads: 1,
          provider: 'cpu',
        },
      });
      this.addPunct = addPunct;
    });

    const result = await runPunctuationWorkerRequest({
      text: '我们都是木头人不会说话不会动',
      modelPath: '/models/punctuation/model.int8.onnx',
    }, {
      loadRuntime: async () => ({ OfflinePunctuation }),
    });

    expect(OfflinePunctuation).toHaveBeenCalledTimes(1);
    expect(addPunct).toHaveBeenCalledWith('我们都是木头人不会说话不会动');
    expect(result).toEqual({
      ok: true,
      text: '我们都是木头人不会说话不会动。',
    });
  });

  it('returns a structured error when the native runtime fails', async () => {
    const result = await runPunctuationWorkerRequest({
      text: '测试',
      modelPath: '/missing/model.int8.onnx',
    }, {
      loadRuntime: async () => {
        throw new Error('Cannot find module sherpa-onnx-node');
      },
    });

    expect(result).toEqual({
      ok: false,
      error: 'Cannot find module sherpa-onnx-node',
    });
  });
});
