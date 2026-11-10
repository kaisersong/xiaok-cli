import type {AssistantMessage} from '../../../shared/assistant-inbox-contract';
import {mergeAssistantMessages} from '../lib/assistant-message-timeline';
import {isTaskExecutionInterruption} from '../../../shared/task-interruption';
import {readTaskInterruption, type InterruptedTask} from '../lib/interrupted-task';
import {pendingTaskQuestion} from '../lib/pending-task-question';
import { isAssistantThread,ASSISTANT_CHAT_THREAD } from '../../../shared/assistant-inbox-contract';
import { AssistantWorkOutbox } from './assistant/AssistantWorkOutbox';
import {emptyNativeQuestionPresentation,nativeQuestionNamespace,nativeQuestionPresentationFromSnapshot,reduceNativeQuestionPresentation,type NativeQuestionPresentation} from '../lib/native-question-state.js';
import type {UserTaskSubmissionInput} from '../../../shared/user-task-submission-contract.js';
import { ObservationControls, type ObservationCommandHandle } from './ObservationControls';
import type {ConversationQueueView} from '../../../shared/conversation-inputs';
import type { TaskEventCoordinate } from '../../../shared/context-continuity-types';
import { publicTaskMessageKey } from '../../../shared/context-continuity-projection';
import { ConversationActivityPanel } from './ConversationActivityPanel';
import {questionOutsideNativeActivity,type NativeActivityCoverage} from './NativeWorkControls';
import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ArtifactOpenInfo, type ArtifactOpenOptions, type ChatMessage, type ComputerUseActionData, type GeneratedFile, type ToolStep } from './ChatView';
import { GoalBar } from './GoalBar';
import type { DesktopGoalControlReceipt, DesktopGoalMutationResult, DesktopGoalProjection, DesktopGoalTaskPrepared, DesktopGoalNativeMutationProjection } from '../../../electron/preload-api';
import type { GoalCreationInput } from '../../../shared/host-observation-types';
import { attachPreparedGoalTask } from '../lib/goal-task-attachment';
import { CanvasPanel } from './CanvasPanel';
import { TaskPanel } from './TaskPanel';
import { ChatRightSurface } from './ChatRightSurface';
import { MultiAgentPanel } from './MultiAgentPanel';
import { useMultiAgentConnection } from '../hooks/useMultiAgentConnection';
import type { ThreadRecord } from '../api/types';
import { separateAssistantNarration, projectNarrationSummary, pendingNarration } from '../lib/assistant-narration';
import { inlineUiKey, isInlineUiArtifact } from '../lib/inline-ui';
import { ChatTaskApprovals } from './ChatTaskApprovals';
import type { ArtifactKind, ArtifactSummary, DesktopTaskEvent, NeedsUserQuestion, TaskResult, TaskSnapshot } from '../../../shared/task-types';
import type { ArtifactWorkspaceSelectedArtifact } from '../../../shared/artifact-workspace-types';
import { useSidebarCollapse } from '../layouts/AppLayout';
import { useLocale } from '../contexts/LocaleContext';
import { isRepetitionStopEvent, sanitizeUserFacingErrorMessage } from '../lib/error-display';
import { parseScheduledTaskPromptDisplay } from '../lib/scheduled-task-prompt-display';
import { recoverForDisplay } from '../lib/recover-for-display';
import type { TaskPublicPresentation } from '../../../shared/task-history';
import { fileBasename, isAbsoluteFilePath, toFileUrl } from '../lib/file-path';
import { getDesktopApi } from '../shared/desktop';
import { getStreamingRenderDelay } from '../lib/streaming-render-policy';
import { parseComputerUseRecoverableAction, resolveComputerUseUserAction } from '../lib/computer-use-recoverable-action';
import {
  buildProjectCardMessageFromToolResult,
  buildRoomCardMessageFromToolResult,
  buildWorkflowMessageFromToolResult,
  type WorkflowLabels,
} from './chatToolResultMessages';

const log = createLogger('ChatShell');
const ARTIFACT_KINDS = new Set<ArtifactKind>(['pptx', 'pdf', 'docx', 'xlsx', 'html', 'image', 'text', 'a2ui', 'other']);
const THREAD_DRAFT_STORAGE_PREFIX = 'xiaok.threadDraft.';
const HISTORY_PAGE_SIZE = 20;
const LEGACY_SWARM_CONTEXT_KEY = 'xiaok.swarmContinueContext';

function settleChatProgress(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(message => message.role !== 'progress' || message.stage === 'completed' || message.stage === 'failed')
    .map(message => message.role === 'tool_steps' && message.stepsLive ? { ...message, stepsLive: false } : message);
}

interface StoredThreadDraft {
  threadId?: string;
  projectId?: string;
  projectName?: string;
  draftPrompt?: string;
  [key: string]: unknown;
}

interface DisplayFileRef {
  filePath?: string;
  name?: string;
  originalName?: string;
}

interface DisplayScope { taskId: string | undefined; attachmentObservers: Set<() => void> }
interface GoalAttempt { scope: DisplayScope; requestId?: string }
interface DisplaySource {
  scope: DisplayScope;
  sourceTaskId: string;
  lastErrorMessage?: string;
  intentOwner: GoalAttempt | null;
  executionScope?: TaskSnapshot['executionScope'];
  eventCount: number;
  uiPreviewClosed?: boolean;
  inlineUiArtifacts?: Set<string>;
  inlineUiPreviewKeys?: Set<string>;
  inlineUiNarrationCommitted?: boolean;
  terminalSeen: boolean;
  streamEnded: boolean;
  resultSummaryInHistory?: string;
  questions?: NativeQuestionPresentation;
  release?: () => void;
}
interface GoalAttachmentWork {
  attempt: GoalAttempt;
  prepared: DesktopGoalTaskPrepared;
  source: DisplaySource;
  ackInvoked: boolean;
  readUsed: boolean;
  promise: Promise<void>;
}

function normalizeArtifactKind(kind: string): ArtifactKind {
  return ARTIFACT_KINDS.has(kind as ArtifactKind) ? kind as ArtifactKind : 'other';
}

function artifactSummaryFromEvent(
  event: Extract<DesktopTaskEvent, { type: 'artifact_recorded' }>,
  sourceTaskId?: string,
): ArtifactSummary {
  return {
    artifactId: event.artifactId,
    sourceTaskId,
    kind: normalizeArtifactKind(event.kind),
    title: event.label,
    createdAt: event.turnId,
    previewAvailable: event.previewAvailable,
    filePath: event.filePath,
    mimeType: event.mimeType,
    creator: event.creator ?? 'agent',
  };
}

function bindArtifactsToSourceTask(result: TaskResult, sourceTaskId?: string): TaskResult {
  if (!sourceTaskId || result.artifacts.length === 0) return result;
  return {
    ...result,
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      sourceTaskId: artifact.sourceTaskId ?? sourceTaskId,
    })),
  };
}

function mergeTaskResultArtifacts(result: TaskResult, artifacts: ArtifactSummary[]): TaskResult {
  if (artifacts.length === 0) return result;
  const merged = [...(result.artifacts || [])];
  const seen = new Set(merged.map((artifact) => artifact.artifactId || artifact.filePath || artifact.title));
  for (const artifact of artifacts) {
    const key = artifact.artifactId || artifact.filePath || artifact.title;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(artifact);
  }
  return { ...result, artifacts: merged };
}

function readStoredThreadDraft(threadId: string | undefined): StoredThreadDraft | null {
  if (!threadId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${THREAD_DRAFT_STORAGE_PREFIX}${threadId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredThreadDraft;
    return typeof parsed?.draftPrompt === 'string' && parsed.draftPrompt.trim() ? parsed : null;
  } catch {
    return null;
  }
}

function readLegacySwarmDraftForThread(thread: ThreadRecord): StoredThreadDraft | null {
  if (typeof window === 'undefined') return null;
  const title = thread.title || '';
  if (!title.startsWith('让小K帮忙')) return null;
  try {
    const raw = window.sessionStorage.getItem(LEGACY_SWARM_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredThreadDraft;
    const draftPrompt = typeof parsed?.draftPrompt === 'string' ? parsed.draftPrompt.trim() : '';
    const projectName = typeof parsed?.projectName === 'string' ? parsed.projectName.trim() : '';
    if (!draftPrompt || !projectName || !title.includes(projectName)) return null;
    return { ...parsed, draftPrompt };
  } catch {
    return null;
  }
}

function writeStoredThreadDraft(threadId: string, draft: StoredThreadDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${THREAD_DRAFT_STORAGE_PREFIX}${threadId}`, JSON.stringify({
      ...draft,
      threadId,
    }));
  } catch {
    // Local storage is a convenience cache; route state still carries fresh drafts.
  }
}

function displayNameFromFileRef(file: DisplayFileRef): string | undefined {
  const raw = file.name || file.originalName || file.filePath;
  if (!raw) return undefined;
  return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
}

function formatUserMessageContent(prompt: string, files?: DisplayFileRef[], attachmentLabel = '附件:'): string {
  const fileNames = (files ?? [])
    .map(displayNameFromFileRef)
    .filter((name): name is string => Boolean(name));
  if (fileNames.length === 0) return prompt;
  return `${prompt}\n\n${attachmentLabel} ${fileNames.join(', ')}`;
}

function addGeneratedFile(target: GeneratedFile[], seen: Set<string>, fp: string | undefined): void {
  if (!fp || seen.has(fp)) return;
  seen.add(fp);
  target.push({ filePath: fp, name: fileBasename(fp) });
}

function collectGeneratedFilesFromEvents(events: DesktopTaskEvent[]): GeneratedFile[] {
  const seen = new Set<string>();
  const files: GeneratedFile[] = [];
  for (const e of events) {
    if (e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write') {
      addGeneratedFile(files, seen, ((e as unknown) as { input?: { file_path?: string } }).input?.file_path);
    }
  }
  return files;
}

function collectGeneratedFilesFromTexts(texts: string[]): GeneratedFile[] {
  const seen = new Set<string>();
  const files: GeneratedFile[] = [];
  for (const text of texts) {
    const fileExtMatch = /`?([^\s<`"'|]+?\.(?:md|html|txt|csv|json|pdf|png|jpg|svg|pptx|docx|xlsx))`?\b/g;
    let match;
    while ((match = fileExtMatch.exec(text)) !== null) {
      const candidate = match[1];
      if (isAbsoluteFilePath(candidate)) addGeneratedFile(files, seen, candidate);
    }
  }
  return files;
}

function collectGeneratedFilesForTurn(events: DesktopTaskEvent[], texts: string[]): GeneratedFile[] {
  const seen = new Set<string>();
  const files: GeneratedFile[] = [];
  for (const file of collectGeneratedFilesFromEvents(events)) addGeneratedFile(files, seen, file.filePath);
  const narration = events.flatMap(event => event.type === 'assistant_delta' ? [event.delta] : []).join('');
  for (const file of collectGeneratedFilesFromTexts([...texts, narration])) addGeneratedFile(files, seen, file.filePath);
  return files;
}

function buildResultCardMessage(input: {
  idHint: string;
  result: TaskResult | null;
  generatedFiles: GeneratedFile[];
}): ChatMessage | null {
  const hasSummary = Boolean(input.result?.summary?.trim());
  const hasArtifacts = Boolean(input.result?.artifacts && input.result.artifacts.length > 0);
  if (!hasSummary && !hasArtifacts && input.generatedFiles.length === 0) return null;
  return {
    id: `msg-result-${input.idHint}`,
    role: 'result_card',
    content: '',
    result: input.result,
    generatedFiles: input.generatedFiles,
  };
}

async function createGoalAwareTaskWithRetry<T>(action: () => Promise<T>): Promise<T> {
  const delays = [50, 100, 200];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/goal_user_turn_waiting_for_preemption/.test(message) || attempt >= delays.length) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}

export function ChatShell({ threadId, emptyContent, conversationHeader, assistantContent, assistantHasMessages, assistantMessages, assistantFocusKey, onAssistantFocusHandled, draftRequest, hideObservationControls }: {
  threadId?: string;
  emptyContent?: React.ReactNode;
  conversationHeader?: React.ReactNode;
  assistantContent?: React.ReactNode;
  assistantHasMessages?: boolean;
  assistantMessages?:AssistantMessage[];
  assistantFocusKey?: string;
  onAssistantFocusHandled?:()=>void;
  draftRequest?: { id: number; text: string };
  hideObservationControls?: boolean;
} = {}) {
  const { taskId: routeTaskId } = useParams<{ taskId: string }>();
  const taskId = threadId ?? routeTaskId;
  const renderScope = useMemo<DisplayScope>(() => ({ taskId, attachmentObservers: new Set<() => void>() }), [taskId]);
  const liveRenderScope = useRef<typeof renderScope | null>(renderScope);
  const admissionPending = useRef<typeof renderScope | null>(null);
  useLayoutEffect(() => {
    liveRenderScope.current = renderScope;
    setGoal(null);
    setGoalControl(null);
    goalReadBarrier.current = null;
    return () => {
      liveRenderScope.current = null;
      for (const release of renderScope.attachmentObservers) release();
      renderScope.attachmentObservers.clear();
      if (goalAttemptRef.current?.scope === renderScope) goalAttemptRef.current = null;
      if (displaySourceRef.current?.scope === renderScope) displaySourceRef.current = null;
      for (const [id, work] of attachmentWorksRef.current) {
        if (work.attempt.scope === renderScope) attachmentWorksRef.current.delete(id);
      }
    };
  }, [renderScope]);
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarCollapse = useSidebarCollapse();
  const { t } = useLocale();
  const observationCommands = useRef<ObservationCommandHandle>(null);
  const [observationDraft, setObservationDraft] = useState<string|null>(null);
  useEffect(()=>setObservationDraft(null),[taskId]);
  const [agentHistory, setAgentHistory] = useState<{ threadId: string; groupId?: string } | null>(null);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const sidebarWasCollapsedRef = useRef(false);
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  // Wait for the bound task before choosing its execution-state subscription.
  // Native Codex events already arrive through the standard task stream.
  const multiAgent = useMultiAgentConnection(taskId, agentHistory?.threadId === taskId ? agentHistory?.groupId : undefined,
    thread?.id === taskId && !thread?.currentTaskId?.startsWith('task_codex_'));
  const [repetitionStopped, setRepetitionStopped] = useState(false);
  const repetitionRequestRef = useRef<{ text: string; files?: Array<{ filePath: string; name: string }> } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const olderHistoryRef = useRef<{ remaining: string[]; loading: boolean }>({ remaining: [], loading: false });
  const [olderHistory, setOlderHistory] = useState({ remaining: 0, loading: false, error: '' });
  const assistantTimeline=useMemo(()=>taskId===ASSISTANT_CHAT_THREAD&&assistantMessages?mergeAssistantMessages(messages,assistantMessages):messages,[taskId,messages,assistantMessages]);
  const [streamingText, setStreamingText] = useState('');
  const [uiPreviews, setUiPreviews] = useState<Array<{ toolUseId: string; sourceTaskId: string; title: string; content: string }>>([]);
  const clearUiPreviews = useCallback(() => {
    displaySourceRef.current?.inlineUiPreviewKeys?.clear();
    setUiPreviews([]);
    setMessages(previous => previous.filter(message => !message.uiCard?.previewToolUseId));
  }, []);
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [interruptedTask, setInterruptedTask] = useState<InterruptedTask | null>(null);
  const [nativeActivityCoverage,setNativeActivityCoverage]=useState<NativeActivityCoverage|null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [goal, setGoal] = useState<DesktopGoalProjection | null>(null);
  const [goalNativeMutation, setGoalNativeMutation] = useState<DesktopGoalNativeMutationProjection | null>(null);
  const [goalControl, setGoalControl] = useState<DesktopGoalControlReceipt | null>(null);
  const goalReadBarrier = useRef<{ attempt: GoalAttempt; sequence: number } | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState<{ scope: DisplayScope; attempt: GoalAttempt } | null>(null);
  const [goalLoading, setGoalLoading] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [canvasPreviewFile, setCanvasPreviewFile] = useState<string | undefined>();
  const [canvasPreviewContent, setCanvasPreviewContent] = useState<string | undefined>();
  const [canvasSourceArtifact, setCanvasSourceArtifact] = useState<ArtifactWorkspaceSelectedArtifact | undefined>();
  const [canvasPreviewModeRequest, setCanvasPreviewModeRequest] = useState({ id: 0, startInEditMode: false });
  // Canvas is per-session: it must close when switching to another conversation
  // and reopen only when returning to the session that opened it. Keyed by taskId.
  const canvasStateByTaskRef = useRef<Map<string, {
    open: boolean;
    expanded: boolean;
    file?: string;
    content?: string;
    sourceArtifact?: ArtifactWorkspaceSelectedArtifact;
  }>>(new Map());
  const prevCanvasTaskRef = useRef<string | undefined>(undefined);
  const [planSteps, setPlanSteps] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    text: string;
    files: Array<{ filePath: string; name: string }>;
    inputId?:string;durable?:boolean;
  } | null>(null);
  const goalAttemptRef = useRef<GoalAttempt | null>(null);
  const displaySourceRef = useRef<DisplaySource | null>(null);
  const attachmentWorksRef = useRef(new Map<string, GoalAttachmentWork>());
  const initializationRef = useRef<{ scope: DisplayScope; promise: Promise<void>; succeeded: boolean } | null>(null);
  const threadRef = useRef(thread);
  threadRef.current = thread ?? threadRef.current;
  const resultRef = useRef(result);
  resultRef.current = result;
  const acceptsSource = useCallback((source: DisplaySource) => liveRenderScope.current === source.scope && displaySourceRef.current === source, []);
  const currentAttempt = useCallback((attempt: GoalAttempt) => liveRenderScope.current === attempt.scope && goalAttemptRef.current === attempt, []);
  const beginGoalAttempt = useCallback((request = false) => {
    const attempt: GoalAttempt = { scope: renderScope, ...(request ? { requestId: crypto.randomUUID() } : {}) };
    goalAttemptRef.current = attempt;
    if (goalReadBarrier.current?.attempt.scope === renderScope) goalReadBarrier.current = { attempt, sequence: 0 };
    return attempt;
  }, [renderScope]);
  const [queueFailure,setQueueFailure]=useState<{scope:DisplayScope;message:string}|null>(null);
  const durableQueueRows=useRef<ConversationQueueView['items']>([]);
  const durableQueueRefresh=useRef<()=>Promise<void>>(async()=>{});
  const durableQueueRequest=useRef<{scope:DisplayScope;key:string;inputId:string;pending:boolean}|null>(null);
  const queuedDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef('');
  const streamRafRef = useRef<number | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamLastRenderedAtRef = useRef<number | null>(null);
  const flushStreamingText = (source: DisplaySource) => {
    if (!acceptsSource(source)) return;
    if (streamRafRef.current !== null || streamTimerRef.current !== null) return;
    const delay = getStreamingRenderDelay(streamLastRenderedAtRef.current, performance.now());
    if (delay > 0) {
      streamTimerRef.current = setTimeout(() => {
        if (!acceptsSource(source)) return;
        streamTimerRef.current = null;
        flushStreamingText(source);
      }, delay);
      return;
    }
    streamRafRef.current = requestAnimationFrame((renderedAt) => {
      if (!acceptsSource(source)) return;
      streamRafRef.current = null;
      streamLastRenderedAtRef.current = renderedAt;
      setStreamingText(streamRef.current);
    });
  };
  const cancelStreamingFlush = () => {
    if (streamRafRef.current !== null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamLastRenderedAtRef.current = null;
  };
  const currentLoadIdRef = useRef<string | null>(null);
  const mountGenRef = useRef(0);
  const allEventsRef = useRef<DesktopTaskEvent[]>([]);
  const currentTaskEventsRef = useRef<DesktopTaskEvent[]>([]);
  const toolStepsMsgIdRef = useRef<string | null>(null);
  const toolStepsActiveRef = useRef(false);
  const computerUseActionCodesRef = useRef<Set<string>>(new Set());
  const titleLockedRef = useRef(false);
  const lastLiveErrorRef = useRef<{ taskKey: string; rawMessage: string } | null>(null);
  // Read prompt state from navigation (WelcomePage initial submit or project help draft)
  const state = location.state as { initialPrompt?: string; initialFiles?: DisplayFileRef[]; draftPrompt?: string; createGoal?: boolean } | undefined;
  const initialPrompt = state?.initialPrompt;
  const initialFiles = state?.initialFiles;
  const draftPrompt = state?.draftPrompt;

  useEffect(() => {
    if (draftRequest) setPrompt(draftRequest.text);
  }, [draftRequest]);

  const handleEvent = useCallback((rawEvent: { type: string }, source: DisplaySource, coordinate?: TaskEventCoordinate) => {
    const event = rawEvent as DesktopTaskEvent;
    if (!acceptsSource(source) || source.streamEnded) return;
    if (coordinate && coordinate.taskId !== source.sourceTaskId) return;
    source.eventCount = coordinate ? coordinate.eventIndex + 1 : source.eventCount + 1;
    const sourceTaskId = source.sourceTaskId;
    const publicEventMessageKey = coordinate ? publicTaskMessageKey('assistant', coordinate.eventIndex) : undefined;
    const live = !source.terminalSeen;
    const commitInlinePrefix = () => {
      const text = streamRef.current;
      streamRef.current = '';
      cancelStreamingFlush();
      setStreamingText('');
      if (!text.trim()) return;
      source.inlineUiNarrationCommitted = true;
      setMessages(previous => [...previous, { id: `inline-prefix:${sourceTaskId}:${source.eventCount}`, role: 'assistant', content: text }]);
    };
    if (event.type === 'ui_preview') {
      if (!live || source.uiPreviewClosed) return;
      if (event.preview) {
        const id = `inline-preview:${JSON.stringify([sourceTaskId, event.toolUseId])}`;
        source.inlineUiPreviewKeys ??= new Set();
        if (!source.inlineUiPreviewKeys.has(id)) {
          source.inlineUiPreviewKeys.add(id);
          commitInlinePrefix();
        }
        setMessages(previous => previous.some(message => message.id === id) ? previous : [...previous,
          { id, role: 'ui_card', content: '', uiCard: { previewToolUseId: event.toolUseId, sourceTaskId } }]);
      } else {
        if (event.toolUseId === 'all') source.inlineUiPreviewKeys?.clear();
        else source.inlineUiPreviewKeys?.delete(`inline-preview:${JSON.stringify([sourceTaskId, event.toolUseId])}`);
        setMessages(previous => previous.filter(message => !(message.uiCard?.previewToolUseId
          && message.uiCard.sourceTaskId === sourceTaskId && (event.toolUseId === 'all' || message.uiCard.previewToolUseId === event.toolUseId))));
      }
      setUiPreviews(previous => event.preview
        ? [...previous.filter(item => item.toolUseId !== event.toolUseId), { toolUseId: event.toolUseId, sourceTaskId, ...event.preview }]
        : event.toolUseId === 'all' ? [] : previous.filter(item => item.toolUseId !== event.toolUseId));
      return;
    }
    if (event.type === 'result' || event.type === 'task_cancelled' || event.type === 'error') {
      source.uiPreviewClosed = true;
      clearUiPreviews();
    }
    if (event.type === 'execution_health' && event.state === 'recovering') clearUiPreviews();
    if (event.type === 'task_terminal') {
      clearUiPreviews();
      source.questions=emptyNativeQuestionPresentation();
      source.terminalSeen = true;
      source.streamEnded = true;
      setCurrentQuestion(null);
      setMessages(settleChatProgress);
      setStatus(event.status === 'cancelled' ? 'idle' : event.status);
      if (event.status === 'failed' && isTaskExecutionInterruption(source.lastErrorMessage)) {
        const terminalEventCount = source.eventCount;
        void api.recoverTask(sourceTaskId).then(({snapshot}) => {
          if (!acceptsSource(source) || source.eventCount !== terminalEventCount) return;
          setInterruptedTask(readTaskInterruption(snapshot, {taskId: sourceTaskId, threadId: source.scope.taskId ?? ''}));
        }).catch(() => {}); // A closing app may no longer answer; history restore retries on next open.
      }
      source.release?.();
      return;
    }
    if (!live && (event.type === 'progress' || event.type === 'needs_user' || event.type === 'question_resolved' || event.type === 'task_started')) return;

    const eventTaskKey = sourceTaskId ?? taskId ?? '';
    if (event.type !== 'error' || lastLiveErrorRef.current?.taskKey !== eventTaskKey) {
      lastLiveErrorRef.current = null;
    }

    // Collect all events for Canvas
    allEventsRef.current = [...allEventsRef.current, event];
    currentTaskEventsRef.current = [...currentTaskEventsRef.current, event];
    source.questions=reduceNativeQuestionPresentation(source.questions??emptyNativeQuestionPresentation(),event,sourceTaskId);

    switch (event.type) {
      case 'task_started': {
        setRepetitionStopped(false);
        setPlanSteps([]);
        break;
      }
      case 'progress_plan_reported': {
        const ev = event as { type: 'progress_plan_reported'; steps: Array<{ id: string; label: string; status: string }> };
        setPlanSteps(ev.steps);
        break;
      }
      case 'execution_health': {
        if (!live) break;
        setMessages(prev => [...prev.filter(m => m.role !== 'progress'), {id:'execution-health',role:'progress',content:t.executionHealth[event.state],stage:event.state}]);
        break;
      }
      case 'progress': {
        const prog = (event as { type: 'progress'; message: string; stage?: string; eventId: string });
        // Suppress tool-related progress when tool_steps is active
        if ((prog.stage === 'tool' || prog.stage === 'completed' || prog.stage === 'failed') && toolStepsActiveRef.current) {
          break;
        }
        setMessages(prev => {
          const filtered = prev.filter(m => m.role !== 'progress');
          return [...filtered, {
            id: `msg-progress-${prog.eventId}`,
            role: 'progress',
            content: prog.message,
            stage: prog.stage,
          }];
        });
        setStatus(source.questions?.native.length?'waiting_user':'running');
        break;
      }
      case 'assistant_delta': {
        const delta = (event as { type: 'assistant_delta'; delta: string }).delta;
        streamRef.current += delta;
        flushStreamingText(source);
        if (live) setStatus(source.questions?.native.length?'waiting_user':'running');
        break;
      }
      case 'task_cancelled': {
        setMessages(settleChatProgress);
        const partialText = pendingNarration(streamRef.current, event.partialText ?? '', currentTaskEventsRef.current, Boolean(source.inlineUiNarrationCommitted));
        streamRef.current = '';
        cancelStreamingFlush();
        setStreamingText('');
        clearUiPreviews();
        if (partialText.trim()) {
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}-assistant-cancelled`,
              contextSource: publicEventMessageKey ? { sourceId: sourceTaskId, sourceMessageId: publicEventMessageKey } : undefined,
            role: 'assistant',
            content: partialText,
          }]);
        }
        setCurrentQuestion(null);
        if (live) setStatus('idle');
        break;
      }
      case 'artifact_recorded': {
        const artifact = artifactSummaryFromEvent(event, sourceTaskId);
        if (isInlineUiArtifact(artifact)) {
          const key = inlineUiKey(artifact);
          source.inlineUiArtifacts ??= new Set();
          if (!source.inlineUiArtifacts.has(key)) {
            source.inlineUiArtifacts.add(key);
            commitInlinePrefix();
            setMessages(previous => [...previous, { id: `inline-ui:${key}`, role: 'ui_card', content: '', uiCard: { artifact } }]);
          }
        }
        setResult(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            artifacts: [
              ...(prev.artifacts || []),
              artifact,
            ],
          };
        });
        break;
      }
      case 'result': {
        setMessages(settleChatProgress);
        const r = bindArtifactsToSourceTask((event as { type: 'result'; result: TaskResult }).result, sourceTaskId);
        const recordedArtifacts = currentTaskEventsRef.current
          .filter((e): e is Extract<DesktopTaskEvent, { type: 'artifact_recorded' }> => e.type === 'artifact_recorded')
          .map((recordedEvent) => artifactSummaryFromEvent(recordedEvent, sourceTaskId));
        const resultWithArtifacts = projectNarrationSummary(mergeTaskResultArtifacts(r, recordedArtifacts), streamRef.current, currentTaskEventsRef.current, source.inlineUiNarrationCommitted);
        const hasGeneratedFiles = currentTaskEventsRef.current.some(
          e => (e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write'
            && (e as { input: Record<string, unknown> }).input?.file_path)
          || (e.type === 'artifact_recorded' && (e as { kind?: string }).kind === 'html')
        );
        if (resultWithArtifacts.artifacts && resultWithArtifacts.artifacts.length > 0) {
          const finalContent = streamRef.current.trim();
          // Clear streaming FIRST to prevent one-frame duplicate display
          streamRef.current = '';
          cancelStreamingFlush();
          setStreamingText('');
          clearUiPreviews();
          if (finalContent) {
            source.resultSummaryInHistory = finalContent;
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              contextSource: publicEventMessageKey ? { sourceId: sourceTaskId, sourceMessageId: publicEventMessageKey } : undefined,
              role: 'assistant',
              content: finalContent,
            }]);
          }
          setResult(resultWithArtifacts);
          resultRef.current = resultWithArtifacts;
          if (live) setStatus('completed');
          setPlanSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'completed' } : s));
        } else {
          // Desktop tasks: artifacts is [], but still set result for generatedFiles extraction
          const finalText = streamRef.current || resultWithArtifacts.summary;
          // Clear streaming FIRST to prevent one-frame duplicate display
          streamRef.current = '';
          cancelStreamingFlush();
          setStreamingText('');
          clearUiPreviews();
          setResult(resultWithArtifacts);
          if (finalText.trim()) {
            source.resultSummaryInHistory = finalText;
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              contextSource: publicEventMessageKey ? { sourceId: sourceTaskId, sourceMessageId: publicEventMessageKey } : undefined,
              role: 'assistant',
              content: finalText,
            }]);
          }
          resultRef.current = resultWithArtifacts;
          if (live) setStatus('idle');
        }
        // Seal tool-steps group
        if (toolStepsMsgIdRef.current) {
          const sealId = toolStepsMsgIdRef.current;
          setMessages(prev => prev.map(m =>
            m.id === sealId ? { ...m, stepsLive: false } : m
          ));
          toolStepsMsgIdRef.current = null;
          toolStepsActiveRef.current = false;
        }
        // Auto-open canvas when generated files exist, preview first file
        if (live && hasGeneratedFiles && !canvasOpen) {
          sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
          const writeCall = currentTaskEventsRef.current.find(
            e => e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write'
              && (e as { input: Record<string, unknown> }).input?.file_path
          );
          let fp: string | undefined;
          if (writeCall) {
            fp = (writeCall as { input: Record<string, unknown> }).input.file_path as string;
          } else {
            const artifactEvent = currentTaskEventsRef.current.find(
              e => e.type === 'artifact_recorded' && (e as { kind?: string }).kind === 'html'
            );
            if (artifactEvent) fp = (artifactEvent as { filePath?: string }).filePath;
          }
          if (fp) {
            setCanvasSourceArtifact(undefined);
            setCanvasPreviewFile(fp);
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            api.readFileContent(fp).then(r => {
              if (!acceptsSource(source) || source.terminalSeen) return;
              setCanvasPreviewContent(r.content);
              setCanvasOpen(true);
            }).catch(() => {
              if (!acceptsSource(source) || source.terminalSeen) return;
              setCanvasPreviewContent('');
              setCanvasOpen(true);
            });
          } else {
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            setCanvasOpen(true);
          }
        }
        break;
      }
      case 'canvas_tool_call': {
        streamRef.current = separateAssistantNarration(streamRef.current);
        flushStreamingText(source);
        const ev = event as { type: 'canvas_tool_call'; toolName: string; input: unknown; toolUseId: string; eventId: string; displayInputSummary?: string };
        // report_progress is handled by TaskPanel, don't show in ToolStepsMessage
        if (ev.toolName === 'report_progress') break;
        const newStep: ToolStep = { toolUseId: ev.toolUseId, toolName: ev.toolName, input: ev.input, displayInputSummary: ev.displayInputSummary, status: 'running', startedAt: Date.now() };
        toolStepsActiveRef.current = true;
        setMessages(prev => {
          const cleaned = prev.filter(m => m.role !== 'progress' || (m.stage !== 'tool' && m.stage !== 'completed' && m.stage !== 'failed'));
          const existingIdx = cleaned.findIndex(m => m.id === toolStepsMsgIdRef.current);
          if (existingIdx !== -1) {
            const updated = [...cleaned];
            updated[existingIdx] = { ...updated[existingIdx], steps: [...(updated[existingIdx].steps ?? []), newStep] };
            return updated;
          }
          const msgId = `msg-tool-steps-${ev.eventId}`;
          toolStepsMsgIdRef.current = msgId;
          return [...cleaned, { id: msgId, role: 'tool_steps', content: '', steps: [newStep], stepsLive: true }];
        });
        break;
      }
      case 'canvas_tool_result': {
        const ev = event as { type: 'canvas_tool_result'; toolName: string; toolUseId: string; ok: boolean; response: string };
        const immediateMessage = ev.ok && ev.toolName === 'create_project'
          ? buildProjectCardMessageFromToolResult(ev.response)
          : ev.ok && ev.toolName === 'create_collaboration_room'
            ? buildRoomCardMessageFromToolResult(ev.response)
          : ev.ok && (ev.toolName === 'run_dynamic_workflow_script' || ev.toolName === 'get_dynamic_workflow_status')
            ? buildWorkflowMessageFromToolResult(ev.response, t as WorkflowLabels)
            : null;
        if (immediateMessage) {
          setMessages(prev => prev.some(msg => msg.id === immediateMessage.id) ? prev : [...prev, immediateMessage]);
        }
        const sealId = toolStepsMsgIdRef.current;
        const now = Date.now();
        if (sealId) {
          setMessages(prev => {
            const existingIdx = prev.findIndex(m => m.id === sealId);
            if (existingIdx === -1) return prev;
            const updated = [...prev];
            updated[existingIdx] = {
              ...updated[existingIdx],
              steps: (updated[existingIdx].steps ?? []).map(s =>
                s.toolUseId === ev.toolUseId ? { ...s, status: ev.ok ? 'done' : 'error', response: ev.response, finishedAt: now } : s
              ),
            };
            return updated;
          });
        }
        if (ev.toolName === 'xiaok_computer_use') {
          const action = parseComputerUseRecoverableAction(ev.response, t.chatShell.cuUnavailable);
          if (action && !computerUseActionCodesRef.current.has(action.code)) {
            computerUseActionCodesRef.current.add(action.code);
            setMessages(prev => [...prev, {
              id: `msg-computer-use-${action.code}`,
              role: 'computer_use_action',
              content: '',
              computerUseAction: action,
            }]);
          }
        }
        break;
      }
      case 'question_resolved': {
        if(event.answerText){const id=`${source.sourceTaskId}:answer:${event.questionId}`;setMessages(previous=>previous.some(m=>m.id===id)?previous:[...previous,{id,role:'user',content:event.answerText!}]);}
        setCurrentQuestion(source.questions.current);
        setStatus(source.questions.current||source.questions.native.length?'waiting_user':'running');
        break;
      }
      case 'needs_user': {
        const id=`${source.sourceTaskId}:question:${event.question.questionId}`;setMessages(previous=>previous.some(m=>m.id===id)?previous:[...previous,{id,role:'assistant',content:event.question.prompt}]);
        if(source.questions.current){setCurrentQuestion(source.questions.current);setStatus('waiting_user');}
        break;
      }
      case 'error': {
        const msg = (event as { type: 'error'; message: string }).message;
        source.lastErrorMessage = msg;
        if (lastLiveErrorRef.current?.taskKey === eventTaskKey
          && lastLiveErrorRef.current.rawMessage === msg) {
          break;
        }
        lastLiveErrorRef.current = { taskKey: eventTaskKey, rawMessage: msg };
        const repetitionStop = isRepetitionStopEvent(event as { message: string; retryable?: boolean; code?: string });
        setRepetitionStopped(repetitionStop);
        const partialText = streamRef.current;
        const reason = sanitizeUserFacingErrorMessage(msg, t.chatShell.taskCreateFailed, {
          providerAuth: t.chatShell.modelAuthFailed,
          modelKeyMissing: t.chatShell.modelKeyMissing,
          providerService: t.chatShell.modelServiceFailed,
          modelConnectionFailed: t.chatShell.modelConnectionFailed,
          modelTextRepetition: t.chatShell.modelTextRepetition,
          modelUsageLimitReached: t.chatShell.modelUsageLimitReached,
        });
        streamRef.current = '';
        cancelStreamingFlush();
        setStreamingText('');
        clearUiPreviews();
        setMessages(prev => {
          let lastUserMessageIndex = -1;
          for (let index = prev.length - 1; index >= 0; index -= 1) {
            if (prev[index].role === 'user') {
              lastUserMessageIndex = index;
              break;
            }
          }
          const retainedMessages = lastUserMessageIndex < 0
            ? prev
            : prev.filter((message, index) => index <= lastUserMessageIndex || message.role !== 'progress');
          return [
            ...retainedMessages,
            ...(partialText ? [{
              id: `msg-${Date.now()}-partial`,
              contextSource: publicEventMessageKey ? { sourceId: sourceTaskId, sourceMessageId: publicEventMessageKey } : undefined,
              role: 'assistant' as const,
              content: partialText,
            }] : []),
            {
              id: `msg-${Date.now()}-error`,
              role: 'assistant' as const,
              content: msg === 'app_shutdown' ? t.chatShell.taskInterrupted : msg === 'multi_agent_prepare_interrupted' ? t.chatShell.taskExecutionInterrupted : repetitionStop ? t.chatShell.modelTextRepetition : t.chatShell.taskExecutionFailed(reason),
            },
          ];
        });
        if (live) setStatus('failed');
        break;
      }
    }
  }, [taskId, t, acceptsSource, clearUiPreviews]);

  const retainObserver = useCallback((source: DisplaySource, unsubscribe: () => void) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      source.scope.attachmentObservers.delete(release);
      if (unsubRef.current === release) unsubRef.current = null;
      unsubscribe();
    };
    source.release = release;
    if (liveRenderScope.current === source.scope) source.scope.attachmentObservers.add(release);
    else release();
    return release;
  }, []);

  const promoteSource = useCallback((source: DisplaySource, release: (() => void) | null, clearPresentation: boolean) => {
    const previousRelease = unsubRef.current;
    const previousSource = displaySourceRef.current;
    displaySourceRef.current = source;
    setInterruptedTask(previous => previous?.taskId === source.sourceTaskId ? previous : null);
    unsubRef.current = release;
    if (clearPresentation) {
      const partial = streamRef.current;
      const previousResult = resultRef.current;
      const archivedResult = previousResult && previousResult.summary === previousSource?.resultSummaryInHistory
        ? { ...previousResult, summary: '' } : previousResult;
      const card = buildResultCardMessage({
        idHint: `${previousSource?.sourceTaskId ?? 'current'}-${Date.now()}`,
        result: archivedResult,
        generatedFiles: collectGeneratedFilesForTurn(currentTaskEventsRef.current, [resultRef.current?.summary ?? '', partial]),
      });
      setMessages(previous => [
        ...previous.filter(message => message.role !== 'progress').map(message => message.stepsLive ? { ...message, stepsLive: false } : message),
        ...(partial.trim() ? [{ id: `msg-${Date.now()}-handoff`, role: 'assistant' as const, content: partial }] : []),
        ...(card && !previous.some(message => message.role === 'result_card' && message.result === previousResult) ? [card] : []),
      ]);
      streamRef.current = '';
      cancelStreamingFlush();
      setStreamingText('');
      clearUiPreviews();
      resultRef.current = null;
      setResult(null);
      setCurrentQuestion(null);
      setPlanSteps([]);
      currentTaskEventsRef.current = [];
      allEventsRef.current = [];
      toolStepsMsgIdRef.current = null;
      toolStepsActiveRef.current = false;
      computerUseActionCodesRef.current = new Set();
      setStatus('idle'); // An installed observer is not proof that ACK started execution.
    }
    const previous = threadRef.current;
    if (previous && previous.id === source.scope.taskId) {
      const next = { ...previous, currentTaskId: source.sourceTaskId,
        taskIds: previous.taskIds.includes(source.sourceTaskId) ? previous.taskIds : [...previous.taskIds, source.sourceTaskId] };
      threadRef.current = next;
      setThread(next);
    }
    if (previousRelease !== release) previousRelease?.();
  }, []);

  const applyGoal = useCallback((next: DesktopGoalProjection | null) => {
    setGoal(previous => previous && next && previous.state.goalId === next.state.goalId
      && (previous.state.epoch > next.state.epoch || (previous.state.epoch === next.state.epoch && previous.state.revision > next.state.revision))
      ? previous : next);
  }, []);

  const refreshControlledGoal = useCallback(async () => {
    const barrier = goalReadBarrier.current, desktop = getDesktopApi();
    if (!barrier || !desktop || !currentAttempt(barrier.attempt) || !barrier.attempt.scope.taskId) return;
    const sequence = ++barrier.sequence;
    const current = () => goalReadBarrier.current === barrier && barrier.sequence === sequence && currentAttempt(barrier.attempt);
    try {
      const value = await desktop.getGoal(barrier.attempt.scope.taskId);
      if (current()) { applyGoal(value); setGoalError(null); }
    } catch {
      if (current()) { setGoal(null); setGoalError(t.goalBar.detailsUnavailable); }
    }
  }, [applyGoal, currentAttempt, t.goalBar.detailsUnavailable]);

  const runGoalAttempt = useCallback(async (attempt: GoalAttempt, action: () => Promise<void>) => {
    if (!currentAttempt(attempt)) return;
    setGoalLoading(true);
    setGoalError(null);
    try { await action(); }
    catch (error) {
      if (currentAttempt(attempt)) setGoalError(sanitizeUserFacingErrorMessage(error, t.chatShell.taskCreateFailed));
    } finally {
      if (currentAttempt(attempt)) setGoalLoading(false);
    }
  }, [currentAttempt, t.chatShell.taskCreateFailed]);

  const reconcileUnknownOnce = useCallback(async (work: GoalAttachmentWork) => {
    const { attempt, source, prepared } = work;
    if (work.readUsed || !currentAttempt(attempt) || !acceptsSource(source)) return;
    work.readUsed = true;
    const eventCount = source.eventCount;
    setGoalError(t.chatShell.goalAttachmentQuerying);
    try {
      const { snapshot } = await api.recoverTask(prepared.taskId);
      if (!currentAttempt(attempt) || !acceptsSource(source)) return;
      const scope = snapshot?.executionScope;
      const expected = prepared.executionScope;
      const valid = snapshot?.taskId === prepared.taskId && scope?.kind === 'goal_turn'
        && scope.origin === expected.origin && scope.threadId === expected.threadId && scope.goalId === expected.goalId
        && scope.epoch === expected.epoch && scope.goalTurnId === expected.goalTurnId;
      if (valid && !source.terminalSeen && eventCount === source.eventCount) {
        source.questions=nativeQuestionPresentationFromSnapshot(snapshot);
        if (snapshot.status === 'running' || snapshot.status === 'waiting_user') {
          setStatus(source.questions.native.length?'waiting_user':snapshot.status);
          if(!source.questions.native.length)source.questions.current=pendingTaskQuestion(snapshot);
          setCurrentQuestion(source.questions.current);
        } else if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
          source.uiPreviewClosed = true;
          clearUiPreviews();
          source.terminalSeen = true;
          setStatus(snapshot.status === 'cancelled' ? 'idle' : snapshot.status);
          setCurrentQuestion(null);
          setInterruptedTask(readTaskInterruption(snapshot, {taskId: prepared.taskId, threadId: prepared.threadId}));
        }
      }
    } catch { /* This one read is spent even if the transport or recovery cannot confirm it. */ }
    if (currentAttempt(attempt) && acceptsSource(source)) setGoalError(t.chatShell.goalAttachmentUnknown);
  }, [acceptsSource, currentAttempt, t.chatShell.goalAttachmentQuerying, t.chatShell.goalAttachmentUnknown]);

  const validPrepared = useCallback((prepared: DesktopGoalTaskPrepared) => prepared?.threadId === taskId
    && typeof prepared.taskId === 'string' && prepared.taskId.length > 0
    && typeof prepared.attachmentId === 'string' && prepared.attachmentId.length > 0
    && prepared.executionScope?.kind === 'goal_turn' && prepared.executionScope.threadId === taskId
    && (prepared.executionScope.origin === 'user' || prepared.executionScope.origin === 'continuation')
    && prepared.executionScope.goalId === prepared.goalRef?.goalId, [taskId]);

  const attachGoalTask = useCallback((prepared: DesktopGoalTaskPrepared, attempt: GoalAttempt, predecessor?: DisplaySource): Promise<void> => {
    if (!currentAttempt(attempt) || !taskId || !validPrepared(prepared)) return Promise.resolve();
    const existing = attachmentWorksRef.current.get(prepared.attachmentId);
    if (existing) return existing.promise;
    const desktop = getDesktopApi();
    if (!desktop) return Promise.reject(new Error('desktop_api_unavailable'));
    const source: DisplaySource = { scope: renderScope, sourceTaskId: prepared.taskId, intentOwner: attempt,
      executionScope: prepared.executionScope, eventCount: 0, terminalSeen: false, streamEnded: false };
    const work: GoalAttachmentWork = { attempt, prepared, source, ackInvoked: false, readUsed: false, promise: Promise.resolve() };
    attachmentWorksRef.current.set(prepared.attachmentId, work);
    work.promise = (async () => {
      try {
        const outcome = await attachPreparedGoalTask({
          prepared, currentThreadId: taskId,
          isCurrent: () => liveRenderScope.current === renderScope,
          isCandidateCurrent: () => currentAttempt(attempt) && (!predecessor || displaySourceRef.current === predecessor),
          updateThreadTaskId: api.updateThreadTaskId,
          subscribeTask: (id, handler) => retainObserver(source, api.subscribeTask(id, handler)),
          onEvent: (event, coordinate) => handleEvent(event as DesktopTaskEvent, source, coordinate),
          onSubscribed: release => promoteSource(source, release, true),
          ackGoalTaskAttached: input => { work.ackInvoked = true; return desktop.ackGoalTaskAttached(input); },
        });
        if (outcome?.kind === 'unknown') await reconcileUnknownOnce(work);
      } catch (error) {
        if (currentAttempt(attempt) && !work.ackInvoked && attachmentWorksRef.current.get(prepared.attachmentId) === work) {
          attachmentWorksRef.current.delete(prepared.attachmentId);
        }
        throw error;
      }
    })();
    return work.promise;
  }, [currentAttempt, handleEvent, promoteSource, reconcileUnknownOnce, renderScope, retainObserver, taskId, validPrepared]);

  useEffect(() => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    let live = true;
    const capturedAttempt = goalAttemptRef.current;
    let goalReadGeneration = 0;
    const initialCurrent = () => live && liveRenderScope.current === renderScope && goalAttemptRef.current === capturedAttempt;
    setGoalLoading(true);
    setGoalError(null);
    setGoalNativeMutation(null);
    void desktop.getGoalNativeMutation?.(taskId).then(value => {
      if (initialCurrent()) setGoalNativeMutation(value);
    }).catch(() => { /* Existing Goal read reports service availability. */ });
    void desktop.getGoal(taskId).then(value => {
      if (initialCurrent() && goalReadGeneration === 0) { if (goalReadBarrier.current?.attempt.scope === renderScope) void refreshControlledGoal(); else applyGoal(value); }
    }).catch(error => {
      if (initialCurrent()) setGoalError(sanitizeUserFacingErrorMessage(error, t.chatShell.taskCreateFailed));
    }).finally(() => {
      if (initialCurrent()) setGoalLoading(false);
    });
    const unsubscribeChanged = desktop.onGoalChanged(event => {
      if (!live || liveRenderScope.current !== renderScope || event.threadId !== taskId) return;
      if (goalReadBarrier.current?.attempt.scope === renderScope) { void refreshControlledGoal(); return; }
      const generation = ++goalReadGeneration, attempt = goalAttemptRef.current;
      applyGoal(event.goal);
      if (event.goal.currentCompletion?.kind === 'unavailable') {
        // Main owns current verification; this event-driven read never decides continuation.
        void desktop.getGoal(taskId).then(value => {
          if (live && liveRenderScope.current === renderScope && generation === goalReadGeneration
            && goalAttemptRef.current === attempt) applyGoal(value);
        }).catch(() => { /* Keep the explicit unavailable state. */ });
      }
    });
    const unsubscribePrepared = desktop.onGoalTaskPrepared(prepared => {
      if (!live || liveRenderScope.current !== renderScope || !validPrepared(prepared)) return;
      if (prepared.attachmentSource?.kind === 'request') {
        // Only its semantic reply creates request work. An early event never
        // consumes the ID, borrows a newer request, or starts another feedback owner.
        const work = attachmentWorksRef.current.get(prepared.attachmentId);
        if (work && currentAttempt(work.attempt) && work.prepared.attachmentSource.kind === 'request'
          && work.prepared.attachmentSource.requestId === prepared.attachmentSource.requestId
          && work.prepared.taskId === prepared.taskId) void work.promise.catch(() => {});
        return;
      }
      if (prepared.attachmentSource?.kind !== 'automatic' || prepared.executionScope.origin !== 'continuation') return;
      const intent = goalAttemptRef.current;
      const predecessorTaskId = prepared.attachmentSource.predecessorTaskId;
      void (async () => {
        const initialization = initializationRef.current;
        if (initialization?.scope === renderScope) {
          await initialization.promise;
          if (!initialization.succeeded) return;
        }
        if (!live || liveRenderScope.current !== renderScope || goalAttemptRef.current !== intent) return;
        const predecessor = displaySourceRef.current;
        if (!predecessor || predecessor.scope !== renderScope || predecessor.sourceTaskId !== predecessorTaskId
          || predecessor.intentOwner !== intent || predecessor.executionScope?.kind !== 'goal_turn'
          || predecessor.executionScope.goalId !== prepared.executionScope.goalId
          || predecessor.executionScope.epoch !== prepared.executionScope.epoch) return;
        const attempt = beginGoalAttempt();
        await runGoalAttempt(attempt, () => attachGoalTask(prepared, attempt, predecessor));
      })().catch(() => {});
    });
    return () => {
      live = false;
      unsubscribeChanged();
      unsubscribePrepared();
    };
  }, [applyGoal, attachGoalTask, beginGoalAttempt, currentAttempt, refreshControlledGoal, renderScope, runGoalAttempt, taskId, t.chatShell.taskCreateFailed, validPrepared]);

  // Replay events from a single snapshot into messages
  // Returns { msgs, result, events } where events is for Canvas (not pushed to ref during replay)
  const replaySnapshot = useCallback((snapshot: { taskId?: string; status?: string; events?: DesktopTaskEvent[]; prompt?: string; createdAt?:number; materials?: DisplayFileRef[] }, addPromptAsUser: boolean, presentation?: TaskPublicPresentation | null, historicalOnly = false): { msgs: ChatMessage[]; result: TaskResult | null; events: DesktopTaskEvent[]; toolStepsMsgId: string | null } => {
    if (!historicalOnly) setRepetitionStopped(false);
    const msgs: ChatMessage[] = [];
    let lastResult: TaskResult | null = null;
    const replayEvents: DesktopTaskEvent[] = []; // Local array for Canvas, not ref
    const actionCodes = historicalOnly ? new Set<string>() : computerUseActionCodesRef.current;
    const publicPrompt = presentation === undefined ? snapshot.prompt : presentation?.includeUser ? presentation.prompt : undefined;
    if (addPromptAsUser && publicPrompt) {
      if (!historicalOnly) repetitionRequestRef.current = { text: publicPrompt, files: snapshot.materials?.flatMap(material => material.filePath ? [{ filePath: material.filePath, name: material.name || material.originalName || fileBasename(material.filePath) }] : []) };
      const display = presentation ? { displayPrompt: publicPrompt, notice: undefined } : parseScheduledTaskPromptDisplay(publicPrompt);
      if (display.notice) {
        msgs.push({
          id: `msg-scheduled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'progress',
          stage: 'completed',
          content: display.notice,
        });
      }
      msgs.push({
        id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        contextSource: snapshot.taskId ? { sourceId: snapshot.taskId, sourceMessageId: publicTaskMessageKey('user') } : undefined,
        role: 'user',
        content: formatUserMessageContent(display.displayPrompt, snapshot.materials, t.chatShell.attachmentLabel),
        createdAt:snapshot.createdAt,
      });
    }

    let replayToolMsgId: string | null = null;
    if (snapshot?.events && snapshot.events.length > 0) {
      let accumulated = '';
      let lastProgress: ChatMessage | null = null;
      let terminalSeen = snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
      let lastErrorMessage: string | null = null;
      // For replay, also collect tool_steps so past tasks show tool execution
      let replayToolSteps: ToolStep[] = [];
      const replayArtifacts: ArtifactSummary[] = [];
      const inlineKeys = new Set<string>();
      let committedNarration = false;
      for (const [eventIndex, ev] of snapshot.events.entries()) {
        if(ev.type==='needs_user'||ev.type==='question_resolved'){
          if(accumulated){msgs.push({id:`${snapshot.taskId}:before-question:${msgs.length}`,role:'assistant',content:accumulated});accumulated='';}
          if(ev.type==='needs_user')msgs.push({id:`${snapshot.taskId}:question:${ev.question.questionId}`,role:'assistant',content:ev.question.prompt});
          else if(ev.answerText)msgs.push({id:`${snapshot.taskId}:answer:${ev.questionId}`,role:'user',content:ev.answerText});
          continue;
        }
        if (ev.type === 'task_terminal') {
          terminalSeen = true;
          continue;
        }
        if (ev.type === 'artifact_recorded') {
          const artifact = artifactSummaryFromEvent(ev, snapshot.taskId);
          replayArtifacts.push(artifact);
          const key = inlineUiKey(artifact);
          if (isInlineUiArtifact(artifact) && !inlineKeys.has(key)) {
            inlineKeys.add(key);
            if (accumulated.trim()) {
              committedNarration = true;
              msgs.push({ id: `inline-prefix:${snapshot.taskId}:${msgs.length}`, role: 'assistant', content: accumulated });
              accumulated = '';
            }
            msgs.push({ id: `inline-ui:${key}`, role: 'ui_card', content: '', uiCard: { artifact } });
          }
          continue;
        }
        if (ev.type === 'progress_plan_reported') {
          const planEv = ev as { type: 'progress_plan_reported'; steps: Array<{ id: string; label: string; status: string }> };
          if (!historicalOnly) setPlanSteps(planEv.steps);
          continue;
        }
        if (ev.type === 'canvas_file_changed') {
          replayEvents.push(ev); // Collect locally
          continue;
        }
        if (ev.type === 'canvas_tool_call') {
          accumulated = separateAssistantNarration(accumulated);
          replayEvents.push(ev);
          const evC = ev as { type: 'canvas_tool_call'; toolName: string; input: unknown; toolUseId: string; eventId: string; ts?: number; displayInputSummary?: string };
          // Skip report_progress from ToolSteps display (handled by TaskPanel)
          if (evC.toolName === 'report_progress') continue;
          replayToolSteps.push({ toolUseId: evC.toolUseId, toolName: evC.toolName, input: evC.input, displayInputSummary: evC.displayInputSummary, status: 'done', startedAt: evC.ts });
          if (!replayToolMsgId) replayToolMsgId = `msg-tool-steps-${evC.eventId}`;
          continue;
        }
        if (ev.type === 'canvas_tool_result') {
          replayEvents.push(ev);
          const evR = ev as { type: 'canvas_tool_result'; toolName: string; toolUseId: string; ok: boolean; response: string; ts?: number };
          replayToolSteps = replayToolSteps.map(s =>
            s.toolUseId === evR.toolUseId ? { ...s, status: evR.ok ? 'done' : 'error', response: evR.response, finishedAt: evR.ts } : s
          );
          if (evR.ok && evR.toolName === 'create_project') {
            const message = buildProjectCardMessageFromToolResult(evR.response);
            if (message) msgs.push(message);
          }
          if (evR.ok && evR.toolName === 'create_collaboration_room') {
            const message = buildRoomCardMessageFromToolResult(evR.response);
            if (message && !msgs.some(item => item.id === message.id)) msgs.push(message);
          }
          if (evR.ok && (evR.toolName === 'run_dynamic_workflow_script' || evR.toolName === 'get_dynamic_workflow_status')) {
            const message = buildWorkflowMessageFromToolResult(evR.response, t as WorkflowLabels);
            if (message) msgs.push(message);
          }
          if (evR.toolName === 'xiaok_computer_use') {
            const action = parseComputerUseRecoverableAction(evR.response, t.chatShell.cuUnavailable);
            if (action && !actionCodes.has(action.code)) {
              actionCodes.add(action.code);
              msgs.push({
                id: `msg-computer-use-${action.code}`,
                role: 'computer_use_action',
                content: '',
                computerUseAction: action,
              });
            }
          }
          continue;
        }
        if (ev.type === 'execution_health' && (snapshot.status === 'running' || snapshot.status === 'waiting_user')) {
          lastProgress = {id:'execution-health',role:'progress',content:t.executionHealth[ev.state],stage:ev.state};
        } else if (ev.type === 'progress') {
          const prog = (ev as { type: 'progress'; message: string; stage?: string; eventId: string });
          if ((prog.stage === 'tool' || prog.stage === 'completed' || prog.stage === 'failed') && replayToolSteps.length > 0) { continue; }
          lastProgress = {
            id: `msg-progress-${prog.eventId}`,
            role: 'progress',
            content: prog.message,
            stage: prog.stage,
          };
        } else if (ev.type === 'assistant_delta') {
          accumulated += (ev as { delta: string }).delta;
          lastProgress = null;
        } else if (ev.type === 'task_cancelled') {
          const partialText = pendingNarration(accumulated, ev.partialText ?? '', snapshot.events, committedNarration);
          if (partialText.trim()) {
            msgs.push({
              id: `msg-assistant-cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              contextSource: snapshot.taskId ? { sourceId: snapshot.taskId, sourceMessageId: publicTaskMessageKey('assistant', eventIndex) } : undefined,
              role: 'assistant',
              content: partialText,
            });
          }
          accumulated = '';
          lastProgress = null;
        } else if (ev.type === 'error') {
          const rawMessage = (ev as { type: 'error'; message: string }).message;
          const repetitionStop = isRepetitionStopEvent(ev as { message: string; retryable?: boolean; code?: string });
          if (!historicalOnly) setRepetitionStopped(repetitionStop);
          if (accumulated.trim()) {
            msgs.push({
              id: `msg-assistant-partial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              contextSource: snapshot.taskId ? { sourceId: snapshot.taskId, sourceMessageId: publicTaskMessageKey('assistant', eventIndex) } : undefined,
              role: 'assistant',
              content: accumulated,
            });
            accumulated = '';
          }
          lastProgress = null;
          if (rawMessage !== lastErrorMessage) {
            const reason = sanitizeUserFacingErrorMessage(rawMessage, t.chatShell.taskCreateFailed, {
              providerAuth: t.chatShell.modelAuthFailed,
              modelKeyMissing: t.chatShell.modelKeyMissing,
              providerService: t.chatShell.modelServiceFailed,
              modelConnectionFailed: t.chatShell.modelConnectionFailed,
              modelTextRepetition: t.chatShell.modelTextRepetition,
              modelUsageLimitReached: t.chatShell.modelUsageLimitReached,
            });
            msgs.push({
              id: `msg-task-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: rawMessage === 'app_shutdown' ? t.chatShell.taskInterrupted : rawMessage === 'multi_agent_prepare_interrupted' ? t.chatShell.taskExecutionInterrupted : repetitionStop ? t.chatShell.modelTextRepetition : t.chatShell.taskExecutionFailed(reason),
            });
            lastErrorMessage = rawMessage;
          }
        } else if (ev.type === 'result') {
          if (lastProgress?.stage !== 'completed' && lastProgress?.stage !== 'failed') lastProgress = null;
          const r = bindArtifactsToSourceTask((ev as { result: TaskResult }).result, snapshot.taskId);
          const resultWithArtifacts = projectNarrationSummary(mergeTaskResultArtifacts(r, replayArtifacts), accumulated, snapshot.events, committedNarration);
          const assistantContent = accumulated || resultWithArtifacts.summary;
          if (assistantContent) {
            msgs.push({
              id: `msg-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              contextSource: snapshot.taskId ? { sourceId: snapshot.taskId, sourceMessageId: publicTaskMessageKey('assistant', eventIndex) } : undefined,
              role: 'assistant',
              content: assistantContent,
            });
            accumulated = '';
          }
          const resultCard = buildResultCardMessage({
            idHint: `${(snapshot as { taskId?: string }).taskId || 'task'}-${msgs.length}`,
            result: resultWithArtifacts,
            generatedFiles: collectGeneratedFilesForTurn(snapshot.events || [], [resultWithArtifacts.summary, assistantContent]),
          });
          if (resultCard) msgs.push({ ...resultCard, contextSource: snapshot.taskId ? { sourceId: snapshot.taskId, sourceMessageId: publicTaskMessageKey('result', eventIndex) } : undefined });
          lastResult = resultWithArtifacts;
        }
      }
      if (replayToolSteps.length > 0 && replayToolMsgId) {
        msgs.push({ id: replayToolMsgId, role: 'tool_steps', content: '', steps: replayToolSteps, stepsLive: false });
      }
      if (lastProgress && (!terminalSeen || lastProgress.stage === 'completed' || lastProgress.stage === 'failed')) {
        msgs.push(lastProgress);
      }
      if (accumulated) {
        if (historicalOnly) {
          msgs.push({ id: `msg-history-partial-${snapshot.taskId}`, role: 'assistant', content: accumulated });
        } else {
          streamRef.current = accumulated;
          setStreamingText(accumulated);
        }
      }
    }
    return { msgs, result: lastResult, events: replayEvents, toolStepsMsgId: replayToolMsgId };
  }, [t]);

  const loadOlderHistory = useCallback(async () => {
    const page = olderHistoryRef.current;
    if (page.loading || !page.remaining.length) return;
    page.loading = true;
    const gen = mountGenRef.current;
    const current = () => mountGenRef.current === gen && liveRenderScope.current === renderScope && olderHistoryRef.current === page;
    setOlderHistory({ remaining: page.remaining.length, loading: true, error: '' });
    const ids = page.remaining.slice(-HISTORY_PAGE_SIZE);
    const olderMessages: ChatMessage[] = [];
    const olderEvents: DesktopTaskEvent[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      if (!current()) return;
      try {
        const { snapshot } = await api.recoverTask(id);
        if (!current()) return;
        if (!snapshot) throw Error('history_snapshot_unavailable');
        const replay = replaySnapshot({ ...snapshot, taskId: snapshot.taskId || id }, true, undefined, true);
        olderMessages.push(...replay.msgs);
        olderEvents.push(...replay.events);
      } catch { if (!current()) return; missing.push(id); }
    }
    if (!current()) return;
    page.loading = false;
    if (!missing.length) {
      page.remaining = page.remaining.slice(0, -ids.length);
      allEventsRef.current = [...olderEvents, ...allEventsRef.current];
      setMessages(previous => [...olderMessages, ...previous]);
    }
    setOlderHistory({ remaining: page.remaining.length, loading: false, error: missing.length ? t.chatShell.historyUnavailable(missing.join(', ')) : '' });
  }, [renderScope, replaySnapshot, t]);

  // Scope the Canvas panel to the active session. On a session switch, persist
  // the outgoing session's canvas state and restore the incoming session's
  // (closed by default), so the canvas does not bleed across conversations and
  // reappears only when returning to the session that opened it.
  useEffect(() => {
    const prev = prevCanvasTaskRef.current;
    if (prev === taskId) return;
    if (prev) {
      canvasStateByTaskRef.current.set(prev, {
        open: canvasOpen,
        expanded: canvasExpanded,
        file: canvasPreviewFile,
        content: canvasPreviewContent,
        sourceArtifact: canvasSourceArtifact,
      });
    }
    prevCanvasTaskRef.current = taskId;
    const saved = taskId ? canvasStateByTaskRef.current.get(taskId) : undefined;
    if (saved?.open) {
      setCanvasPreviewFile(saved.file);
      setCanvasPreviewContent(saved.content);
      setCanvasSourceArtifact(saved.sourceArtifact);
      setCanvasPreviewModeRequest((request) => ({ id: request.id + 1, startInEditMode: false }));
      setCanvasExpanded(saved.expanded);
      setCanvasOpen(true);
    } else {
      setCanvasOpen(false);
      setCanvasExpanded(false);
      setCanvasPreviewFile(undefined);
      setCanvasPreviewContent(undefined);
      setCanvasSourceArtifact(undefined);
      setCanvasPreviewModeRequest((request) => ({ id: request.id + 1, startInEditMode: false }));
    }
    // Intentionally keyed only on taskId: the canvas state read here is the
    // outgoing session's value captured at switch time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;

    // Increment mount generation to cancel any in-flight async from prior effect run
    const gen = ++mountGenRef.current;
    const capturedIntent = goalAttemptRef.current;
    const capturedSource = displaySourceRef.current;
    const loadCurrent = () => mountGenRef.current === gen && liveRenderScope.current === renderScope
      && goalAttemptRef.current === capturedIntent && displaySourceRef.current === capturedSource;
    let loadedSource: DisplaySource | null = null;
    const initialization = { scope: renderScope, promise: Promise.resolve(), succeeded: false };
    initializationRef.current = initialization;

    // Mark this as the current load
    const thisLoadId = taskId;
    currentLoadIdRef.current = thisLoadId;
    allEventsRef.current = [];
    currentTaskEventsRef.current = [];
    toolStepsMsgIdRef.current = null;
    toolStepsActiveRef.current = false;
    computerUseActionCodesRef.current = new Set();
    titleLockedRef.current = false;

    // Cleanup previous subscription
    unsubRef.current?.();
    unsubRef.current = null;
    streamRef.current = '';
    cancelStreamingFlush();
    setStreamingText('');
    clearUiPreviews();
    setResult(null);
    setMessages([]);
    olderHistoryRef.current = { remaining: [], loading: false };
    setOlderHistory({ remaining: 0, loading: false, error: '' });
    repetitionRequestRef.current = null;
    setRepetitionStopped(false);
    setPlanSteps([]);
    setCurrentQuestion(null);
    setInterruptedTask(null);
    setThread(null);
    setStatus('idle');
    setLoadError(null);
    setActionError(null);
    const storedDraft = readStoredThreadDraft(taskId);
    const refreshing = historyRefresh?.scope === renderScope && historyRefresh.attempt === capturedIntent;
    if (!refreshing) setPrompt(draftPrompt || '');

    // If we have an initialPrompt from WelcomePage, pre-populate
    if (initialPrompt && !refreshing) {
      setMessages([{
        id: `msg-initial-user`,
        role: 'user',
        content: formatUserMessageContent(initialPrompt, initialFiles, t.chatShell.attachmentLabel),
      }]);
      setStatus('running');
    }

    initialization.promise = api.getThread(taskId).then(async (threadData) => {
      // Check if this is still the current load (prevent race condition)
      if (!loadCurrent()) return;

      if (threadData) {
        titleLockedRef.current = Boolean(threadData.title?.trim());
        const allTaskIds = [...new Set([...(threadData.taskIds ?? []), ...(threadData.legacyTaskIds ?? []), ...(threadData.currentTaskId ? [threadData.currentTaskId] : [])])];
        if (initialPrompt && allTaskIds[0]) setMessages(previous => previous.map(message => message.id === 'msg-initial-user' ? { ...message, contextSource: { sourceId: allTaskIds[0], sourceMessageId: publicTaskMessageKey('user') } } : message));
        const isEmptyHelpThread = allTaskIds.length === 0 && !initialPrompt;
        if (isEmptyHelpThread) {
          if (draftPrompt) {
            setPrompt(draftPrompt);
          } else if (storedDraft?.draftPrompt) {
            setPrompt(storedDraft.draftPrompt);
          } else {
            const legacyDraft = readLegacySwarmDraftForThread(threadData);
            if (legacyDraft?.draftPrompt) {
              setPrompt(legacyDraft.draftPrompt);
              writeStoredThreadDraft(threadData.id, legacyDraft);
            }
          }
        }
        console.log(`[ChatShell] Loading thread=${taskId.slice(0,8)} title="${threadData.title}" currentTaskId=${threadData.currentTaskId ?? 'none'}`);
        const allMessages: ChatMessage[] = [];
        let lastResult: TaskResult | null = null;
        let lastStatus: 'idle' | 'running' | 'waiting_user' | 'failed' = 'idle';
        let lastTaskIdForSub: string | null = null;
        let lastSubSinceIndex = 0;
        let lastSubToolStepsMsgId: string | null = null;
        let lastSnapshot: TaskSnapshot | undefined;
        const missingTaskIds: string[] = [];
        for (const tid of allTaskIds.slice(-HISTORY_PAGE_SIZE)) {
          // Check again after each async operation
          if (!loadCurrent()) return;

          try {
            const { snapshot, presentation, recoveredFromTaskId } = await recoverForDisplay(api, tid,
              allTaskIds.length === 1 ? threadData.title ?? undefined : undefined, loadCurrent);
            if (!loadCurrent()) return;
            if (snapshot) {
              if (refreshing && snapshot.taskId !== tid) throw new Error('task_identity_mismatch');
              const titlePrompt = presentation === undefined ? snapshot.prompt : presentation?.includeUser ? presentation.prompt : undefined;
              if (!titleLockedRef.current && titlePrompt?.trim()) {
                titleLockedRef.current = true;
                api.updateThreadTitle(taskId, titlePrompt.trim().slice(0, 40)).catch(() => {});
              }
              if (recoveredFromTaskId) allMessages.push({ id: `history-recovery-${tid}`, role: 'assistant', content: t.chatShell.historyRecovered(recoveredFromTaskId) });
              console.log(`[ChatShell] Replaying task=${tid} status=${snapshot.status} events=${snapshot.events?.length}`);
              const isFirst = tid === allTaskIds[0];
              const addPrompt = Boolean(snapshot.prompt && (!isFirst || !initialPrompt || refreshing || taskId===ASSISTANT_CHAT_THREAD));
              const { msgs: replayMsgs, result: replayResult, events: replayEvents, toolStepsMsgId: replayToolStepsMsgId } = replaySnapshot(
                { ...snapshot, taskId: snapshot.taskId || tid },
                addPrompt,
                presentation,
              );
              console.log(`[ChatShell] Replayed task=${tid} → ${replayMsgs.length} msgs, addPrompt=${addPrompt}`);
              allMessages.push(...replayMsgs);
              // Collect events for Canvas panel (merge into ref after all tasks processed)
              allEventsRef.current.push(...replayEvents);
              if (tid === allTaskIds[allTaskIds.length - 1]) {
                lastSnapshot = snapshot;
                currentTaskEventsRef.current = snapshot.events.filter(event => event.type !== 'ui_preview');
              }

              // Keep result separate only for a live latest task. Completed tasks are rendered as
              // anchored result_card messages during replay, so they do not disappear when a new
              // turn starts and do not duplicate at the bottom of the thread.
              if (replayResult && tid === allTaskIds[allTaskIds.length - 1] && (snapshot.status === 'running' || snapshot.status === 'waiting_user')) {
                lastResult = replayResult;
              }

              // Collect last task status for live subscription
              if (tid === allTaskIds[allTaskIds.length - 1]) {
                lastTaskIdForSub = tid;
                if (snapshot.status === 'running' || snapshot.status === 'waiting_user') {
                  lastStatus = snapshot.status;
                  // Subscribe incrementally: skip the events we already replayed so the
                  // live stream does not re-emit history and duplicate the tool steps.
                  lastSubSinceIndex = snapshot.events?.length ?? 0;
                  lastSubToolStepsMsgId = replayToolStepsMsgId;
                } else if (snapshot.status === 'completed') {
                  lastStatus = 'idle';
                } else if (snapshot.status === 'failed') {
                  lastStatus = 'failed';
                }
              }
            }
          } catch { if (!loadCurrent()) return; missingTaskIds.push(tid); }
        }

        // Final check before setting any state
        if (!loadCurrent()) return;

        if (missingTaskIds.length) allMessages.push({ id: 'history-unavailable', role: 'assistant', content: t.chatShell.historyUnavailable(missingTaskIds.join(', ')) });

        // Now set all state atomically after final check
        setThread(threadData);
        olderHistoryRef.current.remaining = allTaskIds.slice(0, -HISTORY_PAGE_SIZE);
        setOlderHistory({ remaining: olderHistoryRef.current.remaining.length, loading: false, error: '' });
        threadRef.current = threadData;
        if (allMessages.length > 0) {
          setMessages(allMessages);
        }
        if (lastResult) {
          setResult(lastResult);
        }
        const restoredQuestions=lastSnapshot?nativeQuestionPresentationFromSnapshot(lastSnapshot):emptyNativeQuestionPresentation();
        if(!restoredQuestions.native.length)restoredQuestions.current=pendingTaskQuestion(lastSnapshot);
        if(restoredQuestions.native.length)lastStatus='waiting_user';
        setCurrentQuestion(restoredQuestions.current);
        setStatus(refreshing ? 'idle' : lastStatus);
        setInterruptedTask(readTaskInterruption(lastSnapshot, {taskId: lastTaskIdForSub, threadId: taskId}));
        if (lastTaskIdForSub) {
          loadedSource = { scope: renderScope, sourceTaskId: lastTaskIdForSub, intentOwner: capturedIntent,
            questions:restoredQuestions,executionScope: lastSnapshot?.executionScope, eventCount: lastSnapshot?.events.length ?? 0,
            terminalSeen: refreshing || lastSnapshot?.status === 'completed' || lastSnapshot?.status === 'failed' || lastSnapshot?.status === 'cancelled', streamEnded: refreshing };
          const artifacts = (lastSnapshot?.events ?? []).flatMap(event => event.type === 'artifact_recorded'
            ? [artifactSummaryFromEvent(event, lastTaskIdForSub!)] : []).filter(isInlineUiArtifact);
          loadedSource.inlineUiArtifacts = new Set(artifacts.map(inlineUiKey));
          loadedSource.inlineUiNarrationCommitted = artifacts.length > 0 && allMessages.some(message => message.id.startsWith(`inline-prefix:${lastTaskIdForSub}:`));
        }
        if (!refreshing && lastTaskIdForSub && (lastStatus === 'running' || lastStatus === 'waiting_user')) {
          // Guard: if effect was cleaned up during async gap (StrictMode), don't subscribe
          if (!loadCurrent()) return;
          // Rebind live tool-steps refs to the message replay already created, so the
          // incremental stream updates the existing steps instead of spawning a second
          // (perpetually-running) tool_steps message.
          if (lastSubToolStepsMsgId) {
            toolStepsMsgIdRef.current = lastSubToolStepsMsgId;
            toolStepsActiveRef.current = true;
          }
          const source = loadedSource!;
          const release = retainObserver(source, api.subscribeTask(
            lastTaskIdForSub,
            (event, coordinate) => handleEvent(event, source, coordinate),
            lastSubSinceIndex,
          ));
          if (!loadCurrent()) { release(); return; }
          promoteSource(source, release, false);
        } else if (loadedSource) {
          promoteSource(loadedSource, null, false);
        }
        initialization.succeeded = true;
      } else {
        const empty: ThreadRecord = {
          id: taskId,
          title: null,
          status: 'idle',
          mode: 'work' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          starred: false,
          gtdBucket: 'inbox',
          pinnedAt: null,
          currentTaskId: null,
          taskIds: [],
        };
        threadRef.current = empty;
        setThread(empty);
        initialization.succeeded = true;
      }
    }).catch((err) => {
      if (loadCurrent()) {
        setLoadError(t.chatShell.threadLoadFailed);
        setStatus('failed');
      }
    });

    return () => {
      // Invalidate in-flight async operations from this effect run
      mountGenRef.current++;
      currentLoadIdRef.current = null;
      loadedSource?.release?.();
    };
  }, [taskId, initialPrompt, initialFiles, draftPrompt, handleEvent, historyRefresh, replaySnapshot, promoteSource, renderScope, retainObserver, loadRevision]);

  const queuePrompt = useCallback((text: string, files: Array<{ filePath: string; name: string }> = []) => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    beginGoalAttempt();
    setGoalLoading(false);setGoalError(null);
    const desktop=getDesktopApi();
    if(taskId&&typeof desktop?.enqueueConversationInput==='function'&&typeof desktop.listConversationInputs==='function'){
      const value=trimmed||t.chatInput.processFiles,key=JSON.stringify([value,files.map(file=>file.filePath)]),previous=durableQueueRequest.current;
      const request=previous?.scope===renderScope&&previous.key===key?previous:{scope:renderScope,key,inputId:`input_${crypto.randomUUID()}`,pending:true};request.pending=true;durableQueueRequest.current=request;
      setQueuedPrompt({text:value,files,inputId:request.inputId,durable:true});
      void desktop.enqueueConversationInput({inputId:request.inputId,conversationId:taskId,prompt:value,filePaths:files.map(file=>file.filePath)}).then(async()=>{
        request.pending=false;if(durableQueueRequest.current===request)durableQueueRequest.current=null;
        if(liveRenderScope.current===renderScope)await durableQueueRefresh.current();
      }).catch(error=>{
        request.pending=false;if(liveRenderScope.current!==renderScope)return;
        if(durableQueueRequest.current===request){setGoalError(sanitizeUserFacingErrorMessage(error,t.chatShell.taskCreateFailed));setPrompt(current=>current||value);}
        void durableQueueRefresh.current();
      });
      return;
    }
    log.info(queuedPrompt ? 'queued_prompt_replace' : 'queued_prompt_submit', JSON.stringify({
      threadId: taskId,
      status,
      length: trimmed.length,
    }));
    setQueuedPrompt({ text: trimmed || t.chatInput.processFiles, files });
    if (taskId && desktop) void desktop.setGoalUserQueuePending({ threadId: taskId, pending: true });
  }, [beginGoalAttempt, queuedPrompt, status, taskId, renderScope,t.chatInput.processFiles,t.chatShell.taskCreateFailed]);

  const cancelQueuedPrompt = useCallback(() => {
    if (liveRenderScope.current !== renderScope) return;
    const desktop=getDesktopApi();
    if(taskId&&typeof desktop?.cancelConversationInput==='function'){
      const inputId = durableQueueRows.current.find(row => row.status === 'pending')?.inputId ?? (queuedPrompt?.durable ? queuedPrompt.inputId : undefined);
      if (!inputId) return;
      void desktop.cancelConversationInput({conversationId:taskId,inputId}).then(async view => {
        if (liveRenderScope.current !== renderScope) return;
        if (view.conversationId === taskId && !view.items.some(row => row.inputId === inputId && row.status === 'pending')) {
          setQueuedPrompt(previous => previous?.inputId === inputId ? null : previous);
          durableQueueRows.current = durableQueueRows.current.filter(row => row.inputId !== inputId);
        }
        await durableQueueRefresh.current();
      }).catch(error => { if (liveRenderScope.current === renderScope) setQueueFailure({scope:renderScope,message:sanitizeUserFacingErrorMessage(error,t.requestFailed)}); }); return;
    }
    if (queuedPrompt) {
      log.info('queued_prompt_cancel', JSON.stringify({
        threadId: taskId,
        status,
        length: queuedPrompt.text.length,
      }));
    }
    setQueuedPrompt(null);
    if (taskId && desktop) void desktop.setGoalUserQueuePending({ threadId: taskId, pending: false });
  }, [queuedPrompt, status, taskId,renderScope,t.requestFailed]);

  useEffect(() => {
    const refresh = () => { if (taskId) void api.getThread(taskId).then(record => { if (record?.id === threadRef.current?.id) { threadRef.current = record; setThread(record); } }).catch(() => {}); };
    window.addEventListener('xiaok:legacy-claimed', refresh);
    return () => window.removeEventListener('xiaok:legacy-claimed', refresh);
  }, [taskId]);

  useEffect(()=>{
    const desktop=getDesktopApi();if(!taskId||typeof desktop?.listConversationInputs!=='function'||typeof desktop.onConversationInputsChanged!=='function')return;
    let live=true,generation=0,retries=0;let retryTimer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      const ticket=++generation,capturedIntent=goalAttemptRef.current;
      try{
        const view=await desktop.listConversationInputs({conversationId:taskId});
        if(!live||liveRenderScope.current!==renderScope||ticket!==generation||view.conversationId!==taskId)return;
        retries=0;durableQueueRows.current=view.items;
        setQueueFailure(view.failedInput?{scope:renderScope,message:t.contextContinuity.queuePreparationFailed+'\n'+(view.failedInput.unavailable?t.contextContinuity.queueInputUnavailable:view.failedInput.prompt)}:null);
        const pending=view.items.filter(row=>row.status==='pending');
        setQueuedPrompt(previous=>pending.length?{text:(view.pauseReason==='execution_authorization_changed'?t.contextContinuity.queueAuthorizationChanged+'\n':view.pauseReason==='input_unavailable'?t.contextContinuity.queueInputUnavailable+'\n':'')+pending.map(row=>row.unavailable?t.contextContinuity.queueInputUnavailable:row.prompt).join('\n'),files:[],inputId:pending[0]!.inputId,durable:true}
          :durableQueueRequest.current?.scope===renderScope&&durableQueueRequest.current.pending?previous
          :view.pauseReason?{text:view.pauseReason==='input_unavailable'?t.contextContinuity.queueInputUnavailable:t.contextContinuity.queueUnknown,files:[],durable:true}:previous?.durable?null:previous);
        const initialization=initializationRef.current;if(initialization?.scope===renderScope)await initialization.promise;
        if(!live||liveRenderScope.current!==renderScope||ticket!==generation||goalAttemptRef.current!==capturedIntent)return;
        if(view.currentTaskId&&threadRef.current?.id===taskId&&view.currentTaskId!==threadRef.current.currentTaskId){
          const actual=await api.getThread(taskId);if(!live||ticket!==generation||liveRenderScope.current!==renderScope||goalAttemptRef.current!==capturedIntent||actual?.id!==taskId||!actual.currentTaskId)return;
          threadRef.current=actual;setThread(actual);const attempt=capturedIntent??beginGoalAttempt();setHistoryRefresh({scope:renderScope,attempt});
        }
      }catch(error){
        if(!live||ticket!==generation||liveRenderScope.current!==renderScope)return;
        setQueueFailure(null);
        if(String(error).includes('input_queue_changed')&&retries++<2){retryTimer=setTimeout(()=>{void refresh();},10);return;}
        setGoalError(sanitizeUserFacingErrorMessage(error,t.chatShell.taskCreateFailed));
      }
    };
    durableQueueRefresh.current=refresh;
    const refreshCurrent=()=>{setQueueFailure(null);void refresh();};
    const unsubscribe=desktop.onConversationInputsChanged(event=>{if(event.conversationId===taskId)refreshCurrent();});window.addEventListener('focus',refreshCurrent);void refresh();
    return()=>{live=false;generation++;unsubscribe();window.removeEventListener('focus',refreshCurrent);if(retryTimer)clearTimeout(retryTimer);if(durableQueueRefresh.current===refresh)durableQueueRefresh.current=async()=>{};durableQueueRows.current=[];};
  },[taskId,renderScope,beginGoalAttempt,t.contextContinuity.queueUnknown,t.contextContinuity.queueAuthorizationChanged,t.contextContinuity.queuePreparationFailed,t.contextContinuity.queueInputUnavailable,t.chatShell.taskCreateFailed]);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>, intent: 'composer' | 'interrupted_choice' = 'composer') => {
    if (intent === 'composer' && !hideObservationControls && text.trim().split(/\s+/)[0] === '/observation') {
      if (files?.length) return false;
      await observationCommands.current?.execute('status');
      return;
    }
    if (!taskId || admissionPending.current === renderScope) return false;
    setActionError(null);
    if (observationDraft && files?.length) {
      // Reuse the ordinary task error message position; no Goal panel is required.
      setMessages(previous => [...previous, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: t.observation.filesUnsupported,
      }]);
      return false;
    }

    if(currentQuestion?.kind==='freeform'&&files?.length){setActionError(t.assistantInbox.answerFilesUnsupported);return false;}
    if(currentQuestion?.kind==='freeform'&&thread?.currentTaskId&&!files?.length){
      const source=displaySourceRef.current;if(!source||!acceptsSource(source))return false;
      admissionPending.current=renderScope;
      try{await api.answerQuestion({taskId:thread.currentTaskId,answer:{questionId:currentQuestion.questionId,type:'text',text}});if(!acceptsSource(source))return false;setCurrentQuestion(null);setStatus('running');setPrompt('');return true;}
      catch(error){const secret=error instanceof Error&&error.message.includes('credential_secure_input_required');if(secret)setPrompt('');setActionError(secret?t.secureCredentials.errors.credential_secure_input_required:t.chatShell.answerFailed);return false;}
      finally{if(admissionPending.current===renderScope)admissionPending.current=null;}
    }
    if (thread?.coverage === 'unclaimed' || thread?.legacyTaskIds?.length) { setGoalError(t.contextContinuity.legacyMustClaim); return false; }

    // If streaming is active, queue the message instead of interrupting
    if (status === 'running') {
      queuePrompt(text, files ?? []);
      return;
    }
    admissionPending.current = renderScope;
    const attempt = beginGoalAttempt();
    setGoalLoading(false);
    setGoalError(null);
    const current = () => currentAttempt(attempt);

    toolStepsMsgIdRef.current = null;

    setRepetitionStopped(false);
    repetitionRequestRef.current = { text, files };
    // Add user message immediately (include file names in content)
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: formatUserMessageContent(text, files, t.chatShell.attachmentLabel),
    };
    const sealedResultCard = buildResultCardMessage({
      idHint: `${thread?.currentTaskId || 'current'}-${Date.now()}`,
      result,
      generatedFiles: collectGeneratedFilesForTurn(currentTaskEventsRef.current, [result?.summary || '', streamingText]),
    });
    setMessages(prev => sealedResultCard ? [...prev, sealedResultCard, userMsg] : [...prev, userMsg]);
    setStatus('running');
    cancelStreamingFlush();
    setStreamingText('');
    clearUiPreviews();
    streamRef.current = '';
    currentTaskEventsRef.current = [];
    setResult(null);

    // Update thread title only on first user message (keep original topic as title)
    if (taskId && !titleLockedRef.current && !thread?.title?.trim() && messages.filter(m => m.role === 'user').length === 0) {
      titleLockedRef.current = true;
      api.updateThreadTitle(taskId, text.slice(0, 40)).catch(() => {});
    }

    const contextTaskIds = (thread?.taskIds ?? [])
      .flatMap(id => {
        const trimmed = id.trim();
        return trimmed ? [trimmed] : [];
      });
    const submitContext = {
      threadId: thread?.id ?? taskId,
      ...(contextTaskIds.length > 0 ? { taskIds: contextTaskIds } : {}),
    };

    try {
      // Send prompt plus thread task references; main rebuilds model history from persisted snapshots.
      let newTaskId: string;
      if (observationDraft && intent === 'composer') {
        const draftId=observationDraft;setObservationDraft(null);
        newTaskId=(await api.createObservationTask({draftId,prompt:text,threadId:thread?.id??taskId})).taskId;
      } else {
        // A gesture belongs to this event, outside the technical retry closure.
        // Main captures the durable identity; React retains only this wire.
        const wire:UserTaskSubmissionInput={action:'submit_new',gestureId:crypto.randomUUID(),input:files?.length
          ?{kind:'files',prompt:text,filePaths:files.map(file=>file.filePath),context:submitContext}
          :{kind:'materials',prompt:text,materials:[],context:submitContext}};
        newTaskId=(await createGoalAwareTaskWithRetry(()=>api.submitUserTask(wire))).taskId;
      }
      if (!current()) return false;

      setMessages(previous => previous.map(message => message.id === userMsg.id ? { ...message, contextSource: { sourceId: newTaskId, sourceMessageId: publicTaskMessageKey('user') } } : message));
      // Update thread with new taskId
      await api.updateThreadTaskId(taskId, newTaskId);
      if (!current()) return false;
      setPrompt(previous => previous === text ? '' : previous);
      setThread(prev => prev ? {
        ...prev,
        currentTaskId: newTaskId,
        taskIds: prev.taskIds.includes(newTaskId) ? prev.taskIds : [...prev.taskIds, newTaskId],
      } : prev);

      const source: DisplaySource = { scope: renderScope, sourceTaskId: newTaskId, intentOwner: attempt,
        eventCount: 0, terminalSeen: false, streamEnded: false };
      const release = retainObserver(source, api.subscribeTask(newTaskId, (event, coordinate) => handleEvent(event, source, coordinate)));
      if (!current()) { release(); return false; }
      promoteSource(source, release, false);
      if(taskId===ASSISTANT_CHAT_THREAD){
        // Main's task creation time is the shared live/replay timeline anchor.
        // Metadata failure leaves an un-timed pending turn; never invent now().
        void api.recoverTask(newTaskId).then(({snapshot})=>{
          if(liveRenderScope.current!==renderScope||snapshot?.taskId!==newTaskId||!Number.isFinite(snapshot.createdAt))return;
          setMessages(previous=>previous.map(message=>message.id===userMsg.id?{...message,createdAt:snapshot.createdAt}:message));
        }).catch(()=>{});
      }
    } catch (e) {
      if (!current()) return false;
      const errorCode=e instanceof Error?e.message:String(e);
      const submissionMessage=errorCode.includes('user_submission_conflict')?t.chatShell.submissionConflict
        :errorCode.includes('user_submission_not_prepared')?t.chatShell.submissionNotPrepared
        :/user_submission_(?:reconciliation_required|write_unconfirmed|record_invalid|prepared_unverified|prepared_mismatch|prepared_changed|result_invalid|storage_changed|lock_unconfirmed|revision_exhausted)/.test(errorCode)?t.chatShell.submissionReconciliationRequired:undefined;
      const displayMessage = submissionMessage??sanitizeUserFacingErrorMessage(e, t.chatShell.taskCreateFailed);
      log.error('handleSubmit error', JSON.stringify({ message: displayMessage, raw: e instanceof Error ? e.message : String(e) }));
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: displayMessage,
      }]);
      setStatus('idle');
      return false;
    } finally {
      if (admissionPending.current === renderScope) admissionPending.current = null;
    }
  };

  const handleInterruptedChoice = (choiceId: string) => {
    const source = displaySourceRef.current;
    if (!interruptedTask || !thread || currentQuestion || (status !== 'failed' && status !== 'idle')
      || !source || source.scope !== renderScope || !acceptsSource(source) || !source.terminalSeen
      || source.sourceTaskId !== interruptedTask.taskId || thread.taskIds.at(-1) !== interruptedTask.taskId
      || admissionPending.current === renderScope) return false;
    const choice = interruptedTask.choices?.find(item => item.id === choiceId);
    if (!choice) return false;
    // Normal submission owns synchronous admission/deduplication; the expired execution is never answered.
    return handleSubmit(choice.label, undefined, 'interrupted_choice');
  };

  const handleAnswer = async (choiceId: string) => {
    const source = displaySourceRef.current;
    if (!currentQuestion || !thread?.currentTaskId || !source || !acceptsSource(source) || admissionPending.current===renderScope) return;
    const answered=currentQuestion,namespace=nativeQuestionNamespace(answered);
    admissionPending.current=renderScope;
    setActionError(null);
    try {
    await api.answerQuestion({
      taskId: thread.currentTaskId,
      answer: { questionId: answered.questionId, type: 'choice', choiceId },
    });
    if (!acceptsSource(source) || source.terminalSeen) return;
    if(namespace){
      if(source.questions?.namespace!==namespace)return;
      source.questions=reduceNativeQuestionPresentation(source.questions,{type:'question_resolved',questionId:answered.questionId},source.sourceTaskId);
      setCurrentQuestion(source.questions.current);
      setStatus(source.questions.current||source.questions.native.length?'waiting_user':'running');return;
    }
    if(source.questions?.native.length){
      const state=source.questions,current=state.current;
      if(current?.owner?.kind!=='codex_native_approval'&&current?.questionId===answered.questionId)source.questions={...state,current:state.native.at(-1)??null};
      setCurrentQuestion(source.questions.current);setStatus('waiting_user');return;
    }
    if(source.questions)source.questions={...source.questions,current:null};
    setCurrentQuestion(null);
    setStatus('running');
    } catch(error) { if (acceptsSource(source)) setActionError(error instanceof Error&&error.message.includes('credential_secure_input_required')?t.secureCredentials.errors.credential_secure_input_required:t.chatShell.answerFailed); }
    finally {if(admissionPending.current===renderScope)admissionPending.current=null;}
  };

  const updateComputerUseActionMessage = (messageId: string, patch: Partial<ComputerUseActionData>) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId || !msg.computerUseAction) return msg;
      return {
        ...msg,
        computerUseAction: {
          ...msg.computerUseAction,
          ...patch,
        },
      };
    }));
  };

  const handleComputerUseAction = async (messageId: string, action: ComputerUseActionData) => {
    updateComputerUseActionMessage(messageId, { status: 'working', detail: t.chatShell.cuProcessing });
    try {
      const dispatch = resolveComputerUseUserAction(action.actionType, action.code);
      if (!dispatch) {
        updateComputerUseActionMessage(messageId, { status: 'failed', detail: t.chatShell.cuActionUnsupported });
        return;
      }
      if (dispatch.type === 'settings') {
        await api.openPluginDependencyPermissionSettings({ permission: dispatch.permission });
        updateComputerUseActionMessage(messageId, { status: 'idle', detail: t.chatShell.cuSettingsOpened });
        return;
      }
      const next = dispatch.type === 'enable' ? await api.enableComputerUse() : await api.reconnectComputerUse();
      if (next.state === 'ready') {
        updateComputerUseActionMessage(messageId, { status: 'ready', detail: t.chatShell.cuReady });
      } else if (next.state === 'connected_no_target') {
        updateComputerUseActionMessage(messageId, { status: 'idle', detail: t.chatShell.cuConnectedNoTarget });
      } else {
        updateComputerUseActionMessage(messageId, { status: 'failed', detail: next.lastError || t.chatShell.cuConnectFailed });
      }
    } catch (error) {
      updateComputerUseActionMessage(messageId, {
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleComputerUseDismiss = (messageId: string) => {
    try {
      window.localStorage.setItem('xiaok.computerUse.declinedUntil', String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {
      // Best-effort cooldown only.
    }
    updateComputerUseActionMessage(messageId, { status: 'dismissed', detail: t.chatShell.cuDismissed });
  };

  const clearCancelledTaskPresentation = () => {
    const source = displaySourceRef.current;
    if (source) source.uiPreviewClosed = true;
    const pending = streamRef.current;
    if (source && acceptsSource(source) && pending.trim()
      && (source.inlineUiNarrationCommitted || source.inlineUiArtifacts?.size || source.inlineUiPreviewKeys?.size)) {
      source.inlineUiNarrationCommitted = true;
      setMessages(previous => [...previous, { id: `inline-cancel:${source.sourceTaskId}:${source.eventCount}`, role: 'assistant', content: pending }]);
    }
    setStatus('idle');
    streamRef.current = '';
    cancelStreamingFlush();
    setStreamingText('');
    clearUiPreviews();
  };

  const handleCancel = async () => {
    const source = displaySourceRef.current;
    if (!thread?.currentTaskId || !source || !acceptsSource(source)) return;
    await api.cancelTask(thread.currentTaskId);
    if (!acceptsSource(source) || source.terminalSeen) return;
    clearCancelledTaskPresentation();
  };

  const runGoalControl = async (
    action: () => Promise<DesktopGoalControlReceipt>,
    clearTaskPresentation = false,
  ) => {
    const attempt = beginGoalAttempt();
    await runGoalAttempt(attempt, async () => {
      const next = await action();
      if (!currentAttempt(attempt)) return;
      if (next?.threadId !== taskId || !['paused', 'cancelled'].includes(next.status) || !Number.isSafeInteger(next.revision) || next.revision < 1) throw new Error('invalid_goal_control_reply');
      goalReadBarrier.current = { attempt, sequence: 0 };
      setGoal(null);
      setGoalControl(next);
      // Invalidate the old observer before clearing its data. Only fresh,
      // authorized recoveries may repopulate history after this control.
      const previous = displaySourceRef.current;
      displaySourceRef.current = null;
      previous?.release?.();
      unsubRef.current?.(); unsubRef.current = null;
      mountGenRef.current++;
      if (clearTaskPresentation) clearCancelledTaskPresentation();
      resultRef.current = null; setResult(null); setMessages([]); setCurrentQuestion(null); setPlanSteps([]);
      currentTaskEventsRef.current = []; allEventsRef.current = [];
      toolStepsMsgIdRef.current = null; toolStepsActiveRef.current = false;
      setCanvasOpen(false); setCanvasPreviewFile(undefined); setCanvasPreviewContent(undefined); setCanvasSourceArtifact(undefined);
      setHistoryRefresh({ scope: renderScope, attempt });
      void refreshControlledGoal();
    });
  };

  const runGoalMutation = async (
    action: () => Promise<DesktopGoalProjection | null>,
    clearTaskPresentation = false,
  ) => {
    const attempt = beginGoalAttempt();
    await runGoalAttempt(attempt, async () => {
      const next = await action();
      if (!currentAttempt(attempt)) return;
      applyGoal(next);
      if (clearTaskPresentation) clearCancelledTaskPresentation();
    });
  };

  const acceptGoalReply = async (attempt: GoalAttempt, reply: DesktopGoalMutationResult, objective?: string) => {
    if (!currentAttempt(attempt)) return;
    const prepared = reply?.preparedTask;
    if (!validPrepared(prepared) || prepared.attachmentSource?.kind !== 'request'
      || prepared.attachmentSource.requestId !== attempt.requestId || !attempt.requestId
      || reply.goal?.state.goalId !== prepared.goalRef.goalId || reply.goal.state.epoch !== prepared.executionScope.epoch) {
      throw new Error('invalid_goal_attachment_reply');
    }
    goalReadBarrier.current = { attempt, sequence: 0 };
    setGoalControl(null);
    applyGoal(reply.goal);
    if (objective) setMessages(previous => [...previous, {
      id: `msg-${Date.now()}-goal-user`, role: 'user', content: objective,
    }]);
    await attachGoalTask(prepared, attempt);
  };

  const refreshGoalNative = async (attempt: GoalAttempt) => {
    const desktop = getDesktopApi();
    if (!taskId || !desktop?.getGoalNativeMutation) return;
    try { const next = await desktop.getGoalNativeMutation(taskId); if (currentAttempt(attempt)) setGoalNativeMutation(next); }
    catch { /* Keep the original operation error; never infer approval. */ }
  };

  const handleGoalNativeAction = async (action: 'recover' | 'continue' | 'cancel') => {
    const desktop = getDesktopApi();
    if (!taskId || !desktop) return;
    const attempt = beginGoalAttempt(action === 'continue');
    await runGoalAttempt(attempt, async () => {
      if (action === 'continue') await acceptGoalReply(attempt, await desktop.continueGoalNativeMutation({ threadId: taskId, requestId: attempt.requestId }));
      else if (action === 'recover') {
        const result = await desktop.recoverGoalNativeMutation({ threadId: taskId });
        if (currentAttempt(attempt)) { setGoalNativeMutation(result.mutation); applyGoal(result.goal); }
      } else {
        const result = await desktop.cancelGoalNativeMutation({ threadId: taskId });
        if (currentAttempt(attempt)) setGoalNativeMutation(result);
      }
    });
    await refreshGoalNative(attempt);
  };

  const handleGoalCreate = async (input: GoalCreationInput) => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    const attempt = beginGoalAttempt(true);
    await runGoalAttempt(attempt, async () => {
      const reply = await desktop.createGoal({ threadId: taskId, ...input, requestId: attempt.requestId });
      await acceptGoalReply(attempt, reply, input.objective);
    });
    await refreshGoalNative(attempt);
  };

  const handleGoalReplace = async (input: GoalCreationInput) => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    const attempt = beginGoalAttempt(true);
    await runGoalAttempt(attempt, async () => {
      const reply = await desktop.replaceGoal({ threadId: taskId, ...input, requestId: attempt.requestId });
      await acceptGoalReply(attempt, reply, input.objective);
    });
    await refreshGoalNative(attempt);
  };

  const handleGoalResume = async (turnLimit?: number) => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    const attempt = beginGoalAttempt(true);
    await runGoalAttempt(attempt, async () => {
      const reply = await desktop.resumeGoal({
        threadId: taskId, requestId: attempt.requestId, ...(turnLimit === undefined ? {} : { turnLimit }),
      });
      await acceptGoalReply(attempt, reply);
    });
  };

  useEffect(() => {
    return () => {
      unsubRef.current?.();
      if (streamRafRef.current !== null) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
    };
  }, []);

  // Drain queued prompt when current task completes
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  useEffect(() => {
    if(typeof getDesktopApi()?.enqueueConversationInput==='function')return;
    if (queuedPrompt && (status === 'idle' || status === 'completed')) {
      const queued = queuedPrompt;
      log.info('queued_prompt_drain_start', JSON.stringify({
        threadId: taskId,
        status,
        length: queued.text.length,
      }));
      if (queuedDrainTimerRef.current !== null) {
        clearTimeout(queuedDrainTimerRef.current);
      }
      const timerId = setTimeout(() => {
        if (queuedDrainTimerRef.current === timerId) {
          queuedDrainTimerRef.current = null;
        }
        setQueuedPrompt(null);
        log.info('queued_prompt_execute', JSON.stringify({
          threadId: taskId,
          status,
          length: queued.text.length,
        }));
        void handleSubmitRef.current(queued.text, queued.files);
      }, 100);
      queuedDrainTimerRef.current = timerId;
      return () => {
        if (queuedDrainTimerRef.current === timerId) {
          clearTimeout(timerId);
          queuedDrainTimerRef.current = null;
        }
      };
    }
  }, [status, queuedPrompt, taskId]);

  useEffect(() => {
    return () => {
      if (queuedDrainTimerRef.current !== null) {
        clearTimeout(queuedDrainTimerRef.current);
        queuedDrainTimerRef.current = null;
      }
    };
  }, []);

  const openArtifactInCanvas = useCallback(async (artifact: ArtifactOpenInfo, options?: ArtifactOpenOptions) => {
    let content = '';
    if (artifact.filePath) {
      const r = await api.readFileContent(artifact.filePath);
      content = r.content;
    }
    sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
    setCanvasPreviewFile(artifact.filePath ?? artifact.title);
    setCanvasPreviewContent(content);
    setCanvasSourceArtifact({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      title: artifact.title,
      sourceTaskId: artifact.sourceTaskId ?? thread?.currentTaskId ?? undefined,
    });
    setCanvasPreviewModeRequest((request) => ({
      id: request.id + 1,
      startInEditMode: Boolean(options?.startInEditMode),
    }));
    setCanvasExpanded(true);
    sidebarCollapse.setCollapsed(true);
    setCanvasOpen(true);
  }, [sidebarCollapse.collapsed, sidebarCollapse.setCollapsed, thread?.currentTaskId]);

  if (loadError) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-4 p-6 text-[var(--c-text-secondary)]" aria-label={t.chatShell.threadLoadFailed}>
        <div role="alert" className="max-w-md text-center">
          <h2 className="text-base font-medium text-[var(--c-text-primary)]">{loadError}</h2>
          <p className="mt-2 text-sm">{t.chatShell.threadLoadHelp}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="rounded border border-[var(--c-border-subtle)] px-4 py-2 text-sm hover:bg-[var(--c-bg-deep)]"
            onClick={() => { sidebarCollapse.setCollapsed(false); navigate('/'); }}>{t.chatShell.backToTasks}</button>
          <button type="button" className="rounded bg-[var(--c-accent)] px-4 py-2 text-sm text-white hover:opacity-90"
            onClick={() => { setLoadError(null); setLoadRevision(value => value + 1); }}>{t.chatShell.reloadThread}</button>
        </div>
      </section>
    );
  }

  if (!thread) {
    return <div role="status" className="flex h-full items-center justify-center text-[var(--c-text-secondary)]">{t.chatShell.threadLoading}</div>;
  }

  // Extract generated files from multiple sources
  const generatedFiles = (() => {
    const textsToScan: string[] = [];
    if (result?.summary) textsToScan.push(result.summary);
    if (streamingText) textsToScan.push(streamingText);
    const lastUserIndex = [...messages].reverse().findIndex(msg => msg.role === 'user');
    const currentTurnMessages = lastUserIndex === -1
      ? messages
      : messages.slice(messages.length - lastUserIndex);
    for (const msg of currentTurnMessages) {
      if (msg.role === 'assistant' && msg.content) textsToScan.push(msg.content);
    }
    return collectGeneratedFilesForTurn(currentTaskEventsRef.current, textsToScan);
  })();

  const showGoalPanel = goal !== null || (goalNativeMutation !== null && goalNativeMutation.status !== 'applied') || goalControl?.threadId === taskId || state?.createGoal === true;
  const showTaskPanel = planSteps.length > 0 || showGoalPanel;
  const goalContent = showGoalPanel ? (
    <GoalBar
      key={taskId}
      goal={goal}
      nativeMutation={goalNativeMutation}
      onRecoverNative={() => handleGoalNativeAction('recover')}
      onContinueNative={() => handleGoalNativeAction('continue')}
      onCancelNative={() => handleGoalNativeAction('cancel')}
      controlStatus={goalControl && goalControl.threadId === taskId ? goalControl.status : undefined}
      initialEditing={state?.createGoal === true}
      loading={goalLoading}
      error={goalError}
      onCreate={handleGoalCreate}
      onReplace={handleGoalReplace}
      onPause={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalControl(() => desktop.pauseGoal(taskId), true);
      }}
      onResume={handleGoalResume}
      onRecoverPublication={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalMutation(() => desktop.recoverGoalPublication({ threadId: taskId }));
      }}
      onContinuePublication={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalMutation(() => desktop.continueGoalPublication({ threadId: taskId }));
      }}
      onCancel={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalControl(() => desktop.cancelGoal(taskId), true);
      }}
    />
  ) : undefined;

  const taskContent = showTaskPanel ? (
        <TaskPanel
          planSteps={planSteps}
          deliveryConnection={multiAgent.connection}
          sourceTaskId={thread.currentTaskId ?? undefined}
          status={status}
          result={result}
          generatedFiles={generatedFiles}
          goalContent={goalContent}
          onFileClick={async (file) => {
            let content = '';
            try {
              const r = await api.readFileContent(file.filePath);
              content = r.content;
            } catch { /* ignore */ }
            sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
            setCanvasPreviewFile(file.filePath);
            setCanvasPreviewContent(content);
            setCanvasSourceArtifact(undefined);
            setCanvasPreviewModeRequest((request) => ({ id: request.id + 1, startInEditMode: false }));
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            setCanvasOpen(true);
          }}
          onArtifactClick={openArtifactInCanvas}
        />
      ) : null;
  const canvasContent = canvasOpen ? (
        <CanvasPanel
          embedded
          interactionActive={canvasVisible}
          events={allEventsRef.current}
          conversationId={taskId ?? ''}
          sourceTaskId={thread?.currentTaskId ?? undefined}
          sourceArtifact={canvasSourceArtifact}
          onClose={() => { setCanvasOpen(false); setCanvasExpanded(false); sidebarCollapse.setCollapsed(sidebarWasCollapsedRef.current); }}
          initialPreviewFile={canvasPreviewFile}
          initialPreviewContent={canvasPreviewContent}
          initialPreviewModeRequest={canvasPreviewModeRequest}
          expanded={canvasExpanded}
          onToggleExpand={() => {
            const next = !canvasExpanded;
            setCanvasExpanded(next);
            sidebarCollapse.setCollapsed(next);
          }}
          onAnnotation={(msg) => {
            setPrompt(msg);
            handleSubmit(msg);
          }}
        />
      ) : null;
  return (
    <ChatRightSurface key={taskId ?? ''} threadId={taskId ?? ''} agentCount={multiAgent.summary.total}
      pendingApprovalCount={multiAgent.summary.pendingApprovalCount}
      hasAgentHistory={multiAgent.summary.hasAgentHistory} needsRecovery={multiAgent.summary.needsRecovery}
      historicalSelection={multiAgent.summary.historicalSelection} deleted={multiAgent.summary.deleted}
      taskContent={taskContent} canvasContent={canvasContent} canvasOpen={canvasOpen} canvasExpanded={canvasExpanded}
      canvasRequestId={canvasPreviewModeRequest.id} onCanvasVisibilityChange={setCanvasVisible}
      approvalContent={multiAgent.connection && multiAgent.api ? <ChatTaskApprovals connection={multiAgent.connection} api={multiAgent.api} sourceTaskId={thread.currentTaskId} /> : null}
      agentsContent={multiAgent.connection && multiAgent.api ? <MultiAgentPanel connection={multiAgent.connection} api={multiAgent.api}
        showApprovals={false} onSelectGroup={groupId => setAgentHistory({ threadId: taskId ?? '', groupId })} /> : <p className="p-4 text-sm">{t.multiAgent.unavailable}</p>}>
      {actionError && <div role="alert" className="mx-4 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-lg border border-[var(--c-border-subtle)] p-3 text-sm text-[var(--c-text-secondary)]">
        <p>{actionError}</p>
        <button type="button" className="shrink-0 text-xs text-[var(--c-accent)]" onClick={() => setActionError(null)}>{t.chatShell.dismissError}</button>
      </div>}
      {status === 'failed' && repetitionStopped && repetitionRequestRef.current && (
        <button type="button" className="px-4 py-2 text-[var(--c-accent)]" onClick={() => {
          setRepetitionStopped(false);
          const request = repetitionRequestRef.current;
          if (request) void handleSubmit(request.text, request.files);
        }}>{t.chatShell.regenerateReply}</button>
      )}
      <ChatView
        localCommands={hideObservationControls ? undefined : [{name: 'observation', description: t.observation.commandHint}]}
        inputAccessory={!hideObservationControls ? <ObservationControls key={taskId} ref={observationCommands} draftId={observationDraft} onDraft={setObservationDraft} taskId={thread?.currentTaskId ?? undefined} running={status==='running'} activityRevision={currentTaskEventsRef.current.length} /> : undefined}
        emptyContent={emptyContent}
        conversationHeader={conversationHeader}
        assistantContent={assistantContent??(isAssistantThread(taskId)&&taskId!==ASSISTANT_CHAT_THREAD?<AssistantWorkOutbox taskId={thread?.currentTaskId}/>:undefined)}
        assistantHasMessages={assistantHasMessages}
        assistantFocusKey={assistantFocusKey}
        onAssistantFocusHandled={onAssistantFocusHandled}
        activityContent={taskId ? <ConversationActivityPanel key={taskId} threadId={taskId} onNativeCoverage={setNativeActivityCoverage} /> : undefined}
        contextNavigation={location.search}
        executionConnection={multiAgent.connection}
        pendingApprovalCount={multiAgent.summary.pendingApprovalCount}
        thread={thread}
        messages={assistantTimeline}
        historyContent={olderHistory.remaining > 0 ? <div className="space-y-2 text-center">
          <button type="button" disabled={olderHistory.loading} onClick={() => void loadOlderHistory()}
            className="cursor-pointer rounded-lg px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-card)] disabled:cursor-wait disabled:opacity-60">
            {olderHistory.loading ? t.chatShell.historyLoading : t.chatShell.historyLoadEarlier(olderHistory.remaining)}
          </button>
          {olderHistory.error && <p role="alert" className="text-xs text-[var(--c-text-secondary)]">{olderHistory.error}</p>}
        </div> : undefined}
        streamingText={streamingText}
        uiPreviews={uiPreviews}
        status={status}
        currentQuestion={questionOutsideNativeActivity(currentQuestion,taskId,nativeActivityCoverage)}
        interruptedTask={interruptedTask}
        onInterruptedChoice={handleInterruptedChoice}
        result={result}
        generatedFiles={generatedFiles}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={handleSubmit}
        onQueue={queuePrompt}
        queuedText={queuedPrompt?.text ?? null}
        inputError={queueFailure?.scope===renderScope?queueFailure.message:null}
        onCancelQueue={queuedPrompt?.durable&&!queuedPrompt.inputId?undefined:cancelQueuedPrompt}
        onAnswer={handleAnswer}
        onCancel={handleCancel}
        onComputerUseAction={handleComputerUseAction}
        onComputerUseDismiss={handleComputerUseDismiss}
        canvasOpen={canvasVisible}
        initialFiles={!initialPrompt && initialFiles ? initialFiles.map(f => ({ filePath: f.filePath || '', name: f.name || f.originalName || '', isImage: false })) : undefined}
        onToggleCanvas={() => {
          if (canvasVisible) setCanvasOpen(false);
          else { setCanvasOpen(true); setCanvasPreviewModeRequest(previous => ({ ...previous, id: previous.id + 1 })); }
        }}
        onArtifactClick={openArtifactInCanvas}
        onArtifactOpenExternal={artifact => { if (artifact.filePath) window.open(toFileUrl(artifact.filePath), '_blank'); }}
      />
    </ChatRightSurface>
  );
}
