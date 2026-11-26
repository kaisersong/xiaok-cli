import { recorderWindowErrorMessage } from '../lib/recorder-window-error';
import { knowledgeErrorMessage } from '../lib/knowledge-error';
import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Plus,
  Trash2,
  FileText,
  Globe,
  ClipboardPaste,
  Search,
  BookOpen,
  Link,
  Mic,
  ChevronRight,
} from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { getDesktopDocumentMimeType } from '../shared/document-formats';
import { fileBasename } from '../lib/file-path';
import type { KbCollection, KbSource, KbSearchResult, KbSourceContent } from './knowledge/knowledge-types';
import {
  createEmptyMeetingAudioLevels,
  calculateMeetingAudioLevels,
  countMeetingAudioSamples,
  stopActiveMeetingRecording,
  encodeFloat32ChunksToWavBase64,
  encodeFloat32ChunkToPcmBase64,
} from './knowledge/meeting-audio';
import type { ActiveMeetingRecording } from './knowledge/meeting-audio';
import {
  MEETING_TRANSCRIBE_PREVIEW_INITIAL_DELAY_MS,
  MEETING_TRANSCRIBE_PREVIEW_INTERVAL_MS,
  MEETING_TRANSCRIBE_PREVIEW_MIN_AUDIO_SECONDS,
  formatMeetingRecordingTimestamp,
  meetingTranscriberEngineForModel,
  defaultMeetingTranscriberModelForEngine,
  readStoredMeetingTranscriberEngine,
  readStoredMeetingTranscriberModel,
  readStoredMeetingTranscriberLanguage,
  meetingTranscriberLanguageForIpc,
  meetingTranscriberModelForIpc,
  normalizeMeetingPreviewSegments,
  offsetMeetingPreviewSegments,
  normalizeMeetingModelStatuses,
} from './knowledge/meeting-transcription';
import type {
  MeetingPreviewSegment,
  MeetingModelStatusSnapshot,
  MeetingModelActionState,
  MeetingAsrConfigSnapshot,
  MeetingSaveAsrConfigInput,
  MeetingTranscriberEngine,
  MeetingTranscriberModel,
  MeetingTranscriberLanguage,
  MeetingRecordingScenario,
} from './knowledge/meeting-transcription';
import { SourceContentDialog, StatusBadge } from './knowledge/SourceContentDialog';
import { MeetingImportDialog } from './knowledge/MeetingImportDialog';
import { MeetingRecorderWindowSurface } from './knowledge/MeetingRecorderWindowSurface';
import { MeetingRecorderDialog } from './knowledge/MeetingRecorderDialog';
import { MeetingSummaryDraftDialog } from './knowledge/MeetingSummaryDraftDialog';

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
  const [knowledgeError, setKnowledgeError] = useState('');
  const [collectionsError, setCollectionsError] = useState('');
  const [sourcesError, setSourcesError] = useState('');
  const [searchError, setSearchError] = useState('');
  const knowledgeFailureMessage = useCallback((error: unknown, reading = false) => knowledgeErrorMessage(error, { projectionUnavailable: t.knowledge.projectionUnavailable, operationUnknown: t.knowledge.operationUnknown, inputInvalid: t.knowledge.inputInvalid }, reading), [t]);
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
  const [meetingAudioFilePath, setMeetingAudioFilePathState] = useState('');
  const meetingAudioFilePathRef = useRef('');
  const setMeetingAudioFilePath = useCallback((value: string) => { meetingAudioFilePathRef.current = value; setMeetingAudioFilePathState(value); }, []);
  const [meetingTranscript, setMeetingTranscript] = useState('');
  const [meetingSummaryDraft, setMeetingSummaryDraftState] = useState('');
  const meetingSummaryDraftRef = useRef('');
  const setMeetingSummaryDraft = useCallback((value: string) => { meetingSummaryDraftRef.current = value; setMeetingSummaryDraftState(value); }, []);
  const [meetingDraftTranscript, setMeetingDraftTranscriptState] = useState('');
  const meetingDraftTranscriptRef = useRef('');
  const setMeetingDraftTranscript = useCallback((value: string) => { meetingDraftTranscriptRef.current = value; setMeetingDraftTranscriptState(value); }, []);
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
  const [meetingNotice, setMeetingMessage] = useState<{ kind: 'error' | 'success'; text?: string; render?: (labels: typeof t) => string } | null>(null);
  const [meetingLiveFailure, setMeetingLiveFailure] = useState('');
  const meetingMessage = meetingNotice?.kind === 'error'
    ? { kind: meetingNotice.kind, text: meetingNotice.render ? meetingNotice.render(t) : meetingNotice.text ?? '' }
    : meetingLiveFailure ? { kind: 'error' as const, text: t.knowledge.meetingLiveTranscriptionFailed(meetingLiveFailure) }
    : meetingNotice ? { kind: meetingNotice.kind, text: meetingNotice.render ? meetingNotice.render(t) : meetingNotice.text ?? '' } : null;
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
  const [meetingWindowError, setMeetingWindowError] = useState('');
  const recorderModeGeneration = useRef(0);
  const recorderSavedSubmission = useRef<{ collectionId: string; title: string; audioFilePath: string; transcript: string; notified: boolean } | null>(null);

  const desktop = getDesktopApi();

  type MeetingUiOwner = { active: boolean; epoch: number; busy: Map<string, symbol> };
  type MeetingUiAction = { owner: MeetingUiOwner; epoch: number; slot: string; id: symbol };
  const meetingUiOwner = useRef<MeetingUiOwner | null>(null);
  // Audio belongs to this mounted consumer, not its current collection route.
  const meetingRecordingOwner = useRef<MeetingUiOwner | null>(null);
  const meetingFinalizingRef = useRef<ActiveMeetingRecording | null>(null);
  const meetingActiveScopes = useRef(new WeakMap<ActiveMeetingRecording, { owner: MeetingUiOwner; epoch: number }>());
  const meetingImportDraftRef = useRef({ collectionId, title: meetingTitle, audioFilePath: meetingAudioFilePath, transcript: meetingTranscript });
  meetingImportDraftRef.current = { collectionId, title: meetingTitle, audioFilePath: meetingAudioFilePath, transcript: meetingTranscript };
  const beginMeetingAction = (slot: string): MeetingUiAction | null => {
    const owner = slot === 'start' || slot === 'stop' ? meetingRecordingOwner.current : meetingUiOwner.current;
    if (!owner?.active || owner.busy.has(slot)) return null;
    const id = Symbol(slot); owner.busy.set(slot, id);
    return { owner, epoch: owner.epoch, slot, id };
  };
  const currentMeetingAction = (action: MeetingUiAction) => action.owner.active && (meetingUiOwner.current === action.owner || meetingRecordingOwner.current === action.owner) && action.owner.epoch === action.epoch;
  const endMeetingAction = (action: MeetingUiAction) => { if (action.owner.busy.get(action.slot) === action.id) action.owner.busy.delete(action.slot); };
  const currentMeetingActive = (active: ActiveMeetingRecording) => {
    const scope = meetingActiveScopes.current.get(active), owner = meetingRecordingOwner.current;
    return !!scope && !!owner?.active && scope.owner === owner && scope.epoch === owner.epoch
      && (meetingRecordingRef.current === active || meetingFinalizingRef.current === active);
  };
  const observeMeetingLiveCancel = (sessionId: string) => {
    // Cleanup has no new cancel button/ACK UI. Always observe both rejection paths;
    // never turn a retired session's failure into a new recording's status.
    try { void desktop?.meetingCancelLiveTranscription?.({ sessionId }).then(result => {
      if (result.ok === false) console.warn('meeting_live_cancel_failed');
    }).catch(() => { console.warn('meeting_live_cancel_failed'); }); }
    catch { console.warn('meeting_live_cancel_failed'); }
  };
  useEffect(() => {
    const owner: MeetingUiOwner = { active: true, epoch: 0, busy: new Map() }; meetingUiOwner.current = owner;
    // Picker/import-save callbacks retire with the route; audio is not discarded.
    return () => { owner.active = false; ++owner.epoch; owner.busy.clear(); };
  }, [desktop, collectionId, isMeetingRecorderWindow]);
  useEffect(() => {
    const owner: MeetingUiOwner = { active: true, epoch: 0, busy: new Map() }; meetingRecordingOwner.current = owner;
    return () => {
      owner.active = false; ++owner.epoch; owner.busy.clear(); meetingFinalizingRef.current = null;
      const active = meetingRecordingRef.current;
      if (active) { if (active.liveTranscriptionSessionId) observeMeetingLiveCancel(active.liveTranscriptionSessionId); stopActiveMeetingRecording(active); meetingRecordingRef.current = null; }
    };
  }, [desktop]);

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
        if (!currentMeetingActive(active) || result?.ok === false) return;
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
      setCollectionsError('');
    } catch (error) { setCollectionsError(knowledgeFailureMessage(error, true)); }
  }, [desktop, knowledgeFailureMessage]);

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
      setSourcesError('');
    } catch (error) { setSourcesError(knowledgeFailureMessage(error, true)); }
  }, [desktop, knowledgeFailureMessage]);

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
      const active = meetingRecordingRef.current ?? meetingFinalizingRef.current;
      if (!active || !currentMeetingActive(active) || !active.liveTranscriptionSessionId || input.sessionId !== active.liveTranscriptionSessionId) return;
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
      if (sessionId) observeMeetingLiveCancel(sessionId);
      stopActiveMeetingRecording(meetingRecordingRef.current);
      meetingRecordingRef.current = null;
    }
  }, [desktop]);

  const handleCreateCollection = async () => {
    if (!desktop?.kbCreateCollection || !newCollectionName.trim()) return;
    setKnowledgeError('');
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
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!desktop?.kbDeleteCollection) return;
    if (!confirm(t.knowledge.deleteCollectionConfirm)) return;
    setKnowledgeError('');
    try {
      await desktop.kbDeleteCollection(id);
      if (collectionId === id) navigate('/knowledge');
      await loadCollections();
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const handleAddPasteSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !pasteText.trim()) return;
    setKnowledgeError('');
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
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const handleAddUrlSource = async () => {
    if (!desktop?.kbAddSource || !collectionId || !urlInput.trim()) return;
    setKnowledgeError('');
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
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const handleDeleteSource = async (id: string) => {
    if (!desktop?.kbDeleteSource || !collectionId) return;
    setKnowledgeError('');
    try {
      await desktop.kbDeleteSource(id);
      await loadSources(collectionId);
      await loadCollections();
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const handleOpenSource = async (source: KbSource) => {
    if (!desktop?.kbGetSourceContent) return;
    setSourceContent(null);
    setSourceContentError('');
    setSourceContentLoading(true);
    setKnowledgeError('');
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
      setSourceContentError(knowledgeFailureMessage(error, true));
    } finally {
      setSourceContentLoading(false);
    }
  };

  const handlePickFiles = async () => {
    if (!desktop?.kbPickFiles || !desktop?.kbAddSource || !collectionId) return;
    setKnowledgeError('');
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
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
  };

  const cleanupMeetingRecording = () => {
    const owner = meetingUiOwner.current; if (owner) { ++owner.epoch; owner.busy.clear(); }
    meetingFinalizingRef.current = null;
    if (meetingRecordingRef.current) {
      const sessionId = meetingRecordingRef.current.liveTranscriptionSessionId;
      if (sessionId) observeMeetingLiveCancel(sessionId);
      stopActiveMeetingRecording(meetingRecordingRef.current);
      meetingRecordingRef.current = null;
    }
    setMeetingRecording(false);
    setMeetingRecordingPaused(false);
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
  };

  const handleOpenMeetingImport = () => {
    cleanupMeetingRecording();
    setMeetingLiveFailure('');
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
    ++recorderModeGeneration.current;
    setMeetingRecorderView('workbench');
    setShowMeetingRecorder(true);
  };

  const runRecorderOperation = async (operation: () => Promise<{ ok: boolean; error?: string }> | undefined, saved = false): Promise<boolean> => {
    try {
      const result = await operation();
      if (result?.ok === true) return true;
      setMeetingWindowError(saved ? t.knowledge.meetingRecorderSavedFollowupFailed : recorderWindowErrorMessage(result?.error, t.knowledge));
    } catch {
      setMeetingWindowError(saved ? t.knowledge.meetingRecorderSavedFollowupFailed : t.knowledge.meetingRecorderOperationUnknown);
    }
    return false;
  };

  const handleOpenMeetingRecorder = async () => {
    if (!collectionId) return;
    setMeetingWindowError('');
    await runRecorderOperation(() => desktop?.meetingOpenRecorderWindow?.({ collectionId }));
  };

  const handleRecorderMode = async (mode: 'compact' | 'workbench') => {
    const generation = ++recorderModeGeneration.current;
    setMeetingWindowError('');
    const success = await runRecorderOperation(() => desktop?.meetingSetRecorderWindowMode?.({ mode }));
    if (success && generation === recorderModeGeneration.current) setMeetingRecorderView(mode);
  };

  const handleCloseMeetingRecorder = async () => {
    if (isMeetingRecorderWindow) {
      setMeetingWindowError('');
      if (!await runRecorderOperation(() => desktop?.meetingCloseRecorderWindow?.())) return;
    }
    cleanupMeetingRecording();
    replaceMeetingPreviewSegments([]);
    setMeetingSummaryDraft('');
    setMeetingDraftTranscript('');
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingSaving(false);
    setMeetingProcessing(false);
    setShowMeetingRecorder(false);
  };

  useEffect(() => {
    if (!isMeetingRecorderWindow) return;
    if (!meetingRecorderInitializedRef.current) {
      meetingRecorderInitializedRef.current = true;
      const carryingRecording = !!(meetingRecordingRef.current || meetingFinalizingRef.current
        || meetingRecordingOwner.current?.busy.has('start') || meetingSummaryDraftRef.current.trim());
      if (!carryingRecording) {
        initializeMeetingRecorder();
        void runRecorderOperation(() => desktop?.meetingSetRecorderWindowMode?.({ mode: 'workbench' }));
        void runRecorderOperation(() => desktop?.meetingSetRecorderSessionState?.({ state: 'idle' }));
      }
    }
    const unsubscribeClose = desktop?.onMeetingRecorderCloseRequested?.(() => {
      setMeetingMessage({ kind: 'error', text: t.knowledge.meetingRecorderCloseBlocked });
    });
    return () => { unsubscribeClose?.(); };
    // Mode/collection navigation preserves audio; mounted-consumer cleanup owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeetingRecorderWindow]);

  const handlePickMeetingAudio = async () => {
    if (!desktop?.meetingPickAudioFile) return;
    const action = beginMeetingAction('pick'); if (!action) return;
    try {
      const filePath = await desktop.meetingPickAudioFile();
      if (currentMeetingAction(action) && filePath) setMeetingAudioFilePath(filePath);
    } catch {
      if (currentMeetingAction(action)) setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingPickFailed });
    } finally { endMeetingAction(action); }
  };

  const handleStartMeetingRecording = async () => {
    setMeetingWindowError('');
    if (!desktop?.meetingSaveRecordedAudio || meetingRecordingOwner.current?.busy.has('start')) return;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingRecordUnavailable });
      return;
    }

    cleanupMeetingRecording();
    const action = beginMeetingAction('start'); if (!action) return;
    let pendingStream: MediaStream | null = null, pendingContext: AudioContext | null = null, pendingSession: string | null = null;
    let published = false;
    setMeetingLiveFailure('');
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
        if (!currentMeetingAction(action)) return;
        if (permission.status === 'denied' || permission.status === 'restricted') {
          setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingPermissionDenied });
          return;
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingStream = stream;
      if (!currentMeetingAction(action)) return;
      const liveEngine = meetingTranscriberEngineRef.current === 'aliyun-asr'
        || meetingTranscriberEngineRef.current === 'volcengine-asr'
        ? meetingTranscriberEngineRef.current
        : null;
      const audioContext = new AudioContextCtor(
        meetingTranscriberEngineRef.current === 'volcengine-asr' ? { sampleRate: 16_000 } : undefined,
      );
      pendingContext = audioContext;
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
            liveTranscriptionSessionId = result.sessionId; pendingSession = result.sessionId;
          } else {
            liveTranscriptionError = (result.ok === false ? result.error : undefined) ?? `${liveEngine}_live_failed`;
          }
        } catch (error) {
          liveTranscriptionError = error instanceof Error ? error.message : `${liveEngine}_live_failed`;
        }
      }

      if (!currentMeetingAction(action)) return;
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.15;
      const audioLevelData = new Float32Array(analyser.fftSize);
      gain.gain.value = 0;
      processor.onaudioprocess = event => {
        const active = meetingRecordingRef.current;
        if (!active || !currentMeetingActive(active) || active.paused) return;
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
            if (result.ok || !currentMeetingActive(active) || active.liveTranscriptionSessionId !== sessionId) return;
            active.liveTranscriptionSessionId = null;
            observeMeetingLiveCancel(sessionId);
            setMeetingLiveFailure(result.error ?? 'meeting_live_failed');
          }).catch(() => {
            if (!currentMeetingActive(active) || active.liveTranscriptionSessionId !== sessionId) return;
            active.liveTranscriptionSessionId = null;
            observeMeetingLiveCancel(sessionId);
            setMeetingLiveFailure('meeting_live_failed');
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
      published = true;
      meetingActiveScopes.current.set(meetingRecordingRef.current, { owner: action.owner, epoch: action.epoch });
      startMeetingAudioLevelSampling(meetingRecordingRef.current);
      scheduleMeetingPreviewTranscription(meetingRecordingRef.current);
      setMeetingRecording(true);
      setMeetingRecordingPaused(false);
      setMeetingElapsedMs(0);
      if (isMeetingRecorderWindow) {
        ++recorderModeGeneration.current;
        setMeetingRecorderView('workbench');
        void runRecorderOperation(() => desktop.meetingSetRecorderSessionState?.({ state: 'recording' }));
        void runRecorderOperation(() => desktop.meetingSetRecorderWindowMode?.({ mode: 'workbench' }));
      }
      if (liveTranscriptionError) setMeetingLiveFailure(liveTranscriptionError);
      setMeetingMessage({ kind: 'success', render: labels => labels.knowledge.meetingRecording });
    } catch {
      if (currentMeetingAction(action)) { cleanupMeetingRecording(); setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingRecordFailed('microphone_unavailable') }); }
    } finally {
      endMeetingAction(action);
      if (!published) {
        if (pendingSession) observeMeetingLiveCancel(pendingSession);
        pendingStream?.getTracks().forEach(track => track.stop());
        if (pendingContext) { try { void pendingContext.close().catch(() => { console.warn('meeting_audio_cleanup_failed'); }); } catch { console.warn('meeting_audio_cleanup_failed'); } }
      }
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
    setMeetingWindowError('');
    if (!desktop?.meetingSaveRecordedAudio || !meetingRecordingRef.current) return;
    const action = beginMeetingAction('stop'); if (!action) return;
    const active = meetingRecordingRef.current;
    meetingFinalizingRef.current = active;
    let summaryReady = false;
    meetingRecordingRef.current = null;
    setMeetingRecording(false);
    setMeetingRecordingPaused(false);
    setMeetingAudioLevels(createEmptyMeetingAudioLevels());
    setMeetingRecordingSaving(true);
    setMeetingMessage(null);
    if (isMeetingRecorderWindow) {
      ++recorderModeGeneration.current;
      setMeetingRecorderView('workbench');
      void runRecorderOperation(() => desktop.meetingSetRecorderSessionState?.({ state: 'processing' }));
      void runRecorderOperation(() => desktop.meetingSetRecorderWindowMode?.({ mode: 'workbench' }));
    }
    stopActiveMeetingRecording(active);

    try {
      if (active.liveTranscriptionSessionId && desktop.meetingFinishLiveTranscription) {
        const sessionId = active.liveTranscriptionSessionId;
        const finished = await desktop.meetingFinishLiveTranscription({ sessionId }).catch(() => ({ ok: false, error: 'meeting_live_failed' }));
        if (!currentMeetingAction(action)) return;
        active.liveTranscriptionSessionId = null;
        if (finished.ok === false) setMeetingLiveFailure(finished.error ?? 'meeting_live_failed');
      }
      await flushMeetingPreviewTranscription(active);
      if (!currentMeetingAction(action)) return;
      const title = readMeetingRecordingTitle();
      const wavBase64 = encodeFloat32ChunksToWavBase64(active.chunks, active.audioContext.sampleRate);
      const result = await desktop.meetingSaveRecordedAudio({ title, wavBase64 }) as { ok?: boolean; filePath?: string; error?: string };
      if (!currentMeetingAction(action)) return;
      if (result?.ok === false || !result?.filePath) {
        setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingRecordFailed(result?.error ?? 'unknown') });
        return;
      }
      setMeetingAudioFilePath(result.filePath);
      setMeetingMessage({ kind: 'success', render: labels => labels.knowledge.meetingRecordedAudioSaved });
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
          setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingProcessError('empty_transcription') });
          return;
        }
        setMeetingProcessing(true);
        setMeetingMessage({ kind: 'success', render: labels => labels.knowledge.meetingTranscribing });
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
        if (!currentMeetingAction(action)) return;
        if (draftResult?.ok === false) {
          setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingProcessError(draftResult.reason ?? draftResult.error ?? 'unknown') });
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
        setMeetingMessage({ kind: 'success', render: labels => labels.knowledge.meetingDraftReady });
        summaryReady = true;
        if (isMeetingRecorderWindow) {
          ++recorderModeGeneration.current;
          setMeetingRecorderView('summary');
          void runRecorderOperation(() => desktop.meetingSetRecorderSessionState?.({ state: 'summary' }));
          void runRecorderOperation(() => desktop.meetingSetRecorderWindowMode?.({ mode: 'summary' }));
          void runRecorderOperation(() => desktop.meetingNotifyRecorderSummaryReady?.({ title: finalTitle }));
        }
      }
    } catch {
      if (currentMeetingAction(action)) setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingRecordFailed('unknown') });
    } finally {
      if (currentMeetingAction(action)) {
      setMeetingRecordingSaving(false);
      setMeetingProcessing(false);
      if (isMeetingRecorderWindow && !summaryReady) {
        void runRecorderOperation(() => desktop.meetingSetRecorderSessionState?.({ state: 'idle' }));
      }
      }
      if (meetingFinalizingRef.current === active) meetingFinalizingRef.current = null;
      endMeetingAction(action);
    }
  };

  const handleSaveMeetingTranscript = async () => {
    if (!desktop?.meetingSaveTranscript || !collectionId || !meetingAudioFilePath || !meetingTranscript.trim()) return;
    const action = beginMeetingAction('save'); if (!action) return;
    setMeetingSaving(true);
    setMeetingMessage(null);
    const submitted = { ...meetingImportDraftRef.current };
    const title = meetingTitleRef.current.trim() || selectedCollection?.name || t.knowledge.meetingDefaultTitle;
    try {
      const result = await desktop.meetingSaveTranscript({
        collectionId,
        title,
        audioFilePath: meetingAudioFilePath,
        transcript: meetingTranscript.trim(),
      }) as { ok?: boolean; error?: string };
      if (!currentMeetingAction(action)) return;
      if (result?.ok === false) {
        setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingImportError(result.error ?? 'unknown') });
        return;
      }
      const latest = meetingImportDraftRef.current;
      if (latest.collectionId !== submitted.collectionId || latest.title !== submitted.title || latest.audioFilePath !== submitted.audioFilePath || latest.transcript !== submitted.transcript) { setMeetingMessage({kind:'error',render:labels=>labels.knowledge.meetingRecorderNewDraftUnsaved}); return; }
      setMeetingTranscript('');
      setMeetingAudioFilePath('');
      setShowMeetingImport(false);
      if (!currentMeetingAction(action)) return;
      await loadSources(collectionId);
      if (!currentMeetingAction(action)) return;
      await loadCollections();
    } catch {
      if (currentMeetingAction(action)) setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingImportError('unknown') });
    } finally {
      endMeetingAction(action);
      if (currentMeetingAction(action)) setMeetingSaving(false);
    }
  };

  const readRecorderSubmission = () => {
    const summary = meetingSummaryDraftRef.current.trim();
    const transcript = meetingDraftTranscriptRef.current.trim();
    return { collectionId: collectionId ?? '', title: readMeetingRecordingTitle(), audioFilePath: meetingAudioFilePathRef.current,
      transcript: transcript ? `${summary}\n\n## 逐字转写\n\n${transcript}` : summary };
  };
  const sameRecorderSubmission = (left: ReturnType<typeof readRecorderSubmission>, right: ReturnType<typeof readRecorderSubmission>) => (
    left.collectionId === right.collectionId && left.title === right.title && left.audioFilePath === right.audioFilePath && left.transcript === right.transcript
  );
  const handleSaveMeetingRecordingDraft = async () => {
    if (!desktop?.meetingSaveTranscript || !collectionId || !meetingAudioFilePath || !meetingSummaryDraft.trim() || meetingSaving) return;
    const action = beginMeetingAction('save'); if (!action) return;
    setMeetingSaving(true);
    setMeetingMessage(null);
    setMeetingWindowError('');
    const submission = readRecorderSubmission();
    try {
      let saved = recorderSavedSubmission.current;
      if (!isMeetingRecorderWindow || !saved || !sameRecorderSubmission(saved, submission)) {
        const result = await desktop.meetingSaveTranscript(submission) as { ok?: boolean; error?: string };
        if (!currentMeetingAction(action)) return;
        if (result?.ok !== true) {
          setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingImportError(result?.error ?? 'unknown') });
          return;
        }
        saved = { ...submission, notified: false };
        if (isMeetingRecorderWindow) recorderSavedSubmission.current = saved;
      }
      if (!currentMeetingAction(action)) return;
      if (isMeetingRecorderWindow) {
        if (!sameRecorderSubmission(submission, readRecorderSubmission())) {
          setMeetingWindowError(t.knowledge.meetingRecorderNewDraftUnsaved); return;
        }
        if (!saved.notified) {
          if (!await runRecorderOperation(() => desktop.meetingNotifyRecordingSaved?.({ collectionId: submission.collectionId }), true)) return;
          if (!currentMeetingAction(action)) return;
          saved.notified = true;
        }
        if (!sameRecorderSubmission(submission, readRecorderSubmission())) {
          setMeetingWindowError(t.knowledge.meetingRecorderNewDraftUnsaved); return;
        }
        await runRecorderOperation(() => desktop.meetingCloseRecorderWindow?.(), true);
        return;
      }
      setMeetingSummaryDraft('');
      setMeetingDraftTranscript('');
      setMeetingAudioFilePath('');
      replaceMeetingPreviewSegments([]);
      setShowMeetingRecorder(false);
      if (!currentMeetingAction(action)) return;
      await loadSources(collectionId);
      if (!currentMeetingAction(action)) return;
      await loadCollections();
    } catch {
      if (currentMeetingAction(action)) setMeetingMessage({ kind: 'error', render: labels => labels.knowledge.meetingImportError('unknown') });
    } finally {
      endMeetingAction(action);
      if (currentMeetingAction(action)) setMeetingSaving(false);
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
      setSearchError('');
    } catch (error) { setSearchError(knowledgeFailureMessage(error, true)); }
    setSearching(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!desktop?.kbAddSource || !collectionId) return;
    setKnowledgeError('');
    try {
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
  
    } catch (error) { setKnowledgeError(knowledgeFailureMessage(error)); }
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
        message={meetingWindowError ? { kind: 'error', text: meetingWindowError } : meetingMessage}
        onStartRecording={() => void handleStartMeetingRecording()}
        onPauseRecording={handlePauseMeetingRecording}
        onResumeRecording={handleResumeMeetingRecording}
        onFinishRecording={() => void handleStopMeetingRecording({ draftRecording: true })}
        onCompact={() => void handleRecorderMode('compact')}
        onExpand={() => void handleRecorderMode('workbench')}
        onSaveDraft={() => void handleSaveMeetingRecordingDraft()}
        onCancel={() => void handleCloseMeetingRecorder()}
      />
    );
  }

  const knowledgeNoticeText = collectionsError || sourcesError || searchError || (!showCreateDialog ? knowledgeError : '') || meetingWindowError;
  const knowledgeFailureNotice = knowledgeNoticeText ? (
    <div role="alert" className="m-4 rounded-lg border border-[var(--c-border-subtle)] p-3 text-sm text-[var(--c-status-error-text)]">
      <p>{knowledgeNoticeText}</p>
      <button type="button" onClick={() => { void loadCollections(); if (collectionId) void loadSources(collectionId); }} className="mt-2 rounded-md border border-[var(--c-border-subtle)] px-2 py-1 text-xs">{t.knowledge.refreshData}</button>
    </div>
  ) : null;
  if (!loading && collections.length === 0 && collectionsError) return (
    <div className="flex h-full min-h-0 flex-col">
      {knowledgeFailureNotice}
      {showCreateDialog && <CreateCollectionDialog key="knowledge-create" error={knowledgeError} name={newCollectionName} setName={setNewCollectionName} onCreate={handleCreateCollection} onCancel={() => setShowCreateDialog(false)} />}
    </div>
  );

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
        {showCreateDialog && <CreateCollectionDialog key="knowledge-create" error={knowledgeError} name={newCollectionName} setName={setNewCollectionName} onCreate={handleCreateCollection} onCancel={() => setShowCreateDialog(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--c-bg-page)]">
      {knowledgeFailureNotice}
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
              {sources.length === 0 && !sourcesError ? (
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
          key="knowledge-create"
          error={knowledgeError}
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

function SourceKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'url': return <Globe size={16} className="shrink-0 text-blue-500" />;
    case 'paste': return <ClipboardPaste size={16} className="shrink-0 text-green-600" />;
    case 'meeting': return <Mic size={16} className="shrink-0 text-purple-500" />;
    default: return <FileText size={16} className="shrink-0 text-[var(--c-text-icon)]" />;
  }
}

function CreateCollectionDialog({ name, setName, onCreate, onCancel, error }: {
  name: string;
  setName: (v: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  error?: string;
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
        {error && <p role="alert" className="mb-3 text-xs text-[var(--c-status-error-text)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">{t.knowledge.cancel}</button>
          <button type="button" onClick={onCreate} disabled={!name.trim()} className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{t.knowledge.createBtn}</button>
        </div>
      </div>
    </div>
  );
}
