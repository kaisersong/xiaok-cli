import { useRef, useEffect } from 'react';
import remarkGfm from 'remark-gfm';
import { ChatInput } from './ChatInput';
import { ToolStepsMessage } from './ToolStepsMessage';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ThreadRecord } from '../api/types';
import type { NeedsUserQuestion, TaskResult } from '../../../../src/runtime/task-host/types';

export interface ToolStep {
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  response?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'progress' | 'tool_steps';
  content: string;
  stage?: string;
  steps?: ToolStep[];
  stepsLive?: boolean;
}

interface GeneratedFile {
  filePath: string;
  name: string;
}

interface ChatViewProps {
  thread: ThreadRecord;
  messages: ChatMessage[];
  streamingText: string;
  status: 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed';
  currentQuestion: NeedsUserQuestion | null;
  result: TaskResult | null;
  generatedFiles: GeneratedFile[];
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (text: string, files?: Array<{ filePath: string; name: string }>) => void;
  onAnswer: (choiceId: string) => void;
  onCancel: () => void;
  canvasOpen: boolean;
  onToggleCanvas: () => void;
  onArtifactClick?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
  onArtifactOpenExternal?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
}

export function ChatView({
  thread, messages, streamingText, status, currentQuestion, result,
  generatedFiles,
  prompt, onPromptChange, onSubmit, onAnswer, onCancel,
  canvasOpen, onToggleCanvas, onArtifactClick, onArtifactOpenExternal,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const lastScrollTimeRef = useRef(0);

  // Track whether user manually scrolled away from bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Throttled auto-scroll: only when at bottom, max once per 100ms
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const now = Date.now();
    if (now - lastScrollTimeRef.current < 100) return;
    lastScrollTimeRef.current = now;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [messages, streamingText, status]);

  // Keyboard shortcut: Ctrl+Shift+C to toggle canvas
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        onToggleCanvas();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleCanvas]);

  // Enable context menu for copy/select
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection()?.toString();
    if (selection) {
      // Use native clipboard API
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--c-bg-page)]" onContextMenu={handleContextMenu}>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ userSelect: 'text' }}>
        <div className="mx-auto max-w-[800px] px-14 py-6">
          <div className="space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                {msg.role === 'user' ? (
                  <div data-role="user" className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 text-sm text-[var(--c-text-primary)] whitespace-pre-wrap break-words select-text" style={{ background: 'rgb(235,235,235)' }}>
                    {msg.content}
                  </div>
                ) : msg.role === 'progress' ? (
                  <div className="flex items-center gap-2 py-1 text-sm text-[var(--c-text-secondary)] select-text">
                    <div className="relative size-3 shrink-0" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {msg.stage === 'completed' ? (
                        <span style={{ color: '#22c55e', fontSize: 13 }}>✓</span>
                      ) : msg.stage === 'failed' ? (
                        <span style={{ color: '#ef4444', fontSize: 13 }}>✕</span>
                      ) : (
                        <svg className="size-3 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" style={{ color: 'var(--c-accent)' }} />
                          <path className="opacity-80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 12a8 8 0 0 1 8-8" style={{ color: 'var(--c-accent)' }} />
                        </svg>
                      )}
                    </div>
                    <span>{msg.content}</span>
                  </div>
                ) : msg.role === 'tool_steps' ? (
                  <ToolStepsMessage steps={msg.steps ?? []} live={msg.stepsLive ?? false} />
                ) : (
                  <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed select-text">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                )}
              </div>
            ))}

            {/* Streaming assistant text */}
            {streamingText && (
              <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed">
                <MarkdownRenderer content={streamingText} streaming />
              </div>
            )}

            {/* Result card + generated files */}
            {(result && (status === 'completed' || status === 'idle')) || generatedFiles.length > 0 ? (
              <div className="rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
                {result && (
                  <MarkdownRenderer content={result.summary} />
                )}
                {result?.artifacts && result.artifacts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.artifacts.map(a => (
                      <div key={a.artifactId}>
                        <button
                          type="button"
                          onClick={(e) => {
                            const info = { artifactId: a.artifactId, title: a.title, kind: a.kind, filePath: a.filePath };
                            if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                            else onArtifactClick?.(info);
                          }}
                          className="flex items-center gap-1.5 text-sm text-[var(--c-accent)] hover:underline cursor-pointer"
                        >
                          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor"><path d="M4 1h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm5 0v4h4M7 9h4M7 12h4M5 9h1M5 12h1"/></svg>
                          {a.title}
                        </button>
                        {a.creator && (
                          <div className="ml-5 mt-0.5 text-[11px] text-[var(--c-text-tertiary)]">
                            由 {a.creator === 'agent' ? 'Agent' : a.creator} 创建
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {((result?.artifacts && result.artifacts.length > 0) || generatedFiles.length > 0) && (
                  <div className={result && !(result?.artifacts && result.artifacts.length > 0) && generatedFiles.length > 0 ? 'mt-3' : ''}>
                    <div className="space-y-2" data-testid="generated-files-list">
                      {result?.artifacts && result.artifacts.map(a => (
                        <div key={a.artifactId}>
                          <button
                            type="button"
                            onClick={(e) => {
                              const info = { artifactId: a.artifactId, title: a.title, kind: a.kind, filePath: a.filePath };
                              if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                              else onArtifactClick?.(info);
                            }}
                            className="flex items-center gap-1.5 text-sm text-[var(--c-accent)] hover:underline cursor-pointer"
                            data-testid={`generated-file-${a.title}`}
                          >
                            <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor"><path d="M4 1h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm5 0v4h4M7 9h4M7 12h4M5 9h1M5 12h1"/></svg>
                            {a.title}
                          </button>
                          {a.creator && (
                            <div className="ml-5 mt-0.5 text-[11px] text-[var(--c-text-tertiary)]">
                              由 {a.creator === 'agent' ? 'Agent' : a.creator} 创建
                            </div>
                          )}
                        </div>
                      ))}
                      {(!result?.artifacts || result.artifacts.length === 0) && generatedFiles.map(f => (
                        <button
                          key={f.filePath}
                          type="button"
                          onClick={(e) => {
                            const info = { artifactId: f.filePath, title: f.name, kind: 'other', filePath: f.filePath };
                            if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                            else onArtifactClick?.(info);
                          }}
                          className="flex items-center gap-1.5 text-sm text-[var(--c-accent)] hover:underline cursor-pointer"
                          data-testid={`generated-file-${f.name}`}
                        >
                          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor"><path d="M4 1h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm5 0v4h4M7 9h4M7 12h4M5 9h1M5 12h1"/></svg>
                          {f.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Running indicator – always visible while task is running */}
            {status === 'running' && (
              <div className="flex items-center gap-2 py-2">
                <div className="relative size-4 shrink-0">
                  <svg className="size-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" style={{ color: 'var(--c-accent)' }} />
                    <path className="opacity-80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" style={{ color: 'var(--c-accent)' }} />
                  </svg>
                </div>
                <span className="text-sm text-[var(--c-text-secondary)]">
                  {streamingText ? 'Working...' : 'Thinking...'}
                </span>
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
        <p className="text-[11px] text-[var(--c-text-tertiary)] text-center select-none">
          xiaok desktop v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}