import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatInput } from './ChatInput';
import type { ThreadRecord } from '../api/types';
import type { NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatViewProps {
  thread: ThreadRecord;
  messages: ChatMessage[];
  streamingText: string;
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
  thread, messages, streamingText, status, currentQuestion, result,
  prompt, onPromptChange, onSubmit, onAnswer, onCancel,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, status]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--c-bg-page)]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[800px] px-14 py-6">
          <div className="space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--c-accent)]/50 px-4 py-3 text-sm text-[var(--c-text-primary)] whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => <pre className="bg-[var(--c-bg-deep)] rounded-lg p-4 overflow-x-auto max-w-full">{children}</pre>,
                        code: ({ className, children, ...props }) => {
                          const isInline = !className;
                          if (isInline) {
                            return <code className="bg-[var(--c-bg-deep)] rounded px-1.5 py-0.5 text-sm" {...props}>{children}</code>;
                          }
                          return <code className={className} {...props}>{children}</code>;
                        },
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--c-accent)] hover:underline cursor-pointer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}

            {/* Streaming assistant text */}
            {streamingText && (
              <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
              </div>
            )}

            {/* Result card */}
            {result && status === 'completed' && (
              <div className="rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
                <h3 className="mb-2 text-sm font-medium text-[var(--c-text-primary)]">Result</h3>
                <p className="text-sm text-[var(--c-text-secondary)]">{result.summary}</p>
                {result.artifacts && result.artifacts.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {result.artifacts.map(a => (
                      <div key={a.artifactId} className="text-sm text-[var(--c-accent)] cursor-pointer hover:underline">
                        {a.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Thinking indicator */}
            {status === 'running' && !streamingText && (
              <div className="flex items-center gap-2 py-2">
                <div className="relative size-4 shrink-0">
                  <svg className="size-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" style={{ color: 'var(--c-accent)' }} />
                    <path className="opacity-80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" style={{ color: 'var(--c-accent)' }} />
                  </svg>
                </div>
                <span className="text-sm text-[var(--c-text-secondary)]">Thinking...</span>
              </div>
            )}

            {/* Question */}
            {currentQuestion && (
              <div className="rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
                <p className="mb-3 text-sm">{currentQuestion.prompt}</p>
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
            )}

            {/* Error */}
            {status === 'failed' && (
              <div className="flex items-start gap-3 py-2">
                <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-red-500" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <p className="text-sm text-[var(--c-text-secondary)]">Task failed. Please try again.</p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Input area */}
      <div
        className="flex w-full flex-col items-center gap-2"
        style={{
          padding: '12px var(--chat-input-horizontal-padding, 60px) 8px',
          maxWidth: 800,
          margin: '0 auto',
          background: 'linear-gradient(to bottom, transparent 0%, var(--c-bg-page) 24px)',
        }}
      >
        <ChatInput
          value={prompt}
          onChange={onPromptChange}
          onSubmit={onSubmit}
          placeholder={status === 'running' ? '输入消息...' : '回复...'}
          disabled={status === 'waiting_user'}
          isRunning={status === 'running'}
          onStop={onCancel}
        />
        <p className="text-[11px] text-[var(--c-text-secondary)] text-center">
          Xiaok is AI and can make mistakes.
        </p>
      </div>
    </div>
  );
}