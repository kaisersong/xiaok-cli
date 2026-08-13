import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Plus, Download, RotateCcw, Trash2, FileText, Globe, ClipboardPaste, Search, BookOpen, Link, Mic, ChevronRight, Settings2, Minimize2, Maximize2, Pause, Play, LoaderCircle, X, Pencil, Check } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { getDesktopDocumentMimeType } from '../shared/document-formats';
import { fileBasename } from '../lib/file-path';
import { MarkdownRenderer } from './MarkdownRenderer';

interface KbCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  chunkCountCached: number;
  createdAt: number;
  updatedAt: number;
}

interface KbSource {
  id: string;
  collectionId: string;
  kind: 'file' | 'url' | 'paste' | 'meeting';
  title: string;
  uri: string;
  parseStatus: string;
  chunkCount: number;
  createdAt: number;
}

interface KbSearchResult {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
  pageIndex: number | null;
  fusedScore: number;
}

interface KbSourceContent {
  source: KbSource;
  text: string;
  hasMore: boolean;
  totalChars: number;
}

interface ActiveMeetingRecording {
  analyser: AnalyserNode;
  audioLevelData: Float32Array<ArrayBuffer>;
  audioLevelFrameId: number | null;
  audioContext: AudioContext;
  capturedSamples: number;
  chunks: Float32Array[];
  gain: GainNode;
  liveTranscriptionSessionId: string | null;
  paused: boolean;
  previewChunkCursor: number;
  previewInFlight: boolean;
  previewPromise: Promise<void> | null;
  previewTimerId: number | null;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
}

interface MeetingPreviewSegment {
  end?: number;
  final?: boolean;
  sentenceId?: string;
  start: number;
  text: string;
}

interface MeetingModelStatusSnapshot {
  id: string;
  capability?: 'asr' | 'punctuation' | 'vad' | 'speaker';
  engineId?: string;
  fileName: string;
  sizeLabel: string;
  downloaded: boolean;
  status: 'downloaded' | 'not_downloaded' | 'incomplete' | 'corrupt';
  localSizeLabel?: string;
}

interface MeetingModelActionState {
  modelId: string;
  kind: 'download' | 'uninstall';
}

interface MeetingAsrConfigSnapshot {
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

interface MeetingSaveAsrConfigInput {
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

const MEETING_SHERPA_ONNX_PARA_MODEL = 'sherpa-onnx-paraformer-zh-small-2024-03-09';
const MEETING_TRANSCRIBER_ENGINE_OPTIONS = ['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr'] as const;
const MEETING_TRANSCRIBER_MODEL_OPTIONS = [MEETING_SHERPA_ONNX_PARA_MODEL, 'base', 'small', 'medium', 'large', 'turbo'] as const;
const MEETING_TRANSCRIBER_LANGUAGE_OPTIONS = ['zh', 'auto', 'en'] as const;
const MEETING_RECORDING_SCENARIO_OPTIONS = ['discussion', 'meeting', 'sales'] as const;
const MEETING_AUDIO_LEVEL_BAR_COUNT = 24;
const MEETING_TRANSCRIBE_PREVIEW_INITIAL_DELAY_MS = 2_000;
const MEETING_TRANSCRIBE_PREVIEW_INTERVAL_MS = 4_000;
const MEETING_TRANSCRIBE_PREVIEW_MIN_AUDIO_SECONDS = 1;
const EMPTY_MEETING_AUDIO_LEVELS = Array.from({ length: MEETING_AUDIO_LEVEL_BAR_COUNT }, () => 0);
type MeetingTranscriberEngine = typeof MEETING_TRANSCRIBER_ENGINE_OPTIONS[number];
type MeetingTranscriberModel = typeof MEETING_TRANSCRIBER_MODEL_OPTIONS[number];
type MeetingTranscriberLanguage = typeof MEETING_TRANSCRIBER_LANGUAGE_OPTIONS[number];
type MeetingRecordingScenario = typeof MEETING_RECORDING_SCENARIO_OPTIONS[number];

function isLocalMeetingTranscriberEngine(engine: MeetingTranscriberEngine): boolean {
  return engine === 'sherpa-onnx-paraformer' || engine === 'whisper';
}

function createEmptyMeetingAudioLevels(): number[] {
  return [...EMPTY_MEETING_AUDIO_LEVELS];
}

function calculateMeetingAudioLevels(samples: Float32Array, barCount = MEETING_AUDIO_LEVEL_BAR_COUNT): number[] {
  if (samples.length === 0) return createEmptyMeetingAudioLevels();
  return Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * samples.length) / barCount));
    let peak = 0;
    let sumSquares = 0;
    for (let sampleIndex = start; sampleIndex < end && sampleIndex < samples.length; sampleIndex += 1) {
      const absolute = Math.abs(samples[sampleIndex] ?? 0);
      peak = Math.max(peak, absolute);
      sumSquares += absolute * absolute;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    return Math.min(1, Math.max(peak, rms * 1.6));
  });
}

function formatMeetingRecordingTimestamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function meetingTranscriberEngineForModel(model: MeetingTranscriberModel): MeetingTranscriberEngine {
  return model === MEETING_SHERPA_ONNX_PARA_MODEL ? 'sherpa-onnx-paraformer' : 'whisper';
}

function defaultMeetingTranscriberModelForEngine(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  if (engine === 'sherpa-onnx-paraformer') return MEETING_SHERPA_ONNX_PARA_MODEL;
  if (engine === 'whisper') return 'base';
  return MEETING_SHERPA_ONNX_PARA_MODEL;
}

function readStoredMeetingTranscriberEngine(): MeetingTranscriberEngine {
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

function readStoredMeetingTranscriberModel(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
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

function readStoredMeetingTranscriberLanguage(): MeetingTranscriberLanguage {
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

function meetingTranscriberLanguageForIpc(language: MeetingTranscriberLanguage): string | undefined {
  return language === 'auto' ? undefined : language;
}

function meetingTranscriberModelForIpc(engine: MeetingTranscriberEngine, model: MeetingTranscriberModel): string | undefined {
  return isLocalMeetingTranscriberEngine(engine) ? model : undefined;
}

function normalizeMeetingPreviewSegments(result: { text?: string; segments?: unknown }): MeetingPreviewSegment[] {
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

function countMeetingAudioSamples(chunks: Float32Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function offsetMeetingPreviewSegments(segments: MeetingPreviewSegment[], offsetSeconds: number): MeetingPreviewSegment[] {
  return segments.map(segment => ({
    start: segment.start + offsetSeconds,
    end: typeof segment.end === 'number' ? segment.end + offsetSeconds : undefined,
    text: segment.text,
  }));
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

function formatMeetingSegmentTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatMeetingElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function stopActiveMeetingRecording(active: ActiveMeetingRecording): void {
  if (active.audioLevelFrameId !== null) {
    window.cancelAnimationFrame(active.audioLevelFrameId);
    active.audioLevelFrameId = null;
  }
  if (active.previewTimerId !== null) {
    window.clearTimeout(active.previewTimerId);
    active.previewTimerId = null;
  }
  active.processor.onaudioprocess = null;
  try { active.source.disconnect(); } catch { /* ignore */ }
  try { active.analyser.disconnect(); } catch { /* ignore */ }
  try { active.processor.disconnect(); } catch { /* ignore */ }
  try { active.gain.disconnect(); } catch { /* ignore */ }
  for (const track of active.stream.getTracks()) track.stop();
  void active.audioContext.close().catch(() => undefined);
}

function encodeFloat32ChunksToWavBase64(chunks: Float32Array[], sampleRate: number): string {
  const sampleCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wav = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(wav);
  let offset = 0;

  const writeAscii = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  writeAscii('RIFF');
  view.setUint32(offset, 36 + sampleCount * 2, true); offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeAscii('data');
  view.setUint32(offset, sampleCount * 2, true); offset += 4;

  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(wav);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function encodeFloat32ChunkToPcmBase64(chunk: Float32Array): string {
  const bytes = new Uint8Array(chunk.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < chunk.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, chunk[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export function KnowledgePage() {
  const { collectionId } = useParams<{ collectionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLocale();
  const isMeetingRecorderWindow = location.pathname.startsWith('/meeting-recorder/')
    || new URLSearchParams(location.search).get('recorder') === '1';

  const [collections, setCollections] = useState<KbCollection[]>([]);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [addMode, setAddMode] = useState<'paste' | 'url'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [privacyDismissed, setPrivacyDismissed] = useState(() => localStorage.getItem('kb-privacy-dismissed') === '1');
  const [showMeetingImport, setShowMeetingImport] = useState(false);
  const [showMeetingRecorder, setShowMeetingRecorder] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingAudioFilePath, setMeetingAudioFilePath] = useState('');
  const [meetingTranscript, setMeetingTranscript] = useState('');
  const [meetingSummaryDraft, setMeetingSummaryDraft] = useState('');
  const [meetingDraftTranscript, setMeetingDraftTranscript] = useState('');
  const [meetingSaving, setMeetingSaving] = useState(false);
  const [meetingRecording, setMeetingRecording] = useState(false);
  const [meetingRecordingPaused, setMeetingRecordingPaused] = useState(false);
  const [meetingRecordingSaving, setMeetingRecordingSaving] = useState(false);
  const [meetingProcessing, setMeetingProcessing] = useState(false);
  const [meetingRecorderView, setMeetingRecorderView] = useState<'workbench' | 'compact' | 'summary'>('workbench');
  const [meetingElapsedMs, setMeetingElapsedMs] = useState(0);
  const [meetingAudioLevels, setMeetingAudioLevels] = useState<number[]>(createEmptyMeetingAudioLevels);
  const [meetingPreviewSegments, setMeetingPreviewSegments] = useState<MeetingPreviewSegment[]>([]);
  const [meetingModelStatuses, setMeetingModelStatuses] = useState<MeetingModelStatusSnapshot[]>([]);
  const [meetingModelStatusesLoading, setMeetingModelStatusesLoading] = useState(false);
  const [meetingModelStatusesError, setMeetingModelStatusesError] = useState('');
  const [meetingModelAction, setMeetingModelAction] = useState<MeetingModelActionState | null>(null);
  const [meetingAsrConfig, setMeetingAsrConfig] = useState<MeetingAsrConfigSnapshot | null>(null);
  const [meetingAsrSaving, setMeetingAsrSaving] = useState(false);
  const [meetingTranscriberEngine, setMeetingTranscriberEngine] = useState<MeetingTranscriberEngine>(readStoredMeetingTranscriberEngine);
  const [meetingTranscriberModel, setMeetingTranscriberModel] = useState<MeetingTranscriberModel>(() => (
    readStoredMeetingTranscriberModel(readStoredMeetingTranscriberEngine())
  ));
  const [meetingTranscriberLanguage, setMeetingTranscriberLanguage] = useState<MeetingTranscriberLanguage>(readStoredMeetingTranscriberLanguage);
  const [meetingRecordingScenario, setMeetingRecordingScenario] = useState<MeetingRecordingScenario>('meeting');
  const [meetingMessage, setMeetingMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [sourceContent, setSourceContent] = useState<KbSourceContent | null>(null);
  const [sourceContentLoading, setSourceContentLoading] = useState(false);
  const [sourceContentError, setSourceContentError] = useState('');
  const meetingTitleRef = useRef('');
  const meetingTranscriberEngineRef = useRef<MeetingTranscriberEngine>(meetingTranscriberEngine);
  const meetingTranscriberModelRef = useRef<MeetingTranscriberModel>(meetingTranscriberModel);
  const meetingTranscriberLanguageRef = useRef<MeetingTranscriberLanguage>(meetingTranscriberLanguage);
  const meetingRecordingScenarioRef = useRef<MeetingRecordingScenario>(meetingRecordingScenario);
  const meetingPreviewSegmentsRef = useRef<MeetingPreviewSegment[]>([]);
  const meetingRecordingRef = useRef<ActiveMeetingRecording | null>(null);
  const meetingRecorderInitializedRef = useRef(false);

  const desktop = getDesktopApi();

  const createDefaultRecordingTitle = () => (
    t.knowledge.meetingRecordingDefaultTitle(formatMeetingRecordingTimestamp())
  );

  const readMeetingRecordingTitle = () => (
    meetingTitleRef.current.trim() || createDefaultRecordingTitle()
  );

  const startMeetingAudioLevelSampling = (active: ActiveMeetingRecording) => {
    const sample = () => {
      if (meetingRecordingRef.current !== active || active.paused) {
        active.audioLevelFrameId = null;
        return;
      }
      active.analyser.getFloatTimeDomainData(active.audioLevelData);
      setMeetingAudioLevels(calculateMeetingAudioLevels(active.audioLevelData));
      active.audioLevelFrameId = window.requestAnimationFrame(sample);
    };
    if (active.audioLevelFrameId !== null) {
      window.cancelAnimationFrame(active.audioLevelFrameId);
    }
    active.audioLevelFrameId = window.requestAnimationFrame(sample);
  };

  const replaceMeetingPreviewSegments = (segments: MeetingPreviewSegment[]) => {
    meetingPreviewSegmentsRef.current = segments;
    setMeetingPreviewSegments(segments);
  };

  const appendMeetingPreviewSegments = (segments: MeetingPreviewSegment[]) => {
    if (segments.length === 0) return;
    setMeetingPreviewSegments(prev => {
      const next = [...prev, ...segments];
      meetingPreviewSegmentsRef.current = next;
      return next;
    });
  };

  const upsertMeetingLivePreviewSegment = (segment: MeetingPreviewSegment & { sentenceId: string }) => {
    setMeetingPreviewSegments(prev => {
      const index = prev.findIndex(item => item.sentenceId === segment.sentenceId);
      const next = index >= 0
        ? prev.map((item, itemIndex) => itemIndex === index ? segment : item)
        : [...prev, segment];
      meetingPreviewSegmentsRef.current = next;
      return next;
    });
  };

  const runMeetingPreviewTranscription = (active: ActiveMeetingRecording, options: { force?: boolean } = {}): Promise<void> => {
    if (!desktop?.meetingTranscribePreview || meetingTranscriberEngineRef.current !== 'sherpa-onnx-paraformer') {
      return Promise.resolve();
    }
    if (active.previewInFlight) return active.previewPromise ?? Promise.resolve();

    const startChunkIndex = active.previewChunkCursor;
    const chunks = active.chunks.slice(startChunkIndex);
    const sampleCount = countMeetingAudioSamples(chunks);
    if (sampleCount === 0) return Promise.resolve();
    if (!options.force && sampleCount / active.audioContext.sampleRate < MEETING_TRANSCRIBE_PREVIEW_MIN_AUDIO_SECONDS) {
      return Promise.resolve();
    }

    const offsetSeconds = countMeetingAudioSamples(active.chunks.slice(0, startChunkIndex)) / active.audioContext.sampleRate;
    const title = readMeetingRecordingTitle();
    const request = {
      title,
      wavBase64: encodeFloat32ChunksToWavBase64(chunks, active.audioContext.sampleRate),
      engine: meetingTranscriberEngineRef.current,
      model: meetingTranscriberModelRef.current,
      ...(meetingTranscriberLanguageForIpc(meetingTranscriberLanguageRef.current)
        ? { language: meetingTranscriberLanguageForIpc(meetingTranscriberLanguageRef.current) }
        : {}),
    };

    active.previewInFlight = true;
    active.previewPromise = (async () => {
      try {
        const result = await desktop.meetingTranscribePreview(request) as { ok?: boolean; text?: string; segments?: unknown };
        if (result?.ok === false) return;
        const segments = offsetMeetingPreviewSegments(normalizeMeetingPreviewSegments(result), offsetSeconds);
        if (segments.length === 0) return;
        active.previewChunkCursor = startChunkIndex + chunks.length;
        appendMeetingPreviewSegments(segments);
      } catch {
        // Live preview should not interrupt recording; final transcription still runs on finish.
      } finally {
        active.previewInFlight = false;
        active.previewPromise = null;
      }
    })();
    return active.previewPromise;
  };

  const scheduleMeetingPreviewTranscription = (
    active: ActiveMeetingRecording,
    delayMs = MEETING_TRANSCRIBE_PREVIEW_INITIAL_DELAY_MS,
  ) => {
    if (active.previewTimerId !== null) {
      window.clearTimeout(active.previewTimerId);
      active.previewTimerId = null;
    }
    const tick = () => {
      active.previewTimerId = null;
      if (meetingRecordingRef.current !== active || active.paused) return;
      void runMeetingPreviewTranscription(active).finally(() => {
        if (meetingRecordingRef.current === active && !active.paused) {
          active.previewTimerId = window.setTimeout(tick, MEETING_TRANSCRIBE_PREVIEW_INTERVAL_MS);
        }
      });
    };
    active.previewTimerId = window.setTimeout(tick, delayMs);
  };

  const flushMeetingPreviewTranscription = async (active: ActiveMeetingRecording): Promise<void> => {
    if (active.previewPromise) {
      await active.previewPromise.catch(() => undefined);
    }
    await runMeetingPreviewTranscription(active, { force: true }).catch(() => undefined);
  };

  const updateMeetingTitle = (value: string) => {
    meetingTitleRef.current = value;
    setMeetingTitle(value);
  };

  const updateMeetingTranscriberEngine = (value: MeetingTranscriberEngine) => {
    const nextModel = meetingTranscriberEngineForModel(meetingTranscriberModelRef.current) === value
      ? meetingTranscriberModelRef.current
      : defaultMeetingTranscriberModelForEngine(value);
    meetingTranscriberEngineRef.current = value;
    meetingTranscriberModelRef.current = nextModel;
    setMeetingTranscriberEngine(value);
    setMeetingTranscriberModel(nextModel);
    try {
      localStorage.setItem('meeting-transcriber-engine', value);
      localStorage.setItem('meeting-transcriber-model', nextModel);
    } catch {
      // best effort only
    }
  };

  const updateMeetingTranscriberModel = (value: MeetingTranscriberModel) => {
    const engine = meetingTranscriberEngineForModel(value);
    meetingTranscriberEngineRef.current = engine;
    meetingTranscriberModelRef.current = value;
    setMeetingTranscriberEngine(engine);
    setMeetingTranscriberModel(value);
    try {
      localStorage.setItem('meeting-transcriber-engine', engine);
      localStorage.setItem('meeting-transcriber-model', value);
    } catch {
      // best effort only
    }
  };

  const updateMeetingTranscriberLanguage = (value: MeetingTranscriberLanguage) => {
    meetingTranscriberLanguageRef.current = value;
    setMeetingTranscriberLanguage(value);
    try {
      localStorage.setItem('meeting-transcriber-language', value);
    } catch {
      // best effort only
    }
  };

  const updateMeetingRecordingScenario = (value: MeetingRecordingScenario) => {
    meetingRecordingScenarioRef.current = value;
    setMeetingRecordingScenario(value);
  };

  const loadMeetingModelStatuses = useCallback(async () => {
    if (!desktop?.meetingListModels) return;
    setMeetingModelStatusesLoading(true);
    setMeetingModelStatusesError('');
    try {
      const result = await desktop.meetingListModels();
      setMeetingModelStatuses(normalizeMeetingModelStatuses(result));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      setMeetingModelStatuses([]);
      setMeetingModelStatusesError(t.knowledge.meetingModelStatusLoadFailed(reason));
    } finally {
      setMeetingModelStatusesLoading(false);
    }
  }, [desktop, t]);

  const handleDownloadMeetingModel = async (modelId: string) => {
    if (!desktop?.meetingDownloadModel || meetingModelAction) return;
    setMeetingModelAction({ modelId, kind: 'download' });
    setMeetingModelStatusesError('');
    let failureReason = '';
    try {
      const result = await desktop.meetingDownloadModel(modelId) as { ok?: boolean; error?: string; reason?: string };
      if (result?.ok === false) {
        failureReason = result.reason ?? result.error ?? 'unknown';
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'unknown';
    } finally {
      await loadMeetingModelStatuses();
      if (failureReason) {
        setMeetingModelStatusesError(t.knowledge.meetingModelActionFailed(failureReason));
      }
      setMeetingModelAction(null);
    }
  };

  const handleUninstallMeetingModel = async (modelId: string) => {
    if (!desktop?.meetingUninstallModel || meetingModelAction) return;
    setMeetingModelAction({ modelId, kind: 'uninstall' });
    setMeetingModelStatusesError('');
    let failureReason = '';
    try {
      const result = await desktop.meetingUninstallModel(modelId) as { ok?: boolean; error?: string; reason?: string };
      if (result?.ok === false) {
        failureReason = result.reason ?? result.error ?? 'unknown';
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'unknown';
    } finally {
      await loadMeetingModelStatuses();
      if (failureReason) {
        setMeetingModelStatusesError(t.knowledge.meetingModelActionFailed(failureReason));
      }
      setMeetingModelAction(null);
    }
  };

  const loadCollections = useCallback(async () => {
    if (!desktop?.kbListCollections) return;
    try {
      const result = await desktop.kbListCollections();
      setCollections(result as KbCollection[]);
    } catch { /* ignore */ }
  }, [desktop]);

  const loadMeetingAsrConfig = useCallback(async () => {
    if (!desktop?.meetingGetAsrConfig) return;
    try {
      const snapshot = await desktop.meetingGetAsrConfig() as MeetingAsrConfigSnapshot;
      setMeetingAsrConfig(snapshot);
    } catch {
      setMeetingAsrConfig(null);
    }
  }, [desktop]);

  const handleSaveMeetingAsrConfig = useCallback(async (input: MeetingSaveAsrConfigInput): Promise<MeetingAsrConfigSnapshot | null> => {
    if (!desktop?.meetingSaveAsrConfig || meetingAsrSaving) return null;
    setMeetingAsrSaving(true);
    try {
      const snapshot = await desktop.meetingSaveAsrConfig(input) as MeetingAsrConfigSnapshot;
      setMeetingAsrConfig(snapshot);
      return snapshot;
    } finally {
      setMeetingAsrSaving(false);
    }
  }, [desktop, meetingAsrSaving]);

  const loadSources = useCallback(async (cid: string) => {
    if (!desktop?.kbListSources) return;
    try {
      const result = await desktop.kbListSources(cid);
      setSources(result as KbSource[]);
    } catch { /* ignore */ }
  }, [desktop]);

  useEffect(() => {
    setLoading(true);
    void loadCollections().then(() => setLoading(false));
  }, [loadCollections]);

  useEffect(() => {
    meetingPreviewSegmentsRef.current = meetingPreviewSegments;
  }, [meetingPreviewSegments]);

  useEffect(() => {
    if (!desktop?.onMeetingLiveTranscriptionUpdate) return;
    return desktop.onMeetingLiveTranscriptionUpdate((input) => {
      const active = meetingRecordingRef.current;
      if (!active?.liveTranscriptionSessionId || input.sessionId !== active.liveTranscriptionSessionId) return;
      upsertMeetingLivePreviewSegment({
        sentenceId: input.sentenceId,
        start: input.start,
        end: input.end,
        text: input.text,
        final: input.final,
      });
    });
  }, [desktop]);

  useEffect(() => {
    if (collectionId) {
      void loadSources(collectionId);
      setSearchResults([]);
      setSearchQuery('');
    } else if (collections.length > 0) {
      navigate(`/knowledge/${collections[0].id}`, { replace: true });
    } else {
      setSources([]);
    }
  }, [collectionId, collections, loadSources, navigate]);

  useEffect(() => {
    if (isMeetingRecorderWindow || !desktop?.onMeetingRecordingSaved) return;
    return desktop.onMeetingRecordingSaved((input) => {
      if (input.collectionId !== collectionId) return;
      void loadSources(input.collectionId);
      void loadCollections();
    });
  }, [collectionId, desktop, isMeetingRecorderWindow, loadCollections, loadSources]);

  useEffect(() => () => {
    if (meetingRecordingRef.current) {
      const sessionId = meetingRecordingRef.current.liveTranscriptionSessionId;
      if (sessionId) void desktop?.meetingCancelLiveTranscription?.({ sessionId });
      stopActiveMeetingRecording(meetingRecordingRef.current);
      meetingRecordingRef.current = null;
    }
  }, [desktop]);

  const handleCreateCollection = async () => {
    if (!desktop?.kbCreateCollection || !newCollectionName.trim()) return;
    try {
      const col = await desktop.kbCreateCollection({
        name: newCollectionName.trim(),
        embeddingModelId: 'bge-small-zh-v1.5',
        embeddingDim: 512,
      }) as KbCollection;
      setNewCollectionName('');
      setShowCreateDialog(false);
      await loadCollections();
      navigate(`/knowledge/${col.id}`);
    } catch { /* ignore */ }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!desktop?.kbDeleteCollection) return;
    if (!confirm(t.knowledge.deleteCollectionConfirm)) return;
    try {
      await desktop.kbDeleteCollection(id);
      if (collectionId === id) navigate('/knowledge');
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleAddPasteSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !pasteText.trim()) return;
    try {
      await desktop.kbAddSource({
        collectionId,
        kind: 'paste',
        title: pasteTitle.trim() || t.knowledge.defaultPasteTitle,
        text: pasteText,
      });
      setPasteText('');
      setPasteTitle('');
      setShowAddSource(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleAddUrlSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !urlInput.trim()) return;
    try {
      await desktop.kbAddSource({
        collectionId,
        kind: 'url',
        title: urlTitle.trim() || urlInput.trim(),
        uri: urlInput.trim(),
      });
      setUrlInput('');
      setUrlTitle('');
      setShowAddSource(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleDeleteSource = async (id: string) => {
    if (!desktop?.kbDeleteSource || !collectionId) return;
    try {
      await desktop.kbDeleteSource(id);
      await loadSources(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleOpenSource = async (source: KbSource) => {
    if (!desktop?.kbGetSourceContent) return;
    setSourceContent(null);
    setSourceContentError('');
    setSourceContentLoading(true);
    try {
      const result = await desktop.kbGetSourceContent({
        sourceId: source.id,
        offset: 0,
        limit: 64_000,
      }) as KbSourceContent | null | undefined;
      if (!result) {
        setSourceContentError(t.knowledge.sourceOpenFailed('not_found'));
        return;
      }
      setSourceContent(result);
    } catch (error) {
      setSourceContentError(t.knowledge.sourceOpenFailed(error instanceof Error ? error.message : 'unknown'));
    } finally {
      setSourceContentLoading(false);
    }
  };

  const handlePickFiles = async () => {
    if (!desktop?.kbPickFiles || !desktop?.kbAddSource || !collectionId) return;
    try {
      const filePaths = await desktop.kbPickFiles();
      for (const fp of filePaths) {
        const name = fileBasename(fp) || 'file';
        await desktop.kbAddSource({
          collectionId,
          kind: 'file',
          title: name,
          filePath: fp,
          mimeType: getDesktopDocumentMimeType(name) || 'application/octet-stream',
        });
      }
      if (filePaths.length > 0) {
        await loadSources(collectionId);
        await loadCollections();
      }
    } catch { /* ignore */ }
  };

  const cleanupMeetingRecording = () => {
    if (meetingRecordingRef.current) {
      const sessionId = meetingRecordingRef.current.liveTranscriptionSessionId;
      if (sessionId) void desktop?.meetingCancelLiveTranscription?.({ sessionId });
      stopActiveMeetingRecording(meetingRecordingRef.current);
      meetingRecordingRef.current = null;
    }
    setMeetingRecording(false);
    setMeetingRecordingPaused(false);
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
  };

  const handleOpenMeetingImport = () => {
    cleanupMeetingRecording();
    updateMeetingTitle(selectedCollection?.name ?? '');
    setMeetingAudioFilePath('');
    setMeetingTranscript('');
    setMeetingSummaryDraft('');
    setMeetingDraftTranscript('');
    replaceMeetingPreviewSegments([]);
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingMessage(null);
    setMeetingRecordingPaused(false);
    setMeetingRecordingSaving(false);
    setMeetingProcessing(false);
    setShowMeetingImport(true);
  };

  const handleCloseMeetingImport = () => {
    cleanupMeetingRecording();
    setMeetingRecordingSaving(false);
    setMeetingProcessing(false);
    setShowMeetingImport(false);
  };

  const initializeMeetingRecorder = () => {
    cleanupMeetingRecording();
    const storedEngine = readStoredMeetingTranscriberEngine();
    const storedModel = readStoredMeetingTranscriberModel(storedEngine);
    const storedLanguage = readStoredMeetingTranscriberLanguage();
    meetingTranscriberEngineRef.current = storedEngine;
    meetingTranscriberModelRef.current = storedModel;
    meetingTranscriberLanguageRef.current = storedLanguage;
    setMeetingTranscriberEngine(storedEngine);
    setMeetingTranscriberModel(storedModel);
    setMeetingTranscriberLanguage(storedLanguage);
    updateMeetingTitle(createDefaultRecordingTitle());
    setMeetingAudioFilePath('');
    setMeetingTranscript('');
    setMeetingSummaryDraft('');
    setMeetingDraftTranscript('');
    replaceMeetingPreviewSegments([]);
    setMeetingMessage(null);
    setMeetingRecordingPaused(false);
    setMeetingRecordingSaving(false);
    setMeetingProcessing(false);
    setMeetingElapsedMs(0);
    setMeetingRecorderView('workbench');
    setShowMeetingRecorder(true);
  };

  const handleOpenMeetingRecorder = async () => {
    if (!collectionId || !desktop?.meetingOpenRecorderWindow) return;
    try {
      const result = await desktop.meetingOpenRecorderWindow({ collectionId }) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordFailed(result.error ?? 'unknown') });
      }
    } catch {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordFailed('window_open_failed') });
    }
  };

  const handleCloseMeetingRecorder = () => {
    cleanupMeetingRecording();
    replaceMeetingPreviewSegments([]);
    setMeetingSummaryDraft('');
    setMeetingDraftTranscript('');
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingSaving(false);
    setMeetingProcessing(false);
    setShowMeetingRecorder(false);
    if (isMeetingRecorderWindow) {
      void desktop?.meetingSetRecorderSessionState?.({ state: 'idle' });
      void desktop?.meetingCloseRecorderWindow?.();
    }
  };

  useEffect(() => {
    if (!isMeetingRecorderWindow || meetingRecorderInitializedRef.current) return;
    meetingRecorderInitializedRef.current = true;
    initializeMeetingRecorder();
    void desktop?.meetingSetRecorderWindowMode?.({ mode: 'workbench' });
    void desktop?.meetingSetRecorderSessionState?.({ state: 'idle' });
    const unsubscribeClose = desktop?.onMeetingRecorderCloseRequested?.(() => {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecorderCloseBlocked });
    });
    return () => {
      unsubscribeClose?.();
      cleanupMeetingRecording();
    };
    // The recorder route is immutable for the lifetime of its BrowserWindow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeetingRecorderWindow]);

  const handlePickMeetingAudio = async () => {
    if (!desktop?.meetingPickAudioFile) return;
    try {
      const filePath = await desktop.meetingPickAudioFile();
      if (filePath) setMeetingAudioFilePath(filePath);
    } catch {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingPickFailed });
    }
  };

  const handleStartMeetingRecording = async () => {
    if (!desktop?.meetingSaveRecordedAudio) return;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordUnavailable });
      return;
    }

    cleanupMeetingRecording();
    replaceMeetingPreviewSegments([]);
    setMeetingSummaryDraft('');
    setMeetingDraftTranscript('');
    setMeetingAudioFilePath('');
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingPaused(false);
    setMeetingMessage(null);
    try {
      if (desktop.meetingRequestMicrophonePermission) {
        const permission = await desktop.meetingRequestMicrophonePermission() as { status?: string };
        if (permission.status === 'denied' || permission.status === 'restricted') {
          setMeetingMessage({ kind: 'error', text: t.knowledge.meetingPermissionDenied });
          return;
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const liveEngine = meetingTranscriberEngineRef.current === 'aliyun-asr'
        || meetingTranscriberEngineRef.current === 'volcengine-asr'
        ? meetingTranscriberEngineRef.current
        : null;
      const audioContext = new AudioContextCtor(
        meetingTranscriberEngineRef.current === 'volcengine-asr' ? { sampleRate: 16_000 } : undefined,
      );
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const gain = audioContext.createGain();
      const chunks: Float32Array[] = [];
      let liveTranscriptionSessionId: string | null = null;
      let liveTranscriptionError = '';

      if (liveEngine && desktop.meetingStartLiveTranscription) {
        try {
          const language = meetingTranscriberLanguageForIpc(meetingTranscriberLanguageRef.current);
          const result = await desktop.meetingStartLiveTranscription({
            engine: liveEngine,
            sampleRate: audioContext.sampleRate,
            ...(language ? { language } : {}),
          });
          if (result.ok && result.sessionId) {
            liveTranscriptionSessionId = result.sessionId;
          } else {
            liveTranscriptionError = result.error ?? `${liveEngine}_live_failed`;
          }
        } catch (error) {
          liveTranscriptionError = error instanceof Error ? error.message : `${liveEngine}_live_failed`;
        }
      }

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.15;
      const audioLevelData = new Float32Array(analyser.fftSize);
      gain.gain.value = 0;
      processor.onaudioprocess = event => {
        const active = meetingRecordingRef.current;
        if (!active || active.paused) return;
        const input = new Float32Array(event.inputBuffer.getChannelData(0));
        chunks.push(input);
        active.capturedSamples += input.length;
        setMeetingElapsedMs(Math.round((active.capturedSamples / active.audioContext.sampleRate) * 1000));
        if (active.liveTranscriptionSessionId && desktop.meetingPushLiveTranscriptionAudio) {
          const sessionId = active.liveTranscriptionSessionId;
          void desktop.meetingPushLiveTranscriptionAudio({
            sessionId,
            pcmBase64: encodeFloat32ChunkToPcmBase64(input),
          }).then(result => {
            if (result.ok || meetingRecordingRef.current !== active || active.liveTranscriptionSessionId !== sessionId) return;
            active.liveTranscriptionSessionId = null;
            void desktop.meetingCancelLiveTranscription?.({ sessionId });
            setMeetingMessage({ kind: 'error', text: t.knowledge.meetingLiveTranscriptionFailed(result.error ?? 'aliyun_live_failed') });
          }).catch(() => {
            if (meetingRecordingRef.current !== active || active.liveTranscriptionSessionId !== sessionId) return;
            active.liveTranscriptionSessionId = null;
            void desktop.meetingCancelLiveTranscription?.({ sessionId });
            setMeetingMessage({ kind: 'error', text: t.knowledge.meetingLiveTranscriptionFailed('aliyun_live_failed') });
          });
        }
      };
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      meetingRecordingRef.current = {
        analyser,
        audioLevelData,
        audioLevelFrameId: null,
        audioContext,
        capturedSamples: 0,
        chunks,
        gain,
        liveTranscriptionSessionId,
        paused: false,
        previewChunkCursor: 0,
        previewInFlight: false,
        previewPromise: null,
        previewTimerId: null,
        processor,
        source,
        stream,
      };
      startMeetingAudioLevelSampling(meetingRecordingRef.current);
      scheduleMeetingPreviewTranscription(meetingRecordingRef.current);
      setMeetingRecording(true);
      setMeetingRecordingPaused(false);
      setMeetingElapsedMs(0);
      if (isMeetingRecorderWindow) {
        setMeetingRecorderView('workbench');
        void desktop.meetingSetRecorderSessionState?.({ state: 'recording' });
        void desktop.meetingSetRecorderWindowMode?.({ mode: 'workbench' });
      }
      setMeetingMessage(liveTranscriptionError
        ? { kind: 'error', text: t.knowledge.meetingLiveTranscriptionFailed(liveTranscriptionError) }
        : { kind: 'success', text: t.knowledge.meetingRecording });
    } catch {
      cleanupMeetingRecording();
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordFailed('microphone_unavailable') });
    }
  };

  const handlePauseMeetingRecording = () => {
    const active = meetingRecordingRef.current;
    if (!active || active.paused) return;
    active.paused = true;
    if (active.audioLevelFrameId !== null) {
      window.cancelAnimationFrame(active.audioLevelFrameId);
      active.audioLevelFrameId = null;
    }
    if (active.previewTimerId !== null) {
      window.clearTimeout(active.previewTimerId);
      active.previewTimerId = null;
    }
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingPaused(true);
    void active.audioContext.suspend?.().catch(() => undefined);
    setMeetingMessage({ kind: 'success', text: t.knowledge.meetingRecordingPaused });
  };

  const handleResumeMeetingRecording = () => {
    const active = meetingRecordingRef.current;
    if (!active || !active.paused) return;
    active.paused = false;
    startMeetingAudioLevelSampling(active);
    scheduleMeetingPreviewTranscription(active);
    setMeetingRecordingPaused(false);
    void active.audioContext.resume?.().catch(() => undefined);
    setMeetingMessage({ kind: 'success', text: t.knowledge.meetingRecording });
  };

  const handleStopMeetingRecording = async (options: { draftRecording?: boolean } = {}) => {
    if (!desktop?.meetingSaveRecordedAudio || !meetingRecordingRef.current) return;
    const active = meetingRecordingRef.current;
    let summaryReady = false;
    meetingRecordingRef.current = null;
    setMeetingRecording(false);
    setMeetingRecordingPaused(false);
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingSaving(true);
    setMeetingMessage(null);
    if (isMeetingRecorderWindow) {
      setMeetingRecorderView('workbench');
      void desktop.meetingSetRecorderSessionState?.({ state: 'processing' });
      void desktop.meetingSetRecorderWindowMode?.({ mode: 'workbench' });
    }
    stopActiveMeetingRecording(active);

    try {
      if (active.liveTranscriptionSessionId && desktop.meetingFinishLiveTranscription) {
        const sessionId = active.liveTranscriptionSessionId;
        active.liveTranscriptionSessionId = null;
        await desktop.meetingFinishLiveTranscription({ sessionId }).catch(() => ({ ok: false }));
      }
      await flushMeetingPreviewTranscription(active);
      const title = readMeetingRecordingTitle();
      const wavBase64 = encodeFloat32ChunksToWavBase64(active.chunks, active.audioContext.sampleRate);
      const result = await desktop.meetingSaveRecordedAudio({ title, wavBase64 }) as { ok?: boolean; filePath?: string; error?: string };
      if (result?.ok === false || !result?.filePath) {
        setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordFailed(result?.error ?? 'unknown') });
        return;
      }
      setMeetingAudioFilePath(result.filePath);
      setMeetingMessage({ kind: 'success', text: t.knowledge.meetingRecordedAudioSaved });
      if (options.draftRecording && desktop.meetingDraftRecording) {
        const liveSegments = meetingTranscriberEngineRef.current === 'volcengine-asr'
          ? meetingPreviewSegmentsRef.current.flatMap(segment => {
            const text = segment.text.trim();
            if (!text) return [];
            return [{ start: segment.start, end: segment.end ?? segment.start, text }];
          })
          : [];
        const liveTranscript = liveSegments.map(segment => segment.text).join('\n').trim();
        if (meetingTranscriberEngineRef.current === 'volcengine-asr' && !liveTranscript) {
          setMeetingMessage({ kind: 'error', text: t.knowledge.meetingProcessError('empty_transcription') });
          return;
        }
        setMeetingProcessing(true);
        setMeetingMessage({ kind: 'success', text: t.knowledge.meetingTranscribing });
        const draftResult = await desktop.meetingDraftRecording({
          title,
          audioFilePath: result.filePath,
          engine: meetingTranscriberEngineRef.current,
          ...(meetingTranscriberModelForIpc(meetingTranscriberEngineRef.current, meetingTranscriberModelRef.current)
            ? { model: meetingTranscriberModelForIpc(meetingTranscriberEngineRef.current, meetingTranscriberModelRef.current) }
            : {}),
          ...(meetingTranscriberLanguageForIpc(meetingTranscriberLanguageRef.current)
            ? { language: meetingTranscriberLanguageForIpc(meetingTranscriberLanguageRef.current) }
            : {}),
          scenario: meetingRecordingScenarioRef.current,
          ...(liveTranscript ? { transcript: liveTranscript, segments: liveSegments } : {}),
        }) as {
          ok?: boolean;
          error?: string;
          reason?: string;
          suggestedTitle?: string;
          transcript?: string;
          segments?: unknown;
          summaryMarkdown?: string;
        };
        if (draftResult?.ok === false) {
          setMeetingMessage({ kind: 'error', text: t.knowledge.meetingProcessError(draftResult.reason ?? draftResult.error ?? 'unknown') });
          return;
        }
        const draftTranscript = typeof draftResult.transcript === 'string' ? draftResult.transcript : '';
        setMeetingDraftTranscript(draftTranscript);
        setMeetingSummaryDraft(typeof draftResult.summaryMarkdown === 'string' ? draftResult.summaryMarkdown : '');
        replaceMeetingPreviewSegments(normalizeMeetingPreviewSegments({ text: draftTranscript, segments: draftResult.segments }));
        const finalTitle = typeof draftResult.suggestedTitle === 'string' && draftResult.suggestedTitle.trim()
          ? draftResult.suggestedTitle.trim()
          : title;
        updateMeetingTitle(finalTitle);
        setMeetingMessage({ kind: 'success', text: t.knowledge.meetingDraftReady });
        summaryReady = true;
        if (isMeetingRecorderWindow) {
          setMeetingRecorderView('summary');
          void desktop.meetingSetRecorderSessionState?.({ state: 'summary' });
          void desktop.meetingSetRecorderWindowMode?.({ mode: 'summary' });
          void desktop.meetingNotifyRecorderSummaryReady?.({ title: finalTitle });
        }
      }
    } catch {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecordFailed('unknown') });
    } finally {
      setMeetingRecordingSaving(false);
      setMeetingProcessing(false);
      if (isMeetingRecorderWindow && !summaryReady) {
        void desktop.meetingSetRecorderSessionState?.({ state: 'idle' });
      }
    }
  };

  const handleSaveMeetingTranscript = async () => {
    if (!desktop?.meetingSaveTranscript || !collectionId || !meetingAudioFilePath || !meetingTranscript.trim()) return;
    setMeetingSaving(true);
    setMeetingMessage(null);
    const title = meetingTitleRef.current.trim() || selectedCollection?.name || t.knowledge.meetingDefaultTitle;
    try {
      const result = await desktop.meetingSaveTranscript({
        collectionId,
        title,
        audioFilePath: meetingAudioFilePath,
        transcript: meetingTranscript.trim(),
      }) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        setMeetingMessage({ kind: 'error', text: t.knowledge.meetingImportError(result.error ?? 'unknown') });
        return;
      }
      setMeetingTranscript('');
      setMeetingAudioFilePath('');
      setShowMeetingImport(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingImportError('unknown') });
    } finally {
      setMeetingSaving(false);
    }
  };

  const handleSaveMeetingRecordingDraft = async () => {
    if (!desktop?.meetingSaveTranscript || !collectionId || !meetingAudioFilePath || !meetingSummaryDraft.trim()) return;
    setMeetingSaving(true);
    setMeetingMessage(null);
    const title = readMeetingRecordingTitle();
    const summary = meetingSummaryDraft.trim();
    const transcript = meetingDraftTranscript.trim();
    const content = transcript ? `${summary}\n\n## 逐字转写\n\n${transcript}` : summary;
    try {
      const result = await desktop.meetingSaveTranscript({
        collectionId,
        title,
        audioFilePath: meetingAudioFilePath,
        transcript: content,
      }) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        setMeetingMessage({ kind: 'error', text: t.knowledge.meetingImportError(result.error ?? 'unknown') });
        return;
      }
      if (isMeetingRecorderWindow) {
        await desktop.meetingNotifyRecordingSaved?.({ collectionId });
        await desktop.meetingCloseRecorderWindow?.();
        return;
      }
      setMeetingSummaryDraft('');
      setMeetingDraftTranscript('');
      setMeetingAudioFilePath('');
      replaceMeetingPreviewSegments([]);
      setShowMeetingRecorder(false);
      await loadSources(collectionId);
      await loadCollections();
    } catch {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingImportError('unknown') });
    } finally {
      setMeetingSaving(false);
    }
  };

  const handleSearch = async () => {
    if (!desktop?.kbSearch || !collectionId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await desktop.kbSearch({ collectionId, query: searchQuery.trim(), topK: 20 });
      setSearchResults(results as KbSearchResult[]);
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!desktop?.kbAddSource || !collectionId) return;
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as any).path as string | undefined;
      if (filePath) {
        await desktop.kbAddSource({
          collectionId,
          kind: 'file',
          title: file.name,
          filePath,
          mimeType: getDesktopDocumentMimeType(file.name) || file.type || 'application/octet-stream',
        });
      } else {
        const text = await file.text();
        await desktop.kbAddSource({
          collectionId,
          kind: 'paste',
          title: file.name,
          text,
        });
      }
    }
    await loadSources(collectionId);
    await loadCollections();
  };

  const selectedCollection = collections.find(c => c.id === collectionId);

  if (isMeetingRecorderWindow) {
    return (
      <MeetingRecorderWindowSurface
        title={meetingTitle}
        setTitle={updateMeetingTitle}
        view={meetingRecorderView}
        recording={meetingRecording}
        paused={meetingRecordingPaused}
        elapsedMs={meetingElapsedMs}
        audioLevels={meetingAudioLevels}
        previewSegments={meetingPreviewSegments}
        summaryDraft={meetingSummaryDraft}
        setSummaryDraft={setMeetingSummaryDraft}
        draftTranscript={meetingDraftTranscript}
        transcriberEngine={meetingTranscriberEngine}
        transcriberLanguage={meetingTranscriberLanguage}
        scenario={meetingRecordingScenario}
        setScenario={updateMeetingRecordingScenario}
        recordingSaving={meetingRecordingSaving}
        processing={meetingProcessing}
        draftSaving={meetingSaving}
        message={meetingMessage}
        onStartRecording={() => void handleStartMeetingRecording()}
        onPauseRecording={handlePauseMeetingRecording}
        onResumeRecording={handleResumeMeetingRecording}
        onFinishRecording={() => void handleStopMeetingRecording({ draftRecording: true })}
        onCompact={() => {
          setMeetingRecorderView('compact');
          void desktop?.meetingSetRecorderWindowMode?.({ mode: 'compact' });
        }}
        onExpand={() => {
          setMeetingRecorderView('workbench');
          void desktop?.meetingSetRecorderWindowMode?.({ mode: 'workbench' });
        }}
        onSaveDraft={() => void handleSaveMeetingRecordingDraft()}
        onCancel={handleCloseMeetingRecorder}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.loading}</p>
      </div>
    );
  }

  // Empty state — no collections at all
  if (collections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <BookOpen size={48} className="text-[var(--c-text-tertiary)]" />
        <div className="text-center">
          <h2 className="text-xl font-medium text-[var(--c-text-primary)]">{t.knowledge.emptyTitle}</h2>
          <p className="mt-2 text-sm text-[var(--c-text-secondary)]">{t.knowledge.emptyDesc}</p>
          <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{t.knowledge.emptyPrivacy}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateDialog(true)}
          className="rounded-lg bg-[var(--c-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--c-accent-send-hover)]"
        >
          {t.knowledge.createFirstCollection}
        </button>
        {showCreateDialog && <CreateCollectionDialog name={newCollectionName} setName={setNewCollectionName} onCreate={handleCreateCollection} onCancel={() => setShowCreateDialog(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--c-bg-page)]">
      {/* Header */}
      <header className="border-b border-[var(--c-border)] px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[var(--c-text-primary)]">{t.knowledge.pageTitle}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenMeetingRecorder}
              disabled={!selectedCollection}
              className="flex items-center gap-1.5 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[var(--c-accent-send-hover)] disabled:opacity-50"
            >
              <Mic size={14} /> {t.knowledge.meetingRecordQuickStart}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)]"
            >
              <Plus size={14} /> {t.knowledge.newCollection}
            </button>
          </div>
        </div>
      </header>

      {/* Privacy notice */}
      {!privacyDismissed && (
        <div className="mx-6 mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-base">🔒</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-blue-800">
              {t.knowledge.privacyNotice}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { localStorage.setItem('kb-privacy-dismissed', '1'); setPrivacyDismissed(true); }}
            className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            {t.knowledge.privacyDismiss}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left: Collection list */}
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-[var(--c-border)] bg-[var(--c-bg-sidebar)] p-3">
          {collections.map(col => (
            <div
              key={col.id}
              role="button"
              tabIndex={0}
              className={`group mb-1 flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                collectionId === col.id
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                  : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
              onClick={() => navigate(`/knowledge/${col.id}`)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/knowledge/${col.id}`); } }}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{col.name}</div>
                <div className="text-xs text-[var(--c-text-tertiary)]">{t.knowledge.chunkCount(col.chunkCountCached)}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleDeleteCollection(col.id); }}
                className="invisible text-[var(--c-text-tertiary)] transition-colors hover:text-red-500 group-hover:visible"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>

        {/* Right: Collection detail */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          {!selectedCollection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--c-text-tertiary)]">
              <BookOpen size={32} />
              <p className="text-sm">{t.knowledge.selectCollection}</p>
            </div>
          ) : (
            <>
              {/* Collection header */}
              <div className="mb-4">
                <h2 className="text-lg font-medium text-[var(--c-text-primary)]">{selectedCollection.name}</h2>
                {selectedCollection.description && (
                  <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{selectedCollection.description}</p>
                )}
              </div>

              {/* Search */}
              <div className="mb-4 flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
                    placeholder={t.knowledge.searchPlaceholder}
                    aria-label={t.knowledge.searchPlaceholder}
                    className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] py-1.5 pl-9 pr-3 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]"
                  />
                </div>
                <button type="button" onClick={() => void handleSearch()} disabled={searching} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[var(--c-accent-send-hover)] disabled:opacity-50">
                  {searching ? t.knowledge.searching : t.knowledge.searchBtn}
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mb-4 rounded-lg border border-[var(--c-accent)]/20 bg-[var(--c-accent)]/5 p-3">
                  <h3 className="mb-2 text-xs font-medium text-[var(--c-accent)]">{t.knowledge.searchResultsTitle(searchResults.length)}</h3>
                  <div className="space-y-2">
                    {searchResults.slice(0, 10).map(r => (
                      <div key={r.chunkId} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] p-2">
                        <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                          <span className="font-medium">{r.sourceTitle}</span>
                          {r.pageIndex != null && <span>· {t.knowledge.pageLabel(r.pageIndex + 1)}</span>}
                          <span className="ml-auto text-[var(--c-text-tertiary)]">score: {r.fusedScore.toFixed(2)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--c-text-primary)] line-clamp-3">{r.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add source area */}
              <div
                className={`mb-4 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                  dragOver ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5' : 'border-[var(--c-border)]'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => void handleDrop(e)}
              >
                {dragOver ? (
                  <p className="text-sm text-[var(--c-accent)]">{t.knowledge.dropToAdd}</p>
                ) : (
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button type="button" onClick={() => void handlePickFiles()} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <FileText size={12} /> {t.knowledge.pickFiles}
                    </button>
                    <button type="button" onClick={() => { setAddMode('paste'); setShowAddSource(true); }} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <ClipboardPaste size={12} /> {t.knowledge.pasteText}
                    </button>
                    <button type="button" onClick={() => { setAddMode('url'); setShowAddSource(true); }} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <Link size={12} /> {t.knowledge.addUrl}
                    </button>
                    <button type="button" onClick={handleOpenMeetingImport} className="flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                      <Mic size={12} /> {t.knowledge.meetingImport}
                    </button>
                    <span className="text-xs text-[var(--c-text-tertiary)]">{t.knowledge.orDragFiles}</span>
                  </div>
                )}
              </div>

              {/* Add source dialog */}
              {showAddSource && (
                <div className="mb-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
                  {addMode === 'paste' ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={pasteTitle}
                        onChange={e => setPasteTitle(e.target.value)}
                        placeholder={t.knowledge.titleOptional}
                        aria-label={t.knowledge.titleOptional}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <textarea
                        value={pasteText}
                        onChange={e => setPasteText(e.target.value)}
                        placeholder={t.knowledge.pasteContentPlaceholder}
                        aria-label={t.knowledge.pasteContentPlaceholder}
                        rows={5}
                        className="w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowAddSource(false)} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm">{t.knowledge.cancel}</button>
                        <button type="button" onClick={() => void handleAddPasteSource()} disabled={!pasteText.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.addSource}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={urlTitle}
                        onChange={e => setUrlTitle(e.target.value)}
                        placeholder={t.knowledge.titleOptional}
                        aria-label={t.knowledge.titleOptional}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <input
                        type="url"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://..."
                        aria-label="URL"
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c-accent)]"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowAddSource(false)} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm">{t.knowledge.cancel}</button>
                        <button type="button" onClick={() => void handleAddUrlSource()} disabled={!urlInput.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.addUrlBtn}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Source list */}
              {sources.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--c-text-tertiary)]">
                  <FileText size={24} />
                  <p className="text-sm">{t.knowledge.emptyCollection}</p>
                  <p className="text-xs">{t.knowledge.emptyCollectionHint}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {sources.map(src => (
                    <div key={src.id} className="group flex items-center gap-2 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => void handleOpenSource(src)}
                        aria-label={t.knowledge.openSource(src.title)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <SourceKindIcon kind={src.kind} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[var(--c-text-primary)]">{src.title}</div>
                          <div className="flex items-center gap-2 text-xs text-[var(--c-text-tertiary)]">
                            <span>{t.knowledge.chunkCount(src.chunkCount)}</span>
                            <StatusBadge status={src.parseStatus} />
                          </div>
                        </div>
                        <ChevronRight size={14} className="shrink-0 text-[var(--c-text-tertiary)]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSource(src.id)}
                        className="invisible text-[var(--c-text-tertiary)] transition-colors hover:text-red-500 group-hover:visible"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Create collection dialog */}
      {showCreateDialog && (
        <CreateCollectionDialog
          name={newCollectionName}
          setName={setNewCollectionName}
          onCreate={handleCreateCollection}
          onCancel={() => setShowCreateDialog(false)}
        />
      )}
      {showMeetingImport && (
        <MeetingImportDialog
          title={meetingTitle}
          setTitle={updateMeetingTitle}
          audioFilePath={meetingAudioFilePath}
          transcript={meetingTranscript}
          setTranscript={setMeetingTranscript}
          saving={meetingSaving}
          message={meetingMessage}
          onPickAudio={handlePickMeetingAudio}
          onSave={handleSaveMeetingTranscript}
          onCancel={handleCloseMeetingImport}
        />
      )}
      {showMeetingRecorder && !meetingSummaryDraft.trim() && (
        <MeetingRecorderDialog
          title={meetingTitle}
          setTitle={updateMeetingTitle}
          recording={meetingRecording}
          paused={meetingRecordingPaused}
          audioLevels={meetingAudioLevels}
          previewSegments={meetingPreviewSegments}
          transcriberEngine={meetingTranscriberEngine}
          transcriberModel={meetingTranscriberModel}
          transcriberLanguage={meetingTranscriberLanguage}
          scenario={meetingRecordingScenario}
          setScenario={updateMeetingRecordingScenario}
          recordingSaving={meetingRecordingSaving}
          processing={meetingProcessing}
          message={meetingMessage}
          onStartRecording={() => void handleStartMeetingRecording()}
          onPauseRecording={handlePauseMeetingRecording}
          onResumeRecording={handleResumeMeetingRecording}
          onFinishRecording={() => void handleStopMeetingRecording({ draftRecording: true })}
          onCancel={handleCloseMeetingRecorder}
        />
      )}
      {showMeetingRecorder && meetingSummaryDraft.trim() && (
        <MeetingSummaryDraftDialog
          title={meetingTitle}
          setTitle={updateMeetingTitle}
          audioFilePath={meetingAudioFilePath}
          previewSegments={meetingPreviewSegments}
          summaryDraft={meetingSummaryDraft}
          setSummaryDraft={setMeetingSummaryDraft}
          draftSaving={meetingSaving}
          message={meetingMessage}
          onSaveDraft={() => void handleSaveMeetingRecordingDraft()}
          onCancel={handleCloseMeetingRecorder}
        />
      )}
      {(sourceContentLoading || sourceContentError || sourceContent) && (
        <SourceContentDialog
          content={sourceContent}
          loading={sourceContentLoading}
          error={sourceContentError}
          onClose={() => {
            setSourceContent(null);
            setSourceContentError('');
            setSourceContentLoading(false);
          }}
        />
      )}
    </div>
  );
}

function SourceContentDialog({
  content,
  loading,
  error,
  onClose,
}: {
  content: KbSourceContent | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const title = content?.source.title || t.knowledge.sourceContentTitle;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="flex max-h-[82vh] w-[720px] flex-col rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-[var(--c-text-primary)]">{title}</h3>
            {content && (
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--c-text-tertiary)]">
                <span>{t.knowledge.chunkCount(content.source.chunkCount)}</span>
                <StatusBadge status={content.source.parseStatus} />
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">
            {t.knowledge.close}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.sourceContentLoading}</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : content?.text.trim() ? (
            <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--c-text-primary)]">{content.text}</pre>
          ) : (
            <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.sourceContentEmpty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'url': return <Globe size={16} className="shrink-0 text-blue-500" />;
    case 'paste': return <ClipboardPaste size={16} className="shrink-0 text-green-600" />;
    case 'meeting': return <Mic size={16} className="shrink-0 text-purple-500" />;
    default: return <FileText size={16} className="shrink-0 text-[var(--c-text-icon)]" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  switch (status) {
    case 'parsed': return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">{t.knowledge.statusParsed}</span>;
    case 'pending': return <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-700">{t.knowledge.statusPending}</span>;
    case 'parsing': return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{t.knowledge.statusParsing}</span>;
    case 'failed': return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">{t.knowledge.statusFailed}</span>;
    default: return null;
  }
}

function MeetingImportDialog({
  title,
  setTitle,
  audioFilePath,
  transcript,
  setTranscript,
  saving,
  message,
  onPickAudio,
  onSave,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  transcript: string;
  setTranscript: (value: string) => void;
  saving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onPickAudio: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="w-[520px] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 shadow-lg" role="dialog" aria-label={t.knowledge.meetingImportTitle} onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingImportTitle}</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingTitleLabel}</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              aria-label={t.knowledge.meetingTitleLabel}
              placeholder={t.knowledge.meetingTitlePlaceholder}
              className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>
          <div>
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingAudioLabel}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onPickAudio} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                {t.knowledge.meetingPickAudio}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--c-text-tertiary)]">
                {audioFilePath || t.knowledge.meetingNoAudioSelected}
              </span>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingTranscriptLabel}</span>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              aria-label={t.knowledge.meetingTranscriptLabel}
              placeholder={t.knowledge.meetingTranscriptPlaceholder}
              rows={7}
              className="w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>
          {message && (
            <p className={`text-xs ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {message.text}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">{t.knowledge.cancel}</button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !audioFilePath || !transcript.trim()}
              className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingAudioWaveform({
  audioLevels,
  active,
  paused,
  compact = false,
}: {
  audioLevels: number[];
  active: boolean;
  paused: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div
      className={`flex items-center justify-center gap-1 ${compact ? 'h-6' : 'h-12'}`}
      role="meter"
      aria-label={t.knowledge.meetingAudioLevelLabel}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.max(...audioLevels, 0)}
    >
      {audioLevels.map((level, index) => {
        const normalized = Math.max(0, Math.min(1, level));
        const maxHeight = compact ? 24 : 34;
        return (
          <span
            key={index}
            data-audio-level={normalized.toFixed(2)}
            className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${active && !paused ? 'bg-[var(--c-accent)]' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
            style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * maxHeight))}px` }}
          />
        );
      })}
    </div>
  );
}

function MeetingRecorderWindowSurface({
  title,
  setTitle,
  view,
  recording,
  paused,
  elapsedMs,
  audioLevels,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  draftTranscript,
  transcriberEngine,
  transcriberLanguage,
  scenario,
  setScenario,
  recordingSaving,
  processing,
  draftSaving,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onCompact,
  onExpand,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  view: 'workbench' | 'compact' | 'summary';
  recording: boolean;
  paused: boolean;
  elapsedMs: number;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  draftTranscript: string;
  transcriberEngine: MeetingTranscriberEngine;
  transcriberLanguage: MeetingTranscriberLanguage;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  recordingSaving: boolean;
  processing: boolean;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onCompact: () => void;
  onExpand: () => void;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [summaryTab, setSummaryTab] = useState<'summary' | 'transcript'>('summary');
  const [summaryEditing, setSummaryEditing] = useState(false);
  const busy = recordingSaving || processing;
  const latestText = previewSegments.at(-1)?.text?.trim() || t.knowledge.meetingTranscriptPreviewEmpty;
  const transcriptText = draftTranscript.trim() || previewSegments.map(segment => segment.text).join('\n');
  const elapsed = formatMeetingElapsedTime(elapsedMs);
  const engineLabels: Record<MeetingTranscriberEngine, string> = {
    'sherpa-onnx-paraformer': t.knowledge.meetingSpeechEngineSherpaOnnxParaformer,
    whisper: t.knowledge.meetingSpeechEngineWhisperFallback,
    'volcengine-asr': t.knowledge.meetingSpeechEngineVolcengineAsr,
    'aliyun-asr': t.knowledge.meetingSpeechEngineAliyunAsr,
  };
  const languageLabels: Record<MeetingTranscriberLanguage, string> = {
    zh: t.knowledge.meetingLanguageZh,
    auto: t.knowledge.meetingLanguageAuto,
    en: t.knowledge.meetingLanguageEn,
  };
  const scenarioLabels: Record<MeetingRecordingScenario, string> = {
    discussion: t.knowledge.meetingScenarioDiscussion,
    meeting: t.knowledge.meetingScenarioMeeting,
    sales: t.knowledge.meetingScenarioSales,
  };

  if (view === 'compact') {
    return (
      <main
        className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-5 pb-4 pt-3 text-[var(--c-text-primary)]"
        role="main"
        aria-label={t.knowledge.meetingRecorderTitle}
        data-app-region="drag"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-start gap-3">
          <p className="line-clamp-2 min-h-[52px] min-w-0 flex-1 text-lg leading-7">{latestText}</p>
          <button type="button" onClick={onExpand} aria-label={t.knowledge.meetingRecorderExpand} title={t.knowledge.meetingRecorderExpand} data-app-region="no-drag" className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Maximize2 size={18} />
          </button>
        </div>
        <div data-testid="meeting-compact-waveform" className="mt-1">
          <MeetingAudioWaveform audioLevels={audioLevels} active={recording} paused={paused} compact />
        </div>
        <div data-testid="meeting-compact-controls" className="grid grid-cols-[80px_1fr_80px] items-center gap-3" style={{ marginTop: 4 }}>
          <span className="text-base tabular-nums text-[var(--c-text-secondary)]">{elapsed}</span>
          <button type="button" onClick={paused ? onResumeRecording : onPauseRecording} aria-label={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} title={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} data-app-region="no-drag" className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--c-bg-deep)] text-[var(--c-text-primary)] hover:bg-[var(--c-border)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
          </button>
          <button type="button" onClick={onFinishRecording} disabled={busy} data-app-region="no-drag" className="rounded-full bg-[var(--c-bg-deep)] px-4 py-2 text-sm font-medium hover:bg-[var(--c-border)] disabled:opacity-50" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {t.knowledge.meetingRecordStop}
          </button>
        </div>
      </main>
    );
  }

  if (view === 'summary') {
    return (
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-14 pb-8 pt-12 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <header className="shrink-0 border-b border-[var(--c-border)] pb-5">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <input value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full bg-transparent text-3xl font-semibold leading-tight outline-none" />
              <p className="mt-2 text-sm tabular-nums text-[var(--c-text-tertiary)]">{elapsed}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {summaryTab === 'summary' && (
                <button type="button" onClick={() => setSummaryEditing(value => !value)} aria-label={summaryEditing ? t.knowledge.meetingRecorderFinishEditing : t.knowledge.meetingRecorderEditSummary} title={summaryEditing ? t.knowledge.meetingRecorderFinishEditing : t.knowledge.meetingRecorderEditSummary} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                  {summaryEditing ? <Check size={19} /> : <Pencil size={18} />}
                </button>
              )}
              <button type="button" onClick={onCancel} disabled={draftSaving} aria-label={t.knowledge.cancel} title={t.knowledge.cancel} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50">
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="mt-7 flex gap-8" role="tablist">
            <button type="button" role="tab" aria-selected={summaryTab === 'summary'} onClick={() => setSummaryTab('summary')} className={`border-b-2 pb-3 text-base font-medium ${summaryTab === 'summary' ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]' : 'border-transparent text-[var(--c-text-tertiary)]'}`}>
              {t.knowledge.meetingRecorderSummaryTab}
            </button>
            <button type="button" role="tab" aria-selected={summaryTab === 'transcript'} onClick={() => setSummaryTab('transcript')} className={`border-b-2 pb-3 text-base font-medium ${summaryTab === 'transcript' ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]' : 'border-transparent text-[var(--c-text-tertiary)]'}`}>
              {t.knowledge.meetingRecorderTranscriptTab}
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto py-7">
          {summaryTab === 'summary' ? (summaryEditing ? (
            <textarea value={summaryDraft} onChange={event => setSummaryDraft(event.target.value)} aria-label={t.knowledge.meetingSummaryDraftLabel} className="h-full min-h-[420px] w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-5 py-4 text-base leading-8 outline-none focus:border-[var(--c-accent)]" />
          ) : (
            <div className="meeting-summary-markdown text-base leading-8">
              <MarkdownRenderer content={summaryDraft} />
            </div>
          )) : (
            <div className="whitespace-pre-wrap text-base leading-8 text-[var(--c-text-secondary)]">{transcriptText || t.knowledge.meetingTranscriptPreviewEmpty}</div>
          )}
        </div>
        {message?.kind === 'error' && <p className="mb-3 text-sm text-red-600">{message.text}</p>}
        <footer className="flex shrink-0 justify-end border-t border-[var(--c-border)] pt-5">
          <button type="button" onClick={onSaveDraft} disabled={draftSaving || !summaryDraft.trim()} className="rounded-md bg-[var(--c-accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {draftSaving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
          </button>
        </footer>
      </main>
    );
  }

  if (busy && !recording) {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center bg-[var(--c-bg-card)] px-8 text-center text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <LoaderCircle size={34} className="animate-spin text-[var(--c-accent)]" />
        <h1 className="mt-6 text-2xl font-semibold">{t.knowledge.meetingRecorderProcessingTitle}</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-[var(--c-text-secondary)]">{t.knowledge.meetingRecorderProcessingHint}</p>
        {message && <p className={`mt-5 text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-[var(--c-text-tertiary)]'}`}>{message.text}</p>}
      </main>
    );
  }

  if (!recording) {
    return (
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-14 pb-10 pt-12 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-semibold leading-tight">{t.knowledge.meetingRecorderTitle}</h1>
            <p className="mt-3 text-sm text-[var(--c-text-tertiary)]">{engineLabels[transcriberEngine]} / {languageLabels[transcriberLanguage]}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={t.knowledge.cancel} title={t.knowledge.cancel} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
            <X size={20} />
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6">
          <label>
            <span className="mb-2 block text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
            <input type="text" value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-base outline-none focus:border-[var(--c-accent)]" />
          </label>
          <label>
            <span className="mb-2 block text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
            <select value={scenario} onChange={event => setScenario(event.target.value as MeetingRecordingScenario)} aria-label={t.knowledge.meetingScenarioLabel} className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-base outline-none focus:border-[var(--c-accent)]">
              {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => <option key={option} value={option}>{scenarioLabels[option]}</option>)}
            </select>
          </label>
          <button type="button" onClick={onStartRecording} className="mx-auto mt-5 min-w-56 rounded-md bg-[var(--c-accent)] px-8 py-4 text-lg font-medium text-white shadow-sm hover:opacity-90">
            <Mic size={20} className="mr-2 inline" />{t.knowledge.meetingRecordStart}
          </button>
          {message && <p className={`text-center text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-[var(--c-text-secondary)]'}`}>{message.text}</p>}
        </div>
      </main>
    );
  }

  const liveHighlights = previewSegments.slice(-4);
  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] pt-10 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
      <header className="flex shrink-0 items-start justify-between border-b border-[var(--c-border)] px-12 pb-5">
        <div className="min-w-0">
          <input value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full min-w-[360px] bg-transparent text-2xl font-semibold outline-none" />
          <p className="mt-2 text-sm tabular-nums text-[var(--c-text-tertiary)]">{elapsed} · {paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording}</p>
        </div>
        <button type="button" onClick={onCompact} aria-label={t.knowledge.meetingRecorderMinimize} title={t.knowledge.meetingRecorderMinimize} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
          <Minimize2 size={19} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-0 flex-col border-r border-[var(--c-border)] px-12 py-7">
          <h2 className="shrink-0 text-xl font-semibold">{t.knowledge.meetingRecorderTranscriptTitle}</h2>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-3 text-lg leading-9">
            {previewSegments.length > 0 ? previewSegments.map((segment, index) => (
              <p key={`${segment.start}-${index}`} className="mb-4">{segment.text}</p>
            )) : <p className="text-[var(--c-text-tertiary)]">{t.knowledge.meetingTranscriptPreviewEmpty}</p>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col px-12 py-7">
          <h2 className="shrink-0 text-xl font-semibold">{t.knowledge.meetingRecorderHighlightsTitle}</h2>
          <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto">
            {liveHighlights.length > 0 ? liveHighlights.map((segment, index) => (
              <div key={`${segment.start}-${index}`} className="rounded-md bg-[var(--c-bg-deep)] px-5 py-4 text-base leading-7">{segment.text}</div>
            )) : <p className="text-sm leading-6 text-[var(--c-text-tertiary)]">{t.knowledge.meetingRecorderHighlightsEmpty}</p>}
          </div>
        </section>
      </div>
      <footer className="grid shrink-0 grid-cols-[90px_minmax(200px,1fr)_56px_90px] items-center gap-5 border-t border-[var(--c-border)] px-12 py-5">
        <span className="text-lg tabular-nums">{elapsed}</span>
        <MeetingAudioWaveform audioLevels={audioLevels} active={recording} paused={paused} />
        <button type="button" onClick={paused ? onResumeRecording : onPauseRecording} aria-label={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} title={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} className="grid size-12 place-items-center rounded-full bg-[var(--c-bg-deep)] hover:bg-[var(--c-border)]">
          {paused ? <Play size={21} fill="currentColor" /> : <Pause size={21} fill="currentColor" />}
        </button>
        <button type="button" onClick={onFinishRecording} className="rounded-full bg-[var(--c-bg-deep)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--c-border)]">
          {t.knowledge.meetingRecordStop}
        </button>
      </footer>
      {message?.kind === 'error' && <p className="absolute bottom-24 left-12 text-sm text-red-600">{message.text}</p>}
    </main>
  );
}

function MeetingRecorderDialog({
  title,
  setTitle,
  recording,
  paused,
  audioLevels,
  previewSegments,
  transcriberEngine,
  transcriberModel,
  transcriberLanguage,
  scenario,
  setScenario,
  recordingSaving,
  processing,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  recording: boolean;
  paused: boolean;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  transcriberEngine: MeetingTranscriberEngine;
  transcriberModel: MeetingTranscriberModel;
  transcriberLanguage: MeetingTranscriberLanguage;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  recordingSaving: boolean;
  processing: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const engineLabels: Record<MeetingTranscriberEngine, string> = {
    'sherpa-onnx-paraformer': t.knowledge.meetingSpeechEngineSherpaOnnxParaformer,
    whisper: t.knowledge.meetingSpeechEngineWhisperFallback,
    'volcengine-asr': t.knowledge.meetingSpeechEngineVolcengineAsr,
    'aliyun-asr': t.knowledge.meetingSpeechEngineAliyunAsr,
  };
  const languageLabels: Record<MeetingTranscriberLanguage, string> = {
    zh: t.knowledge.meetingLanguageZh,
    auto: t.knowledge.meetingLanguageAuto,
    en: t.knowledge.meetingLanguageEn,
  };
  const scenarioLabels: Record<MeetingRecordingScenario, string> = {
    discussion: t.knowledge.meetingScenarioDiscussion,
    meeting: t.knowledge.meetingScenarioMeeting,
    sales: t.knowledge.meetingScenarioSales,
  };
  const latestSegment = previewSegments[previewSegments.length - 1];
  const latestText = latestSegment?.text?.trim() || t.knowledge.meetingTranscriptPreviewEmpty;
  const busy = recordingSaving || processing;
  const statusText = recording
    ? (paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording)
    : recordingSaving
      ? t.knowledge.meetingRecordingSaving
      : processing
        ? t.knowledge.meetingTranscribing
        : t.knowledge.meetingRecordingReady;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-xl"
      role="dialog"
      aria-label={t.knowledge.meetingRecorderTitle}
      onKeyDown={event => { if (event.key === 'Escape' && !recording && !busy) onCancel(); }}
    >
      <div className="border-b border-[var(--c-border)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingRecorderTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">
              {engineLabels[transcriberEngine]} / {languageLabels[transcriberLanguage]}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={recording || busy}
            className="shrink-0 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-40"
          >
            {t.knowledge.cancel}
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
          <input
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            aria-label={t.knowledge.meetingRecordingTitleLabel}
            disabled={recording || busy}
            className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
          <select
            value={scenario}
            onChange={event => setScenario(event.target.value as MeetingRecordingScenario)}
            aria-label={t.knowledge.meetingScenarioLabel}
            disabled={recording || busy}
            className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-60"
          >
            {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => (
              <option key={option} value={option}>{scenarioLabels[option]}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2">
          <span className={`h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-red-500' : paused ? 'bg-amber-500' : busy ? 'bg-blue-500' : 'bg-[var(--c-text-tertiary)]'}`} />
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--c-text-primary)]">{statusText}</span>
          <span className="shrink-0 text-[11px] text-[var(--c-text-tertiary)]">{transcriberModel}</span>
        </div>

        {recording ? (
          <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] gap-2">
            <button
              type="button"
              onClick={paused ? onResumeRecording : onPauseRecording}
              disabled={busy}
              className="rounded-md border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
            >
              {paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause}
            </button>
            <button
              type="button"
              aria-label={t.knowledge.meetingAudioLevelLabel}
              disabled
              className="flex h-10 items-end justify-center gap-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 disabled:opacity-100"
            >
              {audioLevels.map((level, index) => {
                const normalized = Math.max(0, Math.min(1, level));
                return (
                  <span
                    key={index}
                    data-audio-level={normalized.toFixed(2)}
                    className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${recording && !paused ? 'bg-red-500' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
                    style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * 26))}px` }}
                  />
                );
              })}
            </button>
            <button
              type="button"
              onClick={onFinishRecording}
              disabled={busy}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {t.knowledge.meetingRecordStop}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartRecording}
            disabled={busy}
            className="w-full rounded-lg bg-[var(--c-accent)] px-4 py-3 text-base font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {recordingSaving ? t.knowledge.meetingRecordingSaving : processing ? t.knowledge.meetingTranscribing : t.knowledge.meetingRecordStart}
          </button>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingLatestTranscriptTitle}</p>
          <p className="line-clamp-2 min-h-[40px] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm leading-5 text-[var(--c-text-primary)]">
            {latestText}
          </p>
        </div>

        {message && (
          <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

function MeetingSummaryDraftDialog({
  title,
  setTitle,
  audioFilePath,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  draftSaving,
  message,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
      <div
        className="flex max-h-[86vh] w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg"
        role="dialog"
        aria-label={t.knowledge.meetingSummaryDraftTitle}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingSummaryDraftTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingDraftReady}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={draftSaving} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] disabled:opacity-50">
            {t.knowledge.cancel}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
            <input
              type="text"
              value={title}
              onChange={event => setTitle(event.target.value)}
              aria-label={t.knowledge.meetingRecordingTitleLabel}
              className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>

          <label className="flex min-h-[260px] flex-1 flex-col">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSummaryDraftLabel}</span>
            <textarea
              value={summaryDraft}
              onChange={event => setSummaryDraft(event.target.value)}
              aria-label={t.knowledge.meetingSummaryDraftLabel}
              placeholder={t.knowledge.meetingSummaryDraftPlaceholder}
              className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-sm leading-6 text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]"
            />
          </label>

          {previewSegments.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2">
              <p className="mb-2 text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingTranscriptPreviewLabel}</p>
              <div className="space-y-1" role="list" aria-label={t.knowledge.meetingTranscriptPreviewLabel}>
                {previewSegments.map((segment, index) => (
                  <div key={`${index}-${segment.start}-${segment.text}`} role="listitem" className="flex items-start gap-2 text-xs leading-5">
                    <span className="w-10 shrink-0 text-right tabular-nums text-[var(--c-text-tertiary)]">{formatMeetingSegmentTime(segment.start)}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--c-text-secondary)]">{segment.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && (
            <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={draftSaving || !summaryDraft.trim() || !audioFilePath}
              className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {draftSaving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegacyMeetingRecorderDialog({
  title,
  setTitle,
  audioFilePath,
  recording,
  paused,
  audioLevels,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  transcriberEngine,
  setTranscriberEngine,
  transcriberModel,
  setTranscriberModel,
  transcriberLanguage,
  setTranscriberLanguage,
  asrConfig,
  asrConfigSaving,
  onSaveAsrConfig,
  scenario,
  setScenario,
  modelStatuses,
  modelStatusesLoading,
  modelStatusesError,
  modelAction,
  onRefreshModelStatuses,
  onDownloadModel,
  onUninstallModel,
  recordingSaving,
  processing,
  draftSaving,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  recording: boolean;
  paused: boolean;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  transcriberEngine: MeetingTranscriberEngine;
  setTranscriberEngine: (value: MeetingTranscriberEngine) => void;
  transcriberModel: MeetingTranscriberModel;
  setTranscriberModel: (value: MeetingTranscriberModel) => void;
  transcriberLanguage: MeetingTranscriberLanguage;
  setTranscriberLanguage: (value: MeetingTranscriberLanguage) => void;
  asrConfig: MeetingAsrConfigSnapshot | null;
  asrConfigSaving: boolean;
  onSaveAsrConfig: (input: MeetingSaveAsrConfigInput) => Promise<MeetingAsrConfigSnapshot | null>;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  modelStatuses: MeetingModelStatusSnapshot[];
  modelStatusesLoading: boolean;
  modelStatusesError: string;
  modelAction: MeetingModelActionState | null;
  onRefreshModelStatuses: () => Promise<void>;
  onDownloadModel: (modelId: string) => void;
  onUninstallModel: (modelId: string) => void;
  recordingSaving: boolean;
  processing: boolean;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onlineAsrDraft, setOnlineAsrDraft] = useState({
    volcAppKey: '',
    volcAccessKey: '',
    volcEndpoint: '',
    volcResourceId: '',
    aliyunApiKey: '',
    aliyunBaseUrl: '',
  });
  const [onlineAsrSaved, setOnlineAsrSaved] = useState(false);
  const [onlineAsrError, setOnlineAsrError] = useState('');
  const hasSummaryDraft = summaryDraft.trim().length > 0;
  const localTranscriberSelected = isLocalMeetingTranscriberEngine(transcriberEngine);
  const modelStatusById = new Map(modelStatuses.map(model => [model.id, model]));
  const speechEngineName = (engineId?: string) => {
    if (engineId === 'sherpa-onnx-paraformer') return t.knowledge.meetingSpeechEngineSherpaOnnxName;
    if (!engineId || engineId === 'whisper') return t.knowledge.meetingSpeechEngineWhisperName;
    if (engineId === 'volcengine-asr') return t.knowledge.meetingSpeechEngineVolcengineAsr;
    if (engineId === 'aliyun-asr') return t.knowledge.meetingSpeechEngineAliyunAsr;
    return engineId;
  };
  const speechModelName = (modelId: MeetingTranscriberModel) => (
    modelId === MEETING_SHERPA_ONNX_PARA_MODEL
      ? t.knowledge.meetingSpeechModelSherpaOnnxParaformerSmall
      : modelId
  );
  const speechModelOptionLabel = (modelId: MeetingTranscriberModel) => {
    const status = modelStatusById.get(modelId);
    return t.knowledge.meetingSpeechModelOption(
      speechEngineName(status?.engineId),
      speechModelName(modelId),
      status?.sizeLabel,
    );
  };
  const visibleModelOptions = MEETING_TRANSCRIBER_MODEL_OPTIONS.filter(model => (
    meetingTranscriberEngineForModel(model) === transcriberEngine
  ));
  const groupedModelStatuses = [
    {
      id: 'asr',
      title: t.knowledge.meetingSpeechModelsStatusTitle,
      models: modelStatuses.filter(model => (model.capability ?? 'asr') === 'asr'),
    },
    {
      id: 'punctuation',
      title: t.knowledge.meetingPunctuationModelsStatusTitle,
      models: modelStatuses.filter(model => model.capability === 'punctuation'),
    },
  ].filter(group => group.models.length > 0);
  const engineLabels: Record<MeetingTranscriberEngine, string> = {
    'sherpa-onnx-paraformer': t.knowledge.meetingSpeechEngineSherpaOnnxParaformer,
    whisper: t.knowledge.meetingSpeechEngineWhisperFallback,
    'volcengine-asr': t.knowledge.meetingSpeechEngineVolcengineAsr,
    'aliyun-asr': t.knowledge.meetingSpeechEngineAliyunAsr,
  };
  const onlineProviderConfigured = transcriberEngine === 'volcengine-asr'
    ? asrConfig?.volcengine?.configured === true
    : transcriberEngine === 'aliyun-asr'
      ? asrConfig?.aliyun?.configured === true
      : true;
  const onlineProviderName = engineLabels[transcriberEngine];
  const scenarioLabels: Record<MeetingRecordingScenario, string> = {
    discussion: t.knowledge.meetingScenarioDiscussion,
    meeting: t.knowledge.meetingScenarioMeeting,
    sales: t.knowledge.meetingScenarioSales,
  };
  const statusText = recording
    ? (paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording)
    : processing
      ? t.knowledge.meetingTranscribing
      : hasSummaryDraft
        ? t.knowledge.meetingDraftReady
        : t.knowledge.meetingRecordingReady;

  useEffect(() => {
    setOnlineAsrDraft(prev => ({
      ...prev,
      volcEndpoint: asrConfig?.volcengine?.endpoint ?? '',
      volcResourceId: asrConfig?.volcengine?.resourceId ?? '',
      aliyunBaseUrl: asrConfig?.aliyun?.baseUrl ?? '',
    }));
  }, [asrConfig]);

  useEffect(() => {
    setOnlineAsrSaved(false);
    setOnlineAsrError('');
  }, [transcriberEngine]);

  const handleSaveOnlineAsrConfig = async () => {
    if (localTranscriberSelected || asrConfigSaving) return;
    setOnlineAsrSaved(false);
    setOnlineAsrError('');
    const input: MeetingSaveAsrConfigInput = transcriberEngine === 'volcengine-asr'
      ? {
          defaultProvider: transcriberEngine,
          volcengine: {
            appKey: onlineAsrDraft.volcAppKey,
            accessKey: onlineAsrDraft.volcAccessKey,
            endpoint: onlineAsrDraft.volcEndpoint,
            resourceId: onlineAsrDraft.volcResourceId,
          },
        }
      : {
          defaultProvider: transcriberEngine,
          aliyun: {
            apiKey: onlineAsrDraft.aliyunApiKey,
            baseUrl: onlineAsrDraft.aliyunBaseUrl,
            model: 'fun-asr',
          },
        };
    try {
      const saved = await onSaveAsrConfig(input);
      if (saved) {
        setOnlineAsrDraft(prev => ({
          ...prev,
          volcAppKey: '',
          volcAccessKey: '',
          aliyunApiKey: '',
        }));
        setOnlineAsrSaved(true);
      }
    } catch (error) {
      setOnlineAsrError(t.knowledge.meetingOnlineAsrSaveFailed(error instanceof Error ? error.message : 'unknown'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="flex max-h-[86vh] w-[920px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg" role="dialog" aria-label={t.knowledge.meetingRecorderTitle} onClick={e => { e.stopPropagation(); setSettingsOpen(false); }} onKeyDown={e => { if (e.key === 'Escape' && settingsOpen) { e.stopPropagation(); setSettingsOpen(false); } }}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingRecorderTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">{statusText}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) void onRefreshModelStatuses();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                <Settings2 size={14} /> {t.knowledge.meetingSettings}
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-[420px] max-w-[calc(100vw-48px)] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 text-left shadow-lg">
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSpeechEngineLabel}</span>
                      <select
                        value={transcriberEngine}
                        onChange={e => setTranscriberEngine(e.target.value as MeetingTranscriberEngine)}
                        aria-label={t.knowledge.meetingSpeechEngineLabel}
                        disabled={recordingSaving || processing}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                      >
                        {MEETING_TRANSCRIBER_ENGINE_OPTIONS.map(engine => (
                          <option key={engine} value={engine}>{engineLabels[engine]}</option>
                        ))}
                      </select>
                    </label>

                    {localTranscriberSelected && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSpeechModelLabel}</span>
                        <select
                          value={transcriberModel}
                          onChange={e => setTranscriberModel(e.target.value as MeetingTranscriberModel)}
                          aria-label={t.knowledge.meetingSpeechModelLabel}
                          disabled={recordingSaving || processing}
                          className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                        >
                          {visibleModelOptions.map(model => (
                            <option key={model} value={model}>{speechModelOptionLabel(model)}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingLanguageLabel}</span>
                      <select
                        value={transcriberLanguage}
                        onChange={e => setTranscriberLanguage(e.target.value as MeetingTranscriberLanguage)}
                        aria-label={t.knowledge.meetingLanguageLabel}
                        disabled={recordingSaving || processing}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                      >
                        <option value="zh">{t.knowledge.meetingLanguageZh}</option>
                        <option value="auto">{t.knowledge.meetingLanguageAuto}</option>
                        <option value="en">{t.knowledge.meetingLanguageEn}</option>
                      </select>
                    </label>
                    {!localTranscriberSelected && (
                      <div className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingOnlineAsrConfigTitle}</p>
                            <p className={`mt-1 text-xs ${onlineProviderConfigured ? 'text-green-700' : 'text-red-600'}`}>
                              {onlineProviderConfigured
                                ? t.knowledge.meetingOnlineAsrConfigured(onlineProviderName)
                                : t.knowledge.meetingOnlineAsrNotConfigured(onlineProviderName)}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${onlineProviderConfigured ? 'bg-green-500/10 text-green-700' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]'}`}>
                            {onlineProviderConfigured ? ds.meetingAsrConfigured : ds.meetingAsrNotConfigured}
                          </span>
                        </div>
                        {transcriberEngine === 'volcengine-asr' ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrAppKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.volcAppKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcAppKey: e.target.value }))}
                                aria-label={ds.meetingAsrAppKey}
                                placeholder={asrConfig?.volcengine?.appKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAppKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrAccessKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.volcAccessKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcAccessKey: e.target.value }))}
                                aria-label={ds.meetingAsrAccessKey}
                                placeholder={asrConfig?.volcengine?.accessKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAccessKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrEndpoint}</span>
                              <input
                                value={onlineAsrDraft.volcEndpoint}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcEndpoint: e.target.value }))}
                                aria-label={ds.meetingAsrEndpoint}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrResourceId}</span>
                              <input
                                value={onlineAsrDraft.volcResourceId}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcResourceId: e.target.value }))}
                                aria-label={ds.meetingAsrResourceId}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrApiKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.aliyunApiKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, aliyunApiKey: e.target.value }))}
                                aria-label={ds.meetingAsrApiKey}
                                placeholder={asrConfig?.aliyun?.apiKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrApiKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrBaseUrl}</span>
                              <input
                                value={onlineAsrDraft.aliyunBaseUrl}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, aliyunBaseUrl: e.target.value }))}
                                aria-label={ds.meetingAsrBaseUrl}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            {onlineAsrSaved && <span className="text-xs text-green-700">{ds.meetingAsrSaved}</span>}
                            {onlineAsrError && <span className="text-xs text-red-600">{onlineAsrError}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSaveOnlineAsrConfig()}
                            disabled={asrConfigSaving || recordingSaving || processing || recording}
                            className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {asrConfigSaving ? ds.meetingAsrSaving : ds.meetingAsrSave}
                          </button>
                        </div>
                      </div>
                    )}
                    {localTranscriberSelected && (
                    <div className="border-t border-[var(--c-border)] pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingModelDownloadStatusTitle}</p>
                        {modelStatusesLoading && (
                          <span className="text-[11px] text-[var(--c-text-tertiary)]">{t.knowledge.meetingModelStatusLoading}</span>
                        )}
                      </div>
                      {modelStatusesError ? (
                        <p className="text-xs leading-5 text-red-600">{modelStatusesError}</p>
                      ) : groupedModelStatuses.length > 0 ? (
                        <div className="space-y-3">
                          {groupedModelStatuses.map(group => (
                            <div key={group.id} className="space-y-1.5">
                              <p className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{group.title}</p>
                              {group.models.map(model => {
                            const actionRunning = modelAction?.modelId === model.id;
                            const downloading = actionRunning && modelAction.kind === 'download';
                            const statusLabel = downloading
                              ? t.knowledge.meetingModelStatusDownloading
                              : model.status === 'downloaded'
                              ? t.knowledge.meetingModelStatusDownloaded
                              : model.status === 'incomplete'
                                ? t.knowledge.meetingModelStatusIncomplete
                                : model.status === 'corrupt'
                                  ? t.knowledge.meetingModelStatusCorrupt
                                : t.knowledge.meetingModelStatusNotDownloaded;
                            const statusClassName = downloading
                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : model.status === 'downloaded'
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : model.status === 'incomplete'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : model.status === 'corrupt'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-[var(--c-border)] bg-[var(--c-bg-page)] text-[var(--c-text-tertiary)]';
                            const actionDisabled = recordingSaving || processing || !!modelAction;
                            const actionLabel = model.status === 'downloaded'
                              ? t.knowledge.meetingModelUninstallAria(model.fileName)
                              : model.status === 'incomplete' || model.status === 'corrupt'
                                ? t.knowledge.meetingModelRedownloadAria(model.fileName)
                                : t.knowledge.meetingModelDownloadAria(model.fileName);
                            const actionTitle = model.status === 'downloaded'
                              ? t.knowledge.meetingModelUninstall
                              : model.status === 'incomplete' || model.status === 'corrupt'
                                ? t.knowledge.meetingModelRedownload
                                : t.knowledge.meetingModelDownload;
                            return (
                              <div key={model.id} className="rounded-md border border-[var(--c-border)] px-2.5 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-[var(--c-text-primary)]">{model.fileName}</p>
                                    <p className="mt-0.5 text-[11px] text-[var(--c-text-tertiary)]">{model.sizeLabel}</p>
                                  </div>
                                  <div data-meeting-model-status-row={model.id} className="flex shrink-0 items-center gap-1.5">
                                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName}`}>
                                      {statusLabel}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => model.status === 'downloaded' ? onUninstallModel(model.id) : onDownloadModel(model.id)}
                                      disabled={actionDisabled}
                                      aria-label={actionLabel}
                                      title={actionRunning ? t.knowledge.meetingModelActionRunning : actionTitle}
                                      className="inline-flex size-6 items-center justify-center rounded-md border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                                    >
                                      {model.status === 'downloaded' ? (
                                        <Trash2 size={12} aria-hidden="true" />
                                      ) : model.status === 'incomplete' || model.status === 'corrupt' ? (
                                        <RotateCcw size={12} aria-hidden="true" />
                                      ) : (
                                        <Download size={12} aria-hidden="true" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                {(model.status === 'incomplete' || model.status === 'corrupt') && model.localSizeLabel && (
                                  <p className="mt-1 text-[11px] text-[var(--c-text-tertiary)]">
                                    {t.knowledge.meetingModelStatusLocalSize(model.localSizeLabel, model.sizeLabel)}
                                  </p>
                                )}
                              </div>
                            );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-[var(--c-text-tertiary)]">{t.knowledge.meetingModelStatusUnavailable}</p>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button type="button" onClick={onCancel} disabled={recordingSaving || processing} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] disabled:opacity-50">
              {t.knowledge.cancel}
            </button>
          </div>
        </div>
        <div className="grid min-h-[520px] min-w-0 grid-cols-[300px_minmax(0,1fr)]">
          <section className="min-w-0 border-r border-[var(--c-border)] p-5">
            <h4 className="mb-4 text-xs font-medium uppercase tracking-wide text-[var(--c-text-tertiary)]">{t.knowledge.meetingControlPanelTitle}</h4>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  aria-label={t.knowledge.meetingRecordingTitleLabel}
                  placeholder={t.knowledge.meetingTitlePlaceholder}
                  className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
                <select
                  value={scenario}
                  onChange={e => setScenario(e.target.value as MeetingRecordingScenario)}
                  aria-label={t.knowledge.meetingScenarioLabel}
                  disabled={recordingSaving || processing || recording}
                  className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                >
                  {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => (
                    <option key={option} value={option}>{scenarioLabels[option]}</option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-red-500' : paused ? 'bg-amber-500' : 'bg-[var(--c-text-tertiary)]'}`} />
                  <span className="min-w-0 truncate text-sm text-[var(--c-text-primary)]">{statusText}</span>
                </div>
                <div aria-label={t.knowledge.meetingAudioLevelLabel} className="mt-3 flex h-8 items-end gap-1 overflow-hidden">
                  {audioLevels.map((level, index) => {
                    const normalized = Math.max(0, Math.min(1, level));
                    return (
                      <span
                        key={index}
                        data-audio-level={normalized.toFixed(2)}
                        className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${recording && !paused ? 'bg-red-500' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
                        style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * 28))}px` }}
                      />
                    );
                  })}
                </div>
              </div>

              {hasSummaryDraft ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  {t.knowledge.meetingDraftReady}
                </div>
              ) : recording ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={paused ? onResumeRecording : onPauseRecording}
                    disabled={recordingSaving || processing}
                    className="rounded-md border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                  >
                    {paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause}
                  </button>
                  <button
                    type="button"
                    onClick={onFinishRecording}
                    disabled={recordingSaving || processing}
                    className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {t.knowledge.meetingRecordStop}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onStartRecording}
                  disabled={recordingSaving || processing}
                  className="w-full rounded-lg bg-[var(--c-accent)] px-4 py-3 text-base font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {recordingSaving ? t.knowledge.meetingRecordingSaving : t.knowledge.meetingRecordStart}
                </button>
              )}

              {message && (
                <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                  {message.text}
                </p>
              )}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-[var(--c-text-primary)]">
                {hasSummaryDraft ? t.knowledge.meetingSummaryDraftTitle : t.knowledge.meetingLiveTranscriptTitle}
              </h4>
              <span className="shrink-0 rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[10px] text-[var(--c-text-tertiary)]">
                {transcriberModel} / {transcriberLanguage}
              </span>
            </div>
            {hasSummaryDraft ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSummaryDraftLabel}</span>
                  <textarea
                    value={summaryDraft}
                    onChange={e => setSummaryDraft(e.target.value)}
                    aria-label={t.knowledge.meetingSummaryDraftLabel}
                    placeholder={t.knowledge.meetingSummaryDraftPlaceholder}
                    className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-sm leading-6 text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]"
                  />
                </label>
                {previewSegments.length > 0 && (
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2">
                    <p className="mb-2 text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingTranscriptPreviewLabel}</p>
                    <div className="space-y-1" role="list" aria-label={t.knowledge.meetingTranscriptPreviewLabel}>
                      {previewSegments.map((segment, index) => (
                        <div key={`${index}-${segment.start}-${segment.text}`} role="listitem" className="flex items-start gap-2 text-xs leading-5">
                          <span className="w-10 shrink-0 text-right tabular-nums text-[var(--c-text-tertiary)]">{formatMeetingSegmentTime(segment.start)}</span>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--c-text-secondary)]">{segment.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={draftSaving || !summaryDraft.trim() || !audioFilePath}
                    className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {draftSaving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-4">
                {previewSegments.length > 0 ? (
                  <div className="space-y-3" role="list" aria-label={t.knowledge.meetingLiveTranscriptTitle}>
                    {previewSegments.map((segment, index) => {
                      const active = index === previewSegments.length - 1 && recording && !paused;
                      return (
                        <div
                          key={`${index}-${segment.start}-${segment.text}`}
                          role="listitem"
                          data-transcript-line={active ? 'active' : 'complete'}
                          className="flex items-start gap-3"
                        >
                          <span className="mt-2 w-11 shrink-0 text-right text-xs tabular-nums text-[var(--c-text-tertiary)]">
                            {formatMeetingSegmentTime(segment.start)}
                          </span>
                          <div className={`min-w-0 flex-1 ${active ? 'rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 shadow-sm' : 'px-3 py-2'}`}>
                            <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--c-text-primary)]">
                              {segment.text}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {recording && !paused && !processing && (
                      <div className="flex items-center gap-2 pl-14 text-sm text-[var(--c-text-secondary)]">
                        <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                        <span>{t.knowledge.meetingListening}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-60 flex-col items-center justify-center text-center">
                    <span className={`mb-3 h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-blue-500' : 'bg-[var(--c-text-tertiary)]'}`} />
                    <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingTranscriptPreviewEmpty}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CreateCollectionDialog({ name, setName, onCreate, onCancel }: {
  name: string;
  setName: (v: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="w-80 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 shadow-lg" onClick={e => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.createCollectionTitle}</h3>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCreate(); }}
          placeholder={t.knowledge.collectionNamePlaceholder}
          aria-label={t.knowledge.collectionNamePlaceholder}
          className="mb-4 w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">{t.knowledge.cancel}</button>
          <button type="button" onClick={onCreate} disabled={!name.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.createBtn}</button>
        </div>
      </div>
    </div>
  );
}
