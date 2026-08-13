import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { KbStore } from './kb-store.js';
import type { Chunk, MeetingRecord, Source } from './kb-types.js';
import { parsePcm16WavInfo } from './meeting-audio-format.js';
import { normalizeTranscriptSegmentText } from './meeting-local-transcriber.js';
import { createMeetingPunctuationService, type MeetingTextPostProcessor } from './meeting-punctuation-service.js';
import type {
  MeetingModelBinding,
  RecordingScenario,
  MeetingSummary,
  MeetingSummaryResult,
  MeetingTranscriptSegment,
} from './meeting-summary-service.js';

export type MeetingRequestSource = 'user' | 'agent' | 'scheduler';

export interface MeetingTranscriptionResult {
  text: string;
  segments: MeetingTranscriptSegment[];
}

export interface MeetingTranscriber {
  transcribeFile(input: { audioFilePath: string; meetingId: string }): Promise<MeetingTranscriptionResult>;
}

export interface MeetingSummaryServiceLike {
  summarizeMeeting(input: {
    transcript: string;
    segments: MeetingTranscriptSegment[];
    scenario?: RecordingScenario;
    summaryProvider: string;
    consentSnapshot?: MeetingModelBinding;
  }): Promise<MeetingSummaryResult | { ok: true; summary: MeetingSummary }>;
}

export interface CreateMeetingServiceDeps {
  store: KbStore;
  transcriber?: MeetingTranscriber;
  punctuationService?: MeetingTextPostProcessor;
  summaryService?: MeetingSummaryServiceLike;
  now?: () => number;
}

export interface ProcessRecordingInput {
  requestSource: MeetingRequestSource;
  collectionId: string;
  title: string;
  audioFilePath: string;
  summaryProvider: string;
  scenario?: RecordingScenario;
  consentSnapshot?: MeetingModelBinding;
}

export interface DraftRecordingInput {
  requestSource: MeetingRequestSource;
  title: string;
  audioFilePath: string;
  summaryProvider: string;
  scenario?: RecordingScenario;
  consentSnapshot?: MeetingModelBinding;
  transcript?: string;
  segments?: MeetingTranscriptSegment[];
}

export interface SaveMeetingTranscriptInput {
  requestSource: MeetingRequestSource;
  collectionId: string;
  title: string;
  audioFilePath: string;
  transcript: string;
  segments?: MeetingTranscriptSegment[];
}

export type ProcessRecordingResult =
  | { ok: true; meeting: MeetingRecord; source: Source; chunks: Chunk[]; summary: MeetingSummary }
  | { ok: false; error: 'agent_meeting_write_forbidden' }
  | { ok: false; error: 'transcriber_unavailable' | 'transcription_failed' | 'summary_service_unavailable' | 'summary_blocked_by_privacy'; meeting?: MeetingRecord; reason?: string };

export type DraftRecordingResult =
  | {
    ok: true;
    suggestedTitle: string;
    audioFilePath: string;
    transcript: string;
    segments: MeetingTranscriptSegment[];
    transcriptStatus?: 'ready' | 'unavailable' | 'failed' | 'interrupted';
    summary: MeetingSummary;
    summaryMarkdown: string;
  }
  | { ok: false; error: 'agent_meeting_write_forbidden' }
  | { ok: false; error: 'transcriber_unavailable' | 'transcription_failed' | 'summary_service_unavailable' | 'summary_blocked_by_privacy'; reason?: string };

export type SaveMeetingTranscriptResult =
  | { ok: true; meeting: MeetingRecord; source: Source; chunks: Chunk[] }
  | { ok: false; error: 'agent_meeting_write_forbidden' | 'transcript_required' };

export interface MeetingRecoveryChange {
  meetingId: string;
  from: MeetingRecord['status'];
  to: MeetingRecord['status'];
}

export interface MeetingService {
  processRecording(input: ProcessRecordingInput): Promise<ProcessRecordingResult>;
  draftRecording(input: DraftRecordingInput): Promise<DraftRecordingResult>;
  saveTranscript(input: SaveMeetingTranscriptInput): Promise<SaveMeetingTranscriptResult>;
  recoverMeetings(): Promise<MeetingRecoveryChange[]>;
}

export function createMeetingService(deps: CreateMeetingServiceDeps): MeetingService {
  const now = deps.now ?? (() => Date.now());
  const punctuationService = deps.punctuationService ?? createMeetingPunctuationService();

  async function processRecording(input: ProcessRecordingInput): Promise<ProcessRecordingResult> {
    if (input.requestSource === 'agent') {
      return { ok: false, error: 'agent_meeting_write_forbidden' };
    }
    if (!deps.transcriber) {
      return { ok: false, error: 'transcriber_unavailable' };
    }
    if (!deps.summaryService) {
      return { ok: false, error: 'summary_service_unavailable' };
    }

    const audioBytes = readFileSync(input.audioFilePath);
    const audioInfo = parsePcm16WavInfo(audioBytes);
    const audioStat = statSync(input.audioFilePath);
    const meeting = deps.store.createMeeting({
      id: randomUUID(),
      status: 'transcribing',
      title: input.title,
      audioFilePath: input.audioFilePath,
      audioRetention: 'kept',
      summaryProvider: input.summaryProvider,
      summaryProviderHash: input.consentSnapshot?.configHash ?? '',
      startedAt: now(),
    });

    let transcription: MeetingTranscriptionResult;
    try {
      transcription = await deps.transcriber.transcribeFile({
        audioFilePath: input.audioFilePath,
        meetingId: meeting.id,
      });
      transcription = normalizeMeetingTranscription(transcription);
      transcription = await restoreMeetingPunctuation(transcription, punctuationService);
    } catch (error) {
      const failed = deps.store.updateMeeting(meeting.id, {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'transcription_failed',
        endedAt: now(),
      }) ?? meeting;
      return {
        ok: false,
        error: 'transcription_failed',
        meeting: failed,
        reason: failed.failureReason,
      };
    }
    deps.store.updateMeeting(meeting.id, { status: 'summarizing' });

    const summaryResult = await deps.summaryService.summarizeMeeting({
      transcript: transcription.text,
      segments: transcription.segments,
      scenario: input.scenario ?? 'meeting',
      summaryProvider: input.summaryProvider,
      consentSnapshot: input.consentSnapshot,
    });
    if (!summaryResult.ok) {
      const blocked = deps.store.updateMeeting(meeting.id, {
        status: 'summary_blocked_by_privacy',
        failureReason: summaryResult.reason,
        summaryProviderHash: summaryResult.binding.configHash,
      }) ?? meeting;
      return {
        ok: false,
        error: 'summary_blocked_by_privacy',
        meeting: blocked,
        reason: summaryResult.reason,
      };
    }

    const completedAt = now();
    const sourceTitle = buildMeetingSourceTitle(summaryResult.summary, input.title, completedAt);
    const source = deps.store.addSource({
      collectionId: input.collectionId,
      kind: 'meeting',
      title: sourceTitle,
      filePath: input.audioFilePath,
      mimeType: 'audio/wav',
      byteSize: audioStat.size,
      parseStatus: 'parsed',
      metadata: {
        meetingId: meeting.id,
        durationSeconds: audioInfo.durationSeconds,
        audioRetention: 'kept',
        participantHints: summaryResult.summary.attendees,
        summary: summaryResult.summary,
      },
    }, input.requestSource);
    const chunks = deps.store.insertChunks(source.id, buildMeetingChunks(transcription.segments, summaryResult.summary));
    const saved = deps.store.updateMeeting(meeting.id, {
      sourceId: source.id,
      status: 'saved',
      title: source.title,
      summaryProviderHash: input.consentSnapshot?.configHash ?? '',
      endedAt: completedAt,
    }) ?? meeting;

    return { ok: true, meeting: saved, source, chunks, summary: summaryResult.summary };
  }

  async function draftRecording(input: DraftRecordingInput): Promise<DraftRecordingResult> {
    if (input.requestSource === 'agent') {
      return { ok: false, error: 'agent_meeting_write_forbidden' };
    }
    if (!deps.summaryService) {
      if (!deps.transcriber) {
        return buildRecordingOnlyDraft(input, now());
      }
      return { ok: false, error: 'summary_service_unavailable' };
    }

    let transcription = buildProvidedTranscription(input.transcript, input.segments);
    if (!transcription) {
      if (!deps.transcriber) {
        return buildRecordingOnlyDraft(input, now());
      }
      try {
        transcription = await deps.transcriber.transcribeFile({
          audioFilePath: input.audioFilePath,
          meetingId: randomUUID(),
        });
        transcription = normalizeMeetingTranscription(transcription);
      } catch (error) {
        return {
          ok: false,
          error: 'transcription_failed',
          reason: error instanceof Error ? error.message : 'transcription_failed',
        };
      }
    }
    transcription = await restoreMeetingPunctuation(transcription, punctuationService);

    const summaryResult = await deps.summaryService.summarizeMeeting({
      transcript: transcription.text,
      segments: transcription.segments,
      scenario: input.scenario ?? 'meeting',
      summaryProvider: input.summaryProvider,
      consentSnapshot: input.consentSnapshot,
    });
    if (!summaryResult.ok) {
      return {
        ok: false,
        error: 'summary_blocked_by_privacy',
        reason: summaryResult.reason,
      };
    }

    return {
      ok: true,
      suggestedTitle: buildMeetingSourceTitle(summaryResult.summary, input.title, now()),
      audioFilePath: input.audioFilePath,
      transcript: transcription.text,
      segments: transcription.segments,
      transcriptStatus: 'ready',
      summary: summaryResult.summary,
      summaryMarkdown: formatMeetingSummaryDraft(summaryResult.summary),
    };
  }

  async function saveTranscript(input: SaveMeetingTranscriptInput): Promise<SaveMeetingTranscriptResult> {
    if (input.requestSource === 'agent') {
      return { ok: false, error: 'agent_meeting_write_forbidden' };
    }
    const transcript = input.transcript.trim();
    if (!transcript) {
      return { ok: false, error: 'transcript_required' };
    }

    const audioBytes = readFileSync(input.audioFilePath);
    const audioInfo = parsePcm16WavInfo(audioBytes);
    const audioStat = statSync(input.audioFilePath);
    const meeting = deps.store.createMeeting({
      id: randomUUID(),
      status: 'saved',
      title: input.title,
      audioFilePath: input.audioFilePath,
      audioRetention: 'kept',
      summaryProvider: 'manual-transcript',
      startedAt: now(),
      endedAt: now(),
    });

    const source = deps.store.addSource({
      collectionId: input.collectionId,
      kind: 'meeting',
      title: input.title,
      filePath: input.audioFilePath,
      mimeType: 'audio/wav',
      byteSize: audioStat.size,
      parseStatus: 'parsed',
      metadata: {
        meetingId: meeting.id,
        durationSeconds: audioInfo.durationSeconds,
        audioRetention: 'kept',
        participantHints: [],
      },
    }, input.requestSource);
    const chunks = deps.store.insertChunks(source.id, buildMeetingChunks(
      input.segments?.length ? input.segments : [{
        start: 0,
        end: audioInfo.durationSeconds,
        text: transcript,
      }],
    ));
    const saved = deps.store.updateMeeting(meeting.id, { sourceId: source.id }) ?? meeting;
    return { ok: true, meeting: saved, source, chunks };
  }

  async function recoverMeetings(): Promise<MeetingRecoveryChange[]> {
    const changes: MeetingRecoveryChange[] = [];
    for (const meeting of deps.store.listMeetings()) {
      let nextStatus: MeetingRecord['status'] | undefined;
      let failureReason: string | undefined;
      if (meeting.status === 'recording' || meeting.status === 'paused' || meeting.status === 'stopping') {
        nextStatus = 'interrupted';
      } else if (meeting.status === 'summarizing') {
        nextStatus = 'transcribed';
      } else if (meeting.status === 'transcribing') {
        if (meeting.audioFilePath && existsSync(meeting.audioFilePath)) {
          nextStatus = 'interrupted';
          failureReason = 'transcription_interrupted';
        } else {
          nextStatus = 'failed';
          failureReason = 'audio_missing';
        }
      }

      if (nextStatus && nextStatus !== meeting.status) {
        deps.store.updateMeeting(meeting.id, {
          status: nextStatus,
          failureReason: failureReason ?? meeting.failureReason,
        });
        changes.push({ meetingId: meeting.id, from: meeting.status, to: nextStatus });
      }
    }
    return changes;
  }

  return { processRecording, draftRecording, saveTranscript, recoverMeetings };
}

function buildRecordingOnlyDraft(input: DraftRecordingInput, timestamp: number): DraftRecordingResult {
  const title = `${summarizeMeetingTitle({
    title: input.title,
    scenario: input.scenario ?? 'meeting',
    attendees: [],
    decisions: [],
    actionItems: [],
  }, input.title)} - ${formatMeetingTitleTime(timestamp)}`;
  const summary: MeetingSummary = {
    title: input.title.trim() || '录音',
    scenario: input.scenario ?? 'meeting',
    overview: ['转写不可用，已保留音频。'],
    attendees: [],
    decisions: [],
    actionItems: [],
  };
  return {
    ok: true,
    suggestedTitle: title,
    audioFilePath: input.audioFilePath,
    transcript: '',
    segments: [],
    transcriptStatus: 'unavailable',
    summary,
    summaryMarkdown: '## 录音\n\n转写不可用，已保留音频。请安装或修复本地转写模型后重试。\n',
  };
}

function buildProvidedTranscription(transcript?: string, segments?: MeetingTranscriptSegment[]): MeetingTranscriptionResult | null {
  const normalizedSegments = (segments ?? []).flatMap((segment) => {
    const text = normalizeTranscriptSegmentText(segment.text);
    if (!text) return [];
    const start = Number(segment.start);
    const end = Number(segment.end);
    return [{
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 0,
      text,
    }];
  });
  const text = transcript?.trim()
    ? normalizeTranscriptSegmentText(transcript.trim())
    : normalizedSegments.map(segment => segment.text).join('\n').trim();
  if (!text) return null;
  return {
    text,
    segments: normalizedSegments.length ? normalizedSegments : [{ start: 0, end: 0, text }],
  };
}

function normalizeMeetingTranscription(transcription: MeetingTranscriptionResult): MeetingTranscriptionResult {
  const segments = transcription.segments.flatMap((segment) => {
    const text = normalizeTranscriptSegmentText(segment.text);
    if (!text) return [];
    return [{ ...segment, text }];
  });
  const text = segments.length
    ? segments.map(segment => segment.text).join('\n')
    : normalizeTranscriptSegmentText(transcription.text);
  return {
    text,
    segments: segments.length ? segments : [{ start: 0, end: 0, text }],
  };
}

async function restoreMeetingPunctuation(
  transcription: MeetingTranscriptionResult,
  punctuationService: MeetingTextPostProcessor,
): Promise<MeetingTranscriptionResult> {
  const result = await punctuationService.restoreFinalPunctuation({
    text: transcription.text,
    segments: transcription.segments,
    language: 'zh',
  });
  const segments = result.segments.length
    ? result.segments.map(segment => ({
      start: segment.start,
      end: segment.end,
      text: segment.punctuatedText,
    }))
    : [{
      start: transcription.segments[0]?.start ?? 0,
      end: transcription.segments.at(-1)?.end ?? 0,
      text: result.punctuatedText,
    }];
  return {
    text: result.punctuatedText,
    segments,
  };
}

function buildMeetingChunks(segments: MeetingTranscriptSegment[], summary?: MeetingSummary): Array<{
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
  metadata: { startTime: number; endTime: number; transcribeStatus: 'ok'; kind?: 'summary' | 'transcript' };
}> {
  let cursor = 0;
  const chunks: Array<{
    idx: number;
    text: string;
    charStart: number;
    charEnd: number;
    metadata: { startTime: number; endTime: number; transcribeStatus: 'ok'; kind?: 'summary' | 'transcript' };
  }> = [];
  if (summary) {
    const summaryText = formatMeetingSummaryChunk(summary);
    chunks.push({
      idx: 0,
      text: summaryText,
      charStart: 0,
      charEnd: summaryText.length,
      metadata: {
        startTime: 0,
        endTime: 0,
        transcribeStatus: 'ok',
        kind: 'summary',
      },
    });
    cursor = summaryText.length;
  }

  segments.forEach((segment, segmentIndex) => {
    const charStart = cursor;
    const text = `${segment.text}\n`;
    const charEnd = charStart + text.length;
    cursor = charEnd;
    chunks.push({
      idx: chunks.length,
      text,
      charStart,
      charEnd,
      metadata: {
        startTime: segment.start,
        endTime: segment.end,
        transcribeStatus: 'ok',
        kind: 'transcript',
      },
    });
  });
  return chunks;
}

function formatMeetingSummaryChunk(summary: MeetingSummary): string {
  return `${formatMeetingSummaryDraft(summary).trimEnd()}\n\n## 逐字转写\n`;
}

function formatMeetingSummaryDraft(summary: MeetingSummary): string {
  const lines = ['## 会议纪要', ''];
  if (summary.attendees.length) {
    lines.push(`参会人：${summary.attendees.join('、')}`, '');
  }
  if (summary.overview?.length) {
    lines.push('### 摘要');
    for (const item of summary.overview) lines.push(`- ${item}`);
    lines.push('');
  }
  if (summary.decisions.length) {
    lines.push('### 决策');
    for (const decision of summary.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }
  if (summary.actionItems.length) {
    lines.push('### 待办');
    for (const item of summary.actionItems) {
      lines.push(`- ${item.owner ? `${item.owner}: ` : ''}${item.text}`);
    }
    lines.push('');
  }
  if (!summary.attendees.length && !summary.overview?.length && !summary.decisions.length && !summary.actionItems.length) {
    lines.push('暂无自动提取的决策或待办。', '');
  }
  return `${lines.join('\n')}\n`;
}

function buildMeetingSourceTitle(summary: MeetingSummary, fallbackTitle: string, timestamp: number): string {
  const base = summarizeMeetingTitle(summary, fallbackTitle);
  return `${base} - ${formatMeetingTitleTime(timestamp)}`;
}

function summarizeMeetingTitle(summary: MeetingSummary, fallbackTitle: string): string {
  const candidates = [
    summary.title,
    summary.decisions[0],
    summary.actionItems[0]?.text,
    fallbackTitle,
    'Meeting',
  ];
  const candidate = candidates
    .map(value => (value ?? '').trim())
    .find(Boolean) ?? 'Meeting';
  return candidate
    .replace(/^[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32);
}

function formatMeetingTitleTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}
