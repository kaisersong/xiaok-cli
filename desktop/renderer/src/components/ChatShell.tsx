import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { ChatView } from './ChatView';
import type { ThreadRecord } from '../api/types';
import type { DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../src/runtime/task-host/types';

export function ChatShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  const [events, setEvents] = useState<DesktopTaskEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_user' | 'completed' | 'failed'>('idle');
  const [currentQuestion, setCurrentQuestion] = useState<NeedsUserQuestion | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [prompt, setPrompt] = useState('');

  const handleEvent = useCallback((event: DesktopTaskEvent) => {
    setEvents(prev => [...prev, event]);

    switch (event.type) {
      case 'task_started':
        setStatus('running');
        break;
      case 'needs_user':
        setCurrentQuestion(event.question);
        setStatus('waiting_user');
        break;
      case 'result':
        setResult(event.result);
        setStatus('completed');
        if (taskId) {
          api.updateThreadTitle(taskId, event.result.summary.slice(0, 40));
        }
        break;
      case 'error':
        setStatus('failed');
        break;
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;

    api.getThread(taskId).then(t => {
      if (t) {
        setThread(t);
        // Try to recover running task
        api.recoverTask(taskId).then(({ snapshot }) => {
          if (snapshot?.status === 'running') {
            setStatus('running');
            api.subscribeTask(taskId, handleEvent);
          }
        }).catch(() => {
          // Task may not exist, start fresh
        });
      } else {
        // Thread doesn't exist yet
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
        });
      }
    }).catch(() => {});
  }, [taskId, handleEvent]);

  const handleSubmit = async (text: string) => {
    if (!taskId) return;
    setPrompt('');
    setStatus('running');
    setEvents([]);
    setCurrentQuestion(null);
    setResult(null);
    await api.createTask({ prompt: text, materials: [] });
    api.subscribeTask(taskId, handleEvent);
  };

  const handleAnswer = async (choiceId: string) => {
    if (!currentQuestion || !taskId) return;
    await api.answerQuestion({
      taskId,
      answer: { questionId: currentQuestion.questionId, type: 'choice', choiceId },
    });
    setCurrentQuestion(null);
    setStatus('running');
  };

  const handleCancel = async () => {
    if (!taskId) return;
    await api.cancelTask(taskId);
    setStatus('idle');
  };

  if (!thread) {
    return <div className="flex items-center justify-center h-full text-[var(--c-text-secondary)]">Loading...</div>;
  }

  return (
    <ChatView
      thread={thread}
      events={events}
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