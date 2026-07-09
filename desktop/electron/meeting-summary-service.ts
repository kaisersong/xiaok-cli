import { localMeetingSummaryConfigHash } from './meeting-local-transcriber.js';

export type MeetingModelLocality = 'local' | 'remote';
export type MeetingSummaryProvider = 'local-only' | string;

export interface MeetingModelBinding {
  providerId: string;
  modelId: string;
  locality: MeetingModelLocality;
  configHash: string;
}

export interface MeetingTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface MeetingSummary {
  title: string;
  attendees: string[];
  decisions: string[];
  actionItems: Array<{ owner?: string; text: string }>;
}

export interface MeetingSummarizeInput {
  transcript: string;
  segments: MeetingTranscriptSegment[];
  summaryProvider: MeetingSummaryProvider;
  consentSnapshot?: MeetingModelBinding;
}

export type MeetingSummaryResult =
  | { ok: true; summary: MeetingSummary; binding: MeetingModelBinding }
  | { ok: false; status: 'summary_blocked_by_privacy'; reason: 'local_model_required' | 'provider_changed'; binding: MeetingModelBinding };

export interface MeetingSummaryService {
  summarizeMeeting(input: MeetingSummarizeInput): Promise<MeetingSummaryResult>;
}

export interface MeetingSummaryServiceDeps {
  resolveBinding: (provider: MeetingSummaryProvider) => Promise<MeetingModelBinding> | MeetingModelBinding;
  summarizeTranscript: (input: {
    transcript: string;
    segments: MeetingTranscriptSegment[];
    binding: MeetingModelBinding;
  }) => Promise<MeetingSummary> | MeetingSummary;
}

export function createMeetingSummaryService(deps: MeetingSummaryServiceDeps): MeetingSummaryService {
  return {
    async summarizeMeeting(input) {
      const binding = await deps.resolveBinding(input.summaryProvider);
      if (input.summaryProvider === 'local-only' && binding.locality !== 'local') {
        return { ok: false, status: 'summary_blocked_by_privacy', reason: 'local_model_required', binding };
      }

      if (input.consentSnapshot && !sameBinding(input.consentSnapshot, binding)) {
        return { ok: false, status: 'summary_blocked_by_privacy', reason: 'provider_changed', binding };
      }

      const summary = await deps.summarizeTranscript({
        transcript: input.transcript,
        segments: input.segments,
        binding,
      });
      return { ok: true, summary, binding };
    },
  };
}

export function createLocalMeetingSummaryService(): MeetingSummaryService {
  const binding: MeetingModelBinding = {
    providerId: 'xiaok-local',
    modelId: 'extractive-meeting-summary',
    locality: 'local',
    configHash: localMeetingSummaryConfigHash(),
  };
  return createMeetingSummaryService({
    resolveBinding: () => binding,
    summarizeTranscript: ({ transcript }) => summarizeTranscriptLocally(transcript),
  });
}

function summarizeTranscriptLocally(transcript: string): MeetingSummary {
  const sentences = splitTranscriptSentences(transcript);
  const actionItems = extractActionItems(sentences);
  return {
    title: '',
    attendees: extractAttendees(transcript),
    decisions: sentences.filter(sentence => /(决定|决议|确认|同意|decided|decision|agreed)/i.test(sentence)).slice(0, 8),
    actionItems,
  };
}

function splitTranscriptSentences(transcript: string): string[] {
  return transcript
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function extractAttendees(transcript: string): string[] {
  const attendees = new Set<string>();
  for (const match of transcript.matchAll(/(?:^|\n)\s*([A-Z][a-zA-Z]{1,24}|[\u4e00-\u9fff]{2,4})[:：]/g)) {
    attendees.add(match[1]);
  }
  return Array.from(attendees).slice(0, 12);
}

function extractActionItems(sentences: string[]): MeetingSummary['actionItems'] {
  const actionItems: MeetingSummary['actionItems'] = [];
  for (const sentence of sentences) {
    const english = sentence.match(/\b([A-Z][a-zA-Z]{1,24})\s+(?:will|should|needs? to|is going to)\s+(.+)/);
    if (english) {
      actionItems.push({ owner: english[1], text: sentence });
      continue;
    }
    const chinese = sentence.match(/([\u4e00-\u9fff]{2,4})(?:负责|需要|要|会)(.+)/);
    if (chinese) {
      actionItems.push({ owner: chinese[1], text: sentence });
    }
  }
  return actionItems.slice(0, 12);
}

function sameBinding(a: MeetingModelBinding, b: MeetingModelBinding): boolean {
  return a.providerId === b.providerId
    && a.modelId === b.modelId
    && a.locality === b.locality
    && a.configHash === b.configHash;
}
