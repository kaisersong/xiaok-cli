import { useRef, useEffect } from 'react';
import remarkGfm from 'remark-gfm';
import { ChatInput } from './ChatInput';
import { ToolStepsMessage } from './ToolStepsMessage';
import { ProjectInlineCard } from './projects/ProjectInlineCard';
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

export interface ProjectCardData {
  type: 'project_card';
  projectId: string;
  name: string;
  goal: string;
  status: string;
  createdAt: number;
  memberCount: number;
  executionMode?: string;
}

export interface ComputerUseActionData {
  code: string;
  message: string;
  actionType?: string;
  label?: string;
  status?: 'idle' | 'working' | 'ready' | 'failed' | 'dismissed';
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'progress' | 'tool_steps' | 'project_card' | 'computer_use_action' | 'result_card';
  content: string;
  stage?: string;
  steps?: ToolStep[];
  stepsLive?: boolean;
  projectData?: ProjectCardData;
  computerUseAction?: ComputerUseActionData;
  result?: TaskResult | null;
  generatedFiles?: GeneratedFile[];
}

export interface GeneratedFile {
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
  onQueue?: (text: string) => void;
  queuedText?: string | null;
  onCancelQueue?: () => void;
  onAnswer: (choiceId: string) => void;
  onCancel: () => void;
  onComputerUseAction?: (messageId: string, action: ComputerUseActionData) => void;
  onComputerUseDismiss?: (messageId: string) => void;
  canvasOpen: boolean;
  onToggleCanvas: () => void;
  onArtifactClick?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
  onArtifactOpenExternal?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
}

export function ChatView({
  thread, messages, streamingText, status, currentQuestion, result,
  generatedFiles,
  prompt, onPromptChange, onSubmit, onQueue, queuedText, onCancelQueue, onAnswer, onCancel,
  onComputerUseAction, onComputerUseDismiss,
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--c-bg-page)]">
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
                ) : msg.role === 'project_card' && msg.projectData ? (
                  <ProjectInlineCard
                    projectId={msg.projectData.projectId}
                    name={msg.projectData.name}
                    goal={msg.projectData.goal || ''}
                    status={msg.projectData.status}
                    createdAt={msg.projectData.createdAt}
                    memberCount={msg.projectData.memberCount}
                    executionMode={msg.projectData.executionMode}
                  />
                ) : msg.role === 'computer_use_action' && msg.computerUseAction ? (
                  <div className="max-w-[663px] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 text-sm text-[var(--c-text-primary)] shadow-sm">
                    <div className="font-medium">需要启用 Computer Use</div>
                    <div className="mt-1 text-[var(--c-text-secondary)]">
                      {msg.computerUseAction.message || 'xiaok 需要通过 CUA Driver 查看屏幕和窗口内容。'}
                    </div>
                    {msg.computerUseAction.detail ? (
                      <div className="mt-2 text-xs text-[var(--c-text-muted)]">{msg.computerUseAction.detail}</div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.computerUseAction.status !== 'dismissed' && msg.computerUseAction.actionType ? (
                        <button
                          type="button"
                          disabled={msg.computerUseAction.status === 'working' || msg.computerUseAction.status === 'ready'}
                          onClick={() => onComputerUseAction?.(msg.id, msg.computerUseAction!)}
                          className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          {msg.computerUseAction.status === 'working'
                            ? '处理中'
                            : msg.computerUseAction.status === 'ready'
                              ? '已启用'
                              : msg.computerUseAction.label || '启用 Computer Use'}
                        </button>
                      ) : null}
                      {msg.computerUseAction.status !== 'ready' ? (
                        <button
                          type="button"
                          onClick={() => onComputerUseDismiss?.(msg.id)}
                          className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-hover)]"
                        >
                          暂不启用
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : msg.role === 'result_card' ? (
                  <ResultCard
                    result={msg.result ?? null}
                    generatedFiles={msg.generatedFiles ?? []}
                    onArtifactClick={onArtifactClick}
                    onArtifactOpenExternal={onArtifactOpenExternal}
                  />
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
              <ResultCard
                result={result}
                generatedFiles={generatedFiles}
                onArtifactClick={onArtifactClick}
                onArtifactOpenExternal={onArtifactOpenExternal}
              />
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
                <p className="text-sm text-[var(--c-text-secondary)]">任务未完成，请检查模型配置或稍后重试。</p>
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
          onQueue={onQueue}
          queuedText={queuedText}
          onCancelQueue={onCancelQueue}
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

function ResultCard({
  result,
  generatedFiles,
  onArtifactClick,
  onArtifactOpenExternal,
}: {
  result: TaskResult | null;
  generatedFiles: GeneratedFile[];
  onArtifactClick?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
  onArtifactOpenExternal?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
}) {
  const hasSummary = Boolean(result?.summary?.trim());
  const hasArtifacts = Boolean(result?.artifacts && result.artifacts.length > 0);
  if (!hasSummary && !hasArtifacts && generatedFiles.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
      {hasSummary && result ? (
        <MarkdownRenderer content={result.summary} />
      ) : null}
      {result?.artifacts && result.artifacts.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {result.artifacts.map(a => {
            const ext = a.title?.split('.').pop()?.toUpperCase() || 'FILE';
            return (
              <button
                key={a.artifactId}
                type="button"
                onClick={(e) => {
                  const info = { artifactId: a.artifactId, title: a.title, kind: a.kind, filePath: a.filePath };
                  if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                  else onArtifactClick?.(info);
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 transition-colors hover:border-[var(--c-accent)]/50 hover:bg-[var(--c-bg-card)] cursor-pointer"
                data-testid={`generated-file-${a.title}`}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] text-xs font-mono text-[var(--c-text-tertiary)]">
                  {'</>'}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate text-sm font-medium text-[var(--c-text-heading)]">{a.title}</span>
                  <span className="text-xs text-[var(--c-text-tertiary)]">Code · {ext}</span>
                </div>
                <span className="shrink-0 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)]">打开</span>
              </button>
            );
          })}
        </div>
      )}
      {(!result?.artifacts || result.artifacts.length === 0) && generatedFiles.length > 0 && (
        <div className="mt-3 flex flex-col gap-2" data-testid="generated-files-list">
          {generatedFiles.map(f => {
            const ext = f.name?.split('.').pop()?.toUpperCase() || 'FILE';
            return (
              <button
                key={f.filePath}
                type="button"
                onClick={(e) => {
                  const info = { artifactId: f.filePath, title: f.name, kind: 'other', filePath: f.filePath };
                  if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                  else onArtifactClick?.(info);
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 transition-colors hover:border-[var(--c-accent)]/50 hover:bg-[var(--c-bg-card)] cursor-pointer"
                data-testid={`generated-file-${f.name}`}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] text-xs font-mono text-[var(--c-text-tertiary)]">
                  {'</>'}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate text-sm font-medium text-[var(--c-text-heading)]">{f.name}</span>
                  <span className="text-xs text-[var(--c-text-tertiary)]">Code · {ext}</span>
                </div>
                <span className="shrink-0 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)]">打开</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
