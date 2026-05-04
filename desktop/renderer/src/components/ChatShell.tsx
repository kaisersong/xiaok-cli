import { useEffect, useState, useCallback, useRef } from 'react';
import { createLogger } from '../lib/logger';
import { useParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ChatView, type ChatMessage } from './ChatView';
import type { ThreadRecord } from '../api/types';
import type { NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';

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
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef('');
  const initRef = useRef(false);

  // Read initialPrompt from navigation state (from WelcomePage)
  const state = location.state as { initialPrompt?: string } | undefined;
  const initialPrompt = state?.initialPrompt;

  const handleEvent = useCallback((event: { type: string }) => {
    console.log('[ChatShell] event:', event.type);

    switch (event.type) {
      case 'task_started': {
        // Task started, nothing to do
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
        // When artifacts.length > 0, it's artifact_recorded (final result)
        // When artifacts.length === 0, it's receipt_emitted (intermediate completion)
        if (r.artifacts && r.artifacts.length > 0) {
          // Final result with artifacts
          // First, finalize streaming text as message
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
          // Receipt without artifacts - finalize streaming text
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
        break;
      }
      case 'needs_user': {
        setCurrentQuestion((event as { type: 'needs_user'; question: NeedsUserQuestion }).question);
        setStatus('waiting_user');
        break;
      }
      case 'error': {
        const msg = (event as { type: 'error'; message: string }).message;
        // Finalize any pending streaming text as error
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

  useEffect(() => {
    if (!taskId || initRef.current) return;
    initRef.current = true;

    // If we have an initialPrompt from WelcomePage, pre-populate user message
    if (initialPrompt) {
      setMessages([{
        id: `msg-initial-user`,
        role: 'user',
        content: initialPrompt,
      }]);
      setStatus('running');
    }

    api.getThread(taskId).then(t => {
      if (t) {
        setThread(t);
        // Recover task if it was running
        if (t.currentTaskId) {
          api.recoverTask(t.currentTaskId).then(({ snapshot }) => {
            if (snapshot?.status === 'running' || snapshot?.status === 'waiting_user') {
              setStatus(snapshot.status);
              // Replay events into assistant messages
              if (snapshot.events) {
                let accumulated = '';
                const replayMessages: ChatMessage[] = [];
                for (const ev of snapshot.events) {
                  if (ev.type === 'assistant_delta') {
                    accumulated += (ev as { delta: string }).delta;
                  } else if (ev.type === 'result') {
                    const r = (ev as { result: TaskResult }).result;
                    if (accumulated || r.summary) {
                      replayMessages.push({
                        id: `msg-replay-${Date.now()}`,
                        role: 'assistant',
                        content: accumulated || r.summary,
                      });
                      accumulated = '';
                    }
                  }
                }
                if (accumulated) {
                  setStreamingText(accumulated);
                }
                // Merge replay messages with existing (initialPrompt) messages
                if (replayMessages.length > 0) {
                  setMessages(prev => [...prev, ...replayMessages]);
                }
              }
              // Subscribe to continue receiving events
              unsubRef.current = api.subscribeTask(t.currentTaskId!, handleEvent);
            }
          }).catch(() => {});
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
        });
      }
    }).catch(() => {});
  }, [taskId, initialPrompt, handleEvent]);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    if (!taskId) return;

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
      setThread(prev => prev ? { ...prev, currentTaskId: newTaskId } : prev);

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
    />
  );
}