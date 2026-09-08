import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ArtifactOpenInfo, type ArtifactOpenOptions, type ChatMessage, type ComputerUseActionData, type GeneratedFile, type ToolStep } from './ChatView';
import { GoalBar } from './GoalBar';
import type { DesktopGoalMutationResult, DesktopGoalProjection, DesktopGoalTaskPrepared } from '../../../electron/preload-api';
import type { GoalInput } from '../../../../src/runtime/goal/types';
import { attachPreparedGoalTask } from '../lib/goal-task-attachment';
import { CanvasPanel } from './CanvasPanel';
import { TaskPanel } from './TaskPanel';
import { ChatRightSurface } from './ChatRightSurface';
import { MultiAgentPanel } from './MultiAgentPanel';
import { useMultiAgentConnection } from '../hooks/useMultiAgentConnection';
import type { ThreadRecord } from '../api/types';
import type { ArtifactKind, ArtifactSummary, DesktopTaskEvent, NeedsUserQuestion, TaskResult, TaskSnapshot } from '../../../shared/task-types';
import type { ArtifactWorkspaceSelectedArtifact } from '../../../shared/artifact-workspace-types';
import { useSidebarCollapse } from '../layouts/AppLayout';
import { useLocale } from '../contexts/LocaleContext';
import { sanitizeUserFacingErrorMessage } from '../lib/error-display';
import { parseScheduledTaskPromptDisplay } from '../lib/scheduled-task-prompt-display';
import { fileBasename, isAbsoluteFilePath, toFileUrl } from '../lib/file-path';
import { getDesktopApi } from '../shared/desktop';
import { getStreamingRenderDelay } from '../lib/streaming-render-policy';
import { parseComputerUseRecoverableAction } from '../lib/computer-use-recoverable-action';
import {
  buildProjectCardMessageFromToolResult,
  buildWorkflowMessageFromToolResult,
  type WorkflowLabels,
} from './chatToolResultMessages';

const log = createLogger('ChatShell');
const ARTIFACT_KINDS = new Set<ArtifactKind>(['pptx', 'pdf', 'docx', 'xlsx', 'html', 'image', 'text', 'a2ui', 'other']);
const THREAD_DRAFT_STORAGE_PREFIX = 'xiaok.threadDraft.';
const LEGACY_SWARM_CONTEXT_KEY = 'xiaok.swarmContinueContext';

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
  intentOwner: GoalAttempt | null;
  executionScope?: TaskSnapshot['executionScope'];
  eventCount: number;
  terminalSeen: boolean;
  streamEnded: boolean;
  resultSummaryInHistory?: string;
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
  for (const file of collectGeneratedFilesFromTexts(texts)) addGeneratedFile(files, seen, file.filePath);
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

function isComputerUseSettingsAction(actionType: string | undefined): boolean {
  return actionType === 'open_system_settings';
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

export function ChatShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const renderScope = useMemo<DisplayScope>(() => ({ taskId, attachmentObservers: new Set<() => void>() }), [taskId]);
  const liveRenderScope = useRef<typeof renderScope | null>(renderScope);
  const admissionPending = useRef<typeof renderScope | null>(null);
  useLayoutEffect(() => {
    liveRenderScope.current = renderScope;
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
  const sidebarCollapse = useSidebarCollapse();
  const { t } = useLocale();
  const [agentHistory, setAgentHistory] = useState<{ threadId: string; groupId?: string } | null>(null);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const sidebarWasCollapsedRef = useRef(false);
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  // Wait for the bound task before choosing its execution-state subscription.
  // Native Codex events already arrive through the standard task stream.
  const multiAgent = useMultiAgentConnection(taskId, agentHistory?.threadId === taskId ? agentHistory?.groupId : undefined,
    thread?.id === taskId && !thread?.currentTaskId?.startsWith('task_codex_'));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [goal, setGoal] = useState<DesktopGoalProjection | null>(null);
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
    return attempt;
  }, [renderScope]);
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

  const handleEvent = useCallback((rawEvent: { type: string }, source: DisplaySource) => {
    const event = rawEvent as DesktopTaskEvent;
    if (!acceptsSource(source) || source.streamEnded) return;
    source.eventCount += 1;
    const sourceTaskId = source.sourceTaskId;
    const live = !source.terminalSeen;
    if (event.type === 'task_terminal') {
      source.terminalSeen = true;
      source.streamEnded = true;
      setCurrentQuestion(null);
      setStatus(event.status === 'cancelled' ? 'idle' : event.status);
      source.release?.();
      return;
    }
    if (!live && (event.type === 'progress' || event.type === 'needs_user' || event.type === 'task_started')) return;

    const eventTaskKey = sourceTaskId ?? taskId ?? '';
    if (event.type !== 'error' || lastLiveErrorRef.current?.taskKey !== eventTaskKey) {
      lastLiveErrorRef.current = null;
    }

    // Collect all events for Canvas
    allEventsRef.current = [...allEventsRef.current, event];
    currentTaskEventsRef.current = [...currentTaskEventsRef.current, event];

    switch (event.type) {
      case 'task_started': {
        setPlanSteps([]);
        break;
      }
      case 'progress_plan_reported': {
        const ev = event as { type: 'progress_plan_reported'; steps: Array<{ id: string; label: string; status: string }> };
        setPlanSteps(ev.steps);
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
        setStatus('running');
        break;
      }
      case 'assistant_delta': {
        const delta = (event as { type: 'assistant_delta'; delta: string }).delta;
        streamRef.current += delta;
        flushStreamingText(source);
        if (live) setStatus('running');
        break;
      }
      case 'task_cancelled': {
        const partialText = (event as { type: 'task_cancelled'; partialText?: string }).partialText || streamRef.current;
        streamRef.current = '';
        cancelStreamingFlush();
        setStreamingText('');
        if (partialText.trim()) {
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}-assistant-cancelled`,
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
        const r = bindArtifactsToSourceTask((event as { type: 'result'; result: TaskResult }).result, sourceTaskId);
        const recordedArtifacts = currentTaskEventsRef.current
          .filter((e): e is Extract<DesktopTaskEvent, { type: 'artifact_recorded' }> => e.type === 'artifact_recorded')
          .map((recordedEvent) => artifactSummaryFromEvent(recordedEvent, sourceTaskId));
        const resultWithArtifacts = mergeTaskResultArtifacts(r, recordedArtifacts);
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
          if (finalContent) {
            source.resultSummaryInHistory = finalContent;
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              content: finalContent,
            }]);
          }
          setResult(resultWithArtifacts);
          resultRef.current = resultWithArtifacts;
          if (live) setStatus('completed');
          setPlanSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'completed' } : s));
          // Only set title if thread has no title yet (preserve user's prompt as title)
          if (taskId && !titleLockedRef.current) {
            titleLockedRef.current = true;
            api.updateThreadTitle(taskId, r.summary.slice(0, 40)).catch(() => {});
          }
        } else {
          // Desktop tasks: artifacts is [], but still set result for generatedFiles extraction
          const finalText = streamRef.current || r.summary;
          // Clear streaming FIRST to prevent one-frame duplicate display
          streamRef.current = '';
          cancelStreamingFlush();
          setStreamingText('');
          setResult(resultWithArtifacts);
          if (finalText.trim()) {
            source.resultSummaryInHistory = finalText;
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
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
        setCurrentQuestion(question => question?.questionId === event.questionId ? null : question);
        setStatus('running');
        break;
      }
      case 'needs_user': {
        setCurrentQuestion((event as { type: 'needs_user'; question: NeedsUserQuestion }).question);
        setStatus('waiting_user');
        break;
      }
      case 'error': {
        const msg = (event as { type: 'error'; message: string }).message;
        if (lastLiveErrorRef.current?.taskKey === eventTaskKey
          && lastLiveErrorRef.current.rawMessage === msg) {
          break;
        }
        lastLiveErrorRef.current = { taskKey: eventTaskKey, rawMessage: msg };
        const partialText = streamRef.current.trim();
        const reason = sanitizeUserFacingErrorMessage(msg, t.chatShell.taskCreateFailed, {
          providerAuth: t.chatShell.modelAuthFailed,
          providerService: t.chatShell.modelServiceFailed,
          modelUsageLimitReached: t.chatShell.modelUsageLimitReached,
        });
        streamRef.current = '';
        cancelStreamingFlush();
        setStreamingText('');
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
              role: 'assistant' as const,
              content: partialText,
            }] : []),
            {
              id: `msg-${Date.now()}-error`,
              role: 'assistant' as const,
              content: t.chatShell.taskExecutionFailed(reason),
            },
          ];
        });
        if (live) setStatus('failed');
        break;
      }
    }
  }, [taskId, t, acceptsSource]);

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
        if (snapshot.status === 'running' || snapshot.status === 'waiting_user') {
          setStatus(snapshot.status);
          if (snapshot.status === 'waiting_user') {
            const last = [...snapshot.events].reverse().find(event => event.type === 'needs_user');
            if (last?.type === 'needs_user') setCurrentQuestion(last.question);
          }
        } else if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
          source.terminalSeen = true;
          setStatus(snapshot.status === 'cancelled' ? 'idle' : snapshot.status);
          setCurrentQuestion(null);
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
          onEvent: event => handleEvent(event as DesktopTaskEvent, source),
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
    const initialCurrent = () => live && liveRenderScope.current === renderScope && goalAttemptRef.current === capturedAttempt;
    setGoalLoading(true);
    setGoalError(null);
    void desktop.getGoal(taskId).then(value => {
      if (initialCurrent()) applyGoal(value);
    }).catch(error => {
      if (initialCurrent()) setGoalError(sanitizeUserFacingErrorMessage(error, t.chatShell.taskCreateFailed));
    }).finally(() => {
      if (initialCurrent()) setGoalLoading(false);
    });
    const unsubscribeChanged = desktop.onGoalChanged(event => {
      if (live && liveRenderScope.current === renderScope && event.threadId === taskId) applyGoal(event.goal);
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
  }, [applyGoal, attachGoalTask, beginGoalAttempt, currentAttempt, renderScope, runGoalAttempt, taskId, t.chatShell.taskCreateFailed, validPrepared]);

  // Replay events from a single snapshot into messages
  // Returns { msgs, result, events } where events is for Canvas (not pushed to ref during replay)
  const replaySnapshot = useCallback((snapshot: { taskId?: string; events?: DesktopTaskEvent[]; prompt?: string; materials?: DisplayFileRef[] }, addPromptAsUser: boolean): { msgs: ChatMessage[]; result: TaskResult | null; events: DesktopTaskEvent[]; toolStepsMsgId: string | null } => {
    const msgs: ChatMessage[] = [];
    let lastResult: TaskResult | null = null;
    const replayEvents: DesktopTaskEvent[] = []; // Local array for Canvas, not ref
    if (addPromptAsUser && snapshot?.prompt) {
      const display = parseScheduledTaskPromptDisplay(snapshot.prompt);
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
        role: 'user',
        content: formatUserMessageContent(display.displayPrompt, snapshot.materials, t.chatShell.attachmentLabel),
      });
    }

    let replayToolMsgId: string | null = null;
    if (snapshot?.events && snapshot.events.length > 0) {
      let accumulated = '';
      let lastProgress: ChatMessage | null = null;
      let lastErrorMessage: string | null = null;
      // For replay, also collect tool_steps so past tasks show tool execution
      let replayToolSteps: ToolStep[] = [];
      const replayArtifacts: ArtifactSummary[] = [];
      for (const ev of snapshot.events) {
        if (ev.type === 'artifact_recorded') {
          replayArtifacts.push(artifactSummaryFromEvent(ev, snapshot.taskId));
          continue;
        }
        if (ev.type === 'progress_plan_reported') {
          const planEv = ev as { type: 'progress_plan_reported'; steps: Array<{ id: string; label: string; status: string }> };
          setPlanSteps(planEv.steps);
          continue;
        }
        if (ev.type === 'canvas_file_changed') {
          replayEvents.push(ev); // Collect locally
          continue;
        }
        if (ev.type === 'canvas_tool_call') {
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
          if (evR.ok && (evR.toolName === 'run_dynamic_workflow_script' || evR.toolName === 'get_dynamic_workflow_status')) {
            const message = buildWorkflowMessageFromToolResult(evR.response, t as WorkflowLabels);
            if (message) msgs.push(message);
          }
          if (evR.toolName === 'xiaok_computer_use') {
            const action = parseComputerUseRecoverableAction(evR.response, t.chatShell.cuUnavailable);
            if (action && !computerUseActionCodesRef.current.has(action.code)) {
              computerUseActionCodesRef.current.add(action.code);
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
        if (ev.type === 'progress') {
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
          const partialText = (ev as { partialText?: string }).partialText || accumulated;
          if (partialText.trim()) {
            msgs.push({
              id: `msg-assistant-cancelled-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: partialText,
            });
          }
          accumulated = '';
          lastProgress = null;
        } else if (ev.type === 'error') {
          const rawMessage = (ev as { type: 'error'; message: string }).message;
          if (accumulated.trim()) {
            msgs.push({
              id: `msg-assistant-partial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: accumulated,
            });
            accumulated = '';
          }
          lastProgress = null;
          if (rawMessage !== lastErrorMessage) {
            const reason = sanitizeUserFacingErrorMessage(rawMessage, t.chatShell.taskCreateFailed, {
              providerAuth: t.chatShell.modelAuthFailed,
              providerService: t.chatShell.modelServiceFailed,
              modelUsageLimitReached: t.chatShell.modelUsageLimitReached,
            });
            msgs.push({
              id: `msg-task-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: t.chatShell.taskExecutionFailed(reason),
            });
            lastErrorMessage = rawMessage;
          }
        } else if (ev.type === 'result') {
          const r = bindArtifactsToSourceTask((ev as { result: TaskResult }).result, snapshot.taskId);
          const resultWithArtifacts = mergeTaskResultArtifacts(r, replayArtifacts);
          const assistantContent = accumulated || r.summary;
          if (accumulated || r.summary) {
            msgs.push({
              id: `msg-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
          if (resultCard) msgs.push(resultCard);
          lastResult = resultWithArtifacts;
        }
      }
      if (replayToolSteps.length > 0 && replayToolMsgId) {
        msgs.push({ id: replayToolMsgId, role: 'tool_steps', content: '', steps: replayToolSteps, stepsLive: false });
      }
      if (lastProgress) {
        msgs.push(lastProgress);
      }
      if (accumulated) {
        streamRef.current = accumulated;
        setStreamingText(accumulated);
      }
    }
    return { msgs, result: lastResult, events: replayEvents, toolStepsMsgId: replayToolMsgId };
  }, [t]);

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
    setResult(null);
    setMessages([]);
    setPlanSteps([]);
    setCurrentQuestion(null);
    setThread(null);
    setStatus('idle');
    setLoadError(null);
    const storedDraft = readStoredThreadDraft(taskId);
    setPrompt(draftPrompt || '');

    // If we have an initialPrompt from WelcomePage, pre-populate
    if (initialPrompt) {
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
        const allTaskIds = (threadData.taskIds && threadData.taskIds.length > 0) ? threadData.taskIds
          : threadData.currentTaskId ? [threadData.currentTaskId] : [];
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
        for (const tid of allTaskIds) {
          // Check again after each async operation
          if (!loadCurrent()) return;

          try {
            const { snapshot } = await api.recoverTask(tid);
            if (!loadCurrent()) return;
            if (snapshot) {
              console.log(`[ChatShell] Replaying task=${tid} prompt="${snapshot.prompt?.slice(0, 40)}" status=${snapshot.status} events=${snapshot.events?.length}`);
              const isFirst = tid === allTaskIds[0];
              const addPrompt = Boolean(snapshot.prompt && (!isFirst || !initialPrompt));
              const { msgs: replayMsgs, result: replayResult, events: replayEvents, toolStepsMsgId: replayToolStepsMsgId } = replaySnapshot(
                { ...snapshot, taskId: snapshot.taskId || tid },
                addPrompt,
              );
              console.log(`[ChatShell] Replayed task=${tid} → ${replayMsgs.length} msgs, addPrompt=${addPrompt}`);
              allMessages.push(...replayMsgs);
              // Collect events for Canvas panel (merge into ref after all tasks processed)
              allEventsRef.current.push(...replayEvents);
              if (tid === allTaskIds[allTaskIds.length - 1]) {
                lastSnapshot = snapshot;
                currentTaskEventsRef.current = replayEvents;
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
          } catch { if (!loadCurrent()) return; /* skip failed task */ }
        }

        // Final check before setting any state
        if (!loadCurrent()) return;

        // Now set all state atomically after final check
        setThread(threadData);
        threadRef.current = threadData;
        if (allMessages.length > 0) {
          setMessages(allMessages);
        }
        if (lastResult) {
          setResult(lastResult);
        }
        setStatus(lastStatus);
        if (lastTaskIdForSub) {
          loadedSource = { scope: renderScope, sourceTaskId: lastTaskIdForSub, intentOwner: capturedIntent,
            executionScope: lastSnapshot?.executionScope, eventCount: lastSnapshot?.events.length ?? 0,
            terminalSeen: lastSnapshot?.status === 'completed' || lastSnapshot?.status === 'failed' || lastSnapshot?.status === 'cancelled', streamEnded: false };
        }
        if (lastTaskIdForSub && (lastStatus === 'running' || lastStatus === 'waiting_user')) {
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
            (event) => handleEvent(event, source),
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
        setLoadError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      }
    });

    return () => {
      // Invalidate in-flight async operations from this effect run
      mountGenRef.current++;
      currentLoadIdRef.current = null;
      loadedSource?.release?.();
    };
  }, [taskId, initialPrompt, initialFiles, draftPrompt, handleEvent, replaySnapshot, promoteSource, renderScope, retainObserver]);

  const queuePrompt = useCallback((text: string, files: Array<{ filePath: string; name: string }> = []) => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    beginGoalAttempt();
    setGoalLoading(false);
    setGoalError(null);
    log.info(queuedPrompt ? 'queued_prompt_replace' : 'queued_prompt_submit', JSON.stringify({
      threadId: taskId,
      status,
      length: trimmed.length,
    }));
    setQueuedPrompt({ text: trimmed || t.chatInput.processFiles, files });
    const desktop = getDesktopApi();
    if (taskId && desktop) void desktop.setGoalUserQueuePending({ threadId: taskId, pending: true });
  }, [beginGoalAttempt, queuedPrompt, status, taskId, t.chatInput.processFiles]);

  const cancelQueuedPrompt = useCallback(() => {
    if (queuedPrompt) {
      log.info('queued_prompt_cancel', JSON.stringify({
        threadId: taskId,
        status,
        length: queuedPrompt.text.length,
      }));
    }
    setQueuedPrompt(null);
    const desktop = getDesktopApi();
    if (taskId && desktop) void desktop.setGoalUserQueuePending({ threadId: taskId, pending: false });
  }, [queuedPrompt, status, taskId]);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    if (!taskId || admissionPending.current === renderScope) return false;

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
    streamRef.current = '';
    currentTaskEventsRef.current = [];
    setResult(null);

    // Update thread title only on first user message (keep original topic as title)
    if (taskId && messages.filter(m => m.role === 'user').length === 0) {
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
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await createGoalAwareTaskWithRetry(() => api.createTaskWithFiles({
          prompt: text, filePaths, context: submitContext,
        }));
        newTaskId = result.taskId;
      } else {
        const result = await createGoalAwareTaskWithRetry(() => api.createTask({
          prompt: text, materials: [], context: submitContext,
        }));
        newTaskId = result.taskId;
      }
      if (!current()) return false;

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
      const release = retainObserver(source, api.subscribeTask(newTaskId, event => handleEvent(event, source)));
      if (!current()) { release(); return false; }
      promoteSource(source, release, false);
    } catch (e) {
      if (!current()) return false;
      const displayMessage = sanitizeUserFacingErrorMessage(e, t.chatShell.taskCreateFailed);
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

  const handleAnswer = async (choiceId: string) => {
    const source = displaySourceRef.current;
    if (!currentQuestion || !thread?.currentTaskId || !source || !acceptsSource(source)) return;
    await api.answerQuestion({
      taskId: thread.currentTaskId,
      answer: { questionId: currentQuestion.questionId, type: 'choice', choiceId },
    });
    if (!acceptsSource(source) || source.terminalSeen) return;
    setCurrentQuestion(null);
    setStatus('running');
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
      if (isComputerUseSettingsAction(action.actionType)) {
        const permission = action.code === 'COMPUTER_USE_NEEDS_SCREEN_RECORDING' ? 'screen' : 'accessibility';
        await api.openPluginDependencyPermissionSettings({ permission });
        updateComputerUseActionMessage(messageId, { status: 'idle', detail: t.chatShell.cuSettingsOpened });
        return;
      }
      const next = await api.enableComputerUse();
      if (next.state === 'ready') {
        updateComputerUseActionMessage(messageId, { status: 'ready', detail: t.chatShell.cuReady });
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
    setStatus('idle');
    streamRef.current = '';
    cancelStreamingFlush();
    setStreamingText('');
  };

  const handleCancel = async () => {
    const source = displaySourceRef.current;
    if (!thread?.currentTaskId || !source || !acceptsSource(source)) return;
    await api.cancelTask(thread.currentTaskId);
    if (!acceptsSource(source) || source.terminalSeen) return;
    clearCancelledTaskPresentation();
  };

  const runGoalMutation = async (
    action: () => Promise<DesktopGoalProjection>,
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
    applyGoal(reply.goal);
    if (objective) setMessages(previous => [...previous, {
      id: `msg-${Date.now()}-goal-user`, role: 'user', content: objective,
    }]);
    await attachGoalTask(prepared, attempt);
  };

  const handleGoalCreate = async (input: GoalInput) => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    const attempt = beginGoalAttempt(true);
    await runGoalAttempt(attempt, async () => {
      const reply = await desktop.createGoal({ threadId: taskId, ...input, requestId: attempt.requestId });
      await acceptGoalReply(attempt, reply, input.objective);
    });
  };

  const handleGoalReplace = async (input: GoalInput) => {
    if (!taskId) return;
    const desktop = getDesktopApi();
    if (!desktop) return;
    const attempt = beginGoalAttempt(true);
    await runGoalAttempt(attempt, async () => {
      const reply = await desktop.replaceGoal({ threadId: taskId, ...input, requestId: attempt.requestId });
      await acceptGoalReply(attempt, reply, input.objective);
    });
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
      <div className="flex h-full flex-col items-center justify-center gap-4 text-[var(--c-text-secondary)]">
        <div className="text-red-500">
          Failed to load thread: {loadError}
        </div>
        <button
          type="button"
          className="rounded bg-[var(--c-primary)] px-4 py-2 text-white hover:opacity-90"
          onClick={() => {
            setLoadError(null);
            setStatus('idle');
            setThread(null);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!thread) {
    return <div className="flex h-full items-center justify-center text-[var(--c-text-secondary)]">Loading...</div>;
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

  const showGoalPanel = goal !== null || state?.createGoal === true;
  const showTaskPanel = planSteps.length > 0 || showGoalPanel;
  const goalContent = showGoalPanel ? (
    <GoalBar
      key={taskId}
      goal={goal}
      initialEditing={state?.createGoal === true}
      loading={goalLoading}
      error={goalError}
      onCreate={handleGoalCreate}
      onReplace={handleGoalReplace}
      onPause={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalMutation(() => desktop.pauseGoal(taskId), true);
      }}
      onResume={handleGoalResume}
      onCancel={() => {
        const desktop = getDesktopApi();
        if (taskId && desktop) return runGoalMutation(() => desktop.cancelGoal(taskId), true);
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
      agentsContent={multiAgent.connection && multiAgent.api ? <MultiAgentPanel connection={multiAgent.connection} api={multiAgent.api}
        onSelectGroup={groupId => setAgentHistory({ threadId: taskId ?? '', groupId })} /> : <p className="p-4 text-sm">{t.multiAgent.unavailable}</p>}>
      <ChatView
        executionConnection={multiAgent.connection}
        thread={thread}
        messages={messages}
        streamingText={streamingText}
        status={status}
        currentQuestion={currentQuestion}
        result={result}
        generatedFiles={generatedFiles}
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={handleSubmit}
        onQueue={queuePrompt}
        queuedText={queuedPrompt?.text ?? null}
        onCancelQueue={cancelQueuedPrompt}
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
