import { useRef, useEffect } from 'react';
import { ChatInput } from './ChatInput';
import type { ThreadRecord } from '../api/types';
import type { DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../src/runtime/task-host/types';

interface ChatViewProps {
  thread: ThreadRecord;
  events: DesktopTaskEvent[];
  status: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed';
  currentQuestion: NeedsUserQuestion | null;
  result: TaskResult | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onAnswer: (choiceId: string) => void;
  onCancel: () => void;
}

export function ChatView({
  thread, events, status, currentQuestion, result,
  prompt, onPromptChange, onSubmit, onAnswer, onCancel,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // Extract assistant delta text
  const assistantText = events
    .filter(e => e.type === 'assistant_delta')
    .map(e => (e as { type: 'assistant_delta'; delta: string }).delta)
    .join('');

  // Extract progress messages
  const progressMessages = events
    .filter(e => e.type === 'progress')
    .map(e => (e as { type: 'progress'; message: string }).message);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--c-border)] p-3">
        <h2 className="font-medium">{thread.title || 'New Task'}</h2>
        <span className="text-sm text-[var(--c-text-secondary)]">
          {status === 'idle' ? 'Idle' : status === 'running' ? 'Running' : status === 'waiting_user' ? 'Waiting for you' : status === 'completed' ? 'Completed' : 'Failed'}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {progressMessages.map((msg, i) => (
          <div key={i} className="mb-2 text-sm text-[var(--c-text-secondary)]">{msg}</div>
        ))}

        {assistantText && (
          <div className="mb-4 rounded-lg bg-[var(--c-bg-card)] p-3">
            <div className="whitespace-pre-wrap">{assistantText}</div>
          </div>
        )}

        {currentQuestion && (
          <div className="mb-4 rounded-lg border border-[var(--c-accent)] p-4">
            <p className="mb-3">{currentQuestion.prompt}</p>
            <div className="flex gap-2">
              {currentQuestion.choices?.map(choice => (
                <button key={choice.id} type="button" onClick={() => onAnswer(choice.id)}
                  className="rounded-lg px-4 py-2 text-sm bg-[var(--c-accent)] text-white hover:opacity-90">
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div className="mb-4 rounded-lg bg-[var(--c-bg-card)] p-4 border border-[var(--c-accent)]">
            <h3 className="font-medium mb-2">Result</h3>
            <p>{result.summary}</p>
            {result.artifacts.length > 0 && (
              <div className="mt-3">
                <span className="text-sm text-[var(--c-text-secondary)]">Artifacts:</span>
                {result.artifacts.map(a => (
                  <div key={a.artifactId} className="text-sm">{a.title}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--c-border)] p-3">
        {status === 'running' || status === 'waiting_user' ? (
          <button type="button" onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm bg-red-500 text-white hover:opacity-90">
            Cancel
          </button>
        ) : (
          <ChatInput value={prompt} onChange={onPromptChange} onSubmit={onSubmit}
            placeholder="Continue or start new task..." />
        )}
      </div>
    </div>
  );
}