import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePcm16Wav } from '../../electron/meeting-audio-format.js';
import * as sherpaOnnxTranscriber from '../../electron/meeting-sherpa-onnx-transcriber.js';

const { createSherpaOnnxParaformerTranscriber } = sherpaOnnxTranscriber;

const MODEL_ID = 'sherpa-onnx-paraformer-zh-small-2024-03-09';

function readyModelService(modelDir: string) {
  return {
    listModels: () => [{
      id: MODEL_ID,
      capability: 'asr' as const,
      engineId: 'sherpa-onnx-paraformer',
      fileName: MODEL_ID,
      sizeBytes: 77_920_048,
      sizeLabel: '78 MB',
      cacheDir: join(modelDir, '..'),
      path: modelDir,
      downloaded: true,
      status: 'downloaded' as const,
      packageId: MODEL_ID,
      packageType: 'directory' as const,
      packageState: 'verified' as const,
      manifestTrusted: true,
      runtimeAutoDownloadAllowed: false as const,
    }],
  };
}

describe('sherpa-onnx Paraformer meeting transcriber', () => {
  let rootDir: string;
  let modelDir: string;
  let audioFilePath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-sherpa-onnx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    modelDir = join(rootDir, MODEL_ID);
    audioFilePath = join(rootDir, 'weekly-sync.wav');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'model.int8.onnx'), Buffer.alloc(4));
    writeFileSync(join(modelDir, 'tokens.txt'), 'a\nb\n');
    writeFileSync(audioFilePath, encodePcm16Wav({
      samples: new Int16Array([0, 3277, -3277]),
      sampleRate: 16_000,
      channels: 1,
    }));
  });

  afterEach(() => {
    (sherpaOnnxTranscriber as { clearSherpaOnnxRecognizerCacheForTests?: () => void })
      .clearSherpaOnnxRecognizerCacheForTests?.();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('runs the optional sherpa-onnx Node runtime with the selected Paraformer package', async () => {
    const acceptWaveform = vi.fn();
    const createStream = vi.fn(() => ({ acceptWaveform }));
    const decodeAsync = vi.fn(async () => ({ text: '张三负责跟进客户需求' }));
    const recognizer = { createStream, decodeAsync };
    const OfflineRecognizer = { createAsync: vi.fn(async () => recognizer) };
    const readWave = vi.fn(() => {
      throw new Error('External buffers are not allowed');
    });
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime: async () => ({ OfflineRecognizer, readWave }),
    });

    const result = await transcriber.transcribeFile({
      audioFilePath,
      meetingId: 'meeting-1',
    });

    expect(readWave).not.toHaveBeenCalled();
    expect(OfflineRecognizer.createAsync).toHaveBeenCalledWith(expect.objectContaining({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: expect.objectContaining({
        paraformer: { model: join(modelDir, 'model.int8.onnx') },
        tokens: join(modelDir, 'tokens.txt'),
        provider: 'cpu',
      }),
    }));
    expect(createStream).toHaveBeenCalled();
    expect(acceptWaveform).toHaveBeenCalledWith({
      samples: expect.any(Float32Array),
      sampleRate: 16000,
    });
    expect(Array.from(acceptWaveform.mock.calls[0][0].samples)).toEqual([
      0,
      3277 / 32768,
      -3277 / 32768,
    ]);
    expect(decodeAsync).toHaveBeenCalled();
    expect(result).toEqual({
      text: '张三负责跟进客户需求',
      segments: [{ start: 0, end: 3 / 16_000, text: '张三负责跟进客户需求' }],
    });
  });

  it('leaves long Chinese transcript text unpunctuated for the punctuation service', async () => {
    const acceptWaveform = vi.fn();
    const createStream = vi.fn(() => ({ acceptWaveform }));
    const decodeAsync = vi.fn(async () => ({
      text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
    }));
    const recognizer = { createStream, decodeAsync };
    const OfflineRecognizer = { createAsync: vi.fn(async () => recognizer) };
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime: async () => ({ OfflineRecognizer }),
    });

    const result = await transcriber.transcribeFile({
      audioFilePath,
      meetingId: 'meeting-1',
    });

    expect(result.text).toBe('张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料');
    expect(result.segments[0].text).toBe(result.text);
  });

  it('decodes long recordings in bounded chunks and keeps original timeline offsets', async () => {
    writeFileSync(audioFilePath, encodePcm16Wav({
      samples: new Int16Array(65 * 16_000),
      sampleRate: 16_000,
      channels: 1,
    }));
    const acceptedSampleCounts: number[] = [];
    const createStream = vi.fn(() => ({
      acceptWaveform: ({ samples }: { samples: Float32Array }) => acceptedSampleCounts.push(samples.length),
    }));
    const decodeAsync = vi.fn()
      .mockResolvedValueOnce({ text: '第一段客户需求' })
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: '第三段行动计划' });
    const recognizer = { createStream, decodeAsync };
    const OfflineRecognizer = { createAsync: vi.fn(async () => recognizer) };
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime: async () => ({ OfflineRecognizer }),
    });

    const result = await transcriber.transcribeFile({
      audioFilePath,
      meetingId: 'long-meeting',
    });

    expect(createStream).toHaveBeenCalledTimes(3);
    expect(decodeAsync).toHaveBeenCalledTimes(3);
    expect(acceptedSampleCounts).toEqual([30 * 16_000, 30 * 16_000, 5 * 16_000]);
    expect(result).toEqual({
      text: '第一段客户需求\n第三段行动计划',
      segments: [
        { start: 0, end: 30, text: '第一段客户需求' },
        { start: 60, end: 65, text: '第三段行动计划' },
      ],
    });
  });

  it('still rejects a recording when every decoded chunk is empty', async () => {
    writeFileSync(audioFilePath, encodePcm16Wav({
      samples: new Int16Array(31 * 16_000),
      sampleRate: 16_000,
      channels: 1,
    }));
    const recognizer = {
      createStream: vi.fn(() => ({ acceptWaveform: vi.fn() })),
      decodeAsync: vi.fn(async () => ({ text: '' })),
    };
    const OfflineRecognizer = { createAsync: vi.fn(async () => recognizer) };
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime: async () => ({ OfflineRecognizer }),
    });

    await expect(transcriber.transcribeFile({
      audioFilePath,
      meetingId: 'silent-meeting',
    })).rejects.toThrow('empty_transcription');
    expect(recognizer.createStream).toHaveBeenCalledTimes(2);
  });

  it('reuses the sherpa-onnx recognizer across preview transcriber instances for the same model', async () => {
    const acceptWaveform = vi.fn();
    const createStream = vi.fn(() => ({ acceptWaveform }));
    const decodeAsync = vi.fn(async () => ({ text: '张三负责跟进客户需求' }));
    const recognizer = { createStream, decodeAsync };
    const OfflineRecognizer = { createAsync: vi.fn(async () => recognizer) };
    const loadRuntime = vi.fn(async () => ({ OfflineRecognizer }));

    const first = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime,
    });
    const second = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime,
    });

    await first.transcribeFile({ audioFilePath, meetingId: 'preview-1' });
    await second.transcribeFile({ audioFilePath, meetingId: 'preview-2' });

    expect(OfflineRecognizer.createAsync).toHaveBeenCalledTimes(1);
    expect(createStream).toHaveBeenCalledTimes(2);
    expect(decodeAsync).toHaveBeenCalledTimes(2);
  });

  it('refuses to run when the selected Paraformer package is missing', async () => {
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: { listModels: () => [] },
      loadRuntime: async () => {
        throw new Error('should_not_load_runtime_without_model');
      },
    });

    await expect(transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    })).rejects.toThrow('sherpa_onnx_model_not_downloaded');
  });

  it('surfaces a clear error when the optional native runtime is unavailable', async () => {
    const transcriber = createSherpaOnnxParaformerTranscriber({
      model: MODEL_ID,
      modelService: readyModelService(modelDir),
      loadRuntime: async () => {
        throw new Error('Cannot find module sherpa-onnx-node');
      },
    });

    await expect(transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    })).rejects.toThrow('sherpa_onnx_runtime_missing');
  });
});
