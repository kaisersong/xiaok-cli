import { useEffect, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ChatMessage, type ToolStep } from './ChatView';
import { CanvasPanel } from './CanvasPanel';
import type { ThreadRecord } from '../api/types';
import type { DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';
import { useSidebarCollapse } from '../layouts/AppLayout';

const log = createLogger('ChatShell');

export function ChatShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const sidebarCollapse = useSidebarCollapse();
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [canvasPreviewFile, setCanvasPreviewFile] = useState<string | undefined>();
  const [canvasPreviewContent, setCanvasPreviewContent] = useState<string | undefined>();
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef('');
  const currentLoadIdRef = useRef<string | null>(null);
  const allEventsRef = useRef<DesktopTaskEvent[]>([]);
  const toolStepsMsgIdRef = useRef<string | null>(null);
  const toolStepsActiveRef = useRef(false);

  // Read initialPrompt from navigation state (from WelcomePage)
  const state = location.state as { initialPrompt?: string } | undefined;
  const initialPrompt = state?.initialPrompt;

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

    switch (event.type) {
      case 'task_started': {
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
      case 'artifact_recorded': {
        const ar = event as { artifactId: string; kind: string; label: string; filePath: string; previewAvailable: boolean; turnId: string; creator?: string };
        setResult(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            artifacts: [
              ...(prev.artifacts || []),
              {
                artifactId: ar.artifactId,
                kind: ar.kind,
                title: ar.label,
                createdAt: ar.turnId,
                previewAvailable: ar.previewAvailable,
                filePath: ar.filePath,
                creator: ar.creator ?? 'agent',
              },
            ],
          };
        });
        break;
      }
      case 'result': {
        const r = (event as { type: 'result'; result: TaskResult }).result;
        const hasGeneratedFiles = allEventsRef.current.some(
          e => e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write'
            && (e as { input: Record<string, unknown> }).input?.file_path
        );
        if (r.artifacts && r.artifacts.length > 0) {
          if (streamRef.current.trim()) {
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              content: streamRef.current,
            }]);
            streamRef.current = '';
            setStreamingText('');
          }
          setResult(r);
          setStatus('completed');
          if (taskId) {
            api.updateThreadTitle(taskId, r.summary.slice(0, 40)).catch(() => {});
          }
        } else {
          // Desktop tasks: artifacts is [], but still set result for generatedFiles extraction
          setResult(r);
          const finalText = streamRef.current || r.summary;
          if (finalText.trim()) {
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}-assistant`,
              role: 'assistant',
              content: finalText,
            }]);
          }
          streamRef.current = '';
          setStreamingText('');
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
          const writeCall = allEventsRef.current.find(
            e => e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write'
              && (e as { input: Record<string, unknown> }).input?.file_path
          );
          if (writeCall) {
            const fp = (writeCall as { input: Record<string, unknown> }).input.file_path as string;
            setCanvasPreviewFile(fp);
            // Try to read file content for preview
            api.readFileContent(fp).then(r => {
              setCanvasPreviewContent(r.content);
              setCanvasOpen(true);
            }).catch(() => {
              setCanvasPreviewContent('');
              setCanvasOpen(true);
            });
          } else {
            setCanvasOpen(true);
          }
        }
        break;
      }
      case 'canvas_tool_call': {
        const ev = event as { type: 'canvas_tool_call'; toolName: string; input: unknown; toolUseId: string; eventId: string };
        const newStep: ToolStep = { toolUseId: ev.toolUseId, toolName: ev.toolName, input: ev.input, status: 'running' };
        toolStepsActiveRef.current = true;
        setMessages(prev => {
          // Remove stale progress messages with tool stage
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
        const sealId = toolStepsMsgIdRef.current;
        if (!sealId) break;
        setMessages(prev => {
          const existingIdx = prev.findIndex(m => m.id === sealId);
          if (existingIdx === -1) return prev;
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            steps: (updated[existingIdx].steps ?? []).map(s =>
              s.toolUseId === ev.toolUseId ? { ...s, status: ev.ok ? 'done' : 'error', response: ev.response } : s
            ),
          };
          return updated;
        });
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
  const replaySnapshot = useCallback((snapshot: { events?: DesktopTaskEvent[]; prompt?: string }, addPromptAsUser: boolean): { msgs: ChatMessage[]; result: TaskResult | null } => {
    const msgs: ChatMessage[] = [];
    let lastResult: TaskResult | null = null;
    if (addPromptAsUser && snapshot?.prompt) {
      msgs.push({
        id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: snapshot.prompt,
      });
    }

    if (snapshot?.events && snapshot.events.length > 0) {
      let accumulated = '';
      let lastProgress: ChatMessage | null = null;
      // Note: During replay we do NOT create tool_steps groups.
      // Tool_steps is only for live streaming. Replay preserves original progress messages.
      for (const ev of snapshot.events) {
        if (ev.type === 'artifact_recorded') {
          const ar = ev as { artifactId: string; kind: string; label: string; filePath: string; previewAvailable: boolean; turnId: string; creator?: string };
          if (lastResult) {
            lastResult = {
              ...lastResult,
              artifacts: [
                ...(lastResult.artifacts || []),
                {
                  artifactId: ar.artifactId,
                  kind: ar.kind,
                  title: ar.label,
                  createdAt: ar.turnId,
                  previewAvailable: ar.previewAvailable,
                  filePath: ar.filePath,
                  creator: ar.creator ?? 'agent',
                },
              ],
            };
          }
          continue;
        }
        if (ev.type === 'canvas_file_changed') {
          allEventsRef.current.push(ev);
          continue;
        }
        if (ev.type === 'canvas_tool_call') {
          allEventsRef.current.push(ev);
          continue;
        }
        if (ev.type === 'canvas_tool_result') {
          allEventsRef.current.push(ev);
          continue;
        }
        if (ev.type === 'progress') {
          const prog = (ev as { type: 'progress'; message: string; stage?: string; eventId: string });
          lastProgress = {
            id: `msg-progress-${prog.eventId}`,
            role: 'progress',
            content: prog.message,
            stage: prog.stage,
          };
        } else if (ev.type === 'assistant_delta') {
          accumulated += (ev as { delta: string }).delta;
          lastProgress = null;
        } else if (ev.type === 'result') {
          const r = (ev as { result: TaskResult }).result;
          if (accumulated || r.summary) {
            msgs.push({
              id: `msg-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              content: accumulated || r.summary,
            });
            accumulated = '';
          }
          lastResult = r;
        }
      }
      if (lastProgress) {
        msgs.push(lastProgress);
      }
      if (accumulated) {
        streamRef.current = accumulated;
        setStreamingText(accumulated);
      }
    }
    return { msgs, result: lastResult };
  }, []);

  useEffect(() => {
    if (!taskId) return;

    // Mark this as the current load
    const thisLoadId = taskId;
    currentLoadIdRef.current = thisLoadId;

    // Cleanup previous subscription
    unsubRef.current?.();
    unsubRef.current = null;
    allEventsRef.current = [];
    toolStepsMsgIdRef.current = null;
    toolStepsActiveRef.current = false;
    streamRef.current = '';
    setStreamingText('');
    setResult(null);
    setMessages([]);
    setCurrentQuestion(null);
    setThread(null);
    setStatus('idle');

    // If we have an initialPrompt from WelcomePage, pre-populate
    if (initialPrompt) {
      setMessages([{
        id: `msg-initial-user`,
        role: 'user',
        content: initialPrompt,
      }]);
      setStatus('running');
    }

    api.getThread(taskId).then(async (t) => {
      // Check if this is still the current load (prevent race condition)
      if (currentLoadIdRef.current !== thisLoadId) return;

      if (t) {
        // Load ALL tasks' events, not just currentTaskId
        const allTaskIds = (t.taskIds && t.taskIds.length > 0) ? t.taskIds : (t.currentTaskId ? [t.currentTaskId] : []);
        const allMessages: ChatMessage[] = [];
        let lastResult: TaskResult | null = null;
        let lastStatus: 'idle' | 'running' | 'waiting_user' = 'idle';
        let lastTaskIdForSub: string | null = null;

        for (const tid of allTaskIds) {
          // Check again after each async operation
          if (currentLoadIdRef.current !== thisLoadId) return;

          try {
            const { snapshot } = await api.recoverTask(tid);
            if (snapshot) {
              const isFirst = tid === allTaskIds[0];
              // Add prompt for every task (not just first)
              const addPrompt = snapshot.prompt && (!isFirst || !initialPrompt);
              const { msgs: replayMsgs, result: replayResult } = replaySnapshot(snapshot, addPrompt);
              allMessages.push(...replayMsgs);

              // Collect result from last completed task (don't set yet - defer until after final check)
              if (replayResult && tid === allTaskIds[allTaskIds.length - 1] && snapshot.status === 'completed') {
                lastResult = replayResult;
              }

              // Collect last task status for live subscription
              if (tid === allTaskIds[allTaskIds.length - 1]) {
                lastTaskIdForSub = tid;
                if (snapshot.status === 'running' || snapshot.status === 'waiting_user') {
                  lastStatus = snapshot.status;
                } else if (snapshot.status === 'completed') {
                  lastStatus = 'idle';
                }
              }
            }
          } catch { /* skip failed task */ }
        }

        // Final check before setting any state
        if (currentLoadIdRef.current !== thisLoadId) return;

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
          unsubRef.current = api.subscribeTask(lastTaskIdForSub, handleEvent);
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
    }).catch(() => {});

    return () => {
      // Mark that this load is cancelled
      currentLoadIdRef.current = null;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [taskId, initialPrompt, handleEvent, replaySnapshot]);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    if (!taskId) return;

    toolStepsMsgIdRef.current = null;

    // Add user message immediately (include file names in content)
    const fileNames = files?.map(f => f.name).filter(Boolean);
    const displayContent = fileNames && fileNames.length > 0
      ? `${text}\n\n附件: ${fileNames.join(', ')}`
      : text;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: displayContent,
    };
    setMessages(prev => [...prev, userMsg]);
    setPrompt('');
    setStatus('running');
    setStreamingText('');
    setResult(null);
    streamRef.current = '';

    try {
      let newTaskId: string;
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await api.createTaskWithFiles({ prompt: text, filePaths });
        newTaskId = result.taskId;
      } else {
        const result = await api.createTask({ prompt: text, materials: [] });
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
      log.error('handleSubmit error', JSON.stringify({ message: (e as Error).message }));
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: `Failed: ${e instanceof Error ? e.message : String(e)}`,
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

  if (!thread) {
    return <div className="flex h-full items-center justify-center text-[var(--c-text-secondary)]">Loading...</div>;
  }

  // Extract generated files from multiple sources
  const generatedFiles = (() => {
    const seen = new Set<string>();
    const files: { filePath: string; name: string }[] = [];
    const addFile = (fp: string) => {
      if (seen.has(fp) || !fp) return;
      seen.add(fp);
      const parts = fp.split('/');
      files.push({ filePath: fp, name: parts[parts.length - 1] });
    };

    // Source 1: Write tool calls
    for (const e of allEventsRef.current) {
      if (e.type === 'canvas_tool_call' && (e as { toolName: string }).toolName === 'Write') {
        const fp = ((e as unknown) as { input?: { file_path?: string } }).input?.file_path;
        if (fp) addFile(fp);
      }
    }

    // Source 2: result summary and assistant messages (extract file paths from text)
    const textsToScan: string[] = [];
    if (result?.summary) textsToScan.push(result.summary);
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content) textsToScan.push(msg.content);
    }
    for (const text of textsToScan) {
      // Match file paths that may be inside markdown code blocks (backticks)
      const fileExtMatch = /`?([^\s<`"'|]+?\.(?:md|html|txt|csv|json|pdf|png|jpg|svg|pptx|docx|xlsx))`?\b/g;
      let m;
      while ((m = fileExtMatch.exec(text)) !== null) {
        const candidate = m[1];
        if (candidate.startsWith('/')) addFile(candidate);
      }
    }

    return files;
  })();

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
          onAnswer={handleAnswer}
          onCancel={handleCancel}
          canvasOpen={canvasOpen}
          onToggleCanvas={() => setCanvasOpen(v => !v)}
          onArtifactClick={async (artifact) => {
            let content = '';
            if (artifact.filePath) {
              const r = await api.readFileContent(artifact.filePath);
              content = r.content;
            }
            setCanvasPreviewFile(artifact.filePath ?? artifact.title);
            setCanvasPreviewContent(content);
            setCanvasOpen(true);
          }}
        />
      </div>
      {canvasOpen && (
        <CanvasPanel
          events={allEventsRef.current}
          onClose={() => { setCanvasOpen(false); setCanvasExpanded(false); }}
          initialPreviewFile={canvasPreviewFile}
          initialPreviewContent={canvasPreviewContent}
          expanded={canvasExpanded}
          onToggleExpand={() => {
            const next = !canvasExpanded;
            setCanvasExpanded(next);
            sidebarCollapse.setCollapsed(next);
          }}
        />
      )}
    </div>
  );
}