import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMeetingModelService, type MeetingModelInfo, type MeetingModelService } from './meeting-model-service.js';
import { normalizeTranscriptSegmentText } from './meeting-local-transcriber.js';
import { decodePcm16WavToFloat32 } from './meeting-audio-format.js';
import type { MeetingTranscriber } from './meeting-service.js';

const DEFAULT_SHERPA_ONNX_MODEL = 'sherpa-onnx-paraformer-zh-small-2024-03-09';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_DECODE_CHUNK_SECONDS = 30;
const sherpaRecognizerCache = new Map<string, Promise<SherpaOfflineRecognizer>>();

interface SherpaOfflineStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync(stream: SherpaOfflineStream): Promise<{ text?: string }>;
  getResult?: (stream: SherpaOfflineStream) => { text?: string };
}

interface SherpaOnnxRuntime {
  OfflineRecognizer: {
    createAsync(config: Record<string, unknown>): Promise<SherpaOfflineRecognizer>;
  };
  readWave?: (path: string) => { samples: Float32Array; sampleRate: number };
}

export interface SherpaOnnxParaformerTranscriberOptions {
  model?: string;
  modelService?: Pick<MeetingModelService, 'listModels'>;
  loadRuntime?: () => Promise<SherpaOnnxRuntime>;
  timeoutMs?: number;
}

export function createSherpaOnnxParaformerTranscriber(
  options: SherpaOnnxParaformerTranscriberOptions = {},
): MeetingTranscriber {
  const model = options.model ?? process.env.XIAOK_MEETING_SHERPA_ONNX_MODEL ?? DEFAULT_SHERPA_ONNX_MODEL;
  const modelService = options.modelService ?? createMeetingModelService();
  const loadRuntime = options.loadRuntime ?? loadSherpaOnnxRuntime;
  const timeoutMs = options.timeoutMs ?? Number(process.env.XIAOK_MEETING_TRANSCRIBE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  return {
    async transcribeFile(input) {
      const modelInfo = assertSherpaModelReady(modelService, model);
      let runtime: SherpaOnnxRuntime;
      try {
        runtime = await loadRuntime();
      } catch {
        throw new Error('sherpa_onnx_runtime_missing');
      }

      const modelPath = join(modelInfo.path, 'model.int8.onnx');
      const tokensPath = join(modelInfo.path, 'tokens.txt');
      const wave = decodePcm16WavToFloat32(await readFile(input.audioFilePath));
      const deadlineMs = Date.now() + timeoutMs;
      const recognizer = await withTimeout(
        getCachedSherpaRecognizer(runtime, modelPath, tokensPath, timeoutMs),
        remainingTimeoutMs(deadlineMs),
      );
      const chunkSampleCount = Math.max(1, Math.floor(wave.sampleRate * MAX_DECODE_CHUNK_SECONDS));
      const segments: Array<{ start: number; end: number; text: string }> = [];

      for (let offset = 0; offset < wave.samples.length; offset += chunkSampleCount) {
        const endOffset = Math.min(wave.samples.length, offset + chunkSampleCount);
        const stream = recognizer.createStream();
        stream.acceptWaveform({
          samples: new Float32Array(wave.samples.subarray(offset, endOffset)),
          sampleRate: wave.sampleRate,
        });
        const result = await withTimeout(
          recognizer.decodeAsync(stream),
          remainingTimeoutMs(deadlineMs),
        );
        const text = normalizeTranscriptSegmentText(String(result?.text ?? recognizer.getResult?.(stream)?.text ?? ''));
        if (!text) continue;
        segments.push({
          start: offset / wave.sampleRate,
          end: endOffset / wave.sampleRate,
          text,
        });
      }

      if (segments.length === 0) {
        throw new Error('empty_transcription');
      }
      return {
        text: segments.map(segment => segment.text).join('\n'),
        segments,
      };
    },
  };
}

export function clearSherpaOnnxRecognizerCacheForTests(): void {
  sherpaRecognizerCache.clear();
}

function getCachedSherpaRecognizer(
  runtime: SherpaOnnxRuntime,
  modelPath: string,
  tokensPath: string,
  timeoutMs: number,
): Promise<SherpaOfflineRecognizer> {
  const cacheKey = `${modelPath}\0${tokensPath}`;
  const cached = sherpaRecognizerCache.get(cacheKey);
  if (cached) return cached;

  const recognizer = withTimeout(runtime.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      paraformer: { model: modelPath },
      tokens: tokensPath,
      numThreads: 2,
      provider: 'cpu',
    },
  }), timeoutMs).catch(error => {
    sherpaRecognizerCache.delete(cacheKey);
    throw error;
  });
  sherpaRecognizerCache.set(cacheKey, recognizer);
  return recognizer;
}

function assertSherpaModelReady(
  modelService: Pick<MeetingModelService, 'listModels'>,
  modelId: string,
): MeetingModelInfo {
  const model = modelService.listModels().find(item => item.id === modelId);
  if (!model || model.engineId !== 'sherpa-onnx-paraformer') {
    throw new Error('sherpa_onnx_model_not_downloaded');
  }
  if (model.status !== 'downloaded') {
    throw new Error(model.status === 'incomplete' || model.status === 'corrupt'
      ? 'sherpa_onnx_model_incomplete'
      : 'sherpa_onnx_model_not_downloaded');
  }
  if (!existsSync(join(model.path, 'model.int8.onnx')) || !existsSync(join(model.path, 'tokens.txt'))) {
    throw new Error('sherpa_onnx_model_incomplete');
  }
  return model;
}

async function loadSherpaOnnxRuntime(): Promise<SherpaOnnxRuntime> {
  const moduleName = 'sherpa-onnx-node';
  const loaded = await import(moduleName) as { default?: unknown };
  return (loaded.default ?? loaded) as SherpaOnnxRuntime;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sherpa_onnx_transcribe_timeout')), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function remainingTimeoutMs(deadlineMs: number): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error('sherpa_onnx_transcribe_timeout');
  return remaining;
}
