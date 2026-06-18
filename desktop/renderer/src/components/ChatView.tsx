import { useRef, useEffect, useState, useCallback } from 'react';
import remarkGfm from 'remark-gfm';
import { BookOpen } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { ToolStepsMessage } from './ToolStepsMessage';
import { ProjectInlineCard } from './projects/ProjectInlineCard';
import { MarkdownRenderer } from './MarkdownRenderer';
import { A2uiArtifactBlock } from './a2ui/A2uiArtifactBlock';
import { api } from '../api';
import { getDesktopApi } from '../shared/desktop';
import type { ThreadRecord } from '../api/types';
import type { ArtifactSummary, NeedsUserQuestion, TaskResult } from '../../../shared/task-types';
import { A2UI_MIME_TYPE, isA2UIMimeType } from '../../../../src/a2ui/index.js';

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="复制"
      className={`flex items-center justify-center rounded p-1 text-[var(--c-text-tertiary)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)] ${className ?? ''}`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 8 6 12 14 4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
        </svg>
      )}
    </button>
  );
}

function SaveToKbButton({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleOpen = async () => {
    const desktop = getDesktopApi();
    if (!desktop?.kbListCollections) return;
    try {
      const cols = await desktop.kbListCollections() as Array<{ id: string; name: string }>;
      setCollections(cols);
      if (cols.length > 0 && !selectedId) setSelectedId(cols[0].id);
    } catch { /* ignore */ }
    setOpen(true);
  };

  const handleSave = async () => {
    const desktop = getDesktopApi();
    if (!desktop?.kbAddSource || !selectedId || !text.trim()) return;
    setSaving(true);
    try {
      await desktop.kbAddSource({
        collectionId: selectedId,
        kind: 'paste',
        title: title.trim() || '对话摘录',
        text,
      });
      setOpen(false);
      setTitle('');
      setToast('已添加到知识库');
      setTimeout(() => setToast(null), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => void handleOpen()}
        title="收藏到知识库"
        className="flex items-center justify-center rounded p-1 text-[var(--c-text-tertiary)] transition-colors hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-secondary)]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 2h12v14l-6-3-6 3V2z" />
        </svg>
      </button>
      {open && (
        <div ref={popoverRef} className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-[var(--c-text-primary)]">收藏到知识库</p>
          {collections.length === 0 ? (
            <p className="text-xs text-[var(--c-text-tertiary)]">暂无集合，请先在知识库页面创建</p>
          ) : (
            <>
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="mb-2 w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs outline-none"
              >
                {collections.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="标题（可选）"
                className="mb-2 w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 py-1 text-xs outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">取消</button>
                <button type="button" onClick={() => void handleSave()} disabled={saving} className="rounded bg-[var(--c-accent)] px-2 py-1 text-xs text-white disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
              </div>
            </>
          )}
        </div>
      )}
      {toast && (
        <span className="absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 shadow-sm">
          {toast}
        </span>
      )}
    </span>
  );
}

export interface ToolStep {
  toolUseId: string;
  toolName: string;
  input: unknown;
  displayInputSummary?: string;
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
              <div key={msg.id} className={msg.role === 'user' ? 'group/usermsg flex flex-col items-end' : msg.role === 'assistant' ? 'group/assistantmsg' : ''}>
                {msg.role === 'user' ? (
                  <>
                    <div data-role="user" className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 text-sm text-[var(--c-text-primary)] whitespace-pre-wrap break-words select-text" style={{ background: 'rgb(235,235,235)' }}>
                      {msg.content}
                    </div>
                    <div className="mt-0.5 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/usermsg:opacity-100">
                      <CopyButton text={msg.content} />
                      <SaveToKbButton text={msg.content} />
                    </div>
                  </>
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
                  <div className="group/resultmsg">
                    <ResultCard
                      result={msg.result ?? null}
                      generatedFiles={msg.generatedFiles ?? []}
                      onArtifactClick={onArtifactClick}
                      onArtifactOpenExternal={onArtifactOpenExternal}
                    />
                    {msg.result?.summary?.trim() && (
                      <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover/resultmsg:opacity-100">
                        <CopyButton text={msg.result.summary} />
                        <SaveToKbButton text={msg.result.summary} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed select-text">
                      <MarkdownRenderer content={msg.content} />
                    </div>
                    <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover/assistantmsg:opacity-100">
                      <CopyButton text={msg.content} />
                      <SaveToKbButton text={msg.content} />
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Streaming assistant text */}
            {streamingText && (
              <div className="max-w-[663px] text-sm text-[var(--c-text-primary)] leading-relaxed">
                <MarkdownRenderer content={streamingText} streaming />
              </div>
            )}

            {/* Result card + generated files (only if not already shown as a message) */}
            {!messages.some(m => m.role === 'result_card') && ((result && (status === 'completed' || status === 'idle')) || generatedFiles.length > 0) ? (
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

function ArtifactKbButton({ artifactId, title, filePath }: { artifactId: string; title: string; filePath?: string }) {
  const [saved, setSaved] = useState(false);
  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saved) return;
    const desktop = (window as any).xiaokDesktop;
    if (!desktop?.kbAddSource || !desktop?.kbListCollections) return;
    try {
      const collections = await desktop.kbListCollections();
      const collectionId = collections?.[0]?.id;
      if (!collectionId) return;
      let text = '';
      if (filePath && desktop.readFileContent) {
        const content = await desktop.readFileContent(filePath);
        text = typeof content === 'string' ? content : content?.text ?? '';
      }
      if (!text) text = `[产物] ${title} (${artifactId})`;
      await desktop.kbAddSource({ collectionId, kind: 'paste', title: title || '产物', text });
      setSaved(true);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={e => void handleSave(e)}
      disabled={saved}
      title={saved ? '已添加到知识库' : '添加到知识库'}
      className={`shrink-0 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${saved ? 'text-[var(--c-accent)] cursor-default' : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] cursor-pointer'}`}
    >
      <BookOpen size={13} />
      {saved && <span>已添加</span>}
    </button>
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
  const [kbSaved, setKbSaved] = useState(false);
  const hasSummary = Boolean(result?.summary?.trim());
  const hasArtifacts = Boolean(result?.artifacts && result.artifacts.length > 0);
  if (!hasSummary && !hasArtifacts && generatedFiles.length === 0) return null;

  const handleSaveToKb = async () => {
    if (!result?.summary) return;
    const desktop = (window as any).xiaokDesktop;
    if (!desktop?.kbAddSource || !desktop?.kbListCollections) return;
    try {
      const collections = await desktop.kbListCollections();
      const collectionId = collections?.[0]?.id;
      if (!collectionId) return;
      await desktop.kbAddSource({
        collectionId,
        kind: 'paste',
        title: result.summary.slice(0, 50).replace(/[#*\n]/g, '').trim() || '任务结果',
        text: result.summary,
      });
      setKbSaved(true);
      setTimeout(() => setKbSaved(false), 2500);
    } catch {}
  };

  return (
    <div className="relative rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
      {hasSummary && (
        <button
          type="button"
          onClick={() => void handleSaveToKb()}
          title="添加到知识库"
          className={`absolute right-3 top-3 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${kbSaved ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'}`}
        >
          <BookOpen size={13} />
          {kbSaved && <span>已添加</span>}
        </button>
      )}
      {hasSummary && result ? (
        <MarkdownRenderer content={result.summary} />
      ) : null}
      {result?.artifacts && result.artifacts.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {result.artifacts.map(a => {
            if (isA2uiArtifact(a)) {
              return (
                <A2uiResultArtifactPreview
                  key={a.artifactId}
                  artifact={a}
                  onArtifactClick={onArtifactClick}
                  onArtifactOpenExternal={onArtifactOpenExternal}
                />
              );
            }
            const ext = a.title?.split('.').pop()?.toUpperCase() || 'FILE';
            return (
              <div key={a.artifactId} className="flex w-full items-center gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 transition-colors hover:border-[var(--c-accent)]/50 hover:bg-[var(--c-bg-card)]">
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  onClick={(e) => {
                    const info = { artifactId: a.artifactId, title: a.title, kind: a.kind, filePath: a.filePath };
                    if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                    else onArtifactClick?.(info);
                  }}
                  data-testid={`generated-file-${a.title}`}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] text-xs font-mono text-[var(--c-text-tertiary)]">
                    {'</>'}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="truncate text-sm font-medium text-[var(--c-text-heading)]">{a.title}</span>
                    <span className="text-xs text-[var(--c-text-tertiary)]">Code · {ext}</span>
                  </div>
                </div>
                <ArtifactKbButton artifactId={a.artifactId} title={a.title} filePath={a.filePath} />
                <span
                  className="shrink-0 cursor-pointer rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    const info = { artifactId: a.artifactId, title: a.title, kind: a.kind, filePath: a.filePath };
                    onArtifactClick?.(info);
                  }}
                >打开</span>
              </div>
            );
          })}
        </div>
      )}
      {(!result?.artifacts || result.artifacts.length === 0) && generatedFiles.length > 0 && (
        <div className="mt-3 flex flex-col gap-2" data-testid="generated-files-list">
          {generatedFiles.map(f => {
            const ext = f.name?.split('.').pop()?.toUpperCase() || 'FILE';
            return (
              <div
                key={f.filePath}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 transition-colors hover:border-[var(--c-accent)]/50 hover:bg-[var(--c-bg-card)]"
              >
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  onClick={(e) => {
                    const info = { artifactId: f.filePath, title: f.name, kind: 'other', filePath: f.filePath };
                    if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
                    else onArtifactClick?.(info);
                  }}
                  data-testid={`generated-file-${f.name}`}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] text-xs font-mono text-[var(--c-text-tertiary)]">
                    {'</>'}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="truncate text-sm font-medium text-[var(--c-text-heading)]">{f.name}</span>
                    <span className="text-xs text-[var(--c-text-tertiary)]">Code · {ext}</span>
                  </div>
                </div>
                <ArtifactKbButton artifactId={f.filePath} title={f.name} filePath={f.filePath} />
                <span
                  className="shrink-0 cursor-pointer rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                  onClick={() => {
                    const info = { artifactId: f.filePath, title: f.name, kind: 'other', filePath: f.filePath };
                    onArtifactClick?.(info);
                  }}
                >打开</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isA2uiArtifact(artifact: ArtifactSummary): boolean {
  return artifact.kind === 'a2ui'
    || isA2UIMimeType(artifact.mimeType)
    || artifact.title.endsWith('.a2ui.json')
    || Boolean(artifact.filePath?.endsWith('.a2ui.json'));
}

function A2uiResultArtifactPreview({
  artifact,
  onArtifactClick,
  onArtifactOpenExternal,
}: {
  artifact: ArtifactSummary;
  onArtifactClick?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
  onArtifactOpenExternal?: (artifact: { artifactId: string; title: string; kind: string; filePath?: string }) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setFailed(false);
    if (!artifact.filePath) {
      setFailed(true);
      return () => {
        cancelled = true;
      };
    }
    api.readFileContent(artifact.filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setFailed(true);
          return;
        }
        setContent(result.content);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.artifactId, artifact.filePath]);

  const info = {
    artifactId: artifact.artifactId,
    title: artifact.title,
    kind: artifact.kind,
    filePath: artifact.filePath,
  };
  return (
    <div
      className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3"
      data-testid={`a2ui-artifact-${artifact.title}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">{artifact.title}</div>
          <div className="text-xs text-[var(--c-text-tertiary)]">Interactive UI · A2UI</div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            if ((e.metaKey || e.ctrlKey) && onArtifactOpenExternal) onArtifactOpenExternal(info);
            else onArtifactClick?.(info);
          }}
          className="shrink-0 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-hover)]"
          data-testid={`generated-file-${artifact.title}`}
        >
          打开
        </button>
      </div>
      {failed ? (
        <div role="alert" className="text-sm text-[var(--c-text-secondary)]">无法加载该交互式 UI</div>
      ) : content === null ? (
        <div className="text-sm text-[var(--c-text-tertiary)]">正在解析交互式 UI...</div>
      ) : (
        <A2uiArtifactBlock
          content={content}
          artifactRef={{
            artifactId: artifact.artifactId,
            type: 'artifact',
            title: artifact.title,
            filename: artifact.title,
            key: artifact.filePath,
            mime_type: artifact.mimeType || A2UI_MIME_TYPE,
            size: artifact.sizeBytes,
          }}
        />
      )}
    </div>
  );
}
