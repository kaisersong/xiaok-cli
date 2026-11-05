import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronRight, CircleDot, Clock3, Mail, MessagesSquare, Newspaper, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../contexts/LocaleContext';
import { useAssistantWorkspace } from '../../hooks/useAssistantWorkspace';
import { ASSISTANT_WATCH_IDS, assistantWatchCreateRoute } from '../../lib/assistant-watch-presets';
import { getAssistantScheduleDisplayName } from '../../lib/assistant-schedule-display';
import { getDesktopApi } from '../../shared/desktop';
import { ASSISTANT_ACCEPT_RESULT_SCHEMA, ASSISTANT_CANDIDATE_SCHEMA, ASSISTANT_PROFILE_SCHEMA } from '../../../../shared/assistant-ipc-contract';
import { AssistantDetailPanel } from './AssistantDetailPanel';
import { AppConnectorsSettings } from '../settings/AppConnectorsSettings';

const WATCH_ICONS = { ai_news: Newspaper, yzj_messages: MessagesSquare, yzj_calendar: CalendarDays, important_email: Mail };
const surface = 'rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)]';
const subtleButton = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] disabled:opacity-50';

export function AssistantWorkspaceContent({ data, onPrepareSuggestion, iconOnly = false }: {
  data: ReturnType<typeof useAssistantWorkspace>;
  onPrepareSuggestion?: (text: string) => void;
  iconOnly?: boolean;
}) {
  const { t, locale } = useLocale();
  const labels = t.assistant.workspace;
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [collectionError, setCollectionError] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const life = useRef({ active: true, collectionRevision: 0 });
  useEffect(() => {
    const owner = { active: true, collectionRevision: 0 }; life.current = owner;
    return () => { owner.active = false; };
  }, []);
  const displayTime = (value: number) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
  const openDetails = async () => {
    const owner = life.current; const revision = ++owner.collectionRevision;
    setDetailsOpen(true); setCollections([]); setCollectionError(false);
    try {
      const values = await getDesktopApi()!.kbListCollections();
      if (!owner.active || owner.collectionRevision !== revision) return;
      setCollections(values.map(value => ({ id: value.id, name: value.name })));
    } catch { if (owner.active && owner.collectionRevision === revision) setCollectionError(true); }
  };
  const setStatus = (action: 'activateAssistant' | 'pauseAssistant' | 'resumeAssistant') => data.mutate(async () => {
    ASSISTANT_PROFILE_SCHEMA.parse(await getDesktopApi()![action]());
  });
  const decideCandidate = async (candidateId: string, decision: 'accept' | 'reject', collectionId?: string) => {
    if (data.operationUnknown || data.mutationBusy) return;
    setBusyCandidateId(candidateId);
    await data.mutate(async () => {
      const desktop = getDesktopApi()!;
      if (decision === 'accept') ASSISTANT_ACCEPT_RESULT_SCHEMA.parse(await desktop.acceptAssistantCandidate({ candidateId, ...(collectionId ? { collectionId } : {}) }));
      else ASSISTANT_CANDIDATE_SCHEMA.parse(await desktop.rejectAssistantCandidate({ candidateId }));
    });
    if (life.current.active) setBusyCandidateId(null);
  };
  const profile = data.overview?.profile;
  const suggestions = profile?.status === 'active' ? data.overview?.suggestions.slice(0, 3) ?? [] : [];
  const pendingCount = data.overview?.pendingCandidateCount ?? 0;
  const history = [...(data.history ?? [])].filter(run => run.automationKind !== 'notify').sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
  const schedules = [...(data.schedules ?? [])].filter(task => !task.id.startsWith('assistant:')).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  const runRoute = (run: NonNullable<typeof data.history>[number]) => run.actionId
    ? `/automations/schedules#task-${encodeURIComponent(run.actionId)}`
    : run.loopId ? `/automations/loops#loop-${encodeURIComponent(run.loopId)}` : '/automations/diagnostics';

  return (
    <div data-testid="assistant-workspace-entry" className="min-h-0 flex-1 overflow-y-auto bg-[var(--c-bg-page)]">
      <main className="mx-auto w-full max-w-[1120px] px-5 py-4 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3" data-testid="assistant-workspace-summary">
          <div className="flex items-center gap-2.5"><CircleDot aria-hidden="true" size={21} className="text-[var(--c-accent)]"/>{!iconOnly && <h1 className="text-base font-semibold text-[var(--c-text-primary)]">{t.assistant.title}</h1>}</div>
          <div className="flex items-center gap-1">
            <button type="button" aria-expanded={sourceOpen} onClick={() => setSourceOpen(value => !value)} className={subtleButton}>{labels.openSource}<ChevronRight size={13}/></button>
            <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)} className={subtleButton}><Settings2 size={14}/>{labels.settings}</button>
            <button type="button" aria-label={t.assistant.refreshStatus} title={t.assistant.refreshStatus} onClick={data.refresh} disabled={data.reading} aria-busy={data.reading} className={subtleButton}><RefreshCw size={14}/></button>
          </div>
        </header>
        {data.operationUnknown && <p role="alert" className="mt-3 rounded-lg bg-[var(--c-bg-deep)] p-3 text-sm text-[var(--c-text-primary)]">{t.assistant.operationUnknown}</p>}
        {data.errors.assistant ? <p role="alert" className="mt-3 text-xs text-[var(--c-text-secondary)]">{t.assistant.unavailable}</p> : !profile ? <p className="mt-3 text-xs text-[var(--c-text-secondary)]">{t.assistant.loading}</p> : null}
        {profile?.status === 'needs_consent' && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--c-bg-deep)] p-3"><p className="min-w-0 flex-1 text-xs leading-5 text-[var(--c-text-secondary)]">{t.assistant.consentDescription}</p><button type="button" disabled={data.mutationBusy || data.operationUnknown} className={subtleButton} onClick={() => setStatus('activateAssistant')}>{t.assistant.activate}</button></div>}
        {settingsOpen && <div className="mt-3 rounded-lg border border-[var(--c-border-subtle)] p-3 text-xs text-[var(--c-text-secondary)]">
          {profile && <div className="flex flex-wrap items-center justify-between gap-2"><span>{profile.status === 'active' ? t.assistant.activeDescription(profile.eveningTime, profile.morningTime) : profile.status === 'paused' ? t.assistant.pausedDescription : t.assistant.consentDescription}</span><div className="flex items-center gap-1">{profile.status !== 'needs_consent' && <button type="button" disabled={data.mutationBusy || data.operationUnknown} className={subtleButton} onClick={() => setStatus(profile.status === 'active' ? 'pauseAssistant' : 'resumeAssistant')}>{profile.status === 'active' ? t.assistant.pause : t.assistant.resume}</button>}<button type="button" className={subtleButton} onClick={() => void openDetails()}>{t.assistant.openDetails}</button></div></div>}
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{data.errors.automation ? labels.automationUnavailable : !data.automation ? t.assistant.loading : data.automation.globalBackgroundAutoRunEnabled ? labels.backgroundEnabled : labels.backgroundPaused}</span><button type="button" className={subtleButton} onClick={() => navigate('/automations')}>{labels.manageSchedules}<ArrowRight size={13}/></button></div>
        </div>}
        {suggestions.length > 0 && <ul className="mt-4 divide-y divide-[var(--c-border-subtle)]">{suggestions.map(suggestion => <li key={suggestion.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium text-[var(--c-text-primary)]">{suggestion.title}</p><p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{suggestion.summary}</p></div><button type="button" aria-label={labels.prepareSuggestion(suggestion.title)} className={subtleButton} onClick={() => onPrepareSuggestion?.(`请帮助我推进以下事项，先核对当前事实，再明确下一步和交付：\n${suggestion.title}\n${suggestion.summary}`)}>{labels.prepare}<ArrowRight size={13}/></button></li>)}</ul>}
        {pendingCount > 0 && <button type="button" className={subtleButton} onClick={() => void openDetails()}>{t.assistant.pendingCandidates(pendingCount)}<ChevronRight size={13}/></button>}
        {sourceOpen && <div className={`mt-4 p-4 ${surface}`}><AppConnectorsSettings /></div>}

        <section className="mt-9" aria-labelledby="assistant-watches-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 id="assistant-watches-title" className="text-base font-semibold text-[var(--c-text-primary)]">{labels.watchesTitle}</h2><p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{labels.watchesDescription}</p></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ASSISTANT_WATCH_IDS.map(id => {
              const item = t.assistant.watches[id]; const Icon = WATCH_ICONS[id];
              return <button key={id} type="button" aria-label={labels.setupWatch(item.title)} onClick={() => navigate(assistantWatchCreateRoute(id))}
                className={`group flex min-w-0 flex-col p-4 text-left transition-colors hover:border-[var(--c-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] ${surface}`}>
                <div className="mb-4 flex w-full items-center justify-between"><Icon size={19} strokeWidth={1.6} className="text-[var(--c-accent)]" /><ArrowRight size={14} className="text-[var(--c-text-tertiary)] group-hover:text-[var(--c-accent)]" /></div>
                <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{item.title}</h3><p className="mt-2 flex-1 text-xs leading-5 text-[var(--c-text-secondary)]">{item.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-[11px] text-[var(--c-text-tertiary)]"><Clock3 size={11} />{item.cadence}</span>
                <span className="mt-1 text-[10px] text-[var(--c-text-tertiary)]">{item.requirement}</span>
              </button>;
            })}
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--c-text-tertiary)]">{labels.sourcesNotice}</p>
        </section>

        <div className="mt-9 grid items-start gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section aria-labelledby="assistant-runs-title" className="min-w-0">
            <h2 id="assistant-runs-title" className="text-base font-semibold text-[var(--c-text-primary)]">{labels.recentTitle}</h2>
            <p className="mt-1 text-xs text-[var(--c-text-tertiary)]">{labels.historyLimit}</p>
            <div className={`mt-4 divide-y divide-[var(--c-border-subtle)] ${surface}`}>
              {data.errors.history ? <p role="alert" className="p-5 text-sm text-[var(--c-text-secondary)]">{labels.historyUnavailable}</p> : data.history === null ? <p className="p-5 text-sm text-[var(--c-text-tertiary)]">{t.assistant.loading}</p> : history.length === 0 ? <p className="p-5 text-sm text-[var(--c-text-secondary)]">{labels.noHistory}</p> : history.map(run => {
                const status = run.completionObservation?.state === 'needs_revalidation' ? labels.needsRevalidation : run.status === 'success' && run.automationKind === 'agent_task' ? labels.dispatched : labels.states[run.status];
                return <button key={run.id} type="button" aria-label={labels.openRun(run.title)} onClick={() => navigate(runRoute(run))} className="block w-full rounded-lg p-4 text-left hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]">
                  <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-medium text-[var(--c-text-primary)]">{run.title}</h3><ChevronRight size={14} className="mt-1 shrink-0 text-[var(--c-text-tertiary)]" /></div>
                  {run.message && <p className="mt-1.5 line-clamp-3 break-words text-xs leading-5 text-[var(--c-text-secondary)]">{run.message}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--c-text-tertiary)]"><span>{status}</span><time dateTime={new Date(run.startedAt).toISOString()}>{displayTime(run.startedAt)}</time></div>
                </button>;
              })}
            </div>
          </section>
          <section aria-labelledby="assistant-schedules-title" className="min-w-0">
            <h2 id="assistant-schedules-title" className="text-base font-semibold text-[var(--c-text-primary)]">{labels.schedulesTitle}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--c-text-tertiary)]">{labels.scheduleNotice}</p>
            <div className={`mt-4 divide-y divide-[var(--c-border-subtle)] ${surface}`}>
              {data.errors.schedules ? <p role="alert" className="p-5 text-sm text-[var(--c-text-secondary)]">{labels.schedulesUnavailable}</p> : data.schedules === null ? <p className="p-5 text-sm text-[var(--c-text-tertiary)]">{t.assistant.loading}</p> : schedules.length === 0 ? <p className="p-5 text-sm text-[var(--c-text-secondary)]">{labels.noSchedules}</p> : schedules.map(task => {
                const title = getAssistantScheduleDisplayName(task, t.assistant);
                return <button key={task.id} type="button" aria-label={labels.openSchedule(title)} onClick={() => navigate(`/automations/schedules#task-${encodeURIComponent(task.id)}`)} className="block w-full rounded-lg p-4 text-left hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]">
                  <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-medium text-[var(--c-text-primary)]">{title}</h3><ChevronRight size={14} className="mt-1 shrink-0 text-[var(--c-text-tertiary)]" /></div>
                  <p className="mt-2 text-[11px] text-[var(--c-text-secondary)]">{task.status === 'active' ? labels.scheduleActive : labels.schedulePaused}</p>
                  <p className="mt-1 text-[11px] text-[var(--c-text-tertiary)]">{task.nextRunAt ? labels.nextRun(displayTime(task.nextRunAt)) : labels.noNextRun}</p>
                </button>;
              })}
            </div>
          </section>
        </div>
        <footer className="mt-9 flex items-start gap-2 border-t border-[var(--c-border-subtle)] pt-4 text-xs leading-5 text-[var(--c-text-tertiary)]"><Sparkles size={13} className="mt-1 shrink-0" />{labels.runtimeNotice}</footer>
        {collectionError && <p role="alert" className="mt-3 text-xs text-[var(--c-text-secondary)]">{labels.readFailed}</p>}
        {data.overview && <AssistantDetailPanel open={detailsOpen} profile={data.overview.profile} candidates={data.overview.candidates} knowledgeCollections={collections} busyCandidateId={data.mutationBusy ? busyCandidateId : null} decisionsDisabled={data.mutationBusy || data.operationUnknown}
          onClose={() => { life.current.collectionRevision++; setDetailsOpen(false); }} onAcceptCandidate={(id, collectionId) => decideCandidate(id, 'accept', collectionId)} onRejectCandidate={id => decideCandidate(id, 'reject')} />}
      </main>
    </div>
  );
}
