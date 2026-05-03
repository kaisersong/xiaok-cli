import { useRef, useEffect } from 'react';
import { ChatInput } from './ChatInput';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ThreadRecord } from '../api/types';
import type { DesktopTaskEvent, NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';

interface ChatViewProps {
  thread: ThreadRecord;
  events: DesktopTaskEvent[];
  status: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed';
  currentQuestion: NeedsUserQuestion | null;
  result: TaskResult | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (text: string, files?: Array<{ filePath: string; name: string }>) => void;
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
    .map(e => (e as { type: 'progress'; message: string; stage?: string }).message);

  // Extract plan steps
  const planSteps = events
    .filter(e => e.type === 'plan_updated')
    .flatMap(e => (e as { type: 'plan_updated'; plan: Array<{ id: string; label: string; status: string }> }).plan || []);

  // Extract understanding
  const understanding = events
    .find(e => e.type === 'understanding_updated')
    ? (events.find(e => e.type === 'understanding_updated') as { type: 'understanding_updated'; understanding: unknown })?.understanding
    : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--c-border)] p-3">
        <h2 className="font-medium">{thread.title || 'New Task'}</h2>
        <span className="text-sm text-[var(--c-text-secondary)]">
          {status === 'idle' ? 'Idle' : status === 'running' ? 'Running' : status === 'waiting_user' ? 'Waiting for you' : status === 'completed' ? 'Completed' : 'Failed'}
        </span>
      </div>

      {/* Understanding card */}
      {understanding && (
        <div className="border-b border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
          <h3 className="text-sm font-medium text-[var(--c-text-secondary)] mb-2">Understanding</h3>
          <p className="text-sm">{(understanding as { goal: string; deliverable: string }).goal}</p>
          <p className="text-xs text-[var(--c-text-secondary)] mt-1">Deliverable: {(understanding as { goal: string; deliverable: string }).deliverable}</p>
        </div>
      )}

      {/* Plan steps */}
      {planSteps.length > 0 && (
        <div className="border-b border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
          <h3 className="text-sm font-medium text-[var(--c-text-secondary)] mb-2">Plan</h3>
          <div className="space-y-2">
            {planSteps.map((step) => (
              <div key={step.id} className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${
                  step.status === 'completed' ? 'bg-green-500' :
                  step.status === 'running' ? 'bg-[var(--c-accent)] animate-pulse' :
                  step.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
                }`} />
                <span className="text-sm">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Progress messages */}
        {progressMessages.map((msg, i) => (
          <div key={`progress-${i}`} className="flex items-start gap-2 text-sm text-[var(--c-text-secondary)]">
            <span className="mt-1">
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <span>{msg}</span>
          </div>
        ))}

        {/* Assistant response */}
        {assistantText && (
          <div className="rounded-lg bg-[var(--c-bg-card)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="flex size-7 items-center justify-center rounded-full bg-[var(--c-accent)] text-xs text-white font-medium">x</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--c-text-secondary)] mb-1">xiaok</div>
                <div className="text-sm leading-relaxed">
                  <MarkdownRenderer content={assistantText} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Question */}
        {currentQuestion && (
          <div className="rounded-lg border border-[var(--c-accent)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="flex size-7 items-center justify-center rounded-full bg-[var(--c-accent)] text-xs text-white font-medium">?</div>
              </div>
              <div className="flex-1">
                <p className="text-sm mb-3">{currentQuestion.prompt}</p>
                <div className="flex flex-wrap gap-2">
                  {currentQuestion.choices?.map(choice => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => onAnswer(choice.id)}
                      className="rounded-lg px-4 py-2 text-sm bg-[var(--c-accent)] text-white hover:opacity-90"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-lg bg-[var(--c-bg-card)] p-4 border border-green-300">
            <div className="flex items-center gap-2 mb-2">
              <svg className="size-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <h3 className="font-medium text-green-700">Task Completed</h3>
            </div>
            <div className="text-sm">
              <MarkdownRenderer content={result.summary} />
            </div>
            {result.artifacts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--c-border)]">
                <span className="text-xs text-[var(--c-text-secondary)]">Artifacts:</span>
                <div className="mt-2 space-y-1">
                  {result.artifacts.map(a => (
                    <div key={a.artifactId} className="flex items-center gap-2 text-sm">
                      <span className="text-[var(--c-text-secondary)]">{a.kind === 'pptx' ? '📊' : a.kind === 'docx' ? '📄' : a.kind === 'xlsx' ? '📈' : '📁'}</span>
                      <span>{a.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--c-border)] p-3">
        {status === 'running' || status === 'waiting_user' ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm bg-red-500 text-white hover:opacity-90"
          >
            Cancel
          </button>
        ) : (
          <ChatInput
            value={prompt}
            onChange={onPromptChange}
            onSubmit={onSubmit}
            placeholder="Continue or start new task..."
          />
        )}
      </div>
    </div>
  );
}
