import { describe, expect, it } from 'vitest';
import {
  createMeetingPunctuationService,
  terminalFallbackMeetingPunctuation,
} from '../../electron/meeting-punctuation-service.js';
import type { MeetingModelInfo } from '../../electron/meeting-model-service.js';

const READY_PUNCTUATION_MODEL: MeetingModelInfo = {
  id: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8',
  fileName: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
  sizeBytes: 76_000_000,
  sizeLabel: '76 MB',
  cacheDir: '/models',
  path: '/models/sherpa-onnx-punct',
  downloaded: true,
  status: 'downloaded',
  engineId: 'sherpa-onnx-punctuation',
  packageId: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8',
  packageType: 'directory',
  packageState: 'verified',
  manifestTrusted: true,
  runtimeAutoDownloadAllowed: false,
  capability: 'punctuation',
};

describe('MeetingPunctuationService', () => {
  it('restores final punctuation with the configured local punctuation model', async () => {
    const calls: Array<{ text: string; modelPath: string }> = [];
    const service = createMeetingPunctuationService({
      modelService: { listModels: () => [READY_PUNCTUATION_MODEL] },
      runPunctuationWorker: async (input) => {
        calls.push(input);
        return '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。';
      },
    });

    const result = await service.restoreFinalPunctuation({
      text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
      segments: [{
        start: 0,
        end: 8,
        text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
      }],
      language: 'zh',
    });

    expect(calls).toEqual([{
      text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
      modelPath: '/models/sherpa-onnx-punct/model.int8.onnx',
    }]);
    expect(result).toMatchObject({
      status: 'ready',
      provider: 'sherpa-onnx-punctuation',
      modelId: READY_PUNCTUATION_MODEL.id,
      rawText: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
      punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
      segments: [{
        start: 0,
        end: 8,
        rawText: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
        punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
        stable: true,
      }],
    });
    expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('degrades to terminal-only fallback without guessing Chinese names or time words', async () => {
    const service = createMeetingPunctuationService({
      modelService: { listModels: () => [] },
      runPunctuationWorker: async () => {
        throw new Error('worker_should_not_run_without_model');
      },
    });

    const result = await service.restoreFinalPunctuation({
      text: '李四明天下午确认报价方案',
      segments: [{ start: 0, end: 2, text: '李四明天下午确认报价方案' }],
      language: 'zh',
    });

    expect(result.status).toBe('degraded');
    expect(result.provider).toBe('terminal-fallback');
    expect(result.punctuatedText).toBe('李四明天下午确认报价方案。');
    expect(result.punctuatedText).not.toContain('李四。');
    expect(result.punctuatedText).not.toContain('明。');
    expect(result.diagnostics.reason).toBe('punctuation_model_not_downloaded');
  });

  it('keeps only a mutable tail for streaming punctuation updates', async () => {
    const service = createMeetingPunctuationService({
      modelService: { listModels: () => [READY_PUNCTUATION_MODEL] },
      mutableTailChars: 6,
      runPunctuationWorker: async () => '张三负责跟进客户需求。李四确认报价。',
    });

    const result = await service.restoreStreamingPunctuation({
      previousStableText: '',
      mutableTailText: '张三负责跟进',
      incomingText: '客户需求李四确认报价',
      segments: [{ start: 0, end: 5, text: '张三负责跟进客户需求李四确认报价' }],
      isFinal: false,
    });

    expect(result.status).toBe('ready');
    expect(result.punctuatedText.endsWith('李四确认报价。')).toBe(true);
    expect(result.diagnostics.mutableTailChars).toBe(6);
    expect(result.segments[0].stable).toBe(false);
  });

  it('preserves already punctuated transcript text without re-running the model', async () => {
    const service = createMeetingPunctuationService({
      modelService: { listModels: () => [READY_PUNCTUATION_MODEL] },
      runPunctuationWorker: async () => {
        throw new Error('worker_should_not_run_for_existing_punctuation');
      },
    });

    const result = await service.restoreFinalPunctuation({
      text: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
      segments: [{
        start: 0,
        end: 8,
        text: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
      }],
      language: 'zh',
    });

    expect(result.status).toBe('ready');
    expect(result.provider).toBe('existing-punctuation');
    expect(result.punctuatedText).toBe('张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。');
    expect(result.punctuatedText).not.toContain('。。');
  });
});

describe('terminalFallbackMeetingPunctuation', () => {
  it('only adds terminal punctuation and does not split clauses', () => {
    expect(terminalFallbackMeetingPunctuation('张三负责整理需求李四需要确认接口风险'))
      .toBe('张三负责整理需求李四需要确认接口风险。');
  });
});
