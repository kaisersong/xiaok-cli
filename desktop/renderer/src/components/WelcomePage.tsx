import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, FolderKanban } from 'lucide-react';
import { ChatInput } from './ChatInput';
import { api } from '../api';
import type { AutomationOverviewSnapshotView } from '../api/types';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';
import { useKSwarm } from '../contexts/KSwarmContext';
import {
  automationFailureRoute,
  buildWelcomeHomeProjection,
  type WelcomeAttentionItem,
  type WelcomeHomeProjection,
} from './welcome-home-projection';

function useProfileName() {
  const [name, setName] = useState(() =>
    localStorage.getItem('xiaok_display_name')
    || getDesktopApi()?.systemUsername
    || ''
  );
  useEffect(() => {
    const handler = () => {
      setName(
        localStorage.getItem('xiaok_display_name')
        || getDesktopApi()?.systemUsername
        || ''
      );
    };
    window.addEventListener('xiaok-profile-changed', handler);
    return () => window.removeEventListener('xiaok-profile-changed', handler);
  }, []);
  return name;
}

function useTypewriter(text: string, speed = 80) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;
    if (!text) return;

    const timer = setInterval(() => {
      indexRef.current++;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) clearInterval(timer);
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  return displayed;
}

export function WelcomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [automation, setAutomation] = useState<AutomationOverviewSnapshotView | null>(null);
  const [automationLoadState, setAutomationLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const { t } = useLocale();
  const { projects, projectsLoaded } = useKSwarm();

  const username = useProfileName();
  const greeting = `${username}${t.welcome.greetingSuffix}`;
  const typedGreeting = useTypewriter(greeting, 60);
  const projection = useMemo(() => buildWelcomeHomeProjection(projects, automation), [automation, projects]);
  const projectsUnavailable = projects.length === 0 && !projectsLoaded;
  const automationLoading = automationLoadState === 'loading';
  const automationUnavailable = automationLoadState === 'error';

  useEffect(() => {
    let active = true;
    api.getAutomationOverviewSnapshot()
      .then(snapshot => {
        if (active) {
          setAutomation(snapshot);
          setAutomationLoadState('ready');
        }
      })
      .catch(() => {
        if (active) {
          setAutomation(null);
          setAutomationLoadState('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (text: string, files?: Array<{ filePath: string; name: string }>) => {
    const thread = await api.createThread({ title: text.slice(0, 40) });

    try {
      let taskId: string;
      if (files && files.length > 0) {
        const filePaths = files.map(f => f.filePath);
        const result = await api.createTaskWithFiles({ prompt: text, filePaths });
        taskId = result.taskId;
      } else {
        const result = await api.createTask({ prompt: text, materials: [] });
        taskId = result.taskId;
      }
      await api.updateThreadTaskId(thread.id, taskId);
    } catch (e) {
      console.error('[WelcomePage] createTask failed:', (e as Error).message);
    }

    navigate(`/t/${thread.id}`, {
      state: {
        initialPrompt: text,
        ...(files && files.length > 0
          ? { initialFiles: files.map(file => ({ filePath: file.filePath, name: file.name })) }
          : {}),
      },
    });
  };

  const handleQuickPrompt = (p: string) => {
    setPrompt(p);
  };

  const openAttentionItem = (item: WelcomeAttentionItem) => {
    navigate(item.kind === 'project' ? `/projects/${item.id}` : automationFailureRoute(item.failure));
  };

  return (
    <div className="flex min-h-full flex-1 flex-col px-6 pt-[clamp(4rem,12vh,6.25rem)] sm:px-8">
      <ConversationFirstHome
        typedGreeting={typedGreeting}
        prompt={prompt}
        setPrompt={setPrompt}
        onSubmit={handleSubmit}
        onQuickPrompt={handleQuickPrompt}
        projection={projection}
        onOpenItem={openAttentionItem}
        automationLoading={automationLoading}
        automationUnavailable={automationUnavailable}
        projectsUnavailable={projectsUnavailable}
      />
    </div>
  );
}

type HomeContentProps = {
  typedGreeting: string;
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: (text: string, files?: Array<{ filePath: string; name: string }>) => Promise<void>;
  projection: WelcomeHomeProjection;
  onOpenItem: (item: WelcomeAttentionItem) => void;
  automationLoading: boolean;
  automationUnavailable: boolean;
  projectsUnavailable: boolean;
};

function ConversationFirstHome({
  typedGreeting,
  prompt,
  setPrompt,
  onSubmit,
  projection,
  onOpenItem,
  onQuickPrompt,
  automationLoading,
  automationUnavailable,
  projectsUnavailable,
}: HomeContentProps & { onQuickPrompt: (prompt: string) => void }) {
  const { t } = useLocale();
  const attentionUnavailable = projectsUnavailable || automationLoading || automationUnavailable;
  const availabilityMessages = [
    projectsUnavailable ? t.welcome.projectsUnavailable : '',
    automationLoading ? t.welcome.automationLoading : '',
    automationUnavailable ? t.welcome.automationUnavailable : '',
  ].filter(Boolean);
  const attentionEmptyLabel = availabilityMessages.join(' · ') || t.welcome.noAttention;
  return (
    <div data-testid="welcome-home" className="mx-auto flex w-full max-w-[920px] flex-col items-center pb-24">
      <h1 className="min-h-[2.5rem] text-center text-3xl font-medium text-[var(--c-text-primary)]">{typedGreeting}</h1>
      <p className="mt-1 text-sm text-[var(--c-text-secondary)]">{t.welcome.conversationSubtitle}</p>
      <div className="mt-6 w-full max-w-2xl">
        <ChatInput value={prompt} onChange={setPrompt} onSubmit={onSubmit} placeholder={t.welcome.inputPlaceholder} autoFocus />
      </div>
      <QuickPrompts onSelect={onQuickPrompt} />
      <section className="mt-[clamp(5rem,15vh,8rem)] w-full border-y border-[var(--c-border)] py-4" aria-labelledby="welcome-overview-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="welcome-overview-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.welcome.overviewTitle}</h2>
          <span className="text-xs text-[var(--c-text-tertiary)]">{t.welcome.readOnlySummary}</span>
        </div>
        <MetricStrip
          projection={projection}
          projectsUnavailable={projectsUnavailable}
          attentionUnavailable={attentionUnavailable}
          automationLoading={automationLoading}
          automationUnavailable={automationUnavailable}
        />
        {availabilityMessages.length > 0 && projection.attentionItems.length > 0 && (
          <p className="mt-3 text-xs text-[var(--c-text-tertiary)]">
            {availabilityMessages.join(' · ')}
          </p>
        )}
      </section>
      <section className="mt-5 w-full" aria-labelledby="welcome-continue-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="welcome-continue-title" className="text-sm font-semibold text-[var(--c-text-primary)]">{t.welcome.continueWork}</h2>
          <span className="text-xs text-[var(--c-text-tertiary)]">{t.welcome.topItemsOnly}</span>
        </div>
        <AttentionList items={projection.attentionItems.slice(0, 3)} onOpen={onOpenItem} emptyLabel={attentionEmptyLabel} />
      </section>
    </div>
  );
}

function QuickPrompts({ onSelect }: { onSelect: (prompt: string) => void }) {
  const { t } = useLocale();
  return (
    <div className="mt-4 w-full max-w-3xl">
      <div data-testid="quick-prompts" className="flex flex-wrap justify-center gap-2">
        {t.welcome.quickPrompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            title={prompt}
            className="whitespace-nowrap rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:border-[var(--c-accent)] hover:bg-[var(--c-bg-card)] hover:text-[var(--c-accent)]"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricStrip({
  projection,
  projectsUnavailable,
  attentionUnavailable,
  automationLoading,
  automationUnavailable,
}: {
  projection: WelcomeHomeProjection;
  projectsUnavailable: boolean;
  attentionUnavailable: boolean;
  automationLoading: boolean;
  automationUnavailable: boolean;
}) {
  const { t } = useLocale();
  const metrics = [
    { testId: 'welcome-metric-active-projects', label: t.welcome.activeProjects, value: projectsUnavailable ? '—' : projection.counts.activeProjects, icon: <FolderKanban size={15} /> },
    { testId: 'welcome-metric-attention', label: t.welcome.needsAttention, value: attentionUnavailable ? '—' : projection.counts.attention, icon: <AlertTriangle size={15} /> },
    { testId: 'welcome-metric-automations', label: t.welcome.activeAutomations, value: (automationLoading || automationUnavailable) ? '—' : projection.counts.activeAutomations, icon: <Bot size={15} /> },
    { testId: 'welcome-metric-completed', label: t.welcome.recentlyCompleted, value: projectsUnavailable ? '—' : projection.counts.completedProjects, icon: <CheckCircle2 size={15} /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {metrics.map(metric => (
        <div key={metric.testId} className="flex items-center gap-3 px-2 py-1">
          <span className="grid size-8 place-items-center rounded-md bg-[var(--c-bg-deep)] text-[var(--c-accent)]">{metric.icon}</span>
          <div>
            <p data-testid={metric.testId} className="text-lg font-semibold tabular-nums text-[var(--c-text-primary)]">{metric.value}</p>
            <p className="text-[11px] text-[var(--c-text-secondary)]">{metric.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionList({ items, onOpen, emptyLabel }: { items: WelcomeAttentionItem[]; onOpen: (item: WelcomeAttentionItem) => void; emptyLabel: string }) {
  const { t } = useLocale();
  if (items.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-[var(--c-text-secondary)]">{emptyLabel}</div>;
  }
  return (
    <div className="divide-y divide-[var(--c-border)]">
      {items.map(item => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          aria-label={t.welcome.openAttentionItem(
            item.title,
            item.kind === 'project' ? t.welcome.statusNeedsAction : t.welcome.statusFailed,
            item.reason,
            item.kind === 'project' ? item.nextStep : undefined,
          )}
          onClick={() => onOpen(item)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--c-bg-deep)]"
        >
          <span className={`grid size-8 shrink-0 place-items-center rounded-md ${item.kind === 'project' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-500'}`}>
            {item.kind === 'project' ? <FolderKanban size={15} /> : <Bot size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--c-text-primary)]">{item.title}</span>
              <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                {item.kind === 'project' ? t.welcome.statusNeedsAction : t.welcome.statusFailed}
              </span>
            </span>
            {item.reason && <span className="mt-1 block truncate text-xs text-[var(--c-text-secondary)]">{item.reason}</span>}
            {item.kind === 'project' && item.nextStep && (
              <span className="mt-1 block truncate text-[11px] text-[var(--c-text-tertiary)]">{t.welcome.nextStep(item.nextStep)}</span>
            )}
          </span>
          <ArrowRight size={14} className="shrink-0 text-[var(--c-text-tertiary)]" />
        </button>
      ))}
    </div>
  );
}
