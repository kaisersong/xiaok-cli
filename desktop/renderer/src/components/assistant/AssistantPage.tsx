import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleDot, RefreshCw, Settings2, X } from 'lucide-react';
import { api } from '../../api';
import { useLocale } from '../../contexts/LocaleContext';
import { useAssistantWorkspace } from '../../hooks/useAssistantWorkspace';
import { ASSISTANT_THREAD_ID } from '../../lib/assistant-thread';
import { ChatShell } from '../ChatShell';
import { AssistantWorkspaceContent } from './AssistantWorkspaceContent';

export function AssistantPage() {
  const { t } = useLocale();
  const labels = t.assistant.conversation;
  const data = useAssistantWorkspace();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftRequest, setDraftRequest] = useState<{ id: number; text: string }>();
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setFailed(false);
    try {
      await api.ensureAssistantThread(t.assistant.title);
      if (generation.current === current) setReady(true);
    } catch { if (generation.current === current) setFailed(true); }
  }, [t.assistant.title]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const prepare = (text: string) => {
    setDraftRequest(previous => ({ id: (previous?.id ?? 0) + 1, text }));
    setExpanded(false);
  };
  const workspace = <AssistantWorkspaceContent data={data} onPrepareSuggestion={prepare} />;
  const suggestion = data.overview?.suggestions[0];
  const compactCard = <div className="relative z-20 shrink-0 px-5 pt-4 pb-2">
    <section data-testid="assistant-compact-card" aria-label={t.assistant.title} className="mx-auto flex max-w-[920px] items-center gap-3 rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3">
      <CircleDot size={22} className="shrink-0 text-[var(--c-accent)]" />
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold text-[var(--c-text-primary)]">{t.assistant.title}</h1>
        {(data.errors.assistant || suggestion) && <p className="mt-0.5 truncate text-xs text-[var(--c-text-secondary)]">{data.errors.assistant ? t.assistant.unavailable : suggestion?.title}</p>}</div>
      {suggestion && <button type="button" className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--c-accent)] hover:bg-[var(--c-bg-deep)]" onClick={() => prepare(`请帮助我推进以下事项，先核对当前事实，再明确下一步：\n${suggestion.title}\n${suggestion.summary}`)}>{t.assistant.workspace.prepare}</button>}
      <button type="button" aria-label={labels.expand} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><Settings2 size={14}/><ChevronDown size={12}/></button>
    </section>
    {expanded && <div role="dialog" aria-label={labels.expand} className="absolute inset-x-5 top-full mx-auto max-h-[65vh] max-w-[1000px] overflow-y-auto rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-page)] shadow-xl"><div className="sticky top-0 z-10 flex justify-end bg-[var(--c-bg-page)] px-3 py-2"><button type="button" aria-label={labels.collapse} onClick={() => setExpanded(false)} className="rounded-lg p-2 text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"><X size={16}/></button></div><AssistantWorkspaceContent data={data} onPrepareSuggestion={prepare} iconOnly /></div>}
  </div>;
  return <div data-testid="assistant-page" className="flex min-h-0 flex-1 flex-col bg-[var(--c-bg-page)]">
    {!ready ? <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--c-text-secondary)]"><p role={failed ? 'alert' : 'status'}>{failed ? labels.loadFailed : labels.loading}</p>{failed && <button type="button" className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] px-4 py-2" onClick={() => void load()}><RefreshCw size={14}/>{t.assistant.refreshStatus}</button>}</div>
      : <ChatShell threadId={ASSISTANT_THREAD_ID} emptyContent={workspace} conversationHeader={compactCard} draftRequest={draftRequest} hideObservationControls />}
  </div>;
}
