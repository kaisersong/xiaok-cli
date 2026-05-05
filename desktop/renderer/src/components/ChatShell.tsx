import { useEffect, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ChatMessage, type ToolStep } from './ChatView';
import { CanvasPanel } from './CanvasPanel';
import type { ThreadRecord } from '../api/types';
import type { DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';

const log = createLogger('ChatShell');

export function ChatShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasPreviewFile, setCanvasPreviewFile] = useState<string | undefined>();
  const [canvasPreviewContent, setCanvasPreviewContent] = useState<string | undefined>();
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef('');
  const loadingRef = useRef(false);
  const allEventsRef = useRef<DesktopTaskEvent[]>([]);
  const toolStepsMsgIdRef = useRef<string | null>(null);
  const toolStepsActiveRef = useRef(false);

  // Read initialPrompt from navigation state (from WelcomePage)
  const state = location.state as { initialPrompt?: string } | undefined;
  const initialPrompt = state?.initialPrompt;

  const handleEvent = useCallback((rawEvent: { type: string }) => {
    const event = rawEvent as DesktopTaskEvent;
    console.log('[ChatShell] event:', event.type);

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
      case 'result': {
        const r = (event as { type: 'result'; result: TaskResult }).result;
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
  const replaySnapshot = useCallback((snapshot: { events?: DesktopTaskEvent[]; prompt?: string }, addPromptAsUser: boolean): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
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
      let toolStepsMsgId: string | null = null;
      for (const ev of snapshot.events) {
        if (ev.type === 'canvas_file_changed') {
          allEventsRef.current.push(ev);
          continue;
        }
        if (ev.type === 'canvas_tool_call') {
          const call = ev as { type: 'canvas_tool_call'; toolName: string; input: unknown; toolUseId: string; eventId: string };
          allEventsRef.current.push(ev);
          if (!toolStepsMsgId) {
            toolStepsMsgId = `msg-tool-steps-replay-${call.eventId}`;
            msgs.push({ id: toolStepsMsgId, role: 'tool_steps', content: '', steps: [], stepsLive: false });
          }
          const msg = msgs.find(m => m.id === toolStepsMsgId)!;
          msg.steps = [...(msg.steps ?? []), { toolUseId: call.toolUseId, toolName: call.toolName, input: call.input, status: 'done' as const }];
          continue;
        }
        if (ev.type === 'canvas_tool_result') {
          const res = ev as { type: 'canvas_tool_result'; toolUseId: string; ok: boolean; response: string };
          allEventsRef.current.push(ev);
          const msg = msgs.find(m => m.id === toolStepsMsgId);
          if (msg?.steps) {
            msg.steps = msg.steps.map(s =>
              s.toolUseId === res.toolUseId ? { ...s, status: res.ok ? 'done' as const : 'error' as const, response: res.response } : s
            );
          }
          continue;
        }
        if (ev.type === 'progress') {
          const prog = (ev as { type: 'progress'; message: string; stage?: string; eventId: string });
          // Suppress tool progress when tool_steps group is active
          if ((prog.stage === 'tool' || prog.stage === 'completed' || prog.stage === 'failed') && toolStepsMsgId) {
            // keep lastProgress but don't overwrite if tool_steps is showing
          } else {
            lastProgress = {
              id: `msg-progress-${prog.eventId}`,
              role: 'progress',
              content: prog.message,
              stage: prog.stage,
            };
          }
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
          toolStepsMsgId = null;
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
    return msgs;
  }, []);

  useEffect(() => {
    if (!taskId) return;
    if (loadingRef.current) return;

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

    loadingRef.current = true;

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
      if (t) {
        setThread(t);

        // Load ALL tasks' events, not just currentTaskId
        const allTaskIds = (t.taskIds && t.taskIds.length > 0) ? t.taskIds : (t.currentTaskId ? [t.currentTaskId] : []);
        const allMessages: ChatMessage[] = [];

        for (const tid of allTaskIds) {
          try {
            const { snapshot } = await api.recoverTask(tid);
            if (snapshot) {
              const isFirst = tid === allTaskIds[0];
              const msgs = replaySnapshot(snapshot, isFirst && !initialPrompt);
              allMessages.push(...msgs);

              // Check last task status for live subscription
              if (tid === allTaskIds[allTaskIds.length - 1]) {
                if (snapshot.status === 'running' || snapshot.status === 'waiting_user') {
                  setStatus(snapshot.status);
                  unsubRef.current = api.subscribeTask(tid, handleEvent);
                } else if (snapshot.status === 'completed') {
                  setStatus('idle');
                }
              }
            }
          } catch { /* skip failed task */ }
        }

        if (allMessages.length > 0) {
          setMessages(allMessages);
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
      loadingRef.current = false;
    }).catch(() => {
      loadingRef.current = false;
    });

    return () => {
      loadingRef.current = false;
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
          onClose={() => setCanvasOpen(false)}
          initialPreviewFile={canvasPreviewFile}
          initialPreviewContent={canvasPreviewContent}
        />
      )}
    </div>
  );
}