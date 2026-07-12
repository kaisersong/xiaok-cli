import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import type { KbStore } from '../../electron/kb-store.js';
import { writePcm16WavFile } from '../../electron/meeting-audio-format.js';
import { createMeetingService } from '../../electron/meeting-service.js';
import { createLocalMeetingSummaryService, createMeetingSummaryService } from '../../electron/meeting-summary-service.js';
import { createLocalMeetingTranscriber } from '../../electron/meeting-local-transcriber.js';

describe('Meeting assistant phase-one e2e', () => {
  let rootDir: string;
  let store: KbStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = createKbStoreSqlite(join(rootDir, 'knowledge.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('transcribes a WAV recording, summarizes it, and persists searchable KB chunks with timestamps', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'weekly-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(16_000), sampleRate: 16_000, channels: 1 });

    const binding = {
      providerId: 'ollama',
      modelId: 'local-summary',
      locality: 'local' as const,
      configHash: 'local-hash',
    };
    const summaryService = createMeetingSummaryService({
      resolveBinding: async () => binding,
      summarizeTranscript: async () => ({
        title: 'Demo 发布决策',
        attendees: ['Alice', 'Bob'],
        decisions: ['Ship the demo this Friday'],
        actionItems: [{ owner: 'Alice', text: 'Ship the demo' }],
      }),
    });
    const service = createMeetingService({
      store,
      transcriber: {
        transcribeFile: async () => ({
          text: 'Alice will ship the demo. Bob will write notes.',
          segments: [
            { start: 0, end: 1, text: 'Alice will ship the demo.' },
            { start: 1, end: 2, text: 'Bob will write notes.' },
          ],
        }),
      },
      summaryService,
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const result = await service.processRecording({
      requestSource: 'user',
      collectionId: collection.id,
      title: 'Weekly Sync',
      audioFilePath,
      summaryProvider: 'local-only',
      consentSnapshot: binding,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meeting.status).toBe('saved');
    expect(result.source.title).toMatch(/^Demo 发布决策 - \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(result.source.title).not.toBe('Weekly Sync');
    expect(result.meeting.title).toBe(result.source.title);
    expect(result.source).toMatchObject({
      kind: 'meeting',
      parseStatus: 'parsed',
      metadata: {
        audioRetention: 'kept',
        durationSeconds: 1,
        meetingId: result.meeting.id,
        participantHints: ['Alice', 'Bob'],
      },
    });
    expect(result.chunks.map(chunk => chunk.metadata)).toEqual([
      { startTime: 0, endTime: 0, transcribeStatus: 'ok', kind: 'summary' },
      { startTime: 0, endTime: 1, transcribeStatus: 'ok', kind: 'transcript' },
      { startTime: 1, endTime: 2, transcribeStatus: 'ok', kind: 'transcript' },
    ]);
    expect(store.getSourceWithContent(result.source.id)?.text).toContain('## 会议纪要');
    expect(store.getSourceWithContent(result.source.id)?.text).toContain('Ship the demo');
    expect(store.getSourceWithContent(result.source.id)?.text).toContain('Alice will ship the demo.');
  });

  it('imports an existing transcript with WAV metadata into the knowledge base', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'imported-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    const service = createMeetingService({ store, now: () => 2_000 });

    const result = await service.saveTranscript({
      requestSource: 'user',
      collectionId: collection.id,
      title: 'Imported Sync',
      audioFilePath,
      transcript: 'Carol will prepare the rollout checklist.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meeting).toMatchObject({ status: 'saved', sourceId: result.source.id, title: 'Imported Sync' });
    expect(result.source).toMatchObject({
      kind: 'meeting',
      parseStatus: 'parsed',
      metadata: {
        audioRetention: 'kept',
        durationSeconds: 1,
        meetingId: result.meeting.id,
      },
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].metadata).toEqual({ startTime: 0, endTime: 1, transcribeStatus: 'ok', kind: 'transcript' });
    expect(store.getSourceWithContent(result.source.id)?.text).toContain('Carol will prepare the rollout checklist.');
  });

  it('drafts a summary for recorded audio without persisting it before user confirmation', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'draft-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    const service = createMeetingService({
      store,
      transcriber: {
        transcribeFile: async () => ({
          text: 'Alice will ship the demo.',
          segments: [{ start: 0, end: 1, text: 'Alice will ship the demo.' }],
        }),
      },
      summaryService: createMeetingSummaryService({
        resolveBinding: async () => ({
          providerId: 'ollama',
          modelId: 'local-summary',
          locality: 'local' as const,
          configHash: 'local-hash',
        }),
        summarizeTranscript: async () => ({
          title: 'Demo 发布计划',
          attendees: ['Alice'],
          decisions: ['Ship the demo this Friday'],
          actionItems: [{ owner: 'Alice', text: 'Ship the demo' }],
        }),
      }),
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const draft = await service.draftRecording({
      requestSource: 'user',
      title: 'Weekly Sync',
      audioFilePath,
      summaryProvider: 'local-only',
    });

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(store.listSources(collection.id)).toHaveLength(0);
    expect(draft.suggestedTitle).toMatch(/^Demo 发布计划 - \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(draft.summaryMarkdown).toContain('## 会议纪要');
    expect(draft.summaryMarkdown).toContain('Ship the demo');
    expect(draft.transcript).toBe('Alice will ship the demo.');
  });

  it('drafts Chinese meeting minutes from the punctuated transcript instead of raw ASR text', async () => {
    const audioFilePath = join(rootDir, 'spoken-chinese.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    let summaryTranscript = '';
    const service = createMeetingService({
      store,
      transcriber: {
        transcribeFile: async () => ({
          text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
          segments: [{
            start: 0,
            end: 5,
            text: '张三负责跟进客户需求李四明天下午确认报价方案王五下周提交复盘材料',
          }],
        }),
      },
      punctuationService: {
        restoreFinalPunctuation: async ({ text, segments }) => ({
          rawText: text,
          punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
          segments: [{
            start: segments[0]?.start ?? 0,
            end: segments[0]?.end ?? 0,
            rawText: text,
            punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
            stable: true,
          }],
          status: 'ready' as const,
          provider: 'sherpa-onnx-punctuation' as const,
          modelId: 'punc',
          diagnostics: { inputChars: text.length, outputChars: 34, elapsedMs: 1 },
        }),
        restoreStreamingPunctuation: async () => {
          throw new Error('not_used');
        },
      },
      summaryService: createMeetingSummaryService({
        resolveBinding: async () => ({
          providerId: 'ollama',
          modelId: 'local-summary',
          locality: 'local' as const,
          configHash: 'local-hash',
        }),
        summarizeTranscript: async ({ transcript }) => {
          summaryTranscript = transcript;
          return {
            title: '客户需求报价跟进',
            attendees: [],
            decisions: [],
            actionItems: [{ owner: '张三', text: '跟进客户需求。' }],
          };
        },
      }),
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const draft = await service.draftRecording({
      requestSource: 'user',
      title: '临时讨论',
      audioFilePath,
      summaryProvider: 'local-only',
      scenario: 'discussion',
    });

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(summaryTranscript).toBe('张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。');
    expect(draft.transcript).toBe('张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。');
    expect(draft.summaryMarkdown).toContain('- 张三: 跟进客户需求。');
  });

  it('processes recordings with punctuated transcript before writing KB chunks', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'punctuated-process.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    let summaryTranscript = '';
    const service = createMeetingService({
      store,
      transcriber: {
        transcribeFile: async () => ({
          text: '张三负责跟进客户需求李四明天下午确认报价方案',
          segments: [{ start: 0, end: 4, text: '张三负责跟进客户需求李四明天下午确认报价方案' }],
        }),
      },
      punctuationService: {
        restoreFinalPunctuation: async ({ text }) => ({
          rawText: text,
          punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。',
          segments: [{
            start: 0,
            end: 4,
            rawText: text,
            punctuatedText: '张三负责跟进客户需求。李四明天下午确认报价方案。',
            stable: true,
          }],
          status: 'ready' as const,
          provider: 'sherpa-onnx-punctuation' as const,
          modelId: 'punc',
          diagnostics: { inputChars: text.length, outputChars: 25, elapsedMs: 1 },
        }),
        restoreStreamingPunctuation: async () => {
          throw new Error('not_used');
        },
      },
      summaryService: createMeetingSummaryService({
        resolveBinding: async () => ({
          providerId: 'ollama',
          modelId: 'local-summary',
          locality: 'local' as const,
          configHash: 'local-hash',
        }),
        summarizeTranscript: async ({ transcript }) => {
          summaryTranscript = transcript;
          return {
            title: '客户需求报价跟进',
            attendees: [],
            decisions: [],
            actionItems: [],
          };
        },
      }),
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const result = await service.processRecording({
      requestSource: 'user',
      collectionId: collection.id,
      title: '客户讨论',
      audioFilePath,
      summaryProvider: 'local-only',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(summaryTranscript).toBe('张三负责跟进客户需求。李四明天下午确认报价方案。');
    expect(store.getSourceWithContent(result.source.id)?.text).toContain('张三负责跟进客户需求。李四明天下午确认报价方案。');
    expect(store.getSourceWithContent(result.source.id)?.text).not.toContain('张三负责跟进客户需求李四明天下午确认报价方案');
  });

  it('returns a recording-only draft when no local transcriber is available', async () => {
    const audioFilePath = join(rootDir, 'recording-only.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    const service = createMeetingService({
      store,
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const draft = await service.draftRecording({
      requestSource: 'user',
      title: '客户拜访',
      audioFilePath,
      summaryProvider: 'local-only',
      scenario: 'sales',
    });

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.transcriptStatus).toBe('unavailable');
    expect(draft.suggestedTitle).toMatch(/^客户拜访 - \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(draft.transcript).toBe('');
    expect(draft.segments).toEqual([]);
    expect(draft.summaryMarkdown).toContain('转写不可用');
  });

  it('passes the selected recording scenario into summary generation', async () => {
    const audioFilePath = join(rootDir, 'sales-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    let observedScenario: string | undefined;
    const service = createMeetingService({
      store,
      transcriber: {
        transcribeFile: async () => ({
          text: '客户需要移动端试用。',
          segments: [{ start: 0, end: 1, text: '客户需要移动端试用。' }],
        }),
      },
      summaryService: createMeetingSummaryService({
        resolveBinding: async () => ({
          providerId: 'ollama',
          modelId: 'local-summary',
          locality: 'local' as const,
          configHash: 'local-hash',
        }),
        summarizeTranscript: async ({ scenario }) => {
          observedScenario = scenario;
          return {
            title: '客户需要移动端试用',
            scenario,
            attendees: [],
            decisions: [],
            actionItems: [],
          };
        },
      }),
    });

    const draft = await service.draftRecording({
      requestSource: 'user',
      title: '客户拜访',
      audioFilePath,
      summaryProvider: 'local-only',
      scenario: 'sales',
    });

    expect(draft.ok).toBe(true);
    expect(observedScenario).toBe('sales');
  });

  it('drafts from live transcript without re-running full-file transcription', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'live-preview-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    const transcriber = {
      transcribeFile: async () => {
        throw new Error('unexpected_full_transcription');
      },
    };
    const service = createMeetingService({
      store,
      transcriber,
      summaryService: createLocalMeetingSummaryService(),
      now: () => Date.parse('2026-07-09T10:12:00Z'),
    });

    const draft = await service.draftRecording({
      requestSource: 'user',
      title: 'Weekly Sync',
      audioFilePath,
      summaryProvider: 'local-only',
      transcript: '张三负责整理需求。\n李四需要确认接口风险。\n我们决定周五先小范围内测。',
      segments: [
        { start: 0, end: 1, text: '张三负责整理需求。' },
        { start: 1, end: 2, text: '李四需要确认接口风险。' },
        { start: 2, end: 3, text: '我们决定周五先小范围内测。' },
      ],
    } as any);

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(store.listSources(collection.id)).toHaveLength(0);
    expect(draft.summaryMarkdown).toContain('### 摘要');
    expect(draft.summaryMarkdown).toContain('- 张三负责整理需求。');
    expect(draft.summaryMarkdown).toContain('### 决策');
    expect(draft.summaryMarkdown).toContain('- 我们决定周五先小范围内测。');
    expect(draft.summaryMarkdown).toContain('### 待办');
    expect(draft.summaryMarkdown).toContain('- 张三: 整理需求。');
    expect(draft.summaryMarkdown).toContain('- 李四: 确认接口风险。');
  });

  it('runs the default local transcription and summary path into searchable KB chunks', async () => {
    const collection = store.createCollection({ name: 'Meetings', embeddingModelId: 'm', embeddingDim: 384 });
    const audioFilePath = join(rootDir, 'local-sync.wav');
    writePcm16WavFile(audioFilePath, { samples: new Int16Array(8_000), sampleRate: 8_000, channels: 1 });
    const exec = async () => ({
      stdout: JSON.stringify({
        text: 'Alice will ship the demo. Bob will write notes.',
        segments: [
          { start: 0, end: 1, text: 'Alice will ship the demo.' },
          { start: 1, end: 2, text: 'Bob will write notes.' },
        ],
      }),
    });
    const service = createMeetingService({
      store,
      transcriber: createLocalMeetingTranscriber({
        pythonCommand: 'python3',
        scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
        exec,
        modelService: {
          listModels: () => [{
            id: 'base',
            fileName: 'base.pt',
            sizeBytes: 1,
            sizeLabel: '1 B',
            cacheDir: rootDir,
            path: join(rootDir, 'base.pt'),
            downloaded: true,
            status: 'downloaded' as const,
          }],
        },
      }),
      summaryService: createLocalMeetingSummaryService(),
      now: () => 3_000,
    });

    const result = await service.processRecording({
      requestSource: 'user',
      collectionId: collection.id,
      title: 'Local Sync',
      audioFilePath,
      summaryProvider: 'local-only',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sourceContent = store.getSourceWithContent(result.source.id);
    expect(sourceContent?.text).toContain('## 会议纪要');
    expect(sourceContent?.text).toContain('Alice will ship the demo.');
    expect(result.source.metadata.participantHints).toEqual([]);
  });
});
