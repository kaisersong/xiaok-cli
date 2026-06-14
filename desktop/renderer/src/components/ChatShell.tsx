import { useEffect, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ChatMessage, type ComputerUseActionData, type GeneratedFile, type ToolStep } from './ChatView';
import { CanvasPanel } from './CanvasPanel';
import { TaskPanel } from './TaskPanel';
import type { ThreadRecord } from '../api/types';
import type { ArtifactKind, ArtifactSummary, DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../shared/task-types';
import { useSidebarCollapse } from '../layouts/AppLayout';
import { sanitizeUserFacingErrorMessage } from '../lib/error-display';
import {
  buildProjectCardMessageFromToolResult,
  buildWorkflowMessageFromToolResult,
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

function normalizeArtifactKind(kind: string): ArtifactKind {
  return ARTIFACT_KINDS.has(kind as ArtifactKind) ? kind as ArtifactKind : 'other';
}

function artifactSummaryFromEvent(event: Extract<DesktopTaskEvent, { type: 'artifact_recorded' }>): ArtifactSummary {
  return {
    artifactId: event.artifactId,
    kind: normalizeArtifactKind(event.kind),
    title: event.label,
    createdAt: event.turnId,
    previewAvailable: event.previewAvailable,
    filePath: event.filePath,
    mimeType: event.mimeType,
    creator: event.creator ?? 'agent',
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

function formatUserMessageContent(prompt: string, files?: DisplayFileRef[]): string {
  const fileNames = (files ?? [])
    .map(displayNameFromFileRef)
    .filter((name): name is string => Boolean(name));
  if (fileNames.length === 0) return prompt;
  return `${prompt}\n\n附件: ${fileNames.join(', ')}`;
}

function addGeneratedFile(target: GeneratedFile[], seen: Set<string>, fp: string | undefined): void {
  if (!fp || seen.has(fp)) return;
  seen.add(fp);
  const parts = fp.split('/');
  target.push({ filePath: fp, name: parts[parts.length - 1] });
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
      if (candidate.startsWith('/')) addGeneratedFile(files, seen, candidate);
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

function parseComputerUseRecoverableAction(response: string): ComputerUseActionData | null {
  try {
    const parsed = JSON.parse(response) as {
      ok?: unknown;
      code?: unknown;
      message?: unknown;
      userAction?: { type?: unknown; label?: unknown };
    };
    if (parsed.ok !== false || typeof parsed.code !== 'string' || !parsed.code.startsWith('COMPUTER_USE_')) {
      return null;
    }
    return {
      code: parsed.code,
      message: typeof parsed.message === 'string' ? parsed.message : 'Computer Use 当前不可用。',
      ...(typeof parsed.userAction?.type === 'string' ? { actionType: parsed.userAction.type } : {}),
      ...(typeof parsed.userAction?.label === 'string' ? { label: parsed.userAction.label } : {}),
      status: 'idle',
    };
  } catch {
    return null;
  }
}

function isComputerUseSettingsAction(actionType: string | undefined): boolean {
  return actionType === 'open_system_settings';
}

export function ChatShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const sidebarCollapse = useSidebarCollapse();
  const sidebarWasCollapsedRef = useRef(false);
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [canvasPreviewFile, setCanvasPreviewFile] = useState<string | undefined>();
  const [canvasPreviewContent, setCanvasPreviewContent] = useState<string | undefined>();
  const [planSteps, setPlanSteps] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const queuedDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef('');
  const currentLoadIdRef = useRef<string | null>(null);
  const mountGenRef = useRef(0);
  const allEventsRef = useRef<DesktopTaskEvent[]>([]);
  const currentTaskEventsRef = useRef<DesktopTaskEvent[]>([]);
  const toolStepsMsgIdRef = useRef<string | null>(null);
  const toolStepsActiveRef = useRef(false);
  const computerUseActionCodesRef = useRef<Set<string>>(new Set());

  // Read prompt state from navigation (WelcomePage initial submit or project help draft)
  const state = location.state as { initialPrompt?: string; initialFiles?: DisplayFileRef[]; draftPrompt?: string } | undefined;
  const initialPrompt = state?.initialPrompt;
  const initialFiles = state?.initialFiles;
  const draftPrompt = state?.draftPrompt;

  const handleEvent = useCallback((rawEvent: { type: string }) => {
    const event = rawEvent as DesktopTaskEvent;
    console.log('[ChatShell] event:', event.type);

    // Check if this event belongs to current task (prevent race condition from stale subscriptions)
    if (currentLoadIdRef.current !== taskId) {
      console.log('[ChatShell] ignoring stale event for', taskId, 'current is', currentLoadIdRef.current);
      return;
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
        setStreamingText(streamRef.current);
        setStatus('running');
        break;
      }
      case 'task_cancelled': {
        const partialText = (event as { type: 'task_cancelled'; partialText?: string }).partialText || streamRef.current;
        streamRef.current = '';
        setStreamingText('');
        if (partialText.trim()) {
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}-assistant-cancelled`,
            role: 'assistant',
            content: partialText,
          }]);
        }
        setCurrentQuestion(null);
        setStatus('idle');
        break;
      }
      case 'artifact_recorded': {
        const artifact = artifactSummaryFromEvent(event);
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
        const r = (event as { type: 'result'; result: TaskResult }).result;
        const recordedArtifacts = currentTaskEventsRef.current
          .filter((e): e is Extract<DesktopTaskEvent, { type: 'artifact_recorded' }> => e.type === 'artifact_recorded')
          .map(artifactSummaryFromEvent);
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
          setStreamingText('');
          if (finalContent) {
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              content: finalContent,
            }]);
          }
          setResult(resultWithArtifacts);
          setStatus('completed');
          setPlanSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'completed' } : s));
          // Only set title if thread has no title yet (preserve user's prompt as title)
          if (taskId && !thread?.title) {
            api.updateThreadTitle(taskId, r.summary.slice(0, 40)).catch(() => {});
          }
        } else {
          // Desktop tasks: artifacts is [], but still set result for generatedFiles extraction
          const finalText = streamRef.current || r.summary;
          // Clear streaming FIRST to prevent one-frame duplicate display
          streamRef.current = '';
          setStreamingText('');
          setResult(resultWithArtifacts);
          if (finalText.trim()) {
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              content: finalText,
            }]);
          }
          setStatus('idle');
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
        if (hasGeneratedFiles && !canvasOpen) {
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
            setCanvasPreviewFile(fp);
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            api.readFileContent(fp).then(r => {
              setCanvasPreviewContent(r.content);
              setCanvasOpen(true);
            }).catch(() => {
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
            ? buildWorkflowMessageFromToolResult(ev.response)
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
          const action = parseComputerUseRecoverableAction(ev.response);
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
      case 'needs_user': {
        setCurrentQuestion((event as { type: 'needs_user'; question: NeedsUserQuestion }).question);
        setStatus('waiting_user');
        break;
      }
      case 'error': {
        const msg = (event as { type: 'error'; message: string }).message;
        streamRef.current = '';
        setStreamingText('');
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`,
          role: 'assistant',
          content: `Error: ${msg}`,
        }]);
        setStatus('failed');
        break;
      }
    }
  }, [taskId]);

  // Replay events from a single snapshot into messages
  // Returns { msgs, result, events } where events is for Canvas (not pushed to ref during replay)
  const replaySnapshot = useCallback((snapshot: { events?: DesktopTaskEvent[]; prompt?: string; materials?: DisplayFileRef[] }, addPromptAsUser: boolean): { msgs: ChatMessage[]; result: TaskResult | null; events: DesktopTaskEvent[]; toolStepsMsgId: string | null } => {
    const msgs: ChatMessage[] = [];
    let lastResult: TaskResult | null = null;
    const replayEvents: DesktopTaskEvent[] = []; // Local array for Canvas, not ref
    if (addPromptAsUser && snapshot?.prompt) {
      // Strip scheduled task system prefix — it's for the model, not the user
      const displayPrompt = snapshot.prompt.replace(/^\[SYSTEM:[^\]]*\]\n*/s, '');
      msgs.push({
        id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: formatUserMessageContent(displayPrompt, snapshot.materials),
      });
    }

    let replayToolMsgId: string | null = null;
    if (snapshot?.events && snapshot.events.length > 0) {
      let accumulated = '';
      let lastProgress: ChatMessage | null = null;
      // For replay, also collect tool_steps so past tasks show tool execution
      let replayToolSteps: ToolStep[] = [];
      const replayArtifacts: ArtifactSummary[] = [];
      for (const ev of snapshot.events) {
        if (ev.type === 'artifact_recorded') {
          replayArtifacts.push(artifactSummaryFromEvent(ev));
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
            const message = buildWorkflowMessageFromToolResult(evR.response);
            if (message) msgs.push(message);
          }
          if (evR.toolName === 'xiaok_computer_use') {
            const action = parseComputerUseRecoverableAction(evR.response);
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
        } else if (ev.type === 'result') {
          const r = (ev as { result: TaskResult }).result;
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
  }, []);

  useEffect(() => {
    if (!taskId) return;

    // Increment mount generation to cancel any in-flight async from prior effect run
    const gen = ++mountGenRef.current;

    // Mark this as the current load
    const thisLoadId = taskId;
    currentLoadIdRef.current = thisLoadId;
    allEventsRef.current = [];
    currentTaskEventsRef.current = [];
    toolStepsMsgIdRef.current = null;
    toolStepsActiveRef.current = false;
    computerUseActionCodesRef.current = new Set();

    // Cleanup previous subscription
    unsubRef.current?.();
    unsubRef.current = null;
    streamRef.current = '';
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
        content: formatUserMessageContent(initialPrompt, initialFiles),
      }]);
      setStatus('running');
    }

    api.getThread(taskId).then(async (t) => {
      // Check if this is still the current load (prevent race condition)
      if (mountGenRef.current !== gen) return;

      if (t) {
        // Replay all tasks in the thread to show full conversation history
        const allTaskIds = (t.taskIds && t.taskIds.length > 0) ? t.taskIds
          : t.currentTaskId ? [t.currentTaskId] : [];
        const isEmptyHelpThread = allTaskIds.length === 0 && !initialPrompt;
        if (isEmptyHelpThread) {
          if (draftPrompt) {
            setPrompt(draftPrompt);
          } else if (storedDraft?.draftPrompt) {
            setPrompt(storedDraft.draftPrompt);
          } else {
            const legacyDraft = readLegacySwarmDraftForThread(t);
            if (legacyDraft?.draftPrompt) {
              setPrompt(legacyDraft.draftPrompt);
              writeStoredThreadDraft(t.id, legacyDraft);
            }
          }
        }
        console.log(`[ChatShell] Loading thread=${taskId.slice(0,8)} title="${t.title}" currentTaskId=${t.currentTaskId ?? 'none'}`);
        const allMessages: ChatMessage[] = [];
        let lastResult: TaskResult | null = null;
        let lastStatus: 'idle' | 'running' | 'waiting_user' = 'idle';
        let lastTaskIdForSub: string | null = null;
        let lastSubSinceIndex = 0;
        let lastSubToolStepsMsgId: string | null = null;

        for (const tid of allTaskIds) {
          // Check again after each async operation
          if (mountGenRef.current !== gen) return;

          try {
            const { snapshot } = await api.recoverTask(tid);
            if (snapshot) {
              console.log(`[ChatShell] Replaying task=${tid} prompt="${snapshot.prompt?.slice(0, 40)}" status=${snapshot.status} events=${snapshot.events?.length}`);
              const isFirst = tid === allTaskIds[0];
              const addPrompt = Boolean(snapshot.prompt && (!isFirst || !initialPrompt));
              const { msgs: replayMsgs, result: replayResult, events: replayEvents, toolStepsMsgId: replayToolStepsMsgId } = replaySnapshot(snapshot, addPrompt);
              console.log(`[ChatShell] Replayed task=${tid} → ${replayMsgs.length} msgs, addPrompt=${addPrompt}`);
              allMessages.push(...replayMsgs);
              // Collect events for Canvas panel (merge into ref after all tasks processed)
              allEventsRef.current.push(...replayEvents);
              if (tid === allTaskIds[allTaskIds.length - 1]) {
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
                }
              }
            }
          } catch { /* skip failed task */ }
        }

        // Final check before setting any state
        if (mountGenRef.current !== gen) return;

        // Now set all state atomically after final check
        setThread(t);
        if (allMessages.length > 0) {
          setMessages(allMessages);
        }
        if (lastResult) {
          setResult(lastResult);
        }
        setStatus(lastStatus);
        if (lastTaskIdForSub && (lastStatus === 'running' || lastStatus === 'waiting_user')) {
          // Guard: if effect was cleaned up during async gap (StrictMode), don't subscribe
          if (mountGenRef.current !== gen) return;
          // Rebind live tool-steps refs to the message replay already created, so the
          // incremental stream updates the existing steps instead of spawning a second
          // (perpetually-running) tool_steps message.
          if (lastSubToolStepsMsgId) {
            toolStepsMsgIdRef.current = lastSubToolStepsMsgId;
            toolStepsActiveRef.current = true;
          }
          unsubRef.current = api.subscribeTask(lastTaskIdForSub, handleEvent, lastSubSinceIndex);
        }
      } else {
        setThread({
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
        });
      }
    }).catch((err) => {
      if (mountGenRef.current === gen) {
        setLoadError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
      }
    });

    return () => {
      // Invalidate in-flight async operations from this effect run
      mountGenRef.current++;
      currentLoadIdRef.current = null;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [taskId, initialPrompt, initialFiles, draftPrompt, handleEvent, replaySnapshot]);

  const queuePrompt = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    log.info(queuedPrompt ? 'queued_prompt_replace' : 'queued_prompt_submit', JSON.stringify({
      threadId: taskId,
      status,
      length: trimmed.length,
    }));
    setQueuedPrompt(trimmed);
  }, [queuedPrompt, status, taskId]);

  const cancelQueuedPrompt = useCallback(() => {
    if (queuedPrompt) {
      log.info('queued_prompt_cancel', JSON.stringify({
        threadId: taskId,
        status,
        length: queuedPrompt.length,
      }));
    }
    setQueuedPrompt(null);
  }, [queuedPrompt, status, taskId]);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    if (!taskId) return;

    // If streaming is active, queue the message instead of interrupting
    if (status === 'running' && (!files || files.length === 0)) {
      queuePrompt(text);
      return;
    }

    toolStepsMsgIdRef.current = null;

    // Add user message immediately (include file names in content)
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: formatUserMessageContent(text, files),
    };
    const sealedResultCard = buildResultCardMessage({
      idHint: `${thread?.currentTaskId || 'current'}-${Date.now()}`,
      result,
      generatedFiles: collectGeneratedFilesForTurn(currentTaskEventsRef.current, [result?.summary || '', streamingText]),
    });
    setMessages(prev => sealedResultCard ? [...prev, sealedResultCard, userMsg] : [...prev, userMsg]);
    setPrompt('');
    setStatus('running');
    setStreamingText('');
    streamRef.current = '';
    currentTaskEventsRef.current = [];
    setResult(null);

    // Update thread title only on first user message (keep original topic as title)
    if (taskId && messages.filter(m => m.role === 'user').length === 0) {
      api.updateThreadTitle(taskId, text.slice(0, 40)).catch(() => {});
    }

    const contextTaskIds = (thread?.taskIds ?? [])
      .flatMap(id => {
        const trimmed = id.trim();
        return trimmed ? [trimmed] : [];
      });
    const submitContext = contextTaskIds.length > 0
      ? { threadId: thread?.id ?? taskId, taskIds: contextTaskIds }
      : undefined;

    try {
      // Send prompt plus thread task references; main rebuilds model history from persisted snapshots.
      let newTaskId: string;
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await api.createTaskWithFiles(submitContext
          ? { prompt: text, filePaths, context: submitContext }
          : { prompt: text, filePaths });
        newTaskId = result.taskId;
      } else {
        const result = await api.createTask(submitContext
          ? { prompt: text, materials: [], context: submitContext }
          : { prompt: text, materials: [] });
        newTaskId = result.taskId;
      }

      // Update thread with new taskId
      await api.updateThreadTaskId(taskId, newTaskId);
      setThread(prev => prev ? {
        ...prev,
        currentTaskId: newTaskId,
        taskIds: prev.taskIds.includes(newTaskId) ? prev.taskIds : [...prev.taskIds, newTaskId],
      } : prev);

      // Unsubscribe previous and subscribe new
      unsubRef.current?.();
      unsubRef.current = api.subscribeTask(newTaskId, handleEvent);
    } catch (e) {
      const displayMessage = sanitizeUserFacingErrorMessage(e, '任务创建失败，请检查模型配置或稍后重试。');
      log.error('handleSubmit error', JSON.stringify({ message: displayMessage, raw: e instanceof Error ? e.message : String(e) }));
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: displayMessage,
      }]);
      setStatus('idle');
    }
  };

  const handleAnswer = async (choiceId: string) => {
    if (!currentQuestion || !thread?.currentTaskId) return;
    await api.answerQuestion({
      taskId: thread.currentTaskId,
      answer: { questionId: currentQuestion.questionId, type: 'choice', choiceId },
    });
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
    updateComputerUseActionMessage(messageId, { status: 'working', detail: '正在处理 Computer Use 状态...' });
    try {
      if (isComputerUseSettingsAction(action.actionType)) {
        const permission = action.code === 'COMPUTER_USE_NEEDS_SCREEN_RECORDING' ? 'screen' : 'accessibility';
        await api.openPluginDependencyPermissionSettings({ permission });
        updateComputerUseActionMessage(messageId, { status: 'idle', detail: '已打开系统设置。请确认授权对象是 CuaDriver.app。' });
        return;
      }
      const next = await api.enableComputerUse();
      if (next.state === 'ready') {
        updateComputerUseActionMessage(messageId, { status: 'ready', detail: 'Computer Use 已启用。你可以继续让 xiaok 截图或查看窗口。' });
      } else {
        updateComputerUseActionMessage(messageId, { status: 'failed', detail: next.lastError || 'Computer Use 连接失败。' });
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
    updateComputerUseActionMessage(messageId, { status: 'dismissed', detail: '本次会话已暂不启用 Computer Use。' });
  };

  const handleCancel = async () => {
    if (!thread?.currentTaskId) return;
    await api.cancelTask(thread.currentTaskId);
    setStatus('idle');
    streamRef.current = '';
    setStreamingText('');
  };

  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, []);

  // Drain queued prompt when current task completes
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  useEffect(() => {
    if (queuedPrompt && (status === 'idle' || status === 'completed')) {
      const text = queuedPrompt;
      log.info('queued_prompt_drain_start', JSON.stringify({
        threadId: taskId,
        status,
        length: text.length,
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
          length: text.length,
        }));
        void handleSubmitRef.current(text);
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

  const showTaskPanel = planSteps.length > 0 && !canvasOpen;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-1 min-w-0">
        <ChatView
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
          queuedText={queuedPrompt}
          onCancelQueue={cancelQueuedPrompt}
          onAnswer={handleAnswer}
          onCancel={handleCancel}
          onComputerUseAction={handleComputerUseAction}
          onComputerUseDismiss={handleComputerUseDismiss}
          canvasOpen={canvasOpen}
          onToggleCanvas={() => setCanvasOpen(v => !v)}
          onArtifactClick={async (artifact) => {
            let content = '';
            if (artifact.filePath) {
              const r = await api.readFileContent(artifact.filePath);
              content = r.content;
            }
            sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
            setCanvasPreviewFile(artifact.filePath ?? artifact.title);
            setCanvasPreviewContent(content);
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            setCanvasOpen(true);
          }}
          onArtifactOpenExternal={(artifact) => {
            if (artifact.filePath) {
              window.open(`file://${artifact.filePath}`, '_blank');
            }
          }}
        />
      </div>
      {showTaskPanel && (
        <TaskPanel
          planSteps={planSteps}
          status={status}
          result={result}
          generatedFiles={generatedFiles}
          onFileClick={async (file) => {
            let content = '';
            try {
              const r = await api.readFileContent(file.filePath);
              content = r.content;
            } catch { /* ignore */ }
            sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
            setCanvasPreviewFile(file.filePath);
            setCanvasPreviewContent(content);
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            setCanvasOpen(true);
          }}
          onArtifactClick={async (artifact) => {
            let content = '';
            if (artifact.filePath) {
              const r = await api.readFileContent(artifact.filePath);
              content = r.content;
            }
            sidebarWasCollapsedRef.current = sidebarCollapse.collapsed;
            setCanvasPreviewFile(artifact.filePath ?? artifact.title);
            setCanvasPreviewContent(content);
            setCanvasExpanded(true);
            sidebarCollapse.setCollapsed(true);
            setCanvasOpen(true);
          }}
        />
      )}
      {canvasOpen && (
        <CanvasPanel
          events={allEventsRef.current}
          onClose={() => { setCanvasOpen(false); setCanvasExpanded(false); sidebarCollapse.setCollapsed(sidebarWasCollapsedRef.current); }}
          initialPreviewFile={canvasPreviewFile}
          initialPreviewContent={canvasPreviewContent}
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
      )}
    </div>
  );
}
