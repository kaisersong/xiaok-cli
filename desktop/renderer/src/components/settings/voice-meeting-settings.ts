

export type MeetingTranscriberEngine = typeof MEETING_TRANSCRIBER_ENGINE_OPTIONS[number];
export type MeetingTranscriberModel = typeof MEETING_TRANSCRIBER_MODEL_OPTIONS[number];
export type MeetingTranscriberLanguage = typeof MEETING_TRANSCRIBER_LANGUAGE_OPTIONS[number];

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

export const MEETING_SHERPA_ONNX_PARA_MODEL = 'sherpa-onnx-paraformer-zh-small-2024-03-09';
export const MEETING_TRANSCRIBER_ENGINE_OPTIONS = ['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr'] as const;
export const MEETING_TRANSCRIBER_MODEL_OPTIONS = [MEETING_SHERPA_ONNX_PARA_MODEL, 'base', 'small', 'medium', 'large', 'turbo'] as const;
export const MEETING_TRANSCRIBER_LANGUAGE_OPTIONS = ['zh', 'auto', 'en'] as const;

export function meetingTranscriberEngineForModel(model: MeetingTranscriberModel): MeetingTranscriberEngine {
  return model === MEETING_SHERPA_ONNX_PARA_MODEL ? 'sherpa-onnx-paraformer' : 'whisper';
}

export function defaultMeetingTranscriberModelForEngine(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  if (engine === 'sherpa-onnx-paraformer') return MEETING_SHERPA_ONNX_PARA_MODEL;
  if (engine === 'whisper') return 'base';
  return MEETING_SHERPA_ONNX_PARA_MODEL;
}

export function readStoredMeetingTranscriberEngine(fallback: MeetingTranscriberEngine = 'sherpa-onnx-paraformer'): MeetingTranscriberEngine {
  try {
    const value = localStorage.getItem('meeting-transcriber-engine');
    if (MEETING_TRANSCRIBER_ENGINE_OPTIONS.includes(value as MeetingTranscriberEngine)) {
      return value as MeetingTranscriberEngine;
    }
  } catch {
    // localStorage is best effort in renderer tests and hardened contexts.
  }
  return fallback;
}

export function readStoredMeetingTranscriberModel(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  try {
    const value = localStorage.getItem('meeting-transcriber-model') as MeetingTranscriberModel | null;
    if (value && MEETING_TRANSCRIBER_MODEL_OPTIONS.includes(value) && meetingTranscriberEngineForModel(value) === engine) {
      return value;
    }
  } catch {
    // best effort only
  }
  return defaultMeetingTranscriberModelForEngine(engine);
}

export function readStoredMeetingTranscriberLanguage(): MeetingTranscriberLanguage {
  try {
    const value = localStorage.getItem('meeting-transcriber-language') as MeetingTranscriberLanguage | null;
    if (value && MEETING_TRANSCRIBER_LANGUAGE_OPTIONS.includes(value)) return value;
  } catch {
    // best effort only
  }
  return 'zh';
}

export function isLocalMeetingTranscriberEngine(engine: MeetingTranscriberEngine): boolean {
  return engine === 'sherpa-onnx-paraformer' || engine === 'whisper';
}

function normalizeMeetingModelStatuses(value: unknown): MeetingModelStatusSnapshot[] {
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
