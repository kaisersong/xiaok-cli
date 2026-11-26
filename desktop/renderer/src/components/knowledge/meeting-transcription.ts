

export interface MeetingPreviewSegment {
  end?: number;
  final?: boolean;
  sentenceId?: string;
  start: number;
  text: string;
}

export interface MeetingModelStatusSnapshot {
  id: string;
  capability?: 'asr' | 'punctuation' | 'vad' | 'speaker';
  engineId?: string;
  fileName: string;
  sizeLabel: string;
  downloaded: boolean;
  status: 'downloaded' | 'not_downloaded' | 'incomplete' | 'corrupt';
  localSizeLabel?: string;
}

export interface MeetingModelActionState {
  modelId: string;
  kind: 'download' | 'uninstall';
}

export interface MeetingAsrConfigSnapshot {
  defaultProvider?: MeetingTranscriberEngine;
  volcengine?: {
    configured?: boolean;
    appKeyConfigured?: boolean;
    accessKeyConfigured?: boolean;
    endpoint?: string;
    resourceId?: string;
  };
  aliyun?: {
    configured?: boolean;
    apiKeyConfigured?: boolean;
    baseUrl?: string;
    model?: string;
  };
}

export interface MeetingSaveAsrConfigInput {
  defaultProvider?: MeetingTranscriberEngine;
  volcengine?: {
    appKey?: string;
    accessKey?: string;
    endpoint?: string;
    resourceId?: string;
  };
  aliyun?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

export const MEETING_SHERPA_ONNX_PARA_MODEL = 'sherpa-onnx-paraformer-zh-small-2024-03-09';
export const MEETING_TRANSCRIBER_ENGINE_OPTIONS = ['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr'] as const;
export const MEETING_TRANSCRIBER_MODEL_OPTIONS = [MEETING_SHERPA_ONNX_PARA_MODEL, 'base', 'small', 'medium', 'large', 'turbo'] as const;
const MEETING_TRANSCRIBER_LANGUAGE_OPTIONS = ['zh', 'auto', 'en'] as const;
export const MEETING_RECORDING_SCENARIO_OPTIONS = ['discussion', 'meeting', 'sales'] as const;
export const MEETING_TRANSCRIBE_PREVIEW_INITIAL_DELAY_MS = 2_000;
export const MEETING_TRANSCRIBE_PREVIEW_INTERVAL_MS = 4_000;
export const MEETING_TRANSCRIBE_PREVIEW_MIN_AUDIO_SECONDS = 1;
export type MeetingTranscriberEngine = typeof MEETING_TRANSCRIBER_ENGINE_OPTIONS[number];
export type MeetingTranscriberModel = typeof MEETING_TRANSCRIBER_MODEL_OPTIONS[number];
export type MeetingTranscriberLanguage = typeof MEETING_TRANSCRIBER_LANGUAGE_OPTIONS[number];
export type MeetingRecordingScenario = typeof MEETING_RECORDING_SCENARIO_OPTIONS[number];

export function isLocalMeetingTranscriberEngine(engine: MeetingTranscriberEngine): boolean {
  return engine === 'sherpa-onnx-paraformer' || engine === 'whisper';
}

export function formatMeetingRecordingTimestamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

export function meetingTranscriberEngineForModel(model: MeetingTranscriberModel): MeetingTranscriberEngine {
  return model === MEETING_SHERPA_ONNX_PARA_MODEL ? 'sherpa-onnx-paraformer' : 'whisper';
}

export function defaultMeetingTranscriberModelForEngine(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  if (engine === 'sherpa-onnx-paraformer') return MEETING_SHERPA_ONNX_PARA_MODEL;
  if (engine === 'whisper') return 'base';
  return MEETING_SHERPA_ONNX_PARA_MODEL;
}

export function readStoredMeetingTranscriberEngine(): MeetingTranscriberEngine {
  try {
    const value = localStorage.getItem('meeting-transcriber-engine');
    if (MEETING_TRANSCRIBER_ENGINE_OPTIONS.includes(value as MeetingTranscriberEngine)) {
      return value as MeetingTranscriberEngine;
    }
  } catch {
    // localStorage may be unavailable in tests or hardened renderer contexts.
  }
  return 'sherpa-onnx-paraformer';
}

export function readStoredMeetingTranscriberModel(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  try {
    const value = localStorage.getItem('meeting-transcriber-model');
    const model = value as MeetingTranscriberModel;
    if (MEETING_TRANSCRIBER_MODEL_OPTIONS.includes(model) && meetingTranscriberEngineForModel(model) === engine) {
      return model;
    }
  } catch {
    // localStorage may be unavailable in tests or hardened renderer contexts.
  }
  return defaultMeetingTranscriberModelForEngine(engine);
}

export function readStoredMeetingTranscriberLanguage(): MeetingTranscriberLanguage {
  try {
    const value = localStorage.getItem('meeting-transcriber-language');
    if (MEETING_TRANSCRIBER_LANGUAGE_OPTIONS.includes(value as MeetingTranscriberLanguage)) {
      return value as MeetingTranscriberLanguage;
    }
  } catch {
    // localStorage may be unavailable in tests or hardened renderer contexts.
  }
  return 'zh';
}

export function meetingTranscriberLanguageForIpc(language: MeetingTranscriberLanguage): string | undefined {
  return language === 'auto' ? undefined : language;
}

export function meetingTranscriberModelForIpc(engine: MeetingTranscriberEngine, model: MeetingTranscriberModel): string | undefined {
  return isLocalMeetingTranscriberEngine(engine) ? model : undefined;
}

export function normalizeMeetingPreviewSegments(result: { text?: string; segments?: unknown }): MeetingPreviewSegment[] {
  if (Array.isArray(result.segments)) {
    const segments = result.segments.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!text) return [];
      const start = Number(record.start);
      const end = Number(record.end);
      return [{
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : undefined,
        text,
      }];
    });
    if (segments.length > 0) return segments;
  }

  return String(result.text ?? '')
    .split(/\r?\n/)
    .map((line, index) => ({ start: index, text: line.trim() }))
    .filter(segment => segment.text);
}

export function offsetMeetingPreviewSegments(segments: MeetingPreviewSegment[], offsetSeconds: number): MeetingPreviewSegment[] {
  return segments.map(segment => ({
    start: segment.start + offsetSeconds,
    end: typeof segment.end === 'number' ? segment.end + offsetSeconds : undefined,
    text: segment.text,
  }));
}

export function normalizeMeetingModelStatuses(value: unknown): MeetingModelStatusSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const fileName = typeof record.fileName === 'string' ? record.fileName : '';
    const sizeLabel = typeof record.sizeLabel === 'string' ? record.sizeLabel : '';
    const rawStatus = typeof record.status === 'string' ? record.status : '';
    const status = rawStatus === 'downloaded' || rawStatus === 'not_downloaded' || rawStatus === 'incomplete' || rawStatus === 'corrupt'
      ? rawStatus
      : undefined;
    if (!id || !fileName || !sizeLabel || !status) return [];
    return [{
      id,
      capability: record.capability === 'punctuation' || record.capability === 'vad' || record.capability === 'speaker'
        ? record.capability
        : 'asr',
      engineId: typeof record.engineId === 'string' ? record.engineId : undefined,
      fileName,
      sizeLabel,
      downloaded: record.downloaded === true,
      status,
      localSizeLabel: typeof record.localSizeLabel === 'string' ? record.localSizeLabel : undefined,
    }];
  });
}

export function formatMeetingSegmentTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatMeetingElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
