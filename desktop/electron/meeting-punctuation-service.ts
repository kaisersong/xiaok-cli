import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createMeetingModelService, type MeetingModelInfo, type MeetingModelService } from './meeting-model-service.js';
import { normalizeTranscriptText } from './meeting-local-transcriber.js';
import type { MeetingTranscriptSegment } from './meeting-summary-service.js';
import type {
  MeetingPunctuationWorkerRequest,
  MeetingPunctuationWorkerResponse,
} from './meeting-punctuation-worker.js';

const DEFAULT_PUNCTUATION_MODEL = 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8';
const DEFAULT_PUNCTUATION_TIMEOUT_MS = 30_000;
const DEFAULT_MUTABLE_TAIL_CHARS = 60;

export type MeetingPunctuationStatus = 'ready' | 'degraded' | 'failed';
export type MeetingPunctuationProvider = 'sherpa-onnx-punctuation' | 'funasr-ct-punc' | 'terminal-fallback' | 'existing-punctuation';

export interface MeetingPunctuationSegment {
  start: number;
  end: number;
  rawText: string;
  punctuatedText: string;
  stable: boolean;
}

export interface MeetingPunctuationResult {
  rawText: string;
  punctuatedText: string;
  segments: MeetingPunctuationSegment[];
  status: MeetingPunctuationStatus;
  provider: MeetingPunctuationProvider;
  modelId: string;
  diagnostics: {
    inputChars: number;
    outputChars: number;
    elapsedMs: number;
    mutableTailChars?: number;
    reason?: string;
  };
}

export interface MeetingTextPostProcessor {
  restoreFinalPunctuation(input: {
    text: string;
    segments: MeetingTranscriptSegment[];
    language: 'zh' | 'en' | 'auto';
  }): Promise<MeetingPunctuationResult>;
  restoreStreamingPunctuation(input: {
    previousStableText: string;
    mutableTailText: string;
    incomingText: string;
    segments: MeetingTranscriptSegment[];
    isFinal: boolean;
  }): Promise<MeetingPunctuationResult>;
}

export interface MeetingPunctuationServiceOptions {
  modelId?: string;
  modelService?: Pick<MeetingModelService, 'listModels'>;
  mutableTailChars?: number;
  timeoutMs?: number;
  now?: () => number;
  runPunctuationWorker?: (input: MeetingPunctuationWorkerRequest) => Promise<string>;
}

export function createMeetingPunctuationService(
  options: MeetingPunctuationServiceOptions = {},
): MeetingTextPostProcessor {
  const modelId = options.modelId ?? DEFAULT_PUNCTUATION_MODEL;
  const modelService = options.modelService ?? createMeetingModelService();
  const mutableTailChars = options.mutableTailChars ?? DEFAULT_MUTABLE_TAIL_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PUNCTUATION_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const runPunctuationWorker = options.runPunctuationWorker ?? ((input) => runPunctuationWorkerThread(input, timeoutMs));

  async function restoreFinalPunctuation(input: {
    text: string;
    segments: MeetingTranscriptSegment[];
    language: 'zh' | 'en' | 'auto';
  }): Promise<MeetingPunctuationResult> {
    const startedAt = now();
    const rawText = normalizeRawPunctuationInput(input.text || input.segments.map(segment => segment.text).join(' '));
    if (!rawText) {
      return buildResult({
        rawText,
        punctuatedText: '',
        segments: input.segments,
        status: 'degraded',
        provider: 'terminal-fallback',
        modelId: 'none',
        elapsedMs: now() - startedAt,
        reason: 'empty_transcript',
      });
    }
    if (isAlreadyPunctuatedTranscript(rawText)) {
      return buildResult({
        rawText,
        punctuatedText: rawText,
        segments: input.segments,
        status: 'ready',
        provider: 'existing-punctuation',
        modelId: 'none',
        elapsedMs: now() - startedAt,
      });
    }

    const model = findReadyPunctuationModel(modelService, modelId);
    if (!model) {
      return buildResult({
        rawText,
        punctuatedText: terminalFallbackMeetingPunctuation(rawText),
        segments: input.segments,
        status: 'degraded',
        provider: 'terminal-fallback',
        modelId: 'none',
        elapsedMs: now() - startedAt,
        reason: 'punctuation_model_not_downloaded',
      });
    }

    const modelPath = join(model.path, 'model.int8.onnx');
    try {
      const punctuatedText = normalizePunctuatedOutput(await runPunctuationWorker({ text: rawText, modelPath }));
      return buildResult({
        rawText,
        punctuatedText: punctuatedText || terminalFallbackMeetingPunctuation(rawText),
        segments: input.segments,
        status: 'ready',
        provider: 'sherpa-onnx-punctuation',
        modelId: model.id,
        elapsedMs: now() - startedAt,
      });
    } catch (error) {
      return buildResult({
        rawText,
        punctuatedText: terminalFallbackMeetingPunctuation(rawText),
        segments: input.segments,
        status: 'failed',
        provider: 'sherpa-onnx-punctuation',
        modelId: model.id,
        elapsedMs: now() - startedAt,
        reason: error instanceof Error ? error.message : 'punctuation_failed',
      });
    }
  }

  async function restoreStreamingPunctuation(input: {
    previousStableText: string;
    mutableTailText: string;
    incomingText: string;
    segments: MeetingTranscriptSegment[];
    isFinal: boolean;
  }): Promise<MeetingPunctuationResult> {
    const combined = [input.previousStableText, input.mutableTailText, input.incomingText]
      .map(normalizeRawPunctuationInput)
      .filter(Boolean)
      .join('');
    const result = await restoreFinalPunctuation({
      text: combined,
      segments: input.segments,
      language: 'zh',
    });
    return {
      ...result,
      segments: result.segments.map(segment => ({ ...segment, stable: input.isFinal })),
      diagnostics: {
        ...result.diagnostics,
        mutableTailChars: input.isFinal ? 0 : mutableTailChars,
      },
    };
  }

  return { restoreFinalPunctuation, restoreStreamingPunctuation };
}

export function terminalFallbackMeetingPunctuation(text: string): string {
  const normalized = normalizeRawPunctuationInput(text);
  if (!normalized) return '';
  return /[。！？.!?]$/.test(normalized) ? normalized : `${normalized}。`;
}

function findReadyPunctuationModel(
  modelService: Pick<MeetingModelService, 'listModels'>,
  modelId: string,
): MeetingModelInfo | null {
  const models = modelService.listModels();
  const selected = models.find(model => model.id === modelId)
    ?? models.find(model => model.capability === 'punctuation' && model.status === 'downloaded');
  if (!selected || selected.capability !== 'punctuation' || selected.status !== 'downloaded') return null;
  if (selected.engineId !== 'sherpa-onnx-punctuation') return null;
  return selected;
}

function buildResult(input: {
  rawText: string;
  punctuatedText: string;
  segments: MeetingTranscriptSegment[];
  status: MeetingPunctuationStatus;
  provider: MeetingPunctuationProvider;
  modelId: string;
  elapsedMs: number;
  reason?: string;
}): MeetingPunctuationResult {
  const rawText = input.rawText;
  const punctuatedText = normalizePunctuatedOutput(input.punctuatedText);
  return {
    rawText,
    punctuatedText,
    segments: buildPunctuationSegments(input.segments, rawText, punctuatedText, input.status === 'ready'),
    status: input.status,
    provider: input.provider,
    modelId: input.modelId,
    diagnostics: {
      inputChars: rawText.length,
      outputChars: punctuatedText.length,
      elapsedMs: Math.max(0, input.elapsedMs),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  };
}

function buildPunctuationSegments(
  segments: MeetingTranscriptSegment[],
  rawText: string,
  punctuatedText: string,
  stable: boolean,
): MeetingPunctuationSegment[] {
  if (segments.length > 1 && punctuatedText === terminalFallbackMeetingPunctuation(rawText)) {
    return segments.flatMap((segment) => {
      const segmentRawText = normalizeRawPunctuationInput(segment.text);
      if (!segmentRawText) return [];
      return [{
        start: segment.start,
        end: segment.end,
        rawText: segmentRawText,
        punctuatedText: terminalFallbackMeetingPunctuation(segmentRawText),
        stable,
      }];
    });
  }
  const start = segments[0]?.start ?? 0;
  const end = segments.length ? segments[segments.length - 1].end : 0;
  return [{
    start,
    end,
    rawText,
    punctuatedText,
    stable,
  }];
}

function normalizeRawPunctuationInput(text: string): string {
  return normalizeTranscriptText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePunctuatedOutput(text: string): string {
  return normalizeTranscriptText(text)
    .replace(/([。！？.!?])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAlreadyPunctuatedTranscript(text: string): boolean {
  const marks = text.match(/[。！？.!?]/g)?.length ?? 0;
  if (marks >= 2) return true;
  return marks === 1 && text.length <= 24;
}

function runPunctuationWorkerThread(input: MeetingPunctuationWorkerRequest, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./meeting-punctuation-worker.js', import.meta.url), {
      workerData: input,
      execArgv: [],
    });
    const timer = setTimeout(() => {
      worker.terminate().catch(() => undefined);
      reject(new Error('punctuation_timeout'));
    }, timeoutMs);

    worker.once('message', (message: MeetingPunctuationWorkerResponse) => {
      clearTimeout(timer);
      worker.terminate().catch(() => undefined);
      if (message.ok) {
        resolve(message.text);
      } else {
        reject(new Error(message.error));
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      worker.terminate().catch(() => undefined);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (code === 0) return;
      clearTimeout(timer);
      reject(new Error(`punctuation_worker_exit:${code}`));
    });
  });
}
